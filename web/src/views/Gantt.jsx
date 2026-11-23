import { useEffect, useRef, useState } from 'react';
import { useProject } from '../pages/Project.jsx';
import { addD, diff, fmt, weekday, isPoint } from '../util.js';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

const COL = { 완료: 'var(--done)', 지연: 'var(--late)', 진행중: 'var(--prog)', 예정: 'var(--plan)', 보류: 'var(--hold)' };

export default function Gantt() {
  const { filtered: ts, phases, holidays, td, color, openTask } = useProject();
  const [zoom, setZoom] = useState(() => localStorage.getItem('gantt-zoom') || 'week');
  const [showBase, setShowBase] = useState(true);
  const wrap = useRef(null);
  const ppd = { day: 22, week: 7, month: 2.5 }[zoom];

  let min = ts.reduce((a, t) => t.start < a ? t.start : a, td), max = ts.reduce((a, t) => t.end > a ? t.end : a, td);
  min = addD(min, -((weekday(min) + 6) % 7) - 7); max = addD(max, 21);
  const days = diff(min, max), W = days * ppd, x = s => diff(min, s) * ppd;
  const hm = new Map(holidays.map(h => [h.date, h.name]));

  useEffect(() => { if (wrap.current) wrap.current.scrollLeft = Math.max(0, x(td) - 200); }, [zoom]); // eslint-disable-line
  if (!ts.length) return <div className="empty">{tr('표시할 작업이 없습니다.')}</div>;

  const scale = [], bg = [];
  for (let i = 0; i <= days; i++) {
    const d = addD(min, i), wd = weekday(d);
    if (d.endsWith('-01') || i === 0) {
      const nm = addD(d.slice(0, 7) + '-01', 32).slice(0, 7) + '-01';
      scale.push(<div key={'m' + d} className="gmon" style={{ left: x(d), width: Math.min(x(nm), W) - x(d) }}>{d.slice(0, 4)}.{+d.slice(5, 7)}</div>);
    }
    if (zoom === 'day') scale.push(<div key={'t' + d} className="gtick" style={{ left: x(d), width: ppd, textAlign: 'center', color: wd === 0 || wd === 6 || hm.has(d) ? 'var(--late)' : undefined }}>{+d.slice(8)}</div>);
    else if (zoom === 'week' && wd === 1) scale.push(<div key={'t' + d} className="gtick" style={{ left: x(d), width: 7 * ppd }}>{fmt(d)}</div>);
    if (zoom !== 'month' && (wd === 0 || wd === 6)) bg.push(<div key={'w' + d} className="gbg" style={{ left: x(d), width: ppd, background: 'var(--wkend)' }} />);
    if (hm.has(d)) bg.push(<div key={'h' + d} className="gbg" style={{ left: x(d), width: Math.max(ppd, 2), background: 'var(--hol)' }} title={hm.get(d)} />);
  }
  const groups = [...phases.map(p => ({ id: p.id, name: p.name })), { id: null, name: tr('단계 없음') }];
  const rows = [];
  for (const g of groups) {
    const gt = ts.filter(t => (t.phase_id ?? null) === g.id).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    if (!gt.length) continue;
    rows.push(
      <div key={'g' + g.id} className="grow grp"><div className="glabel"><span className="dot" style={{ background: color(g.id) }} />{g.name} <span className="small">({gt.length})</span></div><div className="gbody" style={{ width: W }} /></div>
    );
    for (const t of gt) {
      const pt = isPoint(t), lbl = zoom === 'month' ? '' : `${fmt(t.start)}${t.end !== t.start ? '~' + fmt(t.end) : ''}`;
      const base = showBase && t.baseline_end && (t.baseline_end !== t.end || (t.baseline_start && t.baseline_start !== t.start));
      rows.push(
        <div key={t.id} className="grow">
          <div className="glabel" onClick={() => openTask(t.id)} title={t.name}><span className="small">{t.code}</span> {t.is_key ? '★' : ''}<Tx>{t.name}</Tx></div>
          <div className="gbody" style={{ width: W }}>
            {base && <div className="gbase" style={{ left: x(t.baseline_start || t.baseline_end), width: Math.max(3, (diff(t.baseline_start || t.baseline_end, t.baseline_end) + 1) * ppd) }} title={`${tr('기준 일정')} ${t.baseline_start || ''} ~ ${t.baseline_end}`} />}
            {pt
              ? <div className="gms" onClick={() => openTask(t.id)} style={{ left: x(t.start) + ppd / 2 - 6, background: COL[t.st] }} title={`${t.name} (${t.start})`} />
              : <div className="gbar" onClick={() => openTask(t.id)} style={{ left: x(t.start), width: (diff(t.start, t.end) + 1) * ppd, background: COL[t.st] }} title={`${t.name} (${t.start} ~ ${t.end})`} />}
            <span className="glbl" style={{ left: (pt ? x(t.start) + ppd / 2 + 12 : x(t.end) + ppd + 6) }}>{lbl}{t.end > (t.baseline_end || t.end) ? <b style={{ color: 'var(--late)' }}> +{diff(t.baseline_end, t.end)}{tr('일')}</b> : null}</span>
          </div>
        </div>
      );
    }
  }
  const setZ = z => { setZoom(z); localStorage.setItem('gantt-zoom', z); };
  return (
    <>
      <div className="toolbar">
        <span className="small">{tr('보기:')}</span>
        {[['day', tr('일 단위')], ['week', tr('주 단위')], ['month', tr('월 단위')]].map(([k, n]) => <button key={k} className={`btn sm ${zoom === k ? 'primary' : ''}`} onClick={() => setZ(k)}>{n}</button>)}
        <button className="btn sm" onClick={() => { wrap.current.scrollLeft = Math.max(0, x(td) - 200); }}>{tr('오늘로 이동')}</button>
        <label className="small"><input type="checkbox" checked={showBase} onChange={e => setShowBase(e.target.checked)} /> {tr('기준 일정 표시')}</label>
        <div className="legend">
          <span><i style={{ background: 'var(--plan)' }} />{tr('예정')}</span><span><i style={{ background: 'var(--prog)' }} />{tr('진행중')}</span>
          <span><i style={{ background: 'var(--late)' }} />{tr('지연')}</span><span><i style={{ background: 'var(--done)' }} />{tr('완료')}</span>
          <span><i style={{ background: 'var(--hold)' }} />{tr('보류')}</span><span>{tr('◆ 마일스톤·제출·지급')}</span>
          <span><i style={{ background: 'var(--muted)', height: 3, opacity: .45 }} />{tr('기준 일정')}</span><span><i style={{ background: 'var(--hol)' }} />{tr('공휴일')}</span>
        </div>
      </div>
      <div className="gwrap" ref={wrap}>
        <div style={{ width: W + 380 }}>
          <div className="ghead"><div className="glabel">{tr('작업')}</div><div className="gscale" style={{ width: W }}>{scale}</div></div>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 380, top: 0, bottom: 0, width: W, pointerEvents: 'none' }}>
              {bg}<div className="todayline" style={{ left: x(td) + ppd / 2 }} title={tr('오늘')} />
            </div>
            {rows}
          </div>
        </div>
      </div>
    </>
  );
}
