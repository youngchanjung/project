import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError, now, audit, insertId, pick, diff, holidaySet, optDate, projectCalendar } from '../util.js';
import { requireLogin, projectRole, canEdit, publicUser, visibleProjects, allowedCategories } from '../auth.js';
import { normCalendars } from '../countries.js';
import { stateOf, criticalPath, sCurve, addWorkdays, nextWorkdayOnOrAfter, workdaysBetween } from '../schedule.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { insertDefaultColumns } from '../migrations.js';
import { TASK_STATUS, TASK_TYPES, TASK_PRIORITY } from './tasks.js';

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
// 협약 기간의 가운데 날. 주말이면 앞의 금요일로
const mid = (a, b) => {
  const x = new Date(a + 'T00:00:00Z'), y = new Date(b + 'T00:00:00Z');
  const m = new Date(Math.floor((x.getTime() + y.getTime()) / 2 / 864e5) * 864e5);
  const back = { 6: 1, 0: 2 }[m.getUTCDay()] || 0;
  return new Date(m.getTime() - back * 864e5).toISOString().slice(0, 10);
};
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
  const visible = await visibleProjects(req.user, ps);
  const out = visible.map(p => {
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
  const cats = await allowedCategories(req.user);
  if (cats && !cats.has(body.category)) throw new HttpError(403, '이 카테고리의 프로젝트를 만들 수 없는 부서입니다.');
  cleanAgreement(body);
  const id = await db.transaction(async trx => {
    const id = await insertId(trx, 'projects', { ...body, name: body.name.trim(), created_at: now(), updated_at: now() });
    await trx('project_members').insert({ project_id: id, user_id: req.user.id, role: 'pm' });
    const tpl = req.body.template_id ? await trx('project_templates').where({ id: Number(req.body.template_id) }).first() : null;
    if (req.body.template_id && !tpl) throw new HttpError(400, '템플릿을 찾을 수 없습니다.');
    if (tpl) await applyTemplate(trx, id, JSON.parse(tpl.data), req.user);
    else {
      const phases = Array.isArray(req.body.phases) ? req.body.phases : [];
      for (const [i, name] of phases.entries()) if (name) await trx('phases').insert({ project_id: id, name, sort: i });
      await insertDefaultColumns(trx, id);
    }
    if (req.body.template) {
      for (const [i, t] of templateTasks(body.category, body).entries()) {
        await trx('tasks').insert({ ...t, project_id: id, sort: i + 1, status: '미착수', created_at: now(), updated_at: now(), updated_by: req.user.id });
      }
    }
    await audit(trx, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'create', label: tpl ? `${body.name} (템플릿: ${tpl.name})` : body.name });
    return id;
  });
  res.locals.projectId = id;
  res.json(await loadProject(id));
}));

// ---- 프로젝트 템플릿: 단계·칸반 열·할 일(체크리스트 포함)을 저장해 새 프로젝트에 복사 ----
// 날짜는 프로젝트마다 다르므로 저장하지 않음 (복사된 할 일은 '날짜 없음'으로 시작)
// 단, 기간(days)이 있는 작업은 만든 날부터 선행 작업(after, 끝-시작)을 따라 날짜를 정하고 선행관계도 만듦 (시공 공정 템플릿)
async function applyTemplate(trx, projectId, tpl, user) {
  const phaseIds = [];
  for (const [i, p] of (tpl.phases || []).entries()) {
    phaseIds.push(await insertId(trx, 'phases', { project_id: projectId, name: String(p.name || '').slice(0, 100) || `${i + 1}`, color: p.color || null, sort: i }));
  }
  const cols = Array.isArray(tpl.columns) && tpl.columns.length ? tpl.columns : null;
  if (cols) {
    for (const [i, c] of cols.entries()) {
      await trx('board_columns').insert({ project_id: projectId, name: String(c.name || '').slice(0, 60) || '-', color: c.color || null,
        status: TASK_STATUS.includes(c.status) ? c.status : '진행중', is_review: !!c.is_review, sort: i });
    }
  } else await insertDefaultColumns(trx, projectId);
  const first = await trx('board_columns').where({ project_id: projectId }).orderBy('sort').first();
  const d = now().slice(0, 10);
  const hol = await projectCalendar(trx, await trx('projects').where({ id: projectId }).first());
  const list = tpl.tasks || [];
  const dates = [], ids = [];
  for (const [i, t] of list.entries()) {
    const days = Math.round(Number(t.days));
    if (!(days >= 1 && days <= 3650)) { dates.push(null); continue; }
    const preds = (Array.isArray(t.after) ? t.after : []).filter(j => Number.isInteger(j) && j >= 0 && j < i && dates[j]);
    const start = preds.length ? preds.map(j => addWorkdays(dates[j].end, 1, hol)).sort().pop() : nextWorkdayOnOrAfter(d, hol);
    dates.push({ start, end: days === 1 ? start : addWorkdays(start, days - 1, hol), preds });
  }
  for (const [i, t] of list.entries()) {
    const dt = dates[i];
    const tid = await insertId(trx, 'tasks', {
      project_id: projectId, name: String(t.name || '').slice(0, 300) || '-', type: TASK_TYPES.includes(t.type) ? t.type : '작업',
      phase_id: Number.isInteger(t.phase) ? phaseIds[t.phase] ?? null : null, priority: TASK_PRIORITY.includes(t.priority) ? t.priority : '보통',
      tags: t.tags || null, note: t.note || null, est_hours: Number(t.est_hours) > 0 ? Number(t.est_hours) : null, is_key: !!t.is_key,
      trade: t.trade ? String(t.trade).slice(0, 80) : null,
      start: dt ? dt.start : d, end: dt ? dt.end : d, undated: !dt, status: '미착수', board_column_id: first?.status === '미착수' ? first.id : null, board_order: i + 1,
      sort: i + 1, created_at: now(), updated_at: now(), updated_by: user.id
    });
    for (const [j, text] of (t.checklist || []).entries()) if (text) await trx('task_checklist').insert({ task_id: tid, text: String(text).slice(0, 300), sort: j });
    ids.push(tid);
    for (const j of dt?.preds || []) await trx('dependencies').insert({ project_id: projectId, pred_id: ids[j], succ_id: tid, kind: 'FS', lag: 0 });
  }
}
async function templateOf(projectId) {
  const p = await db('projects').where({ id: projectId }).first();
  const hol = await projectCalendar(db, p);
  const [phases, columns, tasks, checks, deps] = await Promise.all([
    db('phases').where({ project_id: projectId }).orderBy('sort'),
    db('board_columns').where({ project_id: projectId }).orderBy('sort'),
    db('tasks').where({ project_id: projectId }).orderBy([{ column: 'sort' }, { column: 'id' }]),
    db('task_checklist').whereIn('task_id', db('tasks').select('id').where({ project_id: projectId })).orderBy([{ column: 'task_id' }, { column: 'sort' }]),
    db('dependencies').where({ project_id: projectId, kind: 'FS' })
  ]);
  const pidx = new Map(phases.map((p, i) => [p.id, i]));
  const kept = tasks.filter(t => t.type !== '회의');
  const tidx = new Map(kept.map((t, i) => [t.id, i]));
  // 시공 프로젝트는 기간·선행관계(끝-시작)도 저장해 새 프로젝트에서 날짜를 다시 계산
  const sched = p.category === 'construction';
  return {
    phases: phases.map(p => ({ name: p.name, color: p.color })),
    columns: columns.map(c => ({ name: c.name, color: c.color, status: c.status, is_review: !!c.is_review })),
    tasks: kept.map((t, i) => ({
      name: t.name, type: t.type, phase: pidx.has(t.phase_id) ? pidx.get(t.phase_id) : null, priority: t.priority, tags: t.tags || undefined,
      note: t.note || undefined, est_hours: t.est_hours || undefined, is_key: !!t.is_key || undefined,
      trade: t.trade || undefined,
      ...(sched && !t.undated ? { days: t.start === t.end ? 1 : Math.max(1, workdaysBetween(t.start, t.end, hol)),
        after: deps.filter(d => d.succ_id === t.id && tidx.get(d.pred_id) < i).map(d => tidx.get(d.pred_id)) } : {}),
      checklist: checks.filter(c => c.task_id === t.id).map(c => c.text)
    }))
  };
}
const tplSummary = r => { const d = JSON.parse(r.data); return { id: r.id, name: r.name, category: r.category, created_at: r.created_at, created_by: r.created_by, phases: (d.phases || []).map(p => p.name), tasks: (d.tasks || []).length }; };

projectsRouter.get('/templates', ah(async (req, res) => {
  const q = db('project_templates').orderBy('name');
  if (req.query.category) q.where({ category: String(req.query.category) });
  res.json((await q).map(tplSummary));
}));
projectsRouter.post('/:id/templates', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id, 'pm');
  const p = await loadProject(id);
  const name = String(req.body?.name || '').trim().slice(0, 100);
  if (!name) throw new HttpError(400, '템플릿 이름을 입력하세요.');
  if (await db('project_templates').where({ name, category: p.category }).first()) throw new HttpError(400, '같은 이름의 템플릿이 이미 있습니다.');
  const data = await templateOf(id);
  const tid = await insertId(db, 'project_templates', { name, category: p.category, data: JSON.stringify(data), created_at: now(), created_by: req.user.id });
  await audit(null, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'template', label: `템플릿으로 저장: ${name} (할 일 ${data.tasks.length}건)` });
  res.json(tplSummary(await db('project_templates').where({ id: tid }).first()));
}));
projectsRouter.delete('/templates/:tid', ah(async (req, res) => {
  const t = await db('project_templates').where({ id: Number(req.params.tid) }).first();
  if (!t) throw new HttpError(404, '템플릿을 찾을 수 없습니다.');
  if (req.user.role !== 'admin' && t.created_by !== req.user.id) throw new HttpError(403, '템플릿은 만든 사람이나 관리자만 지울 수 있습니다.');
  await db('project_templates').where({ id: t.id }).del();
  await audit(null, { user: req.user, entity: 'template', entityId: t.id, action: 'delete', label: t.name });
  res.json({ ok: true });
}));

// 프로젝트 전체 데이터 (화면에서 한 번에 받아 씀)
projectsRouter.get('/:id/data', ah(async (req, res) => {
  const id = Number(req.params.id);
  const project = await loadProject(id);
  const [phases, tasks, deps, issues, members, role, hol, columns, checklist, baselines, events] = await Promise.all([
    db('phases').where({ project_id: id }).orderBy('sort'),
    db('tasks').where({ project_id: id }).orderBy([{ column: 'sort' }, { column: 'start' }]),
    db('dependencies').where({ project_id: id }),
    db('issues').where({ project_id: id }).orderBy('code'),
    db('project_members as m').join('users as u', 'u.id', 'm.user_id').where('m.project_id', id).select('u.id', 'u.name', 'u.username', 'u.email', 'm.role'),
    projectRole(req.user, id),
    db('holidays').whereIn('country', String(project.calendars || 'KR').split(',')).orderBy('date'),
    db('board_columns').where({ project_id: id }).orderBy('sort'),
    db('task_checklist').whereIn('task_id', db('tasks').select('id').where({ project_id: id })).orderBy([{ column: 'task_id' }, { column: 'sort' }]),
    db('baselines').where({ project_id: id }).orderBy('id', 'desc'),
    db('timeline_events').where({ project_id: id }).orderBy('start')
  ]);
  if (!role) throw new HttpError(403, '참여하지 않은 프로젝트입니다.');
  // 쓴 시간(기록 합계)과 참여자 휴가 (카드 표시·마감 경고용)
  const spentRows = await db('time_entries').where({ project_id: id }).whereNotNull('task_id').groupBy('task_id').select('task_id').sum({ h: 'hours' });
  const spent = new Map(spentRows.map(r => [r.task_id, Math.round(Number(r.h) * 10) / 10]));
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const leaves = members.length ? await db('leaves').whereIn('user_id', members.map(m => m.id)).where('end', '>=', since).orderBy('start') : [];
  // 외부 협력자: 자기 카드(담당·검토)만, 이슈는 보이지 않음
  if (req.user.external) {
    const mine = new Set(tasks.filter(t => t.assignee_id === req.user.id || t.reviewer_id === req.user.id).map(t => t.id));
    tasks.splice(0, tasks.length, ...tasks.filter(t => mine.has(t.id)));
    deps.splice(0, deps.length, ...deps.filter(d => mine.has(d.pred_id) && mine.has(d.succ_id)));
    issues.splice(0, issues.length);
    checklist.splice(0, checklist.length, ...checklist.filter(c => mine.has(c.task_id)));
  }
  // 크리티컬 패스·여유일 (근무일 기준, 프로젝트 달력)
  const cal = project.day_basis === 'calendar' ? null : new Set(hol.map(h => h.date));
  const cp = criticalPath(tasks.map(t => ({ ...t, undated: !!t.undated })), deps, cal);
  res.json({
    project: { ...project, archived: !!project.archived }, phases,
    leaves: req.user.external ? leaves.filter(l => l.user_id === req.user.id) : leaves,
    tasks: tasks.map(t => ({ ...t, spent: spent.get(t.id) || 0, is_key: !!t.is_key, teams_meeting: !!t.teams_meeting, undated: !!t.undated, float: cp.get(t.id)?.float ?? null, crit: !!cp.get(t.id)?.crit })),
    deps, issues, members, role, holidays: hol, baselines, events,
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
    await trx('baseline_tasks').whereIn('baseline_id', trx('baselines').select('id').where({ project_id: id })).del();
    await trx('baselines').where({ project_id: id }).del();
    await trx('timeline_events').where({ project_id: id }).del();
    await trx('attachments').where({ project_id: id }).del();
    for (const t of ['time_entries', 'meetings', 'dependencies', 'issues', 'tasks', 'board_columns', 'phases', 'project_members']) await trx(t).where({ project_id: id }).del();
    await trx('projects').where({ id }).del();
    await audit(trx, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'delete', label: p.name });
  });
  fs.rmSync(path.join(config.attachDir, String(id)), { recursive: true, force: true }); // 현장 사진·첨부 파일
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
  const pid = await insertId(db, 'phases', { project_id: id, name: req.body.name.trim(), color: req.body.color || null, due: optDate(req.body.due || null, '제출일'), sort: (m ?? -1) + 1 });
  await audit(null, { user: req.user, projectId: id, entity: 'phase', entityId: pid, action: 'create', label: req.body.name });
  res.json(await db('phases').where({ id: pid }).first());
}));
projectsRouter.patch('/:id/phases/:pid', ah(async (req, res) => {
  const id = Number(req.params.id), pid = Number(req.params.pid);
  await need(req, id, 'pm');
  const up = pick(req.body || {}, ['name', 'color', 'sort', 'due']);
  if (up.due !== undefined) up.due = optDate(up.due || null, '제출일');
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

// ---- 기준선 버전: 지금 일정을 이름 붙여 저장, 버전끼리 비교 ----
projectsRouter.post('/:id/baselines', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id, 'pm');
  const name = String(req.body?.name || '').trim().slice(0, 100) || `기준선 ${now().slice(0, 10)}`;
  const out = await db.transaction(async trx => {
    const ts = await trx('tasks').where({ project_id: id, undated: false }).select('id', 'start', 'end');
    const bid = await insertId(trx, 'baselines', { project_id: id, name, count: ts.length, created_at: now(), created_by: req.user.id });
    for (let i = 0; i < ts.length; i += 200) {
      await trx('baseline_tasks').insert(ts.slice(i, i + 200).map(t => ({ baseline_id: bid, task_id: t.id, start: t.start, end: t.end })));
    }
    // 화면에서 비교하는 '현재 기준 일정'도 이 버전으로 맞춤
    await trx('tasks').where({ project_id: id, undated: false }).update({ baseline_start: trx.ref('start'), baseline_end: trx.ref('end') });
    await audit(trx, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'baseline', label: `기준선 저장: ${name} (${ts.length}건)` });
    return { id: bid, name, count: ts.length };
  });
  res.json(out);
}));

// 공정률·S-커브. ?baseline=<기준선 id> (없으면 기준 시작·종료), ?mode=duration|weight, ?today=YYYY-MM-DD
projectsRouter.get('/:id/scurve', ah(async (req, res) => {
  const id = Number(req.params.id);
  await loadProject(id);
  if (!(await projectRole(req.user, id))) throw new HttpError(403, '참여하지 않은 프로젝트입니다.');
  let tasks = await db('tasks').where({ project_id: id });
  if (req.user.external) tasks = tasks.filter(t => t.assignee_id === req.user.id || t.reviewer_id === req.user.id);
  tasks = tasks.map(t => ({ ...t, undated: !!t.undated }));
  let plan = null;
  const bid = Number(req.query.baseline) || 0;
  if (bid) {
    const b = await db('baselines').where({ id: bid, project_id: id }).first();
    if (!b) throw new HttpError(404, '기준선을 찾을 수 없습니다.');
    plan = new Map((await db('baseline_tasks').where({ baseline_id: bid })).map(r => [r.task_id, r]));
  }
  const hasWeight = tasks.some(t => Number(t.weight) > 0);
  const mode = req.query.mode === 'weight' && hasWeight ? 'weight' : 'duration';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(req.query.today || '') ? req.query.today : new Date().toISOString().slice(0, 10);
  res.json({ ...sCurve(tasks, { today, plan, mode }), hasWeight });
}));

projectsRouter.get('/:id/baselines/:bid', ah(async (req, res) => {
  const id = Number(req.params.id), bid = Number(req.params.bid);
  await loadProject(id);
  const b = await db('baselines').where({ id: bid, project_id: id }).first();
  if (!b) throw new HttpError(404, '기준선을 찾을 수 없습니다.');
  res.json({ ...b, rows: await db('baseline_tasks').where({ baseline_id: bid }).select('task_id', 'start', 'end') });
}));

projectsRouter.delete('/:id/baselines/:bid', ah(async (req, res) => {
  const id = Number(req.params.id), bid = Number(req.params.bid);
  await need(req, id, 'pm');
  const b = await db('baselines').where({ id: bid, project_id: id }).first();
  if (!b) throw new HttpError(404, '기준선을 찾을 수 없습니다.');
  await db.transaction(async trx => {
    await trx('baseline_tasks').where({ baseline_id: bid }).del();
    await trx('baselines').where({ id: bid }).del();
    await audit(trx, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'baseline', label: `기준선 삭제: ${b.name}` });
  });
  res.json({ ok: true });
}));

// ---- 간트 머리 기간 표시 (우기, 검측 주간 등) ----
function cleanEvent(b) {
  const e = { name: String(b?.name || '').trim().slice(0, 100), start: optDate(b?.start, '시작일'), end: optDate(b?.end || b?.start, '종료일'), color: /^#[0-9a-f]{6}$/i.test(b?.color || '') ? b.color : '#d9822b' };
  if (!e.name) throw new HttpError(400, '기간 이름을 입력하세요.');
  if (!e.start || !e.end) throw new HttpError(400, '시작일과 종료일을 입력하세요.');
  if (e.end < e.start) throw new HttpError(400, '종료일이 시작일보다 빠릅니다.');
  return e;
}
projectsRouter.post('/:id/events', ah(async (req, res) => {
  const id = Number(req.params.id);
  await need(req, id);
  const e = cleanEvent(req.body);
  const eid = await insertId(db, 'timeline_events', { ...e, project_id: id });
  await audit(null, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'update', label: `간트 기간 추가: ${e.name} (${e.start}~${e.end})` });
  res.json(await db('timeline_events').where({ id: eid }).first());
}));
projectsRouter.patch('/:id/events/:eid', ah(async (req, res) => {
  const id = Number(req.params.id), eid = Number(req.params.eid);
  await need(req, id);
  const ex = await db('timeline_events').where({ id: eid, project_id: id }).first();
  if (!ex) throw new HttpError(404, '기간을 찾을 수 없습니다.');
  await db('timeline_events').where({ id: eid }).update(cleanEvent({ ...ex, ...req.body }));
  res.json(await db('timeline_events').where({ id: eid }).first());
}));
projectsRouter.delete('/:id/events/:eid', ah(async (req, res) => {
  const id = Number(req.params.id), eid = Number(req.params.eid);
  await need(req, id);
  const ex = await db('timeline_events').where({ id: eid, project_id: id }).first();
  if (!ex) throw new HttpError(404, '기간을 찾을 수 없습니다.');
  await db('timeline_events').where({ id: eid }).del();
  await audit(null, { user: req.user, projectId: id, entity: 'project', entityId: id, action: 'update', label: `간트 기간 삭제: ${ex.name}` });
  res.json({ ok: true });
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
