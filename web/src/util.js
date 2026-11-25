// 날짜·상태 도우미 (날짜는 'YYYY-MM-DD' 문자열)
import { locale, tr, getLang } from './i18n.js';
const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const S = d => d.toISOString().slice(0, 10);
export const addD = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
export const diff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
export const today = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
// 날짜 표기 (화면 공통). 한국어·영어: 11/28, 2026.11.28 / 베트남어: 28/11, 28/11/2026
export const fmt = s => s ? (getLang() === 'vi' ? `${+s.slice(8, 10)}/${+s.slice(5, 7)}` : `${+s.slice(5, 7)}/${+s.slice(8, 10)}`) : '';
export const fmtY = s => s ? (getLang() === 'vi' ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s.replace(/-/g, '.')) : '';
// 요일을 붙인 표기: 11/28 (토), 2026.11.28 (토)
export const fmtW = s => s ? `${fmt(s)} (${dow(s)})` : '';
export const fmtYW = s => s ? `${fmtY(s)} (${dow(s)})` : '';
// 요일 약칭 (화면 언어에 맞춤: 월 / Th 2 / Mon)
export const dow = s => new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(D(s));
export const weekday = s => D(s).getUTCDay();
// 남은 날: D-3 / 오늘: D-Day / 지난 날: '2일 지남'
export const ddayTxt = n => n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : tr('{n}일 지남', { n: -n });
export const monthAdd = (ym, n) => { const d = D(ym + '-01'); d.setUTCMonth(d.getUTCMonth() + n); return S(d).slice(0, 7); };

export function stateOf(t, td) {
  if (t.status === '완료' || t.actual_end) return '완료';
  if (t.status === '보류') return '보류';
  if (t.undated) return t.status === '진행중' ? '진행중' : '예정';
  if (t.end < td) return '지연';
  if (t.start <= td || t.status === '진행중') return '진행중';
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

export const TASK_TYPES = ['작업', '마일스톤', '제출', '지급', '검토', '홀드포인트', '회의', '시험'];
export const TASK_STATUS = ['미착수', '진행중', '완료', '보류'];
// 화면에 보이는 상태 이름. 저장값 '미착수'는 화면에서 '예정'으로 통일
export const statusLabel = s => (s === '미착수' ? '예정' : s);
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
  return [['code', 'ID'], [t => phaseName(t.phase_id), '단계'], ['name', '작업'], ['name_en', '작업명(영문)'], [t => tr(t.type), '유형'], ['owner', '담당'], ['company', '업체'], ['trade', '공종'],
    ['start', '시작'], ['end', '종료'], [t => (t.st ? tr(t.st) : tr(t.status)), '상태'], ['progress', '진행률'], [t => (t.is_key ? '★' : ''), '핵심'],
    [t => predOf(t.id), '선행작업'], ['deadline', '마감 기한'], ['baseline_start', '기준 시작'], ['baseline_end', '기준 종료'],
    [t => (t.baseline_end && t.end ? diff(t.baseline_end, t.end) : ''), '편차'], [t => (t.float ?? ''), '여유(근무일)'], [t => (t.crit ? 'CP' : ''), '크리티컬'], ['actual_start', '실제 시작'], ['actual_end', '실제 완료'], ['ref', '계약 조항'], ['note', '비고']];
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

// ---- 카테고리 (11/24 개정 계획) ----
// view: 프로젝트를 열면 먼저 보이는 화면, tabs: 탭 순서
export const CATEGORIES = [
  { key: 'research', name: '연구', icon: '🔬', color: '#8e5bd8', desc: '회의·시험·보고 일정 중심 (Teams·Outlook 연동 예정)',
    view: 'schedule', tabs: ['schedule', 'tasks', 'meetings', 'board', 'gantt', 'issues', 'dashboard', 'settings'] },
  { key: 'construction', name: '시공', icon: '🏗️', color: '#d9822b', desc: '상세 스케줄: 간트·크리티컬 패스·기준선·룩어헤드',
    view: 'gantt', tabs: ['gantt', 'lookahead', 'tasks', 'progress', 'calendar', 'dashboard', 'issues', 'board', 'meetings', 'settings'] },
  { key: 'design', name: '설계', icon: '📐', color: '#159a8c', desc: '할 일을 카드로 만들고 칸반에서 끌어 옮기기',
    view: 'board', tabs: ['board', 'plan', 'workload', 'tasks', 'calendar', 'gantt', 'issues', 'meetings', 'dashboard', 'settings'] }
];
// 단계 제출일 위험: 제출일이 있는 단계마다 남은 날·미완료·검토 대기·제출일 뒤 마감 건수
//   level: late(제출일 지남, 미완료 있음) | warn(7일 안 또는 제출일 뒤 마감 카드) | info(14일 안) | done(모두 완료)
export function phaseRisks(phases, tasks, td) {
  return phases.filter(p => p.due).map(p => {
    const ts = tasks.filter(t => t.phase_id === p.id);
    const open = ts.filter(t => t.st !== '완료' && t.st !== '보류');
    const after = open.filter(t => !t.undated && t.end > p.due).length;
    const n = diff(td, p.due);
    const level = !open.length ? 'done' : n < 0 ? 'late' : n <= 7 || after ? 'warn' : 'info';
    return { phase: p, n, total: ts.length, open: open.length, review: open.filter(t => t.review_state === 'requested').length, after, level };
  }).filter(r => (r.level === 'done' ? r.n >= 0 && r.n <= 7 : r.level !== 'info' || r.n <= 14))
    .sort((a, b) => a.phase.due.localeCompare(b.phase.due));
}
// 예상 시간 표기: 8 → 8h, 1.5 → 1.5h
export const fmtH = h => (h || h === 0 ? `${Math.round(h * 10) / 10}h` : '');
export const catOf = key => CATEGORIES.find(c => c.key === key) || CATEGORIES[1];
// 새 프로젝트 기본 단계 (카테고리별 예시)
export const CATEGORY_PHASES = { research: '1차년도, 2차년도', construction: '준비, 시공, 검사, 준공', design: '' };
export const TASK_PRIORITY = ['낮음', '보통', '높음', '긴급'];
// 사람마다 고정된 아바타 색 (계정 번호로 정함)
export const AVATAR_COLORS = ['#2f6fde', '#16a37a', '#c2410c', '#8b5cf6', '#db2777', '#0e7490', '#a16207', '#4d7c0f', '#be123c', '#475569'];
export const personColor = id => AVATAR_COLORS[(Number(id) || 0) % AVATAR_COLORS.length];
export const PRIORITY_COLOR = { 낮음: 'var(--plan)', 보통: 'var(--muted)', 높음: 'var(--soon)', 긴급: 'var(--late)' };
export const splitTags = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
// 칸반에서 카드가 보이는 열: 지정된 열이 있으면 그 열, 없으면 상태가 같은 첫 열
export function columnOf(t, columns) {
  if (t.board_column_id && columns.some(c => c.id === t.board_column_id)) return t.board_column_id;
  return (columns.find(c => c.status === t.status) || columns[0])?.id;
}
// 마감 표시: 날짜 없는 할 일은 빈 값
export const dueOf = t => (t.undated ? '' : t.end);
// D-day 문구: 시작 전 기간 작업은 "시작 D-n", 그 밖에는 "마감 D-n" (상태 st 또는 state)
export function ddayLabel(t, td) {
  const st = t.st || t.state;
  if (st === '완료' || t.undated) return '';
  const startPhase = st === '예정' && t.start !== t.end;
  return `${tr(startPhase ? '시작' : '마감')} ${ddayTxt(diff(td, startPhase ? t.start : t.end))}`;
}
// 회의 참석자 (쉼표로 구분한 계정 id)
export const attendeeIds = t => String(t.attendees || '').split(',').map(Number).filter(Boolean);
// 일정 종류별 표시 (연구 일정 화면)
export const KIND_STYLE = {
  회의: { icon: '👥', color: '#2f6fde' }, 시험: { icon: '🧪', color: '#8e5bd8' }, 마일스톤: { icon: '◆', color: '#d6453d' },
  제출: { icon: '📤', color: '#d9822b' }, 검토: { icon: '👀', color: '#159a8c' }
};
export const kindOf = t => KIND_STYLE[t.type] || { icon: '•', color: 'var(--plan)' };
