// 화면 언어 (한국어·베트남어·영어)
// 화면 문구는 한국어 원문을 그대로 키로 씁니다:  tr('직원 계정'),  tr('{n}명 사용 중', { n: 3 })
// 번역은 shared/i18n/en.json, vi.json ({"한국어 원문": "번역"}). 새 문구를 넣은 뒤
// "npm run i18n:check" 로 번역이 빠진 문구를 확인하세요. 번역이 없으면 한국어가 그대로 보입니다.
import en from '../../shared/i18n/en.json';
import vi from '../../shared/i18n/vi.json';

export const LANGS = [
  { code: 'ko', name: '한국어', locale: 'ko-KR' },
  { code: 'vi', name: 'Tiếng Việt', locale: 'vi-VN' },
  { code: 'en', name: 'English', locale: 'en-US' }
];
const DICTS = { en, vi };
const KEY = 'lang';

function initial() {
  try { const l = localStorage.getItem(KEY); if (LANGS.some(x => x.code === l)) return l; } catch {}
  const nav = (navigator.language || 'ko').slice(0, 2);
  return LANGS.some(x => x.code === nav) ? nav : 'ko';
}
let lang = initial();
document.documentElement.lang = lang;

export const getLang = () => lang;
export const locale = () => LANGS.find(x => x.code === lang).locale;
export function setLang(l) {
  if (!LANGS.some(x => x.code === l)) return;
  lang = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(KEY, l); } catch {}
}

export function tr(s, vars) {
  if (s == null) return '';
  const d = lang !== 'ko' && DICTS[lang];
  let r = d && typeof d[s] === 'string' ? d[s] : s; // 빈 문자열도 번역으로 인정 (예: 단위 '건')
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return r;
}
