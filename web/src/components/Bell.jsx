import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { tr } from '../i18n.js';
import { fmt } from '../util.js';
import { Tx } from '../contentTr.jsx';

const range = s => String(s || '').split('~').map(fmt).join('~');
function message(n) {
  const p = n.params || {};
  switch (n.kind) {
    case 'task_assigned': return tr('{by}님이 나를 작업 담당자로 지정했습니다.', { by: p.by || '' });
    case 'task_changed': return p.auto
      ? tr('선행작업이 바뀌어 일정이 자동 조정되었습니다: {from} → {to}', { from: range(p.from), to: range(p.to) })
      : tr('{by}님이 일정을 바꿨습니다: {from} → {to}', { by: p.by || '', from: range(p.from), to: range(p.to) });
    case 'issue_assigned': return tr('{by}님이 나를 이슈 담당자로 지정했습니다.', { by: p.by || '' });
    case 'issue_comment': return tr('{by}님의 댓글: {text}', { by: p.by || '', text: p.text || '' });
    case 'task_due': return tr('마감이 다가옵니다: {date}', { date: fmt(p.date) });
    case 'task_late': return tr('기한이 지났습니다: {date}', { date: fmt(p.date) });
    case 'review_requested': return tr('{by}님이 검토를 요청했습니다.', { by: p.by || '' });
    case 'review_approved': return tr('{by}님이 승인했습니다.', { by: p.by || '' });
    case 'review_rejected': return tr('{by}님이 반려했습니다.', { by: p.by || '' }) + (p.note ? ` · ${p.note}` : '');
    case 'meeting_invited': return tr('{by}님이 회의에 초대했습니다: {when}', { by: p.by || '', when: [fmt(p.date), p.time, p.location].filter(Boolean).join(' ') });
    case 'meeting_changed': return tr('회의 시간·장소가 바뀌었습니다: {when}', { when: [fmt(p.date), p.time, p.location].filter(Boolean).join(' ') });
    case 'meeting_today': return tr('오늘 회의: {when}', { when: [p.time, p.location].filter(Boolean).join(' ') || tr('시간 미정') });
    case 'milestone_due': return p.days ? tr('마일스톤 D-{n}: {date}', { n: p.days, date: fmt(p.date) }) : tr('오늘이 마일스톤입니다: {date}', { date: fmt(p.date) });
    case 'phase_due': return (p.days ? tr('제출일 D-{n}: {date}', { n: p.days, date: fmt(p.date) }) : tr('오늘이 제출일입니다: {date}', { date: fmt(p.date) }))
      + ' · ' + tr('미완료 {n}건', { n: p.open || 0 }) + (p.review ? ' · ' + tr('검토 대기 {n}건', { n: p.review }) : '');
    default: return n.kind;
  }
}
const ago = iso => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 1) return tr('방금');
  if (m < 60) return tr('{n}분 전', { n: m });
  if (m < 60 * 24) return tr('{n}시간 전', { n: Math.round(m / 60) });
  return tr('{n}일 전', { n: Math.round(m / 1440) });
};

// 상단 🔔: 1분마다 새 알림 확인
export default function Bell() {
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const nav = useNavigate();
  const load = useCallback(() => api.get('/notifications').then(setData).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const read = async body => { await api.post('/notifications/read', body); load(); };
  const go = n => {
    if (!n.read_at) read({ ids: [n.id] });
    setOpen(false);
    if (n.project_id && n.entity === 'phase') nav(`/projects/${n.project_id}/board?phase=${n.entity_id}`);
    else if (n.project_id) nav(`/projects/${n.project_id}/${n.entity === 'issue' ? 'issues' : 'tasks'}?open=${n.entity_id}`);
  };
  return (
    <div className="bell" ref={box}>
      <button className="btn sm" onClick={() => { setOpen(!open); if (!open) load(); }} title={tr('알림')} aria-label={tr('알림')}>
        🔔{data.unread > 0 && <span className="bell-n">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && <div className="bell-pop">
        <div className="bell-head"><b>{tr('알림')}</b>{data.unread > 0 && <button className="btn sm" onClick={() => read({ all: true })}>{tr('모두 읽음')}</button>}</div>
        <div className="list">
          {data.items.map(n => (
            <div key={n.id} className={`item ${n.read_at ? '' : 'unread'}`} onClick={() => go(n)}>
              <div className="main"><div className="t">{n.params?.code ? <span className="small">{n.params.code} </span> : null}<Tx>{n.params?.name || ''}</Tx></div>
                <div className="small">{message(n)}</div>
                <div className="small">{[n.project_name, ago(n.created_at)].filter(Boolean).join(' · ')}</div></div>
            </div>))}
          {!data.items.length && <div className="empty">{tr('새 알림이 없습니다.')}</div>}
        </div>
      </div>}
    </div>
  );
}
