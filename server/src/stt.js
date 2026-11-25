// 음성 → 글 (Microsoft Azure AI Speech "빠른 전사" Fast transcription REST API)
// https://learn.microsoft.com/azure/ai-services/speech-service/fast-transcription-create
// .env 의 AZURE_SPEECH_KEY 와 AZURE_SPEECH_REGION(또는 AZURE_SPEECH_ENDPOINT)이 있을 때만 동작합니다.
// 파일을 보내면 같은 요청 안에서 결과가 돌아옵니다(실제 길이보다 빠름). 파일 한도: 500MB 미만, 5시간 미만.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { config } from './config.js';

export const sttEnabled = () => !!(config.azureSpeechKey && (config.azureSpeechEndpoint || config.azureSpeechRegion));
export const STT_MAX_MB = 500;
// Azure 가 받는 형식 (문서: WAV, MP3, OPUS/OGG, FLAC, WMA, AAC, AMR, WebM, SPEEX)
// m4a/mp4(휴대폰·Teams 녹음)는 문서 목록에 없지만 안의 소리가 AAC 라 함께 받습니다. 거절되면 mp3/wav 로 바꿔 올리도록 안내합니다.
export const STT_EXT = ['.wav', '.mp3', '.ogg', '.opus', '.flac', '.wma', '.aac', '.amr', '.webm', '.spx', '.m4a', '.mp4'];

// 회의 언어 → Azure 언어 설정. 여러 언어 섞임은 언어를 지정하지 않아 다국어 모델이 문장마다 언어를 알아내게 합니다.
export const MEETING_LANGS = ['ko', 'vi', 'en', 'multi'];
const LOCALE = { ko: 'ko-KR', vi: 'vi-VN', en: 'en-US' };
export function sttDefinition(lang) {
  const d = {
    diarization: { enabled: true, maxSpeakers: config.azureMaxSpeakers },
    profanityFilterMode: 'None'
  };
  if (LOCALE[lang]) d.locales = [LOCALE[lang]];
  else if (lang !== 'multi') d.locales = [LOCALE.ko];
  return d;
}

export function sttUrl() {
  const base = (config.azureSpeechEndpoint || `https://${config.azureSpeechRegion}.api.cognitive.microsoft.com`).replace(/\/+$/, '');
  return `${base}/speechtotext/transcriptions:transcribe?api-version=${encodeURIComponent(config.azureSpeechApiVersion)}`;
}

function sttError(status, body, ext) {
  const msg = body?.error?.message || body?.message || '';
  const code = body?.error?.code || body?.code || '';
  let text;
  if (status === 401 || status === 403) text = 'Azure Speech 인증에 실패했습니다. AZURE_SPEECH_KEY 와 AZURE_SPEECH_REGION(지역)을 확인하세요.';
  else if (status === 404) text = 'Azure Speech 주소를 찾지 못했습니다. AZURE_SPEECH_REGION 또는 AZURE_SPEECH_ENDPOINT 를 확인하세요.';
  else if (status === 413) text = `녹음 파일이 너무 큽니다 (Azure 한도 ${STT_MAX_MB}MB 미만).`;
  else if (status === 429) text = 'Azure Speech 사용 한도(동시 처리·요금제)를 넘었습니다. 잠시 후 다시 시도하세요.';
  else if (status >= 500) text = `Azure Speech 서버 오류 (${status}). 잠시 후 다시 시도하세요.`;
  else if (/format|codec|audio/i.test(msg) || status === 415) {
    text = `음성인식이 이 파일 형식을 읽지 못했습니다${ext ? ` (${ext})` : ''}. mp3 또는 wav 로 바꿔 다시 올려 주세요.`;
  } else if (/duration|long/i.test(msg)) text = '녹음이 너무 깁니다 (Azure 한도 5시간 미만). 나눠서 올려 주세요.';
  else text = `음성인식 오류 (${status}${code ? ` ${code}` : ''}${msg ? `: ${msg.slice(0, 200)}` : ''})`;
  const e = new Error(text);
  e.status = 502; e.code = code || String(status); e.retry = status === 429 || status >= 500;
  return e;
}

// 파일을 메모리에 다 올리지 않고 흘려 보내는 multipart 전송.
// 긴 회의는 응답까지 몇 분 걸릴 수 있어 fetch 대신 https 를 직접 씁니다(fetch 는 5분이면 끊김).
function postMultipart(url, headers, fields, file, { timeoutMs = 60 * 60e3 } = {}) {
  return new Promise((resolve, reject) => {
    const boundary = '----sched' + crypto.randomBytes(12).toString('hex');
    const name = path.basename(file).replace(/"/g, '');
    const head = Buffer.from(
      Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\nContent-Type: application/json\r\n\r\n${v}\r\n`).join('') +
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${encodeURIComponent(name)}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const size = fs.statSync(file).size;
    const req = https.request(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': head.length + size + tail.length, Accept: 'application/json' }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 300) }; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('음성인식 응답이 너무 오래 걸려 중단했습니다.'), { retry: true })));
    req.on('error', reject);
    req.write(head);
    const rs = fs.createReadStream(file);
    rs.on('error', e => { req.destroy(e); reject(e); });
    rs.on('end', () => req.end(tail));
    rs.pipe(req, { end: false });
  });
}

// 응답 → [{ t(ms), d(ms), spk, text, lang }]
export function parseTranscription(body) {
  const phrases = Array.isArray(body?.phrases) ? body.phrases : [];
  const spks = phrases.map(p => p.speaker).filter(s => Number.isInteger(s));
  const base = spks.length ? Math.min(...spks) : 0; // 화자 번호가 1부터 오면 0부터로 맞춤
  return phrases
    .filter(p => (p.text || '').trim())
    .map(p => ({
      t: Number(p.offsetMilliseconds) || 0,
      d: Number(p.durationMilliseconds) || 0,
      spk: Number.isInteger(p.speaker) ? p.speaker - base : 0,
      text: p.text.trim(),
      lang: p.locale ? String(p.locale).slice(0, 2) : null
    }))
    .sort((a, b) => a.t - b.t);
}

// 녹음 파일 → 전사본. poster 는 테스트에서 바꿔 끼움
export async function transcribe(file, lang, { poster = postMultipart } = {}) {
  const { status, body } = await poster(sttUrl(), { 'Ocp-Apim-Subscription-Key': config.azureSpeechKey }, { definition: JSON.stringify(sttDefinition(lang)) }, file);
  if (status < 200 || status >= 300) throw sttError(status, body, path.extname(file).toLowerCase());
  return parseTranscription(body);
}
