// 화면에 보이는 표를 엑셀(.xlsx)로 만들어 내려주기
// POST /api/sheet.xlsx { name, sheets: [{ name, header: [...], rows: [[...], ...] }] }
import { Router } from 'express';
import XLSX from 'xlsx';
import { requireLogin } from '../auth.js';
import { HttpError } from '../util.js';

export const sheetRouter = Router();
sheetRouter.use(requireLogin);

const cleanName = (s, i) => (String(s || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim() || `Sheet${i + 1}`).slice(0, 31);
const cell = v => (v == null ? '' : typeof v === 'number' || typeof v === 'boolean' ? v : String(v).slice(0, 32000));

sheetRouter.post('/', (req, res) => {
  const sheets = Array.isArray(req.body?.sheets) ? req.body.sheets.slice(0, 20) : [];
  if (!sheets.length) throw new HttpError(400, '내보낼 내용이 없습니다.');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  sheets.forEach((s, i) => {
    const header = (Array.isArray(s.header) ? s.header : []).map(cell);
    const rows = (Array.isArray(s.rows) ? s.rows : []).slice(0, 50000).map(r => (Array.isArray(r) ? r : []).map(cell));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    // 열 너비: 내용 길이에 맞춤 (최대 60자)
    ws['!cols'] = header.map((h, c) => ({ wch: Math.min(60, Math.max(6, ...[h, ...rows.slice(0, 500).map(r => r[c])].map(v => [...String(v ?? '')].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0) + 2))) }));
    if (header.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
    let nm = cleanName(s.name, i), k = 2;
    while (used.has(nm)) nm = `${cleanName(s.name, i).slice(0, 28)} (${k++})`;
    used.add(nm);
    XLSX.utils.book_append_sheet(wb, ws, nm);
  });
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const file = `${String(req.body?.name || 'export').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file)}`);
  res.send(buf);
});
