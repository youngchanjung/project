import { useEffect } from 'react';
import { tr } from '../i18n.js';

export default function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox" style={wide ? { maxWidth: 900 } : undefined}>
        <button className="x" onClick={onClose} aria-label={tr('닫기')}>×</button>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
