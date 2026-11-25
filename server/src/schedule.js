// 근무일 계산과 선행관계에 따른 자동 일정 계산
// 날짜는 모두 'YYYY-MM-DD' 문자열, 주말(토·일)과 공휴일은 근무일이 아님

const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const S = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
export const diffDays = (a, b) => Math.round((D(b) - D(a)) / 864e5);

// hol 이 null 이면 '달력일 기준' 프로젝트: 모든 날이 근무일
export function isWorkday(s, hol) {
  if (hol === null) return true;
  const w = D(s).getUTCDay();
  return w !== 0 && w !== 6 && !hol.has(s);
}

// Excel WORKDAY 와 같은 동작: n 근무일 뒤(음수면 앞)의 날짜
export function addWorkdays(s, n, hol) {
  let d = s, step = n >= 0 ? 1 : -1, left = Math.abs(n);
  if (n === 0) return d;
  while (left > 0) { d = addDays(d, step); if (isWorkday(d, hol)) left--; }
  return d;
}

export function nextWorkdayOnOrAfter(s, hol) {
  let d = s; let guard = 0;
  while (!isWorkday(d, hol) && guard++ < 60) d = addDays(d, 1);
  return d;
}

// 시작~종료(포함) 사이 근무일 수, 최소 1
export function workdaysBetween(a, b, hol) {
  if (b < a) return 1;
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (isWorkday(d, hol)) n++;
  return Math.max(1, n);
}

// 선행관계 그래프에 순환이 생기는지 검사
export function wouldCycle(deps, predId, succId) {
  if (predId === succId) return true;
  const out = new Map();
  for (const d of deps) { if (!out.has(d.pred_id)) out.set(d.pred_id, []); out.get(d.pred_id).push(d.succ_id); }
  const stack = [succId], seen = new Set();
  while (stack.length) {
    const x = stack.pop();
    if (x === predId) return true;
    if (seen.has(x)) continue; seen.add(x);
    for (const y of out.get(x) || []) stack.push(y);
  }
  return false;
}

/**
 * 선행관계가 있는 작업의 날짜를 다시 계산합니다.
 *  FS(끝-시작): 선행 종료 다음 근무일 + lag 에 시작
 *  SS(동시 시작): 선행 시작 + lag 근무일에 시작
 *  FF(동시 종료): 선행 종료 + lag 근무일에 종료
 * 선행이 여러 개면 가장 늦은 날짜를 따릅니다. 작업 기간(근무일 수)은 유지합니다.
 * 완료된 작업은 옮기지 않고, 최초 가능일(not_before)보다 앞당기지 않습니다.
 * @returns {Array<{id,start,end}>} 날짜가 바뀐 작업
 */
export function recalc(tasks0, deps, hol) {
  // 하위 작업이 있는 요약 작업은 하위 작업에서 날짜를 모으므로 선행관계 계산에서 뺌
  const parents = new Set(tasks0.map(t => t.parent_id).filter(Boolean));
  const tasks = tasks0.filter(t => !parents.has(t.id));
  const byId = new Map(tasks.map(t => [t.id, { ...t }]));
  const preds = new Map(), indeg = new Map(tasks.map(t => [t.id, 0])), out = new Map();
  for (const d of deps) {
    if (!byId.has(d.pred_id) || !byId.has(d.succ_id)) continue;
    if (!preds.has(d.succ_id)) preds.set(d.succ_id, []);
    preds.get(d.succ_id).push(d);
    if (!out.has(d.pred_id)) out.set(d.pred_id, []);
    out.get(d.pred_id).push(d.succ_id);
    indeg.set(d.succ_id, indeg.get(d.succ_id) + 1);
  }
  const queue = tasks.filter(t => indeg.get(t.id) === 0).map(t => t.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    for (const s of out.get(id) || []) { indeg.set(s, indeg.get(s) - 1); if (indeg.get(s) === 0) queue.push(s); }
  }
  const changed = [];
  for (const id of order) {
    const ps = preds.get(id); if (!ps) continue;
    const t = byId.get(id);
    if (t.status === '완료') continue;
    const single = t.start === t.end;
    const dur = single ? 1 : workdaysBetween(t.start, t.end, hol);
    let start = null, end = null;
    for (const d of ps) {
      const p = byId.get(d.pred_id);
      const lag = Number(d.lag) || 0;
      if (d.kind === 'FF') {
        const e = lag ? addWorkdays(p.end, lag, hol) : p.end;
        const s = single ? e : addWorkdays(e, -(dur - 1), hol);
        if (!start || s > start) { start = s; end = e; }
      } else {
        const s = d.kind === 'SS'
          ? (lag ? addWorkdays(p.start, lag, hol) : p.start)
          : addWorkdays(p.end, 1 + lag, hol);
        if (!start || s > start) { start = s; end = single ? s : addWorkdays(s, dur - 1, hol); }
      }
    }
    if (start && t.not_before && start < t.not_before) {
      start = nextWorkdayOnOrAfter(t.not_before, hol);
      end = single ? start : addWorkdays(start, dur - 1, hol);
    }
    if (start && (start !== t.start || end !== t.end)) {
      t.start = start; t.end = end;
      changed.push({ id, start, end });
    }
  }
  return changed;
}

/**
 * 크리티컬 패스(CPM 역방향 계산): 현재 날짜를 빠른 일정으로 보고, 선행관계를 거꾸로 따라가
 * 각 작업이 프로젝트 종료일을 늦추지 않고 밀릴 수 있는 여유(근무일)를 구합니다.
 *  FS: 선행 늦은 종료 ≤ 후행 늦은 시작 - 1 - lag
 *  SS: 선행 늦은 시작 ≤ 후행 늦은 시작 - lag
 *  FF: 선행 늦은 종료 ≤ 후행 늦은 종료 - lag
 * 완료·날짜 없는 작업은 제외. 여유가 0 이하면 크리티컬.
 * @returns {Map<id, {float:number, crit:boolean}>}
 */
export function criticalPath(tasks, deps, hol) {
  const parents = new Set(tasks.map(t => t.parent_id).filter(Boolean));
  const live = tasks.filter(t => !parents.has(t.id) && !t.undated && t.status !== '완료' && !t.actual_end && t.start && t.end);
  const res = new Map();
  if (!live.length) return res;
  let min = live[0].start, max = live[0].end;
  for (const t of live) { if (t.start < min) min = t.start; if (t.end > max) max = t.end; }
  // 근무일 누적 수: cum(d) = min~d 사이 근무일 수
  const cumMap = new Map(); let c = 0;
  for (let d = min; d <= max; d = addDays(d, 1)) { if (isWorkday(d, hol)) c++; cumMap.set(d, c); }
  const cum = d => cumMap.get(d) ?? 0;
  const node = new Map();
  for (const t of live) {
    const es = (t.start === min ? 0 : cum(addDays(t.start, -1))) + 1;
    const ef = Math.max(es, cum(t.end));
    node.set(t.id, { es, ef, dur: ef - es + 1 });
  }
  const succ = new Map(), outdeg = new Map([...node.keys()].map(id => [id, 0])), preds = new Map();
  for (const d of deps) {
    if (!node.has(d.pred_id) || !node.has(d.succ_id)) continue;
    if (!succ.has(d.pred_id)) succ.set(d.pred_id, []);
    succ.get(d.pred_id).push(d);
    if (!preds.has(d.succ_id)) preds.set(d.succ_id, []);
    preds.get(d.succ_id).push(d.pred_id);
    outdeg.set(d.pred_id, outdeg.get(d.pred_id) + 1);
  }
  let end = 0; for (const n of node.values()) if (n.ef > end) end = n.ef;
  const queue = [...node.keys()].filter(id => outdeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift(), n = node.get(id);
    let lf = end;
    for (const d of succ.get(id) || []) {
      const s = node.get(d.succ_id), lag = Number(d.lag) || 0;
      const v = d.kind === 'SS' ? s.ls - lag + n.dur - 1 : d.kind === 'FF' ? s.lf - lag : s.ls - 1 - lag;
      if (v < lf) lf = v;
    }
    n.lf = lf; n.ls = lf - n.dur + 1;
    res.set(id, { float: lf - n.ef, crit: lf - n.ef <= 0 });
    for (const p of preds.get(id) || []) { outdeg.set(p, outdeg.get(p) - 1); if (outdeg.get(p) === 0) queue.push(p); }
  }
  return res;
}

/**
 * 요약 작업(하위 작업이 있는 작업)의 시작·종료·진행률을 하위 작업에서 모읍니다. 여러 단계도 아래에서부터.
 * 진행률은 기간(일)으로 가중 평균. 하위가 모두 완료면 요약도 완료.
 * @returns {Array<{id,start,end,progress,status}>} 바뀐 요약 작업
 */
export function rollup(tasks) {
  const byId = new Map(tasks.map(t => [t.id, { ...t }]));
  const kids = new Map();
  for (const t of byId.values()) if (t.parent_id && byId.has(t.parent_id)) { if (!kids.has(t.parent_id)) kids.set(t.parent_id, []); kids.get(t.parent_id).push(t); }
  const depth = id => { let d = 0, x = byId.get(id), g = 0; while (x?.parent_id && byId.has(x.parent_id) && g++ < 50) { d++; x = byId.get(x.parent_id); } return d; };
  const order = [...kids.keys()].sort((a, b) => depth(b) - depth(a));
  const changed = [];
  for (const id of order) {
    const p = byId.get(id), cs = kids.get(id).filter(c => !c.undated);
    if (!cs.length) continue;
    let start = cs[0].start, end = cs[0].end, w = 0, sum = 0;
    for (const c of cs) {
      if (c.start < start) start = c.start; if (c.end > end) end = c.end;
      const d = diffDays(c.start, c.end) + 1; w += d; sum += d * (c.status === '완료' ? 100 : Number(c.progress) || 0);
    }
    const progress = Math.round(sum / w);
    const allDone = cs.every(c => c.status === '완료');
    const status = allDone ? '완료' : cs.some(c => c.status === '진행중' || c.status === '완료' || Number(c.progress) > 0) ? '진행중' : (p.status === '완료' ? '미착수' : p.status);
    if (start !== p.start || end !== p.end || progress !== p.progress || status !== p.status || p.undated) {
      Object.assign(p, { start, end, progress, status, undated: false });
      changed.push({ id, start, end, progress, status });
    }
  }
  return changed;
}

// 오늘 기준 작업 상태(화면 표시용)
export function stateOf(t, today) {
  if (t.status === '완료' || t.actual_end) return '완료';
  if (t.status === '보류') return '보류';
  if (t.undated) return t.status === '진행중' ? '진행중' : '예정';
  if (t.end < today) return '지연';
  if (t.start <= today || t.status === '진행중') return '진행중';
  return '예정';
}
