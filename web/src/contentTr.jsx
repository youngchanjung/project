// 입력 내용(작업명·이슈·비고 등) 번역 표시. 서버의 DeepL 번역을 모아서 요청하고, 결과는 이 화면에 기억해 둡니다.
// 사용:  <Tx>{task.name}</Tx>  → "내용 번역"이 켜져 있으면 화면 언어로 번역해 보여주고, 마우스를 올리면 원문이 보입니다.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { getLang } from './i18n.js';

const KEY = 'contentTr';
let enabled = false; // 서버에 DeepL 키가 있는지
let on = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
const cache = new Map(); // `${lang}\u0000${text}` → 번역문 (undefined = 요청 중)
const queue = new Map(); // lang → Set(text)
let timer = null, version = 0;
const listeners = new Set();
const notify = () => { version++; listeners.forEach(l => l()); };
const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };

export async function initContentTr() {
  try { enabled = (await api.get('/translate/status')).enabled; } catch { enabled = false; }
  notify();
}
export const contentTrAvailable = () => enabled;
export const contentTrOn = () => enabled && on;
export function setContentTr(v) {
  on = v;
  try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch {}
  notify();
}

function flush() {
  timer = null;
  for (const [lang, set] of queue) {
    queue.delete(lang);
    const texts = [...set];
    for (let i = 0; i < texts.length; i += 200) {
      const batch = texts.slice(i, i + 200);
      api.post('/translate', { target: lang, texts: batch })
        .then(r => batch.forEach((t, j) => cache.set(`${lang}\u0000${t}`, r.texts[j])))
        .catch(() => batch.forEach(t => cache.set(`${lang}\u0000${t}`, t))) // 실패하면 원문
        .finally(notify);
    }
  }
}

export function useTx(text) {
  useSyncExternalStore(subscribe, () => version);
  if (!text || !contentTrOn()) return text;
  const lang = getLang();
  const k = `${lang}\u0000${text}`;
  if (cache.has(k)) return cache.get(k) ?? text;
  cache.set(k, undefined);
  if (!queue.has(lang)) queue.set(lang, new Set());
  queue.get(lang).add(text);
  if (!timer) timer = setTimeout(flush, 30);
  return text;
}
export const useContentTrState = () => { useSyncExternalStore(subscribe, () => version); return { available: enabled, on: contentTrOn() }; };

// 번역된 내용을 보여주는 컴포넌트 (원문은 마우스를 올리면 보임)
export function Tx({ children }) {
  const s = children == null ? '' : String(children);
  const r = useTx(s);
  return r && r !== s ? <span title={s}>{r}</span> : s;
}

// 입력 칸 아래에 번역을 보여주는 한 줄 (원문과 같으면 표시하지 않음). 저장된 값(saved)만 번역합니다.
export function TxHint({ text }) {
  const s = text == null ? '' : String(text);
  const r = useTx(s);
  if (!s || !r || r === s) return null;
  return <div className="small full" style={{ gridColumn: '2', marginTop: -4 }}>🌐 {r}</div>;
}
