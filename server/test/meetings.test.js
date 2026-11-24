// 회의록 API 테스트 — 음성인식·AI 정리는 가짜로 바꿔 끼워 외부 호출 없이 흐름만 확인
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-meet-'));
process.env.DB_CLIENT = 'sqlite';
process.env.DATA_DIR = tmp;
process.env.SESSION_SECRET = 'test';
process.env.MEETING_POLL_MS = '20';

let server, base, cookie = '', engines, pid;
async function call(method, url, body) {
  const opt = { method, headers: { cookie } };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(base + '/api' + url, opt);
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer() };
}
const wait = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20)); }
};
const audioForm = (name, fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (name) fd.append('audio', new Blob([Buffer.from('RIFF....WAVEfake')]), name);
  return fd;
};

before(async () => {
  const { prepareDb } = await import('../src/migrate.js');
  const { createApp } = await import('../src/index.js');
  ({ engines } = await import('../src/routes/meetings.js'));
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await call('POST', '/auth/setup', { username: 'admin', name: '관리자', password: 'admin1234' })).status, 200);
  pid = (await call('POST', '/projects', { name: '시험 프로젝트' })).body.id;
});
after(async () => {
  server?.close();
  const { db } = await import('../src/db.js');
  await db.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('녹음 업로드 → 음성인식 → AI 정리가 자동으로 이어지고, 화자 이름이 정리에 반영된다', async () => {
  const calls = [];
  let polls = 0;
  Object.assign(engines, {
    sttEnabled: () => true, aiEnabled: () => true,
    start: async (file, lang) => { calls.push(['start', path.basename(file), lang, fs.existsSync(file)]); return 'job-1'; },
    get: async id => (++polls < 2 ? { status: 'transcribing' } : { status: 'completed', utterances: [{ t: 0, d: 1500, spk: 0, text: '다음 주 금요일까지 시험 보고서 제출합시다.' }, { t: 2000, d: 1000, spk: 1, text: '네, 제가 하겠습니다.' }] }),
    summarize: async input => { calls.push(['sum', input.transcript, input.outLang]); return { summary: '보고서 제출 합의', topics: [], decisions: ['보고서 제출'], action_items: [{ task: '시험 보고서 제출', owner: '김', due: '2026-11-27' }], issues: [], next_meeting: '', _lang: input.outLang }; }
  });
  const r = await call('POST', `/projects/${pid}/meetings`, audioForm('주간회의 녹음.wav', { title: '주간 회의', held_at: '2026-11-20T10:00', attendees: '김, 이', language: 'ko' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.audio_name, '주간회의 녹음.wav');
  assert.equal(r.body.has_audio, true);
  const id = r.body.id;
  const done = await wait(async () => { const m = (await call('GET', `/projects/${pid}/meetings/${id}`)).body; return m.status === 'done' && m; });
  assert.equal(done.transcript.length, 2);
  assert.equal(done.duration_ms, 3000);
  assert.equal(done.summary.action_items[0].due, '2026-11-27');
  assert.deepEqual(calls[0], ['start', `${id}.wav`, 'ko', true]);
  assert.match(calls[1][1], /\[00:00:00\] 화자1: 다음 주/);

  // 화자 이름 지정 후 다시 정리 (베트남어로)
  assert.equal((await call('PATCH', `/projects/${pid}/meetings/${id}`, { speakers: { 0: '김부장', 1: '이대리' } })).status, 200);
  assert.equal((await call('POST', `/projects/${pid}/meetings/${id}/summarize`, { lang: 'vi' })).status, 200);
  await wait(async () => (await call('GET', `/projects/${pid}/meetings/${id}`)).body.status === 'done' && calls.length === 3);
  assert.match(calls[2][1], /김부장: 다음 주/);
  assert.equal(calls[2][2], 'vi');

  // 녹음 파일 내려받기, 목록에는 전사본이 빠짐
  const a = await call('GET', `/projects/${pid}/meetings/${id}/audio`);
  assert.equal(a.status, 200);
  const list = (await call('GET', `/projects/${pid}/meetings`)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].transcript, undefined);
});

test('메모만 있는 회의록도 정리할 수 있고, 형식이 안 맞는 파일·빈 제목은 거부', async () => {
  Object.assign(engines, { sttEnabled: () => false, aiEnabled: () => false });
  assert.equal((await call('POST', `/projects/${pid}/meetings`, audioForm('a.webm', { title: 'x' }))).status, 400);
  assert.equal((await call('POST', `/projects/${pid}/meetings`, audioForm(null, { title: ' ' }))).status, 400);
  const m = (await call('POST', `/projects/${pid}/meetings`, audioForm(null, { title: '메모 회의', notes: '설계 검토 완료' }))).body;
  assert.equal(m.status, 'draft');
  // AI 꺼져 있으면 503
  assert.equal((await call('POST', `/projects/${pid}/meetings/${m.id}/summarize`, {})).status, 503);
  // 녹음만 올리면 uploaded (음성인식 꺼짐)
  const u = (await call('POST', `/projects/${pid}/meetings`, audioForm('b.m4a', { title: '녹음만' }))).body;
  assert.equal(u.status, 'uploaded');
  assert.equal((await call('POST', `/projects/${pid}/meetings/${u.id}/transcribe`, {})).status, 503);

  engines.aiEnabled = () => true;
  engines.summarize = async () => { throw Object.assign(new Error('AI 사용량 한도에 걸렸습니다. 잠시 후 다시 시도하세요.'), { status: 502 }); };
  assert.equal((await call('POST', `/projects/${pid}/meetings/${m.id}/summarize`, {})).status, 200);
  const after = await wait(async () => { const x = (await call('GET', `/projects/${pid}/meetings/${m.id}`)).body; return x.status !== 'summarizing' && x; });
  assert.equal(after.status, 'draft');
  assert.match(after.error, /한도/);

  // 동시 수정 보호, 삭제
  assert.equal((await call('PATCH', `/projects/${pid}/meetings/${m.id}`, { notes: '수정', version: 99 })).status, 409);
  assert.equal((await call('DELETE', `/projects/${pid}/meetings/${u.id}`)).status, 200);
  assert.equal(fs.existsSync(path.join(tmp, 'meetings', `${u.id}.m4a`)), false);
});

test('음성인식 실패는 오류 상태와 메시지로 남는다', async () => {
  Object.assign(engines, {
    sttEnabled: () => true, aiEnabled: () => false,
    start: async () => 'job-2',
    get: async () => ({ status: 'failed', error: '음성인식에 실패했습니다.' })
  });
  const m = (await call('POST', `/projects/${pid}/meetings`, audioForm('c.mp3', { title: '실패' }))).body;
  const x = await wait(async () => { const r = (await call('GET', `/projects/${pid}/meetings/${m.id}`)).body; return r.status === 'error' && r; });
  assert.match(x.error, /실패/);
});
