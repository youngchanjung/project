// 브라우저 녹음. 음성인식(리턴제로)이 받는 형식으로 저장합니다: m4a(AAC, 크롬·엣지·사파리) 또는 wav(16kHz 모노, 그 밖)
// 마이크는 https 또는 localhost 로 접속했을 때만 쓸 수 있습니다 (브라우저 보안 규칙).
import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n.js';

const MP4_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
export const canRecord = () => !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
const pickMp4 = () => (window.MediaRecorder ? MP4_TYPES.find(t => MediaRecorder.isTypeSupported(t)) : null);

function encodeWav(chunks, rate) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) { const s = Math.max(-1, Math.min(1, c[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}

const fmtTime = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// onDone(File) : 녹음이 끝나면 파일을 넘겨 줌
export default function Recorder({ onDone, disabled }) {
  const [state, setState] = useState('idle'); // idle | rec | paused
  const [sec, setSec] = useState(0);
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState(null);
  const r = useRef({});

  useEffect(() => () => cleanup(), []); // eslint-disable-line
  useEffect(() => {
    if (state === 'idle') return;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);

  function cleanup() {
    const x = r.current;
    clearInterval(x.timer);
    x.stream?.getTracks().forEach(t => t.stop());
    x.ctx?.close().catch(() => {});
    r.current = {};
  }

  async function start() {
    setErr(null);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
    catch (e) { setErr(tr('마이크를 사용할 수 없습니다. 브라우저의 마이크 권한을 확인하세요.')); return; }
    const x = { stream, chunks: [], mp4: pickMp4(), paused: false };
    // 소리 크기 표시 + (m4a 를 못 쓰는 브라우저는) wav 로 직접 녹음
    let ctx;
    try { ctx = new AudioContext(x.mp4 ? {} : { sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0);
      let peak = 0; for (let i = 0; i < d.length; i += 16) peak = Math.max(peak, Math.abs(d[i]));
      x.peak = peak;
      if (!x.mp4 && !x.paused) x.chunks.push(new Float32Array(d));
    };
    src.connect(proc); proc.connect(ctx.destination);
    x.ctx = ctx; x.rate = ctx.sampleRate;
    if (x.mp4) {
      x.rec = new MediaRecorder(stream, { mimeType: x.mp4, audioBitsPerSecond: 64000 });
      x.rec.ondataavailable = e => e.data.size && x.chunks.push(e.data);
      x.rec.start(1000);
    }
    x.t0 = Date.now(); x.acc = 0;
    x.timer = setInterval(() => {
      setSec(Math.floor((x.acc + (x.paused ? 0 : Date.now() - x.t0)) / 1000));
      setLevel(x.peak || 0);
    }, 250);
    r.current = x;
    setSec(0); setState('rec');
  }

  function pause() {
    const x = r.current;
    if (state === 'rec') { x.paused = true; x.acc += Date.now() - x.t0; x.rec?.pause(); setState('paused'); }
    else { x.paused = false; x.t0 = Date.now(); x.rec?.resume(); setState('rec'); }
  }

  async function stop() {
    const x = r.current;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    let file;
    if (x.rec) {
      await new Promise(res => { x.rec.onstop = res; x.rec.stop(); });
      file = new File(x.chunks, `${tr('회의녹음')}_${stamp}.m4a`, { type: 'audio/mp4' });
    } else {
      file = new File([encodeWav(x.chunks, x.rate)], `${tr('회의녹음')}_${stamp}.wav`, { type: 'audio/wav' });
    }
    cleanup();
    setState('idle'); setLevel(0);
    onDone(file);
  }

  if (!canRecord()) {
    return <div className="err">{tr('이 주소에서는 브라우저가 마이크를 막습니다. https 주소(또는 서버 PC에서 localhost)로 접속해야 녹음할 수 있습니다. 휴대폰 등으로 녹음한 파일은 아래에서 올릴 수 있습니다.')}</div>;
  }
  return (
    <div className="rec">
      {err && <div className="err">{err}</div>}
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        {state === 'idle'
          ? <button className="btn primary" type="button" onClick={start} disabled={disabled}>● {tr('녹음 시작')}</button>
          : <>
            <span className={`recdot ${state === 'rec' ? 'on' : ''}`} />
            <b className="rectime">{fmtTime(sec)}</b>
            <span className="meter"><i style={{ width: `${Math.min(100, Math.round(level * 140))}%` }} /></span>
            <button className="btn" type="button" onClick={pause}>{state === 'rec' ? tr('일시정지') : tr('계속 녹음')}</button>
            <button className="btn primary" type="button" onClick={stop}>■ {tr('녹음 끝내기')}</button>
          </>}
      </div>
      {state !== 'idle' && <div className="small" style={{ marginTop: 6 }}>{tr('녹음이 끝날 때까지 이 창을 닫거나 다른 화면으로 이동하지 마세요.')}</div>}
    </div>
  );
}
