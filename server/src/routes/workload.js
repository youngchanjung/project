// GET /api/workload?project=ID&weeks=4  사람별 주간 업무량 (모든 진행 중 프로젝트 합산, 이 프로젝트 몫 따로)
import { Router } from 'express';
import { db } from '../db.js';
import { ah, holidaySet } from '../util.js';
import { requireLogin } from '../auth.js';
import { loadProject } from './projects.js';
import { computeWorkload, leaveByWeek } from '../workload.js';

export const workloadRouter = Router();
workloadRouter.use(requireLogin);

const ymd = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };

workloadRouter.get('/', ah(async (req, res) => {
  const here = req.query.project ? Number(req.query.project) : null;
  const p = here ? await loadProject(here) : null;
  const weeks = Math.min(Math.max(Number(req.query.weeks) || 4, 1), 12);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(req.query.today || '') ? req.query.today : ymd();
  const hol = await holidaySet(db, p?.calendars || 'KR');
  const live = db('projects').where({ archived: false }).select('id');
  const tasks = await db('tasks').whereIn('project_id', live).whereNot('status', '완료').whereNull('actual_end')
    .select('id', 'project_id', 'assignee_id', 'name', 'start', 'end', 'undated', 'est_hours', 'status', 'actual_end', 'type')
    .then(rs => rs.filter(t => t.type !== '회의').map(t => ({ ...t, undated: !!t.undated })));
  // 사람: 이 프로젝트 참여자 + 이 프로젝트 할 일 담당자 (프로젝트 없이 부르면 할 일이 있는 모든 사람)
  let ids;
  if (here) {
    const mem = await db('project_members').where({ project_id: here }).select('user_id');
    ids = new Set([...mem.map(m => m.user_id), ...tasks.filter(t => t.project_id === here && t.assignee_id).map(t => t.assignee_id)]);
  } else ids = new Set(tasks.filter(t => t.assignee_id).map(t => t.assignee_id));
  if (req.user.external) ids = new Set([req.user.id]);
  const mine = tasks.filter(t => (t.assignee_id ? ids.has(t.assignee_id) : t.project_id === here));
  const { weeks: ws, byUser } = computeWorkload(mine, { today, weeks, hol, here });
  const users = ids.size ? await db('users').whereIn('id', [...ids]).select('id', 'name', 'weekly_hours', 'active') : [];
  const pnames = new Map((await db('projects').select('id', 'name')).map(x => [x.id, x.name]));
  const empty = () => ({ weeks: ws.map(() => ({ hours: 0, here: 0, count: 0, noEst: 0, tasks: [] })), undated: { count: 0, hours: 0 } });
  const withNames = r => ({ ...r, weeks: r.weeks.map(c => ({ ...c, tasks: c.tasks.map(t => ({ ...t, project_name: pnames.get(t.project_id) || '' })) })) });
  const leaves = ids.size ? await db('leaves').whereIn('user_id', [...ids]).where('end', '>=', ws[0].start).where('start', '<=', ws[ws.length - 1].end) : [];
  const rows = users.filter(u => u.active || byUser.has(u.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(u => {
    const wh = Number(u.weekly_hours) || 40;
    const lv = leaveByWeek(leaves.filter(l => l.user_id === u.id), ws, hol, wh / 5);
    return { user: { id: u.id, name: u.name }, weekly_hours: wh, leave: lv,
      caps: ws.map((w, i) => Math.max(0, Math.round((wh * w.workdays / 5 - lv[i].hours) * 10) / 10)), ...withNames(byUser.get(u.id) || empty()) };
  });
  const un = byUser.get(0);
  res.json({ today, weeks: ws, rows, unassigned: here && un && !req.user.external ? withNames(un) : null });
}));
