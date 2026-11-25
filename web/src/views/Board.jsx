// 칸반 보드: 카드를 끌어서 다른 열에 놓으면 상태가 바뀌고, 같은 열 안에서 끌면 순서가 바뀝니다.
// 마우스·터치(길게 눌러 끌기)·키보드(스페이스로 집고 화살표로 이동) 지원 — dnd-kit
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  closestCorners, useDroppable
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useProject } from '../pages/Project.jsx';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import Dropdown from '../components/Dropdown.jsx';
import { columnOf, splitTags, PRIORITY_COLOR, personColor, diff, ddayTxt, fmt, fmtW, addD, weekday, phaseRisks, fmtH } from '../util.js';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

const sortCards = (a, b) => (a.board_order - b.board_order) || (a.id - b.id);

export default function Board() {
  const { tasks, columns, members, checklist, can, openTask, project, afterSave, toast, td, phases, color, leaves = [] } = useProject();
  const { user } = useApp();
  const editable = can();
  const [sp, setSp] = useSearchParams();
  const [f, setF] = useState(() => ({ q: '', who: '', due: '', tag: '', phase: Number(sp.get('phase')) || '' }));
  // 알림(🔔 제출일)에서 ?phase=ID 로 들어오면 그 단계만 보기
  useEffect(() => { const ph = Number(sp.get('phase')); if (ph) { setF(x => ({ ...x, phase: ph })); sp.delete('phase'); setSp(sp, { replace: true }); } }, [sp, setSp]);
  const risks = useMemo(() => phaseRisks(phases, tasks, td), [phases, tasks, td]);
  const dueOf = useMemo(() => new Map(phases.filter(p => p.due).map(p => [p.id, p.due])), [phases]);
  const [activeId, setActiveId] = useState(null);
  // 열별 카드 id 목록 (끄는 동안에는 화면에서 먼저 바꿔 보여 줌)
  const base = useMemo(() => {
    const m = Object.fromEntries(columns.map(c => [c.id, []]));
    for (const t of [...tasks].sort(sortCards)) { const c = columnOf(t, columns); if (m[c]) m[c].push(t.id); }
    return m;
  }, [tasks, columns]);
  const [items, setItems] = useState(base);
  useEffect(() => setItems(base), [base]);

  const byId = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const checks = useMemo(() => {
    const m = new Map();
    for (const c of checklist) { const x = m.get(c.task_id) || [0, 0]; x[1]++; if (c.done) x[0]++; m.set(c.task_id, x); }
    return m;
  }, [checklist]);
  const allTags = useMemo(() => [...new Set(tasks.flatMap(t => splitTags(t.tags)))].sort(), [tasks]);
  const weekEnd = addD(td, 6 - ((weekday(td) + 6) % 7)); // 이번 주 일요일
  const visible = t => {
    const q = f.q.trim().toLowerCase();
    if (q && ![t.name, t.code, t.tags, t.note, t.owner].join(' ').toLowerCase().includes(q)) return false;
    if (f.who === 'me' && t.assignee_id !== user.id) return false;
    if (f.who === 'none' && t.assignee_id) return false;
    if (f.who && !['me', 'none'].includes(f.who) && t.assignee_id !== Number(f.who)) return false;
    if (f.tag && !splitTags(t.tags).includes(f.tag)) return false;
    if (f.phase && (t.phase_id || -1) !== f.phase) return false;
    if (f.due === 'late' && t.st !== '지연') return false;
    if (f.due === 'week' && (t.undated || t.st === '완료' || t.end > weekEnd)) return false;
    if (f.due === 'none' && !t.undated) return false;
    return true;
  };
  const filtering = !!(f.q || f.who || f.due || f.tag || f.phase);
  const usedPhases = phases.filter(p => tasks.some(t => t.phase_id === p.id));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const findCol = id => (items[id] ? Number(id) : Number(Object.keys(items).find(k => items[k].includes(id))));

  const onDragOver = ({ active, over }) => {
    if (!over) return;
    const from = findCol(active.id), to = findCol(over.id);
    if (!from || !to || from === to) return;
    setItems(prev => {
      const src = prev[from].filter(x => x !== active.id);
      const dst = [...prev[to]];
      const oi = dst.indexOf(over.id);
      dst.splice(oi < 0 ? dst.length : oi, 0, active.id);
      return { ...prev, [from]: src, [to]: dst };
    });
  };
  const onDragEnd = async ({ active, over }) => {
    setActiveId(null);
    if (!over) return setItems(base);
    const col = findCol(active.id), overCol = findCol(over.id);
    let list = items[col];
    if (col === overCol && over.id !== active.id && list.includes(over.id)) {
      list = arrayMove(list, list.indexOf(active.id), list.indexOf(over.id));
      setItems(prev => ({ ...prev, [col]: list }));
    }
    // 걸러 보는 중에도 순서가 맞도록: 바로 뒤 카드의 전체 목록 위치로 계산
    const others = (base[col] || []).filter(x => x !== active.id);
    const pos = list.indexOf(active.id);
    const next = list.slice(pos + 1).find(x => others.includes(x));
    const index = next ? others.indexOf(next) : others.length;
    const t = byId.get(active.id);
    if (columnOf(t, columns) === col && (base[col] || []).indexOf(active.id) === index) return; // 제자리
    try { await afterSave(await api.post(`/projects/${project.id}/tasks/${active.id}/move`, { column_id: col, index })); }
    catch (e) { toast(e.message); setItems(base); }
  };

  // 마감일에 담당자가 휴가(반차 제외)면 표시
  const leaveOn = t => (t.assignee_id && !t.undated && t.st !== '완료' ? leaves.find(l => l.user_id === t.assignee_id && l.kind !== '반차' && l.start <= t.end && t.end <= l.end) : null);
  const claim = async t => {
    try { await afterSave(await api.patch(`/projects/${project.id}/tasks/${t.id}`, { assignee_id: user.id, version: t.version })); toast(tr('내가 맡았습니다: {name}', { name: t.name })); }
    catch (e) { toast(e.message); }
  };
  const active = activeId ? byId.get(activeId) : null;
  return (
    <>
      <div className="toolbar">
        <input type="search" className="tsearch" placeholder={tr('할 일·태그 검색')} value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
        <button type="button" className={`tbtn ${f.who === 'me' ? 'on' : ''}`} onClick={() => setF({ ...f, who: f.who === 'me' ? '' : 'me' })}>{f.who === 'me' ? '✓ ' : ''}{tr('내 카드만')}</button>
        {editable && <button type="button" className={`tbtn ${f.who === 'none' ? 'on' : ''}`} onClick={() => setF({ ...f, who: f.who === 'none' ? '' : 'none' })} title={tr('담당자가 없는 카드를 모아 봅니다. 카드의 ‘내가 맡기’로 바로 가져갈 수 있습니다.')}>
          {f.who === 'none' ? '✓ ' : ''}{tr('담당 없음')} <span className="kcnt">{tasks.filter(t => !t.assignee_id && t.st !== '완료' && t.type !== '회의').length}</span></button>}
        <Dropdown label={f.who && f.who !== 'me' ? `${tr('담당')}: ${f.who === 'none' ? tr('없음') : members.find(m => m.id === Number(f.who))?.name || ''}` : tr('담당: 전체')} active={!!f.who && f.who !== 'me'}>
          {[['', tr('전체')], ['none', tr('담당 없음')], ...members.map(m => [String(m.id), m.name])].map(([v, n]) => (
            <label key={v} className="dd-row"><input type="radio" checked={f.who === v} onChange={() => setF({ ...f, who: v })} /><span className="t">{n}</span></label>))}
        </Dropdown>
        <Dropdown label={f.due ? `${tr('마감')}: ${tr({ week: '이번 주', late: '지연', none: '날짜 없음' }[f.due])}` : tr('마감: 전체')} active={!!f.due}>
          {[['', '전체'], ['week', '이번 주'], ['late', '지연'], ['none', '날짜 없음']].map(([v, n]) => (
            <label key={v} className="dd-row"><input type="radio" checked={f.due === v} onChange={() => setF({ ...f, due: v })} /><span className="t">{tr(n)}</span></label>))}
        </Dropdown>
        {allTags.length > 0 && <Dropdown label={f.tag ? `${tr('태그')}: ${f.tag}` : tr('태그: 전체')} active={!!f.tag}>
          {['', ...allTags].map(v => (
            <label key={v} className="dd-row"><input type="radio" checked={f.tag === v} onChange={() => setF({ ...f, tag: v })} /><span className="t">{v || tr('전체')}</span></label>))}
        </Dropdown>}
        {usedPhases.length > 0 && <Dropdown label={f.phase ? `${tr('단계')}: ${f.phase === -1 ? tr('단계 없음') : phases.find(p => p.id === f.phase)?.name || ''}` : tr('단계: 전체')} active={!!f.phase}>
          {[['', tr('전체')], ...usedPhases.map(p => [p.id, p.name]), ...(tasks.some(t => !t.phase_id) ? [[-1, tr('단계 없음')]] : [])].map(([v, n]) => (
            <label key={v} className="dd-row"><input type="radio" checked={f.phase === v} onChange={() => setF({ ...f, phase: v })} />{v > 0 && <span className="dot" style={{ background: color(v) }} />}<span className="t">{n}</span></label>))}
        </Dropdown>}
        {filtering && <button className="btn sm" onClick={() => setF({ q: '', who: '', due: '', tag: '', phase: '' })}>{tr('필터 지우기')}</button>}
        <div className="sp" />
        {editable && <span className="small">{tr('카드를 끌어 다른 열에 놓으면 상태가 바뀝니다.')}</span>}
      </div>
      {!user.external && risks.length > 0 && <div className="duebar">
        {risks.map(r => (
          <button type="button" key={r.phase.id} className={`duechip ${r.level} ${f.phase === r.phase.id ? 'on' : ''}`} onClick={() => setF({ ...f, phase: f.phase === r.phase.id ? '' : r.phase.id })}
            title={tr('누르면 이 단계 카드만 보입니다.')}>
            <span className="dot" style={{ background: color(r.phase.id) }} />
            <b>{r.phase.name}</b> {tr('제출')} {fmtW(r.phase.due)} · <span className="dd">{ddayTxt(r.n)}</span>
            {r.level === 'done' ? <span> · ✓ {tr('모두 완료')}</span> : <>
              <span> · {tr('미완료 {n}건', { n: r.open })}</span>
              {r.review > 0 && <span> · 👀 {tr('검토 대기 {n}건', { n: r.review })}</span>}
              {r.after > 0 && <span className="warnx"> · ⚠ {tr('제출일 뒤 마감 {n}건', { n: r.after })}</span>}</>}
          </button>))}
      </div>}
      <DndContext sensors={sensors} collisionDetection={closestCorners}
        onDragStart={e => setActiveId(e.active.id)} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setItems(base); }}>
        <div className="kanban">
          {columns.map(c => {
            const ids = (items[c.id] || []).filter(id => byId.has(id) && visible(byId.get(id)));
            const total = (items[c.id] || []).length;
            return (
              <Column key={c.id} col={c} ids={ids} total={total} filtering={filtering} editable={editable}>
                {ids.map(id => <Card key={id} t={byId.get(id)} chk={checks.get(id)} members={members} td={td} pdue={dueOf.get(byId.get(id).phase_id)} leave={leaveOn(byId.get(id))} onOpen={() => openTask(id)} editable={editable} onClaim={() => claim(byId.get(id))} />)}
              </Column>
            );
          })}
        </div>
        <DragOverlay>{active ? <CardBody t={active} chk={checks.get(active.id)} members={members} td={td} pdue={dueOf.get(active.phase_id)} dragging /> : null}</DragOverlay>
      </DndContext>
    </>
  );
}

// 열 색: 직접 정한 색이 없으면 상태에 맞춰 (할 일 회색, 진행 중 파랑, 검토 주황, 완료 초록)
const colColor = c => c.color || (c.is_review ? 'var(--soon)' : { 진행중: 'var(--prog)', 완료: 'var(--done)', 보류: 'var(--hold)' }[c.status] || 'var(--bar-plan)');

function Column({ col, ids, total, filtering, editable, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <section className={`kcol ${isOver ? 'over' : ''}`}>
      <header className="kcol-h" style={{ '--cc': colColor(col) }}>
        <span className="dot" style={{ background: colColor(col) }} />
        <b><Tx>{tr(col.name)}</Tx></b>
        <span className="kcnt">{filtering ? `${ids.length}/${total}` : total}</span>
        {col.is_review && <span className="small" title={tr('검토 열: 검토자 알림은 2단계에서 추가됩니다.')}>👀</span>}
      </header>
      <SortableContext id={String(col.id)} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="kcol-body">
          {children}
          {!ids.length && <div className="kempty">{tr(editable ? '여기로 카드를 끌어 놓으세요' : '카드 없음')}</div>}
        </div>
      </SortableContext>
      {editable && <QuickAdd col={col} />}
    </section>
  );
}

function QuickAdd({ col }) {
  const { project, afterSave, toast } = useProject();
  const { user } = useApp();
  const [on, setOn] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (on) ref.current?.focus(); }, [on]);
  const add = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try { await afterSave(await api.post(`/projects/${project.id}/tasks`, { name: n, board_column_id: col.id })); setName(''); ref.current?.focus(); }
    catch (e) { toast(e.message); }
    finally { setBusy(false); }
  };
  if (user.external) return null; // 외부 협력자는 새 카드를 만들지 않음
  if (!on) return <button className="kadd" onClick={() => setOn(true)}>{tr('+ 할 일 추가')}</button>;
  return (
    <div className="kadd-form">
      <input ref={ref} type="text" value={name} placeholder={tr('제목 입력 후 Enter')} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); if (e.key === 'Escape') { setOn(false); setName(''); } }}
        onBlur={() => { if (!name.trim()) setOn(false); }} />
      <div className="small">{tr('담당·마감은 카드를 눌러 나중에 입력할 수 있습니다.')}</div>
    </div>
  );
}

function Card({ t, chk, members, td, pdue, leave, onOpen, editable, onClaim }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: !editable });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={`kcard-wrap ${isDragging ? 'ghost' : ''}`}
      onClick={onOpen}>
      <CardBody t={t} chk={chk} members={members} td={td} pdue={pdue} leave={leave} />
      {editable && !t.assignee_id && t.st !== '완료' && <button type="button" className="kclaim" onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onClaim(); }}>✋ {tr('내가 맡기')}</button>}
    </div>
  );
}

function CardBody({ t, chk, members, td, pdue, leave, dragging }) {
  const who = members.find(m => m.id === t.assignee_id);
  const tags = splitTags(t.tags);
  const n = t.undated ? null : diff(td, t.end);
  const late = t.st === '지연';
  return (
    <div className={`kcard ${dragging ? 'dragging' : ''} ${t.st === '완료' ? 'done' : ''} ${late ? 'is-late' : t.st !== '완료' && (t.priority === '높음' || t.priority === '긴급') ? 'p-high' : ''}`}>
      {(t.priority === '높음' || t.priority === '긴급') && <span className="kprio" style={{ color: PRIORITY_COLOR[t.priority] }}>{t.priority === '긴급' ? '⚡ ' : '▲ '}{tr(t.priority)}</span>}
      {t.review_state === 'requested' && <span className="krev">👀 {tr('검토 요청')}</span>}
      {t.review_state === 'rejected' && t.st !== '완료' && <span className="krev rej" title={t.review_note || ''}>↩ {tr('반려됨')}</span>}
      {leave && <span className="krev" title={`${tr(leave.kind)} ${fmt(leave.start)}~${fmt(leave.end)}`}>🏖 {tr('마감일에 담당자 {kind}', { kind: tr(leave.kind) })}</span>}
      {pdue && !t.undated && t.end > pdue && t.st !== '완료' && <span className="krev rej" title={tr('단계 제출일: {date}', { date: fmtW(pdue) })}>⚠ {tr('제출일 뒤')}</span>}
      <div className="kt">{t.is_key ? '★ ' : ''}<Tx>{t.name}</Tx></div>
      {tags.length > 0 && <div className="ktags">{tags.map(x => <span key={x} className="ktag">{x}</span>)}</div>}
      <div className="kmeta">
        {!t.undated && <span className={`kdue ${late ? 'late' : n !== null && n <= 2 && t.st !== '완료' ? 'soon' : ''}`}>📅 {fmtW(t.end)}{t.st !== '완료' && n !== null ? ` · ${ddayTxt(n)}` : ''}</span>}
        {chk && <span className={`kchk ${chk[0] === chk[1] ? 'all' : ''}`}>☑ {chk[0]}/{chk[1]}</span>}
        {(t.est_hours > 0 || t.spent > 0) && <span className={`kest ${t.est_hours && t.spent > t.est_hours ? 'over' : ''}`} title={tr('쓴 시간 / 예상 시간')}>⏱ {t.spent > 0 ? `${fmtH(t.spent)}${t.est_hours ? ` / ${fmtH(t.est_hours)}` : ''}` : fmtH(t.est_hours)}</span>}
        <span className="sp" />
        {who ? <span className="avatar sm" title={who.name} style={{ background: personColor(who.id) }}>{who.name.slice(0, 1)}</span> : t.owner ? <span className="small">{t.owner}</span> : null}
      </div>
    </div>
  );
}
