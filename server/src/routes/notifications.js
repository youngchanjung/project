// GET  /api/notifications        { items: [...최근 50개], unread }
// POST /api/notifications/read   { ids: [..] } 또는 { all: true }
import { Router } from 'express';
import { db } from '../db.js';
import { ah, now } from '../util.js';
import { requireLogin } from '../auth.js';
import { dailyDue, dailySchedule } from '../notify.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireLogin);

const lastDaily = new Map(); // user_id → 마지막으로 마감 알림을 만든 날짜
notificationsRouter.get('/', ah(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  if (lastDaily.get(req.user.id) !== today) { lastDaily.set(req.user.id, today); await dailyDue(req.user); await dailySchedule(req.user); }
  const rows = await db('notifications as n').leftJoin('projects as p', 'p.id', 'n.project_id')
    .where('n.user_id', req.user.id).orderBy('n.id', 'desc').limit(50).select('n.*', 'p.name as project_name');
  const [{ c }] = await db('notifications').where({ user_id: req.user.id }).whereNull('read_at').count({ c: '*' });
  res.json({ items: rows.map(r => ({ ...r, params: JSON.parse(r.params || '{}') })), unread: Number(c) });
}));
notificationsRouter.post('/read', ah(async (req, res) => {
  const q = db('notifications').where({ user_id: req.user.id }).whereNull('read_at');
  if (!req.body?.all) q.whereIn('id', (req.body?.ids || []).map(Number));
  await q.update({ read_at: now() });
  res.json({ ok: true });
}));
