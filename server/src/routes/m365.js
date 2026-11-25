import { Router } from 'express';
import { db } from '../db.js';
import { ah, HttpError } from '../util.js';
import { requireAdmin } from '../auth.js';
import { config } from '../config.js';
import { features, m365Ready, sendMail, resetToken } from '../m365.js';
import { mailHtml, log } from '../mailer.js';
import { syncAll } from '../outlook.js';

// 관리 화면의 "Microsoft 365 연동" 카드: 켜진 기능, 최근 기록, 시험 메일, Outlook 다시 맞추기
// 비밀 값(클라이언트 비밀)은 절대 돌려주지 않음
export const m365Router = Router();
m365Router.use(requireAdmin);

m365Router.get('/', ah(async (_req, res) => {
  const c = config.m365;
  const logs = await db('m365_log').orderBy('id', 'desc').limit(30);
  const linkErr = await db('m365_links as l').leftJoin('tasks as t', 't.id', 'l.task_id').whereNotNull('l.error')
    .select('l.mailbox', 'l.error', 'l.synced_at', 't.name as task_name').orderBy('l.synced_at', 'desc').limit(20);
  const { n: links } = await db('m365_links').count({ n: '*' }).first();
  const { n: hooks } = await db('projects').whereNotNull('teams_webhook').whereNot('teams_webhook', '').where({ archived: false }).count({ n: '*' }).first();
  res.json({
    ready: m365Ready(), features: features(),
    settings: {
      tenantId: c.tenantId ? `${String(c.tenantId).slice(0, 8)}…` : '', clientId: c.clientId ? `${String(c.clientId).slice(0, 8)}…` : '', secret: !!c.clientSecret,
      mailFrom: c.mailFrom || '', publicUrl: config.publicUrl || '', localLogin: c.localLogin, autoCreate: c.autoCreate,
      outlookTasks: c.outlookTasks, timeZone: c.timeZone || '', dailyHour: config.dailyHour
    },
    links: Number(links), teamsProjects: Number(hooks),
    logs: logs.map(l => ({ ...l, ok: !!l.ok })), linkErrors: linkErr
  });
}));

m365Router.post('/test-mail', ah(async (req, res) => {
  if (!features().mail) throw new HttpError(400, '메일 알림이 설정되지 않았습니다. .env 의 M365_MAIL_FROM 을 확인하세요.');
  const to = String(req.body?.to || req.user.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(to)) throw new HttpError(400, '받을 메일 주소가 없습니다. 내 계정에 메일 주소를 넣거나 주소를 입력하세요.');
  resetToken();
  try {
    await sendMail(to, '[R&D 일정관리] 시험 메일', mailHtml({ title: '시험 메일', lines: [`${req.user.name}님이 관리 화면에서 보낸 시험 메일입니다. 이 메일이 보이면 메일 알림이 동작합니다.`], link: config.publicUrl || null, lang: 'ko' }));
  } catch (e) {
    await log('mail', false, `시험 메일 ${to}: ${e.message}`);
    throw new HttpError(400, `보내지 못했습니다: ${e.message}`);
  }
  await log('mail', true, `시험 메일 → ${to}`);
  res.json({ ok: true, to });
}));

m365Router.post('/resync', ah(async (_req, res) => {
  if (!features().outlook) throw new HttpError(400, 'Outlook 일정 연동이 꺼져 있습니다.');
  await db('m365_links').whereNotNull('error').update({ hash: null }); // 실패한 것은 처음부터 다시
  res.json(await syncAll());
}));
