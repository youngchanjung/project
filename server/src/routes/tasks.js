import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError, now, audit, insertId, pick, diff, optDate, projectCalendar } from '../util.js';
import { requireLogin } from '../auth.js';
import { recalc, wouldCycle, rollup, addWorkdays, nextWorkdayOnOrAfter, workdaysBetween } from '../schedule.js';
import { need, loadProject } from './projects.js';
import { notify, recipientsOf } from '../notify.js';

export const tasksRouter = Router({ mergeParams: true });
tasksRouter.use(requireLogin);

export const TASK_TYPES = ['작업', '마일스톤', '제출', '지급', '검토', '홀드포인트', '회의', '시험'];
export const TASK_STATUS = ['미착수', '진행중', '완료', '보류'];
export const TASK_PRIORITY = ['낮음', '보통', '높음', '긴급'];
const COLS = ['phase_id', 'code', 'name', 'name_en', 'type', 'owner', 'assignee_id', 'start', 'end',
  'baseline_start', 'baseline_end', 'actual_end', 'not_before', 'status', 'progress', 'is_key', 'ref', 'note', 'sort',
  'board_column_id', 'priority', 'tags', 'reviewer_id', 'start_time', 'end_time', 'location', 'attendees', 'meeting_url', 'company', 'trade', 'deadline', 'actual_start', 'parent_id', 'est_hours'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ymd = () => new Date().toISOString().slice(0, 10);

function clean(body, partial) {
  const t = pick(body || {}, COLS);
  for (const f of ['start', 'end', 'baseline_start', 'baseline_end', 'actual_end', 'not_before', 'deadline', 'actual_start']) {
    if (t[f] !== undefined) t[f] = optDate(t[f], f);
  }
  if (!partial || t.name !== undefined) {
    if (!String(t.name || '').trim()) throw new HttpError(400, '작업명을 입력하세요.');
    t.name = String(t.name).trim();
  }
  if (!partial) {
    // 날짜 없이도 만들 수 있음 (칸반·할 일). 그때는 만든 날로 채우고 undated 표시
    if (!t.start && !t.end) { t.start = t.end = ymd(); t.undated = true; }
    else { if (!t.start) t.start = t.end; if (!t.end) t.end = t.start; t.undated = false; }
  } else if ('start' in t || 'end' in t) {
    if (!t.start && !t.end && 'start' in t && 'end' in t) { t.start = t.end = ymd(); t.undated = true; }
    else {
      if ('start' in t && !t.start) t.start = t.end || undefined;
      if ('end' in t && !t.end) t.end = t.start || undefined;
      for (const f of ['start', 'end']) if (t[f] === undefined) delete t[f];
      t.undated = false;
    }
  }
  if (t.type !== undefined && !TASK_TYPES.includes(t.type)) throw new HttpError(400, `유형은 ${TASK_TYPES.join('/')} 중 하나입니다.`);
  if (t.status !== undefined && !TASK_STATUS.includes(t.status)) throw new HttpError(400, `상태는 ${TASK_STATUS.join('/')} 중 하나입니다.`);
  if (t.is_key !== undefined) t.is_key = !!t.is_key;
  if (t.priority !== undefined && !TASK_PRIORITY.includes(t.priority)) throw new HttpError(400, `우선순위는 ${TASK_PRIORITY.join('/')} 중 하나입니다.`);
  for (const f of ['start_time', 'end_time']) if (t[f] !== undefined) {
    t[f] = t[f] ? String(t[f]).slice(0, 5) : null;
    if (t[f] && !HHMM.test(t[f])) throw new HttpError(400, '시각은 00:00~23:59 형식으로 입력하세요.');
  }
  if (t.attendees !== undefined) t.attendees = (Array.isArray(t.attendees) ? t.attendees : String(t.attendees || '').split(',')).map(Number).filter(Boolean).join(',') || null;
  if (t.meeting_url !== undefined && t.meeting_url && !/^https?:\/\//i.test(t.meeting_url)) throw new HttpError(400, '회의 링크는 http(s):// 로 시작해야 합니다.');
  if (t.tags !== undefined) t.tags = String(t.tags || '').split(',').map(x => x.trim()).filter(Boolean).join(', ') || null;
  if (t.est_hours !== undefined) {
    const h = t.est_hours === '' || t.est_hours === null ? null : Number(t.est_hours);
    if (h !== null && !(h >= 0 && h <= 2000)) throw new HttpError(400, '예상 시간은 0~2000 사이 숫자로 입력하세요.');
    t.est_hours = h ? Math.round(h * 10) / 10 : null;
  }
  if (t.progress !== undefined) t.progress = Math.max(0, Math.min(100, Number(t.progress) || 0));
  if (t.company !== undefined) t.company = String(t.company || '').trim().slice(0, 120) || null;
  if (t.trade !== undefined) t.trade = String(t.trade || '').trim().slice(0, 80) || null;
  for (const f of ['phase_id', 'assignee_id', 'board_column_id', 'reviewer_id', 'parent_id']) if (t[f] !== undefined) t[f] = t[f] ? Number(t[f]) : null;
  return t;
}

// 프로젝트 전체 재계산 후 바뀐 작업을 저장. 바뀐 목록 반환
export async function applyRecalc(trx, projectId, user, opt = {}) {
  const p = await trx('projects').where({ id: projectId }).first();
  const hol = await projectCalendar(trx, p);
  const tasks = await trx('tasks').where({ project_id: projectId, undated: false });
  const deps = await trx('dependencies').where({ project_id: projectId });
  const changed = opt.rollupOnly ? [] : recalc(tasks, deps, hol);
  const byId = new Map(tasks.map(t => [t.id, t]));
  // 요약 작업: 하위 작업(자동 조정 반영 후)에서 날짜·진행률 모음
  const moved = new Map(changed.map(c => [c.id, c]));
  const all = (await trx('tasks').where({ project_id: projectId })).map(t => moved.has(t.id) ? { ...t, ...moved.get(t.id) } : t);
  for (const r of rollup(all)) {
    const b = all.find(t => t.id === r.id);
    await trx('tasks').where({ id: r.id }).update({ start: r.start, end: r.end, progress: r.progress, status: r.status, undated: false, actual_end: r.status === '완료' ? (b.actual_end || ymd()) : null, version: b.version + 1, updated_at: now() });
  }
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
  if (t.reviewer_id && !(await trx('users').where({ id: t.reviewer_id }).first())) throw new HttpError(400, '검토자 계정이 없습니다.');
  if (t.board_column_id && !(await trx('board_columns').where({ id: t.board_column_id, project_id: projectId }).first())) throw new HttpError(400, '칸반 열이 이 프로젝트에 없습니다.');
  if (t.start && t.end && t.end < t.start) throw new HttpError(400, '종료일이 시작일보다 빠릅니다.');
  if (t.parent_id) {
    const all = await trx('tasks').where({ project_id: projectId }).select('id', 'parent_id');
    if (!all.some(x => x.id === t.parent_id)) throw new HttpError(400, '상위 작업이 이 프로젝트에 없습니다.');
    // 자기 자신이나 자기 하위 작업을 상위로 고르면 순환
    const up = new Map(all.map(x => [x.id, x.parent_id]));
    let x = t.parent_id, g = 0;
    while (x && g++ < 100) { if (x === t.id) throw new HttpError(400, '자기 자신이나 하위 작업을 상위 작업으로 고를 수 없습니다.'); x = up.get(x); }
  }
}

tasksRouter.post('/', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await loadProject(pid);
  await need(req, pid);
  const t = clean(req.body, false);
  const result = await db.transaction(async trx => {
    await checkRefs(trx, pid, t);
    if (t.sort === undefined) { const { m } = await trx('tasks').where({ project_id: pid }).max({ m: 'sort' }).first(); t.sort = (m ?? 0) + 1; }
    if (t.board_column_id) {
      const col = await trx('board_columns').where({ id: t.board_column_id }).first();
      if (req.body.status === undefined) t.status = col.status;
      const { m } = await trx('tasks').where({ board_column_id: t.board_column_id }).max({ m: 'board_order' }).first();
      t.board_order = (m ?? 0) + 1;
    }
    if (t.status === '완료') { t.actual_end = t.actual_end || ymd(); t.progress = 100; }
    const id = await insertId(trx, 'tasks', { ...t, project_id: pid, created_at: now(), updated_at: now(), updated_by: req.user.id });
    await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: id, action: 'create', label: t.name });
    await notify(trx, await recipientsOf(trx, t), { kind: 'task_assigned', projectId: pid, entity: 'task', entityId: id, actorId: req.user.id, params: { name: t.name, code: t.code, by: req.user.name } });
    if (t.type === '회의' && t.attendees) await notify(trx, t.attendees.split(',').map(Number), { kind: 'meeting_invited', projectId: pid, entity: 'task', entityId: id, actorId: req.user.id,
      params: { name: t.name, date: t.undated ? null : t.start, time: t.start_time, location: t.location, by: req.user.name } });
    if (t.parent_id) await applyRecalc(trx, pid, req.user);
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
    // 상태만 바꾸면 칸반 열도 그 상태의 열로 맞춤 (열을 직접 고른 경우는 그대로)
    if (up.status && up.status !== before.status && up.board_column_id === undefined && before.board_column_id) {
      const cur = await trx('board_columns').where({ id: before.board_column_id }).first();
      if (cur && cur.status !== up.status) up.board_column_id = (await trx('board_columns').where({ project_id: pid, status: up.status }).orderBy('sort').first())?.id ?? null;
    }
    const ch = diff(before, up);
    if (!Object.keys(ch).length) return [];
    await trx('tasks').where({ id: tid }).update({ ...up, version: before.version + 1, updated_at: now(), updated_by: req.user.id });
    await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: tid, action: 'update', label: up.name || before.name, changes: ch });
    const after = { ...before, ...up };
    const oldR = new Set(await recipientsOf(trx, before)), newR = await recipientsOf(trx, after);
    const base = { projectId: pid, entity: 'task', entityId: tid, actorId: req.user.id };
    await notify(trx, newR.filter(u => !oldR.has(u)), { ...base, kind: 'task_assigned', params: { name: after.name, code: after.code, by: req.user.name } });
    if (after.type === '회의') {
      const oldA = new Set(String(before.attendees || '').split(',').map(Number)), newA = String(after.attendees || '').split(',').map(Number).filter(Boolean);
      const mp = { name: after.name, date: after.undated ? null : after.start, time: after.start_time, location: after.location, by: req.user.name };
      await notify(trx, newA.filter(u => !oldA.has(u)), { ...base, kind: 'meeting_invited', params: mp });
      if (ch.start || ch.start_time || ch.location) await notify(trx, newA.filter(u => oldA.has(u)), { ...base, kind: 'meeting_changed', params: mp });
    }
    if (ch.start || ch.end) await notify(trx, newR.filter(u => oldR.has(u)), { ...base, kind: 'task_changed', params: { name: after.name, code: after.code, from: `${before.start}~${before.end}`, to: `${after.start}~${after.end}`, by: req.user.name } });
    if (ch.start || ch.end || ch.status || ch.not_before || ch.parent_id || ch.progress) return applyRecalc(trx, pid, req.user);
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
    await trx('tasks').where({ parent_id: tid }).update({ parent_id: t.parent_id ?? null }); // 하위 작업은 한 단계 위로
    await trx('issues').where({ task_id: tid }).update({ task_id: null });
    await trx('task_checklist').where({ task_id: tid }).del();
    await trx('tasks').where({ id: tid }).del();
    await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: tid, action: 'delete', label: t.name, changes: { start: [t.start, null], end: [t.end, null] } });
    if (t.parent_id) await applyRecalc(trx, pid, req.user);
  });
  res.json({ ok: true });
}));

// ---- 칸반: 카드 이동 { column_id, index } → 열·순서·상태를 한 번에 바꿈 ----
// 검토 열로 들어가면 검토자(없으면 PM)에게 검토 요청 알림
export async function moveTask(trx, pid, tid, colId, index, user, extra = {}) {
  const t = await trx('tasks').where({ id: tid, project_id: pid }).first();
  if (!t) throw new HttpError(404, '작업이 없습니다.');
  const cols = await trx('board_columns').where({ project_id: pid }).orderBy('sort');
  const col = cols.find(c => c.id === colId);
  if (!col) throw new HttpError(400, '칸반 열이 이 프로젝트에 없습니다.');
  // 이 열에 보이는 카드 순서 (열이 지정 안 된 카드는 상태가 같은 첫 열에 보임)
  const all = await trx('tasks').where({ project_id: pid }).whereNot({ id: tid });
  const colOf = x => (x.board_column_id && cols.some(c => c.id === x.board_column_id)) ? x.board_column_id
    : (cols.find(c => c.status === x.status)?.id ?? cols[0].id);
  const inCol = all.filter(x => colOf(x) === colId).sort((a, b) => a.board_order - b.board_order || a.id - b.id);
  const idx = Math.max(0, Math.min(inCol.length, Number.isFinite(Number(index)) && index !== null ? Number(index) : inCol.length));
  inCol.splice(idx, 0, t);
  for (const [i, x] of inCol.entries()) {
    if (x.id === tid) continue;
    if (x.board_order !== i || x.board_column_id !== colId) await trx('tasks').where({ id: x.id }).update({ board_order: i, board_column_id: colId });
  }
  const up = { board_column_id: colId, board_order: idx, ...extra };
  if (t.status !== col.status) {
    up.status = col.status;
    if (col.status === '완료') { up.actual_end = t.actual_end || ymd(); up.progress = 100; }
    else if (t.status === '완료') up.actual_end = null;
  }
  const fromCol = cols.find(c => c.id === colOf(t));
  const enteringReview = col.is_review && !fromCol?.is_review;
  if (enteringReview && extra.review_state === undefined) up.review_state = 'requested';
  else if (fromCol?.is_review && !col.is_review && extra.review_state === undefined && t.review_state === 'requested') up.review_state = null; // 검토 열에서 끌어 뺌
  await trx('tasks').where({ id: tid }).update({ ...up, version: t.version + 1, updated_at: now(), updated_by: user.id });
  if (t.board_column_id !== colId || up.status) {
    await audit(trx, { user, projectId: pid, entity: 'task', entityId: tid, action: 'move', label: `${t.name}: ${fromCol?.name || ''} → ${col.name}`, changes: up.status ? { status: [t.status, up.status] } : null });
  }
  if (enteringReview && extra.review_state === undefined) {
    const to = t.reviewer_id ? [t.reviewer_id]
      : (await trx('project_members').where({ project_id: pid, role: 'pm' }).select('user_id')).map(r => r.user_id);
    await notify(trx, to, { kind: 'review_requested', projectId: pid, entity: 'task', entityId: tid, actorId: user.id, params: { name: t.name, code: t.code, by: user.name } });
  }
  return up.status ? applyRecalc(trx, pid, user) : [];
}
tasksRouter.post('/:tid/move', ah(async (req, res) => {
  const pid = Number(req.params.pid), tid = Number(req.params.tid);
  await need(req, pid);
  const shifted = await db.transaction(trx => moveTask(trx, pid, tid, Number(req.body?.column_id), req.body?.index, req.user));
  res.json({ task: await db('tasks').where({ id: tid }).first(), shifted });
}));

// ---- 검토: 승인하면 완료 열로, 반려하면 진행 중 열로. 검토자 또는 PM 만 ----
tasksRouter.post('/:tid/review', ah(async (req, res) => {
  const pid = Number(req.params.pid), tid = Number(req.params.tid);
  const role = await need(req, pid);
  const decision = req.body?.decision;
  if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, '승인 또는 반려를 고르세요.');
  const note = String(req.body?.note || '').trim().slice(0, 1000) || null;
  const shifted = await db.transaction(async trx => {
    const t = await trx('tasks').where({ id: tid, project_id: pid }).first();
    if (!t) throw new HttpError(404, '작업이 없습니다.');
    if (t.reviewer_id !== req.user.id && role !== 'pm') throw new HttpError(403, '검토자 또는 PM만 승인·반려할 수 있습니다.');
    const cols = await trx('board_columns').where({ project_id: pid }).orderBy('sort');
    const target = decision === 'approve'
      ? cols.find(c => c.status === '완료')
      : (cols.find(c => c.status === '진행중' && !c.is_review) || cols.find(c => !c.is_review && c.status !== '완료'));
    if (!target) throw new HttpError(400, decision === 'approve' ? '완료 상태의 칸반 열이 없습니다.' : '되돌릴 칸반 열이 없습니다.');
    const out = await moveTask(trx, pid, tid, target.id, 0, req.user, { review_state: decision === 'approve' ? 'approved' : 'rejected', review_note: note });
    await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: tid, action: decision === 'approve' ? 'approve' : 'reject', label: `${t.name}${note ? `: ${note}` : ''}` });
    await notify(trx, await recipientsOf(trx, t), { kind: decision === 'approve' ? 'review_approved' : 'review_rejected', projectId: pid, entity: 'task', entityId: tid, actorId: req.user.id, params: { name: t.name, code: t.code, by: req.user.name, note } });
    return out;
  });
  res.json({ task: await db('tasks').where({ id: tid }).first(), shifted });
}));

// ---- 체크리스트 ----
async function loadTask(pid, tid) {
  const t = await db('tasks').where({ id: tid, project_id: pid }).first();
  if (!t) throw new HttpError(404, '작업이 없습니다.');
  return t;
}
tasksRouter.post('/:tid/checklist', ah(async (req, res) => {
  const pid = Number(req.params.pid), tid = Number(req.params.tid);
  await need(req, pid);
  const t = await loadTask(pid, tid);
  const text = String(req.body?.text || '').trim();
  if (!text) throw new HttpError(400, '내용을 입력하세요.');
  const { m } = await db('task_checklist').where({ task_id: tid }).max({ m: 'sort' }).first();
  const id = await insertId(db, 'task_checklist', { task_id: tid, text: text.slice(0, 300), done: false, sort: (m ?? -1) + 1 });
  await audit(null, { user: req.user, projectId: pid, entity: 'task', entityId: tid, action: 'checklist', label: `${t.name}: + ${text}` });
  res.json(await db('task_checklist').where({ id }).first());
}));
tasksRouter.patch('/:tid/checklist/:cid', ah(async (req, res) => {
  const pid = Number(req.params.pid), tid = Number(req.params.tid), cid = Number(req.params.cid);
  await need(req, pid);
  await loadTask(pid, tid);
  const up = pick(req.body || {}, ['text', 'done', 'sort']);
  if (up.done !== undefined) up.done = !!up.done;
  if (up.text !== undefined) { up.text = String(up.text).trim().slice(0, 300); if (!up.text) throw new HttpError(400, '내용을 입력하세요.'); }
  await db('task_checklist').where({ id: cid, task_id: tid }).update(up);
  res.json(await db('task_checklist').where({ id: cid }).first());
}));
tasksRouter.delete('/:tid/checklist/:cid', ah(async (req, res) => {
  const pid = Number(req.params.pid), tid = Number(req.params.tid), cid = Number(req.params.cid);
  await need(req, pid);
  await loadTask(pid, tid);
  await db('task_checklist').where({ id: cid, task_id: tid }).del();
  res.json({ ok: true });
}));

// ---- 여러 작업 한 번에 상태 바꾸기 (할 일 목록의 일괄 완료) ----
tasksRouter.post('/bulk-status', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const status = req.body?.status;
  if (!TASK_STATUS.includes(status)) throw new HttpError(400, `상태는 ${TASK_STATUS.join('/')} 중 하나입니다.`);
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  const shifted = await db.transaction(async trx => {
    const ts = await trx('tasks').where({ project_id: pid }).whereIn('id', ids);
    const col = (await trx('board_columns').where({ project_id: pid, status }).orderBy('sort').first())?.id ?? null;
    for (const t of ts) {
      if (t.status === status) continue;
      const up = { status, board_column_id: col };
      if (status === '완료') { up.actual_end = t.actual_end || ymd(); up.progress = 100; } else if (t.status === '완료') up.actual_end = null;
      await trx('tasks').where({ id: t.id }).update({ ...up, version: t.version + 1, updated_at: now(), updated_by: req.user.id });
      await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: t.id, action: 'update', label: t.name, changes: { status: [t.status, status] } });
    }
    return applyRecalc(trx, pid, req.user);
  });
  res.json({ updated: ids.length, shifted });
}));

// ---- 일괄 편집: 여러 작업의 담당·업체·공종·단계를 한 번에, 날짜는 근무일 기준으로 ±N 이동 ----
tasksRouter.post('/bulk-edit', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new HttpError(400, '작업을 고르세요.');
  const set = clean(pick(req.body?.set || {}, ['owner', 'company', 'trade', 'phase_id', 'assignee_id']), true);
  const shift = Math.round(Number(req.body?.shift) || 0);
  if (Math.abs(shift) > 1000) throw new HttpError(400, '이동할 날 수가 너무 큽니다.');
  const shifted = await db.transaction(async trx => {
    const p = await trx('projects').where({ id: pid }).first();
    const hol = await projectCalendar(trx, p);
    await checkRefs(trx, pid, set);
    const ts = await trx('tasks').where({ project_id: pid }).whereIn('id', ids);
    for (const t of ts) {
      const up = { ...set };
      if (shift && !t.undated && t.status !== '완료') {
        const single = t.start === t.end, dur = single ? 1 : workdaysBetween(t.start, t.end, hol);
        up.start = addWorkdays(nextWorkdayOnOrAfter(t.start, hol), shift, hol);
        up.end = single ? up.start : addWorkdays(up.start, dur - 1, hol);
      }
      const ch = diff(t, up);
      if (!Object.keys(ch).length) continue;
      await trx('tasks').where({ id: t.id }).update({ ...up, version: t.version + 1, updated_at: now(), updated_by: req.user.id });
      await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: t.id, action: 'update', label: `${t.name} (일괄 편집)`, changes: ch });
    }
    return applyRecalc(trx, pid, req.user);
  });
  res.json({ updated: ids.length, shifted });
}));

// ---- 주간 진척 입력: 여러 작업의 실제 시작·진행률·상태·실제 완료를 한 번에 ----
tasksRouter.post('/progress', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 2000) : [];
  const shifted = await db.transaction(async trx => {
    let n = 0;
    for (const r of rows) {
      const t = await trx('tasks').where({ id: Number(r.id), project_id: pid }).first();
      if (!t) continue;
      const up = clean(pick(r, ['actual_start', 'actual_end', 'progress', 'status']), true);
      if (up.status === '완료') { up.progress = 100; up.actual_end = up.actual_end || t.actual_end || ymd(); }
      else if (up.actual_end) { up.status = '완료'; up.progress = 100; }
      else if (up.status && up.status !== '완료' && t.status === '완료') up.actual_end = null;
      if (!up.status && t.status === '미착수' && ((up.progress ?? 0) > 0 || up.actual_start)) up.status = '진행중';
      if (up.actual_start && up.actual_end && up.actual_end < up.actual_start) throw new HttpError(400, `${t.name}: 실제 완료일이 실제 시작일보다 빠릅니다.`);
      const ch = diff(t, up);
      if (!Object.keys(ch).length) continue;
      await trx('tasks').where({ id: t.id }).update({ ...up, version: t.version + 1, updated_at: now(), updated_by: req.user.id });
      await audit(trx, { user: req.user, projectId: pid, entity: 'task', entityId: t.id, action: 'progress', label: t.name, changes: ch });
      n++;
    }
    const out = await applyRecalc(trx, pid, req.user);
    if (n) await audit(trx, { user: req.user, projectId: pid, entity: 'project', entityId: pid, action: 'progress', label: `주간 진척 입력 (${n}건)` });
    return out;
  });
  res.json({ shifted });
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
