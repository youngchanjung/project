import { Router } from 'express';
import { ah, audit } from '../util.js';
import { requireAdmin } from '../auth.js';
import { translateMsg, reqLang } from '../i18n.js';
import { backupStatus, runBackup } from '../backup.js';

// 관리 화면의 "DB 백업" 카드: 최근 결과 보기, 지금 백업하기
export const backupRouter = Router();
backupRouter.use(requireAdmin);
backupRouter.get('/', (_req, res) => res.json(backupStatus()));

let running = false;
backupRouter.post('/run', ah(async (req, res) => {
  if (running) return res.status(409).json({ error: translateMsg('백업이 이미 진행 중입니다.', reqLang(req)) });
  running = true;
  try {
    const r = await runBackup({ by: req.user.name });
    await audit(null, { user: req.user, entity: 'backup', action: 'create', label: r.ok ? r.file : `실패: ${r.error}` });
    const lang = reqLang(req);
    const msg = '백업 실패: {0}';
    res.status(r.ok ? 200 : 500).json({ ...backupStatus(), error: r.ok ? undefined : translateMsg(msg, lang).replace('{0}', translateMsg(r.error, lang)) });
  } finally { running = false; }
}));
