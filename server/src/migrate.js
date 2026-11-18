import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { migrate } from './migrations.js';
import { KR_HOLIDAYS } from './holidaysKR.js';

export async function prepareDb() {
  const applied = await migrate(db);
  if (applied.includes('001_initial')) {
    for (const [date, name] of KR_HOLIDAYS) await db('holidays').insert({ country: 'KR', date, name });
  }
  return applied;
}

// npm run migrate 로 직접 실행한 경우
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareDb().then(a => { console.log(a.length ? `적용: ${a.join(', ')}` : 'DB가 최신 상태입니다.'); return db.destroy(); })
    .catch(e => { console.error(e); process.exit(1); });
}
