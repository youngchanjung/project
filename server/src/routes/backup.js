import { Router } from 'express';
import { ah, audit } from '../util.js';
import { requireAdmin } from '../auth.js';
import { backupStatus, runBackup } from '../backup.js';

// 관리 화면의 "DB 백업" 카드: 최근 결과 보기, 지금 백업하기
export const backupRouter = Router();
backupRouter.use(requireAdmin);
backupRouter.get('/', (_req, res) => res.json(backupStatus()));

let running = false;
backupRouter.post('/run', ah(async (req, res) => {
  if (running) return res.status(409).json({ error: '백업이 이미 진행 중입니다.' });
  running = true;
  try {
    const r = await runBackup({ by: req.user.name });
    await audit(null, { user: req.user, entity: 'backup', action: 'create', label: r.ok ? r.file : `실패: ${r.error}` });
    res.status(r.ok ? 200 : 500).json({ ...backupStatus(), error: r.ok ? undefined : `백업 실패: ${r.error}` });
  } finally { running = false; }
}));
