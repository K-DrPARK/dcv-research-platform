import { one, run, audit } from './db.js';
import { aiJson } from './ai.js';
import { nowIso, uid } from './util.js';
import { buildThesisData } from './thesis.js';
import { figureCatalog } from '../../public/figures.js';

const f = (v, d = 3) => (v == null || v === '' || !Number.isFinite(Number(v))) ? '-' : Number(v).toFixed(d);
const pct = (v, d = 1) => (v == null || !Number.isFinite(Number(v))) ? '-' : `${(Number(v) * 100).toFixed(d)}%`;
const cip = o => (!o || !o.n) ? '-' : `${pct(o.p)} [${pct(o.lo)}, ${pct(o.hi)}] (${o.k}/${o.n})`;
const cleanTex = s => String(s ?? '').replace(/\\\((.*?)\\\)/g, '$1').replace(/\\sigma/g, 'σ').replace(/\\alpha/g, 'α').replace(/\\tau/g, 'τ').replace(/\\delta/g, 'δ').replace(/\\([A-Za-z]+)/g, '$1');
const cell = v => String(v ?? '-').replace(/\|/g, '/').replace(/\n/g, ' ');
const mdTable = (head, rows) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map(r => `| ${r.map(cell).join(' | ')} |`).join('\n')}`;
const arr = v => Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : JSON.stringify(x)).filter(Boolean) : (v ? [String(v)] : []);
const EST = { ema: 'EMA', kalman: 'Kalman', changepoint: 'Change-point', adaptive: 'Adaptive' };
const estName = e => EST[e] || e;

export function checklist(t) {
  const items = [], rv = t.reviewer, pn = t.empirical.panel, c = t.candidates;
  if (rv.n < 50) items.push(`검토자 관측이 ${rv.n}건으로 적습니다. 논문 결과로 인용하려면 사전 표본 설계(예: 참가자당 30회 이상, 참가자 수)를 근거로 표본을 늘리세요.`);
  if (rv.participants < 5) items.push(`검토자 참가자가 ${rv.participants}명입니다. 개인 특성이 결과에 그대로 반영되므로 다수 참가자 확보와 참가자 간 변동 분석이 필요합니다.`);
  if (pn.n && pn.estimated / pn.n > 0.5) items.push(`위기 사례 ${pn.n}건 중 estimated 자료가 ${pn.estimated}건(${pct(pn.estimated / pn.n, 0)})입니다. 1차 자료로 재검증하거나 민감도 분석에 명시하세요.`);
  if (t.empirical.readiness !== 'FULL_EPISODE_PANEL') items.push(`실증 패널이 완전하지 않습니다(${t.empirical.complete_rows}/${t.empirical.target_rows}).`);
  if (!c.by_class.confirmed) items.push('CONFIRMED 후보가 없습니다. 제약조건 또는 설계공간을 재검토해야 합니다.');
  if (t.approval && t.approval.evidence_level !== 'A') items.push(`Evidence Level이 ${t.approval.evidence_level}입니다. A 등급 조건(검토자 모델 + 전체 실증 패널)을 충족하지 못했습니다.`);
  if (t.approval?.automatic) items.push('승인이 자동 승인 설정으로 이루어졌습니다. 논문에는 사람의 검토·승인 절차를 별도로 기술하세요.');
  items.push('시뮬레이션의 손실·지급정지 함수는 일반화된 구조 모델입니다. 학위논문의 실제 손실함수와 81개 사례 기반 보정으로 교체하기 전에는 절차 시연·예비 결과로만 사용하세요.');
  items.push('AI가 작성한 문장(요약·논의)은 초안입니다. 수치는 표를 기준으로 직접 대조하세요.');
  return items;
}

function factsForNarrative(t) {
  const c = t.candidates, b = t.selected || {}, rv = t.reviewer;
  return {
    research_question: cleanTex(t.definition.research_question),
    candidates_total: c.total, by_class: c.by_class,
    best_estimator_by_share: [...c.estimators].sort((a, b2) => (b2.share ?? 0) - (a.share ?? 0))[0]?.estimator ?? null,
    estimator_shares: c.estimators.map(e => ({ estimator: e.estimator, share: e.share })),
    decision: t.approval?.decision ?? null, evidence_level: t.approval?.evidence_level ?? null,
    selected: t.selected ? { estimator: b.estimator, sigma: b.sigma, tau: b.tau, alpha: b.alpha, K: b.K, d: b.d, W: b.W, m: b.m, max_regret: b.max_regret, boundary_score: b.boundary_score } : null,
    constraints: t.constraints,
    reviewer: { n: rv.n, participants: rv.participants, arr: rv.arr.p, false_accept: rv.false_accept.p, correct_override: rv.correct_override.p },
    empirical: { rows: t.empirical.panel.n, verified: t.empirical.panel.verified, estimated: t.empirical.panel.estimated, readiness: t.empirical.readiness }
  };
}

function fallbackNarrative(t) {
  const c = t.candidates, b = t.selected, rv = t.reviewer, top = [...c.estimators].sort((a, x) => (x.share ?? 0) - (a.share ?? 0))[0];
  const decision = t.approval?.decision || '미확정';
  const abstract = `본 보고서는 ${cleanTex(t.project.name)}에 대한 CDRS 실행 결과를 요약한다. 설계 후보 ${c.total}개 중 ${c.by_class.confirmed || 0}개(${pct(c.total ? (c.by_class.confirmed || 0) / c.total : 0)})가 모든 제약을 통과해 위임 가능으로 확인되었고, 최종 판정은 ${decision}(Evidence Level ${t.approval?.evidence_level ?? '-'})이다.${b ? ` 선택된 설계는 추정기 ${estName(b.estimator)}, σ=${b.sigma}, α=${b.alpha}, K=${b.K}, d=${b.d}이며 Minimax Regret은 ${f(b.max_regret, 4)}이다.` : ''}${rv.n ? ` 인간 검토자 ${rv.n}건(참가자 ${rv.participants}명)에서 적정 의존율은 ${pct(rv.arr.p)}로 추정되었다.` : ''}`;
  const discussion = [
    top ? `추정기별로는 ${estName(top.estimator)}의 위임 가능 비율이 ${pct(top.share)}로 가장 높았다(표 6). 다만 후보 수가 추정기마다 제한적이므로 신뢰구간의 폭을 함께 고려해야 한다.` : '',
    `σ와 α의 상호작용은 그림 1과 표 5에 나타난 바와 같이 정보오차가 커질수록 위임 가능 비율이 어떻게 달라지는지를 보여 준다.`,
    rv.n ? `검토자 모델에서 오수용률(AI 오답을 수용한 비율)은 ${pct(rv.false_accept.p)}, 정정 개입률은 ${pct(rv.correct_override.p)}였다. 인간의 개입이 항상 안전 장치가 되지는 않으며, 이 행동 모수를 시뮬레이션에 다시 투입한 결과가 최종 후보의 선택을 좌우한다.` : '인간 검토자 관측이 없어 인간 행동 보정은 반영되지 않았다.'
  ].filter(Boolean).join(' ');
  return { abstract, discussion, implications: [decision === 'CONFIRMED_DELEGATION' ? '제시된 제약 하에서 위임이 가능한 설계 영역이 존재함을 보였다.' : '현재 증거만으로는 위임 가능 영역을 확정하기 어렵다.', '설계 변수(σ, α, K, d)를 함께 조정해야 위임 경계를 설명할 수 있다.'], next_steps: ['실제 손실함수와 사례별 모수 보정으로 계산 엔진 교체', '검토자 표본 확대와 참가자 간 이질성 분석', '경계 근처 후보의 반복 시드 검증'] };
}

export function buildMarkdown(t, ai, sourceNote) {
  const c = t.candidates, b = t.selected, rv = t.reviewer, pn = t.empirical.panel, figs = figureCatalog(t), figLine = n => { const g = figs.find(x => x.n === n); return g ? `\n![그림 ${n}. ${g.title}](figures/${g.file}.png)\n\n*그림 ${n}. ${g.title}*\n` : ''; };
  const L = [];
  L.push(`# ${cleanTex(t.project.name)}`, '', `> 자동 생성 연구 보고서 · DCV Research Platform v${t.app_version} · 생성 ${t.generated_at} · 프로젝트 ${t.project.id}`, '');
  L.push('## 0. 요약', '', ai.abstract, '');
  L.push('## 논문 사용 전 점검 사항', '', ...checklist(t).map(x => `- ${x}`), '');

  L.push('## 1. 연구 질문과 설계', '', '### 1.1 연구 질문', '', cleanTex(t.definition.research_question) || '-', '');
  const d = t.design, dimRows = [['σ (정보오차)', d.sigma], ['τ (처리 지연)', d.tau], ['α (정보처리 강도)', d.alpha], ['K (위임 권한)', d.K], ['d (승인 지연)', d.d], ['W (복구규칙)', d.W], ['m (조정)', d.m], ['추정기', (d.estimators || []).map(estName)]].map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : '-']);
  L.push('### 1.2 설계공간', '', '**표 1. 후보 설계공간**', '', mdTable(['변수', '수준'], dimRows), '', `탐색 후보 수 상한: ${d.max_candidates ?? '-'}. 후보는 설계공간에서 결정적 시드(${t.reproducibility.design_seed})로 추출한 풀에서 maximin(최대 최소거리) 기준으로 선택했다.`, '');
  const cs = t.constraints;
  L.push('### 1.3 제약조건', '', '**표 2. 위임 가능 판정 제약조건**', '', mdTable(['제약', '값'], [['평균 손실 상한', cs.loss_max], ['손실 초과율 상한', cs.loss_exceed_max], ['오수용(FP) 상한', cs.fp_max], ['미탐(FN) 상한', cs.fn_max], ['검토 부담 상한', cs.review_burden_max], ['복구시간 상한', cs.recovery_time_max], ['신뢰수준', cs.confidence]]), '');

  L.push('## 2. 실증 보정 데이터', '');
  if (pn.n) {
    const ds = pn.descriptives, row = (k, n) => [n, f(ds[k]?.mean), f(ds[k]?.median), f(ds[k]?.min), f(ds[k]?.max)];
    L.push(`위기 사례 패널은 ${pn.year_min}~${pn.year_max}년 ${pn.n}건이며, 검증(verified) ${pn.verified}건, 추정(estimated) ${pn.estimated}건이다. 파산 사례 비율은 ${cip(pn.failed)}이다.`, '', '**표 3. 위기 사례 패널 기술통계**', '', mdTable(['변수', '평균', '중앙값', '최소', '최대'], [row('peak_outflow', '최대 유출률'), row('concentration', '예금 집중도'), row('digital_adoption', '디지털 이용도'), row('severity', '심각도')]), '', figLine(5));
  } else L.push('사례 패널이 아직 가져와지지 않았습니다.', '');
  if (t.empirical.parameters.length) L.push('**부록 표 A1. 실증 모수**', '', mdTable(['모수', '값', '하한', '상한', '역할', '출처 구분'], t.empirical.parameters.map(p => [p.parameter_key, f(p.value_num, 4), f(p.low_num, 4), f(p.high_num, 4), p.parameter_role, p.provenance_type])), '');

  L.push('## 3. 시뮬레이션 결과', '', '### 3.1 실행 개요', '', '**표 4. 단계별 시뮬레이션 실행량**', '', mdTable(['단계', '실행 수', '에피소드 수', '결정 수'], t.simulation.phases.map(p => [p.phase, p.runs, p.episodes, p.decisions])), '');
  L.push('### 3.2 위임 가능 영역', '', `설계 후보 ${c.total}개 중 CONFIRMED ${c.by_class.confirmed || 0}개(${pct(c.total ? (c.by_class.confirmed || 0) / c.total : 0)}), BOUNDARY ${c.by_class.boundary || 0}개, INFEASIBLE ${c.by_class.infeasible || 0}개${c.by_class.provisional ? `, 잠정 ${c.by_class.provisional}개` : ''}로 분류되었다.`, figLine(1));
  const lv = (k, n) => c.dims[k].map(e => [n, e.level, e.total, e.confirmed, cip(e)]);
  L.push('### 3.3 설계 변수별 위임 가능 비율', '', '**표 5. 변수 수준별 CONFIRMED 비율 (95% Wilson 구간)**', '', mdTable(['변수', '수준', '후보 수', 'CONFIRMED', '비율 [95% CI]'], [...lv('sigma', 'σ'), ...lv('tau', 'τ'), ...lv('alpha', 'α'), ...lv('K', 'K'), ...lv('d', 'd'), ...lv('W', 'W'), ...lv('m', 'm')]), '', '> 주의: 수준별 비율은 다른 변수를 통제하지 않은 주변(marginal) 비율이며 인과효과가 아니다.', '');
  L.push('### 3.4 추정기 비교', '', '**표 6. 추정기별 성능 (후보 평균)**', '', mdTable(['추정기', '후보 수', 'CONFIRMED', '비율 [95% CI]', '평균 손실', 'FP', 'FN', '검토부담', '복구시간'], c.estimators.map(e => [estName(e.estimator), e.total, e.confirmed, cip(e), f(e.loss_mean), f(e.fp_rate), f(e.fn_rate), f(e.review_burden), f(e.recovery_time)])), '', figLine(2));
  L.push('### 3.5 최종 후보군과 Minimax Regret', '', c.finalists.length ? `안전 제약을 통과한 후보 중 최대 후회가 가장 작은 상위 ${c.finalists.length}개를 표 7에 제시한다.` : 'CONFIRMED 후보가 없어 순위를 제시할 수 없다.', '');
  if (c.finalists.length) L.push('**표 7. 강건 후보 순위 (Minimax Regret 오름차순)**', '', mdTable(['순위', '추정기', 'σ', 'τ', 'α', 'K', 'd', 'W', 'm', 'Max Regret', 'Boundary'], c.finalists.map((x, i) => [i + 1, estName(x.estimator), x.sigma, x.tau, x.alpha, x.K, x.d, x.W, x.m, f(x.max_regret, 4), f(x.boundary_score)])), '', figLine(3));
  if (b) { const ph = Object.entries(b.by_phase); if (ph.length) L.push('### 3.6 선택 후보의 단계별 성능', '', '**표 8. 선택 후보 성능 (단계별)**', '', mdTable(['단계', 'n', '평균 손실', '손실 초과율', 'FP', 'FN', '검토부담', '복구시간', 'Regret'], ph.map(([k, v]) => [k, v.n, f(v.loss_mean, 4), f(v.loss_exceed_rate, 4), f(v.fp_rate, 4), f(v.fn_rate, 4), f(v.review_burden, 3), f(v.recovery_time, 3), f(v.regret, 4)])), ''); }

  L.push('## 4. 강건성 검증', '', `시나리오 ${t.simulation.scenarios?.total ?? 0}개(역사적 ${t.simulation.scenarios?.historical ?? 0}, 적대적 ${t.simulation.scenarios?.adversarial ?? 0}) 하에서 후보를 재검증했다.`, '', '**표 9. 검증 결과 집계**', '', mdTable(['검증 유형', '판정', '건수'], t.simulation.validations.map(v => [v.validation_type, v.status, v.n])), '');

  L.push('## 5. 인간 검토자 보정', '');
  if (rv.n) {
    L.push(`검토자 관측 ${rv.n}건(참가자 ${rv.participants}명), 평균 응답시간 ${f(rv.mean_rt_ms / 1000, 2)}초.`, '', '**표 10. 인간 검토자 행동 모수 (95% Wilson 구간)**', '', mdTable(['지표', '추정치 [95% CI]'], [['적정 의존율 (ARR)', cip(rv.arr)], ['오수용률 (AI 오답 수용)', cip(rv.false_accept)], ['정정 개입률 (AI 오답 개입)', cip(rv.correct_override)], ['불필요 개입률 (AI 정답 개입)', cip(rv.unnecessary_override)]]), '', '**표 11. AI 신뢰도별 수용률**', '', mdTable(['AI 신뢰도', 'n', '정답 시 수용', '오답 시 수용', '평균 응답시간(ms)'], rv.by_confidence.map(x => [x.confidence, x.n, cip(x.accept_when_correct), cip(x.accept_when_wrong), f(x.mean_rt_ms, 0)])), '', figLine(4));
  } else L.push('검토자 관측이 없습니다.', '');

  L.push('## 6. 최종 판정', '', t.approval ? `- 판정: **${t.approval.decision}** (Evidence Level ${t.approval.evidence_level}, ${t.approval.automatic ? '자동' : '수동'} 승인, ${t.approval.created_at})` : '- 판정: 미확정', b ? `- 선택 후보: 추정기 ${estName(b.estimator)}, σ=${b.sigma}, τ=${b.tau}, α=${b.alpha}, K=${b.K}, d=${b.d}, W=${b.W}, m=${b.m}\n- Minimax Regret ${f(b.max_regret, 4)}, Boundary Score ${f(b.boundary_score)}` : '', t.approval?.basis?.selection_rule ? `- 선택 규칙: ${t.approval.basis.selection_rule}` : '', '');

  L.push('## 7. 논의', '', ai.discussion, '', '## 8. 한계 및 타당성 위협', '', ...arr(ai.limitations).map(x => `- ${x}`), '', '## 9. 시사점과 후속 연구', '', ...arr(ai.implications).map(x => `- ${x}`), '', '**후속 연구**', '', ...arr(ai.next_steps).map(x => `- ${x}`), '');

  L.push('## 부록 B. 재현성 정보', '', mdTable(['항목', '값'], [['플랫폼 버전', t.app_version], ['프로젝트 ID', t.project.id], ['설계 시드', t.reproducibility.design_seed], ['정의 버전', t.definition.version], ['실증 프로파일', t.empirical.profile], ['검토자 모델 버전', rv.model_version], ['감사 로그', `${t.reproducibility.audit.n}건 (${t.reproducibility.audit.first_at || '-'} ~ ${t.reproducibility.audit.last_at || '-'})`], ['작업 집계', t.reproducibility.jobs.map(j => `${j.type}:${j.status}=${j.n}`).join('; ') || '-']]), '', '---', `요약·논의 생성 방식: ${sourceNote}`, '본 보고서의 표와 그림은 D1에 저장된 실행 기록에서 계산되었습니다. 문장형 요약은 초안이므로 표의 수치와 대조하십시오.', '');
  return L.join('\n');
}

export async function generateReport(env, projectId) {
  const t = await buildThesisData(env, projectId), base = fallbackNarrative(t);
  base.limitations = [...(rvLimit(t)), '시뮬레이션 기반 결과이며 실제 제도 환경으로의 일반화에는 추가 검증이 필요하다.'];
  const ai = await aiJson(env,
    '당신은 박사 논문 연구 보고 보조자입니다. 제공된 구조화 사실만 사용하여 한국어 학술 문체로 작성하십시오. 사실에 없는 수치·사례·인용을 만들지 마십시오. 인과 표현을 피하고 한계를 명시하십시오.',
    JSON.stringify(factsForNarrative(t)), base,
    { schemaHint: '{"abstract":"4~5문장 요약(string)","discussion":"3~5문장 논의(string)","limitations":["한계 3~5개(string)"],"implications":["시사점 2~3개(string)"],"next_steps":["후속 연구 2~4개(string)"]}', required: ['abstract'], maxTokens: 2200 });
  const used = ai._ai?.ok === true, pick = (k, fb) => used && (Array.isArray(ai[k]) ? ai[k].length : ai[k]) ? ai[k] : fb;
  const merged = { abstract: String(pick('abstract', base.abstract)), discussion: String(pick('discussion', base.discussion)), limitations: pick('limitations', base.limitations), implications: pick('implications', base.implications), next_steps: pick('next_steps', base.next_steps) };
  const note = used ? `Workers AI (${ai._ai.model})` : `규칙 기반 (AI 호출 실패: ${ai._ai?.error || '알 수 없음'})`;
  const md = buildMarkdown(t, merged, note), id = uid('report'), p = await one(env.DB, `SELECT name FROM projects WHERE id=?`, [projectId]);
  await run(env.DB, `INSERT INTO reports(id,project_id,kind,title,content_markdown,data_json,created_at) VALUES(?,?,?,?,?,?,?)`, [id, projectId, 'paper_summary', `${p?.name || 'DCV'} 연구결과`, md, JSON.stringify({ ai_meta: ai._ai, narrative: merged, checklist: checklist(t), figures: figureCatalog(t), summary: { decision: t.approval?.decision, candidates: t.candidates.total, confirmed: t.candidates.by_class.confirmed, reviewer_n: t.reviewer.n } }), nowIso()]);
  await run(env.DB, `UPDATE projects SET current_stage='report',status='complete',updated_at=? WHERE id=?`, [nowIso(), projectId]);
  await audit(env, projectId, 'agent', 'report.generated', 'report', id, { approval: t.approval?.decision, ai: ai._ai });
  return { id, markdown: md, content_markdown: md, thesis: t, ai };
}

function rvLimit(t) {
  const L = [], rv = t.reviewer, pn = t.empirical.panel;
  L.push(rv.n ? `인간 검토자 관측이 ${rv.n}건(참가자 ${rv.participants}명)으로, 행동 모수의 신뢰구간이 넓고 개인 이질성을 반영하지 못한다.` : '인간 검토자 관측이 없어 인간 행동이 보정되지 않았다.');
  if (pn.n) L.push(`위기 사례 ${pn.n}건 중 ${pn.estimated}건은 추정값으로, 측정오차가 결과에 전파될 수 있다.`);
  L.push('후보 수준별 비율은 주변 비율이며 변수 간 상호작용과 인과효과를 식별하지 못한다.');
  return L;
}
