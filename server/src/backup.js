// DB 백업. Windows 작업 스케줄러가 매주 금요일 저녁 backup.bat → 이 파일을 실행합니다.
//   PostgreSQL: pg_dump 로 .dump 파일(사용자 지정 형식, pg_restore 로 복원)
//   SQLite    : DB 파일 사본(.db)
// 최근 BACKUP_KEEP 개만 남기고, BACKUP_COPY_DIR 가 있으면 그곳(NAS·OneDrive 등)에도 복사합니다.
// 첨부·현장 사진(data/attachments)과 회의 녹음(data/meetings)은 DB 밖의 파일이므로
// 백업 폴더 아래 files/ 에 새로 생기거나 바뀐 파일만 복사해 둡니다(지운 파일도 백업에는 남김).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const STATUS = 'last-backup.json';
const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

// pg_dump 위치: PG_BIN → PATH → C:\Program Files\PostgreSQL\<가장 높은 버전>\bin
export function findPgDump() {
  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, exe);
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    try {
      const vers = fs.readdirSync(base).filter(v => /^\d+/.test(v)).sort((a, b) => parseFloat(b) - parseFloat(a));
      for (const v of vers) { const f = path.join(base, v, 'bin', exe); if (fs.existsSync(f)) return f; }
    } catch {}
  }
  return exe; // PATH 에서 찾기
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => reject(new Error(e.code === 'ENOENT' ? `${cmd} 을(를) 찾을 수 없습니다. .env 의 PG_BIN 에 PostgreSQL bin 폴더를 지정하세요.` : e.message)));
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} 종료 코드 ${code}`))));
  });
}

// src 폴더의 파일을 dst 로 복사. 크기와 수정 시각이 같으면 건너뜀. 복사한 파일 수와 전체 파일 수·크기를 돌려줌
export function mirrorDir(src, dst) {
  const r = { copied: 0, files: 0, bytes: 0 };
  if (!fs.existsSync(src)) return r;
  const walk = (s, d) => {
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      const sp = path.join(s, e.name), dp = path.join(d, e.name);
      if (e.isDirectory()) { walk(sp, dp); continue; }
      if (!e.isFile()) continue;
      const st = fs.statSync(sp);
      r.files++; r.bytes += st.size;
      let same = false;
      try { const dt = fs.statSync(dp); same = dt.size === st.size && Math.abs(dt.mtimeMs - st.mtimeMs) < 2000; } catch {}
      if (same) continue;
      fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(sp, dp);
      fs.utimesSync(dp, st.atime, st.mtime);
      r.copied++;
    }
  };
  walk(src, dst);
  return r;
}

export function backupFiles(baseDir) {
  const out = {};
  for (const [key, src] of [['attachments', config.attachDir], ['meetings', config.meetingsDir]]) {
    out[key] = mirrorDir(src, path.join(baseDir, 'files', key));
  }
  return out;
}

function prune(dir, ext, keep) {
  const files = fs.readdirSync(dir).filter(f => f.startsWith('schedule_') && f.endsWith(ext)).sort().reverse();
  for (const f of files.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
}

export function backupStatus() {
  let last = null;
  try { last = JSON.parse(fs.readFileSync(path.join(config.backupDir, STATUS), 'utf8')); } catch {}
  let files = [];
  try {
    files = fs.readdirSync(config.backupDir).filter(f => f.startsWith('schedule_'))
      .map(f => ({ name: f, size: fs.statSync(path.join(config.backupDir, f)).size })).sort((a, b) => b.name.localeCompare(a.name));
  } catch {}
  return { dir: config.backupDir, copyDir: config.backupCopyDir || null, keep: config.backupKeep, last, files };
}

export async function runBackup({ by = '예약 작업' } = {}) {
  const started = new Date();
  fs.mkdirSync(config.backupDir, { recursive: true });
  const ext = config.dbClient === 'pg' ? '.dump' : '.db';
  const file = path.join(config.backupDir, `schedule_${stamp(started)}${ext}`);
  const result = { at: started.toISOString(), by, ok: false, file: null, size: 0, copied: null, error: null };
  try {
    if (config.dbClient === 'pg') {
      if (!config.databaseUrl) throw new Error('DATABASE_URL 이 설정되지 않았습니다.');
      await run(findPgDump(), ['--format=custom', '--no-owner', `--file=${file}`, `--dbname=${config.databaseUrl}`]);
    } else {
      const Database = (await import('better-sqlite3')).default;
      const src = new Database(config.sqliteFile, { readonly: true, fileMustExist: true });
      try { await src.backup(file); } finally { src.close(); }
    }
    result.file = path.basename(file);
    result.size = fs.statSync(file).size;
    try { result.files = backupFiles(config.backupDir); } catch (e) { result.error = `첨부·녹음 파일 백업 실패: ${e.message}`; }
    if (config.backupCopyDir) {
      try {
        fs.mkdirSync(config.backupCopyDir, { recursive: true });
        fs.copyFileSync(file, path.join(config.backupCopyDir, result.file));
        backupFiles(config.backupCopyDir);
        prune(config.backupCopyDir, ext, config.backupKeep);
        result.copied = config.backupCopyDir;
      } catch (e) { result.error = [result.error, `추가 복사 실패: ${e.message}`].filter(Boolean).join(' / '); }
    }
    prune(config.backupDir, ext, config.backupKeep);
    result.ok = !result.error;
  } catch (e) {
    fs.rmSync(file, { force: true });
    result.error = e.message;
  }
  result.seconds = Math.round((Date.now() - started) / 100) / 10;
  fs.writeFileSync(path.join(config.backupDir, STATUS), JSON.stringify(result, null, 2));
  fs.appendFileSync(path.join(config.backupDir, 'backup.log'),
    `${result.at}\t${result.ok ? '성공' : '실패'}\t${result.file || ''}\t${result.size}\t${by}\t${result.error || ''}\n`);
  return result;
}

// backup.bat (npm run backup) 로 직접 실행한 경우
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBackup().then(r => {
    if (r.ok) {
      console.log(`백업 완료: ${path.join(config.backupDir, r.file)} (${(r.size / 1024).toFixed(0)} KB)${r.copied ? `, 복사: ${r.copied}` : ''}`);
      for (const [k, v] of Object.entries(r.files || {})) console.log(`  ${k}: 파일 ${v.files}개 중 ${v.copied}개 새로 복사`);
    }
    else console.error(`백업 실패: ${r.error}`);
    process.exit(r.ok ? 0 : 1);
  });
}
