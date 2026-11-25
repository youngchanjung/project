// 일정 파일 불러오기: MS Project XML(.xml, MSPDI) · Primavera P6(.xer)
// 결과는 엑셀 불러오기(parseWorkbooks)와 같은 모양 { phases, tasks, deps, issues, holidays, sheets }
//  - 맨 위 요약 작업(MS Project) / 맨 위 WBS(P6) → 단계
//  - 그 아래 요약 작업 / WBS → 하위 작업이 있는 요약 작업 (parentCode 로 연결)
//  - 기준선(MS Project Baseline 0 / P6 계획일) → 기준 일정
// .mpp 는 바이너리라 MS Project 에서 "XML 형식"으로 저장한 뒤 올립니다.

const ymd = v => { const m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const KIND_MSP = { 0: 'FF', 1: 'FS', 3: 'SS' }; // 2(SF)는 지원하지 않음
const KIND_P6 = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF' };

function decode(buf) {
  const u = new TextDecoder('utf-8').decode(buf);
  if (!u.includes('�')) return u.replace(/^﻿/, '');
  try { return new TextDecoder('euc-kr').decode(buf); } catch { return u; }
}
const unxml = s => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').trim();
const tag = (x, name) => { const m = x.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? unxml(m[1]) : null; };
const status = (pct, aStart, aEnd) => (aEnd || pct >= 100 ? '완료' : aStart || pct > 0 ? '진행중' : '미착수');

export function isScheduleFile(name, buf) {
  if (/\.xer$/i.test(name)) return 'xer';
  if (/\.xml$/i.test(name)) return 'msp';
  const head = decode(buf.subarray(0, 400));
  if (head.startsWith('ERMHDR')) return 'xer';
  if (/<Project[\s>]/.test(head) && /schemas\.microsoft\.com\/project/.test(head)) return 'msp';
  return null;
}

export function parseMSProjectXML(buf) {
  const xml = decode(buf);
  if (!/<Project[\s>]/.test(xml) || !/<Tasks>/.test(xml)) throw new Error('MS Project XML 형식이 아닙니다.');
  const out = { phases: [], tasks: [], deps: [], issues: [], holidays: [], sheets: ['MS Project XML'], skipped: [] };
  const mpd = Number(tag(xml.slice(0, xml.indexOf('<Tasks>')), 'MinutesPerDay')) || 480;
  const rows = [...xml.matchAll(/<Task>([\s\S]*?)<\/Task>/g)].map(m => m[1]).map(x => ({
    x, uid: tag(x, 'UID'), name: tag(x, 'Name'), wbs: tag(x, 'WBS') || tag(x, 'OutlineNumber'), on: tag(x, 'OutlineNumber') || '',
    level: Number(tag(x, 'OutlineLevel') || 0), summary: tag(x, 'Summary') === '1', milestone: tag(x, 'Milestone') === '1', isNull: tag(x, 'IsNull') === '1'
  })).filter(r => r.uid !== '0' && r.level > 0 && !r.isNull && r.name);
  const byOn = new Map(rows.map(r => [r.on, r]));
  const codeOf = r => r.wbs || `UID${r.uid}`;
  const codeByUid = new Map(rows.map(r => [r.uid, codeOf(r)]));
  // 맨 위(1단계) 요약 → 단계. 그 아래 요약 → 요약 작업
  const phaseOf = r => { const top = byOn.get(r.on.split('.')[0]); return top && top.summary && top.level === 1 ? top.name : null; };
  for (const r of rows) if (r.summary && r.level === 1 && !out.phases.includes(r.name)) out.phases.push(r.name);
  for (const r of rows) {
    if (r.summary && r.level === 1) continue;
    const x = r.x;
    const parts = r.on.split('.');
    let parentCode = null;
    for (let i = parts.length - 1; i >= 1; i--) { const p = byOn.get(parts.slice(0, i).join('.')); if (p?.summary && p.level >= 2) { parentCode = codeOf(p); break; } }
    const start = ymd(tag(x, 'Start')), end = ymd(tag(x, 'Finish')) || start;
    if (!start) { out.skipped.push(r.name); continue; }
    const pct = Number(tag(x, 'PercentComplete') || 0);
    const aStart = ymd(tag(x, 'ActualStart')), aEnd = ymd(tag(x, 'ActualFinish'));
    const bl = [...x.matchAll(/<Baseline>([\s\S]*?)<\/Baseline>/g)].map(m => m[1]).find(b => tag(b, 'Number') === '0');
    const cType = Number(tag(x, 'ConstraintType') || 0);
    out.tasks.push({
      code: codeOf(r), phase: phaseOf(r), parentCode, name: r.name.slice(0, 300), type: r.milestone ? '마일스톤' : '작업',
      start, end: end < start ? start : end, status: status(pct, aStart, aEnd), progress: Math.max(0, Math.min(100, Math.round(pct))),
      actual_start: aStart, actual_end: aEnd, deadline: ymd(tag(x, 'Deadline')),
      not_before: cType === 4 || cType === 2 ? ymd(tag(x, 'ConstraintDate')) : null, // 4: 이후 시작, 2: 반드시 시작
      baseline_start: bl ? ymd(tag(bl, 'Start')) : null, baseline_end: bl ? ymd(tag(bl, 'Finish')) : null,
      note: (tag(x, 'Notes') || '').slice(0, 2000) || null
    });
    for (const m of x.matchAll(/<PredecessorLink>([\s\S]*?)<\/PredecessorLink>/g)) {
      const l = m[1], kind = KIND_MSP[Number(tag(l, 'Type') ?? 1)];
      const pred = codeByUid.get(tag(l, 'PredecessorUID'));
      if (!kind || !pred) { out.skipped.push(`${pred || '?'} → ${codeOf(r)} (SF)`); continue; }
      // LinkLag: 1/10분 단위. LagFormat 이 경과일(e*)이어도 근무일로 근사
      const lag = Math.round((Number(tag(l, 'LinkLag') || 0) / 10) / mpd);
      out.deps.push({ pred, succ: codeOf(r), kind, lag });
    }
  }
  return out;
}

// P6 XER: %T 표 이름, %F 열 이름, %R 값 (탭 구분)
function xerTables(text) {
  const t = {}; let cur = null, cols = null;
  for (const line of text.split(/\r?\n/)) {
    const f = line.split('\t');
    if (f[0] === '%T') { cur = f[1]; t[cur] = []; cols = null; }
    else if (f[0] === '%F') cols = f.slice(1);
    else if (f[0] === '%R' && cur && cols) { const r = {}; cols.forEach((c, i) => { r[c] = f[i + 1] ?? ''; }); t[cur].push(r); }
  }
  return t;
}

export function parseXER(buf) {
  const text = decode(buf);
  if (!text.startsWith('ERMHDR')) throw new Error('Primavera P6 XER 형식이 아닙니다.');
  const T = xerTables(text);
  if (!T.TASK) throw new Error('XER 파일에 작업(TASK) 표가 없습니다.');
  const out = { phases: [], tasks: [], deps: [], issues: [], holidays: [], sheets: ['Primavera P6 XER'], skipped: [] };
  const wbs = new Map((T.PROJWBS || []).map(w => [w.wbs_id, w]));
  const isRoot = w => !w || w.proj_node_flag === 'Y' || !wbs.has(w.parent_wbs_id);
  // WBS 경로: [맨 위 WBS, ..., 이 WBS]
  const pathOf = id => { const p = []; let w = wbs.get(id), g = 0; while (w && w.proj_node_flag !== 'Y' && g++ < 50) { p.unshift(w); w = wbs.get(w.parent_wbs_id); } return p; };
  const wcode = w => `WBS-${pathOf(w.wbs_id).map(x => x.wbs_short_name || x.wbs_id).join('.')}`;
  const usedWbs = new Set();
  for (const t of T.TASK) for (const w of pathOf(t.wbs_id)) usedWbs.add(w.wbs_id);
  // 맨 위 WBS → 단계, 그 아래 WBS → 요약 작업
  for (const id of usedWbs) {
    const w = wbs.get(id), p = pathOf(id);
    if (p.length === 1) { if (!out.phases.includes(w.wbs_name)) out.phases.push(w.wbs_name); continue; }
    const parent = p.length > 2 ? wcode(p[p.length - 2]) : null;
    out.tasks.push({ code: wcode(w), phase: p[0].wbs_name, parentCode: parent, name: w.wbs_name || w.wbs_short_name, type: '작업', summary: true });
  }
  const code = new Map(T.TASK.map(t => [t.task_id, t.task_code || `P6-${t.task_id}`]));
  for (const t of T.TASK) {
    if (t.task_type === 'TT_WBS' || t.task_type === 'TT_LOE') { out.skipped.push(t.task_name); continue; }
    const aStart = ymd(t.act_start_date), aEnd = ymd(t.act_end_date);
    const start = aStart || ymd(t.restart_date) || ymd(t.early_start_date) || ymd(t.target_start_date);
    const end = aEnd || ymd(t.reend_date) || ymd(t.early_end_date) || ymd(t.target_end_date) || start;
    if (!start) { out.skipped.push(t.task_name); continue; }
    const p = pathOf(t.wbs_id);
    const pct = Number(t.phys_complete_pct || 0);
    const st = t.status_code === 'TK_Complete' ? '완료' : t.status_code === 'TK_Active' ? '진행중' : status(pct, aStart, aEnd);
    out.tasks.push({
      code: code.get(t.task_id), phase: p[0]?.wbs_name || null, parentCode: p.length > 1 ? wcode(p[p.length - 1]) : null,
      name: (t.task_name || '').slice(0, 300), type: /Mile/.test(t.task_type) ? '마일스톤' : '작업',
      start, end: end < start ? start : end, status: st, progress: st === '완료' ? 100 : Math.max(0, Math.min(100, Math.round(pct))),
      actual_start: aStart, actual_end: aEnd,
      not_before: ['CS_MSO', 'CS_MSOA'].includes(t.cstr_type) ? ymd(t.cstr_date) : null,
      deadline: ['CS_MEOB', 'CS_MEO'].includes(t.cstr_type) ? ymd(t.cstr_date) : null,
      baseline_start: ymd(t.target_start_date), baseline_end: ymd(t.target_end_date)
    });
  }
  for (const d of T.TASKPRED || []) {
    const kind = KIND_P6[d.pred_type], pred = code.get(d.pred_task_id), succ = code.get(d.task_id);
    if (!kind || !pred || !succ) { out.skipped.push(`${pred || '?'} → ${succ || '?'} (${d.pred_type})`); continue; }
    out.deps.push({ pred, succ, kind, lag: Math.round((Number(d.lag_hr_cnt) || 0) / 8) });
  }
  return out;
}

// 날짜가 없는 요약 작업(P6 WBS)은 하위 작업의 가장 이른 시작 ~ 가장 늦은 종료로 채움
export function fillSummaryDates(parsed) {
  const kids = new Map();
  for (const t of parsed.tasks) if (t.parentCode) { if (!kids.has(t.parentCode)) kids.set(t.parentCode, []); kids.get(t.parentCode).push(t); }
  const range = (t, g = 0) => {
    if (t.start || g > 50) return t.start ? [t.start, t.end] : null;
    let s = null, e = null;
    for (const c of kids.get(t.code) || []) { const r = range(c, g + 1); if (!r) continue; if (!s || r[0] < s) s = r[0]; if (!e || r[1] > e) e = r[1]; }
    if (s) { t.start = s; t.end = e; }
    return s ? [s, e] : null;
  };
  for (const t of parsed.tasks) range(t);
  parsed.tasks = parsed.tasks.filter(t => t.start);
  // 파일에 기준선이 없으면 기존 기준 일정을 지우지 않도록 뺌
  for (const t of parsed.tasks) for (const k of ['baseline_start', 'baseline_end']) if (t[k] === null) delete t[k];
  return parsed;
}
