import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useProject, FilterBar } from '../pages/Project.jsx';
import Dropdown, { DDRadio } from '../components/Dropdown.jsx';
import ExportButton from '../components/ExportButton.jsx';
import { fmt, fmtY, downloadXLSX } from '../util.js';
import { tr } from '../i18n.js';

// 공정률·S-커브: 계획(기준선) 대비 실적 누적 공정률. 계산은 서버(/scurve)에서
const H = 320, PAD = { l: 44, r: 88, t: 16, b: 30 };
const pct = v => (v == null ? '' : `${Math.round(v * 10) / 10}%`);

export default function SCurve() {
  const { project, td, tasks, baseSel, setBaseSel, baselines, toast } = useProject();
  const [mode, setMode] = useState('duration');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState(null);
  const [w, setW] = useState(900);
  const box = useRef(null);

  // 작업이 바뀌면(진척 저장 등) 다시 계산
  const sig = tasks.map(t => `${t.id}:${t.start}:${t.end}:${t.progress}:${t.status}:${t.actual_start || ''}:${t.actual_end || ''}:${t.weight || ''}`).join('|');
  useEffect(() => {
    api.get(`/projects/${project.id}/scurve?mode=${mode}&today=${td}${baseSel ? `&baseline=${baseSel}` : ''}`)
      .then(d => { setData(d); setErr(null); }).catch(e => setErr(e.message));
  }, [project.id, mode, td, baseSel, sig]);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [data]);

  const tools = (
    <>
      <Dropdown label={`${tr('기준선')}: ${baseSel ? (baselines.find(b => b.id === baseSel)?.name || '') : tr('현재')}`} active={!!baseSel}>
        {close => <>
          <DDRadio checked={!baseSel} onClick={() => { setBaseSel(0); close(); }}>{tr('현재 기준 일정')}</DDRadio>
          {baselines.map(b => <DDRadio key={b.id} checked={baseSel === b.id} onClick={() => { setBaseSel(b.id); close(); }}>{b.name} <span className="small">{fmtY(b.created_at.slice(0, 10))}</span></DDRadio>)}
        </>}
      </Dropdown>
      <div className="seg" title={tr('공정률을 무엇으로 가중할지 고릅니다.')}>
        <button className={mode === 'duration' ? 'on' : ''} onClick={() => setMode('duration')}>{tr('기간 기준')}</button>
        <button className={mode === 'weight' ? 'on' : ''} disabled={!data?.hasWeight} title={data?.hasWeight ? '' : tr('작업에 공정 가중치(공사비 등)를 넣으면 쓸 수 있습니다.')} onClick={() => setMode('weight')}>{tr('가중치 기준')}</button>
      </div>
      <button type="button" className={`tbtn ${table ? 'on' : ''}`} onClick={() => setTable(!table)}>{table ? '✓ ' : ''}{tr('표로 보기')}</button>
    </>
  );
  const right = data?.points?.length ? <ExportButton toast={toast} make={() => downloadXLSX(`${project.name}_공정률`, [{ name: '공정률', cols: [['date', '날짜'], [p => p.plan, '계획(%)'], [p => p.actual ?? '', '실적(%)'], [p => (p.actual == null ? '' : Math.round((p.actual - p.plan) * 10) / 10), '차이(%p)']], rows: data.points }])} /> : null;

  if (err) return <><FilterBar right={right}>{tools}</FilterBar><div className="err">{err}</div></>;
  if (!data) return <><FilterBar right={right}>{tools}</FilterBar><div className="loading">{tr('불러오는 중…')}</div></>;
  if (!data.points.length) return <><FilterBar right={right}>{tools}</FilterBar><div className="empty">{tr('날짜가 있는 작업이 없어 공정률을 계산할 수 없습니다.')}</div></>;

  const { points, today: now } = data;
  const gap = Math.round((now.actual - now.plan) * 10) / 10;
  const behind = gap < -0.05;
  // 축
  const t0 = new Date(points[0].date).getTime(), t1 = new Date(points.at(-1).date).getTime();
  const X = d => PAD.l + ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)) * (w - PAD.l - PAD.r);
  const Y = v => PAD.t + (1 - v / 100) * (H - PAD.t - PAD.b);
  const line = key => points.filter(p => p[key] != null).map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p[key]).toFixed(1)}`).join('');
  // 달 눈금 (너무 촘촘하면 건너뜀)
  const months = [];
  for (let d = new Date(points[0].date.slice(0, 7) + '-01'); d.getTime() <= t1; d.setMonth(d.getMonth() + 1)) {
    const s = d.toISOString().slice(0, 10);
    if (new Date(s).getTime() >= t0) months.push(s);
  }
  const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor((w - PAD.l - PAD.r) / 70))));
  const showToday = now.date >= points[0].date && now.date <= points.at(-1).date;
  const hp = hover != null ? points[hover] : null;
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left;
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const dd = Math.abs(X(p.date) - x); if (dd < bd) { bd = dd; best = i; } });
    setHover(best);
  };
  // 끝 라벨 (겹치면 벌림)
  const lastAct = [...points].reverse().find(p => p.actual != null);
  let yPlanLbl = Y(now.plan), yActLbl = Y(now.actual);
  if (Math.abs(yPlanLbl - yActLbl) < 16) { const m = (yPlanLbl + yActLbl) / 2, up = now.actual >= now.plan; yActLbl = m + (up ? -9 : 9); yPlanLbl = m + (up ? 9 : -9); }

  return (
    <>
      <FilterBar right={right}>{tools}</FilterBar>
      <div className="kpis">
        <div className="kpi">{tr('계획 공정률')}<b>{pct(now.plan)}</b><span className="small">{tr('오늘')} {fmt(now.date)} · {tr(baseSel ? '선택한 기준선' : '기준 일정')}</span></div>
        <div className="kpi prog">{tr('실적 공정률')}<b>{pct(now.actual)}</b><span className="small">{tr('작업 {n}건', { n: data.count })} · {tr(data.mode === 'weight' ? '가중치 기준' : '기간 기준')}</span></div>
        <div className={`kpi ${behind ? 'late' : 'done'}`}>{tr('계획 대비')}<b style={behind ? { color: 'var(--late)' } : undefined}>{behind ? '▼ ' : '▲ '}{gap > 0 ? '+' : ''}{gap}%p</b><span className="small">{tr(behind ? '계획보다 늦음' : '계획대로 또는 앞섬')}</span></div>
        <div className="kpi">{tr('계획 기간')}<b style={{ fontSize: 'calc(22px*var(--fs))' }}>{fmtY(data.start)} ~ {fmtY(data.end)}</b></div>
      </div>
      <div className="card sc-card">
        <div className="sc-legend">
          <span><i className="sc-key plan" />{tr('계획')}</span>
          <span><i className="sc-key act" />{tr('실적')}</span>
          {showToday && <span><i className="sc-key today" />{tr('오늘')}</span>}
        </div>
        <div ref={box} className="sc-box">
          <svg width={w} height={H} role="img" aria-label={tr('공정률 S-커브: 계획 {a}, 실적 {b}', { a: pct(now.plan), b: pct(now.actual) })}
            onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
            {[0, 25, 50, 75, 100].map(v => <g key={v}>
              <line x1={PAD.l} x2={w - PAD.r} y1={Y(v)} y2={Y(v)} className="sc-grid" />
              <text x={PAD.l - 6} y={Y(v) + 4} textAnchor="end" className="sc-ax">{v}%</text>
            </g>)}
            {months.map((m, i) => i % every === 0 && <text key={m} x={X(m)} y={H - 8} textAnchor="middle" className="sc-ax">{m.slice(0, 7).replace('-', '.')}</text>)}
            {showToday && <line x1={X(now.date)} x2={X(now.date)} y1={PAD.t} y2={H - PAD.b} className="sc-today" />}
            <path d={line('plan')} className="sc-plan" />
            <path d={line('actual')} className="sc-act" />
            {lastAct && <circle cx={X(lastAct.date)} cy={Y(lastAct.actual)} r={4.5} className="sc-dot act" />}
            {showToday && <circle cx={X(now.date)} cy={Y(now.plan)} r={4} className="sc-dot plan" />}
            {showToday && <>
              <text x={X(now.date) + 8} y={yActLbl + 4} className="sc-lbl b">{tr('실적')} {pct(now.actual)}</text>
              <text x={X(now.date) + 8} y={yPlanLbl + 4} className="sc-lbl">{tr('계획')} {pct(now.plan)}</text>
            </>}
            <text x={w - PAD.r + 6} y={Y(points.at(-1).plan) + 4} className="sc-lbl">{pct(points.at(-1).plan)}</text>
            {hp && <g>
              <line x1={X(hp.date)} x2={X(hp.date)} y1={PAD.t} y2={H - PAD.b} className="sc-cross" />
              <circle cx={X(hp.date)} cy={Y(hp.plan)} r={4} className="sc-dot plan" />
              {hp.actual != null && <circle cx={X(hp.date)} cy={Y(hp.actual)} r={4} className="sc-dot act" />}
            </g>}
          </svg>
          {hp && <div className="sc-tip" style={{ left: Math.min(X(hp.date) + 12, w - 170), top: 12 }}>
            <b>{fmtY(hp.date)}</b>
            <div><i className="sc-key plan" />{tr('계획')} <span>{pct(hp.plan)}</span></div>
            <div><i className="sc-key act" />{tr('실적')} <span>{hp.actual == null ? '—' : pct(hp.actual)}</span></div>
            {hp.actual != null && <div className="small">{tr('차이')} {Math.round((hp.actual - hp.plan) * 10) / 10}%p</div>}
          </div>}
        </div>
        <div className="small" style={{ marginTop: 6 }}>{tr('계획: 기준선(없으면 기준 일정·현재 일정) 기간 안에서 날짜에 비례해 쌓입니다. 실적: 실제 시작일부터 실제 완료일(진행 중이면 오늘)까지 현재 진행률만큼 쌓인 것으로 봅니다. 요약 작업은 하위 작업으로 계산합니다.')}</div>
      </div>
      {table && <div className="tablewrap" style={{ marginTop: 10, maxHeight: 420 }}><table>
        <thead><tr><th>{tr('날짜')}</th><th>{tr('계획')}</th><th>{tr('실적')}</th><th>{tr('차이')}</th></tr></thead>
        <tbody>{points.map(p => <tr key={p.date} className={p.date === now.date ? 'dirty' : ''}>
          <td className="nw">{fmtY(p.date)}</td><td>{pct(p.plan)}</td><td>{p.actual == null ? '' : pct(p.actual)}</td>
          <td className={p.actual != null && p.actual < p.plan ? 'slip' : ''}>{p.actual == null ? '' : `${Math.round((p.actual - p.plan) * 10) / 10}%p`}</td>
        </tr>)}</tbody>
      </table></div>}
    </>
  );
}
