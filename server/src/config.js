import dotenv from 'dotenv';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
// .env 는 저장소 최상위 폴더에 둠 (어느 폴더에서 실행하든 같은 파일 사용)
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const dataDir = path.resolve(ROOT, process.env.DATA_DIR || 'data');

// 세션 서명 키: .env 에 없으면 data/secret.key 에 한 번 만들어 두고 계속 사용
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(dataDir, 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  fs.mkdirSync(dataDir, { recursive: true });
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s);
  return s;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  // 기본 DB 는 PostgreSQL. DB_CLIENT=sqlite 로 두면 설치 없이 파일 하나로 시험해 볼 수 있음
  dbClient: (process.env.DB_CLIENT || (process.env.DATABASE_URL ? 'pg' : 'sqlite')).toLowerCase() === 'pg' ? 'pg' : 'sqlite',
  databaseUrl: process.env.DATABASE_URL,
  sqliteFile: path.resolve(ROOT, process.env.SQLITE_FILE || path.join(dataDir, 'schedule.db')),
  dataDir,
  sessionSecret: secret(),
  sessionDays: Number(process.env.SESSION_DAYS || 14),
  // HTTPS 인증서를 설정했으면 자동으로 켜짐
  secureCookie: process.env.SECURE_COOKIE === 'true' || !!(process.env.HTTPS_PFX || process.env.HTTPS_CERT),
  webDist: path.join(ROOT, 'web', 'dist'),
  backupDir: path.resolve(ROOT, process.env.BACKUP_DIR || path.join(dataDir, 'backups')),
  backupCopyDir: process.env.BACKUP_COPY_DIR ? path.resolve(ROOT, process.env.BACKUP_COPY_DIR) : null,
  // DeepL 번역 (입력 내용 번역). 키가 없으면 번역 기능만 꺼지고 나머지는 그대로 동작
  deeplKey: process.env.DEEPL_API_KEY || '',
  // 회의록: 음성인식(Microsoft Azure Speech)과 AI 정리(Claude). 키가 없으면 해당 기능만 꺼짐
  azureSpeechKey: process.env.AZURE_SPEECH_KEY || '',
  azureSpeechRegion: (process.env.AZURE_SPEECH_REGION || '').trim(),
  azureSpeechEndpoint: (process.env.AZURE_SPEECH_ENDPOINT || '').trim(),
  azureSpeechApiVersion: process.env.AZURE_SPEECH_API_VERSION || '2025-10-15',
  azureMaxSpeakers: Math.min(35, Math.max(2, Number(process.env.AZURE_MAX_SPEAKERS || 10))),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  minutesModel: process.env.MINUTES_AI_MODEL || 'claude-opus-5-5',
  meetingsDir: path.resolve(ROOT, process.env.MEETINGS_DIR || path.join(dataDir, 'meetings')),
  attachDir: path.resolve(ROOT, process.env.ATTACH_DIR || path.join(dataDir, 'attachments')),
  maxAttachMB: Math.max(1, Number(process.env.ATTACH_MAX_MB || 50)),
  maxAudioMB: Math.max(10, Number(process.env.MEETING_MAX_MB || 500)),
  // HTTPS (브라우저 녹음은 https 또는 localhost 에서만 동작). pfx 파일 또는 cert/key 파일
  httpsPfx: process.env.HTTPS_PFX ? path.resolve(ROOT, process.env.HTTPS_PFX) : null,
  httpsPassphrase: process.env.HTTPS_PASSPHRASE || '',
  httpsCert: process.env.HTTPS_CERT ? path.resolve(ROOT, process.env.HTTPS_CERT) : null,
  httpsKey: process.env.HTTPS_KEY ? path.resolve(ROOT, process.env.HTTPS_KEY) : null,
  backupKeep: Math.max(1, Number(process.env.BACKUP_KEEP || 12))
};
