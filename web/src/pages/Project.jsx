import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { NavLink, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { today, stateOf, phaseColor, ROLE_NAME } from '../util.js';
import Dashboard from '../views/Dashboard.jsx';
import Gantt from '../views/Gantt.jsx';
import Calendar from '../views/Calendar.jsx';
import TaskList from '../views/TaskList.jsx';
import Issues from '../views/Issues.jsx';
import Settings from '../views/Settings.jsx';
import TaskModal from '../components/TaskModal.jsx';
import IssueModal from '../components/IssueModal.jsx';

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
  useEffect(() => { setData(null); reload(); }, [reload]);
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
  if (!data) return <div className="loading">불러오는 중…</div>;

  const role = data.role;
  const can = (need = 'member') => RANK[role] >= RANK[need];
  const color = pid => phaseColor(data.phases, pid);
  const ctx = {
    ...data, tasks, filtered, filter, setFilter, reload, role, can, color, td, toast,
    openTask: (taskId, preset) => setModal({ kind: 'task', id: taskId ?? null, preset }),
    openIssue: (issueId, preset) => setModal({ kind: 'issue', id: issueId ?? null, preset }),
    // 저장 결과로 자동 조정된 작업이 있으면 알림
    afterSave: r => { if (r?.shifted?.length) toast(`선행관계에 따라 작업 ${r.shifted.length}건의 날짜가 자동으로 조정되었습니다.`); return reload(); }
  };
  const p = data.project;
  const tabs = [['', '대시보드'], ['gantt', '간트'], ['calendar', '달력'], ['tasks', '작업 목록'], ['issues', `이슈 (${data.issues.filter(i => i.status !== '해결완료').length})`], ['settings', '설정']];

  return (
    <Ctx.Provider value={ctx}>
      <main className="page">
        <div className="toolbar" style={{ marginBottom: 6 }}>
          <h1 className="title" style={{ margin: 0 }}>{p.name}</h1>
          <span className="small">{[p.code, p.client, `내 역할: ${ROLE_NAME[role]}`, p.day_basis === 'calendar' ? '달력일 기준' : '근무일 기준'].filter(Boolean).join(' · ')}</span>
          {p.archived && <span className="badge b-보류">보관됨</span>}
          <div className="sp" />
          {can() && <button className="btn" onClick={() => ctx.openIssue(null)}>+ 이슈</button>}
          {can() && <button className="btn primary" onClick={() => ctx.openTask(null)}>+ 작업</button>}
        </div>
        <nav className="tabs">
          {tabs.map(([k, n]) => <NavLink key={k} to={`/projects/${id}${k ? '/' + k : ''}`} end className="tab">{n}</NavLink>)}
        </nav>
        <Routes>
          <Route index element={<><FilterBar /><Dashboard /></>} />
          <Route path="gantt" element={<><FilterBar /><Gantt /></>} />
          <Route path="calendar" element={<><FilterBar /><Calendar /></>} />
          <Route path="tasks" element={<><FilterBar /><TaskList /></>} />
          <Route path="issues" element={<Issues />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to={`/projects/${id}`} />} />
        </Routes>
      </main>
      {modal?.kind === 'task' && <TaskModal id={modal.id} preset={modal.preset} onClose={() => setModal(null)} />}
      {modal?.kind === 'issue' && <IssueModal id={modal.id} preset={modal.preset} onClose={() => setModal(null)} />}
    </Ctx.Provider>
  );
}

function FilterBar() {
  const { phases, filter, setFilter, color, tasks } = useProject();
  const groups = [...phases.filter(p => tasks.some(t => t.phase_id === p.id)).map(p => ({ id: p.id, name: p.name })), ...(tasks.some(t => !t.phase_id) ? [{ id: 0, name: '단계 없음' }] : [])];
  const toggle = (gid, e) => {
    if (e.ctrlKey || e.metaKey) return setFilter({ ...filter, off: groups.map(g => g.id).filter(x => x !== gid) });
    setFilter({ ...filter, off: filter.off.includes(gid) ? filter.off.filter(x => x !== gid) : [...filter.off, gid] });
  };
  return (
    <div className="toolbar">
      <input type="search" placeholder="작업명·담당·ID 검색" value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} style={{ width: 200 }} />
      <span className={`chip ${filter.hideDone ? 'on' : ''}`} onClick={() => setFilter({ ...filter, hideDone: !filter.hideDone })}>완료 숨기기</span>
      <span className="small">단계:</span>
      <span className="chip" onClick={() => setFilter({ ...filter, off: filter.off.length ? [] : groups.map(g => g.id) })} title="모두 켜기/끄기">전체</span>
      {groups.map(g => (
        <span key={g.id} className={`chip ${filter.off.includes(g.id) ? '' : 'on'}`} onClick={e => toggle(g.id, e)} title="Ctrl+클릭: 이 단계만 보기">
          <span className="dot" style={{ background: g.id ? color(g.id) : '#8a93a6' }} />{g.name}
        </span>
      ))}
    </div>
  );
}
