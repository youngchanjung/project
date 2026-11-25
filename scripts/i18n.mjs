// 번역 사전 점검:  npm run i18n:check
// 화면·서버 코드의 한국어 문구를 모아 shared/i18n/en.json, vi.json 에 빠진 번역이 있는지 확인합니다.
//   --missing  : 빠진 문구를 shared/i18n/_missing.json 으로 저장 (번역 후 사전에 합치기용)
//   --merge <언어> <파일> : {"원문":"번역"} 파일을 사전에 합침
//   --prune    : 코드에서 더 이상 쓰지 않는 문구를 사전에서 지움
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const H = /[가-힣]/;
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? files(path.join(dir, d.name)) : /\.(jsx?|mjs)$/.test(d.name) ? [path.join(dir, d.name)] : []);

export function collectKeys() {
  const keys = new Set();
  // 화면: 따옴표 문자열 중 한국어가 들어간 것 전부 (배지용 클래스 이름 b-xxx 제외)
  for (const f of files(path.join(ROOT, 'web', 'src'))) {
    const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
      const s = (m[1] ?? m[2]).replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1');
      if (H.test(s) && !/(^|\s)b-/.test(s)) keys.add(s);
    }
  }
  // 서버: 오류 메시지. 템플릿의 ${...} 는 {0}, {1} 로
  for (const f of files(path.join(ROOT, 'server', 'src'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:HttpError\(\d+,\s*|new Error\(|error:\s*|const msg = [^;]*?)('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) {
      let s = m[1].slice(1, -1);
      let i = 0;
      s = s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, () => `{${i++}}`);
      if (H.test(s)) keys.add(s);
    }
    // const msg = a ? '...' : b ? '...' : `...` 형태의 나머지 문자열
    for (const m of src.matchAll(/const msg = ([^;]+);/g)) {
      for (const q of m[1].matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
        let i = 0; const s = (q[1] ?? q[2]).replace(/\$\{[^}]*\}/g, () => `{${i++}}`);
        if (H.test(s)) keys.add(s);
      }
    }
  }
  keys.add('서버 오류가 발생했습니다.');
  for (const c of JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'countries.json'), 'utf8'))) keys.add(c.name);
  return [...keys].sort();
}

const dictFile = l => path.join(ROOT, 'shared', 'i18n', `${l}.json`);
const load = l => JSON.parse(fs.readFileSync(dictFile(l), 'utf8'));
const save = (l, d) => fs.writeFileSync(dictFile(l), JSON.stringify(Object.fromEntries(Object.entries(d).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const arg = process.argv.slice(2);
  const keys = collectKeys();
  if (arg[0] === '--merge') {
    const [, l, file] = arg; const d = load(l); Object.assign(d, JSON.parse(fs.readFileSync(file, 'utf8'))); save(l, d);
    console.log(`${l}: 합침 → ${Object.keys(d).length}개`);
  } else {
    let missingAll = {};
    for (const l of ['en', 'vi']) {
      const d = load(l);
      if (arg.includes('--prune')) { for (const k of Object.keys(d)) if (!keys.includes(k)) delete d[k]; save(l, d); }
      const missing = keys.filter(k => typeof d[k] !== 'string'); // 빈 문자열은 '표시 안 함' 번역으로 인정
      missingAll[l] = missing;
      console.log(`${l}: 문구 ${keys.length}개 중 ${missing.length}개 번역 없음`);
    }
    if (arg.includes('--missing')) fs.writeFileSync(path.join(ROOT, 'shared', 'i18n', '_missing.json'), JSON.stringify(missingAll, null, 2));
    if (arg.includes('--strict') && (missingAll.en.length || missingAll.vi.length)) process.exit(1);
  }
}
