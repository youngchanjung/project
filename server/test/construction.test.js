// 시공 4단계: 공정률·S-커브, 현장 사진·첨부 — 임시 SQLite DB 사용
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sCurve } from '../src/schedule.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-cons-'));
process.env.DB_CLIENT = 'sqlite';
process.env.DATA_DIR = tmp;
process.env.SESSION_SECRET = 'test';

let server, base, cookie = '';
async function call(method, url, body) {
  const opt = { method, headers: { cookie } };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(base + '/api' + url, opt);
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const json = r.headers.get('content-type')?.includes('json');
  return { status: r.status, body: json ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
}

before(async () => {
  const { prepareDb } = await import('../src/migrate.js');
  const { createApp } = await import('../src/index.js');
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await call('POST', '/auth/setup', { username: 'admin', name: '관리자', password: 'admin1234' })).status, 200);
});
after(async () => {
  server.close();
  const { db } = await import('../src/db.js');
  await db.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('S-커브: 기간 가중 계획·실적, 가중치 방식', () => {
  const tasks = [
    { id: 1, start: '2026-11-01', end: '2026-11-10', status: '완료', progress: 100, actual_start: '2026-11-01', actual_end: '2026-11-10' }, // 10일
    { id: 2, start: '2026-11-11', end: '2026-11-20', status: '진행중', progress: 50, actual_start: '2026-11-11' }, // 10일
    { id: 3, start: '2026-11-11', end: '2026-11-20', status: '미착수', progress: 0, parent_id: null, undated: false },
    { id: 9, start: '2026-11-01', end: '2026-11-30', status: '진행중', progress: 30 }, // 요약 작업(하위 있음) → 제외
    { id: 10, parent_id: 9, start: '2026-11-21', end: '2026-11-30', status: '미착수', progress: 0 } // 10일
  ];
  const r = sCurve(tasks, { today: '2026-11-15' });
  assert.equal(r.count, 4);
  assert.equal(r.total, 40);
  // 계획: 1번 10 + 2·3번 각 5/10 → (10 + 5 + 5) / 40 = 50%
  assert.equal(r.today.plan, 50);
  // 실적: 1번 10 + 2번 50% 를 11~15일에 걸쳐 다 얻음(5) → 15 / 40 = 37.5%
  assert.equal(r.today.actual, 37.5);
  assert.equal(r.points.at(-1).plan, 100);
  assert.equal(r.points.at(-1).actual, null); // 미래는 실적 없음
  assert.ok(r.points.some(p => p.date === '2026-11-15'));
  // 가중치: 1번만 가중치 → 1번이 끝났으니 100%
  const w = sCurve(tasks.map(t => ({ ...t, weight: t.id === 1 ? 5 : 0 })), { today: '2026-11-15', mode: 'weight' });
  assert.equal(w.count, 1);
  assert.equal(w.today.actual, 100);
  // 기준선(plan) 이 있으면 그 날짜로 계획을 잡음
  const b = sCurve(tasks, { today: '2026-11-15', plan: new Map([[2, { start: '2026-11-01', end: '2026-11-10' }]]) });
  assert.equal(b.today.plan, 62.5); // (10 + 10 + 5) / 40
});

test('S-커브 API와 현장 사진·첨부', async () => {
  const p = (await call('POST', '/projects', { name: '시공 A', category: 'construction', phases: ['시공'] })).body;
  const t = (await call('POST', `/projects/${p.id}/tasks`, { name: '기초 타설', start: '2026-11-02', end: '2026-11-13', weight: 1200 })).body.task;
  assert.equal(t.weight, 1200);
  const s = await call('GET', `/projects/${p.id}/scurve?today=2026-11-06&mode=weight`);
  assert.equal(s.status, 200);
  assert.equal(s.body.mode, 'weight');
  assert.equal(s.body.hasWeight, true);
  assert.ok(s.body.today.plan > 0 && s.body.today.plan < 100);
  assert.equal(s.body.today.actual, 0);

  // 사진 올리기 (작업에 연결)
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const fd = new FormData();
  fd.append('task_id', String(t.id));
  fd.append('note', '타설 전 배근 검측');
  fd.append('taken_on', '2026-11-05');
  fd.append('files', new Blob([png], { type: 'image/png' }), '배근.png');
  fd.append('files', new Blob(['hello'], { type: 'text/plain' }), '메모.txt');
  const up = await call('POST', `/projects/${p.id}/attachments`, fd);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.length, 2);
  assert.equal(up.body[0].name, '배근.png');
  assert.equal(up.body[0].image, true);
  assert.equal(up.body[1].image, false);

  const list = (await call('GET', `/projects/${p.id}/attachments?task_id=${t.id}`)).body;
  assert.equal(list.length, 2);
  assert.equal(list[0].taken_on, '2026-11-05');
  const f = await call('GET', `/projects/${p.id}/attachments/${up.body[0].id}/file`);
  assert.equal(f.status, 200);
  assert.deepEqual(Buffer.compare(f.body, png), 0);

  // 실행 파일은 막음
  const bad = new FormData();
  bad.append('files', new Blob(['x']), 'run.exe');
  assert.equal((await call('POST', `/projects/${p.id}/attachments`, bad)).status, 400);

  // 설명 바꾸기, 지우기
  assert.equal((await call('PATCH', `/projects/${p.id}/attachments/${up.body[1].id}`, { note: '바꿈' })).body.note, '바꿈');
  assert.equal((await call('DELETE', `/projects/${p.id}/attachments/${up.body[1].id}`)).status, 200);
  assert.equal((await call('GET', `/projects/${p.id}/attachments`)).body.length, 1);
  assert.ok(fs.existsSync(path.join(tmp, 'attachments', String(p.id))));

  // 작업을 지워도 사진은 남음 (작업 연결만 풀림)
  assert.equal((await call('DELETE', `/projects/${p.id}/tasks/${t.id}`)).status, 200);
  const left = (await call('GET', `/projects/${p.id}/attachments`)).body;
  assert.equal(left.length, 1);
  assert.equal(left[0].task_id, null);

  // 프로젝트를 지우면 파일 폴더도 지움
  assert.equal((await call('DELETE', `/projects/${p.id}`)).status, 200);
  assert.ok(!fs.existsSync(path.join(tmp, 'attachments', String(p.id))));
});
