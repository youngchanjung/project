// 휴일 달력 국가 목록. 나라를 추가할 때는 shared/countries.json 에 한 줄만 추가하면
// 관리 화면(공휴일), 프로젝트 만들기·설정(휴일 달력 선택), 서버 검사에 모두 반영됩니다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export const COUNTRIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'countries.json'), 'utf8'));
const CODES = new Set(COUNTRIES.map(c => c.code));
export const isCountry = c => CODES.has(c);

// "KR,VN" 형태의 프로젝트 휴일 달력 값 정리. 모르는 코드는 버림, 비면 KR
export function normCalendars(v) {
  const cs = [...new Set(String(v || '').split(',').map(s => s.trim().toUpperCase()).filter(isCountry))];
  return cs.length ? cs.join(',') : 'KR';
}
