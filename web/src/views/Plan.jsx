// 배치 달력: 사람을 행, 날짜를 열로 놓고 할 일을 막대로 보여 줌.
//   - 왼쪽 '배치할 카드'(담당 없음·날짜 없음)를 끌어 사람·날짜 칸에 놓으면 담당자와 마감일이 정해짐
//   - 막대를 끌어 다른 사람·날짜로 옮기면 기간(일수)은 그대로 두고 옮김
//   - 휴가·부재인 날은 칸에 색이 들어감
import { useMemo, useState } from 'react';
import { useProject } from '../pages/Project.jsx';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { addD, diff, fmt, dow, weekday, personColor, fmtH, today } from '../util.js';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

const mondayOf = d => addD(d, -((weekday(d) + 6) % 7));

export default function Plan() {
  const { tasks, members, holidays = [], leaves = [], can, project, afterSave, toast, openTask, color } = useProject();
  const { user } = useApp();
  const editable = can();
  const [days, setDays] = useState(14);
  const [from, setFrom] = useState(() => mondayOf(today()));
  const [hideWe, setHideWe] = useState(true);
  const [over, setOver] = useState(null); // 'uid:date'
  const hol = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays]);
  const cols = useMemo(() => {
    const out = [];
    for (let i = 0; out.length < days && i < days * 2; i++) {
      const d = addD(from, i), w = weekday(d);
      if (hideWe && (w === 0 || w === 6)) continue;
      out.push(d);
    }
    return out;
  }, [from, days, hideWe]);
  const last = cols[cols.length - 1];
  const open = tasks.filter(t => t.st !== '완료' && t.type !== '회의');
  const pool = open.filter(t => !t.assignee_id || t.undated);
  const rows = members.map(m => ({ m, items: open.filter(t => t.assignee_id === m.id && !t.undated && t.end >= cols[0] && t.start <= last).sort((a, b) => a.start.localeCompare(b.start)) }));
  const leaveOf = (uid, d) => leaves.find(l => l.user_id === uid && l.start <= d && d <= l.end);
  // 막대 겹침을 줄로 나눔
  const lanes = items => {
    const ends = [];
    return items.map(t => { let i = ends.findIndex(e => e < t.start); if (i < 0) { i = ends.length; ends.push(t.end); } else ends[i] = t.end; return { t, lane: i }; });
  };
  const colIdx = d => { let i = cols.findIndex(c => c >= d); return i < 0 ? cols.length : i; };

  const drop = async (e, uid, d) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    const len = t.undated ? 0 : diff(t.start, t.end);
    const body = { assignee_id: uid, version: t.version };
    if (t.undated) { body.start = d; body.end = d; } else { body.start = d; body.end = addD(d, len); }
    if (t.assignee_id === uid && !t.undated && t.start === body.start) return;
    try {
      await afterSave(await api.patch(`/projects/${project.id}/tasks/${t.id}`, body));
      const who = members.find(m => m.id === uid)?.name;
      toast(tr('{name} → {who}, 마감 {date}', { name: t.name, who, date: fmt(body.end) }));
    } catch (err) { toast(err.message); }
  };
  const dragProps = t => (editable ? { draggable: true, onDragStart: e => { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move'; } } : {});

  return (
    <>
      <div className="toolbar">
        <button className="btn sm" onClick={() => setFrom(addD(from, -7))}>◀</button>
        <button className="btn sm" onClick={() => setFrom(mondayOf(today()))}>{tr('이번 주')}</button>
        <button className="btn sm" onClick={() => setFrom(addD(from, 7))}>▶</button>
        <select value={days} onChange={e => setDays(Number(e.target.value))}>{[10, 14, 20, 30].map(n => <option key={n} value={n}>{tr('{n}일 보기', { n })}</option>)}</select>
        <button type="button" className={`tbtn ${hideWe ? 'on' : ''}`} onClick={() => setHideWe(!hideWe)}>{hideWe ? '✓ ' : ''}{tr('주말 숨기기')}</button>
        <div className="sp" />
        {editable && <span className="small">{tr('카드를 끌어 사람·날짜 칸에 놓으면 담당자와 마감일이 정해집니다.')}</span>}
      </div>
      <div className="plan">
        {editable && <aside className="plan-pool card">
          <h3>{tr('배치할 카드')} <span className="kcnt">{pool.length}</span></h3>
          <div className="small" style={{ marginBottom: 6 }}>{tr('담당 없음·날짜 없음')}</div>
          {pool.map(t => (
            <div key={t.id} className="plan-card" {...dragProps(t)} onClick={() => openTask(t.id)} style={{ '--pc': t.phase_id ? color(t.phase_id) : 'var(--bar-plan)' }}>
              <Tx>{t.name}</Tx>
              <div className="small">{[t.assignee_id ? members.find(m => m.id === t.assignee_id)?.name : tr('담당 없음'), t.undated ? tr('날짜 없음') : fmt(t.end), t.est_hours ? fmtH(t.est_hours) : ''].filter(Boolean).join(' · ')}</div>
            </div>))}
          {!pool.length && <p className="small">{tr('모두 배치되었습니다.')}</p>}
        </aside>}
        <div className="plan-grid card" style={{ '--n': cols.length }}>
          <div className="plan-row plan-head">
            <div className="plan-who" />
            {cols.map(d => <div key={d} className={`plan-day ${d === today() ? 'today' : ''} ${hol.has(d) || weekday(d) === 0 ? 'off' : weekday(d) === 6 ? 'sat' : ''}`} title={hol.get(d) || ''}>{fmt(d)}<span>{dow(d)}</span></div>)}
          </div>
          {rows.map(({ m, items }) => {
            const ls = lanes(items);
            const h = Math.max(1, ...ls.map(x => x.lane + 1));
            return (
              <div key={m.id} className="plan-row" style={{ '--lanes': h }}>
                <div className="plan-who" style={{ gridRow: `1 / span ${h}` }}><span className="avatar sm" style={{ background: personColor(m.id) }}>{m.name.slice(0, 1)}</span> {m.name}{m.id === user.id ? <span className="small"> ({tr('나')})</span> : null}</div>
                {cols.map((d, ci) => {
                  const lv = leaveOf(m.id, d);
                  const k = `${m.id}:${d}`;
                  return <div key={d} className={`plan-cell ${lv ? 'leave' : ''} ${hol.has(d) ? 'off' : ''} ${over === k ? 'over' : ''}`} title={lv ? `${tr(lv.kind)}${lv.note ? ' · ' + lv.note : ''}` : ''} style={{ gridColumn: ci + 2, gridRow: `1 / span ${h}` }}
                    onDragOver={editable ? e => { e.preventDefault(); if (over !== k) setOver(k); } : undefined} onDragLeave={() => over === k && setOver(null)} onDrop={editable ? e => drop(e, m.id, d) : undefined}>
                    {lv && <span className="plan-lv">🏖 {tr(lv.kind)}</span>}</div>;
                })}
                {ls.map(({ t, lane }) => {
                  const a = colIdx(t.start), b = colIdx(addD(t.end, 1));
                  const s = Math.max(0, a), e = Math.max(s + 1, Math.min(cols.length, b));
                  return <div key={t.id} className={`plan-bar ${t.st === '지연' ? 'late' : ''}`} {...dragProps(t)} onClick={() => openTask(t.id)}
                    title={`${t.name} · ${fmt(t.start)}~${fmt(t.end)}${t.est_hours ? ' · ' + fmtH(t.est_hours) : ''}`}
                    style={{ gridColumn: `${s + 2} / ${e + 2}`, gridRow: lane + 1, '--pc': t.phase_id ? color(t.phase_id) : 'var(--accent)' }}>
                    {t.start < cols[0] ? '◀ ' : ''}<Tx>{t.name}</Tx>{t.end > last ? ' ▶' : ''}</div>;
                })}
              </div>
            );
          })}
          {!rows.length && <p className="small" style={{ padding: 12 }}>{tr('참여자가 없습니다. ‘설정’에서 참여자를 추가하세요.')}</p>}
        </div>
      </div>
    </>
  );
}
