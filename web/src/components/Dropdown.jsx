import { useEffect, useRef, useState } from 'react';

// 도구 막대용 드롭다운 버튼: 누르면 아래로 선택 창이 열리고, 바깥을 누르면 닫힘
export default function Dropdown({ label, icon, active, align = 'left', title, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const k = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('pointerdown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div className="dd-wrap" ref={ref}>
      <button type="button" className={`tbtn ${active ? 'on' : ''} ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title={title}>
        {icon && <span className="ico">{icon}</span>}{label}<span className="caret">▾</span>
      </button>
      {open && <div className={`dd-pop ${align}`}>{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </div>
  );
}

export function DDCheck({ checked, onChange, children, title }) {
  return <label className="dd-row" title={title}><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />{children}</label>;
}

export function DDRadio({ checked, onClick, children }) {
  return <div className={`dd-row ${checked ? 'sel' : ''}`} onClick={onClick}><span className="dd-mark">{checked ? '✓' : ''}</span>{children}</div>;
}
