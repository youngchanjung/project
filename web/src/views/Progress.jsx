import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useProject, FilterBar } from '../pages/Project.jsx';
import DateInput from '../components/DateInput.jsx';
import { addD, diff, fmtW, weekday, TASK_STATUS, statusLabel } from '../util.js';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

// 주간 진척 입력: 이번 주에 걸친 작업의 실제 시작·진행률·상태·실제 완료를 한 화면에서 입력하고 한 번에 저장
const RANGES = [['this', '이번 주'], ['last', '지난 주'], ['next2', '앞으로 2주'], ['open', '진행 중 전체']];

export default function Progress() {
  const { filtered, tasks, td, project, can, afterSave, toast, openTask } = useProject();
  const [range, setRange] = useState('this');
  const [edits, setEdits] = useState({}); // id → { actual_start, progress, status, actual_end }
  const [busy, setBusy] = useState(false);
  const ed = can() && !project.archived;
  const parents = useMemo(() => new Set(tasks.map(t => t.parent_id).filter(Boolean)), [tasks]);
  const mon = addD(td, -((weekday(td) + 6) % 7));
  const [w0, w1] = range === 'last' ? [addD(mon, -7), addD(mon, -1)] : range === 'next2' ? [mon, addD(mon, 13)] : [mon, addD(mon, 6)];
  const ts = filtered.filter(t => !t.undated && !parents.has(t.id) && (
    range === 'open' ? t.st !== '완료' && t.start <= td
      : (t.start <= w1 && t.end >= w0) || (t.st === '지연') || (t.actual_end && t.actual_end >= w0 && t.actual_end <= w1)))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const val = (t, k) => (edits[t.id]?.[k] !== undefined ? edits[t.id][k] : (t[k] ?? ''));
  const set = (t, k, v) => setEdits(e => {
    const cur = { ...(e[t.id] || {}), [k]: v };
    // 상태와 진행률을 서로 맞춤
    if (k === 'status' && v === '완료') { cur.progress = 100; if (!val(t, 'actual_end')) cur.actual_end = td; }
    if (k === 'actual_end' && v) { cur.status = '완료'; cur.progress = 100; }
    if (k === 'progress' && Number(v) >= 100 && val(t, 'status') !== '완료') { cur.status = '완료'; if (!val(t, 'actual_end')) cur.actual_end = td; }
    if ((k === 'progress' && Number(v) > 0 && Number(v) < 100) || (k === 'actual_start' && v)) { if (val(t, 'status') === '미착수') cur.status = '진행중'; }
    // 원래 값과 같으면 지움
    for (const f of Object.keys(cur)) if (String(cur[f] ?? '') === String(t[f] ?? '')) delete cur[f];
    const n = { ...e }; if (Object.keys(cur).length) n[t.id] = cur; else delete n[t.id];
    return n;
  });
  const dirty = Object.keys(edits).length;
  const save = async () => {
    setBusy(true);
    try {
      const rows = Object.entries(edits).map(([id, x]) => {
        const r = { id: Number(id), ...x };
        for (const k of ['actual_start', 'actual_end']) if (r[k] === '') r[k] = null;
        if (r.progress !== undefined) r.progress = Number(r.progress) || 0;
        return r;
      });
      await afterSave(await api.post(`/projects/${project.id}/tasks/progress`, { rows }));
      toast(tr('진척 {n}건을 저장했습니다.', { n: rows.length })); setEdits({});
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const right = ed && <>
    {dirty > 0 && <button className="btn sm" onClick={() => setEdits({})}>{tr('되돌리기')}</button>}
    <button className="btn primary" disabled={!dirty || busy} onClick={save}>{tr('저장')} {dirty ? `(${dirty})` : ''}</button>
  </>;
  return (
    <>
      <FilterBar right={right}>
        <div className="seg">{RANGES.map(([k, n]) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{tr(n)}</button>)}</div>
      </FilterBar>
      <div className="small" style={{ margin: '4px 2px 8px' }}>
        {range !== 'open' && <>{fmtW(w0)} ~ {fmtW(w1)} · </>}{tr('작업 {n}건', { n: ts.length })} · {tr('실제 시작일·진행률·실제 완료일을 입력하고 저장하면 변경 이력에 남고, 뒤따르는 작업과 요약 작업이 다시 계산됩니다.')}
      </div>
      <div className="tablewrap prog-tab"><table>
        <thead><tr>
          <th>{tr('작업')}</th><th>{tr('업체')}</th><th>{tr('계획')}</th><th>{tr('실제 시작')}</th><th>{tr('진행률')}</th><th>{tr('상태')}</th><th>{tr('실제 완료')}</th>
        </tr></thead>
        <tbody>{ts.map(t => (
          <tr key={t.id} className={edits[t.id] ? 'dirty' : ''}>
            <td className="click" onClick={() => openTask(t.id)} style={{ minWidth: 220 }}>{t.crit && <span className="cptag">CP</span>}<span className="small">{t.code}</span> <Tx>{t.name}</Tx>
              {t.st === '지연' && <div className="slip small">{tr('{n}일 지남', { n: diff(t.end, td) })}</div>}</td>
            <td className="nw">{t.company}</td>
            <td className="nw small">{fmtW(t.start)}{t.end !== t.start ? ` ~ ${fmtW(t.end)}` : ''}</td>
            <td className="nw">{ed ? <div className="row"><DateInput value={val(t, 'actual_start')} onChange={e => set(t, 'actual_start', e.target.value)} />
              {!val(t, 'actual_start') && <button className="btn sm" onClick={() => set(t, 'actual_start', td)}>{tr('오늘')}</button>}</div> : t.actual_start}</td>
            <td className="nw">{ed ? <div className="row"><input type="number" min="0" max="100" step="10" value={val(t, 'progress')} onChange={e => set(t, 'progress', e.target.value)} />%
              {[50, 100].map(n => <button key={n} className="btn sm" onClick={() => set(t, 'progress', n)}>{n}</button>)}</div> : `${t.progress}%`}</td>
            <td className="nw">{ed ? <select value={val(t, 'status')} onChange={e => set(t, 'status', e.target.value)} style={{ width: 'auto' }}>{TASK_STATUS.map(x => <option key={x} value={x}>{tr(statusLabel(x))}</option>)}</select> : tr(statusLabel(t.status))}</td>
            <td className="nw">{ed ? <DateInput value={val(t, 'actual_end')} onChange={e => set(t, 'actual_end', e.target.value)} /> : t.actual_end}</td>
          </tr>))}
          {!ts.length && <tr><td colSpan={7} className="empty">{tr('이 기간에 진척을 입력할 작업이 없습니다.')}</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
