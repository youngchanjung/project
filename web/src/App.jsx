import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import Bell from './components/Bell.jsx';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
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
  return (
    <Ctx.Provider value={{ user, setUser, toast, lang }}>
      <header className="topbar">
        <NavLink to="/" className="brand">{tr('📅 R&D 일정관리')}</NavLink>
        <nav>
          <NavLink to="/" end className="navlink">{tr('홈')}</NavLink>
          {user.role === 'admin' && <NavLink to="/admin" className="navlink">{tr('관리')}</NavLink>}
        </nav>
        <div className="sp" />
        <LangSelect lang={lang} onChange={changeLang} />
        <ContentTrToggle />
        <Bell />
        <span className="small">{user.name}{user.role === 'admin' ? ` (${tr('관리자')})` : ''}</span>
        <button className="btn sm" onClick={() => setPwOpen(true)}>{tr('비밀번호 변경')}</button>
        <button className="btn sm" onClick={logout}>{tr('로그아웃')}</button>
      </header>
      <Routes key={lang}>
        <Route path="/" element={<Home />} />
        <Route path="/projects/:id/*" element={<Project />} />
        <Route path="/admin" element={user.role === 'admin' ? <Admin /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </Ctx.Provider>
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
