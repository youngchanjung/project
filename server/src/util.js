import { db } from './db.js';

export const now = () => new Date().toISOString();

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// express 5 는 async 오류를 자동으로 넘겨주지만, 명시적으로 감싸 둡니다
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isDate(v) { return typeof v === 'string' && DATE.test(v) && !isNaN(Date.parse(v)); }
export function optDate(v, field) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isDate(v)) throw new HttpError(400, `${field}: 날짜 형식(YYYY-MM-DD)이 아닙니다.`);
  return v;
}

// 허용된 필드만 골라내기
export function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

// 변경 전후 비교 → {필드: [이전,이후]}
export function diff(before, after) {
  const ch = {};
  for (const k of Object.keys(after)) {
    const a = before?.[k] ?? null, b = after[k] ?? null;
    if (String(a) !== String(b)) ch[k] = [a, b];
  }
  return ch;
}

export async function audit(trx, { user, projectId, entity, entityId, action, label, changes }) {
  await (trx || db)('audit_log').insert({
    at: now(), user_id: user?.id ?? null, user_name: user?.name ?? '시스템',
    project_id: projectId ?? null, entity, entity_id: entityId ?? null, action,
    label: label?.slice(0, 300) ?? null, changes: changes ? JSON.stringify(changes) : null
  });
}

// insert 후 id 얻기 (sqlite/pg 공통)
export async function insertId(q, table, row) {
  const r = await q(table).insert(row).returning('id');
  const x = r[0];
  return typeof x === 'object' ? x.id : x;
}

// 프로젝트 일정 계산용 휴일 집합. 달력일 기준 프로젝트는 null (모든 날 근무일)
export async function projectCalendar(q, project) {
  if (project.day_basis === 'calendar') return null;
  return holidaySet(q, project.calendars);
}

export async function holidaySet(q, calendars) {
  const cs = String(calendars || 'KR').split(',').map(s => s.trim()).filter(Boolean);
  const rows = await (q || db)('holidays').whereIn('country', cs).select('date');
  return new Set(rows.map(r => r.date));
}
