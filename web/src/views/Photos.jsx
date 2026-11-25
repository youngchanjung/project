import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { fileUrl, uploadFiles, Lightbox } from '../components/Attachments.jsx';
import DateInput from '../components/DateInput.jsx';
import { fmtYW, today } from '../util.js';
import { tr } from '../i18n.js';

// 현장 사진: 프로젝트의 사진·첨부를 촬영일별로 모아 봄. 작업·이슈에 붙인 것과 따로 올린 것 모두
export default function Photos() {
  const { project, tasks, issues, can, toast, openTask, openIssue } = useProject();
  const ed = can() && !project.archived;
  const [list, setList] = useState(null);
  const [kind, setKind] = useState('photo'); // photo | file | all
  const [q, setQ] = useState('');
  const [taskId, setTaskId] = useState('');
  const [up, setUp] = useState({ task_id: '', note: '', taken_on: today() });
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const pick = useRef(null), cam = useRef(null);
  const load = () => api.get(`/projects/${project.id}/attachments`).then(setList).catch(e => toast(e.message));
  useEffect(() => { load(); }, [project.id]); // eslint-disable-line

  const taskOf = id => tasks.find(t => t.id === id), issueOf = id => issues.find(i => i.id === id);
  const send = async files => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const r = await uploadFiles(project.id, [...files], { task_id: up.task_id, note: up.note.trim(), taken_on: up.taken_on });
      toast(tr('{n}개를 올렸습니다.', { n: r.length })); setUp({ ...up, note: '' }); await load();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const del = async a => {
    if (!confirm(tr('‘{name}’을(를) 지울까요?', { name: a.name }))) return;
    try { await api.del(`/projects/${project.id}/attachments/${a.id}`); setView(null); await load(); } catch (e) { toast(e.message); }
  };

  const ql = q.trim().toLowerCase();
  const shown = (list || []).filter(a => kind === 'all' || (kind === 'photo' ? a.image : !a.image))
    .filter(a => !taskId || String(a.task_id || '') === taskId)
    .filter(a => !ql || [a.name, a.note, taskOf(a.task_id)?.name, taskOf(a.task_id)?.code, issueOf(a.issue_id)?.title].join(' ').toLowerCase().includes(ql));
  const days = [];
  for (const a of shown) { const d = days.at(-1); if (d?.date === a.taken_on) d.items.push(a); else days.push({ date: a.taken_on, items: [a] }); }
  const photos = shown.filter(a => a.image);
  const label = a => {
    const t = taskOf(a.task_id), i = issueOf(a.issue_id);
    return t ? `${t.code ? t.code + ' ' : ''}${t.name}` : i ? `${tr('이슈')} ${i.code} ${i.title}` : '';
  };
  const usedTasks = [...new Set((list || []).map(a => a.task_id).filter(Boolean))].map(taskOf).filter(Boolean).sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));

  return (
    <>
      <div className="toolbar">
        <div className="seg">{[['photo', '사진'], ['file', '문서·파일'], ['all', '전체']].map(([k, n]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{tr(n)}</button>)}</div>
        <select value={taskId} onChange={e => setTaskId(e.target.value)}><option value="">{tr('작업 전체')}</option>{usedTasks.map(t => <option key={t.id} value={t.id}>{t.code ? t.code + ' ' : ''}{t.name}</option>)}</select>
        <input type="search" placeholder={tr('설명·파일 이름·작업 검색')} value={q} onChange={e => setQ(e.target.value)} />
        <span className="small">{tr('{n}개', { n: shown.length })}</span>
      </div>
      {ed && <div className="card" style={{ marginBottom: 10 }}>
        <div className="att-tools" style={{ marginBottom: 0 }}>
          <b>{tr('올리기')}</b>
          <select value={up.task_id} onChange={e => setUp({ ...up, task_id: e.target.value })} style={{ maxWidth: 260 }}><option value="">{tr('(작업 연결 안 함)')}</option>
            {tasks.filter(t => !t.undated).sort((a, b) => (a.code || '').localeCompare(b.code || '') || a.start.localeCompare(b.start)).map(t => <option key={t.id} value={t.id}>{t.code ? t.code + ' ' : ''}{t.name}</option>)}</select>
          <DateInput value={up.taken_on} onChange={e => setUp({ ...up, taken_on: e.target.value || today() })} title={tr('촬영일')} />
          <input type="text" value={up.note} onChange={e => setUp({ ...up, note: e.target.value })} placeholder={tr('설명 (선택, 예: 타설 전 배근 검측)')} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn" disabled={busy} onClick={() => cam.current?.click()}>📷 {tr('사진 찍기')}</button>
          <button className="btn primary" disabled={busy} onClick={() => pick.current?.click()}>📎 {tr('파일 올리기')}</button>
          {busy && <span className="small">{tr('올리는 중…')}</span>}
          <input ref={cam} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => { send(e.target.files); e.target.value = ''; }} />
          <input ref={pick} type="file" multiple hidden onChange={e => { send(e.target.files); e.target.value = ''; }} />
        </div>
        <div className="small" style={{ marginTop: 6 }}>{tr('휴대폰에서 열면 ‘사진 찍기’로 바로 촬영해 올릴 수 있습니다. 작업이나 이슈 창의 ‘사진 · 첨부’에서 올린 것도 여기에 모입니다.')}</div>
      </div>}
      {!list ? <div className="loading">{tr('불러오는 중…')}</div> : !shown.length ? <div className="empty">{tr('올린 사진·파일이 없습니다.')}</div> : days.map(d => (
        <div key={d.date}>
          <div className="ph-day">{fmtYW(d.date)} <span className="small">{tr('{n}개', { n: d.items.length })}</span></div>
          <div className="att-grid">{d.items.filter(a => a.image).map(a => (
            <div key={a.id} className="att-ph" onClick={() => setView(photos.indexOf(a))} title={[a.note, label(a), a.name].filter(Boolean).join(' · ')}>
              <img src={fileUrl(project.id, a)} alt={a.note || a.name} loading="lazy" />
              <div className="cap">{a.note || label(a) || a.name}</div>
            </div>))}</div>
          {d.items.some(a => !a.image) && <div className="att-files">{d.items.filter(a => !a.image).map(a => (
            <div key={a.id} className="att-file">📄 <a href={fileUrl(project.id, a)} target="_blank" rel="noreferrer">{a.name}</a>
              <span className="small">{[a.note, label(a)].filter(Boolean).join(' · ')}</span><div className="sp" />
              {ed && <button className="btn sm" onClick={() => del(a)}>{tr('삭제')}</button>}</div>))}</div>}
        </div>))}
      {view != null && photos[view] && <Lightbox project={project} list={photos} index={view} setIndex={setView} onDelete={ed ? del : null}
        extra={a => {
          const t = taskOf(a.task_id), i = issueOf(a.issue_id);
          return <>{t && <button className="btn sm" onClick={() => { setView(null); openTask(t.id); }}>{tr('작업 보기')}: {t.code || t.name}</button>}
            {i && <button className="btn sm" onClick={() => { setView(null); openIssue(i.id); }}>{tr('이슈 보기')}: {i.code}</button>}</>;
        }} />}
    </>
  );
}
