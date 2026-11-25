// DB 스키마. 새 변경은 배열 끝에 추가만 합니다 (기존 항목은 수정하지 않음).
const migrations = [
  {
    name: '001_initial',
    async up(k) {
      await k.schema.createTable('users', t => {
        t.increments('id');
        t.string('username', 64).notNullable().unique();
        t.string('name', 100).notNullable();
        t.string('email', 200);
        t.string('password_hash', 200);
        t.string('role', 16).notNullable().defaultTo('user'); // admin | user
        t.boolean('active').notNullable().defaultTo(true);
        t.string('created_at', 32);
      });
      await k.schema.createTable('projects', t => {
        t.increments('id');
        t.string('code', 40);
        t.string('name', 200).notNullable();
        t.text('description');
        t.string('client', 200);
        t.string('status', 20).notNullable().defaultTo('진행중'); // 계획 | 진행중 | 보류 | 완료
        t.string('calendars', 40).notNullable().defaultTo('KR'); // 쉼표 구분 국가 코드 (KR,VN)
        t.string('day_basis', 10).notNullable().defaultTo('workday'); // workday: 주말·공휴일 제외 | calendar: 달력일
        t.boolean('archived').notNullable().defaultTo(false);
        t.string('created_at', 32);
        t.string('updated_at', 32);
      });
      await k.schema.createTable('project_members', t => {
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
        t.string('role', 16).notNullable().defaultTo('member'); // pm | member | viewer
        t.primary(['project_id', 'user_id']);
      });
      await k.schema.createTable('phases', t => {
        t.increments('id');
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.string('name', 100).notNullable();
        t.string('color', 16);
        t.integer('sort').notNullable().defaultTo(0);
      });
      await k.schema.createTable('tasks', t => {
        t.increments('id');
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.integer('phase_id').references('phases.id').onDelete('SET NULL');
        t.string('code', 40);
        t.string('name', 300).notNullable();
        t.string('name_en', 300);
        t.string('type', 20).notNullable().defaultTo('작업'); // 작업 | 마일스톤 | 제출 | 지급 | 검토 | 홀드포인트 | 회의
        t.string('owner', 200); // 담당 (기관/사람, 자유 입력)
        t.integer('assignee_id').references('users.id').onDelete('SET NULL');
        t.string('start', 10).notNullable();
        t.string('end', 10).notNullable();
        t.string('baseline_start', 10);
        t.string('baseline_end', 10);
        t.string('actual_end', 10);
        t.string('not_before', 10); // 최초 가능일: 자동 계산 시 이보다 앞당기지 않음
        t.string('status', 20).notNullable().defaultTo('미착수'); // 미착수 | 진행중 | 완료 | 보류
        t.integer('progress').notNullable().defaultTo(0);
        t.boolean('is_key').notNullable().defaultTo(false);
        t.string('ref', 200);
        t.text('note');
        t.integer('sort').notNullable().defaultTo(0);
        t.integer('version').notNullable().defaultTo(1);
        t.string('updated_at', 32);
        t.integer('updated_by');
        t.index(['project_id']);
      });
      await k.schema.createTable('dependencies', t => {
        t.increments('id');
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.integer('pred_id').notNullable().references('tasks.id').onDelete('CASCADE');
        t.integer('succ_id').notNullable().references('tasks.id').onDelete('CASCADE');
        t.string('kind', 2).notNullable().defaultTo('FS'); // FS 끝-시작 | SS 동시 시작 | FF 동시 종료
        t.integer('lag').notNullable().defaultTo(0); // 근무일
        t.unique(['pred_id', 'succ_id', 'kind']);
      });
      await k.schema.createTable('issues', t => {
        t.increments('id');
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.string('code', 40);
        t.integer('task_id').references('tasks.id').onDelete('SET NULL');
        t.string('category', 40);
        t.string('title', 300).notNullable();
        t.text('detail');
        t.string('raised', 10);
        t.string('target', 10);
        t.string('resolved', 10);
        t.string('party', 100); // 책임기관
        t.string('owner', 100); // 담당자
        t.integer('assignee_id').references('users.id').onDelete('SET NULL');
        t.string('priority', 4).notNullable().defaultTo('중'); // 상 | 중 | 하
        t.string('status', 20).notNullable().defaultTo('접수'); // 접수 | 검토중 | 조치중 | 해결완료 | 보류
        t.string('source', 200);
        t.text('remark');
        t.integer('version').notNullable().defaultTo(1);
        t.string('updated_at', 32);
        t.integer('updated_by');
        t.index(['project_id']);
      });
      await k.schema.createTable('issue_comments', t => {
        t.increments('id');
        t.integer('issue_id').notNullable().references('issues.id').onDelete('CASCADE');
        t.integer('user_id').references('users.id').onDelete('SET NULL');
        t.text('body').notNullable();
        t.string('created_at', 32);
      });
      await k.schema.createTable('holidays', t => {
        t.increments('id');
        t.string('country', 4).notNullable();
        t.string('date', 10).notNullable();
        t.string('name', 200);
        t.unique(['country', 'date']);
      });
      await k.schema.createTable('audit_log', t => {
        t.increments('id');
        t.string('at', 32).notNullable();
        t.integer('user_id');
        t.string('user_name', 100);
        t.integer('project_id');
        t.string('entity', 20).notNullable();
        t.integer('entity_id');
        t.string('action', 20).notNullable(); // create | update | delete | import | baseline
        t.string('label', 300);
        t.text('changes'); // JSON {field: [before, after]}
        t.index(['project_id', 'at']);
      });
    }
  },
  {
    // 조직(부서)·직원 정보, M365 SSO 연결용 칸
    name: '002_org',
    async up(k) {
      await k.schema.createTable('departments', t => {
        t.increments('id');
        t.string('name', 100).notNullable();
        t.integer('parent_id').references('departments.id').onDelete('SET NULL'); // 상위 부서 (선택)
        t.string('code', 40);
        t.integer('sort').notNullable().defaultTo(0);
        t.boolean('active').notNullable().defaultTo(true);
        t.string('created_at', 32);
      });
      await k.schema.alterTable('users', t => {
        t.integer('department_id').references('departments.id').onDelete('SET NULL');
        t.string('employee_no', 40); // 사번
        t.string('position', 40); // 직급/직책
        t.string('phone', 40);
        // 로그인 방식: local(자체 계정) | m365 (Entra ID). SSO 전환 시 external_id 에 Entra 객체 ID 저장
        t.string('auth_provider', 16).notNullable().defaultTo('local');
        t.string('external_id', 100);
        t.string('last_login_at', 32);
      });
    }
  },
  {
    // 화면 언어(ko/vi/en)와 입력 내용 번역 결과 저장 (DeepL 호출을 줄이기 위해 같은 문장은 다시 번역하지 않음)
    name: '003_i18n',
    async up(k) {
      await k.schema.alterTable('users', t => { t.string('lang', 5); });
      await k.schema.createTable('translations', t => {
        t.increments('id');
        t.string('src_hash', 64).notNullable(); // 원문 SHA-256
        t.string('target', 5).notNullable(); // ko | vi | en
        t.text('src').notNullable();
        t.text('text').notNullable();
        t.string('detected', 5); // DeepL 이 감지한 원문 언어
        t.string('created_at', 32);
        t.unique(['src_hash', 'target']);
      });
    }
  },
  {
    // 공휴일 기본값 보강: 한국 2027(노동절·제헌절 포함), 베트남 2026·2027. 이미 있는 날짜는 건드리지 않음
    name: '004_holidays_2027',
    async up(k) {
      const { KR_HOLIDAYS } = await import('./holidaysKR.js');
      const { VN_HOLIDAYS } = await import('./holidaysVN.js');
      for (const [country, list] of [['KR', KR_HOLIDAYS.filter(([d]) => d >= '2027')], ['VN', VN_HOLIDAYS]]) {
        for (const [date, name] of list) {
          const ex = await k('holidays').where({ country, date }).first();
          if (!ex) await k('holidays').insert({ country, date, name });
        }
      }
    }
  },
  {
    // 2026년부터 노동절·제헌절이 공휴일 (관공서의 공휴일에 관한 규정 2026.4.30. 개정)
    name: '005_kr_2026_labor_constitution',
    async up(k) {
      for (const [date, name] of [['2026-05-01', '노동절'], ['2026-07-17', '제헌절']]) {
        const ex = await k('holidays').where({ country: 'KR', date }).first();
        if (!ex) await k('holidays').insert({ country: 'KR', date, name });
      }
    }
  },
  {
    // 회의록: 녹음 파일, 음성인식 결과(전사본), AI 정리 결과
    name: '006_meetings',
    async up(k) {
      await k.schema.createTable('meetings', t => {
        t.increments('id');
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.string('title', 300).notNullable();
        t.string('held_at', 16); // YYYY-MM-DDTHH:MM
        t.text('attendees');
        t.string('language', 8).notNullable().defaultTo('ko'); // ko | vi | en | multi (회의에서 쓴 언어)
        t.string('audio_file', 200); // data/meetings 안의 파일 이름
        t.string('audio_name', 300); // 올린 파일 원래 이름
        t.bigInteger('audio_size');
        t.integer('duration_ms');
        // draft(메모만) | uploaded(녹음만, 음성인식 꺼짐) | transcribing | transcribed | summarizing | done | error
        t.string('status', 16).notNullable().defaultTo('draft');
        t.string('stt_job_id', 100);
        t.text('transcript'); // JSON [{t, d, spk, text, lang}]
        t.text('speakers'); // JSON {화자번호: 이름}
        t.text('notes'); // 직접 적은 메모
        t.text('summary'); // JSON (AI 정리 결과, 사람이 고칠 수 있음)
        t.string('summarized_at', 32);
        t.text('error');
        t.integer('version').notNullable().defaultTo(1);
        t.integer('created_by');
        t.string('created_at', 32);
        t.string('updated_at', 32);
        t.integer('updated_by');
        t.index(['project_id']);
      });
    }
  },
  {
    // Outlook 달력 구독(ICS) 주소용 개인 토큰. 006 은 회의록 기능(별도 브랜치)이 씀
    name: '007_ics_token',
    async up(k) {
      await k.schema.alterTable('users', t => { t.string('ics_token', 64); t.unique(['ics_token']); });
    }
  },
  {
    name: '008_notifications',
    async up(k) {
      await k.schema.createTable('notifications', t => {
        t.increments('id');
        t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
        t.string('kind', 30).notNullable();
        t.integer('project_id').references('projects.id').onDelete('CASCADE');
        t.string('entity', 20);
        t.integer('entity_id');
        t.text('params');
        t.string('created_at', 32);
        t.string('read_at', 32);
        t.string('dedupe', 120).unique();
        t.index(['user_id', 'id']);
      });
    }
  },
  {
    // 11/24 개정 계획: 카테고리(연구·시공·설계), 칸반 열, 할 일 필드, 체크리스트. 기존 프로젝트는 모두 시공으로
    name: '009_categories_board',
    async up(k) {
      await k.schema.alterTable('projects', t => {
        t.string('category', 16).notNullable().defaultTo('construction'); // research | construction | design
      });
      await k.schema.createTable('board_columns', t => {
        t.increments('id');
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.string('name', 60).notNullable();
        t.string('color', 16);
        t.string('status', 20).notNullable().defaultTo('미착수'); // 이 열에 놓으면 작업 상태가 이 값으로 바뀜
        t.boolean('is_review').notNullable().defaultTo(false);
        t.integer('sort').notNullable().defaultTo(0);
        t.index(['project_id']);
      });
      await k.schema.alterTable('tasks', t => {
        t.integer('board_column_id').references('board_columns.id').onDelete('SET NULL');
        t.integer('board_order').notNullable().defaultTo(0);
        t.string('priority', 8).notNullable().defaultTo('보통'); // 낮음 | 보통 | 높음 | 긴급
        t.string('tags', 300);
        t.integer('reviewer_id').references('users.id').onDelete('SET NULL');
        t.boolean('undated').notNullable().defaultTo(false); // 마감일 없이 만든 할 일 (start/end 는 만든 날로 채워 둠)
        t.string('created_at', 32);
      });
      await k.schema.createTable('task_checklist', t => {
        t.increments('id');
        t.integer('task_id').notNullable().references('tasks.id').onDelete('CASCADE');
        t.string('text', 300).notNullable();
        t.boolean('done').notNullable().defaultTo(false);
        t.integer('sort').notNullable().defaultTo(0);
        t.index(['task_id']);
      });
      for (const p of await k('projects').select('id')) await insertDefaultColumns(k, p.id);
    }
  },
  {
    // 2단계(연구 일정): 회의 시각·장소·참석자·링크, 칸반 검토 흐름, 연구 과제 정보
    name: '010_research_schedule',
    async up(k) {
      await k.schema.alterTable('tasks', t => {
        t.string('start_time', 5); // HH:MM (회의 등 시각이 있는 일정)
        t.string('end_time', 5);
        t.string('location', 200);
        t.text('attendees'); // 참석자 계정 id 쉼표 구분
        t.string('meeting_url', 500); // Teams 회의 링크 (3단계에서 자동 생성 예정)
        t.string('outlook_event_id', 200); // 3단계 Outlook 동기화용
        t.string('review_state', 12); // requested | approved | rejected
        t.text('review_note');
      });
      await k.schema.alterTable('projects', t => {
        t.string('agreement_start', 10); // 연구: 협약 기간
        t.string('agreement_end', 10);
        t.string('partners', 300); // 연구: 협력 기관
      });
    }
  },
  {
    // 시공 일정 재구성(11/25): 업체·공종, 기준선 버전
    name: '011_construction_schedule',
    async up(k) {
      await k.schema.alterTable('tasks', t => {
        t.string('company', 120); // 업체(협력사)
        t.string('trade', 80); // 공종
      });
      await k.schema.createTable('baselines', t => {
        t.increments('id');
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.string('name', 100).notNullable();
        t.integer('count').notNullable().defaultTo(0);
        t.string('created_at', 32);
        t.integer('created_by');
        t.index(['project_id']);
      });
      await k.schema.createTable('baseline_tasks', t => {
        t.increments('id');
        t.integer('baseline_id').notNullable().references('baselines.id').onDelete('CASCADE');
        t.integer('task_id').notNullable().references('tasks.id').onDelete('CASCADE');
        t.string('start', 10).notNullable();
        t.string('end', 10).notNullable();
        t.index(['baseline_id']);
      });
    }
  },
  {
    // 시공 2·3순위(11/25): 마감일, 실제 시작일, 하위 작업(WBS), 간트 머리 기간 표시
    name: '012_construction_more',
    async up(k) {
      await k.schema.alterTable('tasks', t => {
        t.string('deadline', 10); // 마감일: 종료일이 이 날을 넘으면 경고
        t.string('actual_start', 10); // 실제 시작일 (주간 진척 입력)
        t.integer('parent_id'); // 상위 작업 (하위 작업이 있으면 요약 작업)
        t.index(['parent_id']);
      });
      await k.schema.createTable('timeline_events', t => {
        t.increments('id');
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.string('name', 100).notNullable();
        t.string('start', 10).notNullable();
        t.string('end', 10).notNullable();
        t.string('color', 9).notNullable().defaultTo('#d9822b');
        t.index(['project_id']);
      });
    }
  },
  {
    // 설계 1순위(11/25): 예상 시간·사람별 업무량, 단계 제출일, 프로젝트 템플릿
    name: '013_design_workload',
    async up(k) {
      await k.schema.alterTable('tasks', t => {
        t.float('est_hours'); // 예상 시간 (선택 입력, 업무량 계산용)
      });
      await k.schema.alterTable('phases', t => {
        t.string('due', 10); // 제출일 (설계: 계획·기본·실시설계 제출 등)
      });
      await k.schema.alterTable('users', t => {
        t.float('weekly_hours').notNullable().defaultTo(40); // 주당 근무 가능 시간 (업무량 기준)
      });
      await k.schema.createTable('project_templates', t => {
        t.increments('id');
        t.string('name', 100).notNullable();
        t.string('category', 16).notNullable().defaultTo('design');
        t.text('data').notNullable(); // JSON: { phases, columns, tasks }
        t.string('created_at', 32);
        t.integer('created_by');
      });
      await k('project_templates').insert({ name: '건축 설계 기본', category: 'design', data: JSON.stringify(BUILTIN_DESIGN_TEMPLATE), created_at: new Date().toISOString() });
    }
  },
  {
    // 설계 2·3순위(11/25): 투입 시간 기록, 휴가·부재, 인건비(단가·설계비), 외부 협력자
    name: '014_design_time_leave',
    async up(k) {
      await k.schema.createTable('time_entries', t => {
        t.increments('id');
        t.integer('project_id').notNullable().references('projects.id').onDelete('CASCADE');
        t.integer('task_id').references('tasks.id').onDelete('SET NULL');
        t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
        t.string('date', 10).notNullable();
        t.float('hours').notNullable();
        t.string('note', 300);
        t.string('created_at', 32);
        t.index(['project_id']); t.index(['user_id', 'date']);
      });
      await k.schema.createTable('leaves', t => {
        t.increments('id');
        t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
        t.string('start', 10).notNullable();
        t.string('end', 10).notNullable();
        t.string('kind', 12).notNullable().defaultTo('휴가'); // 휴가 | 반차 | 출장 | 교육 | 기타
        t.string('note', 200);
        t.string('created_at', 32);
        t.integer('created_by');
        t.index(['user_id']);
      });
      await k.schema.alterTable('users', t => {
        t.float('hourly_rate'); // 시간당 단가 (인건비 예측, 관리자만 봄)
        t.boolean('external').notNullable().defaultTo(false); // 외부 협력자: 참여 프로젝트의 자기 카드만 봄
      });
      await k.schema.alterTable('projects', t => {
        t.float('design_fee'); // 설계비(예산), 인건비 예측과 비교
      });
    }
  }
];

// 처음 깔 때 들어가는 설계 템플릿 예시 (프로젝트 설정에서 지울 수 있음). 칸반 열이 없으면 기본 4열
export const BUILTIN_DESIGN_TEMPLATE = {
  phases: [{ name: '계획설계', color: '#2f6fde' }, { name: '기본설계', color: '#8e5bd8' }, { name: '실시설계', color: '#d9822b' }, { name: '인허가', color: '#159a8c' }],
  tasks: [
    { name: '현황 조사·법규 검토', phase: 0, checklist: ['대지 현황 사진', '용도지역·건폐율·용적률 확인', '관련 법규 목록'] },
    { name: '배치·매스 계획안', phase: 0, checklist: ['대안 2~3개', '면적표'] },
    { name: '계획설계 보고', phase: 0, type: '제출', is_key: true },
    { name: '평면도', phase: 1, tags: '평면' },
    { name: '입면·단면도', phase: 1, tags: '입면, 단면' },
    { name: '구조·설비 협의', phase: 1, checklist: ['구조 협의 회의', '설비 협의 회의'] },
    { name: '기본설계 제출', phase: 1, type: '제출', is_key: true },
    { name: '상세도', phase: 2, tags: '상세' },
    { name: '마감·창호 일람표', phase: 2 },
    { name: '도면 검토(체크리스트)', phase: 2, checklist: ['도면 번호·목록', '치수 확인', '구조·설비 도면과 대조'] },
    { name: '실시설계 제출', phase: 2, type: '제출', is_key: true },
    { name: '인허가 서류 준비', phase: 3, checklist: ['건축허가 신청서', '설계도서', '관련 협의 서류'] },
    { name: '건축허가 접수', phase: 3, type: '제출', is_key: true }
  ]
};

export const DEFAULT_COLUMNS = [
  { name: '할 일', color: '#8a93a6', status: '미착수' },
  { name: '진행 중', color: '#2f6fde', status: '진행중' },
  { name: '검토', color: '#d9822b', status: '진행중', is_review: true },
  { name: '완료', color: '#159a8c', status: '완료' }
];
export async function insertDefaultColumns(k, projectId) {
  for (const [i, c] of DEFAULT_COLUMNS.entries()) {
    await k('board_columns').insert({ project_id: projectId, name: c.name, color: c.color, status: c.status, is_review: !!c.is_review, sort: i });
  }
}

export async function migrate(k) {
  if (!(await k.schema.hasTable('schema_migrations'))) {
    await k.schema.createTable('schema_migrations', t => { t.string('name', 100).primary(); t.string('applied_at', 32); });
  }
  const done = new Set((await k('schema_migrations').select('name')).map(r => r.name));
  const applied = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await k.transaction(async trx => {
      await m.up(trx);
      await trx('schema_migrations').insert({ name: m.name, applied_at: new Date().toISOString() });
    });
    applied.push(m.name);
  }
  return applied;
}
