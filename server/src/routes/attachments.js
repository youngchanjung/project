// 현장 사진·첨부: 작업·이슈에 사진과 파일을 붙임. 파일은 data/attachments/<프로젝트 id>/ 에 저장
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { ah, HttpError, now, audit, insertId, isDate } from '../util.js';
import { requireLogin, projectRole } from '../auth.js';
import { need, loadProject } from './projects.js';

const tmpDir = () => path.join(config.attachDir, 'tmp');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => { fs.mkdirSync(tmpDir(), { recursive: true }); cb(null, tmpDir()); }
  }),
  limits: { fileSize: config.maxAttachMB * 1024 * 1024, files: 20 },
  defParamCharset: 'utf8' // 한글 파일 이름
});
// 실행될 수 있는 파일은 받지 않음
const BLOCK = ['.exe', '.bat', '.cmd', '.com', '.msi', '.ps1', '.vbs', '.js', '.jar', '.scr', '.html', '.htm', '.svg'];
const IMG = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp'];
export const projectDir = pid => path.join(config.attachDir, String(pid));
const filePath = a => path.join(projectDir(a.project_id), a.file);
const isImg = a => IMG.includes(path.extname(a.file).toLowerCase()) || String(a.mime || '').startsWith('image/');

export const attachmentsRouter = Router({ mergeParams: true });
attachmentsRouter.use(requireLogin);

async function canRead(req, pid) {
  const role = await projectRole(req.user, pid);
  if (!role) throw new HttpError(403, '참여하지 않은 프로젝트입니다.');
}
// 외부 협력자는 자기 작업에 붙은 것만
async function visibleTaskIds(req, pid) {
  if (!req.user.external) return null;
  const ts = await db('tasks').where({ project_id: pid }).where(q => q.where({ assignee_id: req.user.id }).orWhere({ reviewer_id: req.user.id })).select('id');
  return ts.map(t => t.id);
}
const out = (a, users) => ({ ...a, image: isImg(a), created_by_name: users?.get(a.created_by) || null });

async function load(req) {
  const pid = Number(req.params.pid), aid = Number(req.params.aid);
  await canRead(req, pid);
  const a = await db('attachments').where({ id: aid, project_id: pid }).first();
  if (!a) throw new HttpError(404, '첨부 파일을 찾을 수 없습니다.');
  const vis = await visibleTaskIds(req, pid);
  if (vis && !vis.includes(a.task_id)) throw new HttpError(404, '첨부 파일을 찾을 수 없습니다.');
  return a;
}

// 목록: ?task_id= ?issue_id= (없으면 프로젝트 전체)
attachmentsRouter.get('/', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await loadProject(pid);
  await canRead(req, pid);
  const q = db('attachments').where({ project_id: pid });
  if (req.query.task_id) q.where({ task_id: Number(req.query.task_id) });
  if (req.query.issue_id) q.where({ issue_id: Number(req.query.issue_id) });
  const vis = await visibleTaskIds(req, pid);
  if (vis) q.whereIn('task_id', vis.length ? vis : [0]);
  const rows = await q.orderBy([{ column: 'taken_on', order: 'desc' }, { column: 'id', order: 'desc' }]);
  const ids = [...new Set(rows.map(r => r.created_by).filter(Boolean))];
  const users = new Map((ids.length ? await db('users').whereIn('id', ids).select('id', 'name') : []).map(u => [u.id, u.name]));
  res.json(rows.map(r => out(r, users)));
}));

attachmentsRouter.get('/:aid/file', ah(async (req, res) => {
  const a = await load(req);
  const f = filePath(a);
  if (!fs.existsSync(f)) throw new HttpError(404, '파일이 서버에 없습니다.');
  const disp = req.query.download ? 'attachment' : (isImg(a) || /pdf$/i.test(a.file) ? 'inline' : 'attachment');
  res.sendFile(f, { headers: { 'Content-Disposition': `${disp}; filename*=UTF-8''${encodeURIComponent(a.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' } });
}));

// 올리기. multipart: files[] + task_id, issue_id, note, taken_on
attachmentsRouter.post('/', upload.array('files', 20), ah(async (req, res) => {
  const pid = Number(req.params.pid);
  const files = req.files || [];
  try {
    await loadProject(pid);
    await need(req, pid);
    if (!files.length) throw new HttpError(400, '올릴 파일을 고르세요.');
    const taskId = req.body.task_id ? Number(req.body.task_id) : null;
    const issueId = req.body.issue_id ? Number(req.body.issue_id) : null;
    if (taskId && !(await db('tasks').where({ id: taskId, project_id: pid }).first())) throw new HttpError(400, '작업을 찾을 수 없습니다.');
    if (issueId && !(await db('issues').where({ id: issueId, project_id: pid }).first())) throw new HttpError(400, '이슈를 찾을 수 없습니다.');
    const takenOn = isDate(req.body.taken_on) ? req.body.taken_on : new Date().toISOString().slice(0, 10);
    const note = String(req.body.note || '').trim().slice(0, 300) || null;
    for (const f of files) {
      const ext = path.extname(f.originalname || '').toLowerCase();
      if (BLOCK.includes(ext)) throw new HttpError(400, `${ext} 형식은 올릴 수 없습니다.`);
    }
    fs.mkdirSync(projectDir(pid), { recursive: true });
    const made = [];
    for (const f of files) {
      const ext = path.extname(f.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
      const id = await insertId(db, 'attachments', {
        project_id: pid, task_id: taskId, issue_id: issueId, file: 'pending', name: (f.originalname || 'file').slice(0, 300),
        mime: String(f.mimetype || '').slice(0, 120), size: f.size, note, taken_on: takenOn, created_by: req.user.id, created_at: now()
      });
      const file = `${id}${ext}`;
      fs.renameSync(f.path, path.join(projectDir(pid), file));
      await db('attachments').where({ id }).update({ file });
      made.push(await db('attachments').where({ id }).first());
    }
    const target = taskId ? (await db('tasks').where({ id: taskId }).first())?.name : issueId ? (await db('issues').where({ id: issueId }).first())?.title : '';
    await audit(null, { user: req.user, projectId: pid, entity: taskId ? 'task' : issueId ? 'issue' : 'project', entityId: taskId || issueId || pid, action: 'attach', label: `${target ? target + ': ' : ''}${made.map(a => a.name).join(', ')}`.slice(0, 300) });
    res.json(made.map(a => out(a, new Map([[req.user.id, req.user.name]]))));
  } finally {
    for (const f of files) if (f.path && fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
  }
}));

// 설명·촬영일·연결 작업 바꾸기
attachmentsRouter.patch('/:aid', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const a = await load(req);
  const up = {};
  if (req.body.note !== undefined) up.note = String(req.body.note || '').trim().slice(0, 300) || null;
  if (req.body.taken_on !== undefined) { if (!isDate(req.body.taken_on)) throw new HttpError(400, '날짜 형식이 올바르지 않습니다.'); up.taken_on = req.body.taken_on; }
  if (req.body.task_id !== undefined) {
    const t = req.body.task_id ? Number(req.body.task_id) : null;
    if (t && !(await db('tasks').where({ id: t, project_id: pid }).first())) throw new HttpError(400, '작업을 찾을 수 없습니다.');
    up.task_id = t;
  }
  if (Object.keys(up).length) await db('attachments').where({ id: a.id }).update(up);
  res.json(out(await db('attachments').where({ id: a.id }).first()));
}));

attachmentsRouter.delete('/:aid', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const a = await load(req);
  if (a.created_by !== req.user.id && !(await need(req, pid, 'pm').then(() => true, () => false))) throw new HttpError(403, '올린 사람이나 PM만 지울 수 있습니다.');
  await db('attachments').where({ id: a.id }).del();
  fs.rmSync(filePath(a), { force: true });
  await audit(null, { user: req.user, projectId: pid, entity: a.task_id ? 'task' : a.issue_id ? 'issue' : 'project', entityId: a.task_id || a.issue_id || pid, action: 'detach', label: a.name });
  res.json({ ok: true });
}));
