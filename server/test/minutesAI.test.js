import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_CLIENT = 'sqlite';
const { summarizeMeeting, buildPrompt, transcriptText, SUMMARY_SCHEMA } = await import('../src/minutesAI.js');
const { sttConfig } = await import('../src/stt.js');

test('전사본 문장: 시각과 화자 이름', () => {
  assert.equal(transcriptText([{ t: 3723000, spk: 1, text: '안녕' }], { 1: '김' }), '[01:02:03] 김: 안녕');
});

test('정리 결과 정리: 잘못된 날짜·중요도는 비우거나 기본값', async () => {
  const r = await summarizeMeeting({ meeting: { title: 't' }, project: { name: 'p' }, members: [], transcript: 'x', outLang: 'ko' }, {
    caller: async prompt => { assert.match(prompt, /한국어로 작성/); return { json: { summary: 's', action_items: [{ task: 'a', owner: '', due: '다음주' }], issues: [{ title: 'i', detail: '', priority: '긴급' }] } }; }
  });
  assert.equal(r.action_items[0].due, '');
  assert.equal(r.issues[0].priority, '중');
  assert.deepEqual(r.decisions, []);
});

test('구조화 출력 스키마: 모든 객체가 additionalProperties=false, required 전부', () => {
  const walk = s => { if (s.type === 'object') { assert.equal(s.additionalProperties, false); assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort()); Object.values(s.properties).forEach(walk); } if (s.items) walk(s.items); };
  walk(SUMMARY_SCHEMA);
  assert.match(buildPrompt({ meeting: { title: 't' }, project: { name: 'p' }, members: [{ name: '김' }], notes: '메모', outLang: 'vi' }), /Vietnamese[\s\S]*<회의_메모>/);
});

test('회의 언어별 음성인식 모델', () => {
  assert.equal(sttConfig('ko').model_name, 'sommers');
  assert.deepEqual([sttConfig('vi').model_name, sttConfig('vi').language], ['whisper', 'vi']);
  assert.deepEqual(sttConfig('multi').language_candidates, ['ko', 'vi', 'en']);
  assert.equal(sttConfig('ko').use_diarization, true);
});

test('리턴제로 호출: 토큰 한 번 발급 후 재사용, 결과 변환, 오류 코드 안내', async () => {
  const { config } = await import('../src/config.js');
  Object.assign(config, { rtzrClientId: 'id', rtzrClientSecret: 'sec' });
  const { startTranscribe, getTranscribe } = await import('../src/stt.js');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stt-')), 'a.wav'); fs.writeFileSync(f, 'x');
  const seen = [];
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetcher = async (url, opt) => {
    seen.push(url.replace('https://openapi.vito.ai', ''));
    if (url.endsWith('/authenticate')) return json(200, { access_token: 'tok', expire_at: Math.floor(Date.now() / 1000) + 6 * 3600 });
    assert.equal(opt.headers.Authorization, 'Bearer tok');
    if (opt.method === 'POST') { assert.equal(JSON.parse(opt.body.get('config')).model_name, 'whisper'); return json(200, { id: 'J1' }); }
    if (url.endsWith('/J1')) return json(200, { id: 'J1', status: 'completed', results: { utterances: [{ start_at: 10, duration: 5, msg: 'xin chào', spk: 0, lang: 'vi' }] } });
    return json(413, { code: 'H0006', msg: 'too long' });
  };
  assert.equal(await startTranscribe(f, 'vi', { fetcher }), 'J1');
  assert.deepEqual((await getTranscribe('J1', { fetcher })).utterances, [{ t: 10, d: 5, spk: 0, text: 'xin chào', lang: 'vi' }]);
  await assert.rejects(getTranscribe('J2', { fetcher }), /4시간/);
  assert.equal(seen.filter(u => u === '/v1/authenticate').length, 1);
});
