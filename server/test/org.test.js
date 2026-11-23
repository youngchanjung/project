// 관리 기능(부서·직원 엑셀 등록·백업) API 테스트 — 임시 SQLite DB 사용
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-test-'));
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
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer() };
}
const xlsxFile = rows => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '직원');
  const fd = new FormData();
  fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'u.xlsx');
  return fd;
};

before(async () => {
  const { prepareDb } = await import('../src/migrate.js');
  const { createApp } = await import('../src/index.js');
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call('POST', '/auth/setup', { username: 'admin', name: '관리자', password: 'admin1234' });
  assert.equal(r.status, 200);
});
after(async () => {
  server?.close();
  const { db } = await import('../src/db.js');
  await db.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('부서: 추가, 순환 상위 부서 거부, 소속 직원 있으면 삭제 거부', async () => {
  const a = (await call('POST', '/departments', { name: '연구소' })).body;
  const b = (await call('POST', '/departments', { name: '연구1팀', parent_id: a.id })).body;
  assert.equal((await call('POST', '/departments', { name: '연구소' })).status, 400);
  assert.equal((await call('PATCH', `/departments/${a.id}`, { parent_id: b.id })).status, 400);
  const u = await call('POST', '/users', { username: 'kim', name: '김', password: 'pass12345', department_id: b.id });
  assert.equal(u.body.department_id, b.id);
  assert.equal((await call('DELETE', `/departments/${b.id}`)).status, 400);
});

test('직원 엑셀: 미리 보기는 DB를 바꾸지 않고, 실행하면 추가·갱신·새 부서 생성', async () => {
  const head = ['아이디', '이름', '사번', '부서', '직급', '메일', '전화', '권한', '초기 비밀번호'];
  const bad = await call('POST', '/users/import', xlsxFile([head, ['lee', '이', '', '연구2팀', '', '', '', '', 'short']]));
  assert.equal(bad.body.summary.errors, 1);
  const rows = [head, ['kim', '김책임', '7', '연구1팀', '책임', '', '', '관리자', ''], ['lee', '이선임', '8', '연구2팀', '선임', '', '', '', 'pass12345']];
  const pv = await call('POST', '/users/import', xlsxFile(rows));
  assert.deepEqual([pv.body.summary.add, pv.body.summary.update, pv.body.summary.newDepts], [1, 1, ['연구2팀']]);
  assert.equal((await call('GET', '/users')).body.length, 2);
  const ap = await call('POST', '/users/import?apply=1', xlsxFile(rows));
  assert.equal(ap.status, 200);
  const users = (await call('GET', '/users')).body;
  assert.equal(users.length, 3);
  assert.equal(users.find(u => u.username === 'kim').role, 'admin');
  assert.ok((await call('GET', '/departments')).body.find(d => d.name === '연구2팀'));
});

test('백업: 지금 백업하면 파일이 생기고 상태에 기록됨', async () => {
  const r = await call('POST', '/backup/run');
  assert.equal(r.status, 200);
  assert.ok(r.body.last.ok);
  assert.ok(fs.existsSync(path.join(tmp, 'backups', r.body.last.file)));
});

test('공휴일: 목록에 있는 나라만 허용, 여러 날 붙여넣기, 프로젝트 휴일 달력 정리', async () => {
  const cs = (await call('GET', '/holidays/countries')).body.map(c => c.code);
  assert.deepEqual(cs, ['KR', 'VN']);
  assert.equal((await call('POST', '/holidays', { country: 'JP', date: '2027-01-01', name: 'x' })).status, 400);
  const r = await call('POST', '/holidays/bulk', { country: 'VN', text: '2027-01-01 Tết Dương lịch\n2027/2/5\t설\n2027.02.05 중복\n\n' });
  assert.deepEqual(r.body, { added: 2, skipped: 1 });
  assert.equal((await call('POST', '/holidays/bulk', { country: 'VN', text: '내일' })).status, 400);
  const p = await call('POST', '/projects', { name: '시험', calendars: 'vn,XX' });
  assert.equal(p.status, 200);
  assert.equal(p.body.calendars ?? (await call('GET', `/projects/${p.body.id}`)).body.project?.calendars, 'VN');
});
