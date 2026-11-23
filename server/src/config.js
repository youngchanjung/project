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
  secureCookie: process.env.SECURE_COOKIE === 'true',
  webDist: path.join(ROOT, 'web', 'dist'),
  backupDir: path.resolve(ROOT, process.env.BACKUP_DIR || path.join(dataDir, 'backups')),
  backupCopyDir: process.env.BACKUP_COPY_DIR ? path.resolve(ROOT, process.env.BACKUP_COPY_DIR) : null,
  backupKeep: Math.max(1, Number(process.env.BACKUP_KEEP || 12))
};
