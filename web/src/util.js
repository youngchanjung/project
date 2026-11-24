// 날짜·상태 도우미 (날짜는 'YYYY-MM-DD' 문자열)
import { locale, tr, getLang } from './i18n.js';
const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const S = d => d.toISOString().slice(0, 10);
export const addD = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
export const diff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
export const today = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
export const fmt = s => s ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : '';
export const fmtY = s => s ? s.replace(/-/g, '.') : '';
// 요일 약칭 (화면 언어에 맞춤: 월 / Th 2 / Mon)
export const dow = s => new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(D(s));
export const weekday = s => D(s).getUTCDay();
export const ddayTxt = n => n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `D+${-n}`;
export const monthAdd = (ym, n) => { const d = D(ym + '-01'); d.setUTCMonth(d.getUTCMonth() + n); return S(d).slice(0, 7); };

export function stateOf(t, td) {
  if (t.status === '완료' || t.actual_end) return '완료';
  if (t.status === '보류') return '보류';
  if (t.undated) return t.status === '진행중' ? '진행중' : '예정';
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

// 화면의 표를 엑셀로: sheets = [{ name, cols: [[필드 또는 (행)=>값, '머리글'], ...], rows }]
export async function downloadXLSX(name, sheets) {
  const body = {
    name: `${name}_${today()}`,
    sheets: sheets.map(s => ({
      name: tr(s.name),
      header: s.cols.map(c => tr(c[1])),
      rows: s.rows.map(r => s.cols.map(c => { const v = typeof c[0] === 'function' ? c[0](r) : r[c[0]]; return v ?? ''; }))
    }))
  };
  const res = await fetch('/api/sheet.xlsx', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Lang': getLang() }, body: JSON.stringify(body) });
  if (!res.ok) { let m; try { m = (await res.json()).error; } catch { /* 무시 */ } throw new Error(m || tr('요청 실패 ({n})', { n: res.status })); }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = `${body.name}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// 작업 표의 공통 열 (화면마다 같은 모양으로 내보내기)
export function taskCols({ phases, tasks, deps }) {
  const code = new Map(tasks.map(t => [t.id, t.code || `#${t.id}`]));
  const phaseName = id => phases.find(p => p.id === id)?.name || '';
  const predOf = id => deps.filter(d => d.succ_id === id).map(d => `${code.get(d.pred_id)}${d.kind !== 'FS' ? ' ' + d.kind : ''}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}`).join(', ');
  return [['code', 'ID'], [t => phaseName(t.phase_id), '단계'], ['name', '작업'], ['name_en', '작업명(영문)'], [t => tr(t.type), '유형'], ['owner', '담당'],
    ['start', '시작'], ['end', '종료'], [t => (t.st ? tr(t.st) : tr(t.status)), '상태'], ['progress', '진행률'], [t => (t.is_key ? '★' : ''), '핵심'],
    [t => predOf(t.id), '선행작업'], ['baseline_start', '기준 시작'], ['baseline_end', '기준 종료'],
    [t => (t.baseline_end && t.end ? diff(t.baseline_end, t.end) : ''), '편차'], ['actual_end', '실제 완료'], ['ref', '계약 조항'], ['note', '비고']];
}
export function issueCols({ tasks }) {
  const code = new Map(tasks.map(t => [t.id, t.code || `#${t.id}`]));
  return [['code', 'No'], [i => tr(i.priority), '중요도'], ['category', '구분'], ['title', '이슈'], ['detail', '상세'], [i => (i.task_id ? code.get(i.task_id) : ''), '관련 작업 ID'],
    ['party', '책임기관'], ['owner', '담당자'], ['raised', '발생일'], ['target', '목표일'], ['resolved', '해결일'], [i => tr(i.status), '현황'], ['source', '출처'], ['remark', '비고']];
}

export function downloadCSV(name, cols, rows) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const txt = '﻿' + [cols.map(c => q(tr(c[1]))).join(','), ...rows.map(r => cols.map(c => q(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' }));
  a.download = `${name}_${today()}.csv`; a.click();
}
