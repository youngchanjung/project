import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import History from './History.jsx';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { ISSUE_STATUS, PRIORITY, diff, today } from '../util.js';
import { tr, locale } from '../i18n.js';
import { Tx, TxHint } from '../contentTr.jsx';
import DateInput from './DateInput.jsx';

export default function IssueModal({ id, preset, onClose }) {
  const { issues, tasks, members, project, can, reload, toast, openTask } = useProject();
  const i = id ? issues.find(x => x.id === id) : null;
  const editable = can();
  const [f, setF] = useState(() => i ? { ...i, task_id: i.task_id || '', assignee_id: i.assignee_id || '' }
    : { title: '', detail: '', category: '', task_id: '', party: '', owner: '', assignee_id: '', priority: '중', status: '접수', raised: today(), target: '', resolved: '', source: '', remark: '', ...preset });
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('info');
  const [comments, setComments] = useState([]);
  const [cm, setCm] = useState('');
  useEffect(() => { if (i) api.get(`/projects/${project.id}/issues/${i.id}/comments`).then(setComments); }, [i?.id]); // eslint-disable-line
  if (id && !i) return <Modal title={tr('이슈')} onClose={onClose}><div className="err">{tr('이슈를 찾을 수 없습니다.')}</div></Modal>;
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setErr(null);
    const body = { ...f };
    for (const k of ['id', 'project_id', 'updated_at', 'updated_by']) delete body[k];
    for (const k of ['target', 'resolved', 'raised']) if (body[k] === '') body[k] = null;
    try {
      if (i) await api.patch(`/projects/${project.id}/issues/${i.id}`, body); else await api.post(`/projects/${project.id}/issues`, body);
      await reload(); toast(tr(i ? '저장했습니다.' : '이슈를 등록했습니다.')); onClose();
    } catch (e) { setErr(e.message); if (e.status === 409) reload(); }
  };
  const remove = async () => {
    if (!confirm(tr('이슈 {code}를 삭제할까요?', { code: i.code }))) return;
    try { await api.del(`/projects/${project.id}/issues/${i.id}`); await reload(); onClose(); } catch (e) { setErr(e.message); }
  };
  const addComment = async () => {
    if (!cm.trim()) return;
    try { const c = await api.post(`/projects/${project.id}/issues/${i.id}/comments`, { body: cm }); setComments([...comments, c]); setCm(''); } catch (e) { setErr(e.message); }
  };
  const parties = [...new Set(issues.map(x => x.party).filter(Boolean))];
  const cats = [...new Set(['설계', '조달·자재', '시공', '협의', '설비', '시험·평가', ...issues.map(x => x.category).filter(Boolean)])];
  const relTask = tasks.find(t => t.id === Number(f.task_id));
  return (
    <Modal title={i ? `${i.code} · ${i.title}` : tr('새 이슈')} onClose={onClose} wide>
      {i && <div className="toolbar">{[['info', tr('정보')], ['cm', `${tr('댓글')} (${comments.length})`], ['hist', tr('변경 이력')]].map(([k, n]) =>
        <span key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{n}</span>)}
        {i.raised && <span className="small">{tr('경과')} {diff(i.raised, i.resolved || today())}{tr('일')}</span>}</div>}
      {err && <div className="err">{err}</div>}
      {tab === 'info' && <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}><div className="form">
        <label>{tr('이슈 내용 *')}</label><input type="text" value={f.title} onChange={set('title')} autoFocus={!i} />
        {i && <TxHint text={i.title} />}
        <label>{tr('상세·영향·조치계획')}</label><textarea value={f.detail || ''} onChange={set('detail')} />
        {i && <TxHint text={i.detail} />}
        <label>{tr('구분 · 중요도')}</label>
        <div className="row"><input type="text" list="cats" value={f.category || ''} onChange={set('category')} style={{ width: 160 }} /><datalist id="cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
          <select value={f.priority} onChange={set('priority')}>{PRIORITY.map(x => <option key={x} value={x}>{tr(x)}</option>)}</select></div>
        <label>{tr('현황')}</label><select value={f.status} onChange={set('status')}>{ISSUE_STATUS.map(x => <option key={x} value={x}>{tr(x)}</option>)}</select>
        <label>{tr('관련 작업')}</label>
        <div className="row"><select value={f.task_id} onChange={set('task_id')} style={{ flex: 1 }}><option value="">{tr('(없음)')}</option>
          {tasks.slice().sort((a, b) => (a.code || '').localeCompare(b.code || '')).map(t => <option key={t.id} value={t.id}>{t.code ? t.code + ' ' : ''}{t.name}</option>)}</select>
          {relTask && <button className="btn sm" type="button" onClick={() => { onClose(); openTask(relTask.id); }}>{tr('작업 보기')}</button>}</div>
        <label>{tr('책임기관')}</label><input type="text" list="parties" value={f.party || ''} onChange={set('party')} /><datalist id="parties">{parties.map(c => <option key={c} value={c} />)}</datalist>
        <label>{tr('담당자')}</label>
        <div className="row"><input type="text" value={f.owner || ''} onChange={set('owner')} placeholder={tr('이름 (자유 입력)')} style={{ width: 160 }} />
          <select value={f.assignee_id} onChange={set('assignee_id')}><option value="">{tr('계정 지정 안 함')}</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        <label>{tr('발생 · 목표 · 해결')}</label>
        <div className="row"><DateInput value={f.raised || ''} onChange={set('raised')} /><DateInput value={f.target || ''} onChange={set('target')} title={tr('해결 목표일')} /><DateInput value={f.resolved || ''} onChange={set('resolved')} title={tr('해결일')} /></div>
        <label>{tr('출처')}</label><input type="text" value={f.source || ''} onChange={set('source')} />
        <label>{tr('비고')}</label><textarea value={f.remark || ''} onChange={set('remark')} />
        {i && <TxHint text={i.remark} />}
      </div></fieldset>}
      {tab === 'cm' && i && <div>
        <div className="comments">{comments.map(c => <div key={c.id} className="comment"><div className="small">{c.user_name} · {new Date(c.created_at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })}</div><div style={{ whiteSpace: 'pre-wrap' }}><Tx>{c.body}</Tx></div></div>)}
          {!comments.length && <div className="empty">{tr('댓글이 없습니다.')}</div>}</div>
        <textarea value={cm} onChange={e => setCm(e.target.value)} placeholder={tr('진행 상황, 협의 결과 등을 남겨 주세요')} style={{ marginTop: 10 }} />
        <div className="actions" style={{ marginTop: 6 }}><button className="btn primary" onClick={addComment}>{tr('댓글 등록')}</button></div>
      </div>}
      {tab === 'hist' && i && <History entity="issue" entityId={i.id} />}
      <div className="actions">
        {i && editable && <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>{tr('삭제')}</button>}
        <button className="btn" onClick={onClose}>{tr('닫기')}</button>
        {editable && tab === 'info' && <button className="btn primary" onClick={save}>{tr(i ? '저장' : '등록')}</button>}
      </div>
    </Modal>
  );
}
