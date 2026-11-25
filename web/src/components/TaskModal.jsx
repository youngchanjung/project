import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import History from './History.jsx';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { statusLabel, TASK_TYPES, TASK_STATUS, TASK_PRIORITY, fmtY, fmtW, fmtH, today, diff, ddayLabel, catOf, columnOf, attendeeIds } from '../util.js';
import { useApp } from '../App.jsx';
import { tr } from '../i18n.js';
import Attachments from './Attachments.jsx';
import { Tx, TxHint } from '../contentTr.jsx';
import DateInput from './DateInput.jsx';

const KIND = { FS: '끝나면 시작', SS: '동시 시작', FF: '동시 종료' };

export default function TaskModal({ id, preset, onClose }) {
  const { tasks, deps, phases, members, issues, project, can, afterSave, toast, openIssue, td, columns, checklist, reload } = useProject();
  const t = id ? tasks.find(x => x.id === id) : null;
  const editable = can();
  const isCons = catOf(project.category).key === 'construction';
  const { user } = useApp();
  // 시공은 날짜가 기본, 연구·설계는 날짜 없이도 만들 수 있게 빈 값으로 시작
  const blank = { name: '', name_en: '', code: '', type: '작업', phase_id: isCons ? phases[0]?.id || '' : '', owner: '', assignee_id: '', start: isCons ? td : '', end: isCons ? td : '', status: '미착수', progress: 0, is_key: false, ref: '', note: '', not_before: '', baseline_start: '', baseline_end: '', actual_end: '', priority: '보통', tags: '', reviewer_id: '', board_column_id: '', start_time: '', end_time: '', location: '', attendees: '', meeting_url: '', company: '', trade: '', deadline: '', actual_start: '', parent_id: '', est_hours: '', weight: '', ...preset };
  const fromTask = x => ({ ...x, phase_id: x.phase_id || '', assignee_id: x.assignee_id || '', reviewer_id: x.reviewer_id || '', board_column_id: x.board_column_id || '', start: x.undated ? '' : x.start, end: x.undated ? '' : x.end,
    start_time: x.start_time || '', end_time: x.end_time || '', location: x.location || '', attendees: x.attendees || '', meeting_url: x.meeting_url || '', company: x.company || '', trade: x.trade || '', deadline: x.deadline || '', actual_start: x.actual_start || '', parent_id: x.parent_id || '', est_hours: x.est_hours ?? '', weight: x.weight ?? '' });
  const [f, setF] = useState(() => t ? fromTask(t) : blank);
  // 하위 작업(WBS): 자기 자신과 자기 하위 작업은 상위로 고를 수 없음
  const kids = t ? tasks.filter(x => x.parent_id === t.id) : [];
  const parentChoices = (() => {
    if (!t) return tasks;
    const bad = new Set([t.id]); let grow = true;
    while (grow) { grow = false; for (const x of tasks) if (x.parent_id && bad.has(x.parent_id) && !bad.has(x.id)) { bad.add(x.id); grow = true; } }
    return tasks.filter(x => !bad.has(x.id));
  })();
  const isMeeting = f.type === '회의';
  // "자세히": 선행관계·기준 일정 등 고급 항목. 시공은 기본으로 펼침, 연구·설계는 접어 둠 (선택은 기억)
  const detKey = `task-detail-${isCons ? 'c' : 'x'}`;
  const [det, setDet] = useState(() => { try { const v = localStorage.getItem(detKey); if (v) return v === '1'; } catch {} return isCons; });
  const toggleDet = () => setDet(v => { try { localStorage.setItem(detKey, v ? '0' : '1'); } catch {} return !v; });
  const [newChecks, setNewChecks] = useState([]); // 새 할 일: 저장할 때 함께 등록
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('info');
  const [nd, setNd] = useState({ pred_id: '', kind: 'FS', lag: 0 });
  useEffect(() => { if (t) setF(x => ({ ...x, start: t.undated ? '' : t.start, end: t.undated ? '' : t.end, version: t.version, status: t.status, board_column_id: t.board_column_id || '' })); }, [t?.version]); // eslint-disable-line

  if (id && !t) return <Modal title={tr('작업')} onClose={onClose}><div className="err">{tr('작업을 찾을 수 없습니다. (삭제되었을 수 있습니다)')}</div></Modal>;
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const preds = t ? deps.filter(d => d.succ_id === t.id) : [];
  const succs = t ? deps.filter(d => d.pred_id === t.id) : [];
  const tname = tid => { const x = tasks.find(y => y.id === tid); return x ? `${x.code ? x.code + ' ' : ''}${x.name}` : '?'; };
  const related = t ? issues.filter(i => i.task_id === t.id) : [];

  const save = async () => {
    setErr(null); setBusy(true);
    const body = { ...f };
    for (const k of ['id', 'project_id', 'updated_at', 'updated_by', 'st', 'undated', 'created_at', 'board_order']) delete body[k];
    for (const k of ['start', 'end', 'not_before', 'baseline_start', 'baseline_end', 'actual_end', 'deadline', 'actual_start', 'est_hours', 'weight']) if (body[k] === '') body[k] = null;
    for (const k of ['float', 'crit']) delete body[k];
    if (body.type === '마일스톤' || body.type === '제출' || body.type === '지급') { if (body.start && (!body.end || body.end < body.start)) body.end = body.start; }
    if (body.type === '회의') { if (body.start && (!body.end || body.end < body.start)) body.end = body.start; }
    else { body.start_time = null; body.end_time = null; }
    for (const k of ['review_state', 'review_note', 'outlook_event_id']) delete body[k];
    if (t && body.board_column_id === (t.board_column_id || '')) delete body.board_column_id; // 열은 칸반에서 바꿈
    if (!body.board_column_id) delete body.board_column_id;
    if (t?.undated && !body.start && !body.end) { delete body.start; delete body.end; } // 날짜 없는 그대로
    try {
      const r = t ? await api.patch(`/projects/${project.id}/tasks/${t.id}`, body) : await api.post(`/projects/${project.id}/tasks`, body);
      if (!t) for (const text of newChecks) await api.post(`/projects/${project.id}/tasks/${r.task.id}/checklist`, { text });
      await afterSave(r); toast(tr(t ? '저장했습니다.' : (isCons ? '작업을 추가했습니다.' : '할 일을 추가했습니다.'))); onClose();
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

  return (
    <Modal title={t ? `${t.code ? t.code + ' · ' : ''}${t.name}` : tr(isCons ? '새 작업' : '새 할 일')} onClose={onClose} wide>
      {t && <div style={{ marginTop: -6, marginBottom: 10 }}><span className={`badge b-${t.st}`}>{tr(t.st)}</span> {t.st !== '완료' && !t.undated && <span className="badge b-예정">{ddayLabel(t, td)}</span>}
        {preds.length > 0 && <span className="small"> {tr('· 선행작업이 있어 날짜가 자동 계산됩니다')}</span>}</div>}
      {t && <div className="toolbar">{[['info', tr('정보')], ['deps', `${tr('선행관계')} (${preds.length})`], ['issues', `${tr('관련 이슈')} (${related.length})`], ['time', `${tr('시간 기록')}${t.spent ? ` (${fmtH(t.spent)})` : ''}`], ['hist', tr('변경 이력')]].map(([k, nm]) =>
        <span key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{nm}</span>)}</div>}
      {err && <div className="err">{err}</div>}

      {tab === 'info' && t?.review_state && <ReviewBox t={t} canDecide={t.reviewer_id === user.id || can('pm')} members={members} project={project} afterSave={afterSave} setErr={setErr} toast={toast} />}
      {tab === 'info' && <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form">
          <label>{tr('제목 *')}</label><input type="text" value={f.name} onChange={set('name')} autoFocus={!t} placeholder={tr(isMeeting ? '예: 주간 연구 회의' : '무엇을 해야 하나요?')} />
          {t && <TxHint text={t.name} />}
          {!isCons && <><label>{tr('유형')}</label>
            <div className="row"><select value={f.type} onChange={set('type')}>{TASK_TYPES.map(x => <option key={x} value={x}>{tr(x)}</option>)}</select>
              <label className="small"><input type="checkbox" checked={!!f.is_key} onChange={set('is_key')} /> {tr('핵심 ★')}</label></div></>}
          {isMeeting && <>
            <label>{tr('일시')}</label>
            <div className="row"><DateInput value={f.start || ''} onChange={e => setF({ ...f, start: e.target.value, end: e.target.value })} />
              <input type="time" value={f.start_time || ''} onChange={e => setF({ ...f, start_time: e.target.value, end_time: !f.end_time || f.end_time <= e.target.value ? plus1h(e.target.value) : f.end_time })} /> ~
              <input type="time" value={f.end_time || ''} onChange={set('end_time')} /></div>
            <label>{tr('장소')}</label><input type="text" value={f.location || ''} onChange={set('location')} placeholder={tr('예: 3층 회의실')} />
            <label>{tr('회의 링크')}</label><div className="row"><input type="text" value={f.meeting_url || ''} onChange={set('meeting_url')} placeholder="https://teams.microsoft.com/…" style={{ flex: 1 }} />
              {t?.meeting_url && <a className="btn sm" href={t.meeting_url} target="_blank" rel="noreferrer">{tr('참가')}</a>}</div>
            <label>{tr('참석자')}</label>
            <div className="att-list">{members.map(m => (
              <label key={m.id} className="small"><input type="checkbox" checked={attendeeIds(f).includes(m.id)} onChange={e => {
                const ids = new Set(attendeeIds(f)); e.target.checked ? ids.add(m.id) : ids.delete(m.id); setF({ ...f, attendees: [...ids].join(',') });
              }} /> {m.name}</label>))}
              {!members.length && <span className="small">{tr('프로젝트 참여자가 없습니다.')}</span>}</div>
            <div className="full small">{tr('참석자에게 프로그램 알림(🔔)이 갑니다. Teams 회의 자동 생성은 M365 연동(3단계)에서 추가됩니다.')}</div>
          </>}
          <label>{tr(isMeeting ? '주관' : '담당자')}</label><select value={f.assignee_id} onChange={set('assignee_id')}><option value="">{tr('(지정 안 함)')}</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          {!isCons && !isMeeting && <><label>{tr('검토자')}</label><select value={f.reviewer_id} onChange={set('reviewer_id')}><option value="">{tr('(지정 안 함 · PM이 검토)')}</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></>}
          {!isMeeting && <><label>{tr(f.type === '마일스톤' || f.type === '제출' ? '날짜' : '마감일')}</label>
          <div className="row"><DateInput value={f.end || ''} onChange={e => setF({ ...f, end: e.target.value, start: f.start && e.target.value && f.start > e.target.value ? e.target.value : f.start })} />
            {f.end && <button type="button" className="btn sm" onClick={() => setF({ ...f, end: '', start: '' })}>{tr('날짜 지우기')}</button>}
            {!f.end && <span className="small">{tr('비워 두면 날짜 없는 할 일 (간트·달력에는 안 보임)')}</span>}
            {f.start && f.end && f.start !== f.end && <span className="small">{fmtY(f.start)} ~ · {diff(f.start, f.end) + 1}{tr('일')}</span>}</div></>}
          <label>{tr('상태')}</label>
          <div className="row"><select value={f.status} onChange={set('status')}>{TASK_STATUS.map(x => <option key={x} value={x}>{tr(statusLabel(x))}</option>)}</select>
            {t && columns.length > 0 && <span className="small">{tr('칸반 열')}: {tr(columns.find(c => c.id === columnOf(t, columns))?.name || '')}</span>}</div>
          <label>{tr('우선순위')}</label>
          <div className="row"><select value={f.priority || '보통'} onChange={set('priority')}>{TASK_PRIORITY.map(x => <option key={x} value={x}>{tr(x)}</option>)}</select></div>
          {!isCons && !isMeeting && <>
            {phases.length > 0 && <><label>{tr('단계')}</label><div className="row"><select value={f.phase_id} onChange={set('phase_id')}><option value="">{tr('(없음)')}</option>{phases.map(p => <option key={p.id} value={p.id}>{p.name}{p.due ? ` · ${tr('제출')} ${fmtY(p.due)}` : ''}</option>)}</select>
              {(() => { const due = phases.find(p => p.id === Number(f.phase_id))?.due; return due && f.end && f.end > due ? <span className="small" style={{ color: 'var(--late)' }}>⚠ {tr('마감일이 단계 제출일({date})보다 늦습니다.', { date: fmtY(due) })}</span> : null; })()}</div></>}
            <label>{tr('예상 시간')}</label>
            <div className="row"><input type="number" min="0" max="2000" step="0.5" value={f.est_hours ?? ''} onChange={set('est_hours')} style={{ width: 110 }} placeholder={tr('예: 8')} /><span className="small">{tr('시간 · 선택 입력. 넣으면 ‘업무량’ 화면에서 사람별 합계를 봅니다.')}</span></div>
          </>}
          <label>{tr('태그')}</label><input type="text" value={f.tags || ''} onChange={set('tags')} placeholder={tr('쉼표로 구분 (예: 평면, 입면, 구조)')} />
          <label>{tr('메모')}</label><textarea value={f.note || ''} onChange={set('note')} />
          {t && <TxHint text={t.note} />}
          <label>{tr('체크리스트')}</label>
          <Checklist t={t} items={t ? checklist.filter(c => c.task_id === t.id) : newChecks.map((text, i) => ({ id: -i - 1, text, done: false }))}
            editable={editable} project={project} reload={reload} setErr={setErr}
            onLocal={t ? null : setNewChecks} local={newChecks} />
          <label>{tr(isCons ? '현장 사진 · 첨부' : '첨부')}</label>
          <div>{t ? <Attachments project={project} taskId={t.id} editable={editable} toast={toast} /> : <span className="small">{tr('저장한 뒤 사진·파일을 붙일 수 있습니다.')}</span>}</div>
          <div className="full"><button type="button" className="linkbtn" onClick={toggleDet}>{det ? '▾' : '▸'} {tr(det ? '자세히 접기' : '자세히 (시작일·단계·유형·선행관계·기준 일정 등)')}</button></div>
          {det && <>
            <label>{tr('시작일')}</label>
            <div className="row"><DateInput value={f.start || ''} onChange={e => setF({ ...f, start: e.target.value, end: !f.end || f.end < e.target.value ? e.target.value : f.end })} />
              {f.start && f.end && <span className="small">{diff(f.start, f.end) + 1}{tr('일')}</span>}</div>
            {(isCons || isMeeting || !phases.length) && <><label>{tr('단계')}</label><select value={f.phase_id} onChange={set('phase_id')}><option value="">{tr('(없음)')}</option>{phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></>}
            <label>{tr(isCons ? 'ID · 유형' : 'ID')}</label>
            <div className="row"><input type="text" value={f.code || ''} onChange={set('code')} placeholder={tr('예: 02-D1')} style={{ width: 120 }} />
              {isCons && <><select value={f.type} onChange={set('type')}>{TASK_TYPES.map(x => <option key={x} value={x}>{tr(x)}</option>)}</select>
              <label className="small"><input type="checkbox" checked={!!f.is_key} onChange={set('is_key')} /> {tr('핵심 ★')}</label></>}</div>
            <label>{tr('작업명 (영문)')}</label><input type="text" value={f.name_en || ''} onChange={set('name_en')} />
            <label>{tr('담당 (기관·사람)')}</label><input type="text" value={f.owner || ''} onChange={set('owner')} placeholder={tr('예: Integra / Space+')} />
            {isCons && <><label>{tr('업체 · 공종')}</label>
              <div className="row"><input type="text" list="dl-company" value={f.company || ''} onChange={set('company')} placeholder={tr('업체(협력사)')} style={{ flex: 1 }} />
                <input type="text" list="dl-trade" value={f.trade || ''} onChange={set('trade')} placeholder={tr('공종 (예: 철근콘크리트)')} style={{ flex: 1 }} />
                <datalist id="dl-company">{[...new Set(tasks.map(x => x.company).filter(Boolean))].sort().map(v => <option key={v} value={v} />)}</datalist>
                <datalist id="dl-trade">{[...new Set(tasks.map(x => x.trade).filter(Boolean))].sort().map(v => <option key={v} value={v} />)}</datalist></div></>}
            {isCons && <><label>{tr('검토자')}</label><select value={f.reviewer_id} onChange={set('reviewer_id')}><option value="">{tr('(지정 안 함)')}</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></>}
            <label>{tr('진행률')}</label>
            <div className="row"><input type="number" min="0" max="100" step="10" value={f.progress} onChange={set('progress')} style={{ width: 80 }} />%
              {f.status === '완료' && <>{tr('실제 완료일')} <DateInput value={f.actual_end || ''} onChange={set('actual_end')} /></>}</div>
            {isCons && <><label>{tr('공정 가중치')}</label>
              <div className="row"><input type="number" min="0" step="any" value={f.weight ?? ''} onChange={set('weight')} style={{ width: 140 }} placeholder={tr('예: 공사비')} />
                <span className="small">{tr('선택 입력. 공사비 등을 넣으면 ‘공정률’ 화면에서 가중치 기준으로 계산합니다.')}</span></div></>}
            {isCons && <>
              <label>{tr('상위 작업 (WBS)')}</label>
              <div className="row"><select value={f.parent_id} onChange={set('parent_id')} style={{ flex: 1 }}><option value="">{tr('(없음 · 맨 위 작업)')}</option>
                {parentChoices.map(x => <option key={x.id} value={x.id}>{x.code ? x.code + ' ' : ''}{x.name}</option>)}</select></div>
              {kids.length > 0 && <div className="full small">{tr('하위 작업 {n}개: 시작·종료일과 진행률은 하위 작업에서 자동으로 계산됩니다.', { n: kids.length })}</div>}
              <label>{tr('마감 기한')}</label>
              <div className="row"><DateInput value={f.deadline || ''} onChange={set('deadline')} />
                {f.deadline && f.end && f.end > f.deadline ? <span className="slip">⚠ {tr('종료일이 마감 기한보다 {n}일 늦습니다.', { n: diff(f.deadline, f.end) })}</span> : <span className="small">{tr('계약·인허가 기한. 종료일이 넘으면 경고')}</span>}</div>
              <label>{tr('실제 시작일')}</label><div className="row"><DateInput value={f.actual_start || ''} onChange={set('actual_start')} /></div>
            </>}
            <label>{tr('최초 가능일')}</label><div className="row"><DateInput value={f.not_before || ''} onChange={set('not_before')} /><span className="small">{tr('자동 계산 시 이 날짜보다 앞당기지 않음')}</span></div>
            <label>{tr('기준 일정')}</label><div className="row"><DateInput value={f.baseline_start || ''} onChange={set('baseline_start')} /> ~ <DateInput value={f.baseline_end || ''} onChange={set('baseline_end')} />
              {t?.baseline_end && !t.undated && t.end !== t.baseline_end && <span className="small" style={{ color: t.end > t.baseline_end ? 'var(--late)' : 'var(--done)' }}>{tr('편차')} {diff(t.baseline_end, t.end) > 0 ? '+' : ''}{diff(t.baseline_end, t.end)}{tr('일')}</span>}</div>
            {isCons && t?.float != null && <><label>{tr('여유')}</label><div className="row">{t.crit ? <span className="fcrit"><span className="cptag">CP</span>{tr('크리티컬 패스: 늦어지면 전체 준공이 늦어집니다.')}</span> : <span>{tr('{n}일 늦어져도 전체 준공에는 영향이 없습니다.', { n: t.float })}</span>}</div></>}
            <label>{tr('계약 조항')}</label><input type="text" value={f.ref || ''} onChange={set('ref')} />
          </>}
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

      {tab === 'time' && t && <TimeLog t={t} project={project} editable={editable} user={user} members={members} canPm={can('pm')} reload={reload} setErr={setErr} />}
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

// 체크리스트: 저장된 할 일은 바로 서버에 반영, 새 할 일은 저장할 때 함께 등록
// 투입 시간 기록: 이 카드에 실제로 쓴 시간. 예상 시간과 비교
function TimeLog({ t, project, editable, user, members, canPm, reload, setErr }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ date: today(), hours: '', note: '', user_id: user.id });
  const load = () => api.get(`/projects/${project.id}/time?task=${t.id}`).then(setRows).catch(e => setErr(e.message));
  useEffect(() => { load(); }, [t.id]); // eslint-disable-line
  const add = async () => {
    if (!(Number(f.hours) > 0)) return setErr(tr('시간을 입력하세요.'));
    try { await api.post(`/projects/${project.id}/time`, { ...f, task_id: t.id }); setF({ ...f, hours: '', note: '' }); setErr(null); await load(); reload(); }
    catch (e) { setErr(e.message); }
  };
  const del = async r => { try { await api.del(`/projects/${project.id}/time/${r.id}`); await load(); reload(); } catch (e) { setErr(e.message); } };
  const sum = (rows || []).reduce((a, r) => a + r.hours, 0);
  const over = t.est_hours && sum > t.est_hours;
  return (
    <div>
      <p><b className={over ? 'late-t' : ''}>{tr('쓴 시간')} {fmtH(Math.round(sum * 10) / 10)}</b>{t.est_hours ? <span className="small"> / {tr('예상')} {fmtH(t.est_hours)}{over ? ` · ${tr('예상보다 {n} 더 씀', { n: fmtH(Math.round((sum - t.est_hours) * 10) / 10) })}` : ''}</span> : <span className="small"> · {tr('예상 시간을 넣으면 비교해 보여 줍니다.')}</span>}</p>
      {editable && <div className="toolbar">
        <DateInput value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
        <input type="number" min="0.5" max="24" step="0.5" value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} placeholder={tr('시간')} style={{ width: 90 }} />
        {canPm && <select value={f.user_id} onChange={e => setF({ ...f, user_id: Number(e.target.value) })}>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        <input type="text" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={tr('메모 (선택)')} style={{ flex: 1, minWidth: 140 }} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
        <button className="btn primary" onClick={add}>{tr('기록')}</button>
      </div>}
      {rows === null ? <div className="small">{tr('불러오는 중…')}</div> : rows.length ? <table><tbody>{rows.map(r => (
        <tr key={r.id}><td className="nw">{fmtW(r.date)}</td><td className="nw">{r.user_name}</td><td className="nw"><b>{fmtH(r.hours)}</b></td><td className="small">{r.note}</td>
          <td className="nw">{(r.user_id === user.id || canPm) && <button className="btn sm danger" onClick={() => del(r)}>{tr('삭제')}</button>}</td></tr>))}</tbody></table>
        : <p className="small">{tr('아직 기록이 없습니다.')}</p>}
    </div>
  );
}

function Checklist({ t, items, editable, project, reload, setErr, onLocal, local }) {
  const [text, setText] = useState('');
  const url = t && `/projects/${project.id}/tasks/${t.id}/checklist`;
  const call = async fn => { try { await fn(); await reload(); } catch (e) { setErr(e.message); } };
  const add = () => {
    const v = text.trim(); if (!v) return;
    if (onLocal) onLocal([...local, v]); else call(() => api.post(url, { text: v }));
    setText('');
  };
  const done = items.filter(c => c.done).length;
  return (
    <div className="checklist">
      {items.length > 0 && <div className="small">{done}/{items.length} {tr('완료')}<span className="bar-bg" style={{ display: 'inline-block', width: 80, marginLeft: 8, verticalAlign: 'middle' }}><i style={{ width: `${Math.round(done / items.length * 100)}%` }} /></span></div>}
      {items.map((c, i) => (
        <div key={c.id} className="chk-row">
          <input type="checkbox" checked={!!c.done} disabled={!editable || !!onLocal} onChange={e => call(() => api.patch(`${url}/${c.id}`, { done: e.target.checked }))} />
          <span className={c.done ? 'chk-done' : ''}><Tx>{c.text}</Tx></span>
          {editable && <button type="button" className="iconbtn sm" title={tr('삭제')} onClick={() => onLocal ? onLocal(local.filter((_, j) => j !== i)) : call(() => api.del(`${url}/${c.id}`))}>×</button>}
        </div>))}
      {editable && <input type="text" value={text} placeholder={tr('+ 세부 항목 추가 (Enter)')} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }} />}
    </div>
  );
}

const plus1h = hm => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

// 칸반 검토: 검토자(또는 PM)가 승인하면 완료 열로, 반려하면 진행 중 열로
function ReviewBox({ t, canDecide, members, project, afterSave, setErr, toast }) {
  const [note, setNote] = useState('');
  const who = members.find(m => m.id === t.reviewer_id)?.name;
  const decide = async decision => {
    try { await afterSave(await api.post(`/projects/${project.id}/tasks/${t.id}/review`, { decision, note })); toast(tr(decision === 'approve' ? '승인했습니다.' : '반려했습니다.')); setNote(''); }
    catch (e) { setErr(e.message); }
  };
  if (t.review_state === 'approved') return <div className="rv-box ok">✓ {tr('검토 승인됨')}{t.review_note ? ` · ${t.review_note}` : ''}</div>;
  if (t.review_state === 'rejected') return <div className="rv-box rej">↩ {tr('검토 반려됨')}{t.review_note ? ` · ${t.review_note}` : ''}</div>;
  return (
    <div className="rv-box">
      <b>👀 {tr('검토 요청 중')}</b><span className="small">{who ? tr('검토자: {name}', { name: who }) : tr('검토자 미지정 (PM이 검토)')}</span>
      {canDecide && <>
        <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder={tr('의견 (반려 사유 등, 선택)')} style={{ flex: 1, minWidth: 180 }} />
        <button className="btn" onClick={() => decide('reject')}>↩ {tr('반려')}</button>
        <button className="btn primary" onClick={() => decide('approve')}>✓ {tr('승인')}</button>
      </>}
    </div>
  );
}
