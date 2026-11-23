import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Modal from '../components/Modal.jsx';
import { COUNTRIES } from '../countries.js';
import { fmt, fmtY, diff, ddayTxt, ROLE_NAME } from '../util.js';

export default function Home() {
  const [projects, setProjects] = useState(null);
  const [work, setWork] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const load = () => { api.get('/projects').then(setProjects); api.get('/me/work').then(setWork); };
  useEffect(load, []);

  if (!projects || !work) return <div className="loading">불러오는 중…</div>;
  const td = work.today;
  const list = projects.filter(p => (showArchived || !p.archived) && (!onlyMine || p.member) && (!q || `${p.name} ${p.code || ''} ${p.client || ''}`.toLowerCase().includes(q.toLowerCase())));
  const myLate = work.tasks.filter(t => t.state === '지연');
  const mySoon = work.tasks.filter(t => t.state !== '지연' && diff(td, t.state === '예정' ? t.start : t.end) <= 7).sort((a, b) => a.end.localeCompare(b.end));
  const sum = k => projects.filter(p => !p.archived).reduce((a, p) => a + p.stats[k], 0);

  return (
    <main className="page">
      <div className="kpis">
        <div className="kpi">진행 중 프로젝트<b>{projects.filter(p => !p.archived && p.status === '진행중').length}</b></div>
        <div className="kpi late">기한 초과 작업 (전체)<b>{sum('late')}</b></div>
        <div className="kpi prog">진행 중 작업 (전체)<b>{sum('active')}</b></div>
        <div className="kpi soon">미해결 이슈 (전체)<b>{sum('openIssues')}</b><span className="small">지연 {sum('lateIssues')}건</span></div>
      </div>

      <div className="grid2" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3>내 작업 <span className="small">담당자로 지정되었거나 담당 칸에 내 이름이 있는 작업</span></h3>
          <div className="list">
            {[...myLate, ...mySoon].map(t => (
              <div key={t.id} className="item" onClick={() => nav(`/projects/${t.project_id}/tasks?open=${t.id}`)}>
                <div className="main"><div className="t">{t.is_key ? '★ ' : ''}{t.name}</div><div className="small">{t.project_name} · {fmt(t.start)}~{fmt(t.end)}</div></div>
                <span className={`badge b-${t.state === '지연' ? '지연' : '임박'}`}>{t.state === '예정' ? `시작 ${ddayTxt(diff(td, t.start))}` : `마감 ${ddayTxt(diff(td, t.end))}`}</span>
              </div>
            ))}
            {!myLate.length && !mySoon.length && <div className="empty">7일 안에 시작·마감하는 내 작업이 없습니다.</div>}
          </div>
        </div>
        <div className="card">
          <h3>내 이슈 <span className="small">미해결 {work.issues.length}건</span></h3>
          <div className="list">
            {work.issues.sort((a, b) => (a.target || '9').localeCompare(b.target || '9')).map(i => (
              <div key={i.id} className="item" onClick={() => nav(`/projects/${i.project_id}/issues?open=${i.id}`)}>
                <div className="main"><div className="t">{i.title}</div><div className="small">{i.project_name} · {i.code} · 중요도 {i.priority}</div></div>
                <span className={`badge ${i.target && i.target < td ? 'b-지연' : 'b-예정'}`}>{i.target ? `목표 ${fmt(i.target)}` : '목표일 없음'}</span>
              </div>
            ))}
            {!work.issues.length && <div className="empty">내게 배정된 미해결 이슈가 없습니다.</div>}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <h1 className="title" style={{ margin: 0 }}>프로젝트</h1>
        <input type="search" placeholder="이름·코드·발주처 검색" value={q} onChange={e => setQ(e.target.value)} />
        <span className={`chip ${onlyMine ? 'on' : ''}`} onClick={() => setOnlyMine(!onlyMine)}>내 프로젝트만</span>
        <span className={`chip ${showArchived ? 'on' : ''}`} onClick={() => setShowArchived(!showArchived)}>보관된 프로젝트 포함</span>
        <div className="sp" />
        <button className="btn primary" onClick={() => setCreating(true)}>+ 새 프로젝트</button>
      </div>
      <div className="grid3">
        {list.map(p => {
          const s = p.stats, pct = s.tasks ? Math.round(s.done / s.tasks * 100) : 0;
          return (
            <div key={p.id} className="card pcard" onClick={() => nav(`/projects/${p.id}`)} style={p.archived ? { opacity: .6 } : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div><b style={{ fontSize: 15 }}>{p.name}</b><div className="small">{[p.code, p.client, p.pms.length ? `PM ${p.pms.join(', ')}` : null].filter(Boolean).join(' · ')}</div></div>
                <div style={{ textAlign: 'right' }}><span className={`badge ${p.status === '진행중' ? 'b-진행중' : p.status === '완료' ? 'b-완료' : p.status === '보류' ? 'b-보류' : 'b-예정'}`}>{p.archived ? '보관' : p.status}</span><div className="small">{ROLE_NAME[p.myRole]}</div></div>
              </div>
              <div className="small">{s.start ? `${fmtY(s.start)} ~ ${fmtY(s.end)}` : '작업 없음'}</div>
              <div className="bar-bg"><i style={{ width: pct + '%' }} /></div>
              <div className="small">완료 {s.done}/{s.tasks} ({pct}%) · <span style={{ color: s.late ? 'var(--late)' : undefined }}>지연 {s.late}</span> · 진행 {s.active} · 이슈 {s.openIssues}{s.lateIssues ? <span style={{ color: 'var(--late)' }}> (지연 {s.lateIssues})</span> : null}</div>
              {s.nextKey && <div className="small">다음 핵심 일정: ★ {s.nextKey.name} ({fmt(s.nextKey.date)})</div>}
            </div>
          );
        })}
        {!list.length && <div className="empty">프로젝트가 없습니다. 오른쪽 위 ‘새 프로젝트’로 만들어 보세요.</div>}
      </div>
      {creating && <NewProject onClose={() => setCreating(false)} onDone={p => nav(`/projects/${p.id}/settings`)} />}
    </main>
  );
}

function NewProject({ onClose, onDone }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: '', code: '', client: '', description: '', calendars: 'KR', day_basis: 'workday', phases: '기획, 설계, 시작품 제작, 시험·평가, 보고' });
  const [err, setErr] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      const p = await api.post('/projects', { ...f, phases: f.phases.split(',').map(s => s.trim()).filter(Boolean) });
      toast('프로젝트를 만들었습니다. 참여자를 추가하거나 엑셀을 불러오세요.');
      onDone(p);
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title="새 프로젝트" onClose={onClose}>
      {err && <div className="err">{err}</div>}
      <div className="form">
        <label>이름 *</label><input type="text" value={f.name} onChange={set('name')} autoFocus />
        <label>코드</label><input type="text" value={f.code} onChange={set('code')} placeholder="예: CML-2026" />
        <label>발주처·협력처</label><input type="text" value={f.client} onChange={set('client')} />
        <label>설명</label><textarea value={f.description} onChange={set('description')} />
        <label>단계 (쉼표 구분)</label><input type="text" value={f.phases} onChange={set('phases')} />
        <label>휴일 달력</label>
        <div className="row">{COUNTRIES.map(({ code: c, name }) => (
          <label key={c} className="small"><input type="checkbox" checked={f.calendars.split(',').includes(c)} onChange={e => {
            const cs = new Set(f.calendars.split(',').filter(Boolean)); e.target.checked ? cs.add(c) : cs.delete(c); setF({ ...f, calendars: [...cs].join(',') });
          }} /> {name}</label>))}</div>
        <label>일정 계산 기준</label>
        <select value={f.day_basis} onChange={set('day_basis')}><option value="workday">근무일 (주말·공휴일 제외)</option><option value="calendar">달력일 (모든 날 포함)</option></select>
      </div>
      <p className="small">만든 사람이 PM이 됩니다. 기존 엑셀은 만든 뒤 ‘설정 → 엑셀 불러오기’에서 가져올 수 있습니다.</p>
      <div className="actions"><button className="btn" onClick={onClose}>취소</button><button className="btn primary" onClick={save}>만들기</button></div>
    </Modal>
  );
}
