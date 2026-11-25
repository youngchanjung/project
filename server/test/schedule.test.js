import test from 'node:test';
import assert from 'node:assert/strict';
import { addWorkdays, workdaysBetween, recalc, wouldCycle } from '../src/schedule.js';

const hol = new Set(['2026-11-24']); // 화요일 공휴일

test('근무일 더하기: 주말·공휴일 건너뜀', () => {
  assert.equal(addWorkdays('2026-11-20', 1, hol), '2026-11-23'); // 금 → 월
  assert.equal(addWorkdays('2026-11-23', 1, hol), '2026-11-25'); // 월 → (화 공휴일) → 수
  assert.equal(addWorkdays('2026-11-25', -2, hol), '2026-11-20');
});

test('근무일 수', () => {
  assert.equal(workdaysBetween('2026-11-20', '2026-11-25', hol), 3); // 금, 월, 수
});

test('FS 선행관계: 선행 종료 다음 근무일에 시작, 기간 유지', () => {
  const tasks = [
    { id: 1, start: '2026-11-16', end: '2026-11-20', status: '미착수' },
    { id: 2, start: '2026-11-02', end: '2026-11-03', status: '미착수' }
  ];
  const ch = recalc(tasks, [{ pred_id: 1, succ_id: 2, kind: 'FS', lag: 0 }], hol);
  assert.deepEqual(ch, [{ id: 2, start: '2026-11-23', end: '2026-11-25' }]);
});

test('SS·FF 와 달력일 기준(hol=null)', () => {
  const tasks = [
    { id: 1, start: '2026-11-17', end: '2026-11-21', status: '미착수' },
    { id: 2, start: '2026-11-01', end: '2026-11-01', status: '미착수' },
    { id: 3, start: '2026-11-01', end: '2026-11-03', status: '미착수' }
  ];
  const ch = recalc(tasks, [
    { pred_id: 1, succ_id: 2, kind: 'FS', lag: 0 },
    { pred_id: 1, succ_id: 3, kind: 'FF', lag: 0 }
  ], null);
  assert.deepEqual(ch, [{ id: 2, start: '2026-11-22', end: '2026-11-22' }, { id: 3, start: '2026-11-19', end: '2026-11-21' }]);
});

test('최초 가능일보다 앞당기지 않음, 완료 작업은 고정', () => {
  const tasks = [
    { id: 1, start: '2026-11-02', end: '2026-11-02', status: '미착수' },
    { id: 2, start: '2026-12-01', end: '2026-12-01', status: '미착수', not_before: '2026-12-01' },
    { id: 3, start: '2026-10-01', end: '2026-10-01', status: '완료' }
  ];
  const ch = recalc(tasks, [{ pred_id: 1, succ_id: 2, kind: 'FS', lag: 0 }, { pred_id: 1, succ_id: 3, kind: 'FS', lag: 0 }], hol);
  assert.deepEqual(ch, []);
});

test('순환 감지', () => {
  const deps = [{ pred_id: 1, succ_id: 2 }, { pred_id: 2, succ_id: 3 }];
  assert.equal(wouldCycle(deps, 3, 1), true);
  assert.equal(wouldCycle(deps, 1, 3), false);
});

test('크리티컬 패스: 가장 긴 경로는 여유 0, 짧은 경로는 여유가 남음', async () => {
  const { criticalPath } = await import('../src/schedule.js');
  const h = new Set();
  // 1(월~수) → 2(목~금) → 4(다음 주 월~화)
  // 1 → 3(목 하루) → 4   : 3 은 하루짜리라 여유 1일
  const tasks = [
    { id: 1, start: '2026-11-02', end: '2026-11-04', status: '진행중' },
    { id: 2, start: '2026-11-05', end: '2026-11-06', status: '미착수' },
    { id: 3, start: '2026-11-05', end: '2026-11-05', status: '미착수' },
    { id: 4, start: '2026-11-09', end: '2026-11-10', status: '미착수' },
    { id: 5, start: '2026-11-02', end: '2026-11-03', status: '완료' }
  ];
  const deps = [[1, 2], [2, 4], [1, 3], [3, 4]].map(([p, s]) => ({ pred_id: p, succ_id: s, kind: 'FS', lag: 0 }));
  const cp = criticalPath(tasks, deps, h);
  assert.deepEqual([1, 2, 4].map(i => cp.get(i).float), [0, 0, 0]);
  assert.equal(cp.get(3).float, 1);
  assert.equal(cp.get(3).crit, false);
  assert.equal(cp.has(5), false); // 완료 작업 제외
});

test('크리티컬 패스: SS·FF·lag', async () => {
  const { criticalPath } = await import('../src/schedule.js');
  const tasks = [
    { id: 1, start: '2026-11-02', end: '2026-11-06', status: '미착수' }, // 5일
    { id: 2, start: '2026-11-03', end: '2026-11-04', status: '미착수' }, // SS+1, 2일
    { id: 3, start: '2026-11-09', end: '2026-11-09', status: '미착수' }  // 1 FS
  ];
  const deps = [{ pred_id: 1, succ_id: 2, kind: 'SS', lag: 1 }, { pred_id: 1, succ_id: 3, kind: 'FS', lag: 0 }];
  const cp = criticalPath(tasks, deps, new Set());
  assert.equal(cp.get(1).float, 0);
  assert.equal(cp.get(3).float, 0);
  assert.ok(cp.get(2).float > 0);
});

test('요약 작업 모으기: 하위 작업 기간·진행률', async () => {
  const { rollup } = await import('../src/schedule.js');
  const tasks = [
    { id: 1, start: '2026-11-01', end: '2026-11-01', status: '미착수', progress: 0 },
    { id: 2, parent_id: 1, start: '2026-11-02', end: '2026-11-05', status: '완료', progress: 100 },  // 4일
    { id: 3, parent_id: 1, start: '2026-11-06', end: '2026-11-09', status: '진행중', progress: 50 }   // 4일
  ];
  const [r] = rollup(tasks);
  assert.deepEqual(r, { id: 1, start: '2026-11-02', end: '2026-11-09', progress: 75, status: '진행중' });
});

test('일정 파일 읽기: MS Project XML · P6 XER', async () => {
  const { parseMSProjectXML, parseXER, fillSummaryDates } = await import('../src/schedfile.js');
  const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><MinutesPerDay>480</MinutesPerDay><Tasks>
<Task><UID>1</UID><Name>골조</Name><WBS>1</WBS><OutlineNumber>1</OutlineNumber><OutlineLevel>1</OutlineLevel><Summary>1</Summary><Start>2026-11-02T08:00:00</Start><Finish>2026-11-13T17:00:00</Finish></Task>
<Task><UID>2</UID><Name>지하층</Name><WBS>1.1</WBS><OutlineNumber>1.1</OutlineNumber><OutlineLevel>2</OutlineLevel><Summary>1</Summary><Start>2026-11-02T08:00:00</Start><Finish>2026-11-13T17:00:00</Finish></Task>
<Task><UID>3</UID><Name>기초</Name><WBS>1.1.1</WBS><OutlineNumber>1.1.1</OutlineNumber><OutlineLevel>3</OutlineLevel><Start>2026-11-02T08:00:00</Start><Finish>2026-11-06T17:00:00</Finish><PercentComplete>50</PercentComplete></Task>
<Task><UID>4</UID><Name>벽체</Name><WBS>1.1.2</WBS><OutlineNumber>1.1.2</OutlineNumber><OutlineLevel>3</OutlineLevel><Start>2026-11-09T08:00:00</Start><Finish>2026-11-13T17:00:00</Finish><Deadline>2026-11-12T17:00:00</Deadline>
<PredecessorLink><PredecessorUID>3</PredecessorUID><Type>3</Type><LinkLag>9600</LinkLag></PredecessorLink></Task></Tasks></Project>`;
  const m = parseMSProjectXML(Buffer.from(xml));
  assert.deepEqual(m.phases, ['골조']);
  assert.equal(m.tasks.find(t => t.code === '1.1.1').parentCode, '1.1');
  assert.equal(m.tasks.find(t => t.code === '1.1.2').deadline, '2026-11-12');
  assert.deepEqual(m.deps, [{ pred: '1.1.1', succ: '1.1.2', kind: 'SS', lag: 2 }]);
  const xer = ['ERMHDR\t19', '%T\tPROJWBS', '%F\twbs_id\tproj_node_flag\twbs_short_name\twbs_name\tparent_wbs_id', '%R\t1\tY\tP\tP\t', '%R\t2\tN\tA\t토목\t1', '%R\t3\tN\tA1\t토공\t2',
    '%T\tTASK', '%F\ttask_id\twbs_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_start_date\ttarget_end_date\tearly_start_date\tearly_end_date\tphys_complete_pct',
    '%R\t10\t3\tA100\t터파기\tTT_Task\tTK_Active\t2026-11-02 08:00\t2026-11-06 17:00\t2026-11-02 08:00\t2026-11-09 17:00\t40',
    '%T\tTASKPRED', '%F\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt', '%E'].join('\n');
  const x = fillSummaryDates(parseXER(Buffer.from(xer)));
  assert.deepEqual(x.phases, ['토목']);
  const sum = x.tasks.find(t => t.code === 'WBS-A.A1');
  assert.equal(sum.start, '2026-11-02'); assert.equal(sum.end, '2026-11-09');
  const a = x.tasks.find(t => t.code === 'A100');
  assert.equal(a.parentCode, 'WBS-A.A1'); assert.equal(a.baseline_end, '2026-11-06'); assert.equal(a.status, '진행중');
});
