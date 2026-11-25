// 회의록: 녹음 올리기 → 음성인식(리턴제로) → AI 정리(Claude) → 작업·이슈로 등록(화면에서)
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { ah, HttpError, now, audit, insertId, pick } from '../util.js';
import { requireLogin } from '../auth.js';
import { need, loadProject } from './projects.js';
import { sttEnabled, startTranscribe, getTranscribe, STT_EXT, MEETING_LANGS } from '../stt.js';
import { aiEnabled, summarizeMeeting, transcriptText } from '../minutesAI.js';

// 테스트에서 바꿔 끼울 수 있게 외부 호출을 한곳에 모음
export const engines = {
  sttEnabled, aiEnabled,
  start: startTranscribe, get: getTranscribe, summarize: summarizeMeeting,
  pollMs: Number(process.env.MEETING_POLL_MS || 5000)
};

const BUSY = ['transcribing', 'summarizing'];
const tmpDir = () => path.join(config.meetingsDir, 'tmp');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => { fs.mkdirSync(tmpDir(), { recursive: true }); cb(null, tmpDir()); }
  }),
  limits: { fileSize: config.maxAudioMB * 1024 * 1024, files: 1 },
  defParamCharset: 'utf8' // 한글 파일 이름
});
const audioPath = m => path.join(config.meetingsDir, m.audio_file);
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function out(m, full) {
  const r = {
    ...m,
    has_audio: !!m.audio_file,
    speakers: parse(m.speakers, {}),
    summary: parse(m.summary, null)
  };
  delete r.audio_file; delete r.stt_job_id;
  if (full) r.transcript = parse(m.transcript, []);
  else { delete r.transcript; delete r.notes; }
  return r;
}

async function update(id, row) {
  await db('meetings').where({ id }).update({ ...row, updated_at: now() });
}

// ---- 처리 단계 (서버 안에서 백그라운드로) ----
const polling = new Set();

async function runStt(id) {
  const m = await db('meetings').where({ id }).first();
  if (!m?.audio_file) return;
  try {
    const job = await engines.start(audioPath(m), m.language);
    await update(id, { status: 'transcribing', stt_job_id: job, error: null });
    schedulePoll(id);
  } catch (e) {
    await update(id, { status: 'error', error: e.message });
  }
}

function schedulePoll(id, delay = engines.pollMs, fails = 0) {
  polling.add(id);
  setTimeout(async () => {
    let m;
    try {
      m = await db('meetings').where({ id }).first();
      if (!m || m.status !== 'transcribing' || !m.stt_job_id) { polling.delete(id); return; }
      const r = await engines.get(m.stt_job_id);
      if (r.status === 'transcribing') return schedulePoll(id, engines.pollMs, 0);
      polling.delete(id);
      if (r.status === 'failed') return update(id, { status: 'error', error: r.error || '음성인식에 실패했습니다.' });
      const last = r.utterances.at(-1);
      await update(id, {
        status: 'transcribed', error: null, transcript: JSON.stringify(r.utterances),
        duration_ms: last ? last.t + last.d : 0
      });
      if (engines.aiEnabled()) await runSummary(id, null);
    } catch (e) {
      // 일시적인 오류(네트워크·서버)는 간격을 늘려 다시 조회, 5번 연속 실패하면 중단
      if (fails < 5 && (e.retry || !e.status)) return schedulePoll(id, Math.min(engines.pollMs * 2 ** (fails + 1), 300e3), fails + 1);
      polling.delete(id);
      await update(id, { status: 'error', error: e.message }).catch(() => {});
    }
  }, delay).unref?.();
}

async function runSummary(id, lang) {
  const m = await db('meetings').where({ id }).first();
  if (!m) return;
  const project = await db('projects').where({ id: m.project_id }).first();
  const members = await db('project_members as pm').join('users as u', 'u.id', 'pm.user_id').where('pm.project_id', m.project_id).select('u.name');
  const prevStatus = m.transcript ? 'transcribed' : m.audio_file ? 'uploaded' : 'draft';
  const outLang = lang || parse(m.summary, null)?._lang || (m.language === 'vi' || m.language === 'en' ? m.language : 'ko');
  await update(id, { status: 'summarizing', error: null });
  try {
    const transcript = transcriptText(parse(m.transcript, []), parse(m.speakers, {}));
    const summary = await engines.summarize({ meeting: m, project, members, transcript, notes: m.notes, outLang });
    await update(id, { status: 'done', summary: JSON.stringify(summary), summarized_at: now(), error: null });
  } catch (e) {
    console.error('회의록 AI 정리 실패', id, e.message);
    await update(id, { status: prevStatus, error: e.message });
  }
}

// 서버가 다시 시작되면 진행 중이던 음성인식·정리를 이어서
export async function resumeMeetings() {
  const rows = await db('meetings').whereIn('status', BUSY).select('id', 'status', 'stt_job_id');
  for (const r of rows) {
    if (r.status === 'transcribing' && r.stt_job_id) schedulePoll(r.id, 1000);
    else if (r.status === 'summarizing') runSummary(r.id, null);
  }
}

// ---- API ----
export const meetingStatusRouter = Router();
meetingStatusRouter.use(requireLogin);
meetingStatusRouter.get('/status', (_req, res) => res.json({ stt: engines.sttEnabled(), ai: engines.aiEnabled(), maxMB: config.maxAudioMB, formats: STT_EXT }));

export const meetingsRouter = Router({ mergeParams: true });
meetingsRouter.use(requireLogin);

async function loadMeeting(req) {
  const pid = Number(req.params.pid), mid = Number(req.params.mid);
  const m = await db('meetings').where({ id: mid, project_id: pid }).first();
  if (!m) throw new HttpError(404, '회의록이 없습니다.');
  return m;
}

function cleanFields(body, partial) {
  const f = pick(body || {}, ['title', 'held_at', 'attendees', 'language', 'notes']);
  if (!partial || f.title !== undefined) {
    if (!String(f.title || '').trim()) throw new HttpError(400, '회의 제목을 입력하세요.');
    f.title = String(f.title).trim().slice(0, 300);
  }
  if (f.held_at !== undefined && f.held_at !== null && f.held_at !== '' && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(f.held_at)) throw new HttpError(400, '회의 일시 형식이 올바르지 않습니다.');
  if (f.held_at === '') f.held_at = null;
  if (f.language !== undefined && !MEETING_LANGS.includes(f.language)) throw new HttpError(400, '지원하지 않는 회의 언어입니다.');
  return f;
}

meetingsRouter.get('/', ah(async (req, res) => {
  const rows = await db('meetings as m').leftJoin('users as u', 'u.id', 'm.created_by')
    .where('m.project_id', Number(req.params.pid)).orderBy([{ column: 'm.held_at', order: 'desc' }, { column: 'm.id', order: 'desc' }])
    .select('m.*', 'u.name as created_by_name');
  res.json(rows.map(r => out(r, false)));
}));

meetingsRouter.get('/:mid', ah(async (req, res) => {
  const m = await loadMeeting(req);
  const u = m.created_by ? await db('users').where({ id: m.created_by }).first() : null;
  res.json({ ...out(m, true), created_by_name: u?.name || null });
}));

meetingsRouter.get('/:mid/audio', ah(async (req, res) => {
  const m = await loadMeeting(req);
  if (!m.audio_file || !fs.existsSync(audioPath(m))) throw new HttpError(404, '녹음 파일이 없습니다.');
  res.sendFile(audioPath(m), { headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(m.audio_name || m.audio_file)}` } });
}));

// 새 회의록 (녹음 파일은 선택). multipart: audio + title, held_at, attendees, language, notes
meetingsRouter.post('/', upload.single('audio'), ah(async (req, res) => {
  const pid = Number(req.params.pid);
  const tmp = req.file?.path;
  try {
    await loadProject(pid);
    await need(req, pid);
    const f = cleanFields(req.body, false);
    let ext = null;
    if (req.file) {
      ext = path.extname(req.file.originalname || '').toLowerCase();
      if (!STT_EXT.includes(ext)) throw new HttpError(400, `녹음 파일은 ${STT_EXT.join(', ')} 형식만 올릴 수 있습니다.`);
    }
    const id = await insertId(db, 'meetings', {
      ...f, language: f.language || 'ko', project_id: pid,
      status: req.file ? (engines.sttEnabled() ? 'transcribing' : 'uploaded') : 'draft',
      audio_name: req.file ? req.file.originalname.slice(0, 300) : null,
      audio_size: req.file?.size ?? null,
      created_by: req.user.id, created_at: now(), updated_at: now(), updated_by: req.user.id
    });
    if (req.file) {
      const name = `${id}${ext}`;
      fs.renameSync(tmp, path.join(config.meetingsDir, name));
      await db('meetings').where({ id }).update({ audio_file: name });
    }
    await audit(null, { user: req.user, projectId: pid, entity: 'meeting', entityId: id, action: 'create', label: f.title });
    if (req.file && engines.sttEnabled()) runStt(id);
    res.json(out(await db('meetings').where({ id }).first(), true));
  } finally {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
}));

// 내용 수정: 기본 정보·메모·화자 이름·AI 정리 결과(사람이 고친 내용)
meetingsRouter.patch('/:mid', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const m = await loadMeeting(req);
  if (req.body?.version !== undefined && Number(req.body.version) !== m.version) {
    throw new HttpError(409, '다른 사람이 먼저 이 회의록을 수정했습니다. 새로고침 후 다시 시도하세요.');
  }
  const up = cleanFields(req.body, true);
  if (req.body?.speakers !== undefined) {
    const s = req.body.speakers || {};
    up.speakers = JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k, v]) => /^\d+$/.test(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 50)])));
  }
  if (req.body?.summary !== undefined) {
    if (req.body.summary !== null && typeof req.body.summary !== 'object') throw new HttpError(400, '정리 내용 형식이 올바르지 않습니다.');
    up.summary = req.body.summary ? JSON.stringify(req.body.summary) : null;
  }
  if (!Object.keys(up).length) return res.json(out(m, true));
  await db('meetings').where({ id: m.id }).update({ ...up, version: m.version + 1, updated_at: now(), updated_by: req.user.id });
  await audit(null, { user: req.user, projectId: pid, entity: 'meeting', entityId: m.id, action: 'update', label: up.title || m.title });
  res.json(out(await db('meetings').where({ id: m.id }).first(), true));
}));

// 음성인식 다시 하기 (언어를 바꿨거나 실패했을 때)
meetingsRouter.post('/:mid/transcribe', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const m = await loadMeeting(req);
  if (!engines.sttEnabled()) throw new HttpError(503, '음성인식 기능이 꺼져 있습니다. 관리자에게 리턴제로 API 키 설정을 요청하세요.');
  if (!m.audio_file) throw new HttpError(400, '녹음 파일이 없는 회의록입니다.');
  if (BUSY.includes(m.status)) throw new HttpError(409, '이미 처리 중입니다. 잠시 기다려 주세요.');
  await update(m.id, { status: 'transcribing', stt_job_id: null, error: null });
  runStt(m.id);
  res.json({ ok: true, status: 'transcribing' });
}));

// AI 정리 (다시) 하기. body: { lang: 'ko'|'vi'|'en' } 정리 결과를 쓸 언어
meetingsRouter.post('/:mid/summarize', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const m = await loadMeeting(req);
  if (!engines.aiEnabled()) throw new HttpError(503, 'AI 정리 기능이 꺼져 있습니다. 관리자에게 Claude API 키 설정을 요청하세요.');
  if (BUSY.includes(m.status)) throw new HttpError(409, '이미 처리 중입니다. 잠시 기다려 주세요.');
  if (!m.transcript && !String(m.notes || '').trim()) throw new HttpError(400, '정리할 내용이 없습니다. 녹음을 올리거나 메모를 적어 주세요.');
  const lang = ['ko', 'vi', 'en'].includes(req.body?.lang) ? req.body.lang : null;
  runSummary(m.id, lang);
  await audit(null, { user: req.user, projectId: pid, entity: 'meeting', entityId: m.id, action: 'update', label: `${m.title} AI 정리` });
  res.json({ ok: true, status: 'summarizing' });
}));

meetingsRouter.delete('/:mid', ah(async (req, res) => {
  const pid = Number(req.params.pid);
  await need(req, pid);
  const m = await loadMeeting(req);
  await db('meetings').where({ id: m.id }).del();
  if (m.audio_file) fs.rmSync(audioPath(m), { force: true });
  await audit(null, { user: req.user, projectId: pid, entity: 'meeting', entityId: m.id, action: 'delete', label: m.title });
  res.json({ ok: true });
}));
