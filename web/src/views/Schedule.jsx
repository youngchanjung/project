// 연구 일정: 주·월 달력에 회의·시험·마일스톤을 함께 보여 주고, 오른쪽에 다가오는 마일스톤·내 할 일·최근 회의록
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../pages/Project.jsx';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import CalendarSubscribe from '../components/CalendarSubscribe.jsx';
import { addD, diff, dow, weekday, monthAdd, fmt, fmtY, ddayTxt, ddayLabel, kindOf, attendeeIds } from '../util.js';
import { tr, locale } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

const POINT = ['마일스톤', '제출', '지급', '검토', '홀드포인트'];
const FILTERS = [['회의', '회의'], ['시험', '시험'], ['ms', '마일스톤·제출'], ['etc', '그 밖의 작업']];
const groupOf = t => (t.type === '회의' ? '회의' : t.type === '시험' ? '시험' : POINT.includes(t.type) ? 'ms' : 'etc');

// 날짜 d 에 보일 항목: 회의·시험은 기간 안 모든 날, 마일스톤 등은 마감일, 일반 작업은 시작·마감일
function itemsOn(ts, d) {
  const out = [];
  for (const t of ts) {
    if (t.type === '회의' || t.type === '시험') { if (t.start <= d && t.end >= d) out.push([t, '']); }
    else if (POINT.includes(t.type)) { if (t.end === d) out.push([t, '']); }
    else if (t.start === d && t.end === d) out.push([t, '']);
    else if (t.start === d) out.push([t, '▶ ']);
    else if (t.end === d) out.push([t, '■ ']);
  }
  return out.sort((a, b) => (a[0].start_time || '') .localeCompare(b[0].start_time || '') || (b[0].is_key - a[0].is_key));
}

export default function Schedule() {
  const { tasks, holidays, td, openTask, can, project, toast, members } = useProject();
  const { user } = useApp();
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('sched-mode') || 'week'; } catch { return 'week'; } });
  const [anchor, setAnchor] = useState(td);
  const [off, setOff] = useState([]);
  const [subscribing, setSubscribing] = useState(false);
  const [minutes, setMinutes] = useState([]);
  useEffect(() => { api.get(`/projects/${project.id}/meetings`).then(r => setMinutes(r.slice(0, 5))).catch(() => {}); }, [project.id]);
  const setM = m => { setMode(m); try { localStorage.setItem('sched-mode', m); } catch {} };

  const ts = useMemo(() => tasks.filter(t => !t.undated && !off.includes(groupOf(t))), [tasks, off]);
  const hm = new Map(holidays.map(h => [h.date, h.name.split('/').pop().trim()]));
  const monday = d => addD(d, -((weekday(d) + 6) % 7));
  const days = mode === 'week'
    ? Array.from({ length: 7 }, (_, i) => addD(monday(anchor), i))
    : (() => { const m = anchor.slice(0, 7), s = monday(m + '-01'), out = []; for (let i = 0; i < 42; i++) { const d = addD(s, i); if (i >= 35 && d.slice(0, 7) !== m) break; out.push(d); } return out; })();
  const move = n => setAnchor(mode === 'week' ? addD(anchor, 7 * n) : monthAdd(anchor.slice(0, 7), n) + '-01');
  const title = mode === 'week'
    ? `${fmtY(days[0])} ~ ${fmt(days[6])}`
    : new Date(anchor.slice(0, 7) + '-15T00:00:00').toLocaleDateString(locale(), { year: 'numeric', month: 'long' });
  const add = (d, type = '회의') => can() && openTask(null, { type, start: d, end: d, ...(type === '회의' ? { start_time: '10:00', end_time: '11:00', attendees: String(user.id) } : {}) });

  const upcoming = tasks.filter(t => !t.undated && POINT.includes(t.type) && t.st !== '완료' && t.end >= addD(td, -30)).sort((a, b) => a.end.localeCompare(b.end)).slice(0, 6);
  const mine = tasks.filter(t => t.st !== '완료' && (t.assignee_id === user.id || attendeeIds(t).includes(user.id)) && t.type !== '회의')
    .sort((a, b) => (a.undated - b.undated) || a.end.localeCompare(b.end)).slice(0, 6);
  const nextMeetings = tasks.filter(t => t.type === '회의' && !t.undated && t.start >= td).sort((a, b) => (a.start + (a.start_time || '')).localeCompare(b.start + (b.start_time || ''))).slice(0, 4);

  const Item = ({ t, p, compact }) => {
    const k = kindOf(t);
    const late = t.st === '지연';
    return (
      <div className={`sev ${compact ? 'compact' : ''}`} style={{ '--k': k.color, ...(t.st === '완료' ? { opacity: .55, textDecoration: 'line-through' } : {}) }}
        title={[t.name, t.start_time && `${t.start_time}${t.end_time ? '~' + t.end_time : ''}`, t.location].filter(Boolean).join(' · ')}
        onClick={e => { e.stopPropagation(); openTask(t.id); }}>
        <span className="sev-ico">{k.icon}</span>
        {t.start_time && <b className="sev-time">{t.start_time}</b>}
        <span className="sev-t" style={late ? { color: 'var(--late)', fontWeight: 700 } : undefined}>{p}{t.is_key ? '★' : ''}<Tx>{t.name}</Tx></span>
        {!compact && t.location && <span className="sev-loc">📍 {t.location}</span>}
        {!compact && t.meeting_url && <span className="sev-loc">🔗 {tr('온라인')}</span>}
      </div>
    );
  };

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => move(-1)}>◀</button>
        <b style={{ fontSize: 16.5, minWidth: 150, textAlign: 'center' }}>{title}</b>
        <button className="btn" onClick={() => move(1)}>▶</button>
        <button className="btn" onClick={() => setAnchor(td)}>{tr('오늘')}</button>
        <div className="seg">
          <button className={mode === 'week' ? 'on' : ''} onClick={() => setM('week')}>{tr('주')}</button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => setM('month')}>{tr('월')}</button>
        </div>
        {FILTERS.map(([k, n]) => (
          <button key={k} type="button" className={`tbtn ${off.includes(k) ? '' : 'on'}`} onClick={() => setOff(off.includes(k) ? off.filter(x => x !== k) : [...off, k])}>
            {k === 'ms' ? '◆' : k === 'etc' ? '•' : kindOf({ type: k }).icon} {tr(n)}</button>))}
        <div className="sp" />
        <button className="btn sm" onClick={() => setSubscribing(true)} title={tr('이 프로젝트 일정을 Outlook 달력에 띄웁니다.')}>📅 {tr('Outlook 달력에 구독')}</button>
        {can() && <button className="btn" onClick={() => add(td, '마일스톤')}>{tr('+ 마일스톤')}</button>}
        {can() && <button className="btn primary" onClick={() => add(td >= days[0] && td <= days[days.length - 1] ? td : days[0])}>{tr('+ 회의')}</button>}
      </div>
      <div className="calwrap">
        <div>
          {mode === 'week' ? (
            <div className="week">
              {days.map(d => {
                const wd = weekday(d), its = itemsOn(ts, d);
                return (
                  <div key={d} className={`wday ${wd === 0 || wd === 6 ? 'wk' : ''} ${hm.has(d) ? 'hol' : ''} ${d === td ? 'today' : ''}`} onDoubleClick={() => add(d)}>
                    <div className="wday-h"><span className="small">{dow(d)}</span><b className="num">{+d.slice(8)}</b>{hm.has(d) && <span className="holname">{hm.get(d)}</span>}</div>
                    <div className="wday-b">
                      {its.map(([t, p]) => <Item key={t.id} t={t} p={p} />)}
                      {can() && <button className="wadd" onClick={() => add(d)} title={tr('이 날짜에 회의 추가')}>+</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cal">
              {days.slice(0, 7).map(x => <div key={x} className="dow">{dow(x)}</div>)}
              {days.map(d => {
                const wd = weekday(d), its = itemsOn(ts, d);
                return (
                  <div key={d} className={`day ${wd === 0 || wd === 6 ? 'wk' : ''} ${hm.has(d) ? 'hol' : ''} ${d.slice(0, 7) !== anchor.slice(0, 7) ? 'other' : ''} ${d === td ? 'today' : ''}`}
                    onClick={() => { setAnchor(d); }} onDoubleClick={() => add(d)}>
                    <span className="num">{+d.slice(8)}</span>{hm.has(d) && <span className="holname">{hm.get(d)}</span>}
                    {its.slice(0, 4).map(([t, p]) => <Item key={t.id} t={t} p={p} compact />)}
                    {its.length > 4 && <div className="small" onClick={e => { e.stopPropagation(); setAnchor(d); setM('week'); }}>+{its.length - 4}{tr('건')}</div>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="small" style={{ marginTop: 6 }}>{tr('👥 회의 · 🧪 시험 · ◆ 마일스톤 · ▶ 시작 · ■ 마감')}{can() ? ` · ${tr('날짜를 두 번 누르면 회의 추가')}` : ''}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card"><h3>{tr('다가오는 마일스톤')}</h3>
            <div className="list">{upcoming.map(t => {
              const n = diff(td, t.end);
              return (
                <div key={t.id} className="item" onClick={() => openTask(t.id)}>
                  <div className="main"><div className="t">{t.is_key ? '★ ' : ''}<Tx>{t.name}</Tx></div><div className="small">{fmtY(t.end)} ({dow(t.end)}) · {tr(t.type)}</div></div>
                  <span className={`dday ${n < 0 ? 'late' : n <= 7 ? 'soon' : ''}`}>{ddayTxt(n)}</span>
                </div>);
            })}
              {!upcoming.length && <div className="empty">{tr('예정된 마일스톤이 없습니다.')}</div>}</div></div>
          <div className="card"><h3>{tr('다음 회의')}</h3>
            <div className="list">{nextMeetings.map(t => (
              <div key={t.id} className="item" onClick={() => openTask(t.id)}>
                <div className="main"><div className="t"><Tx>{t.name}</Tx></div>
                  <div className="small">{fmt(t.start)} ({dow(t.start)}) {t.start_time || ''}{t.location ? ` · ${t.location}` : ''} · {tr('참석 {n}명', { n: attendeeIds(t).length })}</div></div>
                {t.meeting_url && <a className="btn sm" href={t.meeting_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{tr('참가')}</a>}
              </div>))}
              {!nextMeetings.length && <div className="empty">{tr('예정된 회의가 없습니다.')}</div>}</div></div>
          <div className="card"><h3>{tr('내 할 일')}</h3>
            <div className="list">{mine.map(t => (
              <div key={t.id} className="item" onClick={() => openTask(t.id)}>
                <div className="main"><div className="t"><Tx>{t.name}</Tx></div><div className="small">{t.undated ? tr('날짜 없음') : fmtY(t.end)}</div></div>
                {!t.undated && <span className={`badge b-${t.st === '지연' ? '지연' : '임박'}`}>{ddayLabel(t, td)}</span>}
              </div>))}
              {!mine.length && <div className="empty">{tr('남은 할 일이 없습니다. 🎉')}</div>}</div></div>
          <div className="card"><h3>{tr('최근 회의록')} <Link className="btn sm" to={`/projects/${project.id}/meetings`}>{tr('모두 보기')}</Link></h3>
            <div className="list">{minutes.map(m => (
              <Link key={m.id} className="item" to={`/projects/${project.id}/meetings/${m.id}`} style={{ color: 'inherit' }}>
                <div className="main"><div className="t"><Tx>{m.title}</Tx></div><div className="small">{m.held_at ? fmtY(m.held_at.slice(0, 10)) : ''}</div></div>
              </Link>))}
              {!minutes.length && <div className="empty">{tr('회의록이 없습니다.')}</div>}</div></div>
        </div>
      </div>
      {subscribing && <CalendarSubscribe projectId={project.id} onClose={() => setSubscribing(false)} toast={toast} />}
    </>
  );
}
