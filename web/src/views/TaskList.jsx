import { useState } from 'react';
import { useProject } from '../pages/Project.jsx';
import { api } from '../api.js';
import { diff, ddayTxt, fmtY, TASK_STATUS, downloadCSV } from '../util.js';

export default function TaskList() {
  const { filtered, phases, td, color, openTask, can, afterSave, toast, project, deps, tasks } = useProject();
  const [st, setSt] = useState('');
  const [sort, setSort] = useState(['start', 1]);
  const phaseName = id => phases.find(p => p.id === id)?.name || '';
  const code = new Map(tasks.map(t => [t.id, t.code || `#${t.id}`]));
  const predOf = id => deps.filter(d => d.succ_id === id).map(d => `${code.get(d.pred_id)}${d.kind !== 'FS' ? ' ' + d.kind : ''}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}`).join(', ');
  let ts = st ? filtered.filter(t => t.st === st) : filtered;
  const [k, dir] = sort;
  const val = t => k === 'dday' ? diff(td, t.st === '예정' ? t.start : t.end) : k === 'phase' ? phaseName(t.phase_id) : (t[k] ?? '');
  ts = [...ts].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const cols = [['code', 'ID'], ['phase', '단계'], ['name', '작업'], ['type', '유형'], ['owner', '담당'], ['start', '시작'], ['end', '종료'], ['dday', 'D-day'], ['status', '상태'], ['pred', '선행'], ['note', '비고']];

  const quick = async (t, patch) => {
    try { afterSave(await api.patch(`/projects/${project.id}/tasks/${t.id}`, { ...patch, version: t.version })); }
    catch (e) { toast(e.message); }
  };
  return (
    <>
      <div className="toolbar">
        <span className="small">상태:</span>
        {['', '지연', '진행중', '예정', '완료', '보류'].map(s => <span key={s} className={`chip ${st === s ? 'on' : ''}`} onClick={() => setSt(s)}>{s || '전체'}</span>)}
        <span className="small">{ts.length}건</span>
        <div className="sp" />
        <button className="btn sm" onClick={() => downloadCSV(`${project.name}_작업`, [['code', 'ID'], [t => phaseName(t.phase_id), '단계'], ['name', '작업'], ['type', '유형'], ['owner', '담당'], ['start', '시작'], ['end', '종료'], ['status', '상태'], [t => predOf(t.id), '선행'], ['note', '비고']], ts)}>CSV</button>
        <a className="btn sm" href={`/api/projects/${project.id}/export.xlsx`}>엑셀로 내보내기</a>
      </div>
      <div className="tablewrap"><table>
        <thead><tr>{cols.map(([c, n]) => <th key={c} onClick={() => c !== 'pred' && setSort([c, sort[0] === c ? -sort[1] : 1])}>{n}{k === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
        <tbody>{ts.map(t => {
          const n = diff(td, t.st === '예정' ? t.start : t.end);
          return (
            <tr key={t.id} className="click" onClick={() => openTask(t.id)}>
              <td className="nw small">{t.code}</td>
              <td className="nw"><span className="dot" style={{ background: color(t.phase_id) }} />{phaseName(t.phase_id)}</td>
              <td>{t.is_key ? '★ ' : ''}{t.name}{t.name_en && <div className="small">{t.name_en}</div>}</td>
              <td className="nw">{t.type}</td><td>{t.owner}</td>
              <td className="nw">{fmtY(t.start)}</td><td className="nw">{fmtY(t.end)}</td>
              <td className="nw dd" style={{ color: t.st === '지연' ? 'var(--late)' : undefined }}>{t.st === '완료' ? '' : `${t.st === '예정' ? '시작' : '마감'} ${ddayTxt(n)}`}</td>
              <td className="nw" onClick={e => e.stopPropagation()}>
                {can() ? <select value={t.status} onChange={e => quick(t, { status: e.target.value })} style={{ width: 'auto' }}>{TASK_STATUS.map(s => <option key={s}>{s}</option>)}</select> : t.status}
                {' '}<span className={`badge b-${t.st}`}>{t.st}</span>
              </td>
              <td className="small">{predOf(t.id)}</td>
              <td className="small">{t.note}</td>
            </tr>);
        })}</tbody>
      </table></div>
    </>
  );
}
