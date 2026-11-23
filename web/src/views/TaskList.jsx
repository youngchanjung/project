import { useState } from 'react';
import { useProject } from '../pages/Project.jsx';
import { api } from '../api.js';
import { diff, ddayTxt, fmtY, TASK_STATUS, downloadXLSX, taskCols } from '../util.js';
import ExportButton from '../components/ExportButton.jsx';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

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
        <span className="small">{tr('상태:')}</span>
        {['', '지연', '진행중', '예정', '완료', '보류'].map(s => <span key={s} className={`chip ${st === s ? 'on' : ''}`} onClick={() => setSt(s)}>{s ? tr(s) : tr('전체')}</span>)}
        <span className="small">{ts.length}{tr('건')}</span>
        <div className="sp" />
        <ExportButton toast={toast} make={() => downloadXLSX(`${project.name}_작업 목록`, [{ name: '작업 목록', cols: taskCols({ phases, tasks, deps }), rows: ts }])} />
        <a className="btn sm" href={`/api/projects/${project.id}/export.xlsx`} title={tr('작업·이슈 전체를 다시 불러올 수 있는 형식으로 받습니다.')}>{tr('전체 내보내기 (다시 불러오기용)')}</a>
      </div>
      <div className="tablewrap"><table>
        <thead><tr>{cols.map(([c, n]) => <th key={c} onClick={() => c !== 'pred' && setSort([c, sort[0] === c ? -sort[1] : 1])}>{tr(n)}{k === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
        <tbody>{ts.map(t => {
          const n = diff(td, t.st === '예정' ? t.start : t.end);
          return (
            <tr key={t.id} className="click" onClick={() => openTask(t.id)}>
              <td className="nw small">{t.code}</td>
              <td className="nw"><span className="dot" style={{ background: color(t.phase_id) }} />{phaseName(t.phase_id)}</td>
              <td>{t.is_key ? '★ ' : ''}<Tx>{t.name}</Tx>{t.name_en && <div className="small">{t.name_en}</div>}</td>
              <td className="nw">{tr(t.type)}</td><td>{t.owner}</td>
              <td className="nw">{fmtY(t.start)}</td><td className="nw">{fmtY(t.end)}</td>
              <td className="nw dd" style={{ color: t.st === '지연' ? 'var(--late)' : undefined }}>{t.st === '완료' ? '' : `${tr(t.st === '예정' ? '시작' : '마감')} ${ddayTxt(n)}`}</td>
              <td className="nw" onClick={e => e.stopPropagation()}>
                {can() ? <select value={t.status} onChange={e => quick(t, { status: e.target.value })} style={{ width: 'auto' }}>{TASK_STATUS.map(s => <option key={s} value={s}>{tr(s)}</option>)}</select> : t.status}
                {' '}<span className={`badge b-${t.st}`}>{tr(t.st)}</span>
              </td>
              <td className="small">{predOf(t.id)}</td>
              <td className="small"><Tx>{t.note}</Tx></td>
            </tr>);
        })}</tbody>
      </table></div>
    </>
  );
}
