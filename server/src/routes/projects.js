import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError, now, audit, insertId, pick, diff, holidaySet, optDate } from '../util.js';
import { requireLogin, projectRole, canEdit, publicUser } from '../auth.js';
import { normCalendars } from '../countries.js';
import { stateOf } from '../schedule.js';
import { insertDefaultColumns } from '../migrations.js';
import { TASK_STATUS } from './tasks.js';

export const projectsRouter = Router();
projectsRouter.use(requireLogin);

const today = () => new Date().toISOString().slice(0, 10);
const PCOLS = ['code', 'name', 'description', 'client', 'status', 'calendars', 'day_basis', 'category', 'agreement_start', 'agreement_end', 'partners'];
export const CATEGORIES = ['research', 'construction', 'design'];
function cleanAgreement(b) {
  for (const f of ['agreement_start', 'agreement_end']) if (b[f] !== undefined) b[f] = optDate(b[f], f);
  if (b.agreement_start && b.agreement_end && b.agreement_end < b.agreement_start) throw new HttpError(400, '협약 종료일이 시작일보다 빠릅니다.');
}
// 카테고리별 예시 일정 (새 프로젝트 만들 때 "예시 넣기")
const mid = (a, b) => { const x = new Date(a + 'T00:00:00Z'), y = new Date(b + 'T00:00:00Z'); return new Date((x.getTime() + y.getTime()) / 2).toISOString().slice(0, 10); };
export function templateTasks(category, p) {
  if (category === 'research') {
    const s = p.agreement_start, e = p.agreement_end;
    const at = d => (d ? { start: d, end: d, undated: false } : { start: now().slice(0, 10), end: now().slice(0, 10), undated: true });
    return [
      { name: '착수 회의', type: '회의', ...at(s) },
      { name: '중간 보고서 제출', type: '마일스톤', is_key: true, ...at(s && e ? mid(s, e) : null) },
      { name: '최종 보고서 제출', type: '마일스톤', is_key: true, ...at(e) },
      { name: '결과 평가', type: '마일스톤', is_key: true, ...at(e) }
    ];
  }
  return [];
}
const checkCategory = c => { if (c !== undefined && !CATEGORIES.includes(c)) throw new HttpError(400, '카테고리는 연구·시공·설계 중 하나입니다.'); };

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
  const tasks = await db('tasks').select('project_id', 'name', 'start', 'end', 'status', 'actual_end', 'is_key', 'assignee_id', 'undated');
  const issues = await db('issues').select('project_id', 'status', 'resolved', 'target', 'priority');
  const mem = await db('project_members').where({ user_id: req.user.id });
  const pms = await db('project_members as m').join('users as u', 'u.id', 'm.user_id').where('m.role', 'pm').select('m.project_id', 'u.name');
  const out = ps.map(p => {
    const ts = tasks.filter(x => x.project_id === p.id);
    const st = ts.map(x => stateOf(x, t));
    const is = issues.filter(x => x.project_id === p.id && x.status !== '해결완료' && !x.resolved);
    const nextKey = ts.filter(x => x.is_key && !x.undated && stateOf(x, t) !== '완료' && x.start >= t).sort((a, b) => a.start.localeCompare(b.start))[0];
    const dated = ts.filter(x => !x.undated);
    const span = dated.length ? [dated.reduce((a, x) => x.start < a ? x.start : a, '9999'), dated.reduce((a, x) => x.end > a ? x.end : a, '0000')] : [null, null];
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
  body.calendars = normCalendars(body.calendars);
  if (!body.name?.trim()) throw new HttpError(400, '프로젝트 이름을 입력하세요.');
  if (!body.category) body.category = 'construction';
  checkCategory(body.category);
  cleanAgreement(body);
  const id = await db.transaction(async trx => {
    const id = await insertId(trx, 'projects', { ...body, name: body.name.trim(), created_at: now(), updated_at: now() });
    await trx('project_members').insert({ project_id: id, user_id: req.user.id, role: 'pm' });
    const phases = Array.isArray(req.body.phases) ? req.body.phases : [];
    for (const [i, name] of phases.entries()) if (name) await trx('phases').insert({ project_id: id, name, sort: i });
    await insertDefaultColumns(trx, id);
    if (req.body.template) {
      for (const [i, t] of templateTasks(body.category, body).entries()) {
        await trx('tasks').insert({ ...t, project_id: id, sort: i + 1, status: '미착수', created_at: now(), updated_at: now(), updated_by: req.user.id });
      }
    }
    await audit(trx, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'create', label: body.name });
    return id;
  });
  res.json(await loadProject(id));
}));

// 프로젝트 전체 데이터 (화면에서 한 번에 받아 씀)
projectsRouter.get('/:id/data', ah(async (req, res) => {
  const id = Number(req.params.id);
  const project = await loadProject(id);
  const [phases, tasks, deps, issues, members, role, hol, columns, checklist] = await Promise.all([
    db('phases').where({ project_id: id }).orderBy('sort'),
    db('tasks').where({ project_id: id }).orderBy([{ column: 'sort' }, { column: 'start' }]),
    db('dependencies').where({ project_id: id }),
    db('issues').where({ project_id: id }).orderBy('code'),
    db('project_members as m').join('users as u', 'u.id', 'm.user_id').where('m.project_id', id).select('u.id', 'u.name', 'u.username', 'u.email', 'm.role'),
    projectRole(req.user, id),
    db('holidays').whereIn('country', String(project.calendars || 'KR').split(',')).orderBy('date'),
    db('board_columns').where({ project_id: id }).orderBy('sort'),
    db('task_checklist').whereIn('task_id', db('tasks').select('id').where({ project_id: id })).orderBy([{ column: 'task_id' }, { column: 'sort' }])
  ]);
  res.json({
    project: { ...project, archived: !!project.archived }, phases,
    tasks: tasks.map(t => ({ ...t, is_key: !!t.is_key, undated: !!t.undated })), deps, issues, members, role, holidays: hol,
    columns: columns.map(c => ({ ...c, is_review: !!c.is_review })), checklist: checklist.map(c => ({ ...c, done: !!c.done }))
  });
}));

projectsRouter.patch('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id, 'pm');
  const before = await loadProject(id);
  const up = pick(req.body || {}, [...PCOLS, 'archived']);
  if (up.calendars !== undefined) up.calendars = normCalendars(up.calendars);
  if (up.name !== undefined && !String(up.name).trim()) throw new HttpError(400, '프로젝트 이름은 비울 수 없습니다.');
  if (up.archived !== undefined) up.archived = !!up.archived;
  checkCategory(up.category);
  cleanAgreement(up);
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
    await trx('task_checklist').whereIn('task_id', trx('tasks').select('id').where({ project_id: id })).del();
    for (const t of ['meetings', 'dependencies', 'issues', 'tasks', 'board_columns', 'phases', 'project_members']) await trx(t).where({ project_id: id }).del();
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

// ---- 칸반 열 ----
function cleanColumn(b, partial) {
  const c = pick(b || {}, ['name', 'color', 'status', 'is_review', 'sort']);
  if (!partial || c.name !== undefined) {
    c.name = String(c.name || '').trim();
    if (!c.name) throw new HttpError(400, '열 이름을 입력하세요.');
  }
  if (c.status !== undefined && !TASK_STATUS.includes(c.status)) throw new HttpError(400, `상태는 ${TASK_STATUS.join('/')} 중 하나입니다.`);
  if (c.is_review !== undefined) c.is_review = !!c.is_review;
  return c;
}
projectsRouter.post('/:id/columns', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id, 'pm');
  const c = cleanColumn(req.body, false);
  const { m } = await db('board_columns').where({ project_id: id }).max({ m: 'sort' }).first();
  const cid = await insertId(db, 'board_columns', { status: '진행중', ...c, project_id: id, sort: (m ?? -1) + 1 });
  await audit(null, { user: req.user, projectId: id, entity: 'column', entityId: cid, action: 'create', label: c.name });
  res.json(await db('board_columns').where({ id: cid }).first());
}));
projectsRouter.patch('/:id/columns/:cid', ah(async (req, res) => {
  const id = Number(req.params.id), cid = Number(req.params.cid);
  await need(req, id, 'pm');
  const before = await db('board_columns').where({ id: cid, project_id: id }).first();
  if (!before) throw new HttpError(404, '열이 없습니다.');
  const up = cleanColumn(req.body, true);
  await db('board_columns').where({ id: cid }).update(up);
  await audit(null, { user: req.user, projectId: id, entity: 'column', entityId: cid, action: 'update', label: up.name || before.name, changes: diff(before, up) });
  res.json(await db('board_columns').where({ id: cid }).first());
}));
// 열 순서 바꾸기: { ids: [열 id 순서대로] }
projectsRouter.put('/:id/columns-order', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id, 'pm');
  const ids = (req.body?.ids || []).map(Number);
  await db.transaction(async trx => {
    for (const [i, cid] of ids.entries()) await trx('board_columns').where({ id: cid, project_id: id }).update({ sort: i });
  });
  res.json({ ok: true });
}));
projectsRouter.delete('/:id/columns/:cid', ah(async (req, res) => {
  const id = Number(req.params.id), cid = Number(req.params.cid);
  await need(req, id, 'pm');
  const cols = await db('board_columns').where({ project_id: id });
  const c = cols.find(x => x.id === cid);
  if (!c) throw new HttpError(404, '열이 없습니다.');
  if (cols.length <= 1) throw new HttpError(400, '열은 하나 이상 있어야 합니다.');
  // 이 열의 카드는 상태가 같은 다른 열(없으면 첫 열)로 자동 배치됨
  await db('tasks').where({ board_column_id: cid }).update({ board_column_id: null });
  await db('board_columns').where({ id: cid }).del();
  await audit(null, { user: req.user, projectId: id, entity: 'column', entityId: cid, action: 'delete', label: c.name });
  res.json({ ok: true });
}));

// ---- 기준 일정 확정: 현재 시작/종료를 기준 일정으로 저장 ----
projectsRouter.post('/:id/baseline', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id, 'pm');
  const onlyMissing = !!req.body?.onlyMissing;
  const q = db('tasks').where({ project_id: id, undated: false });
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
