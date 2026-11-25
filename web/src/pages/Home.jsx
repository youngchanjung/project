import { useEffect, useState } from 'react';
import { useNavigate, useParams, Navigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Modal from '../components/Modal.jsx';
import { COUNTRIES } from '../countries.js';
import { addD, fmt, fmtW, fmtY, diff, ddayTxt, ddayLabel, ROLE_NAME, downloadXLSX, CATEGORIES, catOf, CATEGORY_PHASES } from '../util.js';
import ExportButton from '../components/ExportButton.jsx';
import CalendarSubscribe from '../components/CalendarSubscribe.jsx';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';
import DateInput from '../components/DateInput.jsx';

export default function Home() {
  return <ProjectsPage />;
}

// 카테고리 화면 (/c/research 등): 그 카테고리 프로젝트만
export function CategoryPage() {
  const { cat } = useParams();
  if (!CATEGORIES.some(c => c.key === cat)) return <Navigate to="/" />;
  return <ProjectsPage cat={cat} key={cat} />;
}

function ProjectsPage({ cat }) {
  const [projects, setProjects] = useState(null);
  const [work, setWork] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [q, setQ] = useState('');
  const [catF, setCatF] = useState('');
  const [creating, setCreating] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const nav = useNavigate();
  const { toast } = useApp();
  const load = () => { api.get('/projects').then(setProjects); api.get('/me/work').then(setWork); };
  useEffect(load, []);

  if (!projects || !work) return <div className="loading">{tr('불러오는 중…')}</div>;
  const td = work.today;
  const C = cat ? catOf(cat) : null;
  const inCat = p => !cat || (p.category || 'construction') === cat;
  const fCat = cat || catF;
  const list = projects.filter(p => (showArchived || !p.archived) && (!fCat || (p.category || 'construction') === fCat) && (!onlyMine || p.member) && (!q || `${p.name} ${p.code || ''} ${p.client || ''}`.toLowerCase().includes(q.toLowerCase())));
  const tasks = work.tasks.filter(t => !cat || t.category === cat);
  const myLate = tasks.filter(t => t.state === '지연');
  const mySoon = tasks.filter(t => t.state !== '지연' && !t.undated && diff(td, t.state === '예정' ? t.start : t.end) <= 7).sort((a, b) => a.end.localeCompare(b.end));
  const myUndated = tasks.filter(t => t.undated);
  const live = projects.filter(p => !p.archived);
  const sum = (k, ps = live) => ps.reduce((a, p) => a + p.stats[k], 0);
  const issues = work.issues.filter(i => !cat || live.some(p => p.id === i.project_id && inCat(p)));

  return (
    <main className="page">
      {C && <div className="phead" style={{ marginBottom: 14 }}>
        <span className="picon" style={{ background: C.color }}>{C.icon}</span>
        <div className="ptitle"><h1 className="title">{tr(C.name)}</h1><span className="small">{tr(C.desc)}</span></div>
      </div>}

      <div className="grid2" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3>{tr('내 할 일')} <span className="small">{tr('지연 · 7일 안')}</span>
            <Link to="/my" className="btn sm">{tr('모두 보기')}{myUndated.length ? ` (+${tr('날짜 없음')} ${myUndated.length})` : ''}</Link>
            <button className="btn sm" onClick={() => setSubscribing(true)} title={tr('내 작업·이슈를 Outlook 달력에 띄웁니다.')}>📅 {tr('Outlook 달력에 구독')}</button></h3>
          <div className="list">
            {[...myLate, ...mySoon].slice(0, 12).map(t => <MyTaskRow key={t.id} t={t} td={td} onClick={() => nav(`/projects/${t.project_id}/tasks?open=${t.id}`)} />)}
            {!myLate.length && !mySoon.length && <div className="empty">{tr('7일 안에 시작·마감하는 내 할 일이 없습니다.')}</div>}
            {(work.reviews || []).filter(t => !cat || t.category === cat).map(t => (
              <div key={'r' + t.id} className="item" onClick={() => nav(`/projects/${t.project_id}/board?open=${t.id}`)}>
                <div className="main"><div className="t"><Tx>{t.name}</Tx></div><div className="small">{catOf(t.category).icon} {t.project_name}</div></div>
                <span className="krev">👀 {tr('검토 요청')}</span></div>))}
            {(work.meetings || []).filter(t => (!cat || t.category === cat) && t.start <= addDays7(td)).slice(0, 3).map(t => (
              <div key={'m' + t.id} className="item" onClick={() => nav(`/projects/${t.project_id}/schedule?open=${t.id}`)}>
                <div className="main"><div className="t">👥 <Tx>{t.name}</Tx></div><div className="small">{catOf(t.category).icon} {t.project_name} · {fmt(t.start)} {t.start_time || ''}{t.location ? ` · ${t.location}` : ''}</div></div>
                <span className="badge b-예정">{t.start === td ? tr('오늘') : fmtW(t.start)}</span></div>))}
          </div>
        </div>
        <div className="card">
          <h3>{tr('내 이슈')} <span className="small">{tr('미해결')} {issues.length}{tr('건')}</span></h3>
          <div className="list">
            {issues.sort((a, b) => (a.target || '9').localeCompare(b.target || '9')).map(i => (
              <div key={i.id} className="item" onClick={() => nav(`/projects/${i.project_id}/issues?open=${i.id}`)}>
                <div className="main"><div className="t"><Tx>{i.title}</Tx></div><div className="small">{i.project_name} · {i.code} {tr('· 중요도')} {tr(i.priority)}</div></div>
                <span className={`badge ${i.target && i.target < td ? 'b-지연' : 'b-예정'}`}>{i.target ? `${tr('목표')} ${fmt(i.target)}` : tr('목표일 없음')}</span>
              </div>
            ))}
            {!issues.length && <div className="empty">{tr('내게 배정된 미해결 이슈가 없습니다.')}</div>}
          </div>
        </div>
      </div>

      {!cat && <div className="catcards">
        {CATEGORIES.map(c => {
          const ps = live.filter(p => (p.category || 'construction') === c.key);
          const mine = work.tasks.filter(t => t.category === c.key);
          return (
            <Link key={c.key} to={`/c/${c.key}`} className="card catcard" style={{ '--c': c.color }}>
              <div className="cc-h"><span className="cc-ico">{c.icon}</span><b>{tr(c.name)}</b><span className="small">{tr('프로젝트 {n}개', { n: ps.length })}</span></div>
              <div className="small">{tr(c.desc)}</div>
              <div className="cc-stats">
                <span><b>{sum('active', ps)}</b>{tr('진행 중')}</span>
                <span className={sum('late', ps) ? 'late' : ''}><b>{sum('late', ps)}</b>{tr('지연')}</span>
                <span><b>{sum('openIssues', ps)}</b>{tr('미해결 이슈')}</span>
                <span><b>{mine.length}</b>{tr('내 할 일')}</span>
              </div>
            </Link>);
        })}
      </div>}

      <div className="toolbar">
        <h1 className="title" style={{ margin: 0 }}>{tr('프로젝트')}</h1>
        <input type="search" placeholder={tr('이름·코드·발주처 검색')} value={q} onChange={e => setQ(e.target.value)} />
        {!cat && <>{[['', '전체'], ...CATEGORIES.map(c => [c.key, c.name])].map(([k, n]) =>
          <span key={k} className={`chip ${catF === k ? 'on' : ''}`} onClick={() => setCatF(k)}>{k ? catOf(k).icon + ' ' : ''}{tr(n)}</span>)}</>}
        <span className={`chip ${onlyMine ? 'on' : ''}`} onClick={() => setOnlyMine(!onlyMine)}>{tr('내 프로젝트만')}</span>
        <span className={`chip ${showArchived ? 'on' : ''}`} onClick={() => setShowArchived(!showArchived)}>{tr('보관된 프로젝트 포함')}</span>
        <div className="sp" />
        <ExportButton toast={toast} make={() => downloadXLSX('프로젝트 현황', [
          { name: '프로젝트', rows: list, cols: [['name', '이름'], [p => tr(catOf(p.category).name), '카테고리'], ['code', '코드'], ['client', '발주처·협력처'], [p => p.pms.join(', '), 'PM'], [p => tr(p.archived ? '보관' : p.status), '상태'], [p => tr(ROLE_NAME[p.myRole] || ''), '내 역할'],
            [p => p.stats.start || '', '시작'], [p => p.stats.end || '', '종료'], [p => p.stats.tasks, '작업'], [p => p.stats.done, '완료'], [p => p.stats.tasks ? Math.round(p.stats.done / p.stats.tasks * 100) : 0, '완료율(%)'],
            [p => p.stats.late, '지연'], [p => p.stats.active, '진행 중'], [p => p.stats.openIssues, '미해결 이슈'], [p => p.stats.lateIssues, '지연 이슈'], [p => p.stats.nextKey ? `${p.stats.nextKey.name} (${p.stats.nextKey.date})` : '', '다음 핵심 일정']] },
          { name: '내 할 일', rows: [...myLate, ...mySoon], cols: [['project_name', '프로젝트'], ['name', '작업'], ['start', '시작'], ['end', '종료'], [t => tr(t.state), '상태'], [t => t.is_key ? '★' : '', '핵심']] },
          { name: '내 이슈', rows: issues, cols: [['project_name', '프로젝트'], ['code', 'No'], ['title', '이슈'], [i => tr(i.priority), '중요도'], ['target', '목표일']] }])} />
        <button className="btn primary" onClick={() => setCreating(true)}>{tr('+ 새 프로젝트')}</button>
      </div>
      <div className="grid3">
        {list.map(p => {
          const s = p.stats, pct = s.tasks ? Math.round(s.done / s.tasks * 100) : 0, pc = catOf(p.category);
          return (
            <div key={p.id} className="card pcard" onClick={() => nav(`/projects/${p.id}`)} style={p.archived ? { opacity: .6 } : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div><span className="catbadge" style={{ '--c': pc.color }}>{pc.icon} {tr(pc.name)}</span><b style={{ fontSize: 22.5 }}>{p.name}</b><div className="small">{[p.code, p.client, p.pms.length ? `PM ${p.pms.join(', ')}` : null].filter(Boolean).join(' · ')}</div></div>
                <div style={{ textAlign: 'right' }}><span className={`badge ${p.status === '진행중' ? 'b-진행중' : p.status === '완료' ? 'b-완료' : p.status === '보류' ? 'b-보류' : 'b-예정'}`}>{tr(p.archived ? '보관' : p.status)}</span><div className="small">{tr(ROLE_NAME[p.myRole])}</div></div>
              </div>
              <div className="small">{s.start ? `${fmtY(s.start)} ~ ${fmtY(s.end)}` : tr('날짜 있는 작업 없음')}</div>
              <div className="bar-bg"><i style={{ width: pct + '%' }} /></div>
              <div className="small">{tr('완료')} {s.done}/{s.tasks} ({pct}%) · <span style={{ color: s.late ? 'var(--late)' : undefined }}>{tr('지연')} {s.late}</span> {tr('· 진행')} {s.active} {tr('· 이슈')} {s.openIssues}{s.lateIssues ? <span style={{ color: 'var(--late)' }}> {tr('(지연')} {s.lateIssues})</span> : null}</div>
              {s.nextKey && <div className="small">{tr('다음 핵심 일정: ★')} {s.nextKey.name} ({fmt(s.nextKey.date)})</div>}
            </div>
          );
        })}
        {!list.length && <div className="empty">{tr('프로젝트가 없습니다. 오른쪽 위 ‘새 프로젝트’로 만들어 보세요.')}</div>}
      </div>
      {subscribing && <CalendarSubscribe onClose={() => setSubscribing(false)} toast={toast} />}
      {creating && <NewProject category={cat || catF} onClose={() => setCreating(false)} onDone={p => nav(`/projects/${p.id}`)} />}
    </main>
  );
}

const addDays7 = d => addD(d, 7);

// 내 할 일 한 줄 (홈·내 할 일 화면 공통)
export function MyTaskRow({ t, td, onClick, onDone }) {
  const c = catOf(t.category);
  // 마감 지난 일은 빨간 줄, 3일 안 마감은 주황 띠, 7일 넘게 남은 일은 회색 배지
  const left = t.undated || t.state === '완료' ? null : diff(td, t.state === '예정' && t.start !== t.end ? t.start : t.end);
  const tone = t.state === '지연' ? 'late' : left !== null && left <= 3 ? 'soon' : '';
  return (
    <div className={`item ${tone ? 'is-' + tone : ''}`} onClick={onClick}>
      {onDone && <input type="checkbox" title={tr('완료 처리')} onClick={e => e.stopPropagation()} onChange={() => onDone(t)} style={{ marginTop: 5 }} />}
      <div className="main"><div className="t">{t.is_key ? '★ ' : ''}<Tx>{t.name}</Tx></div>
        <div className="small"><span title={tr(c.name)}>{c.icon}</span> {t.project_name}{t.undated ? '' : ` · ${t.start !== t.end ? `${fmt(t.start)}~` : ''}${t.start !== t.end ? fmt(t.end) : fmtW(t.end)}`}</div></div>
      {t.undated ? <span className={`badge b-${t.state}`}>{tr(t.state)}</span>
        : <span className={`badge b-${t.state === '지연' ? '지연' : left !== null && left <= 7 ? '임박' : '예정'}`}>{ddayLabel(t, td)}</span>}
    </div>
  );
}

function NewProject({ category, onClose, onDone }) {
  const { toast } = useApp();
  const [f, setF] = useState({ category: category || '', name: '', code: '', client: '', description: '', calendars: 'KR', day_basis: 'workday', phases: '', agreement_start: '', agreement_end: '', partners: '', template: true });
  const [more, setMore] = useState(false);
  const pickCat = k => setF({ ...f, category: k, phases: tr(CATEGORY_PHASES[k] || '') });
  useEffect(() => { if (category) pickCat(category); }, []); // eslint-disable-line
  const [err, setErr] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.category) return setErr(tr('카테고리를 고르세요.'));
    try {
      const p = await api.post('/projects', { ...f, agreement_start: f.agreement_start || null, agreement_end: f.agreement_end || null, phases: f.phases.split(',').map(s => s.trim()).filter(Boolean) });
      toast(tr('프로젝트를 만들었습니다. 참여자는 ‘설정’에서 추가하세요.'));
      onDone(p);
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={tr('새 프로젝트')} onClose={onClose}>
      {err && <div className="err">{err}</div>}
      <div className="catpick">
        {CATEGORIES.map(c => (
          <button type="button" key={c.key} className={`catopt ${f.category === c.key ? 'on' : ''}`} style={{ '--c': c.color }} onClick={() => pickCat(c.key)}>
            <span className="cc-ico">{c.icon}</span><b>{tr(c.name)}</b><span className="small">{tr(c.desc)}</span>
          </button>))}
      </div>
      <div className="form">
        <label>{tr(f.category === 'research' ? '과제명 *' : '이름 *')}</label><input type="text" value={f.name} onChange={set('name')} autoFocus />
        {f.category === 'research' && <>
          <label>{tr('협약 기간')}</label><div className="row"><DateInput value={f.agreement_start} onChange={set('agreement_start')} /> ~ <DateInput value={f.agreement_end} onChange={set('agreement_end')} /></div>
          <label>{tr('협력 기관')}</label><input type="text" value={f.partners} onChange={set('partners')} placeholder={tr('쉼표로 구분')} />
          <label />
          <label className="small"><input type="checkbox" checked={f.template} onChange={e => setF({ ...f, template: e.target.checked })} /> {tr('예시 일정 넣기 (착수 회의, 중간·최종 보고, 결과 평가 — 협약 기간에 맞춰 날짜 자동)')}</label>
        </>}
        <div className="full"><button type="button" className="linkbtn" onClick={() => setMore(!more)}>{more ? '▾' : '▸'} {tr(more ? '자세히 접기' : '자세히 (코드·발주처·단계·휴일 달력)')}</button></div>
        {more && <>
        <label>{tr('코드')}</label><input type="text" value={f.code} onChange={set('code')} placeholder={tr('예: CML-2026')} />
        <label>{tr('발주처·협력처')}</label><input type="text" value={f.client} onChange={set('client')} />
        <label>{tr('설명')}</label><textarea value={f.description} onChange={set('description')} />
        <label>{tr('단계 (쉼표 구분)')}</label><input type="text" value={f.phases} onChange={set('phases')} />
        <label>{tr('휴일 달력')}</label>
        <div className="row">{COUNTRIES.map(({ code: c, name }) => (
          <label key={c} className="small"><input type="checkbox" checked={f.calendars.split(',').includes(c)} onChange={e => {
            const cs = new Set(f.calendars.split(',').filter(Boolean)); e.target.checked ? cs.add(c) : cs.delete(c); setF({ ...f, calendars: [...cs].join(',') });
          }} /> {tr(name)}</label>))}</div>
        <label>{tr('일정 계산 기준')}</label>
        <select value={f.day_basis} onChange={set('day_basis')}><option value="workday">{tr('근무일 (주말·공휴일 제외)')}</option><option value="calendar">{tr('달력일 (모든 날 포함)')}</option></select>
        </>}
      </div>
      <p className="small">{tr('만든 사람이 PM이 됩니다. 칸반 열(할 일·진행 중·검토·완료)은 자동으로 만들어집니다. 기존 엑셀은 만든 뒤 ‘설정 → 엑셀 불러오기’에서 가져올 수 있습니다.')}</p>
      <div className="actions"><button className="btn" onClick={onClose}>{tr('취소')}</button><button className="btn primary" onClick={save}>{tr('만들기')}</button></div>
    </Modal>
  );
}
