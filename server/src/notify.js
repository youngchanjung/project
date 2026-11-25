// 프로그램 안 알림 (상단 🔔). 문구는 화면에서 kind + params 로 만들어 언어별로 보여줌
//   task_assigned  작업 담당자로 지정됨        { name, code, by }
//   task_changed   내 작업 일정이 바뀜          { name, code, from, to, by, auto }
//   issue_assigned 이슈 담당자로 지정됨        { name, code, by }
//   issue_comment  내 이슈에 댓글              { name, code, by, text }
//   task_due       내 작업 마감 임박(3일 안)    { name, code, date }
//   task_late      내 작업 기한 초과            { name, code, date }
//   review_requested 칸반 검토 요청            { name, code, by }
//   review_approved / review_rejected 검토 결과 { name, code, by, note }
//   meeting_invited / meeting_changed 회의 참석 { name, date, time, location, by }
//   meeting_today  오늘 회의                    { name, time, location }
//   milestone_due  참여 프로젝트 마일스톤 D-7·D-1·당일 { name, date, days }
//   phase_due      참여 프로젝트 단계 제출일 D-7·D-1·당일, 미완료 할 일이 있을 때 { name, date, days, open, review }
import { db } from './db.js';
import { now, insertId } from './util.js';
import { queueMail } from './mailer.js';
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
    const id = await insertId(k, 'notifications', {
      user_id: uid, kind, project_id: projectId ?? null, entity, entity_id: entityId ?? null,
      params: JSON.stringify(params || {}), created_at: now(), dedupe: key
    });
    queueMail(id); // 메일 알림이 설정돼 있으면 저장된 뒤 메일로도
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
    if (st === '완료' || st === '보류' || t.undated) continue;
    const params = { name: t.name, code: t.code, date: t.end };
    if (st === '지연') await notify(null, [user.id], { kind: 'task_late', projectId: t.project_id, entity: 'task', entityId: t.id, params, dedupe: `late:${t.id}:${t.end}` });
    else if (t.end >= today && t.end <= soon) await notify(null, [user.id], { kind: 'task_due', projectId: t.project_id, entity: 'task', entityId: t.id, params, dedupe: `due:${t.id}:${t.end}` });
  }
}

// 하루 한 번(사용자별): 참여 프로젝트의 마일스톤(7일 전·1일 전·당일), 내가 참석하는 오늘 회의
export async function dailySchedule(user) {
  const today = new Date().toISOString().slice(0, 10);
  const pids = (await db('project_members as m').join('projects as p', 'p.id', 'm.project_id')
    .where({ 'm.user_id': user.id, 'p.archived': false }).select('p.id')).map(r => r.id);
  if (!pids.length) return;
  const days = [0, 1, 7].map(n => addDays(today, n));
  const ms = await db('tasks').whereIn('project_id', pids).whereIn('type', ['마일스톤', '제출']).where({ undated: false })
    .whereIn('end', days).whereNot('status', '완료');
  for (const t of ms) {
    const n = days.indexOf(t.end);
    await notify(null, [user.id], { kind: 'milestone_due', projectId: t.project_id, entity: 'task', entityId: t.id,
      params: { name: t.name, date: t.end, days: [0, 1, 7][n] }, dedupe: `ms:${t.id}:${t.end}:${[0, 1, 7][n]}` });
  }
  // 단계 제출일: 그 단계에 아직 끝나지 않은 할 일이 있으면 알림
  const phs = await db('phases').whereIn('project_id', pids).whereIn('due', days);
  for (const ph of phs) {
    const open = await db('tasks').where({ phase_id: ph.id }).whereNot('status', '완료').whereNull('actual_end').whereNot('status', '보류').select('review_state');
    if (!open.length) continue;
    const n = [0, 1, 7][days.indexOf(ph.due)];
    await notify(null, [user.id], { kind: 'phase_due', projectId: ph.project_id, entity: 'phase', entityId: ph.id,
      params: { name: ph.name, date: ph.due, days: n, open: open.length, review: open.filter(t => t.review_state === 'requested').length }, dedupe: `ph:${ph.id}:${ph.due}:${n}` });
  }
  const meets = await db('tasks').whereIn('project_id', pids).where({ type: '회의', undated: false, start: today });
  for (const t of meets) {
    if (!String(t.attendees || '').split(',').map(Number).includes(user.id)) continue;
    await notify(null, [user.id], { kind: 'meeting_today', projectId: t.project_id, entity: 'task', entityId: t.id,
      params: { name: t.name, time: t.start_time, location: t.location }, dedupe: `mt:${t.id}:${today}` });
  }
}
