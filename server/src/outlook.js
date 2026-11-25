// Outlook 일정 동기화 (앱 → Outlook 한 방향)
// - 회의(유형 '회의'): 담당자(없으면 마지막 수정자) 사서함에 일정을 만들고 참석자를 초대. 'Teams 회의 만들기'를 켜면 Teams 링크 자동 생성
// - 그 밖의 작업(M365_OUTLOOK_TASKS): 담당자 Outlook 달력에 종일 일정(바쁨 표시 안 함·알림 없음)
// 작업을 고치면 몇 초 뒤 그 프로젝트만 다시 맞추고, 30분마다 전체를 다시 확인(실패한 것 재시도)
// 앱에서 작업을 지우거나 프로젝트를 보관하면 Outlook 일정도 지움
import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { features, createEvent, updateEvent, deleteEvent } from './m365.js';
import { addDays } from './schedule.js';
import { log } from './mailer.js';
import { now } from './util.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sha = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const tzOf = p => config.m365.timeZone || (String(p.calendars || '').split(',')[0] === 'VN' ? 'SE Asia Standard Time' : 'Korea Standard Time');
const plusHour = hm => { const [h, m] = hm.split(':').map(Number); return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

// 이 작업이 들어가야 할 사서함 → 보낼 일정 내용
function desired(p, t, users) {
  const out = new Map();
  if (t.undated) return out;
  const tz = tzOf(p);
  const u = id => users.get(Number(id));
  const mailOf = id => { const x = u(id); return x && x.active && !x.external && x.email ? x.email : null; };
  const link = config.publicUrl ? `${config.publicUrl.replace(/\/$/, '')}/projects/${p.id}/tasks?open=${t.id}` : '';
  const lines = [
    `<b>${esc(p.name)}</b>${t.code ? ` · ${esc(t.code)}` : ''}`,
    `상태: ${esc(t.status)}${t.progress ? ` (${t.progress}%)` : ''}`,
    t.note ? esc(t.note).replace(/\n/g, '<br>') : '',
    link ? `<a href="${esc(link)}">일정관리에서 열기</a>` : '',
    '<span style="color:#8a93a6">R&amp;D 일정관리에서 자동으로 만든 일정입니다. 앱에서 고치면 여기도 바뀝니다.</span>'
  ].filter(Boolean);
  const body = { contentType: 'HTML', content: lines.map(l => `<p>${l}</p>`).join('') };
  const done = t.status === '완료';
  if (t.type === '회의') {
    const org = mailOf(t.assignee_id) || mailOf(t.updated_by);
    if (!org) return out;
    const timed = !!t.start_time;
    const endDay = t.end || t.start;
    const ev = {
      subject: `${done ? '✓ ' : ''}[${p.name}] ${t.name}`, body,
      start: { dateTime: timed ? `${t.start}T${t.start_time}:00` : `${t.start}T00:00:00`, timeZone: tz },
      end: { dateTime: timed ? `${endDay}T${t.end_time || plusHour(t.start_time)}:00` : `${addDays(endDay, 1)}T00:00:00`, timeZone: tz },
      isAllDay: !timed,
      location: { displayName: t.location || '' },
      attendees: String(t.attendees || '').split(',').map(Number).filter(Boolean).map(id => u(id)).filter(x => x?.email && x.email !== org)
        .map(x => ({ emailAddress: { address: x.email, name: x.name }, type: 'required' }))
    };
    if (t.teams_meeting) Object.assign(ev, { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' });
    out.set(org, { ev, meeting: true });
    return out;
  }
  if (!config.m365.outlookTasks) return out;
  const mb = mailOf(t.assignee_id);
  if (!mb) return out;
  out.set(mb, {
    ev: {
      subject: `${done ? '✓ ' : ''}[${p.name}] ${t.name}`, body,
      start: { dateTime: `${t.start}T00:00:00`, timeZone: tz },
      end: { dateTime: `${addDays(t.end || t.start, 1)}T00:00:00`, timeZone: tz },
      isAllDay: true, showAs: 'free', isReminderOn: false
    }
  });
  return out;
}

async function apply(link, want, t) {
  // link: 기존 연결(없으면 null), want: {ev, meeting} 또는 null(지움)
  try {
    if (!want) {
      if (link.event_id) await deleteEvent(link.mailbox, link.event_id);
      await db('m365_links').where({ id: link.id }).del();
      return 'deleted';
    }
    const hash = sha(want.ev);
    if (link && link.hash === hash && link.event_id && !link.error) return 'same';
    let ev;
    if (link?.event_id) {
      try { ev = await updateEvent(link.mailbox, link.event_id, want.ev); }
      catch (e) { if (e.status !== 404) throw e; ev = null; } // Outlook 에서 지운 일정 → 다시 만듦
    }
    if (!ev) ev = await createEvent(want.mailbox, want.ev);
    const row = { event_id: ev?.id || link?.event_id, hash, synced_at: now(), error: null };
    if (link) await db('m365_links').where({ id: link.id }).update(row);
    else await db('m365_links').insert({ task_id: t.id, project_id: t.project_id, mailbox: want.mailbox, ...row });
    if (want.meeting) {
      const up = { outlook_event_id: row.event_id };
      const join = ev?.onlineMeeting?.joinUrl;
      if (join && !t.meeting_url) up.meeting_url = join;
      await db('tasks').where({ id: t.id }).update(up);
    }
    return link ? 'updated' : 'created';
  } catch (e) {
    const msg = String(e.message).slice(0, 480);
    if (link) await db('m365_links').where({ id: link.id }).update({ error: msg, synced_at: now() });
    else if (t) await db('m365_links').insert({ task_id: t.id, project_id: t.project_id, mailbox: want.mailbox, error: msg, synced_at: now() });
    await log('outlook', false, `${t ? t.name : `작업 ${link.task_id}`} (${want?.mailbox || link.mailbox}): ${msg}`);
    return 'error';
  }
}

// 프로젝트 하나 맞추기. 결과 건수 {created, updated, deleted, same, error}
export async function syncProject(pid) {
  const r = { created: 0, updated: 0, deleted: 0, same: 0, error: 0 };
  if (!features().outlook) return r;
  const p = await db('projects').where({ id: pid }).first();
  const links = await db('m365_links').where({ project_id: pid });
  const tasks = p && !p.archived ? await db('tasks').where({ project_id: pid }) : [];
  const users = new Map((await db('users').select('id', 'name', 'email', 'active', 'external')).map(u => [u.id, u]));
  const byTask = new Map();
  for (const l of links) { if (!byTask.has(l.task_id)) byTask.set(l.task_id, []); byTask.get(l.task_id).push(l); }
  for (const t of tasks) {
    const want = desired(p, t, users);
    const have = byTask.get(t.id) || [];
    byTask.delete(t.id);
    for (const l of have) if (!want.has(l.mailbox)) r[await apply(l, null, t)]++; // 담당자가 바뀜 → 예전 사서함 일정 지움
    for (const [mailbox, w] of want) r[await apply(have.find(l => l.mailbox === mailbox) || null, { ...w, mailbox }, t)]++;
  }
  for (const ls of byTask.values()) for (const l of ls) r[await apply(l, null, null)]++; // 지운 작업
  if (r.created + r.updated + r.deleted) await log('outlook', true, `프로젝트 ${p?.name || pid}: 만듦 ${r.created} · 고침 ${r.updated} · 지움 ${r.deleted}${r.error ? ` · 실패 ${r.error}` : ''}`);
  return r;
}

// 전체 확인 (30분마다·관리자 '다시 맞추기'). 지운 프로젝트의 남은 연결도 정리
export async function syncAll() {
  if (!features().outlook) return null;
  const ids = new Set((await db('projects').where({ archived: false }).select('id')).map(x => x.id));
  for (const x of await db('m365_links').distinct('project_id')) ids.add(x.project_id);
  const sum = { created: 0, updated: 0, deleted: 0, same: 0, error: 0 };
  for (const id of ids) {
    const r = await runOne(id);
    for (const k in sum) sum[k] += r[k];
  }
  return sum;
}

// 같은 프로젝트를 동시에 두 번 돌리지 않음. 도는 중에 또 요청이 오면 끝난 뒤 한 번 더
const state = new Map(); // pid → { running, again, timer }
async function runOne(pid) {
  const s = state.get(pid) || {};
  state.set(pid, s);
  if (s.running) { s.again = true; return await s.running; }
  s.running = (async () => {
    let r;
    do { s.again = false; r = await syncProject(pid).catch(e => { console.error('Outlook 동기화 실패', e.message); return { created: 0, updated: 0, deleted: 0, same: 0, error: 1 }; }); } while (s.again);
    return r;
  })();
  try { return await s.running; } finally { s.running = null; }
}
export function scheduleSync(pid) {
  if (!features().outlook || !pid) return;
  const s = state.get(pid) || {};
  state.set(pid, s);
  clearTimeout(s.timer);
  s.timer = setTimeout(() => { s.timer = null; runOne(pid); }, Number(process.env.M365_SYNC_DELAY_MS ?? 3000));
  s.timer.unref?.();
}
// 아무 일정 작업이 남아 있지 않을 때까지 기다림 (시험용)
export async function idle() {
  for (let i = 0; i < 100; i++) {
    const busy = [...state.values()].some(s => s.running || s.timer);
    if (!busy) return;
    await new Promise(r => setTimeout(r, 20));
  }
}
