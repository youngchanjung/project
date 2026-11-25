// 휴일 달력 국가 목록 (shared/countries.json 한 곳에서 관리)
import list from '../../shared/countries.json';

export const COUNTRIES = list;
export const countryName = code => list.find(c => c.code === code)?.name || code;
