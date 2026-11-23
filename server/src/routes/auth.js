import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError, now, insertId } from '../util.js';
import { checkPassword, hashPassword, setSession, clearSession, publicUser, requireLogin } from '../auth.js';

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
  u.last_login_at = now();
  await db('users').where({ id: u.id }).update({ last_login_at: u.last_login_at });
  setSession(res, u);
  res.json({ user: publicUser(u) });
}));
authRouter.post('/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });
authRouter.get('/me', (req, res) => res.json({ user: publicUser(req.user) || null }));

authRouter.post('/password', requireLogin, ah(async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await checkPassword(String(current || ''), req.user.password_hash))) throw new HttpError(400, '현재 비밀번호가 맞지 않습니다.');
  if (!next || next.length < 8) throw new HttpError(400, '새 비밀번호는 8자 이상이어야 합니다.');
  await db('users').where({ id: req.user.id }).update({ password_hash: await hashPassword(next) });
  res.json({ ok: true });
}));
