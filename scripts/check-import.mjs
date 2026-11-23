// 엑셀 불러오기 미리 점검 (DB 를 쓰지 않음)
//   node scripts/check-import.mjs <엑셀 파일> [<엑셀 파일> ...]
// 프로그램이 파일을 어떻게 읽는지, 선행관계 규칙으로 다시 계산하면 엑셀 날짜와 어디가 달라지는지 보여 줍니다.
import fs from 'node:fs';
import path from 'node:path';
import { parseWorkbooks } from '../server/src/excel.js';
import { recalc } from '../server/src/schedule.js';

const files = process.argv.slice(2);
if (!files.length) { console.error('사용법: node scripts/check-import.mjs <엑셀 파일> ...'); process.exit(1); }

for (const f of files) {
  console.log(`\n=== ${path.basename(f)} ===`);
  const p = parseWorkbooks([fs.readFileSync(f)]);
  console.log(`인식한 시트: ${p.sheets.join(', ') || '(없음)'}`);
  console.log(`단계 ${p.phases.length} · 작업 ${p.tasks.length} · 선행관계 ${p.deps.length} · 이슈 ${p.issues.length} · 공휴일 ${p.holidays.length}`);

  // 같은 ID 중복
  const seen = new Map();
  for (const t of p.tasks) if (t.code) seen.set(t.code, (seen.get(t.code) || 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1);
  if (dup.length) console.log(`중복 ID ${dup.length}개 (뒤의 것이 앞의 것을 덮어씀): ${dup.slice(0, 20).map(([c, n]) => `${c}×${n}`).join(', ')}`);

  // 이름 없는/날짜 뒤집힌 작업
  const bad = p.tasks.filter(t => t.end < t.start);
  if (bad.length) console.log(`종료일이 시작일보다 앞선 작업 ${bad.length}개: ${bad.slice(0, 20).map(t => t.code).join(', ')}`);

  // 선행관계 점검
  const tasks = p.tasks.map((t, i) => ({ ...t, id: i + 1 }));
  const byCode = new Map(tasks.filter(t => t.code).map(t => [t.code, t]));
  const missing = [], deps = [];
  for (const d of p.deps) {
    const a = byCode.get(d.pred), b = byCode.get(d.succ);
    if (!a || !b || a === b) missing.push(`${d.pred} → ${d.succ}`);
    else deps.push({ pred_id: a.id, succ_id: b.id, kind: d.kind, lag: d.lag });
  }
  if (missing.length) console.log(`연결 못 한 선행관계 ${missing.length}개 (선행 ID 가 파일에 없음): ${missing.slice(0, 20).join(', ')}`);

  // 순환
  const indeg = new Map(tasks.map(t => [t.id, 0])), out = new Map();
  for (const d of deps) { indeg.set(d.succ_id, indeg.get(d.succ_id) + 1); (out.get(d.pred_id) || out.set(d.pred_id, []).get(d.pred_id)).push(d.succ_id); }
  const q = tasks.filter(t => !indeg.get(t.id)).map(t => t.id); let n = 0;
  while (q.length) { const id = q.shift(); n++; for (const s of out.get(id) || []) { indeg.set(s, indeg.get(s) - 1); if (!indeg.get(s)) q.push(s); } }
  if (n < tasks.length) console.log(`순환 선행관계에 걸린 작업 ${tasks.length - n}개: ${tasks.filter(t => indeg.get(t.id) > 0).slice(0, 20).map(t => t.code).join(', ')}`);

  // 다시 계산했을 때 엑셀과 다른 날짜 (계약 Detail 은 달력일, 그 밖은 근무일+공휴일 기준)
  const calendarBasis = p.sheets.some(s => /Detail$/i.test(s));
  const hol = calendarBasis ? null : new Set(p.holidays.map(h => h.date));
  const changed = recalc(tasks, deps, hol);
  console.log(`계산 기준: ${calendarBasis ? '달력일' : '근무일(주말·공휴일 제외)'} → 엑셀 날짜와 다르게 계산되는 작업 ${changed.length}개`);
  for (const c of changed.slice(0, 30)) {
    const t = tasks[c.id - 1];
    console.log(`  ${t.code}  ${t.name?.slice(0, 30)}  엑셀 ${t.start}~${t.end}  →  계산 ${c.start}~${c.end}`);
  }

  // 이슈 → 작업 연결
  const orphan = p.issues.filter(i => i.task && !byCode.has(i.task));
  if (p.issues.length) console.log(`이슈 중 관련 작업을 못 찾은 것 ${orphan.length}개${orphan.length ? ': ' + orphan.slice(0, 20).map(i => `${i.code}(${i.task})`).join(', ') : ''}`);
  const st = {}; for (const i of p.issues) st[i.status] = (st[i.status] || 0) + 1;
  if (p.issues.length) console.log(`이슈 현황: ${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const ts = {}; for (const t of p.tasks) ts[t.status] = (ts[t.status] || 0) + 1;
  console.log(`작업 상태: ${Object.entries(ts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
