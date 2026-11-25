// 날짜 입력: 글자로 직접 입력할 수도 있고, 누르면 큰 달력(브라우저 기본 달력의 약 3배)이 열립니다.
// 기존 <input type="date"> 자리에 그대로 씁니다. onChange 는 { target: { value } } 형태로 부릅니다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { today, monthAdd } from '../util.js';
import { tr, locale } from '../i18n.js';

const pad = n => String(n).padStart(2, '0');
const W = () => Math.min(520, window.innerWidth - 16); // 달력 너비(px). 좁은 화면에서는 화면 폭에 맞춤

export default function DateInput({ value, onChange, title, style, disabled, className }) {
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState('');
  const [pos, setPos] = useState(null);
  const box = useRef(null), pop = useRef(null);
  const v = value || '';
  const emit = x => onChange && onChange({ target: { value: x } });

  const show = () => { if (disabled) return; setYm((v || today()).slice(0, 7)); setOpen(true); };
  const place = () => {
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    const h = pop.current?.offsetHeight || 560;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W() - 8));
    const below = r.bottom + 6, above = r.top - 6 - h;
    setPos({ left, top: below + h <= window.innerHeight - 8 || above < 8 ? Math.max(8, Math.min(below, window.innerHeight - h - 8)) : above });
  };
  useLayoutEffect(() => { if (open) place(); }, [open, ym]); // eslint-disable-line
  useEffect(() => {
    if (!open) return;
    const down = e => { if (!pop.current?.contains(e.target) && !box.current?.contains(e.target)) setOpen(false); };
    // 편집창의 Esc(창 닫기)보다 먼저 받아 달력만 닫음
    const key = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); setOpen(false); } };
    const re = () => place();
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', re);
    window.addEventListener('scroll', re, true);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', re); window.removeEventListener('scroll', re, true); };
  }, [open]); // eslint-disable-line

  const pick = d => { emit(d); setOpen(false); };
  const td = today();
  const [y, m] = ym ? ym.split('-').map(Number) : [0, 0];
  const first = ym ? new Date(Date.UTC(y, m - 1, 1)) : null;
  const lead = first ? (first.getUTCDay() + 6) % 7 : 0; // 월요일 시작
  const days = first ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 0;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const wk = ym ? [...Array(7)].map((_, i) => new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i)))) : [];
  const title2 = ym ? new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(first) : '';

  return (
    <span ref={box} className={`dinput ${className || ''}`} style={style}>
      <input type="date" value={v} title={title} disabled={disabled}
        onChange={e => emit(e.target.value)}
        onClick={e => { e.preventDefault(); show(); }}
        onKeyDown={e => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); show(); } }} />
      <button type="button" className="dinput-btn" tabIndex={-1} disabled={disabled} onClick={() => (open ? setOpen(false) : show())} title={tr('달력에서 고르기')}>📅</button>
      {open && createPortal(
        <div ref={pop} className="dpick" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: W() }} onMouseDown={e => e.stopPropagation()}>
          <div className="dpick-h">
            <button type="button" className="dpick-nav" onClick={() => setYm(monthAdd(ym, -12))} title={tr('이전 해')}>«</button>
            <button type="button" className="dpick-nav" onClick={() => setYm(monthAdd(ym, -1))} title={tr('이전 달')}>‹</button>
            <b className="dpick-t">{title2}</b>
            <button type="button" className="dpick-nav" onClick={() => setYm(monthAdd(ym, 1))} title={tr('다음 달')}>›</button>
            <button type="button" className="dpick-nav" onClick={() => setYm(monthAdd(ym, 12))} title={tr('다음 해')}>»</button>
          </div>
          <div className="dpick-g">
            {wk.map((w, i) => <div key={'w' + i} className={`dpick-w ${i >= 5 ? 'we' : ''}`}>{w}</div>)}
            {cells.map((d, i) => d
              ? <button type="button" key={d} className={`dpick-d ${d === v ? 'sel' : ''} ${d === td ? 'td' : ''} ${i % 7 >= 5 ? 'we' : ''}`} onClick={() => pick(d)}>{+d.slice(8)}</button>
              : <div key={'e' + i} />)}
          </div>
          <div className="dpick-f">
            <button type="button" className="btn" onClick={() => pick(td)}>{tr('오늘')}</button>
            {v && <button type="button" className="btn" onClick={() => pick('')}>{tr('지우기')}</button>}
            <div className="sp" />
            <button type="button" className="btn" onClick={() => setOpen(false)}>{tr('닫기')}</button>
          </div>
        </div>, document.body)}
    </span>
  );
}
