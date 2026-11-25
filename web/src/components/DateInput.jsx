// 날짜 입력: 글자로 직접 입력할 수도 있고, 누르면 큰 달력(브라우저 기본 달력의 약 3배)이 열립니다.
// 기존 <input type="date"> 자리에 그대로 씁니다. onChange 는 { target: { value } } 형태로 부릅니다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { today, monthAdd, fmtY, fmtYW } from '../util.js';
import { tr, locale, getLang } from '../i18n.js';
import { api } from '../api.js';

// 달력에 보일 공휴일 (날짜 → 이름). 프로젝트 화면이 그 프로젝트의 휴일 달력으로 채움.
// 프로젝트 밖(홈·관리 등)에서는 한국 공휴일을 한 번 받아 씀
let HOL = null, HOL_DEFAULT = null, holLoading = false;
export function setDateHolidays(list) { HOL = list ? new Map(list.map(h => [h.date, h.name.split('/').pop().trim()])) : null; }
const holidays = () => {
  if (HOL) return HOL;
  if (!HOL_DEFAULT && !holLoading) { holLoading = true; api.get('/holidays?country=KR').then(l => { HOL_DEFAULT = new Map(l.map(h => [h.date, h.name.split('/').pop().trim()])); }).catch(() => {}); }
  return HOL_DEFAULT || new Map();
};

// 글자로 입력한 날짜 읽기: 2026.11.28 / 2026-11-28 / 20261128 / 11.28(올해). 베트남어 화면은 28/11/2026, 28/11
export function parseDate(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  let y, m, d;
  const n = t.match(/\d+/g) || [];
  if (n.length === 1 && n[0].length === 8) { y = +n[0].slice(0, 4); m = +n[0].slice(4, 6); d = +n[0].slice(6, 8); }
  else if (n.length >= 3) { if (n[0].length === 4) [y, m, d] = n.map(Number); else if (getLang() === 'vi') [d, m, y] = n.map(Number); else [m, d, y] = n.map(Number); }
  else if (n.length === 2) { y = +today().slice(0, 4); if (getLang() === 'vi') [d, m] = n.map(Number); else [m, d] = n.map(Number); }
  else return null;
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31) || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const pad = n => String(n).padStart(2, '0');
const W = () => Math.min(520, window.innerWidth - 16); // 달력 너비(px). 좁은 화면에서는 화면 폭에 맞춤

export default function DateInput({ value, onChange, title, style, disabled, className }) {
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState('');
  const [pos, setPos] = useState(null);
  const [edit, setEdit] = useState(null); // 글자로 고치는 중인 값 (null 이면 보기 모드)
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

  const pick = d => { emit(d); setEdit(null); setOpen(false); };
  const commit = () => {
    if (edit === null) return;
    const p = parseDate(edit);
    if (p !== null && p !== v) emit(p);
    setEdit(null);
  };
  const hol = holidays();
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
      <input type="text" className="dinput-t" value={edit !== null ? edit : fmtYW(v)} title={title || tr('예: 2026.11.28')} disabled={disabled}
        placeholder={getLang() === 'vi' ? 'dd/mm/yyyy' : 'yyyy.mm.dd'} inputMode="numeric"
        onFocus={() => setEdit(fmtY(v))}
        onChange={e => setEdit(e.target.value)}
        onBlur={commit}
        onClick={() => { if (!open) show(); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); }
          else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); show(); }
        }} />
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
            {wk.map((w, i) => <div key={'w' + i} className={`dpick-w ${i === 5 ? 'sat' : i === 6 ? 'we' : ''}`}>{w}</div>)}
            {cells.map((d, i) => d
              ? <button type="button" key={d} className={`dpick-d ${d === v ? 'sel' : ''} ${d === td ? 'td' : ''} ${i % 7 === 5 ? 'sat' : ''} ${i % 7 === 6 || hol.has(d) ? 'we' : ''}`} onClick={() => pick(d)} title={hol.get(d) || undefined}>
                  {+d.slice(8)}{hol.has(d) && <span className="dpick-hn">{hol.get(d)}</span>}</button>
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
