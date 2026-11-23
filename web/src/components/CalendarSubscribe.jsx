import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { tr } from '../i18n.js';
import Modal from './Modal.jsx';

// Outlook 달력 구독(ICS) 주소 안내. projectId 를 주면 그 프로젝트 주소를 먼저 보여줌
export default function CalendarSubscribe({ projectId, onClose, toast }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get('/me/calendar').then(setInfo).catch(e => setErr(e.message)); }, []);
  const copy = async url => {
    try { await navigator.clipboard.writeText(url); toast?.(tr('주소를 복사했습니다.')); }
    catch { window.prompt(tr('아래 주소를 복사하세요.'), url); }
  };
  const reset = async () => {
    if (!window.confirm(tr('새 주소를 만들면 지금 쓰는 구독 주소는 더 이상 갱신되지 않습니다. 계속할까요?'))) return;
    try { setInfo(await api.post('/me/calendar/reset')); toast?.(tr('새 주소를 만들었습니다. 달력 프로그램에서 다시 구독하세요.')); } catch (e) { setErr(e.message); }
  };
  const Row = ({ label, url }) => (
    <div className="item" style={{ cursor: 'default' }}>
      <div className="main"><div className="t">{label}</div><div className="small" style={{ wordBreak: 'break-all' }}>{url}</div></div>
      <button className="btn sm primary" onClick={() => copy(url)}>{tr('복사')}</button>
    </div>
  );
  const proj = info?.projects.find(p => p.id === projectId);
  return (
    <Modal title={tr('Outlook 달력에 구독')} onClose={onClose} wide>
      {err && <div className="err">{err}</div>}
      {!info && !err && <div className="loading">{tr('불러오는 중…')}</div>}
      {info && <>
        <p className="small">{tr('아래 주소를 Outlook 에 추가하면 일정이 Outlook 달력에 보이고, 약 1시간마다 자동으로 새로 고쳐집니다. 달력에서는 보기만 되고, 수정은 이 프로그램에서 합니다.')}</p>
        <div className="list">
          <Row label={tr('내 작업·이슈 (담당자로 지정된 것)')} url={info.mine} />
          {proj && <Row label={`${tr('프로젝트 전체')} · ${proj.name}`} url={proj.url} />}
        </div>
        {!projectId && info.projects.length > 0 && <details style={{ marginTop: 8 }}><summary className="small">{tr('프로젝트별 주소')} ({info.projects.length})</summary>
          <div className="list">{info.projects.map(p => <Row key={p.id} label={p.name} url={p.url} />)}</div></details>}
        <h3 style={{ marginTop: 16 }}>{tr('Outlook 에 추가하는 방법')}</h3>
        <ol className="small" style={{ lineHeight: 1.7 }}>
          <li>{tr('위에서 [복사]를 누릅니다.')}</li>
          <li>{tr('새 Outlook: 왼쪽 달력 → [달력 추가] → [웹에서 구독] → 주소 붙여넣기 → 이름 입력 → [가져오기].')}</li>
          <li>{tr('기존 Outlook(데스크톱): 달력 → [달력 열기] → [인터넷에서] → 주소 붙여넣기 → [확인].')}</li>
        </ol>
        <p className="small">{tr('이 주소는 나만의 주소입니다. 다른 사람에게 알려주지 마세요. 새어 나갔다면 [새 주소 만들기]를 누르세요.')} {tr('지금은 회사 서버 PC에서 돌아가므로 사내망에서만 갱신됩니다. 웹 버전으로 옮기면 휴대폰·웹 Outlook 에서도 됩니다.')}</p>
        <div className="actions"><button className="btn danger" onClick={reset}>{tr('새 주소 만들기')}</button><button className="btn" onClick={onClose}>{tr('닫기')}</button></div>
      </>}
    </Modal>
  );
}
