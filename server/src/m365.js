// Microsoft 365(Entra ID) 연동 공통: 앱 토큰, Graph 호출, 회사 계정 로그인(OIDC)
// .env 의 M365_TENANT_ID / M365_CLIENT_ID / M365_CLIENT_SECRET 이 없으면 모두 꺼짐 (자체 로그인은 그대로)
// 필요한 권한과 등록 절차: docs/M365_연동_안내.md
import crypto from 'node:crypto';
import { config } from './config.js';

const c = () => config.m365;
export const m365Ready = () => !!(c().tenantId && c().clientId && c().clientSecret);
export const features = () => ({
  sso: m365Ready(),
  mail: m365Ready() && !!c().mailFrom,
  outlook: m365Ready() && c().outlook
});

// ---- 앱 전용 토큰 (client credentials) ----
let tok = null;
async function appToken() {
  if (tok && tok.exp > Date.now() + 60e3) return tok.value;
  const r = await fetch(`${c().loginBase}/${encodeURIComponent(c().tenantId)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c().clientId, client_secret: c().clientSecret, scope: 'https://graph.microsoft.com/.default' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`M365 토큰 발급 실패: ${j.error_description || j.error || r.status}`);
  tok = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tok.value;
}
export const resetToken = () => { tok = null; };

// Graph 호출. 실패하면 Graph 오류 메시지로 Error
export async function graph(method, path, body) {
  const r = await fetch(c().graphBase + path, {
    method, headers: { Authorization: `Bearer ${await appToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 204 || r.status === 202) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(`Graph ${method} ${path.split('?')[0]}: ${j?.error?.message || r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}
const mbx = s => encodeURIComponent(s);

export async function sendMail(to, subject, html) {
  if (!features().mail) throw new Error('메일 알림이 설정되지 않았습니다.');
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return;
  await graph('POST', `/users/${mbx(c().mailFrom)}/sendMail`, {
    message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: list.map(address => ({ emailAddress: { address } })) },
    saveToSentItems: false
  });
}
export const createEvent = (mailbox, ev) => graph('POST', `/users/${mbx(mailbox)}/events`, ev);
export const updateEvent = (mailbox, id, ev) => graph('PATCH', `/users/${mbx(mailbox)}/events/${encodeURIComponent(id)}`, ev);
export async function deleteEvent(mailbox, id) {
  try { await graph('DELETE', `/users/${mbx(mailbox)}/events/${encodeURIComponent(id)}`); }
  catch (e) { if (e.status !== 404) throw e; } // 이미 지운 일정
}

// ---- 회사 계정 로그인 (OpenID Connect, 인증 코드 + PKCE) ----
const b64url = buf => Buffer.from(buf).toString('base64url');
export function redirectUri(req) {
  if (c().redirectUri) return c().redirectUri;
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/m365/callback`;
}
export function startLogin(req) {
  const state = b64url(crypto.randomBytes(16)), nonce = b64url(crypto.randomBytes(16)), verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({
    client_id: c().clientId, response_type: 'code', redirect_uri: redirectUri(req), response_mode: 'query',
    scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
  });
  return { url: `${c().loginBase}/${encodeURIComponent(c().tenantId)}/oauth2/v2.0/authorize?${q}`, pending: { state, nonce, verifier } };
}

// 코드 → 토큰 교환 후 id_token 의 발급자·대상·nonce·만료를 확인하고 사용자 정보를 돌려줌
// (토큰 엔드포인트에서 TLS 로 직접 받은 id_token 이므로 서명 검증은 생략: OIDC Core 3.1.3.7)
export async function finishLogin(req, pending) {
  const { code, state, error, error_description: desc } = req.query;
  if (error) throw new Error(`회사 계정 로그인 실패: ${desc || error}`);
  if (!pending || !state || state !== pending.state) throw new Error('로그인 요청이 만료되었습니다. 다시 시도하세요.');
  const r = await fetch(`${c().loginBase}/${encodeURIComponent(c().tenantId)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: c().clientId, client_secret: c().clientSecret, code: String(code || ''), redirect_uri: redirectUri(req), code_verifier: pending.verifier, scope: 'openid profile email' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error(`회사 계정 로그인 실패: ${j.error_description || j.error || r.status}`);
  let claims;
  try { claims = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString('utf8')); } catch { throw new Error('회사 계정 로그인 실패: 토큰을 읽을 수 없습니다.'); }
  const isGuid = /^[0-9a-f-]{36}$/i.test(c().tenantId);
  if (claims.aud !== c().clientId) throw new Error('회사 계정 로그인 실패: 대상(aud)이 맞지 않습니다.');
  if (claims.nonce !== pending.nonce) throw new Error('회사 계정 로그인 실패: nonce 가 맞지 않습니다.');
  if (!claims.exp || claims.exp * 1000 < Date.now() - 300e3) throw new Error('회사 계정 로그인 실패: 토큰이 만료되었습니다.');
  if (isGuid && claims.tid && claims.tid.toLowerCase() !== c().tenantId.toLowerCase()) throw new Error('회사 계정 로그인 실패: 다른 회사(테넌트) 계정입니다.');
  if (claims.iss && claims.tid && !String(claims.iss).includes(claims.tid)) throw new Error('회사 계정 로그인 실패: 발급자가 맞지 않습니다.');
  const email = String(claims.email || claims.preferred_username || claims.upn || '').trim();
  return { oid: claims.oid || claims.sub, email, name: claims.name || email.split('@')[0], upn: String(claims.preferred_username || claims.upn || email) };
}
