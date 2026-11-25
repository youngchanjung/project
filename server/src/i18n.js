// 서버 메시지(오류 등) 번역. 화면과 같은 사전(shared/i18n/*.json, 한국어 원문 → 번역)을 씁니다.
// 사전 키의 {0}, {n} 같은 자리는 아무 값이나 받으므로, 서버에서 값을 넣어 만든 메시지도 번역됩니다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const LANGS = ['vi', 'en'];
const dicts = {};
const patterns = {};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const l of LANGS) {
  try { dicts[l] = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'i18n', `${l}.json`), 'utf8')); } catch { dicts[l] = {}; }
  patterns[l] = Object.entries(dicts[l]).filter(([k]) => /\{\w+\}/.test(k)).map(([k, v]) => {
    const names = [];
    const re = new RegExp('^' + k.split(/(\{\w+\})/).map(part => {
      const m = part.match(/^\{(\w+)\}$/);
      if (m) { names.push(m[1]); return '([\\s\\S]*?)'; }
      return esc(part);
    }).join('') + '$');
    return { re, names, v };
  });
}

export function translateMsg(msg, lang) {
  if (!msg || !LANGS.includes(lang)) return msg;
  const d = dicts[lang];
  if (d[msg]) return d[msg];
  for (const { re, names, v } of patterns[lang]) {
    const m = msg.match(re);
    if (m) return v.replace(/\{(\w+)\}/g, (all, k) => { const i = names.indexOf(k); return i >= 0 ? m[i + 1] : all; });
  }
  return msg;
}

// 요청한 화면 언어: X-Lang 헤더(지금 화면) → 계정 설정
export const reqLang = req => req.get('X-Lang') || req.user?.lang || 'ko';
