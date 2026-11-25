// Teams 채널 알림: 프로젝트 설정의 'Teams 채널 웹후크 주소'(Teams 워크플로 "웹후크 요청을 받으면 채널에 게시")로 카드를 보냄
// M365 앱 등록 없이도 동작 (주소만 있으면 됨)
// - 바로: 검토 요청·승인·반려, 회의 초대, 새 이슈
// - 하루 한 번(DAILY_NOTIFY_HOUR): 오늘 회의, 마일스톤·단계 제출일 D-7·D-1·당일, 기한 지난 작업 수
import { db } from './db.js';
import { config } from './config.js';
import { log, messageOf } from './mailer.js';
import { translateMsg } from './i18n.js';
import { stateOf, addDays } from './schedule.js';

export const CHANNEL_KINDS = new Set(['review_requested', 'review_approved', 'review_rejected', 'meeting_invited', 'issue_created']);
const T = (key, vars = {}) => translateMsg(key, 'ko').replace(/\{(\w+)\}/g, (a, k) => (vars[k] ?? a));

export function validWebhook(v) {
  if (!v) return null;
  const s = String(v).trim();
  let u; try { u = new URL(s); } catch { return false; }
  const ok = u.protocol === 'https:' || (process.env.TEAMS_ALLOW_HTTP === '1' && u.protocol === 'http:');
  return ok ? s : false;
}

const card = ({ title, sub, lines, link }) => ({
  type: 'message',
  attachments: [{
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [
        { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
        ...(sub ? [{ type: 'TextBlock', text: sub, isSubtle: true, spacing: 'None', wrap: true }] : []),
        ...lines.map(l => ({ type: 'TextBlock', text: l, wrap: true }))
      ],
      ...(link ? { actions: [{ type: 'Action.OpenUrl', title: T('프로그램에서 보기'), url: link }] } : {})
    }
  }]
});

export async function postCard(url, c) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card(c)) });
  if (!r.ok) throw new Error(`Teams 웹후크 ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

const appLink = (pid, path = '') => config.publicUrl ? `${config.publicUrl.replace(/\/$/, '')}/projects/${pid}${path}` : null;

async function send(p, c, dedupe = null) {
  try {
    await postCard(p.teams_webhook, c);
    await log('teams', true, `${p.name}: ${c.title}`, dedupe);
    return true;
  } catch (e) {
    await log('teams', false, `${p.name}: ${e.message}`);
    return false;
  }
}

// notify() 와 이슈 등록에서 부름. 거래가 끝난 뒤(잠시 후) 대상이 아직 있으면 보냄
export function queueChannel({ kind, projectId, entity, entityId, params }) {
  if (!CHANNEL_KINDS.has(kind) || !projectId) return;
  const t = setTimeout(async () => {
    try {
      const p = await db('projects').where({ id: projectId }).first();
      if (!p?.teams_webhook || p.archived) return;
      if (entityId && !(await db(entity === 'issue' ? 'issues' : 'tasks').where({ id: entityId }).first())) return; // 취소된 거래
      const msg = kind === 'issue_created' ? T('{by}님이 이슈를 등록했습니다.', { by: params.by || '' }) : messageOf(kind, params, 'ko');
      await send(p, { title: [params.code, params.name].filter(Boolean).join(' '), sub: p.name, lines: [msg],
        link: appLink(p.id, entityId ? `/${entity === 'issue' ? 'issues' : 'tasks'}?open=${entityId}` : '') });
    } catch (e) { console.error('Teams 알림 실패', e.message); }
  }, Number(process.env.M365_MAIL_DELAY_MS ?? 1500));
  t.unref?.();
}

// 하루 한 번: 웹후크가 있는 프로젝트마다 오늘 요약 카드 (같은 날 두 번 보내지 않음)
export async function dailyDigest(today = new Date().toISOString().slice(0, 10)) {
  const projects = await db('projects').where({ archived: false }).whereNotNull('teams_webhook').whereNot('teams_webhook', '');
  let sent = 0;
  for (const p of projects) {
    const key = `teams:${p.id}:${today}`;
    if (await db('m365_log').where({ dedupe: key }).first()) continue;
    const tasks = await db('tasks').where({ project_id: p.id, undated: false });
    const days = [0, 1, 7].map(n => addDays(today, n));
    const dd = d => { const n = days.indexOf(d); return n === 0 ? T('오늘') : `D-${[0, 1, 7][n]}`; };
    const lines = [];
    for (const t of tasks.filter(t => t.type === '회의' && t.start === today).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))))
      lines.push(`📅 ${T('오늘 회의')}: ${[t.start_time, t.name, t.location].filter(Boolean).join(' · ')}`);
    for (const t of tasks.filter(t => ['마일스톤', '제출'].includes(t.type) && t.status !== '완료' && days.includes(t.end)))
      lines.push(`◆ ${T('마일스톤')} ${dd(t.end)}: ${t.name} (${t.end})`);
    const phases = await db('phases').where({ project_id: p.id }).whereIn('due', days);
    for (const ph of phases) {
      const open = tasks.filter(t => t.phase_id === ph.id && t.status !== '완료' && t.status !== '보류' && !t.actual_end).length;
      if (open) lines.push(`🗂 ${T('단계 제출일')} ${dd(ph.due)}: ${ph.name} · ${T('미완료 {n}건', { n: open })}`);
    }
    const late = tasks.filter(t => t.type !== '회의' && stateOf(t, today) === '지연');
    if (late.length) lines.push(`⚠ ${T('기한 지난 작업 {n}건', { n: late.length })}: ${late.slice(0, 5).map(t => t.name).join(', ')}${late.length > 5 ? ' …' : ''}`);
    if (!lines.length) continue;
    if (await send(p, { title: `${p.name} · ${T('오늘의 일정')} (${today})`, lines, link: appLink(p.id) }, key)) sent++;
  }
  return sent;
}
