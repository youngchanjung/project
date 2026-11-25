import { useState } from 'react';
import { useProject, FilterBar } from '../pages/Project.jsx';
import Dropdown, { DDRadio } from '../components/Dropdown.jsx';
import { addD, diff, fmt, fmtW, dow, weekday, downloadXLSX, taskCols } from '../util.js';
import ExportButton from '../components/ExportButton.jsx';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

// 룩어헤드: 이번 주부터 N주 안에 할 작업만 업체·공종별로 묶어 보는 현장 주간 회의용 화면 (인쇄 가능)
const COL = { 지연: 'var(--late)', 진행중: 'var(--prog)', 예정: 'var(--bar-plan)', 보류: 'var(--hold)' };
const WEEKS = [2, 3, 4, 6];
const GROUPS = [['company', '업체'], ['trade', '공종'], ['owner', '담당'], ['phase', '단계'], ['none', '없음']];
const NONE = { company: '업체 없음', trade: '공종 없음', owner: '담당 없음', phase: '단계 없음' };
function load() {
  try { return { weeks: 3, group: 'company', critOnly: false, ...JSON.parse(localStorage.getItem('lookahead-opt') || '{}') }; }
  catch { return { weeks: 3, group: 'company', critOnly: false }; }
}

export default function Lookahead() {
  const { filtered, phases, holidays, td, openTask, project, toast, tasks, deps, color } = useProject();
  const [opt, setOptS] = useState(load);
  const setOpt = patch => setOptS(o => { const n = { ...o, ...patch }; try { localStorage.setItem('lookahead-opt', JSON.stringify(n)); } catch {} return n; });
  const w0 = addD(td, -((weekday(td) + 6) % 7)); // 이번 주 월요일
  const w1 = addD(w0, opt.weeks * 7 - 1);
  const hm = new Map(holidays.map(h => [h.date, h.name]));
  const days = []; for (let d = w0; d <= w1; d = addD(d, 1)) days.push(d);

  const parents = new Set(tasks.map(t => t.parent_id).filter(Boolean)); // 요약 작업은 빼고 실제 작업만
  const ts = filtered.filter(t => !t.undated && !parents.has(t.id) && t.st !== '완료' && (!opt.critOnly || t.crit) && ((t.start <= w1 && t.end >= w0) || t.st === '지연'))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const phaseName = id => phases.find(p => p.id === id)?.name || '';
  const keyOf = t => opt.group === 'phase' ? (t.phase_id || 0) : opt.group === 'none' ? 'all' : (t[opt.group] || '');
  const nameOf = (k, t) => opt.group === 'none' ? tr('전체 작업') : opt.group === 'phase' ? (k ? phaseName(k) : tr(NONE.phase)) : (k || tr(NONE[opt.group]));
  const groups = [];
  for (const t of ts) {
    const k = keyOf(t); let g = groups.find(x => x.k === k);
    if (!g) { g = { k, name: nameOf(k, t), dot: opt.group === 'phase' ? color(t.phase_id) : 'var(--muted)', ts: [] }; groups.push(g); }
    g.ts.push(t);
  }
  if (opt.group !== 'phase' && opt.group !== 'none') groups.sort((a, b) => (a.k === '') - (b.k === '') || String(a.k).localeCompare(String(b.k)));
  if (opt.group === 'phase') { const o = new Map(phases.map((p, i) => [p.id, i])); groups.sort((a, b) => (o.get(a.k) ?? 999) - (o.get(b.k) ?? 999)); }

  const span = t => `${fmtW(t.start)}${t.end !== t.start ? ' ~ ' + fmtW(t.end) : ''}`;
  const tools = (
    <>
      <div className="seg">{WEEKS.map(n => <button key={n} className={opt.weeks === n ? 'on' : ''} onClick={() => setOpt({ weeks: n })}>{tr('{n}주', { n })}</button>)}</div>
      <Dropdown label={`${tr('묶음')}: ${tr(Object.fromEntries(GROUPS)[opt.group])}`} active={opt.group !== 'company'}>
        {close => GROUPS.map(([k, n]) => <DDRadio key={k} checked={opt.group === k} onClick={() => { setOpt({ group: k }); close(); }}>{tr(n)}</DDRadio>)}
      </Dropdown>
      <button type="button" className={`tbtn ${opt.critOnly ? 'on' : ''}`} onClick={() => setOpt({ critOnly: !opt.critOnly })}>{opt.critOnly ? '✓ ' : ''}{tr('크리티컬 패스만')}</button>
    </>
  );
  const right = (
    <>
      <button className="tbtn" onClick={() => window.print()}>🖨 {tr('인쇄')}</button>
      <ExportButton toast={toast} make={() => downloadXLSX(`${project.name}_룩어헤드_${opt.weeks}주`, [{ name: '룩어헤드', cols: taskCols({ phases, tasks, deps }), rows: ts }])} />
    </>
  );
  return (
    <>
      <FilterBar right={right}>{tools}</FilterBar>
      <div className="small" style={{ margin: '4px 2px 8px' }}>
        <b>{project.name}</b> · {tr('룩어헤드 {n}주', { n: opt.weeks })}: {fmtW(w0)} ~ {fmtW(w1)} · {tr('작업 {n}건', { n: ts.length })}
        {' · '}{tr('지연된 작업은 기간 밖이어도 함께 보여 줍니다.')}
      </div>
      {!ts.length ? <div className="empty">{tr('이 기간에 할 작업이 없습니다.')}</div> : (
        <div className="lawrap"><table className="latab">
          <thead><tr>
            <th className="lname">{tr('작업명')}</th>
            <th className="linfo">{tr('기간')}</th><th className="linfo">{tr('담당')}</th><th className="linfo">{tr('진행률')}</th><th className="linfo">{tr('여유')}</th>
            {days.map(d => <th key={d} className={`lday ${weekday(d) === 1 ? 'wk' : ''} ${weekday(d) === 0 || weekday(d) === 6 ? 'off' : ''} ${hm.has(d) ? 'hol' : ''} ${d === td ? 'today' : ''}`} title={hm.get(d) || ''}>
              {weekday(d) === 1 || d === w0 ? <div className="small">{fmt(d)}</div> : null}{dow(d)}</th>)}
          </tr></thead>
          <tbody>{groups.map(g => [
            <tr key={'g' + g.k} className="lgrp"><td className="lname"><span className="dot" style={{ background: g.dot }} />{g.name} <span className="small">({g.ts.length})</span></td><td colSpan={4 + days.length} /></tr>,
            ...g.ts.map(t => (
              <tr key={t.id} className="click" onClick={() => openTask(t.id)}>
                <td className="lname" title={t.name}>{t.crit && <span className="cptag">CP</span>}<span className="small">{t.code}</span> <Tx>{t.name}</Tx></td>
                <td className="linfo">{span(t)}{t.st === '지연' && <span className="slip"> · {tr('{n}일 지남', { n: diff(t.end, td) })}</span>}</td>
                <td className="linfo">{[t.owner, opt.group !== 'company' && t.company].filter(Boolean).join(' · ')}</td>
                <td className="linfo">{t.progress ? `${t.progress}%` : ''}</td>
                <td className="linfo">{t.float == null ? '' : <span className={t.crit ? 'fcrit' : ''}>{t.float}{tr('일')}</span>}</td>
                {days.map(d => {
                  const on = d >= t.start && d <= t.end;
                  const cls = `lday ${weekday(d) === 1 ? 'wk' : ''} ${weekday(d) === 0 || weekday(d) === 6 ? 'off' : ''} ${hm.has(d) ? 'hol' : ''} ${d === td ? 'today' : ''}`;
                  return <td key={d} className={`${cls} ${on ? `on ${d === t.start || d === w0 ? 's' : ''} ${d === t.end || d === w1 ? 'e' : ''} ${t.crit ? 'crit' : ''}` : ''}`} style={on ? { '--k': COL[t.st] || 'var(--bar-plan)' } : undefined}>{on ? <i /> : d === td && t.st === '지연' ? <b className="slip" title={tr('{n}일 지남', { n: diff(t.end, td) })}>!</b> : null}</td>;
                })}
              </tr>))
          ])}</tbody>
        </table></div>
      )}
    </>
  );
}
