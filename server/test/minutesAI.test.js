import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_CLIENT = 'sqlite';
const { summarizeMeeting, buildPrompt, transcriptText, SUMMARY_SCHEMA } = await import('../src/minutesAI.js');
const { sttDefinition } = await import('../src/stt.js');

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

test('회의 언어별 Azure 언어 설정: 화자 구분은 항상, 여러 언어는 언어 지정 없이', () => {
  assert.deepEqual(sttDefinition('ko').locales, ['ko-KR']);
  assert.deepEqual(sttDefinition('vi').locales, ['vi-VN']);
  assert.deepEqual(sttDefinition('en').locales, ['en-US']);
  assert.equal(sttDefinition('multi').locales, undefined);
  assert.equal(sttDefinition('vi').diarization.enabled, true);
});

test('Azure 호출: 주소·키·definition 전달, 결과 변환(화자 0부터·시간순), 오류 안내', async () => {
  const { config } = await import('../src/config.js');
  Object.assign(config, { azureSpeechKey: 'k', azureSpeechRegion: 'koreacentral', azureSpeechEndpoint: '' });
  const { transcribe, sttUrl } = await import('../src/stt.js');
  assert.equal(sttUrl(), 'https://koreacentral.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stt-')), 'a.webm'); fs.writeFileSync(f, 'x');
  const r = await transcribe(f, 'vi', {
    poster: async (url, headers, fields, file) => {
      assert.equal(headers['Ocp-Apim-Subscription-Key'], 'k');
      assert.deepEqual(JSON.parse(fields.definition).locales, ['vi-VN']);
      assert.equal(file, f);
      return { status: 200, body: { durationMilliseconds: 9000, phrases: [
        { offsetMilliseconds: 5000, durationMilliseconds: 1000, text: 'Vâng.', locale: 'vi-VN', speaker: 2 },
        { offsetMilliseconds: 100, durationMilliseconds: 2000, text: 'xin chào', locale: 'vi-VN', speaker: 1 },
        { offsetMilliseconds: 3000, durationMilliseconds: 10, text: ' ', speaker: 1 }
      ] } };
    }
  });
  assert.deepEqual(r, [{ t: 100, d: 2000, spk: 0, text: 'xin chào', lang: 'vi' }, { t: 5000, d: 1000, spk: 1, text: 'Vâng.', lang: 'vi' }]);
  await assert.rejects(transcribe(f, 'ko', { poster: async () => ({ status: 401, body: { error: { code: 'Unauthorized' } } }) }), /AZURE_SPEECH_KEY/);
  await assert.rejects(transcribe(f, 'ko', { poster: async () => ({ status: 400, body: { error: { message: 'Unsupported audio format' } } }) }), /mp3 또는 wav/);
  await assert.rejects(transcribe(f, 'ko', { poster: async () => ({ status: 429, body: {} }) }), e => e.retry === true);
});

test('실제 전송 형식(multipart): definition 과 audio 파일이 스트림으로 전달', async () => {
  const https = await import('node:https'); const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const audio = path.join(dir, '회의.wav'); fs.writeFileSync(audio, Buffer.alloc(200000, 7));
  let got;
  const srv = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, async (req, res) => {
    const fd = await new Request('http://x', { method: 'POST', headers: req.headers, body: req, duplex: 'half' }).formData();
    got = { key: req.headers['ocp-apim-subscription-key'], def: JSON.parse(fd.get('definition')), size: fd.get('audio').size, url: req.url };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ phrases: [{ offsetMilliseconds: 0, durationMilliseconds: 500, text: '안녕하세요', locale: 'ko-KR', speaker: 0 }] }));
  }).listen(0);
  const { config } = await import('../src/config.js');
  Object.assign(config, { azureSpeechKey: 'k2', azureSpeechEndpoint: `https://localhost:${srv.address().port}/` });
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const { transcribe } = await import('../src/stt.js');
    const r = await transcribe(audio, 'ko');
    assert.equal(r[0].text, '안녕하세요');
    assert.equal(got.key, 'k2');
    assert.equal(got.size, 200000);
    assert.deepEqual(got.def.locales, ['ko-KR']);
    assert.match(got.url, /^\/speechtotext\/transcriptions:transcribe\?api-version=/);
  } finally { delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; srv.close(); Object.assign(config, { azureSpeechEndpoint: '' }); }
});
