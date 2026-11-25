// 서버가 켜져 있는 동안 하루 한 번(DAILY_NOTIFY_HOUR 시 이후 첫 확인 때) 모든 직원의 마감·마일스톤 알림을 만듦
// → 메일 알림·Teams 채널 알림이 사람이 화면을 열지 않아도 나가게 함. 같은 알림은 dedupe 로 한 번만.
// 30분마다 Outlook 일정 동기화를 다시 확인(실패한 것 재시도)
import { db } from './db.js';
import { config } from './config.js';
import { dailyDue, dailySchedule } from './notify.js';
import { features } from './m365.js';

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let lastDaily = null;
const jobs = { daily: [], periodic: [] };
export const onDaily = fn => jobs.daily.push(fn);
export const onPeriodic = fn => jobs.periodic.push(fn);

export async function runDaily() {
  const users = await db('users').where({ active: true });
  for (const u of users) {
    try { await dailyDue(u); await dailySchedule(u); } catch (e) { console.error('하루 알림 실패', u.username, e.message); }
  }
  for (const fn of jobs.daily) { try { await fn(); } catch (e) { console.error('하루 작업 실패', e.message); } }
}

export function startScheduler() {
  const tick = async () => {
    const d = new Date();
    if (d.getHours() >= config.dailyHour && lastDaily !== localDay(d)) {
      lastDaily = localDay(d);
      await runDaily().catch(e => console.error(e));
    }
  };
  let n = 0;
  const t = setInterval(() => {
    tick();
    if (++n % 3 === 0) for (const fn of jobs.periodic) fn().catch(e => console.error('정기 작업 실패', e.message));
  }, 10 * 60e3);
  t.unref?.();
  setTimeout(tick, 30e3).unref?.();
  const f = features();
  console.log(`M365 연동: 로그인 ${f.sso ? '켜짐' : '꺼짐'} · 메일 ${f.mail ? '켜짐' : '꺼짐'} · Outlook ${f.outlook ? '켜짐' : '꺼짐'}`);
}
