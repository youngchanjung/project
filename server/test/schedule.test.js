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
