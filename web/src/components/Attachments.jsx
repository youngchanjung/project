import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmtY, today } from '../util.js';
import { tr } from '../i18n.js';

// 현장 사진·첨부. 작업(taskId) 또는 이슈(issueId)에 붙임. 사진은 바둑판, 그 밖의 파일은 목록
export const fileUrl = (pid, a, dl) => `/api/projects/${pid}/attachments/${a.id}/file${dl ? '?download=1' : ''}`;
const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

export async function uploadFiles(pid, files, extra) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra || {})) if (v !== undefined && v !== null && v !== '') fd.append(k, String(v));
  for (const f of files) fd.append('files', f, f.name);
  return api.post(`/projects/${pid}/attachments`, fd);
}

export default function Attachments({ project, taskId, issueId, editable, toast, onChange }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState('');
  const [view, setView] = useState(null); // 크게 보기: 사진 index
  const pick = useRef(null), cam = useRef(null);
  const q = taskId ? `task_id=${taskId}` : `issue_id=${issueId}`;
  const load = () => api.get(`/projects/${project.id}/attachments?${q}`).then(setList).catch(e => toast?.(e.message));
  useEffect(() => { load(); }, [project.id, q]); // eslint-disable-line

  const send = async files => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const r = await uploadFiles(project.id, [...files], { task_id: taskId, issue_id: issueId, note: note.trim(), taken_on: today() });
      toast?.(tr('{n}개를 올렸습니다.', { n: r.length })); setNote(''); await load(); onChange?.();
    } catch (e) { toast?.(e.message); } finally { setBusy(false); }
  };
  const del = async a => {
    if (!confirm(tr('‘{name}’을(를) 지울까요?', { name: a.name }))) return;
    try { await api.del(`/projects/${project.id}/attachments/${a.id}`); await load(); onChange?.(); } catch (e) { toast?.(e.message); }
  };
  if (!list) return <div className="small">{tr('불러오는 중…')}</div>;
  const photos = list.filter(a => a.image), files = list.filter(a => !a.image);
  return (
    <div className={drag ? 'att-drop' : ''} style={{ borderRadius: 8 }}
      onDragOver={e => { if (editable) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
      onDrop={e => { if (!editable) return; e.preventDefault(); setDrag(false); send(e.dataTransfer.files); }}>
      {editable && <div className="att-tools">
        <button type="button" className="btn sm" disabled={busy} onClick={() => cam.current?.click()}>📷 {tr('사진 찍기')}</button>
        <button type="button" className="btn sm" disabled={busy} onClick={() => pick.current?.click()}>📎 {tr('파일 올리기')}</button>
        <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder={tr('설명 (선택, 예: 타설 전 배근 검측)')} style={{ flex: 1, minWidth: 160 }} />
        {busy && <span className="small">{tr('올리는 중…')}</span>}
        <input ref={cam} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => { send(e.target.files); e.target.value = ''; }} />
        <input ref={pick} type="file" multiple hidden onChange={e => { send(e.target.files); e.target.value = ''; }} />
      </div>}
      {!list.length && <div className="small">{tr(editable ? '사진이나 파일을 여기로 끌어 놓거나 위 단추로 올리세요.' : '첨부가 없습니다.')}</div>}
      {photos.length > 0 && <div className="att-grid">{photos.map((a, i) => (
        <div key={a.id} className="att-ph" onClick={() => setView(i)} title={[a.note, a.name].filter(Boolean).join(' · ')}>
          <img src={fileUrl(project.id, a)} alt={a.note || a.name} loading="lazy" />
          <div className="cap">{fmtY(a.taken_on)}{a.note ? ` · ${a.note}` : ''}</div>
        </div>))}</div>}
      {files.length > 0 && <div className="att-files">{files.map(a => (
        <div key={a.id} className="att-file">📄 <a href={fileUrl(project.id, a)} target="_blank" rel="noreferrer">{a.name}</a>
          <span className="small">{kb(a.size || 0)} · {fmtY(a.taken_on)}{a.note ? ` · ${a.note}` : ''}</span><div className="sp" />
          {editable && <button type="button" className="btn sm" onClick={() => del(a)}>{tr('삭제')}</button>}</div>))}</div>}
      {view != null && photos[view] && <Lightbox project={project} list={photos} index={view} setIndex={setView} onDelete={editable ? a => { setView(null); del(a); } : null} />}
    </div>
  );
}

// 사진 크게 보기 (← → 로 넘김, Esc 로 닫음)
export function Lightbox({ project, list, index, setIndex, onDelete, extra }) {
  const a = list[index];
  useEffect(() => {
    const k = e => {
      if (e.key === 'Escape') { e.stopPropagation(); setIndex(null); }
      if (e.key === 'ArrowRight') setIndex(i => Math.min(list.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [list.length, setIndex]);
  return (
    <div className="lightbox" onClick={() => setIndex(null)} role="dialog" aria-label={tr('사진 크게 보기')}>
      <button className="lb-close" aria-label={tr('닫기')}>✕</button>
      {index > 0 && <button className="lb-nav" style={{ left: 14 }} aria-label={tr('이전')} onClick={e => { e.stopPropagation(); setIndex(index - 1); }}>‹</button>}
      {index < list.length - 1 && <button className="lb-nav" style={{ right: 14 }} aria-label={tr('다음')} onClick={e => { e.stopPropagation(); setIndex(index + 1); }}>›</button>}
      <img src={fileUrl(project.id, a)} alt={a.note || a.name} onClick={e => e.stopPropagation()} />
      <div className="lb-bar" onClick={e => e.stopPropagation()}>
        <b>{fmtY(a.taken_on)}</b>{a.note && <span>{a.note}</span>}{extra?.(a)}
        <span style={{ opacity: .7 }}>{a.name}{a.created_by_name ? ` · ${a.created_by_name}` : ''} · {index + 1}/{list.length}</span>
        <a className="btn sm" href={fileUrl(project.id, a, true)}>{tr('내려받기')}</a>
        {onDelete && <button className="btn sm" onClick={() => onDelete(a)}>{tr('삭제')}</button>}
      </div>
    </div>
  );
}
