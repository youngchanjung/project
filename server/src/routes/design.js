// 설계 2·3순위: 투입 시간 기록, 휴가·부재, 인건비 예측
import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError, now, audit, insertId, isDate } from '../util.js';
import { requireLogin, requireAdmin } from '../auth.js';
import { need, loadProject } from './projects.js';

const ymd = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const r1 = x => Math.round(x * 10) / 10;

// ---- 투입 시간 기록: /api/projects/:pid/time ----
export const timeRouter = Router({ mergeParams: true });
timeRouter.use(requireLogin);

// 목록 (from~to, 기본 전체). 외부 협력자는 자기 기록만
timeRouter.get('/', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await loadProject(pid);
  const q = db('time_entries as e').leftJoin('users as u', 'u.id', 'e.user_id').leftJoin('tasks as t', 't.id', 'e.task_id')
    .where('e.project_id', pid).select('e.*', 'u.name as user_name', 't.name as task_name', 't.phase_id').orderBy([{ column: 'e.date', order: 'desc' }, { column: 'e.id', order: 'desc' }]);
  if (isDate(req.query.from)) q.where('e.date', '>=', req.query.from);
  if (isDate(req.query.to)) q.where('e.date', '<=', req.query.to);
  if (req.query.task) q.where('e.task_id', Number(req.query.task));
  if (req.user.external) q.where('e.user_id', req.user.id);
  res.json(await q);
}));

timeRouter.post('/', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const b = req.body || {};
  const hours = Number(b.hours);
  if (!(hours > 0 && hours <= 24)) throw new HttpError(400, '시간은 0보다 크고 24 이하로 입력하세요.');
  const date = b.date || ymd();
  if (!isDate(date)) throw new HttpError(400, '날짜 형식(YYYY-MM-DD)이 아닙니다.');
  const task = b.task_id ? await db('tasks').where({ id: Number(b.task_id), project_id: pid }).first() : null;
  if (b.task_id && !task) throw new HttpError(400, '할 일이 이 프로젝트에 없습니다.');
  // 남의 시간은 PM·관리자만 대신 기록
  let uid = req.user.id;
  if (b.user_id && Number(b.user_id) !== req.user.id) { await need(req, pid, 'pm'); uid = Number(b.user_id); }
  if (req.user.external && task && task.assignee_id !== req.user.id) throw new HttpError(403, '외부 협력자는 자기 카드에만 시간을 기록할 수 있습니다.');
  const id = await insertId(db, 'time_entries', { project_id: pid, task_id: task?.id ?? null, user_id: uid, date, hours: r1(hours), note: String(b.note || '').slice(0, 300) || null, created_at: now() });
  await audit(null, { user: req.user, projectId: pid, entity: 'time', entityId: id, action: 'create', label: `${task?.name || ''} ${date} ${r1(hours)}h`.trim() });
  res.json(await db('time_entries').where({ id }).first());
}));

timeRouter.delete('/:eid', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  const e = await db('time_entries').where({ id: Number(req.params.eid), project_id: pid }).first();
  if (!e) throw new HttpError(404, '기록이 없습니다.');
  if (e.user_id !== req.user.id) await need(req, pid, 'pm');
  await db('time_entries').where({ id: e.id }).del();
  await audit(null, { user: req.user, projectId: pid, entity: 'time', entityId: e.id, action: 'delete', label: `${e.date} ${e.hours}h` });
  res.json({ ok: true });
}));

// ---- 인건비 예측: /api/projects/:pid/cost (관리자만) ----
//   쓴 비용 = 기록한 시간 × 단가, 남은 비용 = 끝나지 않은 할 일의 예상 시간 − 이미 쓴 시간(0 아래로는 안 내려감) × 담당자 단가
timeRouter.get('/cost', requireAdmin, ah(async (req, res) => {
  const pid = Number(req.params.pid);
  const p = await loadProject(pid);
  const [entries, tasks, users] = await Promise.all([
    db('time_entries').where({ project_id: pid }),
    db('tasks').where({ project_id: pid }).whereNot('type', '회의'),
    db('users').select('id', 'name', 'hourly_rate')
  ]);
  const rate = new Map(users.map(u => [u.id, Number(u.hourly_rate) || 0]));
  const uname = new Map(users.map(u => [u.id, u.name]));
  const usedByTask = new Map();
  for (const e of entries) if (e.task_id) usedByTask.set(e.task_id, (usedByTask.get(e.task_id) || 0) + e.hours);
  const per = new Map(); // user → { hours, cost, remainHours, remainCost }
  const row = uid => { if (!per.has(uid)) per.set(uid, { user_id: uid, name: uid ? uname.get(uid) || '?' : '', hours: 0, cost: 0, remainHours: 0, remainCost: 0, noRate: uid ? !rate.get(uid) : false }); return per.get(uid); };
  for (const e of entries) { const r = row(e.user_id); r.hours += e.hours; r.cost += e.hours * (rate.get(e.user_id) || 0); }
  for (const t of tasks) {
    if (t.status === '완료' || t.actual_end || !t.est_hours) continue;
    const left = Math.max(0, t.est_hours - (usedByTask.get(t.id) || 0));
    const r = row(t.assignee_id || 0); r.remainHours += left; r.remainCost += left * (rate.get(t.assignee_id) || 0);
  }
  const rows = [...per.values()].map(r => ({ ...r, hours: r1(r.hours), cost: Math.round(r.cost), remainHours: r1(r.remainHours), remainCost: Math.round(r.remainCost) }))
    .sort((a, b) => (b.cost + b.remainCost) - (a.cost + a.remainCost));
  const spent = rows.reduce((a, r) => a + r.cost, 0), remain = rows.reduce((a, r) => a + r.remainCost, 0);
  res.json({ fee: p.design_fee ?? null, spent, remain, forecast: spent + remain, rows });
}));

// ---- 휴가·부재: /api/leaves ----
export const LEAVE_KINDS = ['휴가', '반차', '출장', '교육', '기타'];
export const leavesRouter = Router();
leavesRouter.use(requireLogin);

leavesRouter.get('/', ah(async (req, res) => {
  const q = db('leaves as l').join('users as u', 'u.id', 'l.user_id').select('l.*', 'u.name as user_name').orderBy('l.start');
  if (isDate(req.query.from)) q.where('l.end', '>=', req.query.from);
  if (isDate(req.query.to)) q.where('l.start', '<=', req.query.to);
  if (req.query.users) q.whereIn('l.user_id', String(req.query.users).split(',').map(Number).filter(Boolean));
  if (req.user.external) q.where('l.user_id', req.user.id);
  res.json(await q);
}));

leavesRouter.post('/', ah(async (req, res) => {
  const b = req.body || {};
  const uid = b.user_id ? Number(b.user_id) : req.user.id;
  // 본인 것은 누구나, 다른 사람 것은 관리자 또는 그 사람과 같은 프로젝트의 PM
  if (uid !== req.user.id && req.user.role !== 'admin') {
    const pm = await db('project_members as a').join('project_members as b', 'a.project_id', 'b.project_id')
      .where({ 'a.user_id': req.user.id, 'a.role': 'pm', 'b.user_id': uid }).first();
    if (!pm) throw new HttpError(403, '다른 사람의 휴가는 관리자나 같은 프로젝트 PM만 등록할 수 있습니다.');
  }
  if (!(await db('users').where({ id: uid }).first())) throw new HttpError(400, '사용자가 없습니다.');
  const start = b.start, end = b.end || b.start;
  if (!isDate(start) || !isDate(end)) throw new HttpError(400, '날짜 형식(YYYY-MM-DD)이 아닙니다.');
  if (end < start) throw new HttpError(400, '종료일이 시작일보다 빠릅니다.');
  const kind = LEAVE_KINDS.includes(b.kind) ? b.kind : '휴가';
  if (kind === '반차' && end !== start) throw new HttpError(400, '반차는 하루만 지정하세요.');
  const id = await insertId(db, 'leaves', { user_id: uid, start, end, kind, note: String(b.note || '').slice(0, 200) || null, created_at: now(), created_by: req.user.id });
  await audit(null, { user: req.user, entity: 'leave', entityId: id, action: 'create', label: `${kind} ${start}~${end}` });
  res.json(await db('leaves').where({ id }).first());
}));

leavesRouter.delete('/:id', ah(async (req, res) => {
  const l = await db('leaves').where({ id: Number(req.params.id) }).first();
  if (!l) throw new HttpError(404, '휴가 기록이 없습니다.');
  if (l.user_id !== req.user.id && l.created_by !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, '본인, 등록한 사람, 관리자만 지울 수 있습니다.');
  await db('leaves').where({ id: l.id }).del();
  await audit(null, { user: req.user, entity: 'leave', entityId: l.id, action: 'delete', label: `${l.kind} ${l.start}~${l.end}` });
  res.json({ ok: true });
}));
