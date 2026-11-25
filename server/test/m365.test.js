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
