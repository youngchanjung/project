import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { config } from './config.js';

// 지금은 프로그램 자체 계정(아이디/비밀번호)으로 로그인합니다.
// M365(Entra ID) 연동 시 이 파일에 OIDC 로그인 경로를 추가하고 users.email 로 계정을 연결합니다.

const COOKIE = 'sid';

export const hashPassword = pw => bcrypt.hash(pw, 10);
export const checkPassword = (pw, hash) => !!hash && bcrypt.compare(pw, hash);

export function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, config.sessionSecret, { expiresIn: `${config.sessionDays}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.secureCookie,
    maxAge: config.sessionDays * 864e5
  });
}
export const clearSession = res => res.clearCookie(COOKIE);

export const publicUser = u => u && ({ id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, active: !!u.active });

export async function loadUser(req, _res, next) {
  const tok = req.cookies?.[COOKIE];
  if (tok) {
    try {
      const { uid } = jwt.verify(tok, config.sessionSecret);
      const u = await db('users').where({ id: uid }).first();
      if (u && u.active) req.user = u;
    } catch {}
  }
  next();
}

export function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자만 할 수 있습니다.' });
  next();
}

// 프로젝트 내 역할: admin 은 모든 프로젝트에서 pm 과 같음. 비참여자는 조회만.
export async function projectRole(user, projectId) {
  if (!user) return null;
  if (user.role === 'admin') return 'pm';
  const m = await db('project_members').where({ project_id: projectId, user_id: user.id }).first();
  return m ? m.role : 'viewer';
}
const RANK = { viewer: 0, member: 1, pm: 2 };
export const canEdit = (role, need = 'member') => RANK[role] >= RANK[need];
