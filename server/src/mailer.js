// 메일 알림: 프로그램 안 알림(🔔)이 생기면 같은 내용을 회사 메일로도 보냄 (M365_MAIL_FROM 사서함에서 Graph 로 발송)
// 받는 사람: 메일 주소가 있고 '메일로도 받기'를 끄지 않은 직원. 거래 중 생긴 알림은 저장(커밋)된 뒤에만 보냄
import { db } from './db.js';
import { config } from './config.js';
import { now } from './util.js';
import { translateMsg } from './i18n.js';
import { features, sendMail } from './m365.js';

export async function log(kind, ok, message, dedupe = null) {
  try {
    await db('m365_log').insert({ at: now(), kind, ok, message: String(message || '').slice(0, 500), dedupe });
    const old = await db('m365_log').orderBy('id', 'desc').offset(500).first();
    if (old) await db('m365_log').where('id', '<=', old.id).whereNull('dedupe').del();
  } catch (e) { console.error('연동 기록 저장 실패', e.message); }
}

const T = (lang, key, vars = {}) => translateMsg(key, lang).replace(/\{(\w+)\}/g, (a, k) => (vars[k] ?? a));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = p => [p.date, p.time, p.location].filter(Boolean).join(' ');

// 화면 🔔 과 같은 문구 (components/Bell.jsx)
export function messageOf(kind, p, lang = 'ko') {
  switch (kind) {
    case 'task_assigned': return T(lang, '{by}님이 나를 작업 담당자로 지정했습니다.', { by: p.by || '' });
    case 'task_changed': return p.auto ? T(lang, '선행작업이 바뀌어 일정이 자동 조정되었습니다: {from} → {to}', p) : T(lang, '{by}님이 일정을 바꿨습니다: {from} → {to}', { by: p.by || '', from: p.from, to: p.to });
    case 'issue_assigned': return T(lang, '{by}님이 나를 이슈 담당자로 지정했습니다.', { by: p.by || '' });
    case 'issue_comment': return T(lang, '{by}님의 댓글: {text}', { by: p.by || '', text: p.text || '' });
    case 'task_due': return T(lang, '마감이 다가옵니다: {date}', p);
    case 'task_late': return T(lang, '기한이 지났습니다: {date}', p);
    case 'review_requested': return T(lang, '{by}님이 검토를 요청했습니다.', { by: p.by || '' });
    case 'review_approved': return T(lang, '{by}님이 승인했습니다.', { by: p.by || '' });
    case 'review_rejected': return T(lang, '{by}님이 반려했습니다.', { by: p.by || '' }) + (p.note ? ` · ${p.note}` : '');
    case 'meeting_invited': return T(lang, '{by}님이 회의에 초대했습니다: {when}', { by: p.by || '', when: when(p) });
    case 'meeting_changed': return T(lang, '회의 시간·장소가 바뀌었습니다: {when}', { when: when(p) });
    case 'meeting_today': return T(lang, '오늘 회의: {when}', { when: [p.time, p.location].filter(Boolean).join(' ') || T(lang, '시간 미정') });
    case 'milestone_due': return p.days ? T(lang, '마일스톤 D-{n}: {date}', { n: p.days, date: p.date }) : T(lang, '오늘이 마일스톤입니다: {date}', p);
    case 'phase_due': return (p.days ? T(lang, '제출일 D-{n}: {date}', { n: p.days, date: p.date }) : T(lang, '오늘이 제출일입니다: {date}', p))
      + ' · ' + T(lang, '미완료 {n}건', { n: p.open || 0 }) + (p.review ? ' · ' + T(lang, '검토 대기 {n}건', { n: p.review }) : '');
    default: return kind;
  }
}

// 알림이 가리키는 화면 주소 (PUBLIC_URL 이 있을 때만)
export function linkOf(n) {
  if (!config.publicUrl || !n.project_id) return null;
  if (n.entity === 'phase') return `${config.publicUrl}/projects/${n.project_id}/board?phase=${n.entity_id}`;
  return `${config.publicUrl}/projects/${n.project_id}/${n.entity === 'issue' ? 'issues' : 'tasks'}?open=${n.entity_id}`;
}

export function mailHtml({ title, lines, link, lang }) {
  return `<div style="font-family:'Malgun Gothic',sans-serif;font-size:15px;color:#1d2330;max-width:560px">
<h2 style="font-size:18px;margin:0 0 10px">${esc(title)}</h2>
${lines.map(l => `<p style="margin:0 0 8px">${esc(l)}</p>`).join('\n')}
${link ? `<p style="margin:16px 0"><a href="${esc(link)}" style="background:#2f6fde;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">${esc(T(lang, '프로그램에서 보기'))}</a></p>` : ''}
<p style="color:#6b7385;font-size:12px;margin-top:20px">${esc(T(lang, 'R&D 일정관리 알림입니다. 메일 받기는 프로그램 위쪽 🔔 에서 끌 수 있습니다.'))}</p></div>`;
}

const KINDS = process.env.M365_MAIL_KINDS ? new Set(process.env.M365_MAIL_KINDS.split(',').map(s => s.trim())) : null;

// 알림 한 건을 메일로. 이미 보냈거나, 받을 수 없는 사람이면 건너뜀
export async function mailNotification(id) {
  if (!features().mail) return false;
  const n = await db('notifications as n').leftJoin('projects as p', 'p.id', 'n.project_id').where('n.id', id).select('n.*', 'p.name as project_name').first();
  if (!n || n.mailed_at || (KINDS && !KINDS.has(n.kind))) return false;
  const u = await db('users').where({ id: n.user_id }).first();
  if (!u || !u.active || !u.email || u.email_notify === false || u.email_notify === 0) return false;
  await db('notifications').where({ id }).update({ mailed_at: now() }); // 두 번 보내지 않도록 먼저 표시
  const p = JSON.parse(n.params || '{}'), lang = u.lang || 'ko';
  const name = [p.code, p.name].filter(Boolean).join(' ');
  const subject = `[${T(lang, 'R&D 일정관리')}] ${[n.project_name, name].filter(Boolean).join(' · ')}`;
  try {
    await sendMail(u.email, subject, mailHtml({ title: name || n.project_name || '', lines: [messageOf(n.kind, p, lang), n.project_name ? `${T(lang, '프로젝트')}: ${n.project_name}` : ''].filter(Boolean), link: linkOf(n), lang }));
    return true;
  } catch (e) {
    await log('mail', false, `${u.email}: ${e.message}`);
    return false;
  }
}

// notify() 가 부름: 거래가 끝난 뒤(잠시 후) 보냄. 거래가 취소돼 알림이 없으면 아무것도 안 함
export function queueMail(id) {
  if (!features().mail || !id) return;
  const t = setTimeout(() => mailNotification(id).catch(e => console.error('메일 알림 실패', e.message)), Number(process.env.M365_MAIL_DELAY_MS ?? 1500));
  t.unref?.();
}
