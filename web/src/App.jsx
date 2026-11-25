import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import Bell from './components/Bell.jsx';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { PALETTE, CATEGORIES } from './util.js';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Home, { CategoryPage } from './pages/Home.jsx';
import MyTasks from './pages/MyTasks.jsx';
import Project from './pages/Project.jsx';
import Admin from './pages/Admin.jsx';
import Modal from './components/Modal.jsx';
import { tr, LANGS, getLang, setLang } from './i18n.js';
import { initContentTr, setContentTr, useContentTrState } from './contentTr.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  const [user, setUser] = useState(undefined);
  const [toastMsg, setToastMsg] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);
  // 왼쪽 메뉴 펼침 (좁은 화면에서는 처음에 접어 둠)
  const [side, setSide] = useState(() => { try { const v = localStorage.getItem('side-open'); if (v) return v === '1'; } catch {} return window.innerWidth > 1000; });
  const [lang, setLangState] = useState(getLang());
  // 화면 언어 바꾸기: 이 브라우저에 기억하고, 로그인한 경우 계정에도 저장
  const changeLang = useCallback(l => {
    setLang(l); setLangState(l);
    api.post('/auth/lang', { lang: l }).catch(() => {});
  }, []);
  const nav = useNavigate();

  const toast = useCallback(msg => { setToastMsg(msg); clearTimeout(window.__t); window.__t = setTimeout(() => setToastMsg(null), 3500); }, []);
  useEffect(() => {
    api.get('/auth/me').then(r => setUser(r.user)).catch(() => setUser(null));
    const h = () => setUser(null);
    window.addEventListener('auth-expired', h);
    return () => window.removeEventListener('auth-expired', h);
  }, []);

  // 로그인 직후: 계정에 저장된 언어를 쓰고, 없으면 지금 고른 언어를 계정에 저장
  useEffect(() => {
    if (!user) return;
    initContentTr();
    if (user.lang && user.lang !== getLang()) { setLang(user.lang); setLangState(user.lang); }
    else if (!user.lang) api.post('/auth/lang', { lang: getLang() }).catch(() => {});
  }, [user?.id]); // eslint-disable-line

  if (user === undefined) return <div className="loading">{tr('불러오는 중…')}</div>;
  if (!user) return <Ctx.Provider value={{ user, setUser, toast, lang }}><div style={{ display: 'flex', justifyContent: 'flex-end', padding: 12 }}><LangSelect lang={lang} onChange={changeLang} /></div><Login /></Ctx.Provider>;

  const logout = async () => { await api.post('/auth/logout'); setUser(null); nav('/'); };
  const toggleSide = () => setSide(v => { const n = !v; try { localStorage.setItem('side-open', n ? '1' : '0'); } catch {} return n; });
  return (
    <Ctx.Provider value={{ user, setUser, toast, lang }}>
      <div className={`shell ${side ? '' : 'side-off'}`}>
        <aside className="side">
          <div className="side-head">
            <NavLink to="/" className="brand">{tr('📅 R&D 일정관리')}</NavLink>
            <button className="iconbtn" onClick={toggleSide} title={tr('메뉴 접기')}>«</button>
          </div>
          <nav className="side-nav">
            <NavLink to="/" end className="snav"><span className="ico">🏠</span>{tr('홈')}</NavLink>
            <NavLink to="/my" className="snav"><span className="ico">✅</span>{tr('내 할 일')}</NavLink>
            {user.role === 'admin' && <NavLink to="/admin" className="snav"><span className="ico">⚙️</span>{tr('관리')}</NavLink>}
          </nav>
          <SideProjects />
        </aside>
        {side && <div className="side-dim" onClick={toggleSide} />}
        <div className="maincol">
          <header className="topbar">
            {!side && <button className="iconbtn" onClick={toggleSide} title={tr('메뉴 펼치기')}>☰</button>}
            {!side && <NavLink to="/" className="brand">{tr('📅 R&D 일정관리')}</NavLink>}
            <div className="sp" />
            <LangSelect lang={lang} onChange={changeLang} />
            <ContentTrToggle />
            <Bell />
            <span className="me"><span className="avatar">{(user.name || '?').slice(0, 1)}</span>{user.name}{user.role === 'admin' ? ` (${tr('관리자')})` : ''}</span>
            <button className="btn sm" onClick={() => setPwOpen(true)}>{tr('비밀번호 변경')}</button>
            <button className="btn sm" onClick={logout}>{tr('로그아웃')}</button>
          </header>
          <Routes key={lang}>
            <Route path="/" element={<Home />} />
            <Route path="/my" element={<MyTasks />} />
            <Route path="/c/:cat" element={<CategoryPage />} />
            <Route path="/projects/:id/*" element={<Project />} />
            <Route path="/admin" element={user.role === 'admin' ? <Admin /> : <Navigate to="/" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
      </div>
      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

// 최근 본 프로젝트 기록 (프로젝트 화면을 열 때 호출)
export function rememberProject(id) {
  try {
    const l = JSON.parse(localStorage.getItem('recent-projects') || '[]').filter(x => x !== id);
    localStorage.setItem('recent-projects', JSON.stringify([id, ...l].slice(0, 5)));
    window.dispatchEvent(new Event('recent-projects'));
  } catch {}
}

// 왼쪽 메뉴의 프로젝트 목록: 최근 본 프로젝트, 내 프로젝트, 그 밖의 프로젝트
function SideProjects() {
  const [ps, setPs] = useState([]);
  const [recent, setRecent] = useState([]);
  const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('side-sec') || '{}'); } catch { return {}; } });
  const loc = useLocation();
  useEffect(() => { api.get('/projects').then(setPs).catch(() => {}); }, [loc.pathname === '/']); // eslint-disable-line
  useEffect(() => {
    const h = () => { try { setRecent(JSON.parse(localStorage.getItem('recent-projects') || '[]')); } catch {} };
    h(); window.addEventListener('recent-projects', h);
    return () => window.removeEventListener('recent-projects', h);
  }, []);
  const live = ps.filter(p => !p.archived);
  const byId = new Map(live.map(p => [p.id, p]));
  const secs = [
    ['recent', tr('최근 본 프로젝트'), recent.map(id => byId.get(id)).filter(Boolean)],
    ['mine', tr('내 프로젝트'), live.filter(p => p.member)],
    ['others', tr('그 밖의 프로젝트'), live.filter(p => !p.member)]
  ];
  const flip = k => setOpen(o => { const n = { ...o, [k]: o[k] === false }; try { localStorage.setItem('side-sec', JSON.stringify(n)); } catch {} return n; });
  return (
    <div className="side-secs">
      <div className="side-sec">
        <div className="side-sec-h" style={{ cursor: 'default' }}>{tr('카테고리')}</div>
        {CATEGORIES.map(c => {
          const n = live.filter(p => (p.category || 'construction') === c.key).length;
          return <NavLink key={c.key} to={`/c/${c.key}`} className="sproj"><span className="ico" style={{ width: 20, textAlign: 'center' }}>{c.icon}</span><span className="t">{tr(c.name)}</span><span className="small">{n}</span></NavLink>;
        })}
      </div>
      {secs.filter(([, , l]) => l.length).map(([k, name, list]) => (
        <div key={k} className="side-sec">
          <div className="side-sec-h" onClick={() => flip(k)}>{name}<span className="small">{open[k] === false ? '▸' : '▾'}</span></div>
          {open[k] !== false && list.map(p => (
            <NavLink key={p.id} to={`/projects/${p.id}`} className="sproj" title={`${tr(CATEGORIES.find(c => c.key === (p.category || 'construction')).name)} · ${p.name}`}>
              <span className="sq" style={{ background: CATEGORIES.find(c => c.key === (p.category || 'construction')).color }} /><span className="t">{p.name}</span>
              {p.stats?.late > 0 && <span className="cnt" title={tr('기한 초과 작업')}>{p.stats.late}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </div>
  );
}

function PasswordModal({ onClose }) {
  const { toast } = useApp();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [err, setErr] = useState(null);
  const save = async () => {
    if (f.next !== f.again) return setErr(tr('새 비밀번호가 서로 다릅니다.'));
    try { await api.post('/auth/password', f); toast(tr('비밀번호를 바꿨습니다.')); onClose(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={tr('비밀번호 변경')} onClose={onClose}>
      {err && <div className="err">{err}</div>}
      <div className="form">
        <label>{tr('현재 비밀번호')}</label><input type="password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} />
        <label>{tr('새 비밀번호')}</label><input type="password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} placeholder={tr('8자 이상')} />
        <label>{tr('새 비밀번호 확인')}</label><input type="password" value={f.again} onChange={e => setF({ ...f, again: e.target.value })} />
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>{tr('취소')}</button><button className="btn primary" onClick={save}>{tr('저장')}</button></div>
    </Modal>
  );
}

export function LangSelect({ lang, onChange }) {
  return (
    <select value={lang} onChange={e => onChange(e.target.value)} aria-label="Language" title="언어 / Ngôn ngữ / Language">
      {LANGS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
    </select>
  );
}

// "내용 번역": 작업명·이슈 등 직원이 입력한 내용을 화면 언어로 번역해 보여줌 (서버에 DeepL 키가 있을 때만 표시)
function ContentTrToggle() {
  const { available, on } = useContentTrState();
  if (!available) return null;
  return <span className={`chip ${on ? 'on' : ''}`} onClick={() => setContentTr(!on)} title={tr('직원이 입력한 작업명·이슈·비고를 화면 언어로 번역해 보여줍니다. 마우스를 올리면 원문이 보입니다.')}>🌐 {tr('내용 번역')}</span>;
}
