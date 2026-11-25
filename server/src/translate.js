// 입력 내용(작업명·이슈·비고·댓글 등) 번역 — DeepL API
// .env 의 DEEPL_API_KEY 가 있을 때만 동작합니다. 번역 결과는 DB(translations)에 저장해 같은 문장은 다시 요청하지 않습니다.
import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { now } from './util.js';

export const TARGETS = { ko: 'KO', vi: 'VI', en: 'EN-US' };
export const translationEnabled = () => !!config.deeplKey;
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
// 무료 키는 ":fx" 로 끝나고 주소가 다름
const endpoint = () => (config.deeplKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com') + '/v2/translate';

async function callDeepL(texts, target) {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${config.deeplKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts, target_lang: TARGETS[target] })
  });
  if (!res.ok) {
    const msg = res.status === 403 ? 'DeepL API 키가 올바르지 않습니다.' : res.status === 456 ? 'DeepL 월간 번역 한도를 넘었습니다.' : `DeepL 오류 (${res.status})`;
    const e = new Error(msg); e.status = 502; throw e;
  }
  return (await res.json()).translations; // [{ detected_source_language, text }]
}

// texts 를 target 언어로. 반환: 같은 순서의 번역문 배열
export async function translateTexts(texts, target, { fetcher = callDeepL } = {}) {
  const uniq = [...new Set(texts.filter(t => t && t.trim()))];
  const out = new Map();
  if (uniq.length) {
    const hashes = new Map(uniq.map(t => [hash(t), t]));
    const rows = await db('translations').where({ target }).whereIn('src_hash', [...hashes.keys()]);
    for (const r of rows) out.set(r.src, r.text);
    const missing = uniq.filter(t => !out.has(t));
    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50);
      const res = await fetcher(batch, target);
      const ins = batch.map((src, j) => {
        const det = String(res[j]?.detected_source_language || '').slice(0, 2).toLowerCase();
        // 이미 그 언어로 쓰인 문장은 원문 그대로
        const text = det === target ? src : (res[j]?.text ?? src);
        out.set(src, text);
        return { src_hash: hash(src), target, src, text, detected: det || null, created_at: now() };
      });
      await db('translations').insert(ins).onConflict(['src_hash', 'target']).ignore();
    }
  }
  return texts.map(t => (t ? out.get(t) ?? t : t));
}
