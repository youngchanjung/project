// 업무량: 사람별로 주마다 맡은 할 일의 예상 시간 합계를 주당 근무 시간과 비교
//   - 예상 시간은 시작~마감 사이 근무일에 고르게 나눔 (지난 몫은 오늘부터 다시 나눔)
//   - 진한 막대 = 이 프로젝트, 옅은 막대 = 다른 프로젝트
//   - 80% 넘으면 주황, 100% 넘으면 빨강
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useProject } from '../pages/Project.jsx';
import { fmt, fmtW, fmtH, personColor } from '../util.js';
import { tr } from '../i18n.js';
import { Tx } from '../contentTr.jsx';

const level = (h, cap) => (!cap ? (h > 0 ? 'over' : '') : h > cap ? 'over' : h >= cap * 0.8 ? 'high' : '');

export default function Workload() {
  const { project, openTask, tasks } = useProject();
  const nav = useNavigate();
  const [weeks, setWeeks] = useState(4);
  const [onlyHere, setOnlyHere] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(null); // { uid, wi }
  // 할 일이 바뀌면(편집창 저장 등) 다시 계산
  const stamp = tasks.map(t => `${t.id}:${t.version}`).join(',');
  useEffect(() => {
    api.get(`/workload?project=${project.id}&weeks=${weeks}`).then(d => { setData(d); setErr(null); }).catch(e => setErr(e.message));
  }, [project.id, weeks, stamp]);

  if (err) return <div className="err">{err}</div>;
  if (!data) return <div className="loading">{tr('불러오는 중…')}</div>;
  const hv = c => (onlyHere ? c.here : c.hours);
  const over = data.rows.filter(r => hv(r.weeks[0]) > r.caps[0]).length;
  const noEst = data.rows.reduce((a, r) => a + r.weeks.reduce((b, c) => b + c.noEst, 0), 0) + (data.unassigned?.weeks.reduce((b, c) => b + c.noEst, 0) || 0);
  const rows = [...data.rows, ...(data.unassigned ? [{ user: { id: 0, name: tr('담당 없음') }, caps: data.weeks.map(() => 0), ...data.unassigned }] : [])];
  const cur = sel && rows.find(r => r.user.id === sel.uid);
  const cell = cur && cur.weeks[sel.wi];
  const open = t => (t.project_id === project.id ? openTask(t.id) : nav(`/projects/${t.project_id}/board?open=${t.id}`));

  return (
    <>
      <div className="toolbar">
        <select value={weeks} onChange={e => setWeeks(Number(e.target.value))}>{[2, 4, 6, 8].map(n => <option key={n} value={n}>{tr('{n}주 보기', { n })}</option>)}</select>
        <button type="button" className={`tbtn ${onlyHere ? 'on' : ''}`} onClick={() => setOnlyHere(!onlyHere)}>{onlyHere ? '✓ ' : ''}{tr('이 프로젝트만')}</button>
        <span className={`badge ${over ? 'b-지연' : 'b-완료'}`}>{over ? tr('이번 주 넘침 {n}명', { n: over }) : tr('이번 주 넘치는 사람 없음')}</span>
        {noEst > 0 && <span className="small">{tr('시간 미입력 카드 {n}건은 건수만 셉니다.', { n: noEst })}</span>}
        <div className="sp" />
        <span className="small"><span className="wl-key here" /> {tr('이 프로젝트')} <span className="wl-key other" /> {tr('다른 프로젝트')}</span>
      </div>
      <div className="card wl-wrap">
        <table className="wl">
          <thead><tr><th>{tr('담당자')}</th>
            {data.weeks.map((w, i) => <th key={w.start}>{i === 0 ? tr('이번 주') : i === 1 ? tr('다음 주') : `${fmt(w.start)}~${fmt(w.end)}`}<div className="small">{i < 2 ? `${fmt(w.start)}~${fmt(w.end)}` : ''}{w.workdays < 5 ? `${i < 2 ? ' · ' : ''}${tr('근무 {n}일', { n: w.workdays })}` : ''}</div></th>)}
            <th>{tr('날짜 없음')}</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.user.id}>
              <td className="nw">{r.user.id ? <span className="avatar sm" style={{ background: personColor(r.user.id) }}>{r.user.name.slice(0, 1)}</span> : null} {r.user.name}
                {r.weekly_hours && r.weekly_hours !== 40 ? <div className="small">{tr('주 {n}시간', { n: r.weekly_hours })}</div> : null}</td>
              {r.weeks.map((c, i) => {
                const h = hv(c), cap = r.caps[i], lv = r.user.id ? level(c.hours, cap) : '';
                const max = Math.max(cap, c.hours, 1);
                const on = sel && sel.uid === r.user.id && sel.wi === i;
                return (
                  <td key={i} className={`wl-c ${lv} ${on ? 'on' : ''}`} onClick={() => setSel(on ? null : { uid: r.user.id, wi: i })} title={tr('누르면 할 일 목록을 봅니다.')}>
                    {c.count ? <>
                      <div className="wl-bar">
                        <span className="here" style={{ width: `${(c.here / max) * 100}%` }} />
                        {!onlyHere && <span className="other" style={{ width: `${((c.hours - c.here) / max) * 100}%` }} />}
                        {cap > 0 && c.hours > cap && <i className="cap" style={{ left: `${(cap / max) * 100}%` }} />}
                      </div>
                      <div className="wl-n"><b>{fmtH(h)}</b>{r.user.id ? <span className="small"> / {fmtH(cap)}</span> : null}</div>
                      <div className="small">{tr('카드 {n}', { n: c.count })}{c.noEst ? ` · ${tr('시간 미입력 {n}', { n: c.noEst })}` : ''}</div>
                    </> : <span className="small">-</span>}
                  </td>
                );
              })}
              <td className="small nw">{r.undated.count ? `${r.undated.count}${tr('건')}${r.undated.hours ? ` · ${fmtH(r.undated.hours)}` : ''}` : '-'}</td>
            </tr>))}
          </tbody>
        </table>
        {!rows.length && <p className="small">{tr('참여자가 없습니다. ‘설정’에서 참여자를 추가하세요.')}</p>}
      </div>
      {cell && <div className="card" style={{ marginTop: 12 }}>
        <h3>{cur.user.name} · {sel.wi === 0 ? tr('이번 주') : sel.wi === 1 ? tr('다음 주') : `${fmt(data.weeks[sel.wi].start)}~${fmt(data.weeks[sel.wi].end)}`} <span className="small">{fmtH(cell.hours)}{cur.caps[sel.wi] ? ` / ${fmtH(cur.caps[sel.wi])}` : ''}</span></h3>
        {cell.tasks.length ? <table><tbody>{cell.tasks.filter(t => !onlyHere || t.here).map(t => (
          <tr key={t.id} className="clickable" onClick={() => open(t)}>
            <td><Tx>{t.name}</Tx>{t.project_id !== project.id && <div className="small">{t.project_name}</div>}</td>
            <td className="small nw">{tr('마감')} {fmtW(t.end)}</td>
            <td className="nw">{t.est ? fmtH(t.hours) : <span className="small">{tr('시간 미입력')}</span>}</td>
          </tr>))}</tbody></table> : <p className="small">{tr('이 주에 걸친 할 일이 없습니다.')}</p>}
        <p className="small">{tr('예상 시간은 시작일~마감일 사이 근무일에 고르게 나눠 계산합니다. 기한이 지난 할 일은 이번 주에 모두 넣습니다.')}</p>
      </div>}
    </>
  );
}
