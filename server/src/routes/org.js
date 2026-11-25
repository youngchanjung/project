// 조직 관리: 직원 계정, 부서, 엑셀로 직원 일괄 등록
import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { db } from '../db.js';
import { ah, HttpError, now, audit, insertId } from '../util.js';
import { hashPassword, publicUser, requireLogin, requireAdmin } from '../auth.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const s = v => (v == null ? '' : String(v).trim());
const ROLE_LABEL = { admin: '관리자', user: '일반' };
const parseRole = v => (/^(admin|관리자)$/i.test(s(v)) ? 'admin' : 'user');

// ---- 직원 계정 ----
export const usersRouter = Router();
usersRouter.use(requireLogin);

usersRouter.get('/', ah(async (_req, res) => {
  const rows = await db('users').orderBy('name');
  res.json(rows.map(publicUser));
}));

async function checkDept(id) {
  if (id === undefined) return undefined;
  if (id === null || id === '') return null;
  const d = await db('departments').where({ id: Number(id) }).first();
  if (!d) throw new HttpError(400, '없는 부서입니다.');
  return d.id;
}
const optText = v => (v === undefined ? undefined : s(v) || null);

usersRouter.post('/', requireAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const username = s(b.username), name = s(b.name);
  if (!username || !name) throw new HttpError(400, '아이디와 이름은 필수입니다.');
  if (!b.password || b.password.length < 8) throw new HttpError(400, '초기 비밀번호는 8자 이상이어야 합니다.');
  if (await db('users').where({ username }).first()) throw new HttpError(400, '이미 있는 아이디입니다.');
  const id = await insertId(db, 'users', {
    username, name, email: optText(b.email) ?? null, role: parseRole(b.role),
    department_id: (await checkDept(b.department_id)) ?? null,
    employee_no: optText(b.employee_no) ?? null, position: optText(b.position) ?? null, phone: optText(b.phone) ?? null,
    password_hash: await hashPassword(b.password), created_at: now()
  });
  await audit(null, { user: req.user, entity: 'user', entityId: id, action: 'create', label: name });
  res.json(publicUser(await db('users').where({ id }).first()));
}));

usersRouter.patch('/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const u = await db('users').where({ id }).first();
  if (!u) throw new HttpError(404, '사용자가 없습니다.');
  const b = req.body || {};
  const up = {};
  if (b.name !== undefined) { if (!s(b.name)) throw new HttpError(400, '이름은 비울 수 없습니다.'); up.name = s(b.name); }
  for (const f of ['email', 'employee_no', 'position', 'phone']) if (b[f] !== undefined) up[f] = optText(b[f]);
  if (b.department_id !== undefined) up.department_id = await checkDept(b.department_id);
  if (b.role) up.role = parseRole(b.role);
  if (b.active !== undefined) up.active = !!b.active;
  if (b.password) {
    if (b.password.length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.');
    up.password_hash = await hashPassword(b.password);
  }
  if (id === req.user.id && (up.role === 'user' || up.active === false)) throw new HttpError(400, '자기 자신의 관리자 권한·계정은 해제할 수 없습니다.');
  const before = publicUser(u);
  if (Object.keys(up).length) await db('users').where({ id }).update(up);
  const after = await db('users').where({ id }).first();
  const changes = {};
  for (const k of Object.keys(up)) if (k !== 'password_hash' && String(before[k] ?? '') !== String(after[k] ?? '')) changes[k] = [before[k] ?? null, after[k] ?? null];
  if (up.password_hash) changes.password = ['', '재설정'];
  await audit(null, { user: req.user, entity: 'user', entityId: id, action: 'update', label: u.name, changes });
  res.json(publicUser(after));
}));

// 엑셀 양식 내려받기
const COLS = ['아이디', '이름', '사번', '부서', '직급', '메일', '전화', '권한', '초기 비밀번호'];
usersRouter.get('/template.xlsx', requireAdmin, ah(async (_req, res) => {
  const [users, depts] = await Promise.all([db('users').orderBy('name'), db('departments')]);
  const dn = new Map(depts.map(d => [d.id, d.name]));
  const rows = users.map(u => [u.username, u.name, u.employee_no || '', dn.get(u.department_id) || '', u.position || '', u.email || '', u.phone || '', ROLE_LABEL[u.role] || '일반', '']);
  if (!rows.length) rows.push(['hong', '홍길동', '2026001', '연구1팀', '책임연구원', 'hong@company.com', '', '일반', 'changeme123']);
  const ws = XLSX.utils.aoa_to_sheet([COLS, ...rows]);
  ws['!cols'] = [12, 10, 10, 14, 12, 26, 14, 8, 14].map(w => ({ wch: w }));
  const help = XLSX.utils.aoa_to_sheet([
    ['작성 방법'],
    ['· 한 줄에 직원 한 명. 아이디·이름은 필수입니다.'],
    ['· 이미 있는 아이디는 이름·사번·부서·직급·메일·전화·권한을 갱신합니다. 초기 비밀번호가 있으면 비밀번호도 바꿉니다.'],
    ['· 새 아이디는 초기 비밀번호(8자 이상)가 꼭 있어야 합니다.'],
    ['· 부서 이름이 없으면 새 부서로 만듭니다.'],
    ['· 권한: 관리자 또는 일반 (비우면 일반)']
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '직원');
  XLSX.utils.book_append_sheet(wb, help, '안내');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="users.xlsx"; filename*=UTF-8''${encodeURIComponent('직원목록.xlsx')}`);
  res.send(buf);
}));

// 엑셀로 직원 일괄 등록. ?apply=1 이 없으면 미리 보기만 (DB 변경 없음)
usersRouter.post('/import', requireAdmin, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, '엑셀 파일을 선택하세요.');
  let wb;
  try { wb = XLSX.read(req.file.buffer, { type: 'buffer' }); } catch { throw new HttpError(400, '엑셀 파일을 읽을 수 없습니다.'); }
  const ws = wb.Sheets['직원'] || wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const hi = aoa.findIndex(r => r.map(s).includes('아이디') && r.map(s).includes('이름'));
  if (hi < 0) throw new HttpError(400, '"아이디", "이름" 열이 있는 머리글 줄을 찾지 못했습니다. 양식을 내려받아 사용하세요.');
  const head = aoa[hi].map(s);
  const col = name => head.indexOf(name);
  const get = (r, name) => (col(name) >= 0 ? s(r[col(name)]) : '');

  const existing = new Map((await db('users')).map(u => [u.username, u]));
  const depts = new Map((await db('departments')).map(d => [d.name, d.id]));
  const seen = new Set();
  const rows = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i];
    const username = get(r, '아이디'), name = get(r, '이름');
    if (!username && !name) continue;
    const row = {
      line: i + 1, username, name, employee_no: get(r, '사번') || null, dept: get(r, '부서') || null,
      position: get(r, '직급') || null, email: get(r, '메일') || null, phone: get(r, '전화') || null,
      role: parseRole(get(r, '권한')), password: get(r, '초기 비밀번호') || get(r, '비밀번호')
    };
    const old = existing.get(username);
    row.action = old ? '갱신' : '추가';
    if (!username || !name) row.error = '아이디와 이름은 필수';
    else if (seen.has(username)) row.error = '같은 아이디가 두 번 있음';
    else if (!old && row.password.length < 8) row.error = '새 직원은 초기 비밀번호 8자 이상 필요';
    else if (old && row.password && row.password.length < 8) row.error = '비밀번호는 8자 이상';
    else if (old && old.id === req.user.id && row.role !== 'admin') row.error = '자기 자신의 관리자 권한은 해제할 수 없음';
    seen.add(username);
    rows.push(row);
  }
  const newDepts = [...new Set(rows.filter(r => !r.error && r.dept && !depts.has(r.dept)).map(r => r.dept))];
  const summary = {
    add: rows.filter(r => !r.error && r.action === '추가').length,
    update: rows.filter(r => !r.error && r.action === '갱신').length,
    errors: rows.filter(r => r.error).length,
    newDepts
  };
  const preview = rows.map(({ password, ...r }) => ({ ...r, hasPassword: !!password }));
  if (req.query.apply !== '1') return res.json({ applied: false, summary, rows: preview });
  if (summary.errors) throw new HttpError(400, `오류가 있는 줄(${summary.errors}개)을 고친 뒤 다시 올려 주세요.`);

  await db.transaction(async trx => {
    for (const name of newDepts) depts.set(name, await insertId(trx, 'departments', { name, created_at: now() }));
    for (const r of rows) {
      const data = {
        name: r.name, employee_no: r.employee_no, department_id: r.dept ? depts.get(r.dept) : null,
        position: r.position, email: r.email, phone: r.phone, role: r.role
      };
      if (r.password) data.password_hash = await hashPassword(r.password);
      const old = existing.get(r.username);
      if (old) await trx('users').where({ id: old.id }).update(data);
      else await trx('users').insert({ ...data, username: r.username, created_at: now() });
    }
    await audit(trx, { user: req.user, entity: 'user', action: 'import', label: `직원 엑셀 등록: 추가 ${summary.add}, 갱신 ${summary.update}` });
  });
  res.json({ applied: true, summary, rows: preview });
}));

// ---- 부서 ----
export const departmentsRouter = Router();
departmentsRouter.use(requireLogin);

departmentsRouter.get('/', ah(async (_req, res) => {
  const [depts, counts] = await Promise.all([
    db('departments').orderBy([{ column: 'sort' }, { column: 'name' }]),
    db('users').where({ active: true }).whereNotNull('department_id').groupBy('department_id').select('department_id').count({ n: '*' })
  ]);
  const cnt = new Map(counts.map(c => [c.department_id, Number(c.n)]));
  res.json(depts.map(d => ({ ...d, active: !!d.active, members: cnt.get(d.id) || 0 })));
}));

async function deptBody(b, id) {
  const out = {};
  if (b.name !== undefined) { out.name = s(b.name); if (!out.name) throw new HttpError(400, '부서 이름을 입력하세요.'); }
  if (b.code !== undefined) out.code = s(b.code) || null;
  if (b.sort !== undefined) out.sort = Number(b.sort) || 0;
  if (b.active !== undefined) out.active = !!b.active;
  if (b.parent_id !== undefined) {
    out.parent_id = b.parent_id === null || b.parent_id === '' ? null : Number(b.parent_id);
    if (out.parent_id) {
      // 자기 자신이나 하위 부서를 상위로 지정하지 않도록 확인
      const all = await db('departments').select('id', 'parent_id');
      const parent = new Map(all.map(d => [d.id, d.parent_id]));
      if (!parent.has(out.parent_id)) throw new HttpError(400, '없는 상위 부서입니다.');
      for (let p = out.parent_id, n = 0; p && n < 100; p = parent.get(p), n++) {
        if (p === id) throw new HttpError(400, '자기 자신이나 하위 부서를 상위 부서로 지정할 수 없습니다.');
      }
    }
  }
  if (out.name) {
    const dup = await db('departments').where({ name: out.name }).modify(q => { if (id) q.whereNot({ id }); }).first();
    if (dup) throw new HttpError(400, '같은 이름의 부서가 이미 있습니다.');
  }
  return out;
}

departmentsRouter.post('/', requireAdmin, ah(async (req, res) => {
  const data = await deptBody(req.body || {});
  if (!data.name) throw new HttpError(400, '부서 이름을 입력하세요.');
  const id = await insertId(db, 'departments', { ...data, created_at: now() });
  await audit(null, { user: req.user, entity: 'department', entityId: id, action: 'create', label: data.name });
  res.json(await db('departments').where({ id }).first());
}));

departmentsRouter.patch('/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = await db('departments').where({ id }).first();
  if (!d) throw new HttpError(404, '부서가 없습니다.');
  const data = await deptBody(req.body || {}, id);
  if (Object.keys(data).length) await db('departments').where({ id }).update(data);
  await audit(null, { user: req.user, entity: 'department', entityId: id, action: 'update', label: data.name || d.name });
  res.json(await db('departments').where({ id }).first());
}));

departmentsRouter.delete('/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = await db('departments').where({ id }).first();
  if (!d) throw new HttpError(404, '부서가 없습니다.');
  const { n } = await db('users').where({ department_id: id }).count({ n: '*' }).first();
  if (Number(n) > 0) throw new HttpError(400, `소속 직원이 ${n}명 있어 삭제할 수 없습니다. 직원 부서를 먼저 옮기거나 "사용 안 함"으로 바꾸세요.`);
  await db.transaction(async trx => {
    await trx('departments').where({ parent_id: id }).update({ parent_id: d.parent_id ?? null });
    await trx('departments').where({ id }).del();
    await audit(trx, { user: req.user, entity: 'department', entityId: id, action: 'delete', label: d.name });
  });
  res.json({ ok: true });
}));
