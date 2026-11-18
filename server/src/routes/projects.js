import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError, now, audit, insertId, pick, diff, holidaySet } from '../util.js';
import { requireLogin, projectRole, canEdit, publicUser } from '../auth.js';
import { stateOf } from '../schedule.js';

export const projectsRouter = Router();
projectsRouter.use(requireLogin);

const today = () => new Date().toISOString().slice(0, 10);
const PCOLS = ['code', 'name', 'description', 'client', 'status', 'calendars', 'day_basis'];

export async function loadProject(id) {
  const p = await db('projects').where({ id }).first();
  if (!p) throw new HttpError(404, '프로젝트가 없습니다.');
  return p;
}
export async function need(req, projectId, level = 'member') {
  const role = await projectRole(req.user, projectId);
  if (!canEdit(role, level)) throw new HttpError(403, level === 'pm' ? 'PM 또는 관리자만 할 수 있습니다.' : '이 프로젝트의 참여자만 수정할 수 있습니다.');
  return role;
}

// 프로젝트 목록 + 현황 요약
projectsRouter.get('/', ah(async (req, res) => {
  const t = today();
  const ps = await db('projects').orderBy([{ column: 'archived' }, { column: 'name' }]);
  const tasks = await db('tasks').select('project_id', 'name', 'start', 'end', 'status', 'actual_end', 'is_key', 'assignee_id');
  const issues = await db('issues').select('project_id', 'status', 'resolved', 'target', 'priority');
  const mem = await db('project_members').where({ user_id: req.user.id });
  const pms = await db('project_members as m').join('users as u', 'u.id', 'm.user_id').where('m.role', 'pm').select('m.project_id', 'u.name');
  const out = ps.map(p => {
    const ts = tasks.filter(x => x.project_id === p.id);
    const st = ts.map(x => stateOf(x, t));
    const is = issues.filter(x => x.project_id === p.id && x.status !== '해결완료' && !x.resolved);
    const nextKey = ts.filter(x => x.is_key && stateOf(x, t) !== '완료' && x.start >= t).sort((a, b) => a.start.localeCompare(b.start))[0];
    const span = ts.length ? [ts.reduce((a, x) => x.start < a ? x.start : a, '9999'), ts.reduce((a, x) => x.end > a ? x.end : a, '0000')] : [null, null];
    return {
      ...p, archived: !!p.archived,
      myRole: req.user.role === 'admin' ? 'pm' : (mem.find(m => m.project_id === p.id)?.role || 'viewer'),
      member: !!mem.find(m => m.project_id === p.id),
      pms: pms.filter(x => x.project_id === p.id).map(x => x.name),
      stats: {
        tasks: ts.length, done: st.filter(s => s === '완료').length, late: st.filter(s => s === '지연').length,
        active: st.filter(s => s === '진행중').length, openIssues: is.length,
        lateIssues: is.filter(i => i.target && i.target < t).length,
        start: span[0], end: span[1], nextKey: nextKey ? { name: nextKey.name, date: nextKey.start } : null
      }
    };
  });
  res.json(out);
}));

projectsRouter.post('/', ah(async (req, res) => {
  const body = pick(req.body || {}, PCOLS);
  if (!body.name?.trim()) throw new HttpError(400, '프로젝트 이름을 입력하세요.');
  const id = await db.transaction(async trx => {
    const id = await insertId(trx, 'projects', { ...body, name: body.name.trim(), created_at: now(), updated_at: now() });
    await trx('project_members').insert({ project_id: id, user_id: req.user.id, role: 'pm' });
    const phases = Array.isArray(req.body.phases) ? req.body.phases : [];
    for (const [i, name] of phases.entries()) if (name) await trx('phases').insert({ project_id: id, name, sort: i });
    await audit(trx, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'create', label: body.name });
    return id;
  });
  res.json(await loadProject(id));
}));

// 프로젝트 전체 데이터 (화면에서 한 번에 받아 씀)
projectsRouter.get('/:id/data', ah(async (req, res) => {
  const id = Number(req.params.id);
  const project = await loadProject(id);
  const [phases, tasks, deps, issues, members, role, hol] = await Promise.all([
    db('phases').where({ project_id: id }).orderBy('sort'),
    db('tasks').where({ project_id: id }).orderBy([{ column: 'sort' }, { column: 'start' }]),
    db('dependencies').where({ project_id: id }),
    db('issues').where({ project_id: id }).orderBy('code'),
    db('project_members as m').join('users as u', 'u.id', 'm.user_id').where('m.project_id', id).select('u.id', 'u.name', 'u.username', 'u.email', 'm.role'),
    projectRole(req.user, id),
    db('holidays').whereIn('country', String(project.calendars || 'KR').split(',')).orderBy('date')
  ]);
  res.json({
    project: { ...project, archived: !!project.archived }, phases,
    tasks: tasks.map(t => ({ ...t, is_key: !!t.is_key })), deps, issues, members, role, holidays: hol
  });
}));

projectsRouter.patch('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id, 'pm');
  const before = await loadProject(id);
  const up = pick(req.body || {}, [...PCOLS, 'archived']);
  if (up.name !== undefined && !String(up.name).trim()) throw new HttpError(400, '프로젝트 이름은 비울 수 없습니다.');
  if (up.archived !== undefined) up.archived = !!up.archived;
  await db('projects').where({ id }).update({ ...up, updated_at: now() });
  await audit(null, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'update', label: before.name, changes: diff(before, up) });
  res.json(await loadProject(id));
}));

projectsRouter.delete('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'admin') throw new HttpError(403, '프로젝트 삭제는 관리자만 할 수 있습니다. (보관 처리는 PM도 가능)');
  const p = await loadProject(id);
  await db.transaction(async trx => {
    for (const t of ['issue_comments']) await trx(t).whereIn('issue_id', trx('issues').select('id').where({ project_id: id })).del();
    for (const t of ['dependencies', 'issues', 'tasks', 'phases', 'project_members']) await trx(t).where({ project_id: id }).del();
    await trx('projects').where({ id }).del();
    await audit(trx, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'delete', label: p.name });
  });
  res.json({ ok: true });
}));

// ---- 참여자 ----
projectsRouter.put('/:id/members/:uid', ah(async (req, res) => {
  const id = Number(req.params.id), uid = Number(req.params.uid);
  await need(req, id, 'pm');
  const role = ['pm', 'member', 'viewer'].includes(req.body?.role) ? req.body.role : 'member';
  const u = await db('users').where({ id: uid }).first();
  if (!u) throw new HttpError(404, '사용자가 없습니다.');
  const ex = await db('project_members').where({ project_id: id, user_id: uid }).first();
  if (ex) await db('project_members').where({ project_id: id, user_id: uid }).update({ role });
  else await db('project_members').insert({ project_id: id, user_id: uid, role });
  await audit(null, { user: req.user, projectId: id, entity: 'member', entityId: uid, action: ex ? 'update' : 'create', label: `${u.name} → ${role}` });
  res.json({ ok: true });
}));
projectsRouter.delete('/:id/members/:uid', ah(async (req, res) => {
  const id = Number(req.params.id), uid = Number(req.params.uid);
  await need(req, id, 'pm');
  const u = await db('users').where({ id: uid }).first();
  await db('project_members').where({ project_id: id, user_id: uid }).del();
  await audit(null, { user: req.user, projectId: id, entity: 'member', entityId: uid, action: 'delete', label: u?.name });
  res.json({ ok: true });
}));

// ---- 단계 ----
projectsRouter.post('/:id/phases', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id, 'pm');
  if (!req.body?.name?.trim()) throw new HttpError(400, '단계 이름을 입력하세요.');
  const { m } = await db('phases').where({ project_id: id }).max({ m: 'sort' }).first();
  const pid = await insertId(db, 'phases', { project_id: id, name: req.body.name.trim(), color: req.body.color || null, sort: (m ?? -1) + 1 });
  await audit(null, { user: req.user, projectId: id, entity: 'phase', entityId: pid, action: 'create', label: req.body.name });
  res.json(await db('phases').where({ id: pid }).first());
}));
projectsRouter.patch('/:id/phases/:pid', ah(async (req, res) => {
  const id = Number(req.params.id), pid = Number(req.params.pid);
  await need(req, id, 'pm');
  const up = pick(req.body || {}, ['name', 'color', 'sort']);
  await db('phases').where({ id: pid, project_id: id }).update(up);
  res.json(await db('phases').where({ id: pid }).first());
}));
projectsRouter.delete('/:id/phases/:pid', ah(async (req, res) => {
  const id = Number(req.params.id), pid = Number(req.params.pid);
  await need(req, id, 'pm');
  const ph = await db('phases').where({ id: pid, project_id: id }).first();
  await db('tasks').where({ phase_id: pid }).update({ phase_id: null });
  await db('phases').where({ id: pid }).del();
  await audit(null, { user: req.user, projectId: id, entity: 'phase', entityId: pid, action: 'delete', label: ph?.name });
  res.json({ ok: true });
}));

// ---- 기준 일정 확정: 현재 시작/종료를 기준 일정으로 저장 ----
projectsRouter.post('/:id/baseline', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id, 'pm');
  const onlyMissing = !!req.body?.onlyMissing;
  const q = db('tasks').where({ project_id: id });
  if (onlyMissing) q.whereNull('baseline_end');
  const n = await q.update({ baseline_start: db.ref('start'), baseline_end: db.ref('end') });
  await audit(null, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'baseline', label: `기준 일정 확정 (${n}건)` });
  res.json({ updated: n });
}));

// ---- 변경 이력 ----
projectsRouter.get('/:id/audit', ah(async (req, res) => {
  const id = Number(req.params.id);
  const q = db('audit_log').where({ project_id: id }).orderBy('id', 'desc').limit(Math.min(Number(req.query.limit) || 200, 1000));
  if (req.query.entity) q.andWhere({ entity: req.query.entity, entity_id: Number(req.query.entityId) });
  const rows = await q;
  res.json(rows.map(r => ({ ...r, changes: r.changes ? JSON.parse(r.changes) : null })));
}));

export { holidaySet, publicUser };
