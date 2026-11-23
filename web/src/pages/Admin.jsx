import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Modal from '../components/Modal.jsx';
import { fmtY, dow } from '../util.js';
import { COUNTRIES } from '../countries.js';
import { tr } from '../i18n.js';

export default function Admin() {
  const [depts, setDepts] = useState([]);
  const loadDepts = () => api.get('/departments').then(setDepts);
  useEffect(() => { loadDepts(); }, []);
  return (
    <main className="page">
      <h1 className="title">{tr('관리')}</h1>
      <div className="grid2">
        <div style={{ gridColumn: '1/-1' }}><Users depts={depts} onDeptsChanged={loadDepts} /></div>
        <Departments depts={depts} reload={loadDepts} />
        <Holidays />
        <Backup />
      </div>
    </main>
  );
}

// 부서 이름을 "상위 > 하위" 형태로
function deptPath(depts) {
  const byId = new Map(depts.map(d => [d.id, d]));
  const name = d => { const seen = new Set(); const parts = []; for (let x = d; x && !seen.has(x.id); x = byId.get(x.parent_id)) { seen.add(x.id); parts.unshift(x.name); } return parts.join(' > '); };
  return new Map(depts.map(d => [d.id, name(d)]));
}

function Users({ depts, onDeptsChanged }) {
  const { toast, user: me } = useApp();
  const [users, setUsers] = useState([]);
  const [edit, setEdit] = useState(null);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const load = () => api.get('/users').then(setUsers);
  useEffect(() => { load(); }, []);
  const dn = deptPath(depts);
  const shown = users.filter(u => (showInactive || u.active)
    && (!dept || (dept === 'none' ? !u.department_id : u.department_id === Number(dept)))
    && (!q || [u.name, u.username, u.email, u.employee_no, u.position].some(v => v && v.toLowerCase().includes(q.toLowerCase()))));
  return (
    <div className="card"><h3>{tr('직원 계정')} <span className="small">{users.filter(u => u.active).length}{tr('명 사용 중')}</span>
      <span className="row" style={{ display: 'flex', gap: 6 }}>
        <button className="btn sm" onClick={() => setImporting(true)}>{tr('엑셀로 일괄 등록')}</button>
        <button className="btn primary sm" onClick={() => setEdit({})}>{tr('+ 계정 추가')}</button>
      </span></h3>
      <div className="toolbar">
        <input type="search" placeholder={tr('이름·아이디·사번·메일 검색')} value={q} onChange={e => setQ(e.target.value)} />
        <select value={dept} onChange={e => setDept(e.target.value)}>
          <option value="">{tr('전체 부서')}</option>
          {depts.map(d => <option key={d.id} value={d.id}>{dn.get(d.id)}</option>)}
          <option value="none">{tr('(부서 없음)')}</option>
        </select>
        <label className="small"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> {tr('사용 중지 계정도 보기')}</label>
      </div>
      <div className="tablewrap" style={{ maxHeight: 460 }}>
        <table><thead><tr><th>{tr('이름')}</th><th>{tr('아이디')}</th><th>{tr('사번')}</th><th>{tr('부서')}</th><th>{tr('직급')}</th><th>{tr('메일')}</th><th>{tr('권한')}</th><th>{tr('최근 로그인')}</th><th /></tr></thead>
          <tbody>{shown.map(u => (
            <tr key={u.id} style={u.active ? undefined : { opacity: .5 }}>
              <td className="nw">{u.name}</td><td>{u.username}</td><td className="small">{u.employee_no}</td>
              <td className="nw">{dn.get(u.department_id) || <span className="small">-</span>}</td><td className="nw">{u.position}</td>
              <td className="small">{u.email}</td>
              <td className="nw">{tr(u.role === 'admin' ? '관리자' : '일반')}{!u.active && ` (${tr('사용 중지')})`}</td>
              <td className="small nw">{u.last_login_at ? fmtDT(u.last_login_at) : '-'}</td>
              <td><button className="btn sm" onClick={() => setEdit(u)}>{tr('수정')}</button></td>
            </tr>))}
            {!shown.length && <tr><td colSpan={9} className="empty">{tr('해당하는 직원이 없습니다.')}</td></tr>}
          </tbody></table>
      </div>
      <p className="small">{tr('권한: 관리자는 이 관리 화면과 모든 프로젝트를 편집할 수 있고, 일반 직원은 참여한 프로젝트에서 역할(PM·참여자·조회자)에 따라 편집합니다.')} {tr('M365 연동 후에는 회사 계정으로 로그인하며, 메일 주소로 기존 계정과 연결됩니다.')}</p>
      {edit && <UserModal u={edit} me={me} depts={depts} dn={dn} onClose={() => setEdit(null)} onSaved={() => { load(); onDeptsChanged(); toast(tr('저장했습니다.')); setEdit(null); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={msg => { load(); onDeptsChanged(); toast(msg); setImporting(false); }} />}
    </div>
  );
}

const fmtDT = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

function UserModal({ u, me, depts, dn, onClose, onSaved }) {
  const isNew = !u.id;
  const [f, setF] = useState({
    username: u.username || '', name: u.name || '', email: u.email || '', role: u.role || 'user', active: u.active ?? true, password: '',
    department_id: u.department_id ?? '', employee_no: u.employee_no || '', position: u.position || '', phone: u.phone || ''
  });
  const [err, setErr] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    try {
      const b = { ...f, department_id: f.department_id === '' ? null : Number(f.department_id) };
      if (isNew) await api.post('/users', b);
      else { delete b.username; if (!b.password) delete b.password; await api.patch(`/users/${u.id}`, b); }
      onSaved();
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={isNew ? tr('계정 추가') : tr('{name} 계정 수정', { name: u.name })} onClose={onClose}>
      {err && <div className="err">{err}</div>}
      <div className="form">
        <label>{tr('아이디')}</label><input type="text" value={f.username} onChange={set('username')} disabled={!isNew} />
        <label>{tr('이름')}</label><input type="text" value={f.name} onChange={set('name')} />
        <label>{tr('사번')}</label><input type="text" value={f.employee_no} onChange={set('employee_no')} />
        <label>{tr('부서')}</label><select value={f.department_id} onChange={set('department_id')}>
          <option value="">{tr('(없음)')}</option>
          {depts.filter(d => d.active || d.id === u.department_id).map(d => <option key={d.id} value={d.id}>{dn.get(d.id)}</option>)}
        </select>
        <label>{tr('직급·직책')}</label><input type="text" value={f.position} onChange={set('position')} placeholder={tr('예: 책임연구원, 팀장')} />
        <label>{tr('회사 메일')}</label><input type="email" value={f.email} onChange={set('email')} placeholder={tr('M365 로그인 연결에 사용')} />
        <label>{tr('전화')}</label><input type="text" value={f.phone} onChange={set('phone')} />
        <label>{tr('권한')}</label><select value={f.role} onChange={set('role')} disabled={u.id === me.id}><option value="user">{tr('일반')}</option><option value="admin">{tr('관리자')}</option></select>
        <label>{tr(isNew ? '초기 비밀번호' : '비밀번호 재설정')}</label><input type="password" value={f.password} onChange={set('password')} placeholder={tr(isNew ? '8자 이상' : '바꿀 때만 입력')} />
        {!isNew && <><label>{tr('사용')}</label><label className="small"><input type="checkbox" checked={f.active} onChange={set('active')} disabled={u.id === me.id} /> {tr('로그인 허용 (퇴사 시 해제)')}</label></>}
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>{tr('취소')}</button><button className="btn primary" onClick={save}>{tr('저장')}</button></div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async apply => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await api.post(`/users/import${apply ? '?apply=1' : ''}`, fd);
      if (apply) onDone(tr('직원 {a}명 추가, {b}명 갱신했습니다.', { a: r.summary.add, b: r.summary.update })); else setRes(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={tr('엑셀로 직원 일괄 등록')} onClose={onClose} wide>
      <ol className="small" style={{ paddingLeft: 18, marginTop: 0 }}>
        <li><a href="/api/users/template.xlsx">{tr('엑셀 양식 내려받기')}</a> {tr('(지금 등록된 직원이 들어 있습니다)')}</li>
        <li>{tr('한 줄에 한 명씩 아이디·이름·사번·부서·직급·메일·권한·초기 비밀번호를 적습니다. 없는 부서는 새로 만들어집니다.')}</li>
        <li>{tr('파일을 골라')} <b>{tr('미리 보기')}</b>{tr('로 확인한 뒤')} <b>{tr('등록 실행')}</b>{tr('을 누릅니다. 같은 아이디는 정보를 갱신합니다.')}</li>
      </ol>
      <div className="toolbar">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={e => { setFile(e.target.files[0] || null); setRes(null); }} />
        <button className="btn" disabled={!file || busy} onClick={() => send(false)}>{tr('미리 보기')}</button>
      </div>
      {err && <div className="err">{err}</div>}
      {res && <>
        <div className={res.summary.errors ? 'err' : 'ok'}>
          {tr('추가 {a}명 · 갱신 {b}명', { a: res.summary.add, b: res.summary.update })}
          {res.summary.errors ? ' · ' + tr('오류 {n}줄 (고친 뒤 다시 올려 주세요)', { n: res.summary.errors }) : ''}
          {res.summary.newDepts.length > 0 && ` · ${tr('새 부서')}: ${res.summary.newDepts.join(', ')}`}
        </div>
        <div className="tablewrap" style={{ maxHeight: 340 }}>
          <table><thead><tr><th>{tr('줄')}</th><th>{tr('처리')}</th><th>{tr('아이디')}</th><th>{tr('이름')}</th><th>{tr('부서')}</th><th>{tr('직급')}</th><th>{tr('메일')}</th><th>{tr('권한')}</th><th>{tr('비밀번호')}</th></tr></thead>
            <tbody>{res.rows.map(r => (
              <tr key={r.line} style={r.error ? { background: 'var(--late-soft)' } : undefined}>
                <td>{r.line}</td><td className="nw">{r.error ? <span style={{ color: 'var(--late)' }}>{r.error}</span> : r.action}</td>
                <td>{r.username}</td><td className="nw">{r.name}</td><td className="nw">{r.dept}</td><td className="nw">{r.position}</td>
                <td className="small">{r.email}</td><td>{tr(r.role === 'admin' ? '관리자' : '일반')}</td><td className="small">{r.hasPassword ? tr('설정') : '-'}</td>
              </tr>))}</tbody></table>
        </div>
      </>}
      <div className="actions"><button className="btn" onClick={onClose}>{tr('닫기')}</button>
        <button className="btn primary" disabled={!res || res.summary.errors > 0 || busy || !(res.summary.add + res.summary.update)} onClick={() => send(true)}>{tr('등록 실행')}</button></div>
    </Modal>
  );
}

function Departments({ depts, reload }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState(null);
  const dn = deptPath(depts);
  const sorted = [...depts].sort((a, b) => dn.get(a.id).localeCompare(dn.get(b.id), 'ko'));
  return (
    <div className="card"><h3>{tr('부서')} <span className="small">{depts.filter(d => d.active).length}{tr('개')}</span><button className="btn primary sm" onClick={() => setEdit({})}>{tr('+ 부서 추가')}</button></h3>
      <div className="tablewrap" style={{ maxHeight: 420 }}>
        <table><thead><tr><th>{tr('부서')}</th><th>{tr('코드')}</th><th>{tr('인원')}</th><th /></tr></thead>
          <tbody>{sorted.map(d => (
            <tr key={d.id} style={d.active ? undefined : { opacity: .5 }}>
              <td>{dn.get(d.id)}{!d.active && ` (${tr('사용 안 함')})`}</td><td className="small">{d.code}</td><td>{d.members}{tr('명')}</td>
              <td className="nw"><button className="btn sm" onClick={() => setEdit(d)}>{tr('수정')}</button></td>
            </tr>))}
            {!depts.length && <tr><td colSpan={4} className="empty">{tr('부서를 추가하세요. 엑셀로 직원을 등록하면 부서가 자동으로 만들어집니다.')}</td></tr>}
          </tbody></table>
      </div>
      {edit && <DeptModal d={edit} depts={depts} dn={dn} onClose={() => setEdit(null)} onSaved={msg => { reload(); toast(msg); setEdit(null); }} />}
    </div>
  );
}

function DeptModal({ d, depts, dn, onClose, onSaved }) {
  const isNew = !d.id;
  const [f, setF] = useState({ name: d.name || '', code: d.code || '', parent_id: d.parent_id ?? '', sort: d.sort ?? 0, active: d.active ?? true });
  const [err, setErr] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    try {
      const b = { ...f, parent_id: f.parent_id === '' ? null : Number(f.parent_id) };
      if (isNew) await api.post('/departments', b); else await api.patch(`/departments/${d.id}`, b);
      onSaved(tr('저장했습니다.'));
    } catch (e) { setErr(e.message); }
  };
  const del = async () => {
    if (!window.confirm(tr('"{name}" 부서를 삭제할까요?', { name: d.name }))) return;
    try { await api.del(`/departments/${d.id}`); onSaved(tr('삭제했습니다.')); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={isNew ? tr('부서 추가') : tr('{name} 수정', { name: d.name })} onClose={onClose}>
      {err && <div className="err">{err}</div>}
      <div className="form">
        <label>{tr('부서 이름')}</label><input type="text" value={f.name} onChange={set('name')} />
        <label>{tr('상위 부서')}</label><select value={f.parent_id} onChange={set('parent_id')}>
          <option value="">{tr('(없음)')}</option>
          {depts.filter(x => x.id !== d.id).map(x => <option key={x.id} value={x.id}>{dn.get(x.id)}</option>)}
        </select>
        <label>{tr('부서 코드')}</label><input type="text" value={f.code} onChange={set('code')} placeholder={tr('선택')} />
        <label>{tr('정렬 순서')}</label><input type="number" value={f.sort} onChange={set('sort')} />
        {!isNew && <><label>{tr('사용')}</label><label className="small"><input type="checkbox" checked={f.active} onChange={set('active')} /> {tr('사용 중 (없어진 부서는 해제)')}</label></>}
      </div>
      <div className="actions">
        {!isNew && <button className="btn danger" onClick={del} style={{ marginRight: 'auto' }}>{tr('삭제')}</button>}
        <button className="btn" onClick={onClose}>{tr('취소')}</button><button className="btn primary" onClick={save}>{tr('저장')}</button>
      </div>
    </Modal>
  );
}

function Backup() {
  const { toast } = useApp();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const load = () => api.get('/backup').then(setSt).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setSt(await api.post('/backup/run')); toast(tr('백업했습니다.')); } catch (e) { setErr(e.message); load(); } finally { setBusy(false); }
  };
  const last = st?.last;
  const kb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  return (
    <div className="card"><h3>{tr('DB 백업')} <span className="small">{tr('매주 금요일 저녁 자동')}</span><button className="btn sm" disabled={busy} onClick={run}>{tr(busy ? '백업 중…' : '지금 백업')}</button></h3>
      {err && <div className="err">{err}</div>}
      {st && <>
        {last
          ? <div className={last.ok ? 'ok' : 'err'}>{tr('최근 백업:')} {fmtDT(last.at)} ({last.by === '예약 작업' ? tr('예약 작업') : last.by}) · {last.ok ? `${tr('성공')}, ${kb(last.size)}` : `${tr('실패')} - ${last.error}`}</div>
          : <div className="err">{tr('아직 백업 기록이 없습니다. 서버 PC에서 register-backup-task.bat 을 관리자 권한으로 실행해 자동 백업을 등록하세요.')}</div>}
        <p className="small">{tr('저장 위치:')} {st.dir}{st.copyDir && <><br />{tr('추가 복사:')} {st.copyDir}</>}<br />{tr('최근')} {st.keep}{tr('개 보관')}</p>
        <div className="tablewrap" style={{ maxHeight: 220 }}><table><tbody>{st.files.map(f => (
          <tr key={f.name}><td className="small">{f.name}</td><td className="small nw">{kb(f.size)}</td></tr>))}</tbody></table></div>
      </>}
    </div>
  );
}

function Holidays() {
  const { toast } = useApp();
  const [rows, setRows] = useState([]);
  const [country, setCountry] = useState('KR');
  const [f, setF] = useState({ date: '', name: '' });
  const [bulk, setBulk] = useState(null);
  const [err, setErr] = useState(null);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const load = () => api.get(`/holidays?country=${country}`).then(setRows);
  useEffect(() => { load(); setErr(null); }, [country]); // eslint-disable-line
  const add = async () => { try { await api.post('/holidays', { country, ...f }); setF({ date: '', name: '' }); setErr(null); load(); } catch (e) { setErr(e.message); } };
  const addBulk = async () => {
    try { const r = await api.post('/holidays/bulk', { country, text: bulk }); toast(tr('{n}일 추가', { n: r.added }) + (r.skipped ? tr(', {n}일은 이미 있음', { n: r.skipped }) : '')); setBulk(null); setErr(null); load(); } catch (e) { setErr(e.message); }
  };
  const del = async h => { await api.del(`/holidays/${h.id}`); load(); };
  const years = [...new Set([String(thisYear), ...rows.map(h => h.date.slice(0, 4))])].sort();
  const shown = rows.filter(h => !year || h.date.startsWith(year));
  return (
    <div className="card"><h3>{tr('공휴일')} <span className="small">{tr('근무일 기준 프로젝트의 일정 계산에 사용')}</span></h3>
      <div className="toolbar">{COUNTRIES.map(({ code: c, name }) => <span key={c} className={`chip ${country === c ? 'on' : ''}`} onClick={() => setCountry(c)}>{tr(name)}</span>)}
        <span className="sp" />
        <select value={year} onChange={e => setYear(e.target.value)}><option value="">{tr('전체 연도')}</option>{years.map(y => <option key={y} value={y}>{tr('{y}년', { y })}</option>)}</select>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="toolbar"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /><input type="text" placeholder={tr('이름')} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /><button className="btn primary" onClick={add}>{tr('추가')}</button>
        <button className="btn" onClick={() => setBulk(bulk === null ? '' : null)}>{tr('여러 날 붙여넣기')}</button></div>
      {bulk !== null && <div style={{ marginBottom: 12 }}>
        <textarea value={bulk} onChange={e => setBulk(e.target.value)} placeholder={tr('한 줄에 하루씩: 날짜 이름') + '\n2027-01-01 …\n2027-02-05 …\n' + tr('(엑셀에서 날짜·이름 두 칸을 복사해 붙여 넣어도 됩니다)')} style={{ minHeight: 120 }} />
        <div className="toolbar" style={{ marginTop: 6 }}><button className="btn primary sm" onClick={addBulk} disabled={!bulk.trim()}>{tr('등록')}</button><button className="btn sm" onClick={() => setBulk(null)}>{tr('취소')}</button><span className="small">{tr('이미 있는 날짜는 건너뜁니다.')}</span></div>
      </div>}
      <div className="tablewrap" style={{ maxHeight: 420 }}><table><tbody>{shown.map(h => (
        <tr key={h.id}><td className="nw">{fmtY(h.date)} ({dow(h.date)})</td><td>{h.name}</td><td><button className="btn sm danger" onClick={() => del(h)}>{tr('삭제')}</button></td></tr>))}
        {!shown.length && <tr><td className="empty">{tr('등록된 공휴일이 없습니다.')} {country === 'VN' && tr('계약 일정 엑셀(Holidays 시트)을 불러오면 함께 들어오고, 직접 추가하거나 붙여 넣을 수도 있습니다.')}</td></tr>}
      </tbody></table></div>
    </div>
  );
}

