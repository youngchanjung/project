// 처음 안내 말풍선: 화면마다 첫 방문 때 짧은 안내 1~2줄. '다시 보지 않기'는 이 브라우저에 기억
// 위쪽 막대의 ❔ 버튼으로 모든 안내를 다시 볼 수 있음
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { tr } from '../i18n.js';

const KEY = 'tips-off';
const TIPS = {
  home: ['오늘 할 일과 지연·검토 항목이 여기 모입니다.', '항목을 누르면 바로 편집창이 열립니다.'],
  my: ['내가 맡은 일정·할 일을 연구·시공·설계 구분 없이 한 목록으로 봅니다.'],
  projects: ['‘+ 새 프로젝트’로 만들고 카테고리(연구·시공·설계)를 고르면 그 업무에 맞는 화면이 먼저 열립니다.', '카테고리마다 기본 템플릿을 고를 수 있습니다.'],
  category: ['이 카테고리의 프로젝트만 모아 봅니다.'],
  admin: ['부서·직원·공휴일·백업을 관리합니다.', '직원은 엑셀로 한 번에 등록할 수 있습니다.'],
  board: ['카드를 끌어 다른 열에 놓으면 상태가 바뀝니다.', '열 아래 ‘+ 할 일 추가’에 제목만 쓰고 Enter 를 누르면 바로 추가됩니다.'],
  schedule: ['회의·시험·마일스톤을 주·월 달력으로 봅니다.', '날짜 칸의 + 를 누르면 그 날에 회의를 추가합니다.'],
  gantt: ['막대를 끌어 날짜를 옮기고, 막대 끝을 끌어 기간을 바꿉니다.', '선행관계가 있으면 뒤 작업이 자동으로 따라 움직입니다.'],
  lookahead: ['앞으로 몇 주 동안 할 작업을 업체·공종별로 봅니다. 주 수는 위에서 고르세요.'],
  progress: ['진행률과 실제 시작·완료일을 표에서 한 번에 입력하고 저장합니다.'],
  scurve: ['계획 대비 실적 공정률(S-커브)입니다.', '작업별 가중치는 작업 편집창의 ‘자세히’에서 넣을 수 있습니다.'],
  photos: ['현장 사진을 날짜별로 모아 봅니다. 사진을 누르면 크게 볼 수 있습니다.'],
  tasks: ['표 머리를 눌러 정렬하고, 검색으로 걸러 봅니다.', '여러 줄을 골라 한 번에 고칠 수 있습니다.'],
  workload: ['사람별로 주마다 맡은 예상 시간을 봅니다.', '주당 근무 시간을 넘으면 과부하로 표시됩니다.'],
  plan: ['사람×날짜로 누가 언제 무엇을 하는지 봅니다. 휴가·부재도 함께 표시됩니다.'],
  dashboard: ['진행률·지연·다가오는 마일스톤을 한 화면에서 봅니다.'],
  calendar: ['작업을 달력으로 봅니다. 공휴일과 주말이 색으로 구분됩니다.'],
  issues: ['문제·요청 사항을 기록하고 관련 작업과 연결합니다.', '목표일이 지나면 지연으로 표시됩니다.'],
  meetings: ['회의를 녹음하면 회의록과 AI 요약이 만들어집니다.', '요약의 할 일은 버튼 하나로 할 일에 등록할 수 있습니다.'],
  settings: ['참여자·단계·칸반 열·기준선과 템플릿 저장을 여기서 관리합니다.']
};

export function tipKey(pathname) {
  if (pathname === '/') return 'home';
  if (pathname === '/my') return 'my';
  if (pathname === '/projects') return 'projects';
  if (pathname.startsWith('/c/')) return 'category';
  if (pathname.startsWith('/admin')) return 'admin';
  const m = pathname.match(/^\/projects\/\d+\/([a-z]+)/);
  return m && TIPS[m[1]] ? m[1] : null;
}

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };

// ❔ 버튼: 모든 안내를 다시 보이게
export function resetTips() { write({}); try { sessionStorage.removeItem(KEY); } catch {} window.dispatchEvent(new Event('tips-reset')); }

export default function PageTip() {
  const { pathname } = useLocation();
  const key = tipKey(pathname);
  const [off, setOff] = useState(read);
  const [later, setLater] = useState(() => { try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { return {}; } });
  useEffect(() => {
    const on = () => { setOff({}); setLater({}); };
    window.addEventListener('tips-reset', on);
    return () => window.removeEventListener('tips-reset', on);
  }, []);
  if (!key || off.all || off[key] || later[key]) return null;
  const close = () => { const n = { ...later, [key]: 1 }; setLater(n); try { sessionStorage.setItem(KEY, JSON.stringify(n)); } catch {} };
  const never = () => { const n = { ...off, [key]: 1 }; setOff(n); write(n); };
  const allOff = () => { const n = { ...off, all: 1 }; setOff(n); write(n); };
  return (
    <div className="pagetip" role="note">
      <span className="pt-ico" aria-hidden>💡</span>
      <div className="pt-body">{TIPS[key].map(s => <div key={s}>{tr(s)}</div>)}</div>
      <div className="pt-act">
        <button className="btn sm" onClick={close}>{tr('닫기')}</button>
        <button className="btn sm" onClick={never}>{tr('다시 보지 않기')}</button>
        <button className="linkbtn small" onClick={allOff}>{tr('안내 모두 끄기')}</button>
      </div>
    </div>
  );
}
