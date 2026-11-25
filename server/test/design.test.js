// 설계 1순위: 예상 시간·업무량, 단계 제출일, 프로젝트 템플릿 — 임시 SQLite DB 사용
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeWorkload, mondayOf } from '../src/workload.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-design-'));
process.env.DB_CLIENT = 'sqlite';
process.env.DATA_DIR = tmp;
process.env.SESSION_SECRET = 'test';

let server, base, cookie = '';
async function call(method, url, body) {
  const opt = { method, headers: { cookie } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(base + '/api' + url, opt);
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json() };
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

test('업무량 계산: 근무일에 나눔, 지난 몫은 오늘부터, 날짜 없음은 따로', () => {
  const today = '2026-11-25'; // 수요일
  assert.equal(mondayOf(today), '2026-11-23');
  const tasks = [
    { id: 1, project_id: 1, assignee_id: 7, start: '2026-11-23', end: '2026-12-04', est_hours: 16, status: '진행중' }, // 오늘~12/4 근무일 8일 → 이번 주 3일 6h, 다음 주 5일 10h
    { id: 2, project_id: 2, assignee_id: 7, start: '2026-11-10', end: '2026-11-20', est_hours: 5, status: '진행중' }, // 지연 → 오늘에 5h
    { id: 3, project_id: 1, assignee_id: 7, start: '2026-11-25', end: '2026-11-25', undated: true, est_hours: 3, status: '미착수' },
    { id: 4, project_id: 1, assignee_id: 7, start: '2026-11-30', end: '2026-11-30', status: '미착수' }, // 시간 미입력
    { id: 5, project_id: 1, assignee_id: 7, start: '2026-11-24', end: '2026-11-26', est_hours: 9, status: '완료' } // 완료는 제외
  ];
  const { weeks, byUser } = computeWorkload(tasks, { today, weeks: 2, hol: new Set(), here: 1 });
  assert.equal(weeks[0].start, '2026-11-23');
  const r = byUser.get(7);
  assert.equal(r.weeks[0].hours, 11);
  assert.equal(r.weeks[0].here, 6);
  assert.equal(r.weeks[1].hours, 10);
  assert.equal(r.weeks[1].count, 2);
  assert.equal(r.weeks[1].noEst, 1);
  assert.deepEqual(r.undated, { count: 1, hours: 3 });
});

test('예상 시간·단계 제출일·업무량 API', async () => {
  const p = (await call('POST', '/projects', { name: '설계 B', category: 'design', phases: ['기본설계'] })).body;
  let d = (await call('GET', `/projects/${p.id}/data`)).body;
  const ph = d.phases[0];
  assert.equal((await call('PATCH', `/projects/${p.id}/phases/${ph.id}`, { due: '2026-12-05' })).status, 200);
  assert.equal((await call('PATCH', `/projects/${p.id}/phases/${ph.id}`, { due: '12월 5일' })).status, 400);
  const me = (await call('GET', '/auth/me')).body;
  const uid = me.user?.id ?? me.id;
  const t = (await call('POST', `/projects/${p.id}/tasks`, { name: '평면도', phase_id: ph.id, assignee_id: uid, start: '2026-11-23', end: '2026-12-08', est_hours: '12.5' })).body.task;
  assert.equal(t.est_hours, 12.5);
  assert.equal((await call('PATCH', `/projects/${p.id}/tasks/${t.id}`, { est_hours: -1 })).status, 400);
  d = (await call('GET', `/projects/${p.id}/data`)).body;
  assert.equal(d.phases[0].due, '2026-12-05');

  const w = (await call('GET', `/workload?project=${p.id}&weeks=3&today=2026-11-25`)).body;
  assert.equal(w.weeks.length, 3);
  const row = w.rows.find(r => r.user.id === uid);
  assert.ok(row);
  assert.equal(row.caps[0], 40);
  const sum = Math.round(row.weeks.reduce((a, c) => a + c.hours, 0) * 10) / 10;
  assert.ok(Math.abs(sum - 12.5) <= 0.2, String(sum)); // 주별 표시는 0.1 단위 반올림
  assert.equal(row.weeks[0].tasks[0].project_name, '설계 B');

  // 주당 근무 시간 바꾸기
  assert.equal((await call('PATCH', `/users/${uid}`, { weekly_hours: 20 })).status, 200);
  const w2 = (await call('GET', `/workload?project=${p.id}&weeks=1&today=2026-11-25`)).body;
  assert.equal(w2.rows.find(r => r.user.id === uid).caps[0], 20);
});

test('프로젝트 템플릿: 기본 템플릿, 저장, 새 프로젝트에 복사', async () => {
  let list = (await call('GET', '/projects/templates?category=design')).body;
  assert.ok(list.find(t => t.name === '건축 설계 기본'));
  const builtin = list.find(t => t.name === '건축 설계 기본');
  const a = (await call('POST', '/projects', { name: '설계 C', category: 'design', template_id: builtin.id })).body;
  let d = (await call('GET', `/projects/${a.id}/data`)).body;
  assert.deepEqual(d.phases.map(p => p.name), ['계획설계', '기본설계', '실시설계', '인허가']);
  assert.equal(d.columns.length, 4);
  assert.equal(d.tasks.length, builtin.tasks);
  assert.ok(d.tasks.every(t => t.undated));
  assert.ok(d.checklist.length > 0);

  // 열을 하나 더 만들고 템플릿으로 저장 → 새 프로젝트에 같은 구성
  await call('POST', `/projects/${a.id}/columns`, { name: '보류함', status: '보류' });
  const chk = d.checklist.filter(c => c.task_id === d.tasks[0].id).length;
  await call('PATCH', `/projects/${a.id}/tasks/${d.tasks[0].id}`, { est_hours: 6 });
  const saved = await call('POST', `/projects/${a.id}/templates`, { name: '우리 설계' });
  assert.equal(saved.status, 200);
  assert.equal((await call('POST', `/projects/${a.id}/templates`, { name: '우리 설계' })).status, 400);
  const b = (await call('POST', '/projects', { name: '설계 D', category: 'design', template_id: saved.body.id })).body;
  const d2 = (await call('GET', `/projects/${b.id}/data`)).body;
  assert.equal(d2.columns.length, 5);
  assert.equal(d2.tasks[0].est_hours, 6);
  assert.equal(d2.checklist.filter(c => c.task_id === d2.tasks[0].id).length, chk);
  assert.equal(d2.tasks.find(t => t.name === '기본설계 제출').phase_id, d2.phases.find(p => p.name === '기본설계').id);

  assert.equal((await call('DELETE', `/projects/templates/${saved.body.id}`)).status, 200);
  list = (await call('GET', '/projects/templates?category=design')).body;
  assert.ok(!list.find(t => t.name === '우리 설계'));
  assert.equal((await call('POST', '/projects', { name: 'X', category: 'design', template_id: 99999 })).status, 400);
});
