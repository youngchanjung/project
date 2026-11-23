import { useState } from 'react';
import { tr } from '../i18n.js';

// 화면마다 붙는 "엑셀" 버튼. make() 는 downloadXLSX(...) 를 부르는 함수
export default function ExportButton({ make, label, toast }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await make(); } catch (e) { (toast || window.alert)(e.message); } finally { setBusy(false); }
  };
  return <button className="btn sm" disabled={busy} onClick={run} title={tr('지금 화면에 보이는 내용을 엑셀 파일로 받습니다.')}>⬇ {busy ? tr('만드는 중…') : (label || tr('엑셀'))}</button>;
}
