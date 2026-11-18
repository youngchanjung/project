import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { useApp } from '../App.jsx';
import History from '../components/History.jsx';
import { ROLE_NAME, PALETTE } from '../util.js';

export default function Settings() {
  const { can } = useProject();
  return (
    <div className="grid2">
      <Info />
      <Members />
      <Phases />
      <ImportExport />
      {can('pm') && <Baseline />}
      <div className="card" style={{ gridColumn: '1/-1' }}><h3>프로젝트 변경 이력 <span className="small">최근 300건</span></h3><History /></div>
    </div>
  );
}

function Info() {
  const { project, can, reload, toast } = useProject();
  const { user } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState(project);
  const [err, setErr] = useState(null);
  useEffect(() => setF(project), [project]);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const ed = can('pm');
  const save = async patch => {
    try { await api.patch(`/projects/${project.id}`, patch || { name: f.name, code: f.code, client: f.client, description: f.description, status: f.status, calendars: f.calendars, day_basis: f.day_basis }); await reload(); toast('저장했습니다.'); setErr(null); }
    catch (e) { setErr(e.message); }
  };
  const del = async () => {
    if (prompt(`프로젝트와 모든 작업·이슈가 삭제됩니다. 되돌릴 수 없습니다.\n삭제하려면 프로젝트 이름을 입력하세요: ${project.name}`) !== project.name) return;
    try { await api.del(`/projects/${project.id}`); nav('/'); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="card"><h3>프로젝트 정보</h3>
      {err && <div className="err">{err}</div>}
      <fieldset disabled={!ed} style={{ border: 0, padding: 0, margin: 0 }}><div className="form">
        <label>이름</label><input type="text" value={f.name} onChange={set('name')} />
        <label>코드</label><input type="text" value={f.code || ''} onChange={set('code')} />
        <label>발주처·협력처</label><input type="text" value={f.client || ''} onChange={set('client')} />
        <label>설명</label><textarea value={f.description || ''} onChange={set('description')} />
        <label>상태</label><select value={f.status} onChange={set('status')}>{['계획', '진행중', '보류', '완료'].map(x => <option key={x}>{x}</option>)}</select>
        <label>휴일 달력</label>
        <div className="row">{['KR', 'VN'].map(c => (
          <label key={c} className="small"><input type="checkbox" checked={String(f.calendars).split(',').includes(c)} onChange={e => {
            const cs = new Set(String(f.calendars).split(',').filter(Boolean)); e.target.checked ? cs.add(c) : cs.delete(c); setF({ ...f, calendars: [...cs].join(',') || 'KR' });
          }} /> {c === 'KR' ? '한국' : '베트남'}</label>))}</div>
        <label>일정 계산 기준</label>
        <select value={f.day_basis} onChange={set('day_basis')}><option value="workday">근무일 (주말·공휴일 제외)</option><option value="calendar">달력일 (모든 날 포함)</option></select>
      </div></fieldset>
      {ed && <div className="actions">
        {user.role === 'admin' && <button className="btn danger" onClick={del} style={{ marginRight: 'auto' }}>프로젝트 삭제</button>}
        <button className="btn" onClick={() => save({ archived: !project.archived })}>{project.archived ? '보관 해제' : '보관 (목록에서 숨김)'}</button>
        <button className="btn primary" onClick={() => save()}>저장</button>
      </div>}
    </div>
  );
}

function Members() {
  const { project, members, can, reload, toast } = useProject();
  const [users, setUsers] = useState([]);
  const [add, setAdd] = useState({ uid: '', role: 'member' });
  const [err, setErr] = useState(null);
  useEffect(() => { api.get('/users').then(setUsers); }, []);
  const ed = can('pm');
  const put = async (uid, role) => { try { await api.put(`/projects/${project.id}/members/${uid}`, { role }); await reload(); setErr(null); } catch (e) { setErr(e.message); } };
  const rm = async m => { if (!confirm(`${m.name}님을 참여자에서 뺄까요?`)) return; try { await api.del(`/projects/${project.id}/members/${m.id}`); await reload(); } catch (e) { setErr(e.message); } };
  const others = users.filter(u => u.active && !members.find(m => m.id === u.id));
  return (
    <div className="card"><h3>참여자 <span className="small">{members.length}명 · 참여자가 아닌 직원은 조회만 가능</span></h3>
      {err && <div className="err">{err}</div>}
      <table><tbody>{members.map(m => (
        <tr key={m.id}><td>{m.name} <span className="small">{m.email || m.username}</span></td>
          <td>{ed ? <select value={m.role} onChange={e => put(m.id, e.target.value)}>{Object.entries(ROLE_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : ROLE_NAME[m.role]}</td>
          <td>{ed && <button className="btn sm danger" onClick={() => rm(m)}>빼기</button>}</td></tr>))}
      </tbody></table>
      {ed && <div className="toolbar" style={{ marginTop: 10 }}>
        <select value={add.uid} onChange={e => setAdd({ ...add, uid: e.target.value })}><option value="">직원 선택…</option>{others.map(u => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select>
        <select value={add.role} onChange={e => setAdd({ ...add, role: e.target.value })}>{Object.entries(ROLE_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn primary" onClick={async () => { if (add.uid) { await put(add.uid, add.role); setAdd({ uid: '', role: 'member' }); toast('참여자를 추가했습니다.'); } }}>추가</button>
      </div>}
      <p className="small">PM: 일정·단계·참여자·기준 일정 관리 · 참여자: 작업·이슈 추가와 수정 · 조회자: 보기와 이슈 댓글. 직원 계정은 관리자가 ‘관리’ 메뉴에서 만듭니다.</p>
    </div>
  );
}

function Phases() {
  const { project, phases, tasks, can, reload, color } = useProject();
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const ed = can('pm');
  const call = async fn => { try { await fn(); await reload(); setErr(null); } catch (e) { setErr(e.message); } };
  const move = (p, dir) => {
    const i = phases.findIndex(x => x.id === p.id), j = i + dir;
    if (j < 0 || j >= phases.length) return;
    call(async () => {
      await api.patch(`/projects/${project.id}/phases/${p.id}`, { sort: phases[j].sort });
      await api.patch(`/projects/${project.id}/phases/${phases[j].id}`, { sort: p.sort });
    });
  };
  return (
    <div className="card"><h3>단계 <span className="small">작업을 묶는 단위 (계약·공정·연구 단계)</span></h3>
      {err && <div className="err">{err}</div>}
      <table><tbody>{phases.map((p, i) => (
        <tr key={p.id}>
          <td style={{ width: 40 }}>{ed ? <input type="color" value={color(p.id)} onChange={e => call(() => api.patch(`/projects/${project.id}/phases/${p.id}`, { color: e.target.value }))} style={{ width: 30, padding: 0, border: 0 }} /> : <span className="dot" style={{ background: color(p.id) }} />}</td>
          <td>{ed ? <input type="text" defaultValue={p.name} onBlur={e => e.target.value !== p.name && call(() => api.patch(`/projects/${project.id}/phases/${p.id}`, { name: e.target.value }))} /> : p.name}</td>
          <td className="small nw">{tasks.filter(t => t.phase_id === p.id).length}건</td>
          <td className="nw">{ed && <>
            <button className="btn sm" onClick={() => move(p, -1)} disabled={i === 0}>↑</button> <button className="btn sm" onClick={() => move(p, 1)} disabled={i === phases.length - 1}>↓</button>{' '}
            <button className="btn sm danger" onClick={() => confirm(`'${p.name}' 단계를 삭제할까요? 작업은 지워지지 않고 '단계 없음'이 됩니다.`) && call(() => api.del(`/projects/${project.id}/phases/${p.id}`))}>삭제</button></>}</td>
        </tr>))}</tbody></table>
      {ed && <div className="toolbar" style={{ marginTop: 10 }}>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="새 단계 이름" />
        <button className="btn primary" onClick={() => name.trim() && call(async () => { await api.post(`/projects/${project.id}/phases`, { name, color: PALETTE[phases.length % PALETTE.length] }); setName(''); })}>추가</button>
      </div>}
    </div>
  );
}

function ImportExport() {
  const { project, can, reload, toast } = useProject();
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [recalc, setRecalc] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async dry => {
    setErr(null); setBusy(true);
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (dry) fd.append('dryRun', '1');
    if (!dry && recalc) fd.append('recalc', '1');
    try {
      const r = await api.post(`/projects/${project.id}/import`, fd);
      if (dry) setPreview(r); else { setPreview(null); setFiles([]); await reload(); toast(`불러오기 완료: 작업 ${r.tasksAdded}건 추가·${r.tasksUpdated}건 갱신, 이슈 ${r.issuesAdded}건 추가·${r.issuesUpdated}건 갱신`); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card"><h3>엑셀 불러오기 · 내보내기</h3>
      <p className="small">불러오기: 계약 일정 통합본(Detail 시트), 일정표·이슈로그, 또는 이 프로그램에서 내보낸 파일. ID(이슈 No)가 같은 항목은 갱신하고 없는 항목은 추가합니다. 기존 데이터는 지우지 않습니다.</p>
      {err && <div className="err">{err}</div>}
      {can('pm') ? <>
        <div className="toolbar"><input type="file" accept=".xlsx,.xlsm,.xls" multiple onChange={e => { setFiles([...e.target.files]); setPreview(null); }} />
          <button className="btn" disabled={!files.length || busy} onClick={() => send(true)}>미리 보기</button></div>
        {preview && <div className="ok">
          <div>인식한 시트: {preview.sheets.join(', ')}</div>
          <div>단계 +{preview.phases} · 작업 +{preview.tasksAdded} / 갱신 {preview.tasksUpdated} · 선행관계 {preview.deps}건 · 이슈 +{preview.issuesAdded} / 갱신 {preview.issuesUpdated} · 공휴일 +{preview.holidays}</div>
          {preview.dayBasis === 'calendar' && <div>계약 일정 엑셀이 달력일 기준이라 이 프로젝트의 계산 기준을 ‘달력일’로 맞춥니다.</div>}
          {preview.depsSkipped.length > 0 && <div>대상 작업이 없어 건너뛸 선행관계: {preview.depsSkipped.slice(0, 8).join(', ')}{preview.depsSkipped.length > 8 ? ` 외 ${preview.depsSkipped.length - 8}건` : ''}</div>}
          <div>{preview.shifted ? `엑셀 날짜가 선행관계 규칙과 다른 작업 ${preview.shifted}건이 있습니다.` : '엑셀 날짜가 선행관계 규칙과 모두 일치합니다.'}</div>
          {preview.shifted > 0 && <label className="small"><input type="checkbox" checked={recalc} onChange={e => setRecalc(e.target.checked)} /> 불러온 뒤 선행관계 규칙대로 날짜 다시 계산 (끄면 엑셀 날짜 그대로)</label>}
          <div className="actions" style={{ marginTop: 6 }}><button className="btn primary" disabled={busy} onClick={() => send(false)}>불러오기 실행</button></div>
        </div>}
      </> : <p className="small">불러오기는 PM만 할 수 있습니다.</p>}
      <div className="toolbar" style={{ marginTop: 10 }}><a className="btn" href={`/api/projects/${project.id}/export.xlsx`}>엑셀로 내보내기 (작업·이슈)</a></div>
    </div>
  );
}

function Baseline() {
  const { project, tasks, reload, toast } = useProject();
  const missing = tasks.filter(t => !t.baseline_end).length;
  const slipped = tasks.filter(t => t.baseline_end && t.end > t.baseline_end).length;
  const run = async onlyMissing => {
    if (!onlyMissing && !confirm('모든 작업의 현재 일정을 새 기준 일정으로 저장합니다. 지금까지의 편차 기록은 초기화됩니다. 계속할까요?')) return;
    const r = await api.post(`/projects/${project.id}/baseline`, { onlyMissing });
    await reload(); toast(`기준 일정 ${r.updated}건 저장`);
  };
  return (
    <div className="card"><h3>기준 일정 (Baseline)</h3>
      <p className="small">기준 일정은 처음 합의한 일정입니다. 이후 날짜가 바뀌면 간트와 작업 정보에 편차(일)가 표시됩니다.</p>
      <p>기준보다 늦어진 작업 <b style={{ color: slipped ? 'var(--late)' : undefined }}>{slipped}</b>건 · 기준 일정이 없는 작업 {missing}건</p>
      <div className="toolbar">
        <button className="btn" disabled={!missing} onClick={() => run(true)}>빈 작업만 현재 일정으로 채우기</button>
        <button className="btn danger" onClick={() => run(false)}>전체를 현재 일정으로 재확정</button>
      </div>
    </div>
  );
}
