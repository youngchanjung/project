import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { useApp } from '../App.jsx';
import History from '../components/History.jsx';
import Modal from '../components/Modal.jsx';
import { COUNTRIES } from '../countries.js';
import { ROLE_NAME, PALETTE, CATEGORIES, TASK_STATUS, statusLabel } from '../util.js';
import { Tx } from '../contentTr.jsx';
import { tr } from '../i18n.js';
import DateInput from '../components/DateInput.jsx';

export default function Settings() {
  const { can } = useProject();
  return (
    <div className="grid2">
      <Info />
      <Members />
      <BoardColumns />
      <Phases />
      <ImportExport />
      {can('pm') && <Baseline />}
      <div className="card" style={{ gridColumn: '1/-1' }}><h3>{tr('프로젝트 변경 이력')} <span className="small">{tr('최근 300건')}</span></h3><History /></div>
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
    try { await api.patch(`/projects/${project.id}`, patch || { name: f.name, code: f.code, client: f.client, description: f.description, status: f.status, calendars: f.calendars, day_basis: f.day_basis, category: f.category,
      agreement_start: f.agreement_start || null, agreement_end: f.agreement_end || null, partners: f.partners || null }); await reload(); toast(tr('저장했습니다.')); setErr(null); }
    catch (e) { setErr(e.message); }
  };
  const [delOpen, setDelOpen] = useState(false);
  return (
    <div className="card"><h3>{tr('프로젝트 정보')}</h3>
      {err && <div className="err">{err}</div>}
      <fieldset disabled={!ed} style={{ border: 0, padding: 0, margin: 0 }}><div className="form">
        <label>{tr('카테고리')}</label>
        <div className="row"><select value={f.category || 'construction'} onChange={set('category')}>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {tr(c.name)}</option>)}</select>
          <span className="small">{tr(CATEGORIES.find(c => c.key === (f.category || 'construction')).desc)}</span></div>
        <label>{tr('이름')}</label><input type="text" value={f.name} onChange={set('name')} />
        <label>{tr('코드')}</label><input type="text" value={f.code || ''} onChange={set('code')} />
        <label>{tr('발주처·협력처')}</label><input type="text" value={f.client || ''} onChange={set('client')} />
        <label>{tr('설명')}</label><textarea value={f.description || ''} onChange={set('description')} />
        {f.category === 'research' && <>
          <label>{tr('협약 기간')}</label><div className="row"><DateInput value={f.agreement_start || ''} onChange={set('agreement_start')} /> ~ <DateInput value={f.agreement_end || ''} onChange={set('agreement_end')} /></div>
          <label>{tr('협력 기관')}</label><input type="text" value={f.partners || ''} onChange={set('partners')} placeholder={tr('쉼표로 구분')} />
        </>}
        <label>{tr('상태')}</label><select value={f.status} onChange={set('status')}>{['계획', '진행중', '보류', '완료'].map(x => <option key={x} value={x}>{tr(x)}</option>)}</select>
        <label>{tr('휴일 달력')}</label>
        <div className="row">{COUNTRIES.map(({ code: c, name }) => (
          <label key={c} className="small"><input type="checkbox" checked={String(f.calendars).split(',').includes(c)} onChange={e => {
            const cs = new Set(String(f.calendars).split(',').filter(Boolean)); e.target.checked ? cs.add(c) : cs.delete(c); setF({ ...f, calendars: [...cs].join(',') || 'KR' });
          }} /> {tr(name)}</label>))}</div>
        <label>{tr('일정 계산 기준')}</label>
        <select value={f.day_basis} onChange={set('day_basis')}><option value="workday">{tr('근무일 (주말·공휴일 제외)')}</option><option value="calendar">{tr('달력일 (모든 날 포함)')}</option></select>
      </div></fieldset>
      {ed && <div className="actions">
        {user.role === 'admin' && <button className="btn danger" onClick={() => setDelOpen(true)} style={{ marginRight: 'auto' }}>{tr('프로젝트 삭제')}</button>}
        <button className="btn" onClick={() => save({ archived: !project.archived })}>{tr(project.archived ? '보관 해제' : '보관 (목록에서 숨김)')}</button>
        <button className="btn primary" onClick={() => save()}>{tr('저장')}</button>
      </div>}
      {delOpen && <DeleteProject project={project} onClose={() => setDelOpen(false)} onDone={() => { toast(tr('프로젝트를 삭제했습니다.')); nav('/'); }} />}
    </div>
  );
}

// 프로젝트 삭제 확인 창: 이름을 입력해야 삭제 버튼이 켜짐.
// (예전에는 브라우저 prompt 를 썼는데, 이름이 조금만 달라도 아무 안내 없이 멈춰서 삭제가 안 되는 것처럼 보였음)
const norm = s => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
function DeleteProject({ project, onClose, onDone }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ok = norm(typed) === norm(project.name);
  const run = async () => {
    if (!ok || busy) return;
    setBusy(true); setErr(null);
    try { await api.del(`/projects/${project.id}`); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={tr('프로젝트 삭제')} onClose={onClose}>
      <p>{tr('프로젝트와 모든 작업·이슈가 삭제됩니다. 되돌릴 수 없습니다.')}</p>
      <p className="small">{tr('삭제하려면 프로젝트 이름을 입력하세요: {name}', { name: '' })}<b style={{ userSelect: 'all' }}>{project.name}</b></p>
      <input type="text" autoFocus value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) run(); }} style={{ width: '100%' }} />
      {typed && !ok && <div className="small" style={{ color: 'var(--late)', marginTop: 4 }}>{tr('이름이 일치하지 않습니다.')}</div>}
      {err && <div className="err">{err}</div>}
      <div className="actions">
        <button className="btn" onClick={onClose}>{tr('취소')}</button>
        <button className="btn danger" disabled={!ok || busy} onClick={run}>{busy ? tr('삭제 중…') : tr('삭제')}</button>
      </div>
    </Modal>
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
  const rm = async m => { if (!confirm(tr('{name}님을 참여자에서 뺄까요?', { name: m.name }))) return; try { await api.del(`/projects/${project.id}/members/${m.id}`); await reload(); } catch (e) { setErr(e.message); } };
  const others = users.filter(u => u.active && !members.find(m => m.id === u.id));
  return (
    <div className="card"><h3>{tr('참여자')} <span className="small">{members.length}{tr('명 · 참여자가 아닌 직원은 조회만 가능')}</span></h3>
      {err && <div className="err">{err}</div>}
      <table><tbody>{members.map(m => (
        <tr key={m.id}><td>{m.name} <span className="small">{m.email || m.username}</span></td>
          <td>{ed ? <select value={m.role} onChange={e => put(m.id, e.target.value)}>{Object.entries(ROLE_NAME).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}</select> : ROLE_NAME[m.role]}</td>
          <td>{ed && <button className="btn sm danger" onClick={() => rm(m)}>{tr('빼기')}</button>}</td></tr>))}
      </tbody></table>
      {ed && <div className="toolbar" style={{ marginTop: 10 }}>
        <select value={add.uid} onChange={e => setAdd({ ...add, uid: e.target.value })}><option value="">{tr('직원 선택…')}</option>{others.map(u => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select>
        <select value={add.role} onChange={e => setAdd({ ...add, role: e.target.value })}>{Object.entries(ROLE_NAME).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}</select>
        <button className="btn primary" onClick={async () => { if (add.uid) { await put(add.uid, add.role); setAdd({ uid: '', role: 'member' }); toast(tr('참여자를 추가했습니다.')); } }}>{tr('추가')}</button>
      </div>}
      <p className="small">{tr('PM: 일정·단계·참여자·기준 일정 관리 · 참여자: 작업·이슈 추가와 수정 · 조회자: 보기와 이슈 댓글. 직원 계정은 관리자가 ‘관리’ 메뉴에서 만듭니다.')}</p>
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
    <div className="card"><h3>{tr('단계')} <span className="small">{tr('작업을 묶는 단위 (계약·공정·연구 단계)')}</span></h3>
      {err && <div className="err">{err}</div>}
      <table><tbody>{phases.map((p, i) => (
        <tr key={p.id}>
          <td style={{ width: 40 }}>{ed ? <input type="color" value={color(p.id)} onChange={e => call(() => api.patch(`/projects/${project.id}/phases/${p.id}`, { color: e.target.value }))} style={{ width: 30, padding: 0, border: 0 }} /> : <span className="dot" style={{ background: color(p.id) }} />}</td>
          <td>{ed ? <input type="text" defaultValue={p.name} onBlur={e => e.target.value !== p.name && call(() => api.patch(`/projects/${project.id}/phases/${p.id}`, { name: e.target.value }))} /> : p.name}</td>
          <td className="small nw">{tasks.filter(t => t.phase_id === p.id).length}{tr('건')}</td>
          <td className="nw">{ed && <>
            <button className="btn sm" onClick={() => move(p, -1)} disabled={i === 0}>↑</button> <button className="btn sm" onClick={() => move(p, 1)} disabled={i === phases.length - 1}>↓</button>{' '}
            <button className="btn sm danger" onClick={() => confirm(tr("'{name}' 단계를 삭제할까요? 작업은 지워지지 않고 '단계 없음'이 됩니다.", { name: p.name })) && call(() => api.del(`/projects/${project.id}/phases/${p.id}`))}>{tr('삭제')}</button></>}</td>
        </tr>))}</tbody></table>
      {ed && <div className="toolbar" style={{ marginTop: 10 }}>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={tr('새 단계 이름')} />
        <button className="btn primary" onClick={() => name.trim() && call(async () => { await api.post(`/projects/${project.id}/phases`, { name, color: PALETTE[phases.length % PALETTE.length] }); setName(''); })}>{tr('추가')}</button>
      </div>}
    </div>
  );
}

// 칸반 열: 이름·색·놓았을 때 바뀌는 상태·순서
function BoardColumns() {
  const { project, columns, can, reload } = useProject();
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const ed = can('pm');
  const url = `/projects/${project.id}/columns`;
  const call = async fn => { try { await fn(); await reload(); setErr(null); } catch (e) { setErr(e.message); } };
  const move = (c, dir) => {
    const ids = columns.map(x => x.id), i = ids.indexOf(c.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    call(() => api.put(`/projects/${project.id}/columns-order`, { ids }));
  };
  return (
    <div className="card"><h3>{tr('칸반 열')} <span className="small">{tr('카드를 이 열에 놓으면 작업 상태가 오른쪽 상태로 바뀝니다.')}</span></h3>
      {err && <div className="err">{err}</div>}
      <table><thead><tr><th /><th>{tr('열 이름')}</th><th>{tr('놓으면 상태')}</th><th title={tr('검토 열: 2단계에서 검토자 알림·승인/반려와 연결됩니다.')}>{tr('검토')}</th><th /></tr></thead>
        <tbody>{columns.map((c, i) => (
          <tr key={c.id}>
            <td style={{ width: 40 }}>{ed ? <input type="color" value={c.color || '#8a93a6'} onChange={e => call(() => api.patch(`${url}/${c.id}`, { color: e.target.value }))} style={{ width: 30, padding: 0, border: 0 }} /> : <span className="dot" style={{ background: c.color }} />}</td>
            <td>{ed ? <input type="text" defaultValue={tr(c.name)} onBlur={e => e.target.value.trim() && e.target.value !== tr(c.name) && call(() => api.patch(`${url}/${c.id}`, { name: e.target.value }))} /> : <Tx>{tr(c.name)}</Tx>}</td>
            <td>{ed ? <select value={c.status} onChange={e => call(() => api.patch(`${url}/${c.id}`, { status: e.target.value }))}>{TASK_STATUS.map(x => <option key={x} value={x}>{tr(statusLabel(x))}</option>)}</select> : tr(statusLabel(c.status))}</td>
            <td><input type="checkbox" checked={!!c.is_review} disabled={!ed} onChange={e => call(() => api.patch(`${url}/${c.id}`, { is_review: e.target.checked }))} /></td>
            <td className="nw">{ed && <>
              <button className="btn sm" onClick={() => move(c, -1)} disabled={i === 0}>←</button> <button className="btn sm" onClick={() => move(c, 1)} disabled={i === columns.length - 1}>→</button>{' '}
              <button className="btn sm danger" disabled={columns.length <= 1} onClick={() => confirm(tr("'{name}' 열을 삭제할까요? 카드는 지워지지 않고 상태가 같은 다른 열로 옮겨집니다.", { name: tr(c.name) })) && call(() => api.del(`${url}/${c.id}`))}>{tr('삭제')}</button></>}</td>
          </tr>))}</tbody></table>
      {ed && <div className="toolbar" style={{ marginTop: 10 }}>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={tr('새 열 이름 (예: 보류, 발주처 확인)')} />
        <button className="btn primary" onClick={() => name.trim() && call(async () => { await api.post(url, { name, status: '진행중', color: PALETTE[columns.length % PALETTE.length] }); setName(''); })}>{tr('추가')}</button>
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
      if (dry) setPreview(r); else { setPreview(null); setFiles([]); await reload(); toast(tr('불러오기 완료: 작업 {a}건 추가·{b}건 갱신, 이슈 {c}건 추가·{d}건 갱신', { a: r.tasksAdded, b: r.tasksUpdated, c: r.issuesAdded, d: r.issuesUpdated })); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card"><h3>{tr('엑셀 불러오기 · 내보내기')}</h3>
      <p className="small">{tr('불러오기: 계약 일정 통합본(Detail 시트), 일정표·이슈로그, 또는 이 프로그램에서 내보낸 파일. ID(이슈 No)가 같은 항목은 갱신하고 없는 항목은 추가합니다. 기존 데이터는 지우지 않습니다.')}</p>
      {err && <div className="err">{err}</div>}
      {can('pm') ? <>
        <div className="toolbar"><input type="file" accept=".xlsx,.xlsm,.xls" multiple onChange={e => { setFiles([...e.target.files]); setPreview(null); }} />
          <button className="btn" disabled={!files.length || busy} onClick={() => send(true)}>{tr('미리 보기')}</button></div>
        {preview && <div className="ok">
          <div>{tr('인식한 시트:')} {preview.sheets.join(', ')}</div>
          <div>{tr('단계 +')}{preview.phases} {tr('· 작업 +')}{preview.tasksAdded} {tr('/ 갱신')} {preview.tasksUpdated} {tr('· 선행관계')} {preview.deps}{tr('건 · 이슈 +')}{preview.issuesAdded} {tr('/ 갱신')} {preview.issuesUpdated} {tr('· 공휴일 +')}{preview.holidays}</div>
          {preview.phasesRemoved > 0 && <div className="small">{tr('파일에 없는 빈 기본 단계 {n}개는 지웁니다.', { n: preview.phasesRemoved })}</div>}
          {preview.dayBasis === 'calendar' && <div>{tr('계약 일정 엑셀이 달력일 기준이라 이 프로젝트의 계산 기준을 ‘달력일’로 맞춥니다.')}</div>}
          {preview.depsSkipped.length > 0 && <div>{tr('대상 작업이 없어 건너뛸 선행관계:')} {preview.depsSkipped.slice(0, 8).join(', ')}{preview.depsSkipped.length > 8 ? ' ' + tr('외 {n}건', { n: preview.depsSkipped.length - 8 }) : ''}</div>}
          <div>{preview.shifted ? tr('엑셀 날짜가 선행관계 규칙과 다른 작업 {n}건이 있습니다.', { n: preview.shifted }) : tr('엑셀 날짜가 선행관계 규칙과 모두 일치합니다.')}</div>
          {preview.shifted > 0 && <label className="small"><input type="checkbox" checked={recalc} onChange={e => setRecalc(e.target.checked)} /> {tr('불러온 뒤 선행관계 규칙대로 날짜 다시 계산 (끄면 엑셀 날짜 그대로)')}</label>}
          <div className="actions" style={{ marginTop: 6 }}><button className="btn primary" disabled={busy} onClick={() => send(false)}>{tr('불러오기 실행')}</button></div>
        </div>}
      </> : <p className="small">{tr('불러오기는 PM만 할 수 있습니다.')}</p>}
      <div className="toolbar" style={{ marginTop: 10 }}><a className="btn" href={`/api/projects/${project.id}/export.xlsx`}>{tr('엑셀로 내보내기 (작업·이슈)')}</a></div>
    </div>
  );
}

function Baseline() {
  const { project, tasks, reload, toast, baselines, can, baseSel, setBaseSel } = useProject();
  const missing = tasks.filter(t => !t.baseline_end).length;
  const slipped = tasks.filter(t => t.baseline_end && t.end > t.baseline_end).length;
  const pm = can('pm');
  const fill = async () => {
    const r = await api.post(`/projects/${project.id}/baseline`, { onlyMissing: true });
    await reload(); toast(tr('기준 일정 {n}건 저장', { n: r.updated }));
  };
  const save = async () => {
    const name = window.prompt(tr('새 기준선 이름 (예: 최초 계획, 1차 변경 승인)'), tr('기준선') + ' ' + (baselines.length + 1));
    if (name == null) return;
    try { const r = await api.post(`/projects/${project.id}/baselines`, { name }); await reload(); toast(tr('기준선 ‘{name}’을 저장했습니다. ({n}건)', { name: r.name, n: r.count })); }
    catch (e) { toast(e.message); }
  };
  const del = async b => {
    if (!confirm(tr('기준선 ‘{name}’을 지울까요? 작업 일정은 바뀌지 않습니다.', { name: b.name }))) return;
    try { await api.del(`/projects/${project.id}/baselines/${b.id}`); if (baseSel === b.id) setBaseSel(0); await reload(); }
    catch (e) { toast(e.message); }
  };
  return (
    <div className="card"><h3>{tr('기준 일정 (Baseline)')}</h3>
      <p className="small">{tr('기준 일정은 합의한 일정입니다. 날짜가 바뀌면 간트·작업 목록·대시보드에 기준선 대비 차이(일)가 표시됩니다. 변경 승인 때마다 새 기준선으로 저장하면 이전 기준선은 버전으로 남아 간트의 ‘기준선’ 메뉴에서 비교할 수 있습니다.')}</p>
      <p>{tr('기준보다 늦어진 작업')} <b style={{ color: slipped ? 'var(--late)' : undefined }}>{slipped}</b>{tr('건 · 기준 일정이 없는 작업')} {missing}{tr('건')}</p>
      {pm && <div className="toolbar">
        <button className="btn" disabled={!missing} onClick={fill}>{tr('빈 작업만 현재 일정으로 채우기')}</button>
        <button className="btn primary" onClick={save}>{tr('+ 지금 일정을 기준선으로 저장')}</button>
      </div>}
      <div className="list">
        {baselines.map(b => <div key={b.id} className="item"><div className="main"><div className="t">{b.name}</div><div className="small">{b.created_at.slice(0, 10)} · {b.count}{tr('건')}</div></div>
          {pm && <button className="btn sm danger" onClick={() => del(b)}>{tr('삭제')}</button>}</div>)}
        {!baselines.length && <div className="empty">{tr('저장한 기준선 버전이 없습니다.')}</div>}
      </div>
    </div>
  );
}
