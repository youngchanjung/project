import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { tr, locale } from '../i18n.js';

export const FIELD = {
  name: '작업명', name_en: '영문명', code: 'ID', type: '유형', phase_id: '단계', owner: '담당', assignee_id: '담당자', start: '시작', end: '종료',
  baseline_start: '기준 시작', baseline_end: '기준 종료', actual_end: '실제 완료', deadline: '마감 기한', actual_start: '실제 시작', parent_id: '상위 작업', company: '업체', trade: '공종', not_before: '최초 가능일', status: '상태', progress: '진행률', weight: '공정 가중치',
  priority: '우선순위', tags: '태그', reviewer_id: '검토자', board_column_id: '칸반 열', undated: '날짜 없음',
  is_key: '핵심', ref: '계약 조항', note: '비고', title: '이슈', detail: '상세', raised: '발생일', target: '목표일', resolved: '해결일',
  party: '책임기관', priority: '중요도', category: '구분', task_id: '관련 작업', remark: '비고', source: '출처', lag: '지연일', kind: '관계',
  calendars: '휴일 달력', day_basis: '계산 기준', description: '설명', client: '발주처', archived: '보관'
};
const ACTION = { create: '추가', update: '수정', delete: '삭제', auto: '자동 조정', import: '엑셀 불러오기', baseline: '기준 일정', comment: '댓글', move: '칸반 이동', checklist: '체크리스트', approve: '승인', reject: '반려', progress: '진척 입력', attach: '사진·첨부 추가', detach: '사진·첨부 삭제' };
const short = v => v === null || v === undefined || v === '' ? tr('(없음)') : String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v);

export default function History({ entity, entityId }) {
  const { project } = useProject();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const q = entity ? `?entity=${entity}&entityId=${entityId}` : '?limit=300';
    api.get(`/projects/${project.id}/audit${q}`).then(setRows);
  }, [entity, entityId, project.id]);
  if (!rows) return <div className="empty">{tr('불러오는 중…')}</div>;
  if (!rows.length) return <div className="empty">{tr('변경 이력이 없습니다.')}</div>;
  return (
    <div className="tablewrap" style={{ maxHeight: 420 }}><table>
      <thead><tr><th>{tr('시각')}</th><th>{tr('사용자')}</th><th>{tr('작업')}</th><th>{tr('내용')}</th></tr></thead>
      <tbody>{rows.map(r => (
        <tr key={r.id}>
          <td className="nw small">{new Date(r.at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td className="nw">{r.user_name}</td>
          <td className="nw"><span className={`badge ${r.action === 'delete' ? 'b-지연' : r.action === 'auto' ? 'b-임박' : 'b-예정'}`}>{tr(ACTION[r.action] || r.action)}</span></td>
          <td>{!entity && r.label && <div>{r.label}</div>}
            {r.changes && <div className="small">{Object.entries(r.changes).filter(([k]) => k !== 'version').map(([k, [a, b]]) => `${tr(FIELD[k] || k)}: ${short(a)} → ${short(b)}`).join(' · ')}</div>}
            {entity && !r.changes && r.label && <div className="small">{r.label}</div>}</td>
        </tr>))}</tbody>
    </table></div>
  );
}
