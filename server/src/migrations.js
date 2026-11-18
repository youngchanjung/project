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
  }
];

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
