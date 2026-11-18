import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { ah, HttpError, now, audit, insertId, projectCalendar } from '../util.js';
import { requireLogin, requireAdmin } from '../auth.js';
import { parseWorkbooks, buildExport } from '../excel.js';
import { recalc, stateOf } from '../schedule.js';
import { need, loadProject } from './projects.js';
import { applyRecalc } from './tasks.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 10 } });

// ---- 엑셀 불러오기 ----
export const importRouter = Router({ mergeParams: true });
importRouter.use(requireLogin);

/**
 * POST /api/projects/:pid/import  (multipart: files[], dryRun=1)
 * ID(코드)가 같은 작업·이슈는 갱신, 없으면 추가. 기존 데이터는 지우지 않습니다.
 */
importRouter.post('/', upload.array('files'), ah(async (req, res) => {
  const pid = Number(req.params.pid);
  const project = await loadProject(pid);
  await need(req, pid, 'pm');
  if (!req.files?.length) throw new HttpError(400, '엑셀 파일을 선택하세요.');
  let parsed;
  try { parsed = parseWorkbooks(req.files.map(f => f.buffer)); }
  catch (e) { throw new HttpError(400, `엑셀을 읽지 못했습니다: ${e.message}`); }
  if (!parsed.sheets.length) throw new HttpError(400, '인식할 수 있는 시트가 없습니다. (계약 Detail 시트, 일정표_Schedule, 이슈로그_IssueLog, 또는 이 프로그램에서 내보낸 파일)');
  const dryRun = req.body?.dryRun === '1' || req.body?.dryRun === 'true';

  const summary = await db.transaction(async trx => {
    const sum = { sheets: parsed.sheets, phases: 0, tasksAdded: 0, tasksUpdated: 0, deps: 0, depsSkipped: [], issuesAdded: 0, issuesUpdated: 0, holidays: 0, shifted: 0 };
    // 공휴일
    for (const h of parsed.holidays) {
      const ex = await trx('holidays').where({ country: h.country, date: h.date }).first();
      if (!ex) { await trx('holidays').insert(h); sum.holidays++; }
    }
    if (parsed.holidays.length && !String(project.calendars).split(',').includes('VN')) {
      await trx('projects').where({ id: pid }).update({ calendars: [project.calendars, 'VN'].filter(Boolean).join(',') });
    }
    // 계약 일정 엑셀은 달력일 기준으로 계산되어 있으므로, 빈 프로젝트에 처음 불러올 때는 달력일 기준으로 맞춤
    const hasTasks = await trx('tasks').where({ project_id: pid }).first();
    if (!hasTasks && parsed.sheets.some(n => /Detail$/i.test(n)) && project.day_basis !== 'calendar') {
      await trx('projects').where({ id: pid }).update({ day_basis: 'calendar' });
      sum.dayBasis = 'calendar';
    }
    // 단계
    const phases = await trx('phases').where({ project_id: pid });
    const phaseId = new Map(phases.map(p => [p.name, p.id]));
    let sort = phases.reduce((m, p) => Math.max(m, p.sort), -1);
    for (const name of parsed.phases) {
      if (!phaseId.has(name)) { phaseId.set(name, await insertId(trx, 'phases', { project_id: pid, name, sort: ++sort })); sum.phases++; }
    }
    // 작업 (코드 기준 갱신/추가)
    const existing = await trx('tasks').where({ project_id: pid });
    const byCode = new Map(existing.filter(t => t.code).map(t => [t.code, t]));
    let tsort = existing.reduce((m, t) => Math.max(m, t.sort), 0);
    const FIELDS = ['name', 'name_en', 'type', 'owner', 'start', 'end', 'baseline_end', 'actual_end', 'not_before', 'status', 'is_key', 'ref', 'note'];
    for (const t of parsed.tasks) {
      const row = { phase_id: t.phase ? phaseId.get(t.phase) : null };
      for (const f of FIELDS) if (t[f] !== undefined) row[f] = t[f] ?? null;
      if (row.status === '완료') row.progress = 100;
      const ex = t.code && byCode.get(t.code);
      if (ex) {
        await trx('tasks').where({ id: ex.id }).update({ ...row, version: ex.version + 1, updated_at: now(), updated_by: req.user.id });
        sum.tasksUpdated++;
      } else {
        const id = await insertId(trx, 'tasks', { ...row, code: t.code || null, project_id: pid, sort: ++tsort, updated_at: now(), updated_by: req.user.id });
        if (t.code) byCode.set(t.code, { id, code: t.code });
        sum.tasksAdded++;
      }
    }
    // 선행관계: 불러온 작업의 선행관계는 파일 내용으로 교체
    const succCodes = new Set(parsed.deps.map(d => d.succ));
    const succIds = [...succCodes].map(c => byCode.get(c)?.id).filter(Boolean);
    if (succIds.length) await trx('dependencies').where({ project_id: pid }).whereIn('succ_id', succIds).del();
    const seen = new Set();
    for (const d of parsed.deps) {
      const p = byCode.get(d.pred), s = byCode.get(d.succ);
      if (!p || !s || p.id === s.id) { sum.depsSkipped.push(`${d.pred} → ${d.succ}`); continue; }
      const key = `${p.id}-${s.id}-${d.kind}`; if (seen.has(key)) continue; seen.add(key);
      await trx('dependencies').insert({ project_id: pid, pred_id: p.id, succ_id: s.id, kind: d.kind, lag: d.lag });
      sum.deps++;
    }
    // 이슈
    const exIss = new Map((await trx('issues').where({ project_id: pid })).filter(i => i.code).map(i => [i.code, i]));
    for (const i of parsed.issues) {
      const { task, ...rest } = i;
      const row = { ...rest, task_id: task ? byCode.get(task)?.id ?? null : null };
      const ex = i.code && exIss.get(i.code);
      if (ex) { await trx('issues').where({ id: ex.id }).update({ ...row, version: ex.version + 1, updated_at: now(), updated_by: req.user.id }); sum.issuesUpdated++; }
      else { await insertId(trx, 'issues', { ...row, project_id: pid, updated_at: now(), updated_by: req.user.id }); sum.issuesAdded++; }
    }
    // 기준 일정이 비어 있으면 현재 일정으로 채움
    await trx('tasks').where({ project_id: pid }).whereNull('baseline_end').update({ baseline_start: trx.ref('start'), baseline_end: trx.ref('end') });
    await trx('tasks').where({ project_id: pid }).whereNull('baseline_start').update({ baseline_start: trx.ref('start') });
    // 선행관계 규칙과 엑셀 날짜가 다른 작업 수 (자동 조정 대상)
    if (dryRun) {
      const p2 = await trx('projects').where({ id: pid }).first();
      sum.shifted = recalc(await trx('tasks').where({ project_id: pid }), await trx('dependencies').where({ project_id: pid }), await projectCalendar(trx, p2)).length;
      throw Object.assign(new Error('dry-run'), { dryRunSummary: sum });
    }
    if (req.body?.recalc === '1') sum.shifted = (await applyRecalc(trx, pid, req.user)).length;
    await audit(trx, { user: req.user, projectId: pid, entity: 'project', entityId: pid, action: 'import', label: `엑셀 불러오기: ${req.files.map(f => Buffer.from(f.originalname, 'latin1').toString('utf8')).join(', ')} (작업 +${sum.tasksAdded}/갱신 ${sum.tasksUpdated}, 이슈 +${sum.issuesAdded}/갱신 ${sum.issuesUpdated})` });
    return sum;
  }).catch(e => { if (e.dryRunSummary) return { ...e.dryRunSummary, dryRun: true }; throw e; });
  res.json(summary);
}));

// ---- 엑셀 내보내기 ----
export const exportRouter = Router({ mergeParams: true });
exportRouter.use(requireLogin);
exportRouter.get('/', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  const project = await loadProject(pid);
  const [phases, tasks, deps, issues, users] = await Promise.all([
    db('phases').where({ project_id: pid }).orderBy('sort'),
    db('tasks').where({ project_id: pid }).orderBy([{ column: 'sort' }, { column: 'start' }]),
    db('dependencies').where({ project_id: pid }),
    db('issues').where({ project_id: pid }).orderBy('code'),
    db('users').select('id', 'name')
  ]);
  const buf = buildExport({ project, phases, tasks, deps, issues, users });
  const fname = `${project.name}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`);
  res.send(buf);
}));

// ---- 공휴일 ----
export const holidaysRouter = Router();
holidaysRouter.use(requireLogin);
holidaysRouter.get('/', ah(async (req, res) => {
  const q = db('holidays').orderBy('date');
  if (req.query.country) q.where({ country: req.query.country });
  res.json(await q);
}));
holidaysRouter.post('/', requireAdmin, ah(async (req, res) => {
  const { country, date, name } = req.body || {};
  if (!/^[A-Z]{2}$/.test(country || '') || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new HttpError(400, '국가 코드(KR, VN 등)와 날짜를 입력하세요.');
  if (await db('holidays').where({ country, date }).first()) throw new HttpError(400, '이미 등록된 날짜입니다.');
  const id = await insertId(db, 'holidays', { country, date, name: name || '' });
  await audit(null, { user: req.user, entity: 'holiday', entityId: id, action: 'create', label: `${country} ${date} ${name || ''}` });
  res.json(await db('holidays').where({ id }).first());
}));
holidaysRouter.delete('/:id', requireAdmin, ah(async (req, res) => {
  const h = await db('holidays').where({ id: Number(req.params.id) }).first();
  await db('holidays').where({ id: Number(req.params.id) }).del();
  await audit(null, { user: req.user, entity: 'holiday', entityId: h?.id, action: 'delete', label: h ? `${h.country} ${h.date} ${h.name}` : '' });
  res.json({ ok: true });
}));

// ---- 내 할 일 (홈 화면) ----
export const meRouter = Router();
meRouter.use(requireLogin);
meRouter.get('/work', ah(async (req, res) => {
  const t = new Date().toISOString().slice(0, 10);
  const projects = await db('projects').where({ archived: false });
  const pids = projects.map(p => p.id);
  const pname = new Map(projects.map(p => [p.id, p.name]));
  // 내게 배정된 것 + 담당 칸에 내 이름이 들어간 것
  const name = req.user.name;
  const tasks = (await db('tasks').whereIn('project_id', pids).andWhere(q => q.where('assignee_id', req.user.id).orWhere('owner', 'like', `%${name}%`)))
    .map(x => ({ ...x, is_key: !!x.is_key, project_name: pname.get(x.project_id), state: stateOf(x, t) }))
    .filter(x => x.state !== '완료');
  const issues = (await db('issues').whereIn('project_id', pids).whereNot('status', '해결완료').andWhere(q => q.where('assignee_id', req.user.id).orWhere('owner', 'like', `%${name}%`)))
    .map(x => ({ ...x, project_name: pname.get(x.project_id) }));
  res.json({ today: t, tasks, issues });
}));
