// 날짜·상태 도우미 (날짜는 'YYYY-MM-DD' 문자열)
const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const S = d => d.toISOString().slice(0, 10);
export const addD = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
export const diff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
export const today = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
export const fmt = s => s ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : '';
export const fmtY = s => s ? s.replace(/-/g, '.') : '';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const dow = s => DOW[D(s).getUTCDay()];
export const weekday = s => D(s).getUTCDay();
export const ddayTxt = n => n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `D+${-n}`;
export const monthAdd = (ym, n) => { const d = D(ym + '-01'); d.setUTCMonth(d.getUTCMonth() + n); return S(d).slice(0, 7); };

export function stateOf(t, td) {
  if (t.status === '완료' || t.actual_end) return '완료';
  if (t.status === '보류') return '보류';
  if (t.end < td) return '지연';
  if (t.start <= td) return '진행중';
  return '예정';
}
export const issueOpen = i => i.status !== '해결완료' && !i.resolved;
export const issueLate = (i, td) => issueOpen(i) && !!i.target && i.target < td;
export const isPoint = t => t.start === t.end && t.type !== '작업' && t.type !== '회의';

export const PALETTE = ['#2f6fde', '#8e5bd8', '#d9822b', '#159a8c', '#c2417a', '#5a7d1f', '#0f8fbf', '#b5651d', '#6b6fd6', '#9a3fa3', '#3f8f4f', '#c0392b', '#607089'];
export const phaseColor = (phases, id) => {
  const i = phases.findIndex(p => p.id === id);
  if (i < 0) return '#8a93a6';
  return phases[i].color || PALETTE[i % PALETTE.length];
};

export const TASK_TYPES = ['작업', '마일스톤', '제출', '지급', '검토', '홀드포인트', '회의'];
export const TASK_STATUS = ['미착수', '진행중', '완료', '보류'];
export const ISSUE_STATUS = ['접수', '검토중', '조치중', '해결완료', '보류'];
export const PRIORITY = ['상', '중', '하'];
export const ROLE_NAME = { pm: 'PM', member: '참여자', viewer: '조회자' };

export function downloadCSV(name, cols, rows) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const txt = '﻿' + [cols.map(c => q(c[1])).join(','), ...rows.map(r => cols.map(c => q(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' }));
  a.download = `${name}_${today()}.csv`; a.click();
}
