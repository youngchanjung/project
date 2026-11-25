import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError, now, insertId } from '../util.js';
import { checkPassword, hashPassword, setSession, clearSession, publicUser, requireLogin, allowedCategories } from '../auth.js';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { features, startLogin, finishLogin } from '../m365.js';

export const authRouter = Router();

// 최초 실행: 사용자가 한 명도 없으면 첫 관리자 계정을 만들 수 있음
authRouter.get('/setup', ah(async (_req, res) => {
  const { n } = await db('users').count({ n: '*' }).first();
  res.json({ needsSetup: Number(n) === 0 });
}));
authRouter.post('/setup', ah(async (req, res) => {
  const { n } = await db('users').count({ n: '*' }).first();
  if (Number(n) > 0) throw new HttpError(400, '이미 초기 설정이 끝났습니다.');
  const { username, name, password, email } = req.body || {};
  if (!username || !name || !password || password.length < 8) throw new HttpError(400, '아이디, 이름, 8자 이상 비밀번호를 입력하세요.');
  const id = await insertId(db, 'users', { username: username.trim(), name: name.trim(), email: email || null, role: 'admin', password_hash: await hashPassword(password), created_at: now() });
  const u = await db('users').where({ id }).first();
  setSession(res, u);
  res.json({ user: publicUser(u) });
}));

authRouter.post('/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  const u = await db('users').where({ username: String(username || '').trim() }).first();
  if (!u || !u.active || !(await checkPassword(String(password || ''), u.password_hash))) {
    throw new HttpError(401, '아이디 또는 비밀번호가 맞지 않습니다.');
  }
  if (features().sso && config.m365.localLogin === 'admin' && u.role !== 'admin') throw new HttpError(403, '회사 계정(Microsoft)으로 로그인하세요.');
  u.last_login_at = now();
  await db('users').where({ id: u.id }).update({ last_login_at: u.last_login_at });
  setSession(res, u);
  res.json({ user: publicUser(u) });
}));
authRouter.post('/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });
// 로그인 화면에 보여 줄 방식, 켜진 연동 기능
authRouter.get('/providers', (_req, res) => {
  const f = features();
  res.json({ m365: f.sso, localLogin: f.sso ? config.m365.localLogin : 'all', mail: f.mail, outlook: f.outlook });
});

// ---- 회사 계정(Microsoft 365) 로그인 ----
const PENDING = 'm365p';
authRouter.get('/m365/start', (req, res) => {
  if (!features().sso) return res.status(404).json({ error: '회사 계정 로그인이 설정되지 않았습니다.' });
  const { url, pending } = startLogin(req);
  res.cookie(PENDING, jwt.sign(pending, config.sessionSecret, { expiresIn: '10m' }), { httpOnly: true, sameSite: 'lax', secure: config.secureCookie, maxAge: 600e3 });
  res.redirect(url);
});
authRouter.get('/m365/callback', ah(async (req, res) => {
  if (!features().sso) return res.status(404).json({ error: '회사 계정 로그인이 설정되지 않았습니다.' });
  let pending = null;
  try { pending = jwt.verify(req.cookies?.[PENDING] || '', config.sessionSecret); } catch {}
  res.clearCookie(PENDING);
  try {
    const info = await finishLogin(req, pending);
    const u = await linkM365User(info);
    setSession(res, u);
    res.redirect('/');
  } catch (e) {
    res.redirect('/?login_error=' + encodeURIComponent(e.message));
  }
}));

// Entra 객체 ID → 메일 주소 → 아이디 순으로 기존 직원과 연결. 없으면 자동 등록(M365_AUTO_CREATE)
export async function linkM365User(info) {
  if (!info.oid) throw new Error('회사 계정 로그인 실패: 계정 ID 가 없습니다.');
  const lower = s => String(s || '').toLowerCase();
  let u = await db('users').where({ external_id: info.oid }).first();
  if (!u && info.email) u = (await db('users').whereNotNull('email')).find(x => lower(x.email) === lower(info.email) || lower(x.email) === lower(info.upn));
  if (!u && info.upn) u = await db('users').whereRaw('lower(username) = ?', [lower(info.upn)]).first();
  if (u && !u.active) throw new Error('사용이 중지된 계정입니다. 관리자에게 문의하세요.');
  if (!u) {
    if (!config.m365.autoCreate) throw new Error('등록되지 않은 회사 계정입니다. 관리자에게 직원 등록(메일 주소)을 요청하세요.');
    const id = await insertId(db, 'users', { username: String(info.upn || info.email).slice(0, 64), name: String(info.name || '').slice(0, 100), email: info.email || null, role: 'user', auth_provider: 'm365', external_id: info.oid, created_at: now() });
    u = await db('users').where({ id }).first();
  }
  const up = { auth_provider: 'm365', external_id: info.oid, last_login_at: now() };
  if (!u.email && info.email) up.email = info.email;
  await db('users').where({ id: u.id }).update(up);
  return { ...u, ...up };
}

authRouter.get('/me', ah(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const cats = await allowedCategories(req.user);
  res.json({ user: { ...publicUser(req.user), categories: cats ? [...cats] : null } });
}));

authRouter.post('/password', requireLogin, ah(async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await checkPassword(String(current || ''), req.user.password_hash))) throw new HttpError(400, '현재 비밀번호가 맞지 않습니다.');
  if (!next || next.length < 8) throw new HttpError(400, '새 비밀번호는 8자 이상이어야 합니다.');
  await db('users').where({ id: req.user.id }).update({ password_hash: await hashPassword(next) });
  res.json({ ok: true });
}));

// 화면 언어 저장
authRouter.post('/lang', requireLogin, ah(async (req, res) => {
  const lang = String(req.body?.lang || '');
  if (!['ko', 'vi', 'en'].includes(lang)) throw new HttpError(400, '지원하지 않는 언어입니다.');
  await db('users').where({ id: req.user.id }).update({ lang });
  res.json({ ok: true });
}));
