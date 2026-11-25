import { useMemo, useState } from 'react';
import { useProject } from '../pages/Project.jsx';
import { api } from '../api.js';
import { statusLabel, diff, ddayLabel, fmtY, fmtYW, TASK_STATUS, downloadXLSX, taskCols, catOf, splitTags, PRIORITY_COLOR } from '../util.js';
import ExportButton from '../components/ExportButton.jsx';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

const PRIO_RANK = { 긴급: 0, 높음: 1, 보통: 2, 낮음: 3 };

// 작업 목록(시공) / 할 일 목록(연구·설계): 같은 데이터를 표로 보기. 정렬·검색·일괄 완료·엑셀 내보내기
export default function TaskList() {
  const { filtered, phases, td, color, openTask, can, afterSave, toast, project, deps, tasks, members, checklist, bl } = useProject();
  const isCons = catOf(project.category).key === 'construction';
  const [st, setSt] = useState('');
  const [sort, setSort] = useState([isCons ? 'start' : 'end', 1]);
  const [sel, setSel] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const B0 = { owner: '', company: '', trade: '', phase_id: '', shift: '' };
  const [bk, setBk] = useState(B0);
  const phaseName = id => phases.find(p => p.id === id)?.name || '';
  const memberName = id => members.find(m => m.id === id)?.name || '';
  const code = new Map(tasks.map(t => [t.id, t.code || `#${t.id}`]));
  const predOf = id => deps.filter(d => d.succ_id === id).map(d => `${code.get(d.pred_id)}${d.kind !== 'FS' ? ' ' + d.kind : ''}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}`).join(', ');
  const checks = useMemo(() => {
    const m = new Map();
    for (const c of checklist) { const x = m.get(c.task_id) || [0, 0]; x[1]++; if (c.done) x[0]++; m.set(c.task_id, x); }
    return m;
  }, [checklist]);
  let ts = st ? filtered.filter(t => t.st === st) : filtered;
  const [k, dir] = sort;
  // 날짜 없는 할 일은 날짜 정렬에서 항상 맨 뒤
  const val = t => {
    if (k === 'dday') return t.undated ? 1e9 * dir : diff(td, t.st === '예정' ? t.start : t.end);
    if ((k === 'start' || k === 'end') && t.undated) return dir > 0 ? '9999' : '0000';
    if (k === 'phase') return phaseName(t.phase_id);
    if (k === 'assignee') return memberName(t.assignee_id) || t.owner || '';
    if (k === 'priority') return PRIO_RANK[t.priority] ?? 2;
    if (k === 'float') return t.float ?? 1e9 * dir;
    if (k === 'slip') { const b = bl(t); return b && !t.undated ? diff(b.end, t.end) : -1e9 * dir; }
    return t[k] ?? '';
  };
  ts = [...ts].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const cols = isCons
    ? [['code', 'ID'], ['phase', '단계'], ['name', '작업'], ['type', '유형'], ['owner', '담당'], ['company', '업체 · 공종'], ['start', '시작'], ['end', '종료'], ['dday', 'D-day'], ['status', '상태'], ['float', '여유'], ['slip', '기준선 차이'], ['pred', '선행'], ['note', '비고']]
    : [['name', '할 일'], ['assignee', '담당자'], ['end', '마감일'], ['dday', 'D-day'], ['priority', '우선순위'], ['tags', '태그'], ['check', '체크리스트'], ['status', '상태']];
  const ed = can();

  const quick = async (t, patch) => {
    try { afterSave(await api.patch(`/projects/${project.id}/tasks/${t.id}`, { ...patch, version: t.version })); }
    catch (e) { toast(e.message); }
  };
  const bulk = async status => {
    try { await afterSave(await api.post(`/projects/${project.id}/tasks/bulk-status`, { ids: [...sel], status })); toast(tr('{n}건을 바꿨습니다.', { n: sel.size })); setSel(new Set()); }
    catch (e) { toast(e.message); }
  };
  const bulkEdit = async () => {
    const set = {}; for (const k of ['owner', 'company', 'trade', 'phase_id']) if (bk[k] !== '') set[k] = bk[k];
    const shift = Number(bk.shift) || 0;
    if (!Object.keys(set).length && !shift) { toast(tr('바꿀 항목을 하나 이상 입력하세요.')); return; }
    try {
      const r = await api.post(`/projects/${project.id}/tasks/bulk-edit`, { ids: [...sel], set, shift });
      await afterSave(r); toast(tr('{n}건을 바꿨습니다.', { n: sel.size })); setSel(new Set()); setBk(B0); setBulkOpen(false);
    } catch (e) { toast(e.message); }
  };
  const flip = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = ts.length > 0 && ts.every(t => sel.has(t.id));
  const exportCols = isCons ? taskCols({ phases, tasks, deps })
    : [['name', '할 일'], [t => memberName(t.assignee_id), '담당자'], [t => t.undated ? '' : t.end, '마감일'], [t => tr(t.priority), '우선순위'], ['tags', '태그'],
      [t => { const c = checks.get(t.id); return c ? `${c[0]}/${c[1]}` : ''; }, '체크리스트'], [t => tr(statusLabel(t.status)), '상태'], ['actual_end', '완료일'], ['note', '메모']];

  return (
    <>
      <div className="toolbar">
        <span className="small">{tr('상태:')}</span>
        {['', '지연', '진행중', '예정', '완료', '보류'].map(s => <span key={s} className={`chip ${st === s ? 'on' : ''}`} onClick={() => setSt(s)}>{s ? tr(s) : tr('전체')}</span>)}
        <span className="small">{ts.length}{tr('건')}</span>
        {ed && sel.size > 0 && <>
          <span className="small">· {tr('{n}건 선택', { n: sel.size })}</span>
          <button className="btn sm primary" onClick={() => bulk('완료')}>✓ {tr('선택 완료 처리')}</button>
          <button className="btn sm" onClick={() => bulk('진행중')}>{tr('진행중으로')}</button>
          {isCons && <button className={`btn sm ${bulkOpen ? 'primary' : ''}`} onClick={() => setBulkOpen(v => !v)}>✎ {tr('일괄 편집')}</button>}
          <button className="btn sm" onClick={() => setSel(new Set())}>{tr('선택 해제')}</button>
        </>}
        <div className="sp" />
        <ExportButton toast={toast} make={() => downloadXLSX(`${project.name}_${isCons ? '작업 목록' : '할 일 목록'}`, [{ name: isCons ? '작업 목록' : '할 일 목록', cols: exportCols, rows: ts }])} />
        {isCons && <a className="btn sm" href={`/api/projects/${project.id}/export.xlsx`} title={tr('작업·이슈 전체를 다시 불러올 수 있는 형식으로 받습니다.')}>{tr('전체 내보내기 (다시 불러오기용)')}</a>}
      </div>
      {isCons && ed && bulkOpen && sel.size > 0 && <div className="bulkbar">
        <b>{tr('{n}건 일괄 편집', { n: sel.size })}</b>
        <input type="text" value={bk.owner} onChange={e => setBk({ ...bk, owner: e.target.value })} placeholder={tr('담당')} />
        <input type="text" list="bk-company" value={bk.company} onChange={e => setBk({ ...bk, company: e.target.value })} placeholder={tr('업체')} />
        <input type="text" list="bk-trade" value={bk.trade} onChange={e => setBk({ ...bk, trade: e.target.value })} placeholder={tr('공종')} />
        <datalist id="bk-company">{[...new Set(tasks.map(x => x.company).filter(Boolean))].sort().map(v => <option key={v} value={v} />)}</datalist>
        <datalist id="bk-trade">{[...new Set(tasks.map(x => x.trade).filter(Boolean))].sort().map(v => <option key={v} value={v} />)}</datalist>
        <select value={bk.phase_id} onChange={e => setBk({ ...bk, phase_id: e.target.value })} style={{ width: 'auto' }}><option value="">{tr('단계 (그대로)')}</option>{phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <span className="small">{tr('날짜 이동')}</span><input type="number" value={bk.shift} onChange={e => setBk({ ...bk, shift: e.target.value })} placeholder="±0" style={{ width: 80 }} /><span className="small">{tr(project.day_basis === 'calendar' ? '일' : '근무일')}</span>
        <button className="btn sm primary" onClick={bulkEdit}>{tr('적용')}</button>
        <span className="small">{tr('비워 둔 항목은 바꾸지 않습니다. 완료된 작업은 날짜를 옮기지 않습니다.')}</span>
      </div>}
      <div className="tablewrap"><table>
        <thead><tr>
          {ed && <th style={{ width: 34 }}><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(ts.map(t => t.id)))} title={tr('모두 선택')} /></th>}
          {cols.map(([c, n]) => <th key={c} onClick={() => !['pred', 'check', 'tags'].includes(c) && setSort([c, sort[0] === c ? -sort[1] : 1])}>{tr(n)}{k === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}
        </tr></thead>
        <tbody>{ts.map(t => {
          const n = t.undated ? null : diff(td, t.st === '예정' ? t.start : t.end);
          const c = checks.get(t.id);
          const dd = <td className="nw dd" style={{ color: t.st === '지연' ? 'var(--late)' : undefined }}>{ddayLabel(t, td)}</td>;
          const status = (
            <td className="nw" onClick={e => e.stopPropagation()}>
              {ed ? <select value={t.status} onChange={e => quick(t, { status: e.target.value })} style={{ width: 'auto' }}>{TASK_STATUS.map(s => <option key={s} value={s}>{tr(statusLabel(s))}</option>)}</select> : null}
              {/* 고를 수 있을 때는 '지연'만 경고로 덧붙이고, 아니면 상태 배지 하나만 */}
              {(!ed || t.st === '지연') && <>{' '}<span className={`badge b-${t.st}`}>{tr(t.st)}</span></>}
            </td>);
          return (
            <tr key={t.id} className={`click ${sel.has(t.id) ? 'sel' : ''}`} onClick={() => openTask(t.id)}>
              {ed && <td onClick={e => { e.stopPropagation(); flip(t.id); }}><input type="checkbox" checked={sel.has(t.id)} readOnly /></td>}
              {isCons ? <>
                <td className="nw small">{t.code}</td>
                <td className="nw"><span className="dot" style={{ background: color(t.phase_id) }} />{phaseName(t.phase_id)}</td>
                <td style={{ minWidth: 220 }}>{t.is_key ? '★ ' : ''}<Tx>{t.name}</Tx>{t.name_en && <div className="small">{t.name_en}</div>}</td>
                <td className="nw">{tr(t.type)}</td><td className="nw">{t.owner}</td><td className="nw">{t.company}{t.trade && <div className="small">{t.trade}</div>}</td>
                <td className="nw">{t.undated ? '—' : fmtYW(t.start)}</td><td className="nw">{t.undated ? '—' : fmtYW(t.end)}{t.deadline && t.end > t.deadline && <div className="dlover small" title={`${tr('마감 기한')} ${t.deadline}`}>⚠ {tr('마감 기한 +{n}일', { n: diff(t.deadline, t.end) })}</div>}</td>
                {dd}{status}
                <td className="nw">{t.float == null ? '' : <>{t.crit && <span className="cptag">CP</span>}<span className={t.crit ? 'fcrit' : ''}>{t.float}{tr('일')}</span></>}</td>
                <td className="nw">{(() => { const b = bl(t); const n = b && !t.undated ? diff(b.end, t.end) : null; return n == null ? '' : n > 0 ? <span className="slip">+{n}{tr('일')}</span> : n < 0 ? <span className="early">{n}{tr('일')}</span> : '0'; })()}</td>
                <td className="small">{predOf(t.id)}</td>
                <td className="small"><Tx>{t.note}</Tx></td>
              </> : <>
                <td style={{ textDecoration: t.st === '완료' ? 'line-through' : undefined, opacity: t.st === '완료' ? .65 : 1 }}>{t.is_key ? '★ ' : ''}<Tx>{t.name}</Tx></td>
                <td className="nw">{memberName(t.assignee_id) || <span className="small">{t.owner}</span>}</td>
                <td className="nw">{t.undated ? <span className="small">{tr('날짜 없음')}</span> : fmtYW(t.end)}</td>
                {dd}
                <td className="nw" style={{ color: PRIORITY_COLOR[t.priority], fontWeight: t.priority === '긴급' || t.priority === '높음' ? 700 : 400 }}>{tr(t.priority || '보통')}</td>
                <td>{splitTags(t.tags).map(x => <span key={x} className="ktag">{x}</span>)}</td>
                <td className="nw small">{c ? `☑ ${c[0]}/${c[1]}` : ''}</td>
                {status}
              </>}
            </tr>);
        })}
          {!ts.length && <tr><td colSpan={cols.length + 1} className="empty">{tr(isCons ? '작업이 없습니다.' : '할 일이 없습니다. 위 ‘+ 할 일’ 또는 칸반의 ‘+ 할 일 추가’로 만들어 보세요.')}</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
