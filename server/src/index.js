import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { prepareDb } from './migrate.js';
import { loadUser } from './auth.js';
import { HttpError } from './util.js';
import { translateMsg, reqLang } from './i18n.js';
import { translateRouter } from './routes/translate.js';
import { calendarRouter, icsRouter } from './routes/ics.js';
import { sheetRouter } from './routes/sheet.js';
import { authRouter } from './routes/auth.js';
import { usersRouter, departmentsRouter } from './routes/org.js';
import { backupRouter } from './routes/backup.js';
import { projectsRouter } from './routes/projects.js';
import { tasksRouter, depsRouter } from './routes/tasks.js';
import { issuesRouter } from './routes/issues.js';
import { meetingsRouter, meetingStatusRouter, resumeMeetings } from './routes/meetings.js';
import { importRouter, exportRouter, holidaysRouter, meRouter } from './routes/data.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(loadUser);

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/departments', departmentsRouter);
  api.use('/backup', backupRouter);
  api.use('/translate', translateRouter);
  api.use('/sheet.xlsx', sheetRouter);
  api.use('/me/calendar', calendarRouter);
  api.use('/me', meRouter);
  api.use('/holidays', holidaysRouter);
  api.use('/projects', projectsRouter);
  api.use('/projects/:pid/tasks', tasksRouter);
  api.use('/projects/:pid/deps', depsRouter);
  api.use('/projects/:pid/issues', issuesRouter);
  api.use('/meetings', meetingStatusRouter);
  api.use('/projects/:pid/meetings', meetingsRouter);
  api.use('/projects/:pid/import', importRouter);
  api.use('/projects/:pid/export.xlsx', exportRouter);
  api.use((_req, _res, next) => next(new HttpError(404, '없는 API입니다.')));
  app.use('/api', api);
  app.use('/ics', icsRouter);

  // 화면 (web/dist) — npm run build 후 제공
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('화면이 아직 빌드되지 않았습니다. 프로젝트 폴더에서 "npm run build" 를 실행하세요.'));
  }

  // 오류 처리
  app.use((err, req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE') { err.status = 413; err.message = `파일이 너무 큽니다 (최대 ${config.maxAudioMB}MB).`; }
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: translateMsg(status >= 500 ? '서버 오류가 발생했습니다.' : err.message, reqLang(req)), ...(err.extra || {}) });
  });
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await prepareDb();
  const app = createApp();
  // HTTPS 인증서가 설정돼 있으면 https 로 (브라우저 녹음은 https 또는 localhost 에서만 동작)
  let tls = null;
  if (config.httpsPfx) tls = { pfx: fs.readFileSync(config.httpsPfx), passphrase: config.httpsPassphrase };
  else if (config.httpsCert && config.httpsKey) tls = { cert: fs.readFileSync(config.httpsCert), key: fs.readFileSync(config.httpsKey) };
  const server = tls ? https.createServer(tls, app) : app;
  server.listen(config.port, () => {
    console.log(`일정관리 서버 시작: ${tls ? 'https' : 'http'}://localhost:${config.port}  (DB: ${config.dbClient === 'pg' ? 'PostgreSQL' : config.sqliteFile})`);
  });
  resumeMeetings().catch(e => console.error('회의록 처리 재개 실패', e));
}
