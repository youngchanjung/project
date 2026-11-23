import { useState } from 'react';
import { useProject } from '../pages/Project.jsx';
import { TaskRow } from './Dashboard.jsx';
import { addD, fmtY, dow, weekday, monthAdd } from '../util.js';
import { tr, locale } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

export default function Calendar() {
  const { filtered: ts, holidays, td, color, openTask, can } = useProject();
  const [m, setM] = useState(td.slice(0, 7));
  const [sel, setSel] = useState(td);
  const hm = new Map(holidays.map(h => [h.date, h.name.split('/').pop().trim()]));
  const start = addD(m + '-01', -((weekday(m + '-01') + 6) % 7));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addD(start, i);
    if (i >= 35 && d.slice(0, 7) !== m) break;
    const evs = [];
    for (const t of ts) {
      if (t.start === d && t.end === d) evs.push([t, '']);
      else if (t.start === d) evs.push([t, '▶ ']);
      else if (t.end === d) evs.push([t, '■ ']);
    }
    evs.sort((a, b) => (b[0].is_key - a[0].is_key));
    const wd = weekday(d);
    cells.push(
      <div key={d} className={`day ${wd === 0 || wd === 6 ? 'wk' : ''} ${hm.has(d) ? 'hol' : ''} ${d.slice(0, 7) !== m ? 'other' : ''} ${d === td ? 'today' : ''} ${sel === d ? 'sel' : ''}`}
        onClick={() => setSel(d)} onDoubleClick={() => can() && openTask(null, { start: d, end: d })}>
        <span className="num">{+d.slice(8)}</span>{hm.has(d) && <span className="holname">{hm.get(d)}</span>}
        {evs.slice(0, 4).map(([t, p]) => (
          <div key={t.id} className="ev" title={t.name} onClick={e => { e.stopPropagation(); openTask(t.id); }}
            style={{ borderColor: color(t.phase_id), background: color(t.phase_id) + '1f', ...(t.st === '완료' ? { opacity: .55, textDecoration: 'line-through' } : {}), ...(t.st === '지연' ? { color: 'var(--late)', fontWeight: 700 } : {}) }}>
            {p}{t.is_key ? '★' : ''}<Tx>{t.name}</Tx></div>
        ))}
        {evs.length > 4 && <div className="small">+{evs.length - 4}{tr('건')}</div>}
      </div>
    );
  }
  const active = ts.filter(t => t.start <= sel && t.end >= sel).sort((a, b) => a.end.localeCompare(b.end));
  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => setM(monthAdd(m, -1))}>◀</button>
        <b style={{ fontSize: 20, minWidth: 120, textAlign: 'center' }}>{new Date(m + '-15T00:00:00').toLocaleDateString(locale(), { year: 'numeric', month: 'long' })}</b>
        <button className="btn" onClick={() => setM(monthAdd(m, 1))}>▶</button>
        <button className="btn" onClick={() => { setM(td.slice(0, 7)); setSel(td); }}>{tr('오늘')}</button>
        <span className="small">{tr('▶ 시작 · ■ 마감 · ★ 핵심 · 날짜를 누르면 그날 진행 중인 작업을 오른쪽에 보여줍니다')}{can() ? ` · ${tr('두 번 누르면 그 날짜로 작업 추가')}` : ''}</span>
      </div>
      <div className="calwrap">
        <div className="cal">{['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'].map(x => <div key={x} className="dow">{dow(x)}</div>)}{cells}</div>
        <div className="card"><h3>{fmtY(sel)} ({dow(sel)}) <span className="small">{active.length}{tr('건')}</span></h3>
          {hm.has(sel) && <div className="badge b-지연" style={{ marginBottom: 8 }}>{tr('공휴일 ·')} {hm.get(sel)}</div>}
          <div className="list">{active.map(t => <TaskRow key={t.id} t={t} right={<span className={`badge b-${t.st}`}>{tr(t.st)}</span>} />)}
            {!active.length && <div className="empty">{tr('이 날 진행되는 작업이 없습니다.')}</div>}</div></div>
      </div>
    </>
  );
}
