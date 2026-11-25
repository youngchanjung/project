// 회의록 AI 정리 (Claude API). .env 의 ANTHROPIC_API_KEY 가 있을 때만 동작합니다.
// 전사본(또는 직접 적은 메모)을 읽고 요약·주제별 내용·결정 사항·할 일·이슈를 JSON 으로 정리합니다.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

export const aiEnabled = () => !!config.anthropicKey;
const LANG_NAME = { ko: '한국어', vi: 'Vietnamese (Tiếng Việt)', en: 'English' };

const str = { type: 'string' };
export const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'topics', 'decisions', 'action_items', 'issues', 'next_meeting'],
  properties: {
    summary: { type: 'string', description: '회의 전체 요약 (3~6문장)' },
    topics: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['title', 'points'], properties: { title: str, points: { type: 'array', items: str } } }
    },
    decisions: { type: 'array', items: str },
    action_items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['task', 'owner', 'due'],
        properties: { task: str, owner: { type: 'string', description: '담당자 이름, 모르면 빈 문자열' }, due: { type: 'string', description: 'YYYY-MM-DD, 모르면 빈 문자열' } }
      }
    },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'detail', 'priority'],
        properties: { title: str, detail: str, priority: { type: 'string', enum: ['상', '중', '하'] } }
      }
    },
    next_meeting: { type: 'string', description: '다음 회의 일정·안건, 없으면 빈 문자열' }
  }
};

const SYSTEM = `당신은 연구개발(R&D) 조직의 회의록 담당자입니다. 회의 전사본을 읽고 프로젝트 일정관리 프로그램에 저장할 회의록을 정리합니다.
- 전사본은 음성인식 결과라 오타·끊긴 문장·화자 번호가 섞여 있습니다. 문맥으로 뜻을 바로잡되, 말하지 않은 내용을 지어내지 마세요.
- decisions 에는 회의에서 확정된 것만, action_items 에는 누가 무엇을 하기로 한 것만 넣습니다. 담당자·기한이 언급되지 않았으면 빈 문자열로 둡니다.
- 상대적인 날짜("다음 주 금요일")는 회의 날짜를 기준으로 YYYY-MM-DD 로 바꿉니다.
- issues 에는 일정 지연, 기술 문제, 협의가 필요한 사항 등 후속 관리가 필요한 문제만 넣습니다. priority 는 일정·비용 영향이 크면 상, 보통 중, 작으면 하.
- 해당 항목이 없으면 빈 배열로 둡니다.`;

const mmss = ms => { const s = Math.floor((ms || 0) / 1000); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export function transcriptText(utterances, speakers = {}) {
  return (utterances || []).map(u => `[${mmss(u.t)}] ${speakers[u.spk] || `화자${(u.spk ?? 0) + 1}`}: ${u.text}`).join('\n');
}

export function buildPrompt({ meeting, project, members, transcript, notes, outLang }) {
  const parts = [
    `프로젝트: ${project.name}${project.code ? ` (${project.code})` : ''}`,
    `회의 제목: ${meeting.title}`,
    `회의 날짜: ${meeting.held_at || '(미기재)'}`,
    `참석자: ${meeting.attendees || '(미기재)'}`,
    `프로젝트 참여자 이름(담당자 표기에 사용): ${members.map(m => m.name).join(', ') || '(없음)'}`,
    `정리 결과는 ${LANG_NAME[outLang] || LANG_NAME.ko}로 작성하세요. (priority 값은 상/중/하 그대로)`
  ];
  if (notes?.trim()) parts.push(`\n<회의_메모>\n${notes.trim()}\n</회의_메모>`);
  if (transcript?.trim()) parts.push(`\n<전사본>\n${transcript.trim()}\n</전사본>`);
  return parts.join('\n');
}

let client = null;
async function callClaude(prompt) {
  client ||= new Anthropic({ apiKey: config.anthropicKey });
  const stream = client.beta.messages.stream({
    model: config.minutesModel,
    max_tokens: 32000,
    // 안전 분류기가 드물게 거절할 때 다른 모델로 자동 재시도
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SUMMARY_SCHEMA } },
    messages: [{ role: 'user', content: prompt }]
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('AI가 이 회의록 정리를 거절했습니다.'), { status: 502 });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('회의가 너무 길어 AI 정리가 중간에 끊겼습니다.'), { status: 502 });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { json: JSON.parse(text), model: msg.model, usage: msg.usage };
}

// 반환: { summary, topics, decisions, action_items, issues, next_meeting, _model, _lang }
export async function summarizeMeeting(input, { caller = callClaude } = {}) {
  let r;
  try { r = await caller(buildPrompt(input)); }
  catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw Object.assign(new Error('Claude API 키가 올바르지 않습니다. ANTHROPIC_API_KEY 를 확인하세요.'), { status: 502 });
    if (e instanceof Anthropic.RateLimitError) throw Object.assign(new Error('AI 사용량 한도에 걸렸습니다. 잠시 후 다시 시도하세요.'), { status: 502 });
    if (e instanceof Anthropic.APIError) throw Object.assign(new Error(`AI 정리 오류 (${e.status})`), { status: 502 });
    throw e;
  }
  const j = r.json || {};
  const arr = v => (Array.isArray(v) ? v : []);
  return {
    summary: String(j.summary || ''),
    topics: arr(j.topics).map(t => ({ title: String(t.title || ''), points: arr(t.points).map(String) })),
    decisions: arr(j.decisions).map(String),
    action_items: arr(j.action_items).map(a => ({ task: String(a.task || ''), owner: String(a.owner || ''), due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : '' })),
    issues: arr(j.issues).map(i => ({ title: String(i.title || ''), detail: String(i.detail || ''), priority: ['상', '중', '하'].includes(i.priority) ? i.priority : '중' })),
    next_meeting: String(j.next_meeting || ''),
    _model: r.model || config.minutesModel,
    _lang: input.outLang || 'ko'
  };
}
