import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useProject, FilterBar } from '../pages/Project.jsx';
import Dropdown, { DDCheck, DDRadio } from '../components/Dropdown.jsx';
import { addD, diff, fmt, weekday, isPoint, downloadXLSX, taskCols } from '../util.js';
import ExportButton from '../components/ExportButton.jsx';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

const COL = { 완료: 'var(--done)', 지연: 'var(--late)', 진행중: 'var(--prog)', 예정: 'var(--plan)', 보류: 'var(--hold)' };
const ST_ORDER = ['지연', '진행중', '예정', '보류', '완료'];
// 왼쪽 표의 열 (작업명 다음). [키, 제목, 폭]
const COLS = [['st', '상태', 110], ['start', '시작일', 140], ['end', '마감일', 140], ['owner', '담당', 130]];
const RH = 38;
const OPT0 = { cols: { st: true, start: true, end: true, owner: false }, base: true, deps: true, lbl: true, group: 'phase' };
function loadOpt() {
  try {
    const o = JSON.parse(localStorage.getItem('gantt-opt') || 'null');
    if (o) return { ...OPT0, ...o, cols: { ...OPT0.cols, ...o.cols } };
    return { ...OPT0, deps: localStorage.getItem('gantt-deps') !== '0' };
  } catch { return OPT0; }
}

export default function Gantt() {
  const { filtered: all, phases, holidays, td, color, openTask, tasks, deps, project, toast, can, reload } = useProject();
  const raw = all.filter(t => !t.undated); // 날짜 없는 할 일은 칸반·할 일 목록에서만
  const [opt, setOptS] = useState(loadOpt);
  const setOpt = patch => setOptS(o => { const n = { ...o, ...patch }; try { localStorage.setItem('gantt-opt', JSON.stringify(n)); } catch {} return n; });
  const showDeps = opt.deps, showBase = opt.base;
  const [folded, setFolded] = useState(() => new Set());
  const [drag, setDrag] = useState(null); // { id, mode: move|start|end, x0, s0, e0, dd }
  const dragRef = useRef(null);
  const editable = can() && !project.archived;
  const hm = new Map(holidays.map(h => [h.date, h.name]));
  const workday = d => project.day_basis === 'calendar' || (weekday(d) !== 0 && weekday(d) !== 6 && !hm.has(d));
  const nextWork = d => { let g = 0; while (!workday(d) && g++ < 30) d = addD(d, 1); return d; };
  const prevWork = d => { let g = 0; while (!workday(d) && g++ < 30) d = addD(d, -1); return d; };
  function dragDates(g) {
    if (g.mode === 'move') {
      // 근무일 기준이면 근무일 수를 그대로 두고 옮김
      const s = nextWork(addD(g.s0, g.dd));
      if (project.day_basis === 'calendar') return { start: s, end: addD(g.e0, diff(g.s0, s)) };
      let n = 0; for (let d = g.s0; d <= g.e0; d = addD(d, 1)) if (workday(d)) n++;
      let e = s; for (let k = 1; k < n;) { e = addD(e, 1); if (workday(e)) k++; }
      return { start: s, end: e };
    }
    if (g.mode === 'start') { const s = nextWork(addD(g.s0, g.dd)); return { start: s > g.e0 ? g.e0 : s, end: g.e0 }; }
    const e = prevWork(addD(g.e0, g.dd)); return { start: g.s0, end: e < g.s0 ? g.s0 : e };
  }
  // 끄는 중이면 그 작업만 미리 옮겨서 그림
  const ts = drag ? raw.map(t => t.id === drag.id ? { ...t, ...dragDates(drag) } : t) : raw;
  const [zoom, setZoom] = useState(() => localStorage.getItem('gantt-zoom') || 'week');
  const wrap = useRef(null);
  const ppd = { day: 22, week: 7, month: 2.5 }[zoom];

  let min = raw.reduce((a, t) => t.start < a ? t.start : a, td), max = raw.reduce((a, t) => t.end > a ? t.end : a, td);
  min = addD(min, -((weekday(min) + 6) % 7) - 7); max = addD(max, 21);
  const days = diff(min, max), W = days * ppd, x = s => diff(min, s) * ppd;
  const beginDrag = (e, t, mode) => {
    if (!editable || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const g = { id: t.id, mode, x0: e.clientX, s0: t.start, e0: t.end, dd: 0, t };
    dragRef.current = g; setDrag(g);
  };
  useEffect(() => {
    if (!drag) return;
    const move = e => { const g = dragRef.current; const dd = Math.round((e.clientX - g.x0) / ppd); if (dd !== g.dd) { dragRef.current = { ...g, dd }; setDrag(dragRef.current); } };
    const up = async () => {
      const g = dragRef.current; dragRef.current = null; setDrag(null);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const nd = dragDates(g);
      if (!g.dd || (nd.start === g.s0 && nd.end === g.e0)) { if (!g.dd) openTask(g.id); return; }
      try {
        const r = await api.patch(`/projects/${project.id}/tasks/${g.id}`, { ...nd, version: g.t.version });
        const n = r?.shifted?.length || 0;
        toast(tr('{name}: {s} ~ {e} 로 옮겼습니다.', { name: g.t.name, s: fmt(nd.start), e: fmt(nd.end) }) + (n ? ' ' + tr('뒤따르는 작업 {n}건도 자동으로 조정했습니다.', { n }) : ''));
        await reload();
      } catch (err) { toast(err.message); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag?.id]); // eslint-disable-line

  useEffect(() => { if (wrap.current) wrap.current.scrollLeft = Math.max(0, x(td) - 200); }, [zoom]); // eslint-disable-line

  const cols = COLS.filter(([k]) => opt.cols[k]);
  const NAME_W = window.innerWidth < 1000 ? 230 : 360; // 좁은 화면에서는 작업명 칸을 줄임
  const LW = NAME_W + cols.reduce((a, c) => a + c[2], 0);
  const setZ = z => { setZoom(z); localStorage.setItem('gantt-zoom', z); };

  // 묶음 (단계·담당·상태·없음)
  const groups = opt.group === 'owner'
    ? [...new Set(ts.map(t => t.owner || ''))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b)).map(o => ({ id: o, name: o || tr('담당 없음'), dot: 'var(--muted)', has: t => (t.owner || '') === o }))
    : opt.group === 'state'
      ? ST_ORDER.map(st => ({ id: st, name: tr(st), dot: COL[st], has: t => t.st === st }))
      : opt.group === 'none'
        ? [{ id: 'all', name: tr('전체 작업'), dot: 'var(--accent)', has: () => true }]
        : [...phases.map(p => ({ id: p.id, name: p.name, dot: color(p.id), phase: p.id, has: t => t.phase_id === p.id })), { id: 0, name: tr('단계 없음'), dot: color(null), phase: null, has: t => !t.phase_id }];
  const gkey = g => `${opt.group}:${g.id}`;
  const live = groups.map(g => ({ ...g, ts: ts.filter(g.has).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)) })).filter(g => g.ts.length);
  const allFolded = live.length > 0 && live.every(g => folded.has(gkey(g)));
  const fold = g => setFolded(f => { const n = new Set(f); n.has(gkey(g)) ? n.delete(gkey(g)) : n.add(gkey(g)); return n; });

  const tools = (
    <>
      <Dropdown label={`${tr('묶음')}: ${tr({ phase: '단계', owner: '담당', state: '상태', none: '없음' }[opt.group])}`} active={opt.group !== 'phase'}>
        {close => [['phase', '단계'], ['owner', '담당'], ['state', '상태'], ['none', '없음']].map(([k, n]) => <DDRadio key={k} checked={opt.group === k} onClick={() => { setOpt({ group: k }); close(); }}>{tr(n)}</DDRadio>)}
      </Dropdown>
      <Dropdown label={tr('표시')} active={!opt.cols.st || !opt.cols.start || !opt.cols.end || opt.cols.owner || !opt.base || !opt.deps || !opt.lbl}>
        <div className="dd-h">{tr('왼쪽 표의 열')}</div>
        {COLS.map(([k, n]) => <DDCheck key={k} checked={opt.cols[k]} onChange={v => setOpt({ cols: { ...opt.cols, [k]: v } })}>{tr(n)}</DDCheck>)}
        <div className="dd-h">{tr('간트')}</div>
        <DDCheck checked={opt.base} onChange={v => setOpt({ base: v })}>{tr('기준 일정 표시')}</DDCheck>
        <DDCheck checked={opt.deps} onChange={v => setOpt({ deps: v })}>{tr('선행관계 화살표')}</DDCheck>
        <DDCheck checked={opt.lbl} onChange={v => setOpt({ lbl: v })}>{tr('막대 옆 날짜')}</DDCheck>
      </Dropdown>
      <label className="tcheck"><input type="checkbox" checked={allFolded} onChange={e => setFolded(e.target.checked ? new Set(live.map(gkey)) : new Set())} /> {tr('모두 접기')}</label>
      <Dropdown label={tr('범례')}>
        <div className="legend col">
          <span><i style={{ background: 'var(--plan)' }} />{tr('예정')}</span><span><i style={{ background: 'var(--prog)' }} />{tr('진행중')}</span>
          <span><i style={{ background: 'var(--late)' }} />{tr('지연')}</span><span><i style={{ background: 'var(--done)' }} />{tr('완료')}</span>
          <span><i style={{ background: 'var(--hold)' }} />{tr('보류')}</span><span>{tr('◆ 마일스톤·제출·지급')}</span>
          <span>{tr('→ 선행관계 (빨간색: 순서가 어긋남)')}</span>
          <span><i style={{ background: 'var(--muted)', height: 3, opacity: .45 }} />{tr('기준 일정')}</span>
          <span><i style={{ background: 'var(--wkend-strong)' }} />{tr('주말')}</span><span><i style={{ background: 'var(--hol)' }} />{tr('공휴일')}</span>
          <span><i style={{ background: 'var(--accent)', width: 2 }} />{tr('오늘')}</span>
        </div>
      </Dropdown>
    </>
  );
  const right = (
    <>
      <button className="tbtn accent" onClick={() => { if (wrap.current) wrap.current.scrollLeft = Math.max(0, x(td) - 200); }}>{tr('오늘')}</button>
      <div className="seg">{[['day', '일 단위'], ['week', '주 단위'], ['month', '월 단위']].map(([k, n]) => <button key={k} className={zoom === k ? 'on' : ''} onClick={() => setZ(k)}>{tr(n)}</button>)}</div>
      <ExportButton toast={toast} make={() => {
        const order = new Map(phases.map((p, i) => [p.id, i]));
        const rows = [...ts].sort((a, b) => ((order.get(a.phase_id) ?? 999) - (order.get(b.phase_id) ?? 999)) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
        return downloadXLSX(`${project.name}_간트`, [{ name: '간트', cols: [...taskCols({ phases, tasks, deps }), [t => diff(t.start, t.end) + 1, '기간(일)']], rows }, { name: '공휴일', cols: [['date', '날짜'], ['name', '이름'], ['country', '국가']], rows: holidays }]);
      }} />
    </>
  );
  if (!ts.length) return <><FilterBar right={right}>{tools}</FilterBar><div className="empty">{tr('표시할 작업이 없습니다.')}</div></>;

  // 날짜 눈금·주말·공휴일
  const scale = [], bg = [];
  for (let i = 0; i <= days; i++) {
    const d = addD(min, i), wd = weekday(d), off = wd === 0 || wd === 6 || hm.has(d);
    if (d.endsWith('-01') || i === 0) {
      const nm = addD(d.slice(0, 7) + '-01', 32).slice(0, 7) + '-01';
      scale.push(<div key={'m' + d} className="gmon" style={{ left: x(d), width: Math.min(x(nm), W) - x(d) }}>{d.slice(0, 4)}-{d.slice(5, 7)}</div>);
      if (i) bg.push(<div key={'ml' + d} className="gmline" style={{ left: x(d) }} />);
    }
    if (zoom === 'day') scale.push(<div key={'t' + d} className={`gtick gday ${off ? 'off' : ''} ${d === td ? 'today' : ''}`} style={{ left: x(d), width: ppd }} title={hm.get(d)}>{+d.slice(8)}</div>);
    else if (zoom === 'week' && wd === 1) scale.push(<div key={'t' + d} className="gtick" style={{ left: x(d), width: 7 * ppd }}>{fmt(d)}</div>);
    if (zoom !== 'month' && (wd === 0 || wd === 6)) bg.push(<div key={'w' + d} className="gbg" style={{ left: x(d), width: ppd, background: 'var(--wkend-strong)' }} />);
    if (hm.has(d)) bg.push(<div key={'h' + d} className="gbg" style={{ left: x(d), width: Math.max(ppd, 2), background: 'var(--hol)' }} title={hm.get(d)} />);
  }
  if (zoom !== 'day') scale.push(<div key="today" className="gtoday-tag" style={{ left: x(td) + ppd / 2 }}>{fmt(td)}</div>);
  const grid = zoom === 'month' ? null : { backgroundImage: 'linear-gradient(to right, var(--line) 1px, transparent 1px)', backgroundSize: `${zoom === 'day' ? ppd : 7 * ppd}px 100%` };

  const cell = (t, k) => k === 'st' ? <span className={`badge b-${t.st}`}><span className="bdot" />{tr(t.st)}</span>
    : k === 'start' ? t.start : k === 'end' ? (isPoint(t) ? '' : t.end) : t.owner;
  const rows = [], rowOf = new Map();
  for (const g of live) {
    const gt = g.ts, isF = folded.has(gkey(g));
    const gs = gt.reduce((a, t) => t.start < a ? t.start : a, gt[0].start), ge = gt.reduce((a, t) => t.end > a ? t.end : a, gt[0].end);
    rows.push(
      <div key={'g' + g.id} className="grow grp" onClick={() => fold(g)} title={tr(isF ? '펼치기' : '접기')}>
        <div className="glabel" style={{ width: LW }}><span className="gtog">{isF ? '+' : '−'}</span><span className="dot" style={{ background: g.dot }} />{g.name} <span className="small">({gt.length})</span></div>
        <div className="gbody" style={{ width: W }}><div className="gsum" style={{ left: x(gs), width: (diff(gs, ge) + 1) * ppd }} title={`${g.name}: ${gs} ~ ${ge}`} /></div>
      </div>
    );
    if (isF) continue;
    for (const t of gt) {
      rowOf.set(t.id, rows.length);
      const pt = isPoint(t), lbl = zoom === 'month' || !opt.lbl ? '' : `${fmt(t.start)}${t.end !== t.start ? '~' + fmt(t.end) : ''}`;
      const base = showBase && t.baseline_end && (t.baseline_end !== t.end || (t.baseline_start && t.baseline_start !== t.start));
      rows.push(
        <div key={t.id} className="grow">
          <div className={`glabel gcells ${t.st === '완료' ? 'done' : ''}`} style={{ width: LW }} onClick={() => openTask(t.id)} title={t.name}>
            <div className="gc name" style={{ width: NAME_W }}><span className="small">{t.code}</span> {t.is_key ? '★' : ''}<Tx>{t.name}</Tx></div>
            {cols.map(([k, , w]) => <div key={k} className={`gc ${k}`} style={{ width: w }}>{cell(t, k)}</div>)}
          </div>
          <div className="gbody" style={{ width: W }}>
            {base && <div className="gbase" style={{ left: x(t.baseline_start || t.baseline_end), width: Math.max(3, (diff(t.baseline_start || t.baseline_end, t.baseline_end) + 1) * ppd) }} title={`${tr('기준 일정')} ${t.baseline_start || ''} ~ ${t.baseline_end}`} />}
            {pt
              ? <div className={`gms ${editable ? 'drag' : ''} ${drag?.id === t.id ? 'dragging' : ''}`} onClick={() => !editable && openTask(t.id)} onPointerDown={e => beginDrag(e, t, 'move')} style={{ left: x(t.start) + ppd / 2 - 6, background: COL[t.st] }} title={`${t.name} (${t.start})`} />
              : <div className={`gbar ${editable ? 'drag' : ''} ${drag?.id === t.id ? 'dragging' : ''}`} onClick={() => !editable && openTask(t.id)} onPointerDown={e => beginDrag(e, t, 'move')} style={{ left: x(t.start), width: (diff(t.start, t.end) + 1) * ppd, background: COL[t.st] }} title={`${t.name} (${t.start} ~ ${t.end})${editable ? '\n' + tr('끌어서 옮기고, 양 끝을 끌어 기간을 바꿉니다. 누르면 편집 창이 열립니다.') : ''}`}>
                {editable && <><i className="gh l" onPointerDown={e => beginDrag(e, t, 'start')} /><i className="gh r" onPointerDown={e => beginDrag(e, t, 'end')} /></>}
              </div>}
            <span className="glbl" style={{ left: (pt ? x(t.start) + ppd / 2 + 12 : x(t.end) + ppd + 6) }}>{lbl}{t.end > (t.baseline_end || t.end) ? <b style={{ color: 'var(--late)' }}> +{diff(t.baseline_end, t.end)}{tr('일')}</b> : null}</span>
          </div>
        </div>
      );
    }
    // 단계로 묶었을 때: 이 단계에 새 작업 추가 (편집 창이 단계가 정해진 채로 열림)
    if (editable && opt.group === 'phase') rows.push(
      <div key={'a' + g.id} className="grow addrow">
        <div className="glabel" style={{ width: LW }} onClick={() => openTask(null, { phase_id: g.phase ?? '', start: td, end: td })}>{tr('+ 새 작업 추가')}</div>
        <div className="gbody" style={{ width: W }} />
      </div>
    );
  }
  // 선행관계 화살표 (FS: 끝→시작, SS: 시작→시작, FF: 끝→끝)
  const arrows = [];
  if (showDeps) {
    const byId = new Map(ts.map(t => [t.id, t]));
    const endX = t => isPoint(t) ? x(t.start) + ppd / 2 + 7 : x(t.end) + ppd;
    const startX = t => isPoint(t) ? x(t.start) + ppd / 2 - 7 : x(t.start);
    for (const d of deps) {
      const a = byId.get(d.pred_id), b = byId.get(d.succ_id);
      if (!a || !b || !rowOf.has(a.id) || !rowOf.has(b.id)) continue;
      const y1 = rowOf.get(a.id) * RH + RH / 2, y2 = rowOf.get(b.id) * RH + RH / 2;
      const x1 = d.kind === 'SS' ? startX(a) : endX(a), x2 = d.kind === 'FF' ? endX(b) : startX(b);
      const path = d.kind === 'SS' ? `M${x1},${y1} H${Math.min(x1, x2) - 6} V${y2} H${x2}`
        : d.kind === 'FF' ? `M${x1},${y1} H${Math.max(x1, x2) + 6} V${y2} H${x2}`
        : x2 - x1 >= 12 ? `M${x1},${y1} H${x1 + 6} V${y2} H${x2}`
        : `M${x1},${y1} H${x1 + 6} V${y2 > y1 ? y2 - RH / 2 : y2 + RH / 2} H${x2 - 6} V${y2} H${x2}`;
      const bad = a.st !== '완료' && (d.kind === 'FS' ? b.start <= a.end : d.kind === 'SS' ? b.start < a.start : b.end < a.end);
      arrows.push(<path key={d.id} d={path} className={bad ? 'bad' : ''} markerEnd={`url(#${bad ? 'ah-bad' : 'ah'})`}><title>{`${a.code || a.name} → ${b.code || b.name} (${d.kind}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''})`}</title></path>);
    }
  }
  return (
    <>
      <FilterBar right={right}>{tools}</FilterBar>
      <div className="gwrap" ref={wrap}>
        <div style={{ width: W + LW }}>
          <div className="ghead">
            <div className="glabel gcells head" style={{ width: LW }}>
              <div className="gc name" style={{ width: NAME_W }}>{tr('작업명')}</div>
              {cols.map(([k, n, w]) => <div key={k} className="gc" style={{ width: w }}>{tr(n)}</div>)}
            </div>
            <div className="gscale" style={{ width: W }}>{scale}</div>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: LW, top: 0, bottom: 0, width: W, pointerEvents: 'none' }}>
              {bg}
              {grid && <div className="ggrid" style={grid} />}
              <div className="todayline" style={{ left: x(td) + ppd / 2 }} title={tr('오늘')} />
            </div>
            {rows}
            {arrows.length > 0 && <svg className="garrows" style={{ left: LW, width: W, height: rows.length * RH }}>
              <defs>{[['ah', 'var(--muted)'], ['ah-bad', 'var(--late)']].map(([id, c]) => <marker key={id} id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill={c} /></marker>)}</defs>
              {arrows}
            </svg>}
          </div>
        </div>
      </div>
    </>
  );
}
