// 카테고리·칸반·할 일 API 테스트 — 임시 SQLite DB 사용
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-board-'));
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

test('설계 프로젝트: 기본 칸반 4열, 제목만으로 할 일 추가, 끌어서 이동', async () => {
  const p = (await call('POST', '/projects', { name: '설계 A', category: 'design' })).body;
  assert.equal(p.category, 'design');
  let d = (await call('GET', `/projects/${p.id}/data`)).body;
  assert.deepEqual(d.columns.map(c => c.name), ['할 일', '진행 중', '검토', '완료']);
  const [todo, doing, review, done] = d.columns;

  // 제목만 입력 → 날짜 없는 할 일
  const a = (await call('POST', `/projects/${p.id}/tasks`, { name: '평면도', board_column_id: todo.id })).body.task;
  assert.equal(!!a.undated, true);
  assert.equal(a.status, '미착수');
  const b = (await call('POST', `/projects/${p.id}/tasks`, { name: '입면도', board_column_id: todo.id, end: '2026-12-10', priority: '높음', tags: '입면, ,구조' })).body.task;
  assert.equal(!!b.undated, false);
  assert.equal(b.start, '2026-12-10');
  assert.equal(b.tags, '입면, 구조');

  // 검토 열로 이동 → 상태 진행중
  let r = await call('POST', `/projects/${p.id}/tasks/${a.id}/move`, { column_id: review.id, index: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.status, '진행중');
  assert.equal(r.body.task.board_column_id, review.id);
  // 완료 열로 → 완료일 자동 기록
  r = await call('POST', `/projects/${p.id}/tasks/${a.id}/move`, { column_id: done.id });
  assert.equal(r.body.task.status, '완료');
  assert.ok(r.body.task.actual_end);
  assert.equal(r.body.task.progress, 100);
  // 같은 열 안 순서: b 를 todo 맨 앞으로, 새 카드 c 를 0번에 넣으면 b 가 1번
  const c = (await call('POST', `/projects/${p.id}/tasks`, { name: '단면도', board_column_id: todo.id })).body.task;
  await call('POST', `/projects/${p.id}/tasks/${c.id}/move`, { column_id: todo.id, index: 0 });
  d = (await call('GET', `/projects/${p.id}/data`)).body;
  const inTodo = d.tasks.filter(t => t.board_column_id === todo.id).sort((x, y) => x.board_order - y.board_order).map(t => t.name);
  assert.deepEqual(inTodo, ['단면도', '입면도']);

  // 상태를 편집창에서 바꾸면 열도 따라감
  r = await call('PATCH', `/projects/${p.id}/tasks/${b.id}`, { status: '진행중' });
  assert.equal(r.body.task.board_column_id, doing.id);

  // 체크리스트
  const ci = (await call('POST', `/projects/${p.id}/tasks/${b.id}/checklist`, { text: '치수 확인' })).body;
  await call('PATCH', `/projects/${p.id}/tasks/${b.id}/checklist/${ci.id}`, { done: true });
  d = (await call('GET', `/projects/${p.id}/data`)).body;
  assert.equal(d.checklist.length, 1);
  assert.equal(d.checklist[0].done, true);

  // 일괄 완료
  r = await call('POST', `/projects/${p.id}/tasks/bulk-status`, { ids: [b.id, c.id], status: '완료' });
  assert.equal(r.status, 200);
  d = (await call('GET', `/projects/${p.id}/data`)).body;
  assert.ok(d.tasks.every(t => t.status === '완료'));
});

test('카테고리 검사, 기본값 시공, 열 추가·삭제', async () => {
  assert.equal((await call('POST', '/projects', { name: 'X', category: 'nope' })).status, 400);
  const p = (await call('POST', '/projects', { name: '시공 B' })).body;
  assert.equal(p.category, 'construction');
  const col = (await call('POST', `/projects/${p.id}/columns`, { name: '보류', status: '보류', color: '#999999' })).body;
  assert.equal(col.sort, 4);
  assert.equal((await call('DELETE', `/projects/${p.id}/columns/${col.id}`)).status, 200);
  const r = await call('PATCH', `/projects/${p.id}`, { category: 'research' });
  assert.equal(r.body.category, 'research');
});

test('검토 흐름: 검토 열로 옮기면 검토자에게 알림, 승인하면 완료 열, 반려하면 진행 중 열', async () => {
  const me = (await call('GET', '/auth/me')).body.user;
  // 검토자 계정
  const rv = (await call('POST', '/users', { username: 'rev1', name: '검토자', password: 'rev12345' })).body;
  const p = (await call('POST', '/projects', { name: '설계 C', category: 'design' })).body;
  await call('PUT', `/projects/${p.id}/members/${rv.id}`, { role: 'member' });
  const d = (await call('GET', `/projects/${p.id}/data`)).body;
  const [todo, doing, review, done] = d.columns;
  const t = (await call('POST', `/projects/${p.id}/tasks`, { name: '창호도', board_column_id: todo.id, reviewer_id: rv.id, assignee_id: me.id })).body.task;
  let r = await call('POST', `/projects/${p.id}/tasks/${t.id}/move`, { column_id: review.id });
  assert.equal(r.body.task.review_state, 'requested');
  const { db } = await import('../src/db.js');
  assert.equal((await db('notifications').where({ user_id: rv.id, kind: 'review_requested' })).length, 1);
  // 반려 → 진행 중
  r = await call('POST', `/projects/${p.id}/tasks/${t.id}/review`, { decision: 'reject', note: '치수 누락' });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.board_column_id, doing.id);
  assert.equal(r.body.task.review_state, 'rejected');
  assert.equal(r.body.task.review_note, '치수 누락');
  // 다시 검토 → 승인 → 완료
  await call('POST', `/projects/${p.id}/tasks/${t.id}/move`, { column_id: review.id });
  r = await call('POST', `/projects/${p.id}/tasks/${t.id}/review`, { decision: 'approve' });
  assert.equal(r.body.task.board_column_id, done.id);
  assert.equal(r.body.task.status, '완료');
  assert.equal(r.body.task.review_state, 'approved');
});

test('연구 프로젝트: 협약 기간으로 예시 일정, 회의 시각·참석자 검사', async () => {
  const p = (await call('POST', '/projects', { name: '연구 D', category: 'research', agreement_start: '2027-01-01', agreement_end: '2027-12-31', template: true })).body;
  assert.equal(p.agreement_end, '2027-12-31');
  const d = (await call('GET', `/projects/${p.id}/data`)).body;
  const byName = Object.fromEntries(d.tasks.map(t => [t.name, t]));
  assert.equal(byName['착수 회의'].start, '2027-01-01');
  assert.equal(byName['최종 보고서 제출'].end, '2027-12-31');
  assert.equal(byName['중간 보고서 제출'].type, '마일스톤');
  assert.equal((await call('POST', `/projects/${p.id}/tasks`, { name: '주간 회의', type: '회의', start: '2027-01-05', start_time: '25:00' })).status, 400);
  const m = (await call('POST', `/projects/${p.id}/tasks`, { name: '주간 회의', type: '회의', start: '2027-01-05', start_time: '14:00', end_time: '15:00', location: '3층 회의실', attendees: [1] })).body.task;
  assert.equal(m.start_time, '14:00');
  assert.equal(m.attendees, '1');
  assert.equal((await call('POST', '/projects', { name: 'X', category: 'research', agreement_start: '2027-02-01', agreement_end: '2027-01-01' })).status, 400);
});
