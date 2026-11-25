import { Router } from 'express';
import { ah, HttpError } from '../util.js';
import { requireLogin } from '../auth.js';
import { translateTexts, translationEnabled, TARGETS } from '../translate.js';

export const translateRouter = Router();
translateRouter.use(requireLogin);

translateRouter.get('/status', (_req, res) => res.json({ enabled: translationEnabled() }));

// { target: 'ko'|'vi'|'en', texts: [...] } → { texts: [...] }
translateRouter.post('/', ah(async (req, res) => {
  if (!translationEnabled()) throw new HttpError(503, '번역 기능이 꺼져 있습니다. 관리자에게 DeepL API 키 설정을 요청하세요.');
  const { target, texts } = req.body || {};
  if (!TARGETS[target]) throw new HttpError(400, '지원하지 않는 언어입니다.');
  if (!Array.isArray(texts) || texts.length > 300) throw new HttpError(400, '번역할 문장은 한 번에 300개까지입니다.');
  const clean = texts.map(t => (typeof t === 'string' ? t.slice(0, 5000) : ''));
  res.json({ texts: await translateTexts(clean, target) });
}));
