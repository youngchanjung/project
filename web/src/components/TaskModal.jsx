import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import History from './History.jsx';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { TASK_TYPES, TASK_STATUS, fmtY, diff, ddayTxt } from '../util.js';
import { tr } from '../i18n.js';
import { Tx, TxHint } from '../contentTr.jsx';

const KIND = { FS: '끝나면 시작', SS: '동시 시작', FF: '동시 종료' };

export default function TaskModal({ id, preset, onClose }) {
  const { tasks, deps, phases, members, issues, project, can, afterSave, toast, openIssue, td } = useProject();
  const t = id ? tasks.find(x => x.id === id) : null;
  const editable = can();
  const blank = { name: '', name_en: '', code: '', type: '작업', phase_id: phases[0]?.id || '', owner: '', assignee_id: '', start: td, end: td, status: '미착수', progress: 0, is_key: false, ref: '', note: '', not_before: '', baseline_start: '', baseline_end: '', actual_end: '', ...preset };
  const [f, setF] = useState(() => t ? { ...t, phase_id: t.phase_id || '', assignee_id: t.assignee_id || '' } : blank);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('info');
  const [nd, setNd] = useState({ pred_id: '', kind: 'FS', lag: 0 });
  useEffect(() => { if (t) setF(x => ({ ...x, start: t.start, end: t.end, version: t.version, status: t.status })); }, [t?.version]); // eslint-disable-line

  if (id && !t) return <Modal title={tr('작업')} onClose={onClose}><div className="err">{tr('작업을 찾을 수 없습니다. (삭제되었을 수 있습니다)')}</div></Modal>;
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const preds = t ? deps.filter(d => d.succ_id === t.id) : [];
  const succs = t ? deps.filter(d => d.pred_id === t.id) : [];
  const tname = tid => { const x = tasks.find(y => y.id === tid); return x ? `${x.code ? x.code + ' ' : ''}${x.name}` : '?'; };
  const related = t ? issues.filter(i => i.task_id === t.id) : [];

  const save = async () => {
    setErr(null); setBusy(true);
    const body = { ...f };
    for (const k of ['id', 'project_id', 'updated_at', 'updated_by', 'st']) delete body[k];
    for (const k of ['not_before', 'baseline_start', 'baseline_end', 'actual_end']) if (body[k] === '') body[k] = null;
    if (body.type === '마일스톤' || body.type === '제출' || body.type === '지급') { if (!body.end || body.end < body.start) body.end = body.start; }
    try {
      const r = t ? await api.patch(`/projects/${project.id}/tasks/${t.id}`, body) : await api.post(`/projects/${project.id}/tasks`, body);
      await afterSave(r); toast(tr(t ? '저장했습니다.' : '작업을 추가했습니다.')); onClose();
    } catch (e) { setErr(e.message); if (e.status === 409) afterSave(); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(tr("'{name}' 작업을 삭제할까요? 선행관계도 함께 지워집니다.", { name: t.name }))) return;
    try { await api.del(`/projects/${project.id}/tasks/${t.id}`); await afterSave(); toast(tr('삭제했습니다.')); onClose(); } catch (e) { setErr(e.message); }
  };
  const addDep = async () => {
    if (!nd.pred_id) return;
    try { await afterSave(await api.post(`/projects/${project.id}/deps`, { pred_id: Number(nd.pred_id), succ_id: t.id, kind: nd.kind, lag: Number(nd.lag) || 0 })); setNd({ pred_id: '', kind: 'FS', lag: 0 }); }
    catch (e) { setErr(e.message); }
  };
  const delDep = async d => { try { await api.del(`/projects/${project.id}/deps/${d.id}`); await afterSave(); } catch (e) { setErr(e.message); } };

  const n = t ? diff(td, t.st === '예정' ? t.start : t.end) : null;
  return (
    <Modal title={t ? `${t.code ? t.code + ' · ' : ''}${t.name}` : tr('새 작업')} onClose={onClose} wide>
      {t && <div style={{ marginTop: -6, marginBottom: 10 }}><span className={`badge b-${t.st}`}>{tr(t.st)}</span> {t.st !== '완료' && <span className="badge b-예정">{tr(t.st === '예정' ? '시작' : '마감')} {ddayTxt(n)}</span>}
        {preds.length > 0 && <span className="small"> {tr('· 선행작업이 있어 날짜가 자동 계산됩니다')}</span>}</div>}
      {t && <div className="toolbar">{[['info', tr('정보')], ['deps', `${tr('선행관계')} (${preds.length})`], ['issues', `${tr('관련 이슈')} (${related.length})`], ['hist', tr('변경 이력')]].map(([k, nm]) =>
        <span key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{nm}</span>)}</div>}
      {err && <div className="err">{err}</div>}

      {tab === 'info' && <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form">
          <label>{tr('작업명 *')}</label><input type="text" value={f.name} onChange={set('name')} autoFocus={!t} />
          {t && <TxHint text={t.name} />}
          <label>{tr('작업명 (영문)')}</label><input type="text" value={f.name_en || ''} onChange={set('name_en')} />
          <label>{tr('ID · 유형')}</label>
          <div className="row"><input type="text" value={f.code || ''} onChange={set('code')} placeholder={tr('예: 02-D1')} style={{ width: 120 }} />
            <select value={f.type} onChange={set('type')}>{TASK_TYPES.map(x => <option key={x} value={x}>{tr(x)}</option>)}</select>
            <label className="small"><input type="checkbox" checked={!!f.is_key} onChange={set('is_key')} /> {tr('핵심 ★')}</label></div>
          <label>{tr('단계')}</label><select value={f.phase_id} onChange={set('phase_id')}><option value="">{tr('(없음)')}</option>{phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <label>{tr('기간')}</label>
          <div className="row"><input type="date" value={f.start} onChange={e => setF({ ...f, start: e.target.value, end: f.end < e.target.value ? e.target.value : f.end })} /> ~ <input type="date" value={f.end} onChange={set('end')} />
            {f.start && f.end && <span className="small">{diff(f.start, f.end) + 1}{tr('일')}</span>}</div>
          <label>{tr('담당 (기관·사람)')}</label><input type="text" value={f.owner || ''} onChange={set('owner')} placeholder={tr('예: Integra / Space+')} />
          <label>{tr('담당자 계정')}</label><select value={f.assignee_id} onChange={set('assignee_id')}><option value="">{tr('(지정 안 함)')}</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <label>{tr('상태 · 진행률')}</label>
          <div className="row"><select value={f.status} onChange={set('status')}>{TASK_STATUS.map(x => <option key={x} value={x}>{tr(x)}</option>)}</select>
            <input type="number" min="0" max="100" step="10" value={f.progress} onChange={set('progress')} style={{ width: 80 }} />%
            {f.status === '완료' && <>{tr('실제 완료일')} <input type="date" value={f.actual_end || ''} onChange={set('actual_end')} /></>}</div>
          <label>{tr('최초 가능일')}</label><div className="row"><input type="date" value={f.not_before || ''} onChange={set('not_before')} /><span className="small">{tr('자동 계산 시 이 날짜보다 앞당기지 않음')}</span></div>
          <label>{tr('기준 일정')}</label><div className="row"><input type="date" value={f.baseline_start || ''} onChange={set('baseline_start')} /> ~ <input type="date" value={f.baseline_end || ''} onChange={set('baseline_end')} />
            {t?.baseline_end && t.end !== t.baseline_end && <span className="small" style={{ color: t.end > t.baseline_end ? 'var(--late)' : 'var(--done)' }}>{tr('편차')} {diff(t.baseline_end, t.end) > 0 ? '+' : ''}{diff(t.baseline_end, t.end)}{tr('일')}</span>}</div>
          <label>{tr('계약 조항')}</label><input type="text" value={f.ref || ''} onChange={set('ref')} />
          <label>{tr('비고')}</label><textarea value={f.note || ''} onChange={set('note')} />
          {t && <TxHint text={t.note} />}
        </div>
      </fieldset>}

      {tab === 'deps' && t && <div>
        <p className="small">{tr(project.day_basis === 'calendar' ? '선행작업이 바뀌면 이 작업의 날짜가 자동으로 다시 계산됩니다 (달력일 기준).' : '선행작업이 바뀌면 이 작업의 날짜가 자동으로 다시 계산됩니다 (근무일 기준).')}</p>
        <table><thead><tr><th>{tr('선행작업')}</th><th>{tr('관계')}</th><th>{tr('지연(일)')}</th><th /></tr></thead><tbody>
          {preds.map(d => <tr key={d.id}><td>{tname(d.pred_id)}</td><td>{KIND[d.kind]}</td><td>{d.lag}</td><td>{editable && <button className="btn sm danger" onClick={() => delDep(d)}>{tr('삭제')}</button>}</td></tr>)}
          {!preds.length && <tr><td colSpan={4} className="empty">{tr('선행작업이 없습니다.')}</td></tr>}
        </tbody></table>
        {editable && <div className="row" style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <select value={nd.pred_id} onChange={e => setNd({ ...nd, pred_id: e.target.value })} style={{ flex: 1, minWidth: 220 }}>
            <option value="">{tr('선행작업 선택…')}</option>
            {tasks.filter(x => x.id !== t.id).sort((a, b) => (a.code || '').localeCompare(b.code || '')).map(x => <option key={x.id} value={x.id}>{x.code ? x.code + ' ' : ''}{x.name} ({fmtY(x.end)})</option>)}
          </select>
          <select value={nd.kind} onChange={e => setNd({ ...nd, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}</select>
          <input type="number" value={nd.lag} onChange={e => setNd({ ...nd, lag: e.target.value })} style={{ width: 70 }} title={tr('지연일 (음수 가능)')} />
          <button className="btn primary" onClick={addDep}>{tr('추가')}</button>
        </div>}
        {succs.length > 0 && <><h4 style={{ marginBottom: 4 }}>{tr('이 작업을 기다리는 후속작업')}</h4><div className="small">{succs.map(d => tname(d.succ_id)).join(' · ')}</div></>}
      </div>}

      {tab === 'issues' && t && <div className="list">
        {related.map(i => <div key={i.id} className="item" onClick={() => { onClose(); openIssue(i.id); }}><div className="main"><div className="t">{i.code} <Tx>{i.title}</Tx></div><div className="small">{tr(i.status)} {tr('· 중요도')} {tr(i.priority)}</div></div></div>)}
        {!related.length && <div className="empty">{tr('관련 이슈가 없습니다.')}</div>}
        {editable && <div><button className="btn" onClick={() => { onClose(); openIssue(null, { task_id: t.id }); }}>{tr('+ 이 작업에 이슈 등록')}</button></div>}
      </div>}

      {tab === 'hist' && t && <History entity="task" entityId={t.id} />}

      <div className="actions">
        {t && editable && <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>{tr('삭제')}</button>}
        <button className="btn" onClick={onClose}>{tr('닫기')}</button>
        {editable && tab === 'info' && <button className="btn primary" onClick={save} disabled={busy}>{tr(t ? '저장' : '추가')}</button>}
      </div>
      {!editable && <p className="small">{tr('이 프로젝트의 참여자만 수정할 수 있습니다.')}</p>}
    </Modal>
  );
}
