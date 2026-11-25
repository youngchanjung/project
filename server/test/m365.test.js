// M365 연동: 회사 계정 로그인(OIDC), 메일 알림, Outlook 일정, Teams 채널 알림 — 가짜 Microsoft 서버로 시험
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-m365-'));
process.env.DB_CLIENT = 'sqlite';
process.env.DATA_DIR = tmp;
process.env.SESSION_SECRET = 'test';
process.env.M365_MAIL_DELAY_MS = '0';
process.env.M365_SYNC_DELAY_MS = '0';
process.env.TEAMS_ALLOW_HTTP = '1';
const wait = (ms = 150) => new Promise(r => setTimeout(r, ms));

// ---- 가짜 Microsoft (로그인·Graph·Teams 웹후크) ----
const ms = { nonce: null, calls: [], events: new Map(), seq: 0, mails: [], teams: [] };
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const ch of req) body += ch;
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  ms.calls.push(`${req.method} ${req.url}`);
  if (req.url.endsWith('/oauth2/v2.0/token')) {
    const f = new URLSearchParams(body);
    if (f.get('grant_type') === 'client_credentials') return send(200, { access_token: 'app-token', expires_in: 3600 });
    const claims = { aud: 'cid', tid: '11111111-2222-3333-4444-555555555555', iss: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0',
      nonce: ms.nonce, exp: Math.floor(Date.now() / 1000) + 600, oid: 'oid-hong', preferred_username: 'hong@corp.test', name: '홍길동' };
    return send(200, { id_token: `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y` });
  }
  if (req.url.startsWith('/teams')) { ms.teams.push(JSON.parse(body)); return send(202); }
  const m = req.url.match(/^\/v1\.0\/users\/([^/]+)\/(sendMail|events)(?:\/([^?]+))?/);
  if (m) {
    const mb = decodeURIComponent(m[1]);
    if (m[2] === 'sendMail') { ms.mails.push({ from: mb, ...JSON.parse(body).message }); return send(202); }
    if (req.method === 'POST') { const id = `ev${++ms.seq}`; const ev = { id, mailbox: mb, ...JSON.parse(body) }; if (ev.isOnlineMeeting) ev.onlineMeeting = { joinUrl: `https://teams.test/join/${id}` }; ms.events.set(id, ev); return send(201, ev); }
    const id = decodeURIComponent(m[3]);
    if (req.method === 'PATCH') { ms.events.set(id, { ...ms.events.get(id), ...JSON.parse(body) }); return send(200, ms.events.get(id)); }
    if (req.method === 'DELETE') { ms.events.delete(id); return send(204); }
  }
  send(404, { error: { message: 'not found' } });
});

let server, base, cookie = '', config;
async function call(method, url, body, extra = {}) {
  const opt = { method, headers: { cookie, ...(extra.headers || {}) }, redirect: 'manual' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(base + url, opt);
  const sc = r.headers.getSetCookie?.() || [];
  for (const c of sc) if (c.startsWith('sid=')) cookie = c.split(';')[0];
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json, headers: r.headers, setCookies: sc };
}

before(async () => {
  await new Promise(r => mock.listen(0, r));
  const mbase = `http://127.0.0.1:${mock.address().port}`;
  ({ config } = await import('../src/config.js'));
  Object.assign(config.m365, { tenantId: '11111111-2222-3333-4444-555555555555', clientId: 'cid', clientSecret: 'sec', mailFrom: 'schedule@corp.test',
    loginBase: mbase, graphBase: `${mbase}/v1.0`, redirectUri: 'http://app.test/api/auth/m365/callback' });
  ms.base = mbase;
  config.publicUrl = 'http://app.test';
  const { prepareDb } = await import('../src/migrate.js');
  const { createApp } = await import('../src/index.js');
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await call('POST', '/api/auth/setup', { username: 'admin', name: '관리자', password: 'admin1234', email: 'admin@corp.test' })).status, 200);
});
after(async () => {
  server.close(); mock.close();
  const { db } = await import('../src/db.js');
  await db.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('회사 계정 로그인: 처음 로그인하면 직원 자동 등록, 메일·Entra ID 연결', async () => {
  const saved = cookie; cookie = '';
  assert.deepEqual((await call('GET', '/api/auth/providers')).body, { m365: true, localLogin: 'all', mail: true, outlook: true });
  const st = await call('GET', '/api/auth/m365/start');
  assert.equal(st.status, 302);
  const loc = new URL(st.headers.get('location'));
  assert.equal(loc.searchParams.get('client_id'), 'cid');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  ms.nonce = loc.searchParams.get('nonce');
  const pending = st.setCookies.find(c => c.startsWith('m365p=')).split(';')[0];
  // state 가 다르면 거절
  const bad = await call('GET', '/api/auth/m365/callback?code=abc&state=wrong', undefined, { headers: { cookie: pending } });
  assert.match(decodeURIComponent(bad.headers.get('location')), /login_error=로그인 요청이 만료/);
  const ok = await call('GET', `/api/auth/m365/callback?code=abc&state=${loc.searchParams.get('state')}`, undefined, { headers: { cookie: pending } });
  assert.equal(ok.headers.get('location'), '/');
  const me = (await call('GET', '/api/auth/me')).body.user;
  assert.equal(me.name, '홍길동'); assert.equal(me.email, 'hong@corp.test'); assert.equal(me.auth_provider, 'm365'); assert.equal(me.role, 'user');
  cookie = saved;
  // 관리자만 자체 로그인: 일반 직원은 아이디 로그인 거절
  config.m365.localLogin = 'admin';
  await call('POST', '/api/users', { username: 'kim', name: '김', password: 'pass12345' });
  const keep = cookie;
  assert.equal((await call('POST', '/api/auth/login', { username: 'kim', password: 'pass12345' })).status, 403);
  assert.equal((await call('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).status, 200);
  config.m365.localLogin = 'all';
  cookie = keep;
});

test('메일 알림: 담당 지정 알림을 메일로, 끄면 안 보냄, 메일 없는 사람은 건너뜀', async () => {
  const lee = (await call('POST', '/api/users', { username: 'lee', name: '이수진', password: 'pass12345', email: 'lee@corp.test' })).body;
  const noMail = (await call('POST', '/api/users', { username: 'park', name: '박', password: 'pass12345' })).body;
  const p = (await call('POST', '/api/projects', { name: '메일 시험', category: 'design' })).body;
  ms.mails.length = 0;
  const t = (await call('POST', `/api/projects/${p.id}/tasks`, { name: '평면도', start: '2026-12-01', end: '2026-12-03', assignee_id: lee.id })).body.task;
  await call('POST', `/api/projects/${p.id}/tasks`, { name: '입면도', start: '2026-12-01', end: '2026-12-03', assignee_id: noMail.id });
  await wait();
  assert.equal(ms.mails.length, 1);
  const m = ms.mails[0];
  assert.equal(m.from, 'schedule@corp.test');
  assert.equal(m.toRecipients[0].emailAddress.address, 'lee@corp.test');
  assert.match(m.subject, /메일 시험 · 평면도/);
  assert.match(m.body.content, /관리자님이 나를 작업 담당자로 지정했습니다/);
  assert.match(m.body.content, new RegExp(`http://app.test/projects/${p.id}/tasks\\?open=${t.id}`));
  // 받는 사람이 메일 끄기
  const keep = cookie;
  await call('POST', '/api/auth/login', { username: 'lee', password: 'pass12345' });
  assert.equal((await call('POST', '/api/auth/prefs', { email_notify: false })).body.user.email_notify, false);
  cookie = keep;
  ms.mails.length = 0;
  await call('PATCH', `/api/projects/${p.id}/tasks/${t.id}`, { assignee_id: null });
  await call('PATCH', `/api/projects/${p.id}/tasks/${t.id}`, { assignee_id: lee.id });
  await wait();
  assert.equal(ms.mails.length, 0);
});

test('Outlook: 담당 작업은 종일 일정, 회의는 참석자 초대·Teams 링크, 바꾸면 고치고 지우면 지움', async () => {
  const { idle, syncAll } = await import('../src/outlook.js');
  const sync = async () => { await wait(50); await idle(); };
  const users = (await call('GET', '/api/users')).body;
  const lee = users.find(u => u.username === 'lee');
  const choi = (await call('POST', '/api/users', { username: 'choi', name: '최민수', password: 'pass12345', email: 'choi@corp.test' })).body;
  const p = (await call('POST', '/api/projects', { name: '일정 시험', category: 'research' })).body;
  await sync();
  ms.events.clear();
  // 담당 작업 → 담당자 달력에 종일 일정
  const t = (await call('POST', `/api/projects/${p.id}/tasks`, { name: '시료 준비', start: '2026-12-01', end: '2026-12-03', assignee_id: choi.id })).body.task;
  await sync();
  let evs = [...ms.events.values()];
  assert.equal(evs.length, 1);
  assert.equal(evs[0].mailbox, 'choi@corp.test');
  assert.equal(evs[0].subject, '[일정 시험] 시료 준비');
  assert.equal(evs[0].isAllDay, true);
  assert.equal(evs[0].end.dateTime, '2026-12-04T00:00:00');
  assert.equal(evs[0].showAs, 'free');
  // 고치면 같은 일정을 고침, 같은 내용이면 다시 안 보냄
  const n0 = ms.calls.length;
  await call('PATCH', `/api/projects/${p.id}/tasks/${t.id}`, { end: '2026-12-05' });
  await sync();
  assert.equal(ms.events.size, 1);
  assert.equal([...ms.events.values()][0].end.dateTime, '2026-12-06T00:00:00');
  assert.ok(ms.calls.slice(n0).some(c => c.startsWith('PATCH')));
  const n1 = ms.calls.length;
  await syncAll();
  assert.equal(ms.calls.slice(n1).filter(c => !c.includes('/token')).length, 0);
  // 담당자가 바뀌면 예전 사람 일정은 지우고 새 사람에게
  await call('PATCH', `/api/projects/${p.id}/tasks/${t.id}`, { assignee_id: lee.id });
  await sync();
  evs = [...ms.events.values()];
  assert.equal(evs.length, 1); assert.equal(evs[0].mailbox, 'lee@corp.test');
  // 회의: 담당자 사서함, 참석자 초대, Teams 회의 링크가 작업에 저장
  const m = (await call('POST', `/api/projects/${p.id}/tasks`, { name: '중간 점검 회의', type: '회의', start: '2026-12-10', start_time: '14:00', assignee_id: lee.id, attendees: [choi.id, lee.id], teams_meeting: true, location: '3층 회의실' })).body.task;
  await sync();
  const mev = [...ms.events.values()].find(e => e.subject.includes('중간 점검'));
  assert.equal(mev.mailbox, 'lee@corp.test');
  assert.equal(mev.start.dateTime, '2026-12-10T14:00:00');
  assert.equal(mev.end.dateTime, '2026-12-10T15:00:00');
  assert.equal(mev.start.timeZone, 'Korea Standard Time');
  assert.deepEqual(mev.attendees.map(a => a.emailAddress.address), ['choi@corp.test']);
  assert.equal(mev.isOnlineMeeting, true);
  assert.equal(mev.location.displayName, '3층 회의실');
  const data = (await call('GET', `/api/projects/${p.id}/data`)).body;
  const saved = data.tasks.find(x => x.id === m.id);
  assert.equal(saved.meeting_url, `https://teams.test/join/${mev.id}`);
  assert.equal(saved.outlook_event_id, mev.id);
  assert.equal(saved.teams_meeting, true);
  // 작업을 지우면 일정도 지움, 프로젝트를 보관하면 모두 지움
  await call('DELETE', `/api/projects/${p.id}/tasks/${t.id}`);
  await sync();
  assert.equal([...ms.events.values()].filter(e => e.subject.includes('시료')).length, 0);
  await call('PATCH', `/api/projects/${p.id}`, { archived: true });
  await sync();
  assert.equal(ms.events.size, 0);
});

test('Teams 채널: 웹후크 저장(PM만 보임)·시험 보내기·검토 요청·새 이슈·하루 요약(하루 한 번)', async () => {
  const p = (await call('POST', '/api/projects', { name: '채널 시험', category: 'research' })).body;
  assert.equal((await call('PATCH', `/api/projects/${p.id}`, { teams_webhook: 'ftp://x' })).status, 400);
  const hook = `${ms.base}/teams/abc`;
  assert.equal((await call('PATCH', `/api/projects/${p.id}`, { teams_webhook: hook })).status, 200);
  // 목록·기록에는 주소가 안 보임
  const list = (await call('GET', '/api/projects')).body;
  assert.equal(list.find(x => x.id === p.id).teams_webhook, undefined);
  const data = (await call('GET', `/api/projects/${p.id}/data`)).body;
  assert.equal(data.project.teams_webhook, hook); assert.equal(data.project.teams_on, true);
  ms.teams.length = 0;
  assert.equal((await call('POST', `/api/projects/${p.id}/teams-test`)).status, 200);
  assert.equal(ms.teams.length, 1);
  assert.equal(ms.teams[0].attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  // 칸반 검토 열로 옮기면 검토 요청 카드
  const t = (await call('POST', `/api/projects/${p.id}/tasks`, { name: '보고서 초안' })).body.task;
  const review = data.columns.find(c => c.is_review);
  await call('POST', `/api/projects/${p.id}/tasks/${t.id}/move`, { column_id: review.id });
  await call('POST', `/api/projects/${p.id}/issues`, { title: '시료 부족' });
  await wait();
  const texts = ms.teams.slice(1).map(m => JSON.stringify(m.attachments[0].content.body));
  assert.ok(texts.some(x => x.includes('보고서 초안') && x.includes('검토를 요청')));
  assert.ok(texts.some(x => x.includes('시료 부족') && x.includes('이슈를 등록')));
  // 하루 요약: 오늘 마일스톤이 있으면 한 번만
  const { dailyDigest } = await import('../src/teams.js');
  const today = new Date().toISOString().slice(0, 10);
  await call('POST', `/api/projects/${p.id}/tasks`, { name: '중간 보고', type: '마일스톤', start: today, end: today });
  ms.teams.length = 0;
  assert.ok(await dailyDigest(today) >= 1);
  assert.equal(await dailyDigest(today), 0);
  const dig = JSON.stringify(ms.teams.find(m => JSON.stringify(m).includes('채널 시험')));
  assert.match(dig, /중간 보고/);
  // 끄기
  await call('PATCH', `/api/projects/${p.id}`, { teams_webhook: '' });
  assert.equal((await call('GET', `/api/projects/${p.id}/data`)).body.project.teams_on, false);
});
