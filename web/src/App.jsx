import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Project from './pages/Project.jsx';
import Admin from './pages/Admin.jsx';
import Modal from './components/Modal.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  const [user, setUser] = useState(undefined);
  const [toastMsg, setToastMsg] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);
  const nav = useNavigate();

  const toast = useCallback(msg => { setToastMsg(msg); clearTimeout(window.__t); window.__t = setTimeout(() => setToastMsg(null), 3500); }, []);
  useEffect(() => {
    api.get('/auth/me').then(r => setUser(r.user)).catch(() => setUser(null));
    const h = () => setUser(null);
    window.addEventListener('auth-expired', h);
    return () => window.removeEventListener('auth-expired', h);
  }, []);

  if (user === undefined) return <div className="loading">불러오는 중…</div>;
  if (!user) return <Ctx.Provider value={{ user, setUser, toast }}><Login /></Ctx.Provider>;

  const logout = async () => { await api.post('/auth/logout'); setUser(null); nav('/'); };
  return (
    <Ctx.Provider value={{ user, setUser, toast }}>
      <header className="topbar">
        <NavLink to="/" className="brand">📅 R&D 일정관리</NavLink>
        <nav>
          <NavLink to="/" end className="navlink">홈</NavLink>
          {user.role === 'admin' && <NavLink to="/admin" className="navlink">관리</NavLink>}
        </nav>
        <div className="sp" />
        <span className="small">{user.name}{user.role === 'admin' ? ' (관리자)' : ''}</span>
        <button className="btn sm" onClick={() => setPwOpen(true)}>비밀번호 변경</button>
        <button className="btn sm" onClick={logout}>로그아웃</button>
      </header>
      <Routes>
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
    if (f.next !== f.again) return setErr('새 비밀번호가 서로 다릅니다.');
    try { await api.post('/auth/password', f); toast('비밀번호를 바꿨습니다.'); onClose(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title="비밀번호 변경" onClose={onClose}>
      {err && <div className="err">{err}</div>}
      <div className="form">
        <label>현재 비밀번호</label><input type="password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} />
        <label>새 비밀번호</label><input type="password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} placeholder="8자 이상" />
        <label>새 비밀번호 확인</label><input type="password" value={f.again} onChange={e => setF({ ...f, again: e.target.value })} />
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>취소</button><button className="btn primary" onClick={save}>저장</button></div>
    </Modal>
  );
}
