// DB 백업: 첨부·회의 녹음 파일도 백업 폴더 files/ 에 복사되는지 — 임시 SQLite DB 사용
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-backup-'));
process.env.DB_CLIENT = 'sqlite';
process.env.DATA_DIR = tmp;
process.env.SESSION_SECRET = 'test';

test('백업에 첨부·녹음 파일 포함, 바뀐 파일만 다시 복사', async () => {
  const { prepareDb } = await import('../src/migrate.js');
  const { runBackup } = await import('../src/backup.js');
  await prepareDb();
  fs.mkdirSync(path.join(tmp, 'attachments', '1'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'attachments', '1', 'a.jpg'), 'photo');
  fs.mkdirSync(path.join(tmp, 'meetings'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'meetings', 'm.webm'), 'audio');

  const r1 = await runBackup({ by: 'test' });
  assert.equal(r1.ok, true, r1.error);
  assert.equal(fs.readFileSync(path.join(tmp, 'backups', 'files', 'attachments', '1', 'a.jpg'), 'utf8'), 'photo');
  assert.equal(fs.readFileSync(path.join(tmp, 'backups', 'files', 'meetings', 'm.webm'), 'utf8'), 'audio');
  assert.equal(r1.files.attachments.copied, 1);

  const r2 = await runBackup({ by: 'test' });
  assert.equal(r2.files.attachments.copied, 0);
  assert.equal(r2.files.meetings.files, 1);
  const { db } = await import('../src/db.js');
  await db.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
});
