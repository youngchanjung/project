// 프로그램 안 알림 (상단 🔔). 문구는 화면에서 kind + params 로 만들어 언어별로 보여줌
//   task_assigned  작업 담당자로 지정됨        { name, code, by }
//   task_changed   내 작업 일정이 바뀜          { name, code, from, to, by, auto }
//   issue_assigned 이슈 담당자로 지정됨        { name, code, by }
//   issue_comment  내 이슈에 댓글              { name, code, by, text }
//   task_due       내 작업 마감 임박(3일 안)    { name, code, date }
//   task_late      내 작업 기한 초과            { name, code, date }
import { db } from './db.js';
import { now } from './util.js';
import { stateOf, addDays } from './schedule.js';

// 담당자 계정 + 담당 칸에 이름이 들어간 사람 (홈 '내 작업'과 같은 규칙)
export async function recipientsOf(trx, row) {
  const ids = new Set();
  if (row.assignee_id) ids.add(row.assignee_id);
  const owner = String(row.owner || '');
  if (owner) {
    const users = await (trx || db)('users').where({ active: true }).select('id', 'name');
    for (const u of users) if (u.name && u.name.length >= 2 && owner.includes(u.name)) ids.add(u.id);
  }
  return [...ids];
}

// dedupe 가 같은 알림은 한 번만 만듦 (마감 알림 등)
export async function notify(trx, userIds, { kind, projectId, entity, entityId, params, actorId, dedupe }) {
  const k = trx || db;
  for (const uid of new Set(userIds)) {
    if (!uid || uid === actorId) continue;
    const key = dedupe ? `${dedupe}:${uid}` : null;
    if (key && await k('notifications').where({ dedupe: key }).first()) continue;
    await k('notifications').insert({
      user_id: uid, kind, project_id: projectId ?? null, entity, entity_id: entityId ?? null,
      params: JSON.stringify(params || {}), created_at: now(), dedupe: key
    });
  }
}

// 하루 한 번(사용자별): 내 작업 중 3일 안에 마감하거나 기한이 지난 것
export async function dailyDue(user) {
  const today = new Date().toISOString().slice(0, 10);
  const live = (await db('projects').where({ archived: false }).select('id')).map(p => p.id);
  if (!live.length) return;
  const tasks = await db('tasks').whereIn('project_id', live)
    .andWhere(q => q.where('assignee_id', user.id).orWhere('owner', 'like', `%${user.name}%`));
  const soon = addDays(today, 3);
  for (const t of tasks) {
    const st = stateOf(t, today);
    if (st === '완료' || st === '보류') continue;
    const params = { name: t.name, code: t.code, date: t.end };
    if (st === '지연') await notify(null, [user.id], { kind: 'task_late', projectId: t.project_id, entity: 'task', entityId: t.id, params, dedupe: `late:${t.id}:${t.end}` });
    else if (t.end >= today && t.end <= soon) await notify(null, [user.id], { kind: 'task_due', projectId: t.project_id, entity: 'task', entityId: t.id, params, dedupe: `due:${t.id}:${t.end}` });
  }
}
