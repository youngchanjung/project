// 업무량: 사람별로 주마다 맡은 할 일의 예상 시간 합계를 주당 근무 시간과 비교
//   - 예상 시간은 시작~마감 사이 근무일에 고르게 나눔 (지난 몫은 오늘부터 다시 나눔)
//   - 진한 막대 = 이 프로젝트, 옅은 막대 = 다른 프로젝트
//   - 80% 넘으면 주황, 100% 넘으면 빨강
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { fmt, fmtW, fmtY, fmtH, personColor, today, addD, downloadXLSX } from '../util.js';
import { useApp } from '../App.jsx';
import Modal from '../components/Modal.jsx';
import DateInput from '../components/DateInput.jsx';
import ExportButton from '../components/ExportButton.jsx';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

const level = (h, cap) => (!cap ? (h > 0 ? 'over' : '') : h > cap ? 'over' : h >= cap * 0.8 ? 'high' : '');

export default function Workload() {
  const { project, openTask, tasks, reload } = useProject();
  const { user } = useApp();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [bump, setBump] = useState(0);
  const nav = useNavigate();
  const [weeks, setWeeks] = useState(4);
  const [onlyHere, setOnlyHere] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(null); // { uid, wi }
  // 할 일이 바뀌면(편집창 저장 등) 다시 계산
  const stamp = tasks.map(t => `${t.id}:${t.version}`).join(',');
  useEffect(() => {
    api.get(`/workload?project=${project.id}&weeks=${weeks}`).then(d => { setData(d); setErr(null); }).catch(e => setErr(e.message));
  }, [project.id, weeks, stamp, bump]);

  if (err) return <div className="err">{err}</div>;
  if (!data) return <div className="loading">{tr('불러오는 중…')}</div>;
  const hv = c => (onlyHere ? c.here : c.hours);
  const over = data.rows.filter(r => hv(r.weeks[0]) > r.caps[0]).length;
  const noEst = data.rows.reduce((a, r) => a + r.weeks.reduce((b, c) => b + c.noEst, 0), 0) + (data.unassigned?.weeks.reduce((b, c) => b + c.noEst, 0) || 0);
  const rows = [...data.rows, ...(data.unassigned ? [{ user: { id: 0, name: tr('담당 없음') }, caps: data.weeks.map(() => 0), ...data.unassigned }] : [])];
  const cur = sel && rows.find(r => r.user.id === sel.uid);
  const cell = cur && cur.weeks[sel.wi];
  const open = t => (t.project_id === project.id ? openTask(t.id) : nav(`/projects/${t.project_id}/board?open=${t.id}`));

  return (
    <>
      <div className="toolbar">
        <select value={weeks} onChange={e => setWeeks(Number(e.target.value))}>{[2, 4, 6, 8].map(n => <option key={n} value={n}>{tr('{n}주 보기', { n })}</option>)}</select>
        <button type="button" className={`tbtn ${onlyHere ? 'on' : ''}`} onClick={() => setOnlyHere(!onlyHere)}>{onlyHere ? '✓ ' : ''}{tr('이 프로젝트만')}</button>
        <span className={`badge ${over ? 'b-지연' : 'b-완료'}`}>{over ? tr('이번 주 넘침 {n}명', { n: over }) : tr('이번 주 넘치는 사람 없음')}</span>
        {noEst > 0 && <span className="small">{tr('시간 미입력 카드 {n}건은 건수만 셉니다.', { n: noEst })}</span>}
        <div className="sp" />
        <button className="btn" onClick={() => setLeaveOpen(true)}>🏖 {tr('휴가·부재')}</button>
        <span className="small"><span className="wl-key here" /> {tr('이 프로젝트')} <span className="wl-key other" /> {tr('다른 프로젝트')}</span>
      </div>
      <div className="card wl-wrap">
        <table className="wl">
          <thead><tr><th>{tr('담당자')}</th>
            {data.weeks.map((w, i) => <th key={w.start}>{i === 0 ? tr('이번 주') : i === 1 ? tr('다음 주') : `${fmt(w.start)}~${fmt(w.end)}`}<div className="small">{i < 2 ? `${fmt(w.start)}~${fmt(w.end)}` : ''}{w.workdays < 5 ? `${i < 2 ? ' · ' : ''}${tr('근무 {n}일', { n: w.workdays })}` : ''}</div></th>)}
            <th>{tr('날짜 없음')}</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.user.id}>
              <td className="nw">{r.user.id ? <span className="avatar sm" style={{ background: personColor(r.user.id) }}>{r.user.name.slice(0, 1)}</span> : null} {r.user.name}
                {r.weekly_hours && r.weekly_hours !== 40 ? <div className="small">{tr('주 {n}시간', { n: r.weekly_hours })}</div> : null}</td>
              {r.weeks.map((c, i) => {
                const h = hv(c), cap = r.caps[i], lv = r.user.id ? level(c.hours, cap) : '';
                const max = Math.max(cap, c.hours, 1);
                const on = sel && sel.uid === r.user.id && sel.wi === i;
                return (
                  <td key={i} className={`wl-c ${lv} ${on ? 'on' : ''}`} onClick={() => setSel(on ? null : { uid: r.user.id, wi: i })} title={tr('누르면 할 일 목록을 봅니다.')}>
                    {c.count ? <>
                      <div className="wl-bar">
                        <span className="here" style={{ width: `${(c.here / max) * 100}%` }} />
                        {!onlyHere && <span className="other" style={{ width: `${((c.hours - c.here) / max) * 100}%` }} />}
                        {cap > 0 && c.hours > cap && <i className="cap" style={{ left: `${(cap / max) * 100}%` }} />}
                      </div>
                      <div className="wl-n"><b>{fmtH(h)}</b>{r.user.id ? <span className="small"> / {fmtH(cap)}</span> : null}</div>
                      <div className="small">{tr('카드 {n}', { n: c.count })}{c.noEst ? ` · ${tr('시간 미입력 {n}', { n: c.noEst })}` : ''}</div>
                    </> : <span className="small">-</span>}
                    {r.leave?.[i]?.days > 0 && <div className="wl-leave">🏖 {tr('부재 {n}일', { n: r.leave[i].days })}</div>}
                  </td>
                );
              })}
              <td className="small nw">{r.undated.count ? `${r.undated.count}${tr('건')}${r.undated.hours ? ` · ${fmtH(r.undated.hours)}` : ''}` : '-'}</td>
            </tr>))}
          </tbody>
        </table>
        {!rows.length && <p className="small">{tr('참여자가 없습니다. ‘설정’에서 참여자를 추가하세요.')}</p>}
      </div>
      {cell && <div className="card" style={{ marginTop: 12 }}>
        <h3>{cur.user.name} · {sel.wi === 0 ? tr('이번 주') : sel.wi === 1 ? tr('다음 주') : `${fmt(data.weeks[sel.wi].start)}~${fmt(data.weeks[sel.wi].end)}`} <span className="small">{fmtH(cell.hours)}{cur.caps[sel.wi] ? ` / ${fmtH(cur.caps[sel.wi])}` : ''}</span></h3>
        {cell.tasks.length ? <table><tbody>{cell.tasks.filter(t => !onlyHere || t.here).map(t => (
          <tr key={t.id} className="clickable" onClick={() => open(t)}>
            <td><Tx>{t.name}</Tx>{t.project_id !== project.id && <div className="small">{t.project_name}</div>}</td>
            <td className="small nw">{tr('마감')} {fmtW(t.end)}</td>
            <td className="nw">{t.est ? fmtH(t.hours) : <span className="small">{tr('시간 미입력')}</span>}</td>
          </tr>))}</tbody></table> : <p className="small">{tr('이 주에 걸친 할 일이 없습니다.')}</p>}
        <p className="small">{tr('예상 시간은 시작일~마감일 사이 근무일에 고르게 나눠 계산합니다. 기한이 지난 할 일은 이번 주에 모두 넣습니다.')}</p>
      </div>}
      <TimeSummary />
      {user.role === 'admin' && !user.external && <CostCard />}
      {leaveOpen && <LeaveModal onClose={() => { setLeaveOpen(false); setBump(b => b + 1); reload(); }} />}
    </>
  );
}

// 투입 시간 합계: 기간을 골라 사람 × 단계별 실제 기록 시간, 엑셀로 내보내기
function TimeSummary() {
  const { project, phases, toast, tasks } = useProject();
  const td = today();
  const RANGES = { month: [td.slice(0, 8) + '01', td], last: [addD(td.slice(0, 8) + '01', -1).slice(0, 8) + '01', addD(td.slice(0, 8) + '01', -1)], all: ['', ''] };
  const [range, setRange] = useState('month');
  const [rows, setRows] = useState(null);
  const stamp = tasks.reduce((a, t) => a + (t.spent || 0), 0);
  useEffect(() => {
    const [from, to] = RANGES[range];
    api.get(`/projects/${project.id}/time${from ? `?from=${from}&to=${to}` : ''}`).then(setRows).catch(() => setRows([]));
  }, [project.id, range, stamp]); // eslint-disable-line
  const table = useMemo(() => {
    if (!rows) return null;
    const cols = [...phases.filter(p => rows.some(r => r.phase_id === p.id)).map(p => ({ id: p.id, name: p.name })), ...(rows.some(r => !r.phase_id) ? [{ id: 0, name: tr('단계 없음') }] : [])];
    const people = [...new Map(rows.map(r => [r.user_id, r.user_name])).entries()].map(([id, name]) => {
      const by = Object.fromEntries(cols.map(c => [c.id, 0]));
      for (const r of rows) if (r.user_id === id) by[r.phase_id || 0] = (by[r.phase_id || 0] || 0) + r.hours;
      return { id, name, by, total: Object.values(by).reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.total - a.total);
    return { cols, people, total: rows.reduce((a, r) => a + r.hours, 0) };
  }, [rows, phases]);
  const r1 = x => Math.round(x * 10) / 10;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="toolbar" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>{tr('투입 시간 (실제 기록)')}</h3>
        <select value={range} onChange={e => setRange(e.target.value)}>{[['month', '이번 달'], ['last', '지난 달'], ['all', '전체']].map(([k, n]) => <option key={k} value={k}>{tr(n)}</option>)}</select>
        {table && <span className="small">{tr('합계')} <b>{fmtH(r1(table.total))}</b></span>}
        <div className="sp" />
        {rows?.length > 0 && <ExportButton toast={toast} make={() => downloadXLSX(`${project.name}_투입시간`, [
          { name: '사람·단계별', rows: table.people, cols: [['name', '담당자'], ...table.cols.map(c => [p => r1(p.by[c.id] || 0), c.name]), [p => r1(p.total), '합계']] },
          { name: '기록 목록', rows, cols: [['date', '날짜'], ['user_name', '담당자'], ['task_name', '할 일'], [r => phases.find(p => p.id === r.phase_id)?.name || '', '단계'], ['hours', '시간'], ['note', '메모']] }
        ])} />}
      </div>
      {!table ? <div className="small">{tr('불러오는 중…')}</div> : !table.people.length ? <p className="small">{tr('이 기간에 기록한 시간이 없습니다. 카드를 열어 ‘시간 기록’ 탭에서 입력합니다.')}</p> :
        <div className="wl-wrap"><table className="wl"><thead><tr><th>{tr('담당자')}</th>{table.cols.map(c => <th key={c.id}>{c.name}</th>)}<th>{tr('합계')}</th></tr></thead>
          <tbody>{table.people.map(p => <tr key={p.id}><td className="nw">{p.name}</td>{table.cols.map(c => <td key={c.id}>{p.by[c.id] ? fmtH(r1(p.by[c.id])) : '-'}</td>)}<td><b>{fmtH(r1(p.total))}</b></td></tr>)}</tbody></table></div>}
    </div>
  );
}

// 인건비 예측 (관리자만): 기록 시간 × 단가 + 남은 예상 시간 × 단가, 설계비와 비교
function CostCard() {
  const { project, tasks } = useProject();
  const [d, setD] = useState(null);
  const stamp = tasks.map(t => `${t.id}:${t.version}:${t.spent}`).join(',');
  useEffect(() => { api.get(`/projects/${project.id}/time/cost`).then(setD).catch(() => setD(null)); }, [project.id, stamp]);
  if (!d) return null;
  const won = n => `${Math.round(n).toLocaleString()}`;
  const pct = d.fee ? Math.round((d.forecast / d.fee) * 100) : null;
  const noRate = d.rows.filter(r => r.noRate && (r.hours || r.remainHours));
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{tr('인건비 예측')} <span className="small">{tr('관리자만 보입니다')}</span></h3>
      <div className="kpis">
        <div className="kpi"><span className="small">{tr('설계비')}</span><b>{d.fee != null ? won(d.fee) : '-'}</b></div>
        <div className="kpi"><span className="small">{tr('쓴 인건비')}</span><b>{won(d.spent)}</b></div>
        <div className="kpi"><span className="small">{tr('남은 예상')}</span><b>{won(d.remain)}</b></div>
        <div className={`kpi ${pct != null && pct > 100 ? 'late' : pct != null && pct >= 80 ? 'soon' : ''}`}><span className="small">{tr('예상 합계')}{pct != null ? ` · ${pct}%` : ''}</span><b>{won(d.forecast)}</b></div>
      </div>
      {d.fee == null && <p className="small">{tr('설계비는 ‘설정 → 프로젝트 정보’에서 넣습니다.')}</p>}
      {noRate.length > 0 && <p className="small" style={{ color: 'var(--soon)' }}>⚠ {tr('단가가 없는 사람: {names} (‘관리 → 계정 수정’에서 입력)', { names: noRate.map(r => r.name || tr('담당 없음')).join(', ') })}</p>}
      {d.rows.length > 0 && <table><thead><tr><th>{tr('담당자')}</th><th>{tr('기록 시간')}</th><th>{tr('쓴 인건비')}</th><th>{tr('남은 예상 시간')}</th><th>{tr('남은 예상')}</th></tr></thead>
        <tbody>{d.rows.map(r => <tr key={r.user_id}><td>{r.name || tr('담당 없음')}</td><td>{fmtH(r.hours)}</td><td>{won(r.cost)}</td><td>{fmtH(r.remainHours)}</td><td>{won(r.remainCost)}</td></tr>)}</tbody></table>}
      <p className="small">{tr('남은 예상 = 끝나지 않은 할 일의 (예상 시간 − 이미 기록한 시간) × 담당자 단가')}</p>
    </div>
  );
}

// 휴가·부재 등록: 참여자의 휴가는 업무량(근무 가능 시간)에서 빠지고, 마감일이 휴가 중이면 카드에 표시
const KINDS = ['휴가', '반차', '출장', '교육', '기타'];
function LeaveModal({ onClose }) {
  const { members, can } = useProject();
  const { user } = useApp();
  const td = today();
  const [list, setList] = useState(null);
  const [f, setF] = useState({ user_id: user.id, kind: '휴가', start: td, end: td, note: '' });
  const [err, setErr] = useState(null);
  const ids = members.map(m => m.id).join(',');
  const load = () => api.get(`/leaves?from=${addD(td, -30)}&users=${ids}`).then(setList).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const canOthers = can('pm') || user.role === 'admin';
  const add = async () => {
    try { await api.post('/leaves', { ...f, end: f.kind === '반차' ? f.start : f.end }); setErr(null); load(); } catch (e) { setErr(e.message); }
  };
  const del = async l => { try { await api.del(`/leaves/${l.id}`); load(); } catch (e) { setErr(e.message); } };
  return (
    <Modal title={tr('휴가·부재')} onClose={onClose}>
      {err && <div className="err">{err}</div>}
      <div className="form">
        <label>{tr('누구')}</label>
        <select value={f.user_id} onChange={e => setF({ ...f, user_id: Number(e.target.value) })} disabled={!canOthers}>{(canOthers ? members : members.filter(m => m.id === user.id).concat(members.some(m => m.id === user.id) ? [] : [{ id: user.id, name: user.name }])).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <label>{tr('종류')}</label>
        <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{KINDS.map(k => <option key={k} value={k}>{tr(k)}</option>)}</select>
        <label>{tr('기간')}</label>
        <div className="row"><DateInput value={f.start} onChange={e => setF({ ...f, start: e.target.value, end: f.end < e.target.value ? e.target.value : f.end })} />
          {f.kind !== '반차' && <> ~ <DateInput value={f.end} onChange={e => setF({ ...f, end: e.target.value })} /></>}</div>
        <label>{tr('메모')}</label><input type="text" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={tr('예: 연차, 현장 출장')} />
      </div>
      <div className="actions"><button className="btn primary" onClick={add}>{tr('등록')}</button></div>
      <h3>{tr('예정된 휴가·부재')}</h3>
      {!list ? <div className="small">{tr('불러오는 중…')}</div> : list.length ? <table><tbody>{list.map(l => (
        <tr key={l.id}><td className="nw">{l.user_name}</td><td className="nw">{tr(l.kind)}</td><td className="nw">{l.start === l.end ? fmtY(l.start) : `${fmtY(l.start)} ~ ${fmtY(l.end)}`}</td><td className="small">{l.note}</td>
          <td>{(l.user_id === user.id || l.created_by === user.id || user.role === 'admin') && <button className="btn sm danger" onClick={() => del(l)}>{tr('삭제')}</button>}</td></tr>))}</tbody></table>
        : <p className="small">{tr('등록된 휴가·부재가 없습니다.')}</p>}
      <p className="small">{tr('휴가 기간은 업무량의 근무 가능 시간에서 빠지고(반차는 반나절), 마감일이 휴가 중인 카드에는 칸반에 표시됩니다.')}</p>
    </Modal>
  );
}
