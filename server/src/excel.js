// 엑셀 불러오기/내보내기
// 지원 형식
//  1) 계약 일정 통합본: "*_Detail" 시트 (ID / Contract / Task EN / Task KR / ... / Predecessor / Lag / Start with / Finish with ...)
//     + "Holidays" 시트 (베트남 공휴일)
//  2) 일정표·이슈로그: "일정표_Schedule" 시트 + "이슈로그_IssueLog" 시트
//  3) 이 프로그램에서 내보낸 파일: "작업" + "이슈" 시트 (다시 불러오기 가능)
import XLSX from 'xlsx';

const s = v => (v == null ? '' : String(v).trim());
const strip = v => s(v).replace(/\s*\(.*\)\s*$/, '');
function iso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600e3); return d.toISOString().slice(0, 10); }
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null; }
  const m = String(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}
const rowsOf = ws => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

const PHASE_NAMES = { '00': '공통', '01': '구조조사', '02': '설계', '03': 'BIM', '04': '시공', '05': '감리' };
const TYPE_MAP = { Task: '작업', Milestone: '마일스톤', Submission: '제출', Payment: '지급', Review: '검토', 'Hold point': '홀드포인트', Meeting: '회의' };
function mapType(v) {
  const t = s(v); if (!t) return '작업';
  const en = t.split('/')[0].trim(), ko = t.split('/').pop().trim();
  return TYPE_MAP[en] || (['작업', '마일스톤', '제출', '지급', '검토', '홀드포인트', '회의'].includes(ko) ? ko : '작업');
}
function mapTaskStatus(v) {
  const t = s(v);
  if (/done|완료/i.test(t)) return '완료';
  if (/progress|진행/i.test(t)) return '진행중';
  if (/hold|보류/i.test(t)) return '보류';
  return '미착수';
}
function mapIssueStatus(v) {
  const t = strip(v);
  return ['접수', '검토중', '조치중', '해결완료', '보류'].includes(t) ? t : (/resolved|해결/i.test(s(v)) ? '해결완료' : '접수');
}

/**
 * 워크북들을 읽어 공통 구조로 변환
 * @returns {{phases: string[], tasks: object[], deps: object[], issues: object[], holidays: object[], sheets: string[]}}
 */
export function parseWorkbooks(buffers) {
  const out = { phases: [], tasks: [], deps: [], issues: [], holidays: [], sheets: [] };
  const phase = n => { if (!out.phases.includes(n)) out.phases.push(n); return n; };

  for (const buf of buffers) {
    const wb = XLSX.read(buf, { cellDates: true });
    // 1) 계약 Detail 시트
    for (const sn of wb.SheetNames.filter(n => /Detail$/i.test(n))) {
      const rows = rowsOf(wb.Sheets[sn]);
      const h = rows.findIndex(r => r && /^ID/.test(s(r[0])) && /Contract/.test(s(r[1])));
      if (h < 0) continue;
      out.sheets.push(sn);
      const sheetTasks = [];
      const code = sn.slice(0, 2);
      const ph = phase(`${code} ${PHASE_NAMES[code] || sn.replace(/ Detail$/, '').slice(3)}`);
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i]; if (!r || !s(r[0]) || /^Colou?rs/.test(s(r[0]))) continue;
        const note = s(r[25]);
        if (code === '00' && /Auto from/i.test(note)) continue; // 공통 시트의 다른 계약 복사본
        const start = iso(r[15]) || iso(r[13]), end = iso(r[16]) || iso(r[14]) || start;
        if (!start) continue;
        const id = s(r[0]);
        const t = {
          code: id, phase: ph, name: s(r[3]) || s(r[2]), name_en: s(r[2]) && s(r[2]) !== s(r[3]) ? s(r[2]) : null,
          owner: s(r[4]) || null, ref: s(r[5]) && s(r[5]) !== '—' ? s(r[5]) : null, type: mapType(r[6]),
          start, end, baseline_end: iso(r[20]), actual_end: iso(r[24]),
          status: iso(r[24]) || /done/i.test(s(r[18])) ? '완료' : mapTaskStatus(r[17]),
          is_key: s(r[27]) === 'Y', note: note || null, not_before: iso(r[30]), contract: s(r[1]) || null
        };
        const manualStart = iso(r[13]);
        const rel = [];
        for (const [pc, lc] of [[7, 8], [9, 10]]) if (s(r[pc])) rel.push({ pred: s(r[pc]), succ: id, kind: 'FS', lag: Number(r[lc]) || 0 });
        if (s(r[11])) rel.push({ pred: s(r[11]), succ: id, kind: 'SS', lag: 0 });
        if (s(r[12])) rel.push({ pred: s(r[12]), succ: id, kind: 'FF', lag: 0 });
        if (manualStart && rel.length) {
          // 엑셀에서 시작일을 직접 입력한 작업은 입력값이 우선이므로 선행관계는 비고에만 남김
          t.note = [t.note, `엑셀 선행관계(시작일 직접 입력으로 미적용): ${rel.map(d => `${d.pred} ${d.kind}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}`).join(', ')}`].filter(Boolean).join(' / ');
        } else out.deps.push(...rel);
        out.tasks.push(t); sheetTasks.push(t);
      }
      // 한 시트에 계약이 여럿이면 같은 이름의 작업이 생김 (예: BIM 의 Integra–BIMLab / Myrius–BIMLab) → 이름 뒤에 계약을 붙여 구분
      const byName = new Map();
      for (const t of sheetTasks) byName.set(t.name, [...(byName.get(t.name) || []), t]);
      for (const same of byName.values()) {
        if (same.length < 2 || new Set(same.map(t => t.contract)).size < 2) continue;
        for (const t of same) if (t.contract) { t.name = `${t.name} (${t.contract})`; if (t.name_en) t.name_en = `${t.name_en} (${t.contract})`; }
      }
      for (const t of sheetTasks) delete t.contract;
    }
    // 공휴일
    if (wb.SheetNames.includes('Holidays')) {
      out.sheets.push('Holidays');
      for (const r of rowsOf(wb.Sheets.Holidays)) { const d = r && iso(r[0]); if (d) out.holidays.push({ country: 'VN', date: d, name: s(r[1]) }); }
    }
    // 2) 일정표
    const schedName = wb.SheetNames.find(n => /Schedule/i.test(n) && /일정/.test(n));
    if (schedName) {
      const rows = rowsOf(wb.Sheets[schedName]);
      const h = rows.findIndex(r => r && s(r[0]) === 'No');
      if (h >= 0) {
        out.sheets.push(schedName);
        for (let i = h + 1; i < rows.length; i++) {
          const r = rows[i]; if (!r || r[0] == null || !s(r[2])) continue;
          const start = iso(r[3]), end = iso(r[4]) || start; if (!start) continue;
          out.tasks.push({
            code: `S-${s(r[0])}`, phase: phase(`현장 ${strip(r[1]) || '기타'}`), name: s(r[2]), type: start === end ? '마일스톤' : '작업',
            start, end, status: mapTaskStatus(r[5]), note: s(r[6]) || null
          });
        }
      }
    }
    // 이슈로그
    const issName = wb.SheetNames.find(n => /Issue/i.test(n) && /이슈/.test(n));
    if (issName) {
      const rows = rowsOf(wb.Sheets[issName]);
      const h = rows.findIndex(r => r && /^이슈 No/.test(s(r[0])));
      if (h >= 0) {
        out.sheets.push(issName);
        for (let i = h + 1; i < rows.length; i++) {
          const r = rows[i]; if (!r || !s(r[0]) || !s(r[3])) continue;
          out.issues.push({
            code: s(r[0]), task: s(r[1]) ? `S-${s(r[1])}` : null, category: strip(r[2]) || null, title: s(r[3]), detail: s(r[4]) || null,
            raised: iso(r[5]), target: iso(r[6]), resolved: iso(r[7]), party: strip(r[9]) || null, owner: s(r[10]) || null,
            priority: ['상', '중', '하'].includes(strip(r[11])) ? strip(r[11]) : '중', source: s(r[12]) || null,
            status: mapIssueStatus(r[13]), remark: s(r[15]) || null
          });
        }
      }
    }
    // 3) 이 프로그램에서 내보낸 형식
    if (wb.Sheets['작업']) {
      out.sheets.push('작업');
      for (const r of XLSX.utils.sheet_to_json(wb.Sheets['작업'], { raw: true, defval: null })) {
        const start = iso(r['시작']); if (!start || !s(r['작업명'])) continue;
        const code = s(r['ID']);
        out.tasks.push({
          code: code || null, phase: s(r['단계']) ? phase(s(r['단계'])) : null, name: s(r['작업명']), name_en: s(r['작업명(영문)']) || null,
          type: mapType(r['유형']), owner: s(r['담당']) || null, company: '업체' in r ? s(r['업체']) || null : undefined, trade: '공종' in r ? s(r['공종']) || null : undefined, start, end: iso(r['종료']) || start,
          baseline_end: iso(r['기준 종료']), actual_end: iso(r['실제 완료']), not_before: iso(r['최초 가능일']),
          ...('마감일' in r ? { deadline: iso(r['마감일']) } : {}), ...('실제 시작' in r ? { actual_start: iso(r['실제 시작']) } : {}), ...('공정 가중치' in r ? { weight: Number(r['공정 가중치']) || null } : {}),
          ...('상위 ID' in r ? { parentCode: s(r['상위 ID']) || null } : {}),
          status: mapTaskStatus(r['상태']), is_key: s(r['핵심']) === '★' || s(r['핵심']) === 'Y', ref: s(r['계약 조항']) || null, note: s(r['비고']) || null
        });
        for (const part of s(r['선행작업']).split(/[,;]\s*/).filter(Boolean)) {
          const m = part.match(/^(.+?)(?:\s+(FS|SS|FF))?(?:\s*([+-]\d+))?$/);
          if (m && code) out.deps.push({ pred: m[1].trim(), succ: code, kind: m[2] || 'FS', lag: Number(m[3] || 0) });
        }
      }
    }
    if (wb.Sheets['이슈']) {
      out.sheets.push('이슈');
      for (const r of XLSX.utils.sheet_to_json(wb.Sheets['이슈'], { raw: true, defval: null })) {
        if (!s(r['이슈'])) continue;
        out.issues.push({
          code: s(r['No']) || null, task: s(r['관련 작업 ID']) || null, category: s(r['구분']) || null, title: s(r['이슈']), detail: s(r['상세']) || null,
          raised: iso(r['발생일']), target: iso(r['목표일']), resolved: iso(r['해결일']), party: s(r['책임기관']) || null, owner: s(r['담당자']) || null,
          priority: ['상', '중', '하'].includes(s(r['중요도'])) ? s(r['중요도']) : '중', status: mapIssueStatus(r['현황']), source: s(r['출처']) || null, remark: s(r['비고']) || null
        });
      }
    }
  }
  return out;
}

export function buildExport({ project, phases, tasks, deps, issues, users }) {
  const phaseName = new Map(phases.map(p => [p.id, p.name]));
  const code = new Map(tasks.map(t => [t.id, t.code || `#${t.id}`]));
  const uname = new Map(users.map(u => [u.id, u.name]));
  const predStr = id => deps.filter(d => d.succ_id === id)
    .map(d => `${code.get(d.pred_id)}${d.kind !== 'FS' ? ' ' + d.kind : ''}${d.lag ? (d.lag > 0 ? ' +' : ' ') + d.lag : ''}`).join(', ');
  const taskRows = tasks.map(t => ({
    ID: t.code || `#${t.id}`, 단계: phaseName.get(t.phase_id) || '', 작업명: t.name, '작업명(영문)': t.name_en || '', 유형: t.type,
    담당: t.owner || '', '담당자(계정)': uname.get(t.assignee_id) || '', 업체: t.company || '', 공종: t.trade || '', 시작: t.start, 종료: t.end, 상태: t.status, '진행률(%)': t.progress,
    핵심: t.is_key ? '★' : '', 선행작업: predStr(t.id), '상위 ID': t.parent_id ? code.get(t.parent_id) || '' : '', '최초 가능일': t.not_before || '', 마감일: t.deadline || '', '기준 종료': t.baseline_end || '', '실제 시작': t.actual_start || '', '실제 완료': t.actual_end || '', '공정 가중치': t.weight ?? '',
    '계약 조항': t.ref || '', 비고: t.note || ''
  }));
  const issueRows = issues.map(i => ({
    No: i.code, '관련 작업 ID': i.task_id ? code.get(i.task_id) : '', 구분: i.category || '', 이슈: i.title, 상세: i.detail || '',
    발생일: i.raised || '', 목표일: i.target || '', 해결일: i.resolved || '', 책임기관: i.party || '', 담당자: i.owner || '',
    중요도: i.priority, 현황: i.status, 출처: i.source || '', 비고: i.remark || ''
  }));
  const wb = XLSX.utils.book_new();
  const info = XLSX.utils.aoa_to_sheet([
    ['프로젝트', project.name], ['코드', project.code || ''], ['발주처', project.client || ''], ['상태', project.status],
    ['내보낸 시각', new Date().toISOString()], [], ['작업·이슈 시트를 수정해 다시 불러오면 ID(No)가 같은 항목이 갱신됩니다.']
  ]);
  const ws1 = XLSX.utils.json_to_sheet(taskRows), ws2 = XLSX.utils.json_to_sheet(issueRows);
  ws1['!cols'] = [10, 14, 40, 30, 8, 18, 10, 11, 11, 8, 8, 5, 24, 11, 11, 11, 14, 30].map(w => ({ wch: w }));
  ws2['!cols'] = [9, 10, 12, 40, 50, 11, 11, 11, 16, 10, 6, 8, 16, 24].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, info, '정보');
  XLSX.utils.book_append_sheet(wb, ws1, '작업');
  XLSX.utils.book_append_sheet(wb, ws2, '이슈');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
