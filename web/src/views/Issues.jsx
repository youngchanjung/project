import { useState } from 'react';
import { useProject } from '../pages/Project.jsx';
import { fmt, diff, ddayTxt, issueOpen, issueLate, downloadCSV } from '../util.js';

export default function Issues() {
  const { issues, tasks, td, openIssue, project } = useProject();
  const [st, setSt] = useState('미해결');
  const [pr, setPr] = useState('');
  const [pa, setPa] = useState('');
  const [q, setQ] = useState('');
  const uniq = f => [...new Set(issues.map(f).filter(Boolean))];
  const taskOf = id => tasks.find(t => t.id === id);
  let is = issues.filter(i => !st || (st === '미해결' ? issueOpen(i) : st === '지연' ? issueLate(i, td) : i.status === st))
    .filter(i => !pr || i.priority === pr).filter(i => !pa || i.party === pa)
    .filter(i => !q || [i.code, i.title, i.detail, i.owner, i.party, i.remark].join(' ').toLowerCase().includes(q.toLowerCase()));
  const rank = { 상: 0, 중: 1, 하: 2 };
  is = [...is].sort((a, b) => (issueLate(b, td) - issueLate(a, td)) || ((rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)) || (a.target || '9').localeCompare(b.target || '9'));
  return (
    <>
      <div className="kpis">
        <div className="kpi">전체 이슈<b>{issues.length}</b></div>
        <div className="kpi prog">미해결<b>{issues.filter(issueOpen).length}</b></div>
        <div className="kpi late">목표일 지남<b>{issues.filter(i => issueLate(i, td)).length}</b></div>
        <div className="kpi soon">상 · 미해결<b>{issues.filter(i => issueOpen(i) && i.priority === '상').length}</b></div>
        <div className="kpi done">해결완료<b>{issues.filter(i => !issueOpen(i)).length}</b></div>
      </div>
      <div className="toolbar">
        <span className="small">현황:</span>
        {['미해결', '지연', '접수', '검토중', '조치중', '해결완료', '보류', ''].map(s => <span key={s} className={`chip ${st === s ? 'on' : ''}`} onClick={() => setSt(s)}>{s || '전체'}</span>)}
        <select value={pr} onChange={e => setPr(e.target.value)}><option value="">중요도 전체</option>{['상', '중', '하'].map(x => <option key={x}>{x}</option>)}</select>
        <select value={pa} onChange={e => setPa(e.target.value)}><option value="">책임기관 전체</option>{uniq(i => i.party).map(x => <option key={x}>{x}</option>)}</select>
        <input type="search" placeholder="이슈 검색" value={q} onChange={e => setQ(e.target.value)} />
        <span className="small">{is.length}건</span><div className="sp" />
        <button className="btn sm" onClick={() => downloadCSV(`${project.name}_이슈`, [['code', 'No'], ['priority', '중요도'], ['category', '구분'], ['title', '이슈'], ['detail', '상세'], ['party', '책임기관'], ['owner', '담당'], ['raised', '발생일'], ['target', '목표일'], ['resolved', '해결일'], ['status', '현황'], ['remark', '비고']], is)}>CSV</button>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>No</th><th>중요도</th><th>구분</th><th>이슈</th><th>관련 작업</th><th>책임기관</th><th>담당</th><th>발생일</th><th>목표일</th><th>경과</th><th>현황</th></tr></thead>
        <tbody>{is.map(i => {
          const late = issueLate(i, td), t = taskOf(i.task_id);
          return (
            <tr key={i.id} className="click" onClick={() => openIssue(i.id)}>
              <td className="nw small">{i.code}</td>
              <td><span className={`badge ${i.priority === '상' ? 'b-지연' : i.priority === '중' ? 'b-임박' : 'b-예정'}`}>{i.priority}</span></td>
              <td className="nw">{i.category}</td>
              <td><b>{i.title}</b><div className="small">{i.detail}</div></td>
              <td className="small">{t ? `${t.code || ''} ${t.name}` : ''}</td>
              <td>{i.party}</td><td>{i.owner}</td>
              <td className="nw">{fmt(i.raised)}</td>
              <td className="nw" style={late ? { color: 'var(--late)', fontWeight: 700 } : undefined}>{fmt(i.target)}{i.target && issueOpen(i) && <div className="small">{ddayTxt(diff(td, i.target))}</div>}</td>
              <td className="nw">{i.raised ? diff(i.raised, i.resolved || td) + '일' : ''}</td>
              <td className="nw">{issueOpen(i) ? <span className={`badge ${late ? 'b-지연' : 'b-진행중'}`}>{i.status}{late ? '·지연' : ''}</span> : <span className="badge b-완료">{i.status}</span>}</td>
            </tr>);
        })}{!is.length && <tr><td colSpan={11} className="empty">해당 이슈가 없습니다.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
