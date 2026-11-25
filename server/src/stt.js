// 음성 → 글 (리턴제로 RTZR 일반 STT, https://developers.rtzr.ai/docs/stt-file/)
// .env 의 RTZR_CLIENT_ID / RTZR_CLIENT_SECRET 가 있을 때만 동작합니다.
// 흐름: 토큰 발급(6시간 유효) → 파일 전송(POST /v1/transcribe) → 결과 조회(GET, 약 5초 간격)
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const BASE = 'https://openapi.vito.ai';
export const sttEnabled = () => !!(config.rtzrClientId && config.rtzrClientSecret);
// 리턴제로가 받는 파일 형식
export const STT_EXT = ['.mp4', '.m4a', '.mp3', '.amr', '.flac', '.wav'];

// 회의 언어 → 인식 모델. 한국어는 한국어 전용 모델(sommers), 그 밖은 다국어 모델(whisper)
export const MEETING_LANGS = ['ko', 'vi', 'en', 'multi'];
export function sttConfig(lang) {
  const common = { use_diarization: true, diarization: { spk_count: 0 }, use_itn: true, use_disfluency_filter: true, use_paragraph_splitter: true };
  if (lang === 'vi' || lang === 'en') return { ...common, model_name: 'whisper', language: lang };
  if (lang === 'multi') return { ...common, model_name: 'whisper', language: 'multi', language_candidates: ['ko', 'vi', 'en'] };
  return { ...common, model_name: 'sommers', language: 'ko' };
}

const ERR = {
  H0002: '리턴제로 인증에 실패했습니다. RTZR_CLIENT_ID / RTZR_CLIENT_SECRET 를 확인하세요.',
  H0005: '녹음 파일이 너무 큽니다 (최대 2GB).',
  H0006: '녹음이 너무 깁니다 (최대 4시간).',
  H0010: '음성인식이 지원하지 않는 파일 형식입니다.',
  A0001: '리턴제로 사용량 한도를 넘었습니다.',
  A0002: '음성인식 동시 처리 한도를 넘었습니다. 잠시 후 다시 시도하세요.'
};
function sttError(status, body) {
  const code = body?.code || body?.error?.code;
  const e = new Error(ERR[code] || `음성인식 오류 (${code || status})`);
  e.status = 502; e.code = code; e.retry = status === 429 || status >= 500;
  return e;
}

let token = null; // { value, exp(ms) }
async function auth(fetcher) {
  if (token && token.exp - Date.now() > 10 * 60e3) return token.value;
  const res = await fetcher(BASE + '/v1/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: config.rtzrClientId, client_secret: config.rtzrClientSecret })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw sttError(res.status, body);
  token = { value: body.access_token, exp: (Number(body.expire_at) || 0) * 1000 || Date.now() + 5 * 3600e3 };
  return token.value;
}

// 전송 → 작업 ID
export async function startTranscribe(file, lang, { fetcher = fetch } = {}) {
  const t = await auth(fetcher);
  const fd = new FormData();
  fd.append('config', JSON.stringify(sttConfig(lang)));
  fd.append('file', await fs.openAsBlob(file), path.basename(file));
  const res = await fetcher(BASE + '/v1/transcribe', { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401) token = null; throw sttError(res.status, body); }
  return body.id;
}

// 결과 조회 → { status: 'transcribing'|'completed'|'failed', utterances?, error? }
export async function getTranscribe(id, { fetcher = fetch } = {}) {
  const t = await auth(fetcher);
  const res = await fetcher(`${BASE}/v1/transcribe/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${t}` } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) return { status: 'transcribing' };
  if (!res.ok) { if (res.status === 401) token = null; throw sttError(res.status, body); }
  if (body.status === 'completed') {
    return { status: 'completed', utterances: (body.results?.utterances || []).map(u => ({ t: u.start_at, d: u.duration, spk: u.spk ?? 0, text: u.msg || '', lang: u.lang || null })) };
  }
  if (body.status === 'failed') return { status: 'failed', error: sttError(500, body).message };
  return { status: 'transcribing' };
}
