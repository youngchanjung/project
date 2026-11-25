// 내 할 일: 세 카테고리(연구·시공·설계)의 내 작업·할 일을 한 목록으로
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { diff, addD, weekday, CATEGORIES, catOf } from '../util.js';
import { MyTaskRow } from './Home.jsx';
import { tr } from '../i18n.js';

export default function MyTasks() {
  const [work, setWork] = useState(null);
  const [cat, setCat] = useState('');
  const nav = useNavigate();
  const { toast } = useApp();
  const load = () => api.get('/me/work').then(setWork).catch(e => toast(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line
  if (!work) return <div className="loading">{tr('불러오는 중…')}</div>;

  const td = work.today;
  const sunday = addD(td, 6 - ((weekday(td) + 6) % 7));
  const ts = work.tasks.filter(t => !cat || t.category === cat);
  const due = t => (t.state === '예정' ? t.start : t.end);
  const groups = [
    ['late', '지연', ts.filter(t => t.state === '지연')],
    ['today', '오늘', ts.filter(t => !t.undated && t.state !== '지연' && due(t) <= td)],
    ['week', '이번 주', ts.filter(t => !t.undated && t.state !== '지연' && due(t) > td && due(t) <= sunday)],
    ['later', '나중', ts.filter(t => !t.undated && t.state !== '지연' && due(t) > sunday)],
    ['none', '날짜 없음', ts.filter(t => t.undated)]
  ].map(([k, n, l]) => [k, n, [...l].sort((a, b) => due(a).localeCompare(due(b)))]);

  const done = async t => {
    try {
      await api.patch(`/projects/${t.project_id}/tasks/${t.id}`, { status: '완료', version: t.version });
      toast(tr("'{name}' 완료", { name: t.name })); load();
    } catch (e) { toast(e.message); load(); }
  };
  return (
    <main className="page">
      <h1 className="title">{tr('내 할 일')}</h1>
      <div className="toolbar">
        {[['', '전체'], ...CATEGORIES.map(c => [c.key, c.name])].map(([k, n]) => (
          <span key={k} className={`chip ${cat === k ? 'on' : ''}`} onClick={() => setCat(k)}>
            {k ? catOf(k).icon + ' ' : ''}{tr(n)} <span className="small">{(k ? work.tasks.filter(t => t.category === k) : work.tasks).length}</span></span>))}
        <div className="sp" />
        <span className="small">{tr('담당자로 지정되었거나 담당 칸에 내 이름이 있는 작업 · 체크하면 완료')}</span>
      </div>
      <div className="grid2">
        {groups.filter(([, , l]) => l.length).map(([k, n, l]) => (
          <div key={k} className="card">
            <h3 style={{ color: k === 'late' ? 'var(--late)' : undefined }}>{tr(n)} <span className="small">{l.length}{tr('건')}</span></h3>
            <div className="list">
              {l.map(t => <MyTaskRow key={t.id} t={t} td={td} onDone={done}
                onClick={() => nav(`/projects/${t.project_id}/${catOf(t.category).key === 'construction' ? 'tasks' : 'board'}?open=${t.id}`)} />)}
            </div>
          </div>))}
        {!ts.length && <div className="card"><div className="empty">{tr('남은 할 일이 없습니다. 🎉')}</div></div>}
      </div>
    </main>
  );
}
