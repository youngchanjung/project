// 회의록: 목록 / 새 회의록(녹음·파일 올리기·메모) / 회의록 보기(AI 정리, 전사본, 메모)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { today } from '../util.js';
import { tr, getLang, locale } from '../i18n.js';
import { Tx } from '../contentTr.jsx';
import Recorder from '../components/Recorder.jsx';

const LANG_OPT = [['ko', '한국어'], ['vi', '베트남어'], ['en', '영어'], ['multi', '여러 언어 섞임']];
const STATUS = {
  draft: ['메모', 'b-예정'], uploaded: ['녹음만', 'b-예정'], transcribing: ['음성인식 중', 'b-진행중'],
  transcribed: ['전사 완료', 'b-임박'], summarizing: ['AI 정리 중', 'b-진행중'], done: ['정리 완료', 'b-완료'], error: ['오류', 'b-지연']
};
const BUSY = ['transcribing', 'summarizing'];
const fmtDT = s => (s ? new Date(s.length === 10 ? s + 'T00:00' : s).toLocaleString(locale(), { dateStyle: 'medium', ...(s.length > 10 ? { timeStyle: 'short' } : {}) }) : '');
const fmtDur = ms => { if ((ms || 0) < 60000) return tr('{s}초', { s: Math.round((ms || 0) / 1000) }); const m = Math.round(ms / 60000); return m >= 60 ? tr('{h}시간 {m}분', { h: Math.floor(m / 60), m: m % 60 }) : tr('{m}분', { m }); };
const mmss = ms => { const s = Math.floor((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const Badge = ({ s }) => <span className={`badge ${STATUS[s]?.[1] || ''}`}>{tr(STATUS[s]?.[0] || s)}</span>;

export function useMeetingCaps() {
  const [caps, setCaps] = useState(null);
  useEffect(() => { api.get('/meetings/status').then(setCaps).catch(() => setCaps({ stt: false, ai: false, formats: [] })); }, []);
  return caps;
}

export default function Meetings() {
  return (
    <Routes>
      <Route index element={<MeetingList />} />
      <Route path="new" element={<NewMeeting />} />
      <Route path=":mid" element={<MeetingView />} />
    </Routes>
  );
}

function MeetingList() {
  const { project, can } = useProject();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const load = useCallback(() => api.get(`/projects/${project.id}/meetings`).then(setRows), [project.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (rows?.some(r => BUSY.includes(r.status))) { const t = setTimeout(load, 5000); return () => clearTimeout(t); } }, [rows, load]);
  if (!rows) return <div className="loading">{tr('불러오는 중…')}</div>;
  const list = rows.filter(r => !q || [r.title, r.attendees, r.summary?.summary].join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder={tr('회의록 검색')} value={q} onChange={e => setQ(e.target.value)} />
        <span className="small">{list.length}{tr('건')}</span>
        <div className="sp" />
        {can() && <button className="btn primary" onClick={() => nav('new')}>{tr('+ 새 회의록')}</button>}
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>{tr('회의 일시')}</th><th>{tr('제목')}</th><th>{tr('요약')}</th><th>{tr('할 일')}</th><th>{tr('길이')}</th><th>{tr('작성')}</th><th>{tr('상태')}</th></tr></thead>
        <tbody>{list.map(r => (
          <tr key={r.id} className="click" onClick={() => nav(String(r.id))}>
            <td className="nw">{fmtDT(r.held_at)}</td>
            <td><b>{r.title}</b><div className="small">{r.attendees}</div></td>
            <td className="small" style={{ maxWidth: 520 }}><Tx>{r.summary?.summary?.slice(0, 160)}</Tx></td>
            <td className="nw">{r.summary ? r.summary.action_items.length : ''}</td>
            <td className="nw">{r.duration_ms ? fmtDur(r.duration_ms) : ''}</td>
            <td className="nw small">{r.created_by_name}</td>
            <td className="nw"><Badge s={r.status} /></td>
          </tr>))}
          {!list.length && <tr><td colSpan={7} className="empty">{tr('회의록이 없습니다. "+ 새 회의록"에서 녹음하거나 녹음 파일을 올리세요.')}</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function NewMeeting() {
  const { project, members, toast } = useProject();
  const caps = useMeetingCaps();
  const nav = useNavigate();
  const lang0 = getLang() === 'vi' ? 'vi' : getLang() === 'en' ? 'en' : 'ko';
  const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const [f, setF] = useState({ title: '', held_at: nowLocal(), attendees: '', language: lang0, notes: '' });
  const [file, setFile] = useState(null);
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => fileUrl && URL.revokeObjectURL(fileUrl), [fileUrl]);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const pickFile = e => {
    const x = e.target.files[0];
    if (!x) return;
    const ext = x.name.slice(x.name.lastIndexOf('.')).toLowerCase();
    if (caps && !caps.formats.includes(ext)) { setErr(tr('녹음 파일은 {f} 형식만 올릴 수 있습니다.', { f: caps.formats.join(', ') })); e.target.value = ''; return; }
    setErr(null); setFile(x);
  };
  const save = () => {
    if (!f.title.trim()) { setErr(tr('회의 제목을 입력하세요.')); return; }
    setErr(null); setBusy(true); setPct(0);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    if (file) fd.append('audio', file, file.name);
    // 큰 녹음 파일 올리는 진행률을 보여주려고 XHR 사용
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${project.id}/meetings`);
    xhr.setRequestHeader('X-Lang', getLang());
    xhr.upload.onprogress = e => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setBusy(false);
      let d = null; try { d = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 400) { setErr(d?.error || tr('요청 실패 ({n})', { n: xhr.status })); return; }
      toast(tr('회의록을 저장했습니다.'));
      nav(`../${d.id}`, { replace: true });
    };
    xhr.onerror = () => { setBusy(false); setErr(tr('파일을 올리지 못했습니다. 네트워크를 확인하세요.')); };
    xhr.send(fd);
  };
  return (
    <div className="card" style={{ maxWidth: 880 }}>
      <h3>{tr('새 회의록')} <Link to=".." className="small">{tr('목록으로')}</Link></h3>
      {caps && !caps.stt && <div className="small" style={{ marginBottom: 8 }}>ⓘ {tr('음성인식(리턴제로) 키가 설정되지 않아 녹음은 파일로만 보관됩니다.')}</div>}
      {caps && !caps.ai && <div className="small" style={{ marginBottom: 8 }}>ⓘ {tr('AI 정리(Claude) 키가 설정되지 않아 자동 정리는 꺼져 있습니다.')}</div>}
      {err && <div className="err">{err}</div>}
      <div className="form">
        <label>{tr('회의 제목 *')}</label><input type="text" value={f.title} onChange={set('title')} autoFocus placeholder={tr('예: 주간 공정 회의')} />
        <label>{tr('회의 일시')}</label><input type="datetime-local" value={f.held_at} onChange={set('held_at')} style={{ width: 220 }} />
        <label>{tr('참석자')}</label>
        <div><input type="text" list="mt-members" value={f.attendees} onChange={set('attendees')} placeholder={tr('쉼표로 구분')} style={{ width: '100%' }} />
          <datalist id="mt-members">{members.map(m => <option key={m.id} value={f.attendees ? `${f.attendees.replace(/,?\s*$/, '')}, ${m.name}` : m.name} />)}</datalist></div>
        <label>{tr('회의 언어')}</label>
        <select value={f.language} onChange={set('language')} style={{ width: 220 }}>{LANG_OPT.map(([k, n]) => <option key={k} value={k}>{tr(n)}</option>)}</select>
        <label>{tr('녹음')}</label>
        <div>
          {!file && <Recorder onDone={setFile} disabled={busy} />}
          {file && <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <audio controls src={fileUrl} style={{ height: 34 }} />
            <span className="small">{file.name} · {(file.size / 1048576).toFixed(1)}MB</span>
            <button className="btn sm" type="button" onClick={() => setFile(null)} disabled={busy}>{tr('지우기')}</button>
          </div>}
          {!file && <div className="small" style={{ marginTop: 8 }}>{tr('또는 녹음 파일 올리기')} ({caps?.formats?.join(', ')}): <input type="file" accept={caps?.formats?.join(',')} onChange={pickFile} /></div>}
        </div>
        <label>{tr('메모')}</label><textarea value={f.notes} onChange={set('notes')} placeholder={tr('녹음 없이 메모만 적어도 AI가 정리할 수 있습니다.')} />
      </div>
      <div className="actions">
        {busy && file && <span className="small" style={{ marginRight: 'auto' }}>{tr('올리는 중… {n}%', { n: pct })}</span>}
        <button className="btn" onClick={() => nav('..')} disabled={busy}>{tr('취소')}</button>
        <button className="btn primary" onClick={save} disabled={busy}>{tr(file && caps?.stt ? '저장하고 음성인식 시작' : '저장')}</button>
      </div>
    </div>
  );
}

function MeetingView() {
  const { mid } = useParams();
  const { project, can, toast, openTask, openIssue, members } = useProject();
  const caps = useMeetingCaps();
  const nav = useNavigate();
  const [m, setM] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('sum');
  const [edit, setEdit] = useState(null); // 정리 결과 편집 중인 사본
  const [info, setInfo] = useState(null); // 기본 정보 편집 중
  const [sumLang, setSumLang] = useState(getLang());
  const url = `/projects/${project.id}/meetings/${mid}`;
  const load = useCallback(() => api.get(url).then(x => { setM(x); setErr(null); }).catch(e => setErr(e.message)), [url]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (m && BUSY.includes(m.status)) { const t = setTimeout(load, 4000); return () => clearTimeout(t); } }, [m, load]);
  useEffect(() => { if (m && !m.summary && m.transcript?.length && tab === 'sum') setTab('tr'); }, [m?.id]); // eslint-disable-line

  if (err && !m) return <div className="err">{err}</div>;
  if (!m) return <div className="loading">{tr('불러오는 중…')}</div>;
  const editable = can();
  const busy = BUSY.includes(m.status);
  const patch = async body => {
    try { const x = await api.patch(url, { ...body, version: m.version }); setM({ ...m, ...x }); return true; }
    catch (e) { setErr(e.message); if (e.status === 409) load(); return false; }
  };
  const act = async (path, body) => { setErr(null); try { await api.post(`${url}/${path}`, body); await load(); } catch (e) { setErr(e.message); } };
  const remove = async () => {
    if (!confirm(tr('"{t}" 회의록을 삭제할까요? 녹음 파일도 함께 지워집니다.', { t: m.title }))) return;
    try { await api.del(url); toast(tr('삭제했습니다.')); nav('..'); } catch (e) { setErr(e.message); }
  };
  const s = m.summary;
  const src = `${tr('회의록')}: ${m.title}${m.held_at ? ` (${m.held_at.slice(0, 10)})` : ''}`;
  const memberId = name => members.find(x => name && (x.name === name || name.includes(x.name)))?.id || '';
  // 회의록의 할 일 → 할 일(칸반 첫 열). 기한이 없으면 날짜 없는 할 일로
  const validDue = d => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '');
  const asTask = a => openTask(null, { name: a.task.slice(0, 300), owner: a.owner, assignee_id: memberId(a.owner), start: validDue(a.due), end: validDue(a.due), note: src });
  const allAsTasks = async items => {
    if (!confirm(tr('할 일 {n}건을 한 번에 등록할까요?', { n: items.length }))) return;
    try {
      for (const a of items) await api.post(`/projects/${project.id}/tasks`, { name: a.task.slice(0, 300), owner: a.owner || null, assignee_id: memberId(a.owner) || null, start: validDue(a.due) || null, end: validDue(a.due) || null, note: src });
      toast(tr('할 일 {n}건을 등록했습니다. 칸반·할 일 목록에서 볼 수 있습니다.', { n: items.length }));
    } catch (e) { toast(e.message); }
  };
  const asIssue = i => openIssue(null, { title: i.title.slice(0, 300), detail: i.detail, priority: i.priority, source: src, raised: m.held_at?.slice(0, 10) || today() });

  return (
    <>
      <div className="toolbar">
        <Link to=".." className="btn sm">← {tr('목록')}</Link>
        <h2 style={{ margin: 0, fontSize: 17.5 }}>{m.title}</h2>
        <Badge s={m.status} />
        <span className="small">{[fmtDT(m.held_at), m.duration_ms ? fmtDur(m.duration_ms) : '', m.created_by_name].filter(Boolean).join(' · ')}</span>
        <div className="sp" />
        {editable && <button className="btn sm" onClick={() => setInfo({ title: m.title, held_at: m.held_at || '', attendees: m.attendees || '', language: m.language })}>{tr('정보 수정')}</button>}
        <button className="btn sm" onClick={() => download(m)}>{tr('텍스트로 내려받기')}</button>
        {editable && <button className="btn sm danger" onClick={remove}>{tr('삭제')}</button>}
      </div>
      {err && <div className="err">{err}</div>}
      {m.error && !busy && <div className="err">{tr('처리 중 오류')}: {m.error}</div>}
      {busy && <div className="card" style={{ marginBottom: 12 }}>⏳ {m.status === 'transcribing' ? tr('음성을 글로 바꾸는 중입니다. 회의 길이에 따라 몇 분에서 수십 분 걸리며, 다른 화면으로 이동해도 계속 진행됩니다.') : tr('AI가 회의 내용을 정리하는 중입니다. 보통 1~2분 걸립니다.')}</div>}

      {info && <div className="card" style={{ marginBottom: 12 }}><div className="form">
        <label>{tr('회의 제목 *')}</label><input type="text" value={info.title} onChange={e => setInfo({ ...info, title: e.target.value })} />
        <label>{tr('회의 일시')}</label><input type="datetime-local" value={info.held_at} onChange={e => setInfo({ ...info, held_at: e.target.value })} style={{ width: 220 }} />
        <label>{tr('참석자')}</label><input type="text" value={info.attendees} onChange={e => setInfo({ ...info, attendees: e.target.value })} />
        <label>{tr('회의 언어')}</label><select value={info.language} onChange={e => setInfo({ ...info, language: e.target.value })} style={{ width: 220 }}>{LANG_OPT.map(([k, n]) => <option key={k} value={k}>{tr(n)}</option>)}</select>
      </div><div className="actions"><button className="btn" onClick={() => setInfo(null)}>{tr('취소')}</button><button className="btn primary" onClick={async () => { if (await patch(info)) setInfo(null); }}>{tr('저장')}</button></div>
        {m.has_audio && info.language !== m.language && <div className="small">{tr('언어를 바꿨으면 저장 후 "음성인식 다시 하기"를 누르세요.')}</div>}</div>}

      <div className="toolbar">
        {m.has_audio && <audio controls preload="none" src={`/api${url}/audio`} style={{ height: 34 }} />}
        <div className="sp" />
        {editable && m.has_audio && caps?.stt && !busy && <button className="btn sm" onClick={() => confirm(tr('음성인식을 다시 할까요? 지금 전사본은 새 결과로 바뀝니다.')) && act('transcribe')}>{tr(m.transcript?.length ? '음성인식 다시 하기' : '음성인식 시작')}</button>}
        {editable && caps?.ai && !busy && (m.transcript?.length > 0 || m.notes?.trim()) && <>
          <select value={sumLang} onChange={e => setSumLang(e.target.value)} title={tr('정리 결과를 쓸 언어')}>{[['ko', '한국어'], ['vi', 'Tiếng Việt'], ['en', 'English']].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          <button className="btn sm primary" onClick={() => (!s || confirm(tr('AI 정리를 다시 할까요? 직접 고친 정리 내용은 새 결과로 바뀝니다.'))) && act('summarize', { lang: sumLang })}>{tr(s ? 'AI 다시 정리' : 'AI 정리')}</button>
        </>}
      </div>

      <nav className="tabs">
        {[['sum', tr('AI 정리')], ['tr', `${tr('전사본')}${m.transcript?.length ? ` (${m.transcript.length})` : ''}`], ['notes', tr('메모')]].map(([k, n]) =>
          <a key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)} style={{ cursor: 'pointer' }}>{n}</a>)}
      </nav>

      {tab === 'sum' && (edit
        ? <SummaryEditor value={edit} onChange={setEdit} onCancel={() => setEdit(null)} onSave={async () => { if (await patch({ summary: edit })) { setEdit(null); toast(tr('저장했습니다.')); } }} />
        : s ? <SummaryView s={s} editable={editable} onEdit={() => setEdit(JSON.parse(JSON.stringify(s)))} asTask={asTask} allAsTasks={allAsTasks} asIssue={asIssue} />
          : <div className="empty">{busy ? '' : caps?.ai ? tr('아직 정리되지 않았습니다. 위의 "AI 정리"를 누르세요.') : tr('AI 정리(Claude) 키가 설정되지 않아 자동 정리는 꺼져 있습니다.')}</div>)}
      {tab === 'tr' && <Transcript m={m} editable={editable} onSpeakers={sp => patch({ speakers: sp })} />}
      {tab === 'notes' && <Notes m={m} editable={editable} onSave={notes => patch({ notes })} />}
    </>
  );
}

function SummaryView({ s, editable, onEdit, asTask, allAsTasks, asIssue }) {
  return (
    <div className="grid2">
      <div className="card">
        <h3>{tr('요약')} {editable && <button className="btn sm" onClick={onEdit}>{tr('정리 내용 고치기')}</button>}</h3>
        <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}><Tx>{s.summary}</Tx></p>
        {s.topics.map((t, i) => <div key={i} style={{ marginTop: 10 }}><b><Tx>{t.title}</Tx></b><ul className="mt-ul">{t.points.map((p, j) => <li key={j}><Tx>{p}</Tx></li>)}</ul></div>)}
        {s.next_meeting && <div style={{ marginTop: 10 }}><b>{tr('다음 회의')}</b>: <Tx>{s.next_meeting}</Tx></div>}
        {s._model && <div className="small" style={{ marginTop: 12 }}>{tr('AI가 정리한 내용입니다. 중요한 내용은 녹음·전사본과 대조해 확인하세요.')}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card"><h3>{tr('결정 사항')} <span className="small">{s.decisions.length}</span></h3>
          {s.decisions.length ? <ul className="mt-ul">{s.decisions.map((d, i) => <li key={i}><Tx>{d}</Tx></li>)}</ul> : <div className="empty">{tr('(없음)')}</div>}</div>
        <div className="card"><h3>{tr('할 일')} <span className="small">{s.action_items.length}</span>{editable && s.action_items.length > 1 && <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => allAsTasks(s.action_items)}>{tr('모두 할 일로 등록')}</button>}</h3>
          <div className="list">{s.action_items.map((a, i) => (
            <div key={i} className="item" style={{ cursor: 'default' }}>
              <div className="main"><Tx>{a.task}</Tx><div className="small">{[a.owner, a.due].filter(Boolean).join(' · ') || tr('담당·기한 미정')}</div></div>
              {editable && <button className="btn sm" onClick={() => asTask(a)}>{tr('할 일로 등록')}</button>}
            </div>))}
            {!s.action_items.length && <div className="empty">{tr('(없음)')}</div>}</div></div>
        <div className="card"><h3>{tr('이슈')} <span className="small">{s.issues.length}</span></h3>
          <div className="list">{s.issues.map((x, i) => (
            <div key={i} className="item" style={{ cursor: 'default' }}>
              <span className={`badge ${x.priority === '상' ? 'b-지연' : x.priority === '중' ? 'b-임박' : 'b-예정'}`}>{tr(x.priority)}</span>
              <div className="main"><Tx>{x.title}</Tx><div className="small"><Tx>{x.detail}</Tx></div></div>
              {editable && <button className="btn sm" onClick={() => asIssue(x)}>{tr('이슈로 등록')}</button>}
            </div>))}
            {!s.issues.length && <div className="empty">{tr('(없음)')}</div>}</div></div>
      </div>
    </div>
  );
}

// 정리 결과 고치기: 목록은 한 줄에 하나씩
function SummaryEditor({ value: v, onChange, onSave, onCancel }) {
  const lines = a => a.join('\n');
  const split = t => t.split('\n').map(x => x.trim()).filter(Boolean);
  const setItem = (key, i, k) => e => onChange({ ...v, [key]: v[key].map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) });
  const delItem = (key, i) => onChange({ ...v, [key]: v[key].filter((_, j) => j !== i) });
  return (
    <div className="card">
      <div className="form">
        <label>{tr('요약')}</label><textarea value={v.summary} onChange={e => onChange({ ...v, summary: e.target.value })} style={{ minHeight: 110 }} />
        <label>{tr('결정 사항')}</label><textarea value={lines(v.decisions)} onChange={e => onChange({ ...v, decisions: e.target.value.split('\n') })} onBlur={e => onChange({ ...v, decisions: split(e.target.value) })} placeholder={tr('한 줄에 하나씩')} />
        <label>{tr('할 일')}</label>
        <div>{v.action_items.map((a, i) => <div key={i} className="row" style={{ gap: 6, marginBottom: 4 }}>
          <input type="text" value={a.task} onChange={setItem('action_items', i, 'task')} style={{ flex: 1 }} />
          <input type="text" value={a.owner} onChange={setItem('action_items', i, 'owner')} placeholder={tr('담당')} style={{ width: 110 }} />
          <input type="date" value={a.due} onChange={setItem('action_items', i, 'due')} />
          <button className="btn sm" onClick={() => delItem('action_items', i)}>×</button></div>)}
          <button className="btn sm" onClick={() => onChange({ ...v, action_items: [...v.action_items, { task: '', owner: '', due: '' }] })}>{tr('+ 할 일')}</button></div>
        <label>{tr('이슈')}</label>
        <div>{v.issues.map((x, i) => <div key={i} className="row" style={{ gap: 6, marginBottom: 4 }}>
          <select value={x.priority} onChange={setItem('issues', i, 'priority')}>{['상', '중', '하'].map(p => <option key={p} value={p}>{tr(p)}</option>)}</select>
          <input type="text" value={x.title} onChange={setItem('issues', i, 'title')} style={{ flex: 1 }} />
          <input type="text" value={x.detail} onChange={setItem('issues', i, 'detail')} placeholder={tr('상세')} style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => delItem('issues', i)}>×</button></div>)}
          <button className="btn sm" onClick={() => onChange({ ...v, issues: [...v.issues, { title: '', detail: '', priority: '중' }] })}>{tr('+ 이슈')}</button></div>
        <label>{tr('다음 회의')}</label><input type="text" value={v.next_meeting} onChange={e => onChange({ ...v, next_meeting: e.target.value })} />
      </div>
      <div className="actions"><button className="btn" onClick={onCancel}>{tr('취소')}</button>
        <button className="btn primary" onClick={() => { v.decisions = v.decisions.filter(x => x.trim()); v.action_items = v.action_items.filter(a => a.task.trim()); v.issues = v.issues.filter(x => x.title.trim()); onSave(); }}>{tr('저장')}</button></div>
    </div>
  );
}

function Transcript({ m, editable, onSpeakers }) {
  const spks = useMemo(() => [...new Set((m.transcript || []).map(u => u.spk))].sort((a, b) => a - b), [m.transcript]);
  const [names, setNames] = useState(m.speakers || {});
  const [q, setQ] = useState('');
  useEffect(() => setNames(m.speakers || {}), [m.speakers]);
  if (!m.transcript?.length) return <div className="empty">{tr('전사본이 없습니다.')}</div>;
  const name = k => m.speakers?.[k] || tr('화자{n}', { n: k + 1 });
  const seek = t => { const a = document.querySelector('audio'); if (a) { a.currentTime = t / 1000; a.play(); } };
  const lines = m.transcript.filter(u => !q || u.text.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="toolbar">
        {editable && spks.length > 0 && <>
          <span className="small">{tr('화자 이름')}:</span>
          {spks.map(k => <input key={k} type="text" value={names[k] || ''} placeholder={tr('화자{n}', { n: k + 1 })} onChange={e => setNames({ ...names, [k]: e.target.value })} style={{ width: 110 }} />)}
          <button className="btn sm" onClick={() => onSpeakers(names)}>{tr('이름 저장')}</button>
        </>}
        <div className="sp" />
        <input type="search" placeholder={tr('전사본 검색')} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="card transcript">{lines.map((u, i) => (
        <div key={i} className="tline">
          <a className="small nw" onClick={() => seek(u.t)} title={tr('이 부분 듣기')}>{mmss(u.t)}</a>
          <b className={`spk spk${u.spk % 6}`}>{name(u.spk)}</b>
          <span>{u.text}</span>
        </div>))}</div>
    </>
  );
}

function Notes({ m, editable, onSave }) {
  const [v, setV] = useState(m.notes || '');
  const dirty = v !== (m.notes || '');
  return (
    <div className="card">
      <textarea value={v} onChange={e => setV(e.target.value)} readOnly={!editable} style={{ minHeight: 260 }} placeholder={tr('회의 중 적은 메모, 보충 내용 등. AI 정리할 때 함께 읽습니다.')} />
      {editable && <div className="actions"><button className="btn primary" disabled={!dirty} onClick={() => onSave(v)}>{tr('저장')}</button></div>}
    </div>
  );
}

function download(m) {
  const s = m.summary;
  const name = k => m.speakers?.[k] || `${tr('화자{n}', { n: k + 1 })}`;
  const L = [`# ${m.title}`, `${tr('회의 일시')}: ${fmtDT(m.held_at)}`, `${tr('참석자')}: ${m.attendees || ''}`, ''];
  if (s) {
    L.push(`## ${tr('요약')}`, s.summary, '');
    for (const t of s.topics) L.push(`### ${t.title}`, ...t.points.map(p => `- ${p}`), '');
    L.push(`## ${tr('결정 사항')}`, ...s.decisions.map(d => `- ${d}`), '');
    L.push(`## ${tr('할 일')}`, ...s.action_items.map(a => `- ${a.task}${a.owner ? ` (${a.owner}${a.due ? `, ${a.due}` : ''})` : a.due ? ` (${a.due})` : ''}`), '');
    L.push(`## ${tr('이슈')}`, ...s.issues.map(x => `- [${x.priority}] ${x.title}${x.detail ? `: ${x.detail}` : ''}`), '');
    if (s.next_meeting) L.push(`## ${tr('다음 회의')}`, s.next_meeting, '');
  }
  if (m.notes?.trim()) L.push(`## ${tr('메모')}`, m.notes, '');
  if (m.transcript?.length) L.push(`## ${tr('전사본')}`, ...m.transcript.map(u => `[${mmss(u.t)}] ${name(u.spk)}: ${u.text}`));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' }));
  a.download = `${m.held_at?.slice(0, 10) || ''}_${m.title}.md`.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
