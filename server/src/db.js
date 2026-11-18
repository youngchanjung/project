import knexLib from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// SQLite (서버 PC 기본) 또는 PostgreSQL (웹 버전) — .env 의 DB_CLIENT 로 전환
function makeKnex() {
  if (config.dbClient === 'pg') {
    return knexLib({ client: 'pg', connection: config.databaseUrl, pool: { min: 0, max: 10 } });
  }
  fs.mkdirSync(path.dirname(config.sqliteFile), { recursive: true });
  return knexLib({
    client: 'better-sqlite3',
    connection: { filename: config.sqliteFile },
    useNullAsDefault: true,
    pool: {
      afterCreate(conn, done) {
        conn.pragma('foreign_keys = ON');
        conn.pragma('journal_mode = WAL');
        done();
      }
    }
  });
}

export const db = makeKnex();
