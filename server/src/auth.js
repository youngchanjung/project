import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { config } from './config.js';

// 지금은 프로그램 자체 계정(아이디/비밀번호)으로 로그인합니다.
// M365(Entra ID) 연동 시: routes/auth.js 에 OIDC 로그인 경로를 추가하고, 로그인한 회사 계정을
// users.email(또는 users.external_id)로 기존 계정에 연결한 뒤 setSession() 을 그대로 호출합니다.
// 세션·권한 확인(loadUser, requireLogin, requireAdmin, projectRole)은 로그인 방식과 무관하게 그대로 씁니다.

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

export const publicUser = u => u && ({
  id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, active: !!u.active,
  department_id: u.department_id ?? null, employee_no: u.employee_no ?? null, position: u.position ?? null,
  phone: u.phone ?? null, weekly_hours: u.weekly_hours ?? 40, external: !!u.external, lang: u.lang ?? null, auth_provider: u.auth_provider || 'local', last_login_at: u.last_login_at ?? null
});

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

// 부서별로 볼 수 있는 카테고리. 내 부서에 정해져 있지 않으면 상위 부서를 따르고, 끝까지 없으면 전부(null)
// 관리자는 항상 전부. 참여 중인 프로젝트는 카테고리와 상관없이 볼 수 있음
export async function allowedCategories(user) {
  if (!user || user.role === 'admin' || !user.department_id) return null;
  if (user._cats !== undefined) return user._cats;
  const all = await db('departments').select('id', 'parent_id', 'categories');
  const byId = new Map(all.map(d => [d.id, d]));
  let cats = null;
  for (let d = byId.get(user.department_id), n = 0; d && n < 100; d = byId.get(d.parent_id), n++) {
    if (d.categories) { cats = new Set(String(d.categories).split(',').map(x => x.trim()).filter(Boolean)); break; }
  }
  user._cats = cats;
  return cats;
}
// 목록 필터: 참여 중이거나 볼 수 있는 카테고리의 프로젝트만
export async function visibleProjects(user, projects) {
  if (!user || user.role === 'admin') return projects;
  const cats = user.external ? new Set() : await allowedCategories(user);
  if (!cats) return projects;
  const mem = new Set((await db('project_members').where({ user_id: user.id })).map(m => m.project_id));
  return projects.filter(p => mem.has(p.id) || cats.has(p.category));
}

// 프로젝트 내 역할: admin 은 모든 프로젝트에서 pm 과 같음. 비참여자는 조회만.
export async function projectRole(user, projectId) {
  if (!user) return null;
  if (user.role === 'admin') return 'pm';
  const m = await db('project_members').where({ project_id: projectId, user_id: user.id }).first();
  if (user.external) return m ? m.role : null; // 외부 협력자는 참여 프로젝트만
  if (m) return m.role;
  const cats = await allowedCategories(user);
  if (cats) {
    const p = await db('projects').where({ id: projectId }).select('category').first();
    if (p && !cats.has(p.category)) return null; // 부서에서 볼 수 없는 카테고리
  }
  return 'viewer';
}
const RANK = { viewer: 0, member: 1, pm: 2 };
export const canEdit = (role, need = 'member') => !!role && RANK[role] >= RANK[need];
