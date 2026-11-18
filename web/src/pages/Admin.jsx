import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Modal from '../components/Modal.jsx';
import { fmtY, dow } from '../util.js';

export default function Admin() {
  return (
    <main className="page">
      <h1 className="title">관리</h1>
      <div className="grid2"><Users /><Holidays /></div>
    </main>
  );
}

function Users() {
  const { toast, user: me } = useApp();
  const [users, setUsers] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = () => api.get('/users').then(setUsers);
  useEffect(() => { load(); }, []);
  return (
    <div className="card"><h3>직원 계정 <span className="small">{users.filter(u => u.active).length}명 사용 중</span><button className="btn primary sm" onClick={() => setEdit({})}>+ 계정 추가</button></h3>
      <table><thead><tr><th>이름</th><th>아이디</th><th>메일</th><th>권한</th><th /></tr></thead>
        <tbody>{users.map(u => (
          <tr key={u.id} style={u.active ? undefined : { opacity: .5 }}>
            <td>{u.name}</td><td>{u.username}</td><td className="small">{u.email}</td>
            <td>{u.role === 'admin' ? '관리자' : '일반'}{!u.active && ' (사용 중지)'}</td>
            <td><button className="btn sm" onClick={() => setEdit(u)}>수정</button></td>
          </tr>))}</tbody></table>
      <p className="small">M365 연동 후에는 회사 계정으로 로그인하며, 메일 주소로 기존 계정과 연결됩니다.</p>
      {edit && <UserModal u={edit} me={me} onClose={() => setEdit(null)} onSaved={() => { load(); toast('저장했습니다.'); setEdit(null); }} />}
    </div>
  );
}

function UserModal({ u, me, onClose, onSaved }) {
  const isNew = !u.id;
  const [f, setF] = useState({ username: u.username || '', name: u.name || '', email: u.email || '', role: u.role || 'user', active: u.active ?? true, password: '' });
  const [err, setErr] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    try {
      if (isNew) await api.post('/users', f);
      else { const b = { name: f.name, email: f.email, role: f.role, active: f.active }; if (f.password) b.password = f.password; await api.patch(`/users/${u.id}`, b); }
      onSaved();
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={isNew ? '계정 추가' : `${u.name} 계정 수정`} onClose={onClose}>
      {err && <div className="err">{err}</div>}
      <div className="form">
        <label>아이디</label><input type="text" value={f.username} onChange={set('username')} disabled={!isNew} />
        <label>이름</label><input type="text" value={f.name} onChange={set('name')} />
        <label>회사 메일</label><input type="email" value={f.email} onChange={set('email')} />
        <label>권한</label><select value={f.role} onChange={set('role')} disabled={u.id === me.id}><option value="user">일반</option><option value="admin">관리자</option></select>
        <label>{isNew ? '초기 비밀번호' : '비밀번호 재설정'}</label><input type="password" value={f.password} onChange={set('password')} placeholder={isNew ? '8자 이상' : '바꿀 때만 입력'} />
        {!isNew && <><label>사용</label><label className="small"><input type="checkbox" checked={f.active} onChange={set('active')} disabled={u.id === me.id} /> 로그인 허용 (퇴사 시 해제)</label></>}
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>취소</button><button className="btn primary" onClick={save}>저장</button></div>
    </Modal>
  );
}

function Holidays() {
  const [rows, setRows] = useState([]);
  const [country, setCountry] = useState('KR');
  const [f, setF] = useState({ date: '', name: '' });
  const [err, setErr] = useState(null);
  const load = () => api.get(`/holidays?country=${country}`).then(setRows);
  useEffect(() => { load(); }, [country]); // eslint-disable-line
  const add = async () => { try { await api.post('/holidays', { country, ...f }); setF({ date: '', name: '' }); setErr(null); load(); } catch (e) { setErr(e.message); } };
  const del = async h => { await api.del(`/holidays/${h.id}`); load(); };
  return (
    <div className="card"><h3>공휴일 <span className="small">근무일 기준 프로젝트의 일정 계산에 사용</span></h3>
      <div className="toolbar">{['KR', 'VN'].map(c => <span key={c} className={`chip ${country === c ? 'on' : ''}`} onClick={() => setCountry(c)}>{c === 'KR' ? '한국' : '베트남'}</span>)}</div>
      {err && <div className="err">{err}</div>}
      <div className="toolbar"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /><input type="text" placeholder="이름" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /><button className="btn primary" onClick={add}>추가</button></div>
      <div className="tablewrap" style={{ maxHeight: 420 }}><table><tbody>{rows.map(h => (
        <tr key={h.id}><td className="nw">{fmtY(h.date)} ({dow(h.date)})</td><td>{h.name}</td><td><button className="btn sm danger" onClick={() => del(h)}>삭제</button></td></tr>))}</tbody></table></div>
    </div>
  );
}
