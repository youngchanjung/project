import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { tr } from '../i18n.js';

export default function Login() {
  const { setUser } = useApp();
  const [setup, setSetup] = useState(false);
  const [f, setF] = useState({ username: '', password: '', name: '', email: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prov, setProv] = useState({ m365: false, localLogin: 'all' });
  const [showLocal, setShowLocal] = useState(false);
  useEffect(() => {
    api.get('/auth/setup').then(r => setSetup(r.needsSetup)).catch(() => {});
    api.get('/auth/providers').then(setProv).catch(() => {});
    // 회사 계정 로그인 실패로 돌아온 경우
    const q = new URLSearchParams(location.search);
    if (q.get('login_error')) { setErr(q.get('login_error')); history.replaceState(null, '', location.pathname); }
  }, []);
  // SSO 전환(관리자만 자체 로그인) 상태에서는 아이디 입력란을 접어 둠
  const localHidden = !setup && prov.m365 && prov.localLogin === 'admin' && !showLocal;
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async e => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = setup ? await api.post('/auth/setup', f) : await api.post('/auth/login', { username: f.username, password: f.password });
      setUser(r.user);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <form className="login" onSubmit={submit}>
      <h1>{tr('📅 R&D 일정관리')}</h1>
      {setup && <div className="ok">{tr('처음 실행입니다. 관리자 계정을 만들어 주세요.')}</div>}
      {err && <div className="err">{err}</div>}
      {!setup && prov.m365 && <>
        <a className="btn primary mslogin" href="/api/auth/m365/start"><span className="msq" aria-hidden><i /><i /><i /><i /></span>{tr('회사 계정(Microsoft)으로 로그인')}</a>
        {localHidden ? <button type="button" className="linkbtn small" onClick={() => setShowLocal(true)}>{tr('관리자 아이디로 로그인')}</button>
          : <div className="small login-or">{tr('또는 아이디로 로그인')}</div>}
      </>}
      {!localHidden && <>
      <input type="text" placeholder={tr('아이디')} value={f.username} onChange={set('username')} autoFocus autoComplete="username" />
      {setup && <input type="text" placeholder={tr('이름')} value={f.name} onChange={set('name')} />}
      {setup && <input type="email" placeholder={tr('회사 메일 (M365 연동 시 사용)')} value={f.email} onChange={set('email')} />}
      <input type="password" placeholder={tr(setup ? '비밀번호 (8자 이상)' : '비밀번호')} value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} />
      <button className={`btn ${prov.m365 && !setup ? '' : 'primary'}`} disabled={busy}>{tr(setup ? '관리자 계정 만들기' : '로그인')}</button>
      </>}
      {!setup && <p className="small" style={{ marginTop: 12 }}>{tr('계정이 없으면 관리자에게 요청하세요.')}</p>}
    </form>
  );
}
