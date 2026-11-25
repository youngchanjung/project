// 사람별 업무량: 담당 할 일의 예상 시간을 시작~마감 사이 근무일에 고르게 나눠 주별로 합산
//   - 이미 지난 날 몫은 오늘부터 남은 근무일에 다시 나눔 (지연된 할 일은 전부 이번 주)
//   - 날짜 없는 할 일은 주에 넣지 않고 따로 셈
//   - 예상 시간이 없는 할 일은 건수만 셈 (화면에 '시간 미입력'으로 표시)
import { addDays, isWorkday } from './schedule.js';

const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const mondayOf = s => addDays(s, -((D(s).getUTCDay() + 6) % 7));
const r1 = x => Math.round(x * 10) / 10;

// tasks: { id, project_id, assignee_id, start, end, undated, est_hours, status, actual_end, ... }
// opt: { today, weeks, hol (Set), here (기준 프로젝트 id, 없으면 null) }
export function computeWorkload(tasks, { today, weeks = 4, hol = new Set(), here = null }) {
  const w0 = mondayOf(today);
  const ws = Array.from({ length: weeks }, (_, i) => {
    const start = addDays(w0, i * 7), end = addDays(start, 6);
    let workdays = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkday(d, hol)) workdays++;
    return { start, end, workdays };
  });
  const last = ws[ws.length - 1].end;
  const weekIdx = d => (d < w0 || d > last ? -1 : Math.floor((D(d) - D(w0)) / (7 * 864e5)));
  const byUser = new Map();
  const row = uid => {
    if (!byUser.has(uid)) byUser.set(uid, { weeks: ws.map(() => ({ hours: 0, here: 0, count: 0, noEst: 0, tasks: [] })), undated: { count: 0, hours: 0 } });
    return byUser.get(uid);
  };
  for (const t of tasks) {
    if (t.status === '완료' || t.status === '보류' || t.actual_end) continue;
    const uid = t.assignee_id || 0;
    const h = Number(t.est_hours) || 0;
    const r = row(uid);
    if (t.undated) { r.undated.count++; r.undated.hours = r1(r.undated.hours + h); continue; }
    // 남은 기간: 오늘(이전에 시작했으면) ~ 마감 (지났으면 오늘 하루)
    const from = t.start > today ? t.start : today;
    const to = t.end < from ? from : t.end;
    if (from > last) continue;
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, hol)) days.push(d);
    if (!days.length) days.push(from);
    const per = h / days.length;
    const got = new Map();
    for (const d of days) { const i = weekIdx(d); if (i >= 0) got.set(i, (got.get(i) || 0) + per); }
    for (const [i, hw] of got) {
      const c = r.weeks[i];
      c.hours += hw; if (here && t.project_id === here) c.here += hw;
      c.count++; if (!h) c.noEst++;
      c.tasks.push({ id: t.id, project_id: t.project_id, name: t.name, end: t.end, hours: r1(hw), est: !!h, here: !here || t.project_id === here });
    }
  }
  for (const r of byUser.values()) for (const c of r.weeks) { c.hours = r1(c.hours); c.here = r1(c.here); c.tasks.sort((a, b) => a.end.localeCompare(b.end)); }
  return { weeks: ws, byUser };
}

// 휴가·부재로 빠지는 시간: 주마다 { days, hours } (반차는 0.5일). perDay = 주당 근무 시간 / 5
export function leaveByWeek(leaves, weeks, hol, perDay) {
  return weeks.map(w => {
    let days = 0;
    for (const l of leaves) {
      for (let d = l.start < w.start ? w.start : l.start; d <= w.end && d <= l.end; d = addDays(d, 1)) {
        if (isWorkday(d, hol)) days += l.kind === '반차' ? 0.5 : 1;
      }
    }
    days = Math.min(days, w.workdays);
    return { days, hours: r1(days * perDay) };
  });
}
// 이 날 휴가 중인가 (반차 제외)
export const onLeave = (leaves, uid, d) => leaves.some(l => l.user_id === uid && l.kind !== '반차' && l.start <= d && d <= l.end);
