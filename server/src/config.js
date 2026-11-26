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
  // 회의록: 음성인식(리턴제로 RTZR)과 AI 정리(Claude). 키가 없으면 해당 기능만 꺼짐
  rtzrClientId: process.env.RTZR_CLIENT_ID || '',
  rtzrClientSecret: process.env.RTZR_CLIENT_SECRET || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  minutesModel: process.env.MINUTES_AI_MODEL || 'claude-opus-5-5',
  meetingsDir: path.resolve(ROOT, process.env.MEETINGS_DIR || path.join(dataDir, 'meetings')),
  attachDir: path.resolve(ROOT, process.env.ATTACH_DIR || path.join(dataDir, 'attachments')),
  maxAttachMB: Math.max(1, Number(process.env.ATTACH_MAX_MB || 50)),
  maxAudioMB: Math.max(10, Number(process.env.MEETING_MAX_MB || 1024)),
  // HTTPS (브라우저 녹음은 https 또는 localhost 에서만 동작). pfx 파일 또는 cert/key 파일
  httpsPfx: process.env.HTTPS_PFX ? path.resolve(ROOT, process.env.HTTPS_PFX) : null,
  httpsPassphrase: process.env.HTTPS_PASSPHRASE || '',
  httpsCert: process.env.HTTPS_CERT ? path.resolve(ROOT, process.env.HTTPS_CERT) : null,
  httpsKey: process.env.HTTPS_KEY ? path.resolve(ROOT, process.env.HTTPS_KEY) : null,
  backupKeep: Math.max(1, Number(process.env.BACKUP_KEEP || 12)),
  // 접속 주소 (메일·Teams 알림의 링크, M365 로그인 돌아올 주소). 비우면 요청한 주소 사용
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  // M365(Entra ID) 연동. 값이 없으면 해당 기능만 꺼지고 자체 계정 로그인은 그대로 동작
  m365: {
    tenantId: process.env.M365_TENANT_ID || '',
    clientId: process.env.M365_CLIENT_ID || '',
    clientSecret: process.env.M365_CLIENT_SECRET || '',
    redirectUri: process.env.M365_REDIRECT_URI || '',
    // 처음 로그인한 회사 계정을 자동으로 '참여자' 직원으로 등록할지 (false 면 관리자가 미리 등록한 메일 주소만)
    autoCreate: process.env.M365_AUTO_CREATE !== 'false',
    // 자체 계정(아이디·비밀번호) 로그인: all = 모두 | admin = 관리자만 (SSO 전환 후)
    localLogin: process.env.M365_LOCAL_LOGIN === 'admin' ? 'admin' : 'all',
    // 메일 알림을 보낼 사서함 (공용 사서함 권장, 예: schedule@회사.com). 비우면 메일 알림 꺼짐
    mailFrom: process.env.M365_MAIL_FROM || '',
    // Outlook 달력 등록: 회의는 항상, 담당 작업도 넣을지 (기본 true)
    outlook: process.env.M365_OUTLOOK !== 'false',
    outlookTasks: process.env.M365_OUTLOOK_TASKS !== 'false',
    timeZone: process.env.M365_TIMEZONE || '',
    loginBase: (process.env.M365_LOGIN_BASE || 'https://login.microsoftonline.com').replace(/\/$/, ''),
    graphBase: (process.env.M365_GRAPH_BASE || 'https://graph.microsoft.com/v1.0').replace(/\/$/, '')
  },
  // 하루 한 번 마감·마일스톤 알림(메일·Teams)을 만드는 시각 (서버 PC 시간, 기본 8시)
  dailyHour: Math.min(23, Math.max(0, Number(process.env.DAILY_NOTIFY_HOUR ?? 8)))
};
