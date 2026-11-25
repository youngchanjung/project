import { useProject } from '../pages/Project.jsx';
import { addD, diff, fmt, fmtY, dow, ddayTxt, issueOpen, issueLate, downloadXLSX, taskCols, issueCols } from '../util.js';
import ExportButton from '../components/ExportButton.jsx';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

export function TaskRow({ t, right }) {
  const { color, openTask, phases } = useProject();
  const ph = phases.find(p => p.id === t.phase_id);
  return (
    <div className="item" onClick={() => openTask(t.id)}>
      <span className="dot" style={{ background: color(t.phase_id), marginTop: 6 }} />
      <div className="main"><div className="t">{t.is_key ? '★ ' : ''}<Tx>{t.name}</Tx></div>
        <div className="small">{[ph?.name, `${fmt(t.start)}${t.end !== t.start ? '~' + fmt(t.end) : ''}`, t.owner].filter(Boolean).join(' · ')}</div></div>
      {right}
    </div>
  );
}

export default function Dashboard() {
  const { filtered: all, issues, holidays, td, openIssue, phases, tasks, deps, project, toast, bl } = useProject();
  const isCons = project.category === 'construction';
  const ts = all.filter(t => !t.undated); // 날짜 없는 할 일은 칸반·할 일 목록에서만
  const wk = addD(td, 7);
  const late = ts.filter(t => t.st === '지연').sort((a, b) => a.end.localeCompare(b.end));
  const prog = ts.filter(t => t.st === '진행중').sort((a, b) => a.end.localeCompare(b.end));
  const week = ts.filter(t => t.st !== '완료' && t.st !== '지연' && ((t.start > td && t.start <= wk) || (t.end >= td && t.end <= wk)))
    .sort((a, b) => (a.start > td ? a.start : a.end).localeCompare(b.start > td ? b.start : b.end));
  const keys = ts.filter(t => t.is_key && t.st !== '완료' && t.start >= td).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 10);
  const io = issues.filter(issueOpen), il = io.filter(i => issueLate(i, td));
  const ihigh = io.filter(i => i.priority === '상').sort((a, b) => (a.target || '9').localeCompare(b.target || '9'));
  const hols = holidays.filter(h => h.date >= td && h.date <= addD(td, 30));
  const done = ts.filter(t => t.st === '완료').length;
  // 시공: 크리티컬 패스·기준선 대비 지연
  const crit = ts.filter(t => t.crit).sort((a, b) => a.start.localeCompare(b.start));
  const slipped = ts.map(t => { const b = bl(t); return b ? { t, n: diff(b.end, t.end) } : null; }).filter(x => x && x.n > 0).sort((a, b) => b.n - a.n);

  return (
    <>
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <ExportButton toast={toast} make={() => {
          const tc = taskCols({ phases, tasks, deps }), ic = issueCols({ tasks });
          return downloadXLSX(`${project.name}_대시보드`, [
            { name: '기한 초과', cols: [...tc, [t => diff(t.end, td), '지연(일)']], rows: late },
            { name: '앞으로 7일', cols: tc, rows: week }, { name: '진행 중', cols: tc, rows: prog },
            { name: '중요 이슈', cols: ic, rows: ihigh }, { name: '핵심 일정', cols: tc, rows: keys },
            { name: '30일 내 공휴일', cols: [['date', '날짜'], [h => dow(h.date), '요일'], ['name', '이름'], ['country', '국가']], rows: hols }]);
        }} />
      </div>
      <div className="kpis">
        <div className="kpi late">{tr('기한 초과 작업')}<b>{late.length}</b></div>
        <div className="kpi prog">{tr('진행 중')}<b>{prog.length}</b></div>
        <div className="kpi soon">{tr('7일 내 시작·마감')}<b>{week.length}</b></div>
        <div className="kpi late">{tr('지연 이슈')}<b>{il.length}</b><span className="small">{tr('미해결')} {io.length}{tr('건 중')}</span></div>
        {isCons && <div className="kpi late">{tr('크리티컬 작업')}<b style={{ color: 'var(--crit)' }}>{crit.length}</b><span className="small">{tr('여유 0일')}</span></div>}
        {isCons && <div className="kpi late">{tr('기준선보다 늦음')}<b>{slipped.length}</b>{slipped[0] && <span className="small">{tr('최대 +{n}일', { n: slipped[0].n })}</span>}</div>}
        <div className="kpi done">{tr('완료')}<b>{done}</b><span className="small">{tr('전체 {n}건', { n: ts.length })} ({ts.length ? Math.round(done / ts.length * 100) : 0}%)</span></div>
      </div>
      <div className="grid2">
        {isCons && <div className="card"><h3>{tr('크리티컬 패스')} <span className="small">{crit.length}{tr('건')} · {tr('늦어지면 전체 준공이 늦어짐')}</span></h3><div className="list">
          {crit.slice(0, 12).map(t => <TaskRow key={t.id} t={t} right={<span className="dd fcrit">{t.st === '지연' ? ddayTxt(diff(td, t.end)) : fmt(t.end)}</span>} />)}
          {!crit.length && <div className="empty">{tr('선행관계를 넣으면 크리티컬 패스가 계산됩니다.')}</div>}</div></div>}
        {isCons && <div className="card"><h3>{tr('기준선 대비 지연')} <span className="small">{slipped.length}{tr('건')}</span></h3><div className="list">
          {slipped.slice(0, 12).map(({ t, n }) => <TaskRow key={t.id} t={t} right={<span className="dd slip">+{n}{tr('일')}</span>} />)}
          {!slipped.length && <div className="empty">{tr('기준선보다 늦어진 작업이 없습니다.')}</div>}</div></div>}
        <div className="card"><h3>{tr('기한 초과')} <span className="small">{late.length}{tr('건')}</span></h3><div className="list">
          {late.map(t => <TaskRow key={t.id} t={t} right={<span className="dd" style={{ color: 'var(--late)' }}>{ddayTxt(diff(td, t.end))}</span>} />)}
          {!late.length && <div className="empty">{tr('기한 초과 작업이 없습니다.')}</div>}</div></div>
        <div className="card"><h3>{tr('앞으로 7일')} <span className="small">{fmt(td)} ~ {fmt(wk)}</span></h3><div className="list">
          {week.map(t => { const s = t.start > td, d = s ? t.start : t.end; return <TaskRow key={t.id} t={t} right={<span className={`badge ${s ? 'b-예정' : 'b-임박'}`}>{tr(s ? '시작' : '마감')} {fmt(d)}({dow(d)})</span>} />; })}
          {!week.length && <div className="empty">{tr('예정된 일정이 없습니다.')}</div>}</div></div>
        <div className="card"><h3>{tr('진행 중')} <span className="small">{prog.length}{tr('건')}</span></h3><div className="list">
          {prog.map(t => <TaskRow key={t.id} t={t} right={<span className="dd">{ddayTxt(diff(td, t.end))}</span>} />)}
          {!prog.length && <div className="empty">{tr('진행 중인 작업이 없습니다.')}</div>}</div></div>
        <div className="card"><h3>{tr('중요(상) 미해결 이슈')} <span className="small">{ihigh.length}{tr('건')}</span></h3><div className="list">
          {ihigh.map(i => (
            <div key={i.id} className="item" onClick={() => openIssue(i.id)}>
              <div className="main"><div className="t"><Tx>{i.title}</Tx></div><div className="small">{[i.code, i.party, i.owner].filter(Boolean).join(' · ')}</div></div>
              <span className={`badge ${issueLate(i, td) ? 'b-지연' : 'b-예정'}`}>{i.target ? `${tr('목표')} ${fmt(i.target)}` : tr('목표일 없음')}</span>
            </div>))}
          {!ihigh.length && <div className="empty">{tr('없음')}</div>}</div></div>
        <div className="card"><h3>{tr('다가오는 핵심 일정 ★')}</h3><div className="list">
          {keys.map(t => <TaskRow key={t.id} t={t} right={<span className="dd">{ddayTxt(diff(td, t.start))}</span>} />)}
          {!keys.length && <div className="empty">{tr('없음 (작업을 ‘핵심’으로 표시하면 여기에 나옵니다)')}</div>}</div></div>
        <div className="card"><h3>{tr('30일 내 공휴일')}</h3><div className="list">
          {hols.map(h => <div key={h.id} className="item"><div className="main">{h.name} <span className="small">({h.country})</span></div><span className="small">{fmtY(h.date)} ({dow(h.date)})</span></div>)}
          {!hols.length && <div className="empty">{tr('없음')}</div>}</div></div>
      </div>
    </>
  );
}
