import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { NavLink, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, rememberProject } from '../App.jsx';
import Dropdown from '../components/Dropdown.jsx';
import { today, stateOf, phaseColor, ROLE_NAME, PALETTE, catOf } from '../util.js';
import Board from '../views/Board.jsx';
import Dashboard from '../views/Dashboard.jsx';
import Gantt from '../views/Gantt.jsx';
import Calendar from '../views/Calendar.jsx';
import TaskList from '../views/TaskList.jsx';
import Issues from '../views/Issues.jsx';
import Settings from '../views/Settings.jsx';
import Meetings from '../views/Meetings.jsx';
import TaskModal from '../components/TaskModal.jsx';
import IssueModal from '../components/IssueModal.jsx';
import { tr } from '../i18n.js';

const Ctx = createContext(null);
export const useProject = () => useContext(Ctx);

const RANK = { viewer: 0, member: 1, pm: 2 };

export default function Project() {
  const { id } = useParams();
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null); // {kind:'task'|'issue', id|null, preset}
  const [filter, setFilter] = useState({ off: [], q: '', hideDone: false });
  const [sp, setSp] = useSearchParams();
  const td = today();

  const reload = useCallback(() => api.get(`/projects/${id}/data`).then(setData).catch(e => setErr(e.message)), [id]);
  useEffect(() => { setData(null); reload(); rememberProject(Number(id)); }, [reload]); // eslint-disable-line
  // ?open=ID 로 들어오면 해당 작업/이슈 열기 (홈 화면 링크)
  useEffect(() => {
    const open = sp.get('open');
    if (open && data) {
      setModal({ kind: location.pathname.endsWith('/issues') ? 'issue' : 'task', id: Number(open) });
      sp.delete('open'); setSp(sp, { replace: true });
    }
  }, [data, sp, setSp]);

  const tasks = useMemo(() => (data?.tasks || []).map(t => ({ ...t, st: stateOf(t, td) })), [data, td]);
  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return tasks.filter(t => !filter.off.includes(t.phase_id ?? 0))
      .filter(t => !filter.hideDone || t.st !== '완료')
      .filter(t => !q || [t.code, t.name, t.name_en, t.owner, t.note, t.type].join(' ').toLowerCase().includes(q));
  }, [tasks, filter]);

  if (err) return <main className="page"><div className="err">{err}</div></main>;
  if (!data) return <div className="loading">{tr('불러오는 중…')}</div>;

  const role = data.role;
  const can = (need = 'member') => RANK[role] >= RANK[need];
  const color = pid => phaseColor(data.phases, pid);
  const ctx = {
    ...data, tasks, filtered, filter, setFilter, reload, role, can, color, td, toast,
    openTask: (taskId, preset) => setModal({ kind: 'task', id: taskId ?? null, preset }),
    openIssue: (issueId, preset) => setModal({ kind: 'issue', id: issueId ?? null, preset }),
    // 저장 결과로 자동 조정된 작업이 있으면 알림
    afterSave: r => { if (r?.shifted?.length) toast(tr('선행관계에 따라 작업 {n}건의 날짜가 자동으로 조정되었습니다.', { n: r.shifted.length })); return reload(); }
  };
  const p = data.project;
  const cat = catOf(p.category);
  const isCons = cat.key === 'construction';
  const NAMES = {
    dashboard: tr('대시보드'), gantt: tr('간트'), calendar: tr(cat.key === 'research' ? '일정' : '달력'), tasks: tr(isCons ? '작업 목록' : '할 일 목록'),
    board: tr('칸반'), issues: `${tr('이슈')} (${data.issues.filter(i => i.status !== '해결완료').length})`, meetings: tr('회의록'), settings: tr('설정')
  };
  const tabs = cat.tabs.map(k => [k, NAMES[k]]);

  return (
    <Ctx.Provider value={ctx}>
      <main className="page">
        <div className="phead">
          <span className="picon" style={{ background: cat.color }}>{(p.name || '?').slice(0, 1)}</span>
          <div className="ptitle">
            <h1 className="title"><span className="catbadge" style={{ '--c': cat.color }} title={tr(cat.desc)}>{cat.icon} {tr(cat.name)}</span>{p.name}{p.archived && <span className="badge b-보류" style={{ marginLeft: 8, verticalAlign: 3 }}>{tr('보관됨')}</span>}</h1>
            <span className="small">{[p.code, p.client, `${tr('내 역할')}: ${tr(ROLE_NAME[role])}`, tr(p.day_basis === 'calendar' ? '달력일 기준' : '근무일 기준')].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="sp" />
          {can() && <button className="btn" onClick={() => ctx.openIssue(null)}>{tr('+ 이슈')}</button>}
          {can() && <button className="btn primary" onClick={() => ctx.openTask(null)}>{tr(isCons ? '+ 작업' : '+ 할 일')}</button>}
        </div>
        <nav className="tabs">
          {tabs.map(([k, n]) => <NavLink key={k} to={`/projects/${id}/${k}`} end={k !== 'meetings'} className="tab">{n}</NavLink>)}
        </nav>
        <Routes>
          <Route index element={<Navigate to={`/projects/${id}/${cat.view}${location.search}`} replace />} />
          <Route path="dashboard" element={<><FilterBar /><Dashboard /></>} />
          <Route path="board" element={<Board />} />
          <Route path="gantt" element={<Gantt />} />
          <Route path="calendar" element={<><FilterBar /><Calendar /></>} />
          <Route path="tasks" element={<><FilterBar /><TaskList /></>} />
          <Route path="issues" element={<Issues />} />
          <Route path="meetings/*" element={<Meetings />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to={`/projects/${id}/${cat.view}`} />} />
        </Routes>
      </main>
      {modal?.kind === 'task' && <TaskModal id={modal.id} preset={modal.preset} onClose={() => setModal(null)} />}
      {modal?.kind === 'issue' && <IssueModal id={modal.id} preset={modal.preset} onClose={() => setModal(null)} />}
    </Ctx.Provider>
  );
}

// 검색·단계·완료 숨기기 (대시보드·간트·달력·작업 목록 공통). children: 화면별 도구 (오른쪽에 붙음)
export function FilterBar({ children, right }) {
  const { phases, filter, setFilter, color, tasks } = useProject();
  const groups = [...phases.filter(p => tasks.some(t => t.phase_id === p.id)).map(p => ({ id: p.id, name: p.name })), ...(tasks.some(t => !t.phase_id) ? [{ id: 0, name: tr('단계 없음') }] : [])];
  const set = (gid, on) => setFilter({ ...filter, off: on ? filter.off.filter(x => x !== gid) : [...filter.off, gid] });
  const shown = groups.filter(g => !filter.off.includes(g.id)).length;
  return (
    <div className="toolbar">
      <input type="search" className="tsearch" placeholder={tr('작업명·담당·ID 검색')} value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} />
      <Dropdown label={shown === groups.length ? tr('단계: 전체') : tr('단계: {n}개', { n: shown })} active={shown !== groups.length} title={tr('보여 줄 단계를 고릅니다.')}>
        <div className="dd-tools">
          <button className="btn sm" onClick={() => setFilter({ ...filter, off: [] })}>{tr('모두 보기')}</button>
          <button className="btn sm" onClick={() => setFilter({ ...filter, off: groups.map(g => g.id) })}>{tr('모두 끄기')}</button>
        </div>
        {groups.map(g => (
          <label key={g.id} className="dd-row">
            <input type="checkbox" checked={!filter.off.includes(g.id)} onChange={e => set(g.id, e.target.checked)} />
            <span className="dot" style={{ background: g.id ? color(g.id) : '#8a93a6' }} /><span className="t">{g.name}</span>
            <button className="btn sm only" onClick={e => { e.preventDefault(); setFilter({ ...filter, off: groups.map(x => x.id).filter(x => x !== g.id) }); }}>{tr('이것만')}</button>
          </label>
        ))}
      </Dropdown>
      <button type="button" className={`tbtn ${filter.hideDone ? 'on' : ''}`} onClick={() => setFilter({ ...filter, hideDone: !filter.hideDone })}>{filter.hideDone ? '✓ ' : ''}{tr('완료 숨기기')}</button>
      {children}
      <div className="sp" />
      {right}
    </div>
  );
}
