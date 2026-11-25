import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError, now, audit, insertId, pick, diff, optDate } from '../util.js';
import { requireLogin } from '../auth.js';
import { need, loadProject } from './projects.js';

import { notify, recipientsOf } from '../notify.js';
import { queueChannel } from '../teams.js';

export const issuesRouter = Router({ mergeParams: true });
issuesRouter.use(requireLogin);

export const ISSUE_STATUS = ['접수', '검토중', '조치중', '해결완료', '보류'];
export const PRIORITY = ['상', '중', '하'];
const COLS = ['code', 'task_id', 'category', 'title', 'detail', 'raised', 'target', 'resolved', 'party', 'owner', 'assignee_id', 'priority', 'status', 'source', 'remark'];

function clean(body, partial) {
  const i = pick(body || {}, COLS);
  for (const f of ['raised', 'target', 'resolved']) if (i[f] !== undefined) i[f] = optDate(i[f], f);
  if (!partial || i.title !== undefined) {
    if (!String(i.title || '').trim()) throw new HttpError(400, '이슈 내용을 입력하세요.');
    i.title = String(i.title).trim();
  }
  if (i.status !== undefined && !ISSUE_STATUS.includes(i.status)) throw new HttpError(400, `현황은 ${ISSUE_STATUS.join('/')} 중 하나입니다.`);
  if (i.priority !== undefined && !PRIORITY.includes(i.priority)) throw new HttpError(400, '중요도는 상/중/하 중 하나입니다.');
  for (const f of ['task_id', 'assignee_id']) if (i[f] !== undefined) i[f] = i[f] ? Number(i[f]) : null;
  return i;
}

async function nextCode(trx, pid) {
  const rows = await trx('issues').where({ project_id: pid }).select('code');
  const n = rows.reduce((m, r) => Math.max(m, Number(String(r.code || '').match(/(\d+)$/)?.[1] || 0)), 0);
  return `ISS-${String(n + 1).padStart(3, '0')}`;
}

issuesRouter.post('/', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await loadProject(pid);
  await need(req, pid);
  const i = clean(req.body, false);
  const id = await db.transaction(async trx => {
    if (i.task_id && !(await trx('tasks').where({ id: i.task_id, project_id: pid }).first())) throw new HttpError(400, '관련 작업이 이 프로젝트에 없습니다.');
    if (!i.code) i.code = await nextCode(trx, pid);
    if (!i.raised) i.raised = new Date().toISOString().slice(0, 10);
    const id = await insertId(trx, 'issues', { ...i, project_id: pid, updated_at: now(), updated_by: req.user.id });
    await audit(trx, { user: req.user, projectId: pid, entity: 'issue', entityId: id, action: 'create', label: `${i.code} ${i.title}` });
    await notify(trx, await recipientsOf(trx, i), { kind: 'issue_assigned', projectId: pid, entity: 'issue', entityId: id, actorId: req.user.id, params: { name: i.title, code: i.code, by: req.user.name } });
    return id;
  });
  const row = await db('issues').where({ id }).first();
  queueChannel({ kind: 'issue_created', projectId: pid, entity: 'issue', entityId: id, params: { name: row.title, code: row.code, by: req.user.name } });
  res.json(row);
}));

issuesRouter.patch('/:iid', ah(async (req, res) => {
  const pid = Number(req.params.pid), iid = Number(req.params.iid);
  await need(req, pid);
  const up = clean(req.body, true);
  await db.transaction(async trx => {
    const before = await trx('issues').where({ id: iid, project_id: pid }).first();
    if (!before) throw new HttpError(404, '이슈가 없습니다.');
    if (req.body.version !== undefined && Number(req.body.version) !== before.version) {
      throw new HttpError(409, '다른 사람이 먼저 이 이슈를 수정했습니다. 새로고침 후 다시 시도하세요.', { current: before });
    }
    if (up.status === '해결완료' && !before.resolved && up.resolved === undefined) up.resolved = new Date().toISOString().slice(0, 10);
    if (up.status && up.status !== '해결완료' && before.status === '해결완료' && up.resolved === undefined) up.resolved = null;
    const ch = diff(before, up);
    if (!Object.keys(ch).length) return;
    await trx('issues').where({ id: iid }).update({ ...up, version: before.version + 1, updated_at: now(), updated_by: req.user.id });
    await audit(trx, { user: req.user, projectId: pid, entity: 'issue', entityId: iid, action: 'update', label: `${before.code} ${up.title || before.title}`, changes: ch });
    const after = { ...before, ...up }, oldR = new Set(await recipientsOf(trx, before));
    await notify(trx, (await recipientsOf(trx, after)).filter(u => !oldR.has(u)), { kind: 'issue_assigned', projectId: pid, entity: 'issue', entityId: iid, actorId: req.user.id, params: { name: after.title, code: after.code, by: req.user.name } });
  });
  res.json(await db('issues').where({ id: iid }).first());
}));

issuesRouter.delete('/:iid', ah(async (req, res) => {
  const pid = Number(req.params.pid), iid = Number(req.params.iid);
  await need(req, pid);
  const i = await db('issues').where({ id: iid, project_id: pid }).first();
  if (!i) throw new HttpError(404, '이슈가 없습니다.');
  await db('issue_comments').where({ issue_id: iid }).del();
  await db('attachments').where({ issue_id: iid }).update({ issue_id: null }); // 현장 사진은 남김
  await db('issues').where({ id: iid }).del();
  await audit(null, { user: req.user, projectId: pid, entity: 'issue', entityId: iid, action: 'delete', label: `${i.code} ${i.title}` });
  res.json({ ok: true });
}));

// ---- 댓글 (조회자도 댓글은 가능) ----
issuesRouter.get('/:iid/comments', ah(async (req, res) => {
  const rows = await db('issue_comments as c').leftJoin('users as u', 'u.id', 'c.user_id')
    .where('c.issue_id', Number(req.params.iid)).orderBy('c.id').select('c.*', 'u.name as user_name');
  res.json(rows);
}));
issuesRouter.post('/:iid/comments', ah(async (req, res) => {
  const pid = Number(req.params.pid), iid = Number(req.params.iid);
  const body = String(req.body?.body || '').trim();
  if (!body) throw new HttpError(400, '내용을 입력하세요.');
  const i = await db('issues').where({ id: iid, project_id: pid }).first();
  if (!i) throw new HttpError(404, '이슈가 없습니다.');
  const id = await insertId(db, 'issue_comments', { issue_id: iid, user_id: req.user.id, body, created_at: now() });
  await audit(null, { user: req.user, projectId: pid, entity: 'issue', entityId: iid, action: 'comment', label: `${i.code} 댓글: ${body.slice(0, 80)}` });
  // 이슈 담당자와 앞서 댓글을 단 사람에게
  const earlier = (await db('issue_comments').where({ issue_id: iid }).distinct('user_id')).map(r => r.user_id);
  await notify(null, [...await recipientsOf(null, i), ...earlier], { kind: 'issue_comment', projectId: pid, entity: 'issue', entityId: iid, actorId: req.user.id, params: { name: i.title, code: i.code, by: req.user.name, text: body.slice(0, 120) } });
  res.json({ id, issue_id: iid, user_id: req.user.id, user_name: req.user.name, body, created_at: now() });
}));
