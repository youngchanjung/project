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
  const r = await call('POST', '/holidays/bulk', { country: 'VN', text: '2030-01-01 Tết Dương lịch\n2030/2/5\t설\n2030.02.05 중복\n\n' });
  assert.deepEqual(r.body, { added: 2, skipped: 1 });
  assert.equal((await call('POST', '/holidays/bulk', { country: 'VN', text: '내일' })).status, 400);
  const p = await call('POST', '/projects', { name: '시험', calendars: 'vn,XX' });
  assert.equal(p.status, 200);
  assert.equal(p.body.calendars ?? (await call('GET', `/projects/${p.body.id}`)).body.project?.calendars, 'VN');
});

test('언어: 오류 메시지는 X-Lang 에 맞춰 번역, 사용자 언어 저장', async () => {
  const r = await fetch(base + '/api/departments', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-Lang': 'en' }, body: JSON.stringify({ name: '연구소' }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /already exists/i);
  const vi = await fetch(base + '/api/projects', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-Lang': 'vi' }, body: JSON.stringify({ name: ' ' }) });
  assert.equal((await vi.json()).error, 'Vui lòng nhập tên dự án.');
  assert.equal((await call('POST', '/auth/lang', { lang: 'vi' })).status, 200);
  assert.equal((await call('GET', '/auth/me')).body.user?.lang ?? (await call('GET', '/auth/me')).body.lang, 'vi');
});

test('내용 번역: 같은 문장은 저장된 번역을 쓰고 DeepL 은 한 번만 호출', async () => {
  const { translateTexts } = await import('../src/translate.js');
  let calls = 0;
  const fetcher = async (texts, target) => { calls++; return texts.map(t => ({ detected_source_language: t.startsWith('Hello') ? 'EN' : 'KO', text: `[${target}] ${t}` })); };
  const a = await translateTexts(['시험 계획', 'Hello', '시험 계획', ''], 'en', { fetcher });
  assert.deepEqual(a, ['[en] 시험 계획', 'Hello', '[en] 시험 계획', '']);
  const b = await translateTexts(['시험 계획'], 'en', { fetcher });
  assert.deepEqual(b, ['[en] 시험 계획']);
  assert.equal(calls, 1);
  const off = await call('POST', '/translate', { target: 'en', texts: ['x'] });
  assert.equal(off.status, 503); // 키가 없으면 꺼짐
});

test('공휴일 기본값: 한국 2027(노동절·제헌절 대체), 베트남 2026·2027 들어 있음', async () => {
  const { db } = await import('../src/db.js');
  const has = async (country, date) => !!(await db('holidays').where({ country, date }).first());
  for (const d of ['2027-05-03', '2027-07-19', '2027-02-07', '2027-12-27']) assert.ok(await has('KR', d), `KR ${d}`);
  for (const d of ['2026-02-17', '2026-09-01', '2026-11-24', '2027-02-04', '2027-09-03']) assert.ok(await has('VN', d), `VN ${d}`);
});

test('엑셀 내보내기: 시트·머리글·행을 그대로 담고, 같은 시트 이름은 구분, 빈 요청은 거부', async () => {
  const r = await call('POST', '/sheet.xlsx', { name: '작업 목록', sheets: [
    { name: '작업', header: ['ID', '작업', '진행률'], rows: [['A1', '설계', 50], ['A2', '시험', null]] },
    { name: '작업', header: ['날짜'], rows: [['2027-01-01']] }] });
  assert.equal(r.status, 200);
  const wb = XLSX.read(Buffer.from(r.body), { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['작업', '작업 (2)']);
  assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets['작업'], { header: 1 }), [['ID', '작업', '진행률'], ['A1', '설계', 50], ['A2', '시험', '']]);
  assert.equal((await call('POST', '/sheet.xlsx', { name: 'x', sheets: [] })).status, 400);
});

test('달력 구독(ICS): 개인 주소로 내 작업·프로젝트 일정을 받고, 새 주소를 만들면 옛 주소는 막힘', async () => {
  const p = (await call('POST', '/projects', { name: '달력 시험', calendars: 'KR', day_basis: 'workday', phases: [] })).body;
  await call('POST', `/projects/${p.id}/tasks`, { code: 'T1', name: '설계, 검토; 1차', start: '2027-03-02', end: '2027-03-05', owner: '관리자', is_key: true });
  await call('POST', `/projects/${p.id}/tasks`, { code: 'T2', name: '남의 작업', start: '2027-03-08', end: '2027-03-08', owner: '김' });
  const info = (await call('GET', '/me/calendar')).body;
  assert.match(info.mine, /\/ics\/[0-9a-f]{48}\/mine\.ics$/);
  const get = async url => { const r = await fetch(url); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
  const mine = await get(info.mine);
  assert.equal(mine.status, 200);
  assert.match(mine.type, /text\/calendar/);
  assert.match(mine.text, /BEGIN:VCALENDAR\r\n/);
  assert.match(mine.text, /DTSTART;VALUE=DATE:20270302\r\nDTEND;VALUE=DATE:20270306/);
  assert.match(mine.text, /SUMMARY:★ \[T1\] 설계\\, 검토\\; 1차/);
  assert.doesNotMatch(mine.text, /남의 작업/);
  const proj = await get(info.projects.find(x => x.id === p.id).url);
  assert.match(proj.text, /남의 작업/);
  assert.ok(proj.text.split('\r\n').every(l => Buffer.byteLength(l) <= 75));
  const again = (await call('POST', '/me/calendar/reset')).body;
  assert.notEqual(again.mine, info.mine);
  assert.equal((await get(info.mine)).status, 404);
  assert.equal((await get(again.mine)).status, 200);
});
