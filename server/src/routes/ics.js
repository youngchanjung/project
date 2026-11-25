// Outlook·구글 달력에서 "인터넷 달력 구독"으로 쓰는 ICS 피드
//   GET /api/me/calendar        내 구독 주소 (없으면 만듦)
//   POST /api/me/calendar/reset 주소 새로 만들기 (예전 주소는 더 이상 안 됨)
//   GET /ics/:token/mine.ics            내 작업·이슈
//   GET /ics/:token/project-:pid.ics    프로젝트 전체 작업
// 달력 프로그램은 로그인 쿠키를 보낼 수 없으므로, 주소에 든 개인 토큰으로 사용자를 확인합니다.
import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { ah, HttpError } from '../util.js';
import { requireLogin, visibleProjects, projectRole } from '../auth.js';
import { stateOf, addDays } from '../schedule.js';
import { translateMsg } from '../i18n.js';

const newToken = () => crypto.randomBytes(24).toString('hex');

async function tokenOf(user, reset) {
  if (!reset) {
    const u = await db('users').where({ id: user.id }).first();
    if (u.ics_token) return u.ics_token;
  }
  const token = newToken();
  await db('users').where({ id: user.id }).update({ ics_token: token });
  return token;
}

// PUBLIC_URL(.env)을 정하면 그 주소로, 아니면 지금 접속한 주소로 만듦 (서버 PC에서 localhost 로 열었을 때 대비)
const base = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const feedInfo = async (req, token) => {
  const projects = await visibleProjects(req.user, await db('projects').where({ archived: false }).orderBy('name').select('id', 'name', 'code', 'category'));
  return {
    mine: `${base(req)}/ics/${token}/mine.ics`,
    projects: projects.map(p => ({ id: p.id, name: p.name, code: p.code, url: `${base(req)}/ics/${token}/project-${p.id}.ics` }))
  };
};

export const calendarRouter = Router();
calendarRouter.use(requireLogin);
calendarRouter.get('/', ah(async (req, res) => res.json(await feedInfo(req, await tokenOf(req.user, false)))));
calendarRouter.post('/reset', ah(async (req, res) => res.json(await feedInfo(req, await tokenOf(req.user, true)))));

// ---- ICS 만들기 (RFC 5545) ----
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// 한 줄 75바이트 넘으면 접기 (UTF-8 글자 중간에서 자르지 않음)
function fold(line) {
  const out = []; let cur = '', n = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const ymd = d => d.replace(/-/g, '');
const stamp = iso => { const d = iso ? new Date(iso) : new Date(); return (isNaN(d) ? new Date() : d).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); };

function calendar(name, events) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RnD Schedule//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Asia/Seoul', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const e of events) {
    // 시각이 있는 회의는 시각 일정(회사 시간대 기준, 끝 시각이 없으면 1시간), 그 밖에는 하루 종일 일정
    const when = e.time
      ? [`DTSTART:${ymd(e.start)}T${e.time.replace(':', '')}00`, `DTEND:${ymd(e.start)}T${(e.endTime && e.endTime > e.time ? e.endTime : plus1h(e.time)).replace(':', '')}00`]
      : [`DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(addDays(e.end, 1))}`];
    L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(e.updated)}`, ...when,
      `SUMMARY:${esc(e.summary)}`, `DESCRIPTION:${esc(e.description)}`, `SEQUENCE:${e.seq || 0}`, e.time ? 'TRANSP:OPAQUE' : 'TRANSP:TRANSPARENT');
    if (e.location) L.push(`LOCATION:${esc(e.location)}`);
    if (e.url) L.push(`URL:${e.url}`);
    if (e.categories) L.push(`CATEGORIES:${esc(e.categories)}`);
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

const plus1h = hm => { const [h, m] = hm.split(':').map(Number); return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${h >= 23 ? '59' : String(m).padStart(2, '0')}`; };
const STATE_MARK = { 완료: '✓ ', 지연: '⚠ ', 보류: '⏸ ' };

function taskEvent(t, { req, lang, pname, phase, today }) {
  const T = s => translateMsg(s, lang);
  const st = stateOf(t, today);
  const desc = [
    pname && `${T('프로젝트')}: ${pname}`,
    phase && `${T('단계')}: ${phase}`,
    t.owner && `${T('담당')}: ${t.owner}`,
    `${T('상태')}: ${T(st)}${t.progress ? ` (${t.progress}%)` : ''}`,
    t.baseline_end && t.baseline_end !== t.end && `${T('기준 종료')}: ${t.baseline_end}`,
    t.meeting_url && `${T('회의 링크')}: ${t.meeting_url}`,
    t.note && `${T('비고')}: ${t.note}`
  ].filter(Boolean).join('\n');
  return {
    uid: `task-${t.id}@rnd-schedule`, updated: t.updated_at, seq: t.version, start: t.start, end: t.end || t.start,
    time: t.type === '회의' && t.start_time ? t.start_time : null, endTime: t.end_time, location: t.location,
    summary: `${STATE_MARK[st] || ''}${t.is_key ? '★ ' : ''}${t.code ? `[${t.code}] ` : ''}${t.name}`,
    description: desc, categories: pname,
    url: `${base(req)}/projects/${t.project_id}/tasks?open=${t.id}`
  };
}

async function userByToken(token) {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const u = await db('users').where({ ics_token: token }).first();
  return u && u.active ? u : null;
}

export const icsRouter = Router();
icsRouter.get('/:token/:file', ah(async (req, res) => {
  const u = await userByToken(req.params.token);
  if (!u) throw new HttpError(404, '구독 주소가 없거나 바뀌었습니다.');
  const lang = u.lang || 'ko', T = s => translateMsg(s, lang);
  const today = new Date().toISOString().slice(0, 10);
  const projects = await db('projects').select('id', 'name', 'archived');
  const pname = new Map(projects.map(p => [p.id, p.name]));
  const phases = new Map((await db('phases').select('id', 'name')).map(p => [p.id, p.name]));
  let name, events;

  if (req.params.file === 'mine.ics') {
    const live = projects.filter(p => !p.archived).map(p => p.id);
    const mine = q => q.where('assignee_id', u.id).orWhere('owner', 'like', `%${u.name}%`);
    const tasks = await db('tasks').whereIn('project_id', live).andWhere({ undated: false }).andWhere(mine);
    const issues = await db('issues').whereIn('project_id', live).whereNot('status', '해결완료').whereNotNull('target').andWhere(mine);
    name = `${T('내 작업')} · ${u.name}`;
    events = [
      ...tasks.map(t => taskEvent(t, { req, lang, pname: pname.get(t.project_id), phase: phases.get(t.phase_id), today })),
      ...issues.map(i => ({
        uid: `issue-${i.id}@rnd-schedule`, updated: i.updated_at, seq: i.version, start: i.target, end: i.target,
        summary: `${i.target < today ? '⚠ ' : ''}${T('이슈')} ${i.code || ''} ${i.title}`.replace(/\s+/g, ' '),
        description: [`${T('프로젝트')}: ${pname.get(i.project_id)}`, `${T('중요도')}: ${T(i.priority)}`, `${T('현황')}: ${T(i.status)}`, i.detail].filter(Boolean).join('\n'),
        categories: pname.get(i.project_id), url: `${base(req)}/projects/${i.project_id}/issues?open=${i.id}`
      }))
    ];
  } else {
    const m = req.params.file.match(/^project-(\d+)\.ics$/);
    const pid = m && Number(m[1]);
    if (!pid || !pname.has(pid) || !(await projectRole(u, pid))) throw new HttpError(404, '프로젝트가 없습니다.');
    const tasks = await db('tasks').where({ project_id: pid, undated: false });
    name = pname.get(pid);
    events = tasks.map(t => taskEvent(t, { req, lang, pname: null, phase: phases.get(t.phase_id), today }));
  }
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(calendar(name, events.filter(e => e.start)));
}));
