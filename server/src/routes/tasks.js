import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError, now, audit, insertId, pick, diff, optDate, projectCalendar } from '../util.js';
import { requireLogin } from '../auth.js';
import { recalc, wouldCycle } from '../schedule.js';
import { need, loadProject } from './projects.js';
import { notify, recipientsOf } from '../notify.js';

export const tasksRouter = Router({ mergeParams: true });
tasksRouter.use(requireLogin);

export const TASK_TYPES = ['작업', '마일스톤', '제출', '지급', '검토', '홀드포인트', '회의'];
export const TASK_STATUS = ['미착수', '진행중', '완료', '보류'];
const COLS = ['phase_id', 'code', 'name', 'name_en', 'type', 'owner', 'assignee_id', 'start', 'end',
  'baseline_start', 'baseline_end', 'actual_end', 'not_before', 'status', 'progress', 'is_key', 'ref', 'note', 'sort'];

function clean(body, partial) {
  const t = pick(body || {}, COLS);
  for (const f of ['start', 'end', 'baseline_start', 'baseline_end', 'actual_end', 'not_before']) {
    if (t[f] !== undefined) t[f] = optDate(t[f], f);
  }
  if (!partial || t.name !== undefined) {
    if (!String(t.name || '').trim()) throw new HttpError(400, '작업명을 입력하세요.');
    t.name = String(t.name).trim();
  }
  if (!partial) {
    if (!t.start) throw new HttpError(400, '시작일을 입력하세요.');
    if (!t.end) t.end = t.start;
  }
  if (t.type !== undefined && !TASK_TYPES.includes(t.type)) throw new HttpError(400, `유형은 ${TASK_TYPES.join('/')} 중 하나입니다.`);
  if (t.status !== undefined && !TASK_STATUS.includes(t.status)) throw new HttpError(400, `상태는 ${TASK_STATUS.join('/')} 중 하나입니다.`);
  if (t.is_key !== undefined) t.is_key = !!t.is_key;
  if (t.progress !== undefined) t.progress = Math.max(0, Math.min(100, Number(t.progress) || 0));
  for (const f of ['phase_id', 'assignee_id']) if (t[f] !== undefined) t[f] = t[f] ? Number(t[f]) : null;
  return t;
}

// 프로젝트 전체 재계산 후 바뀐 작업을 저장. 바뀐 목록 반환
export async function applyRecalc(trx, projectId, user) {
  const p = await trx('projects').where({ id: projectId }).first();
  const hol = await projectCalendar(trx, p);
  const tasks = await trx('tasks').where({ project_id: projectId });
  const deps = await trx('dependencies').where({ project_id: projectId });
  const changed = recalc(tasks, deps, hol);
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const c of changed) {
    const before = byId.get(c.id);
    await trx('tasks').where({ id: c.id }).update({ start: c.start, end: c.end, version: before.version + 1, updated_at: now(), updated_by: user?.id ?? null });
    await audit(trx, { user, projectId, entity: 'task', entityId: c.id, action: 'auto', label: `${before.name} (선행작업에 따라 자동 조정)`, changes: { start: [before.start, c.start], end: [before.end, c.end] } });
    await notify(trx, await recipientsOf(trx, before), { kind: 'task_changed', projectId, entity: 'task', entityId: c.id, actorId: user?.id,
      params: { name: before.name, code: before.code, from: `${before.start}~${before.end}`, to: `${c.start}~${c.end}`, by: user?.name, auto: true } });
  }
  return changed;
}

async function checkRefs(trx, projectId, t) {
  if (t.phase_id && !(await trx('phases').where({ id: t.phase_id, project_id: projectId }).first())) throw new HttpError(400, '단계가 이 프로젝트에 없습니다.');
  if (t.assignee_id && !(await trx('users').where({ id: t.assignee_id }).first())) throw new HttpError(400, '담당자 계정이 없습니다.');
  if (t.start && t.end && t.end < t.start) throw new HttpError(400, '종료일이 시작일보다 빠릅니다.');
}

tasksRouter.post('/', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await loadProject(pid);
  await need(req, pid);
  const t = clean(req.body, false);
  const result = await db.transaction(async trx => {
    await checkRefs(trx, pid, t);
    if (t.sort === undefined) { const { m } = await trx('tasks').where({ project_id: pid }).max({ m: 'sort' }).first(); t.sort = (m ?? 0) + 1; }
    const id = await insertId(trx, 'tasks', { ...t, project_id: pid, updated_at: now(), updated_by: req.user.id });
    await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: id, action: 'create', label: t.name });
    await notify(trx, await recipientsOf(trx, t), { kind: 'task_assigned', projectId: pid, entity: 'task', entityId: id, actorId: req.user.id, params: { name: t.name, code: t.code, by: req.user.name } });
    return { id };
  });
  res.json({ task: await db('tasks').where({ id: result.id }).first(), shifted: [] });
}));

tasksRouter.patch('/:tid', ah(async (req, res) => {
  const pid = Number(req.params.pid), tid = Number(req.params.tid);
  await need(req, pid);
  const up = clean(req.body, true);
  const shifted = await db.transaction(async trx => {
    const before = await trx('tasks').where({ id: tid, project_id: pid }).first();
    if (!before) throw new HttpError(404, '작업이 없습니다.');
    // 동시 수정 방지: 화면에서 받은 version 과 다르면 거절
    if (req.body.version !== undefined && Number(req.body.version) !== before.version) {
      throw new HttpError(409, '다른 사람이 먼저 이 작업을 수정했습니다. 새로고침 후 다시 시도하세요.', { current: before });
    }
    if (up.status === '완료' && !before.actual_end && up.actual_end === undefined) up.actual_end = new Date().toISOString().slice(0, 10);
    if (up.status && up.status !== '완료' && before.status === '완료' && up.actual_end === undefined) up.actual_end = null;
    if (up.status === '완료' && up.progress === undefined) up.progress = 100;
    await checkRefs(trx, pid, { ...before, ...up });
    const ch = diff(before, up);
    if (!Object.keys(ch).length) return [];
    await trx('tasks').where({ id: tid }).update({ ...up, version: before.version + 1, updated_at: now(), updated_by: req.user.id });
    await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: tid, action: 'update', label: up.name || before.name, changes: ch });
    const after = { ...before, ...up };
    const oldR = new Set(await recipientsOf(trx, before)), newR = await recipientsOf(trx, after);
    const base = { projectId: pid, entity: 'task', entityId: tid, actorId: req.user.id };
    await notify(trx, newR.filter(u => !oldR.has(u)), { ...base, kind: 'task_assigned', params: { name: after.name, code: after.code, by: req.user.name } });
    if (ch.start || ch.end) await notify(trx, newR.filter(u => oldR.has(u)), { ...base, kind: 'task_changed', params: { name: after.name, code: after.code, from: `${before.start}~${before.end}`, to: `${after.start}~${after.end}`, by: req.user.name } });
    if (ch.start || ch.end || ch.status || ch.not_before) return applyRecalc(trx, pid, req.user);
    return [];
  });
  res.json({ task: await db('tasks').where({ id: tid }).first(), shifted });
}));

tasksRouter.delete('/:tid', ah(async (req, res) => {
  const pid = Number(req.params.pid), tid = Number(req.params.tid);
  await need(req, pid);
  await db.transaction(async trx => {
    const t = await trx('tasks').where({ id: tid, project_id: pid }).first();
    if (!t) throw new HttpError(404, '작업이 없습니다.');
    await trx('dependencies').where('pred_id', tid).orWhere('succ_id', tid).del();
    await trx('issues').where({ task_id: tid }).update({ task_id: null });
    await trx('tasks').where({ id: tid }).del();
    await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: tid, action: 'delete', label: t.name, changes: { start: [t.start, null], end: [t.end, null] } });
  });
  res.json({ ok: true });
}));

// ---- 선행관계 ----
export const depsRouter = Router({ mergeParams: true });
depsRouter.use(requireLogin);
depsRouter.post('/', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const pred_id = Number(req.body?.pred_id), succ_id = Number(req.body?.succ_id);
  const kind = ['FS', 'SS', 'FF'].includes(req.body?.kind) ? req.body.kind : 'FS';
  const lag = Math.round(Number(req.body?.lag) || 0);
  const out = await db.transaction(async trx => {
    const ts = await trx('tasks').whereIn('id', [pred_id, succ_id]).andWhere({ project_id: pid });
    if (ts.length !== 2) throw new HttpError(400, '같은 프로젝트의 서로 다른 두 작업을 고르세요.');
    const deps = await trx('dependencies').where({ project_id: pid });
    if (wouldCycle(deps, pred_id, succ_id)) throw new HttpError(400, '순환 관계가 됩니다. (서로가 서로의 선행작업)');
    if (deps.find(d => d.pred_id === pred_id && d.succ_id === succ_id && d.kind === kind)) throw new HttpError(400, '이미 있는 관계입니다.');
    const id = await insertId(trx, 'dependencies', { project_id: pid, pred_id, succ_id, kind, lag });
    const p = ts.find(t => t.id === pred_id), s = ts.find(t => t.id === succ_id);
    await audit(trx, { user: req.user, projectId: pid, entity: 'dependency', entityId: id, action: 'create', label: `${p.name} → ${s.name} (${kind}${lag ? ` ${lag > 0 ? '+' : ''}${lag}일` : ''})` });
    const shifted = await applyRecalc(trx, pid, req.user);
    return { dep: await trx('dependencies').where({ id }).first(), shifted };
  });
  res.json(out);
}));
depsRouter.patch('/:did', ah(async (req, res) => {
  const pid = Number(req.params.pid), did = Number(req.params.did);
  await need(req, pid);
  const out = await db.transaction(async trx => {
    const d = await trx('dependencies').where({ id: did, project_id: pid }).first();
    if (!d) throw new HttpError(404, '관계가 없습니다.');
    const up = {};
    if (['FS', 'SS', 'FF'].includes(req.body?.kind)) up.kind = req.body.kind;
    if (req.body?.lag !== undefined) up.lag = Math.round(Number(req.body.lag) || 0);
    await trx('dependencies').where({ id: did }).update(up);
    await audit(trx, { user: req.user, projectId: pid, entity: 'dependency', entityId: did, action: 'update', changes: diff(d, up) });
    return { shifted: await applyRecalc(trx, pid, req.user) };
  });
  res.json(out);
}));
depsRouter.delete('/:did', ah(async (req, res) => {
  const pid = Number(req.params.pid), did = Number(req.params.did);
  await need(req, pid);
  await db('dependencies').where({ id: did, project_id: pid }).del();
  await audit(null, { user: req.user, projectId: pid, entity: 'dependency', entityId: did, action: 'delete' });
  res.json({ ok: true });
}));
