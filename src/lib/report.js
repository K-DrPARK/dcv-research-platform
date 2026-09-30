import { one, all, run, audit } from './db.js';
import { aiJson } from './ai.js';
import { nowIso, uid, safeJson } from './util.js';
import { empiricalReadiness, loadEmpiricalCalibration } from './empirical.js';

const f = (v, d = 4) => (v == null || v === '' || !Number.isFinite(Number(v))) ? '-' : Number(v).toFixed(d);
const cleanTex = s => String(s ?? '')
  .replace(/\\\((.*?)\\\)/g, '$1')
  .replace(/\\sigma/g, 'σ').replace(/\\alpha/g, 'α').replace(/\\tau/g, 'τ')
  .replace(/\\delta/g, 'δ').replace(/\\([A-Za-z]+)/g, '$1');

// AI를 사용할 수 없을 때도 보고서가 비지 않도록, 저장된 증거만으로 만드는 규칙 기반 요약
function deterministicSummary(ev, counts) {
  const b = ev.approval?.basis?.candidate || {};
  const rv = ev.reviewer || {};
  const decision = ev.approval?.decision || '미확정';
  const findings = [], limitations = [], implications = [];
  if (ev.approval) {
    findings.push(`최종 판정은 ${decision}(Evidence Level ${ev.approval.evidence_level ?? '-'})입니다.`);
    if (b.estimator) findings.push(`최종 후보는 estimator=${b.estimator}, σ=${b.sigma}, α=${b.alpha}, K=${b.K}, d=${b.d} 입니다.`);
    if (b.max_regret != null) findings.push(`강건 후보 중 Minimax Regret 최솟값은 ${f(b.max_regret)} 입니다.`);
  }
  if (rv.appropriate_reliance_rate != null) {
    findings.push(`인간 검토자 ARR ${f(rv.appropriate_reliance_rate, 3)}, 정정 개입률 ${f(rv.correct_override_rate, 3)}, 오수용률 ${f(rv.false_accept_rate, 3)} 입니다.`);
    if (Number(rv.false_accept_rate) > 0.3) limitations.push('검토자의 오수용률이 높아 인간 보정 효과가 제한적일 수 있습니다.');
  } else limitations.push('인간 검토자 관측치가 충분하지 않습니다.');
  if (ev.empirical?.readiness !== 'FULL_EPISODE_PANEL')
    limitations.push(`실증 패널이 완전하지 않습니다 (${ev.empirical?.complete_rows ?? 0}/${ev.empirical?.target_rows ?? 81}). 논문 공표값 앵커에 의존합니다.`);
  limitations.push('시뮬레이션 기반 결과이며 실제 제도 환경으로의 일반화는 추가 검증이 필요합니다.');
  if (decision === 'CONFIRMED_DELEGATION') implications.push('제시된 제약 하에서는 해당 후보 설계로 위임이 가능한 영역이 확인되었습니다.');
  else implications.push('현재 증거로는 위임 가능 영역을 확정하기 어려우므로 경계 표본 추가 수집이 필요합니다.');
  return {
    abstract: `${ev.project?.name || '본 연구'}에서 CDRS 시뮬레이션 ${counts?.total ?? 0}건의 인간 재계산 검증을 거쳐 ${decision} 판정이 도출되었습니다.`,
    findings, limitations, implications
  };
}

const arr = v => Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : JSON.stringify(x)).filter(Boolean) : (v ? [String(v)] : []);

export async function generateReport(env, projectId) {
  const p = await one(env.DB, `SELECT * FROM projects WHERE id=?`, [projectId]);
  const def = await one(env.DB, `SELECT * FROM definitions WHERE project_id=? ORDER BY version DESC LIMIT 1`, [projectId]);
  const meas = await one(env.DB, `SELECT * FROM measurements WHERE project_id=? ORDER BY measured_at DESC LIMIT 1`, [projectId]);
  const appr = await one(env.DB, `SELECT * FROM approvals WHERE project_id=? ORDER BY created_at DESC LIMIT 1`, [projectId]);
  const rm = await one(env.DB, `SELECT * FROM reviewer_models WHERE project_id=? ORDER BY version DESC LIMIT 1`, [projectId]);
  const counts = await one(env.DB, `SELECT COUNT(*) total, SUM(CASE WHEN status='CONFIRM' THEN 1 ELSE 0 END) confirmed FROM validations WHERE project_id=? AND validation_type='human_recompute'`, [projectId]);
  const empirical = await empiricalReadiness(env, projectId), cal = await loadEmpiricalCalibration(env, projectId);
  const evidence = {
    project: p, definition: safeJson(def?.content_json, {}), measurement: safeJson(meas?.metrics_json, {}),
    approval: appr ? { decision: appr.decision, evidence_level: appr.evidence_level, basis: safeJson(appr.basis_json, {}) } : null,
    reviewer: safeJson(rm?.model_json, {}), final_region: counts,
    empirical: { readiness: empirical.status, complete_rows: empirical.complete_rows, target_rows: empirical.target_rows, profile: cal.profile.version, coefficients: cal.coeff }
  };
  const b = evidence.approval?.basis?.candidate || {};
  const rv = evidence.reviewer || {};

  // AI에는 전체 evidence 대신 핵심 수치만 압축해서 전달 (토큰 절약, 환각 방지)
  const compact = {
    research_question: cleanTex(evidence.definition.research_question),
    decision: evidence.approval?.decision ?? null,
    evidence_level: evidence.approval?.evidence_level ?? null,
    final_candidate: { estimator: b.estimator, sigma: b.sigma, tau: b.tau, alpha: b.alpha, K: b.K, d: b.d, W: b.W, m: b.m, max_regret: b.max_regret, boundary_score: b.boundary_score },
    constraints: evidence.definition.constraints ?? null,
    reviewer: { arr: rv.appropriate_reliance_rate, false_accept: rv.false_accept_rate, correct_override: rv.correct_override_rate, mean_delay_sec: rv.mean_delay },
    human_recompute: counts,
    empirical: { status: evidence.empirical.readiness, complete_rows: evidence.empirical.complete_rows, target_rows: evidence.empirical.target_rows }
  };

  const base = deterministicSummary(evidence, counts);
  const ai = await aiJson(
    env,
    '당신은 박사 논문 연구 보고 보조자입니다. 제공된 구조화 증거만 사용하여 한국어로 요약하십시오. 증거에 없는 수치·사실·인용을 만들어내지 마십시오. 한계를 명시하십시오.',
    JSON.stringify(compact),
    base,
    {
      schemaHint: '{"abstract":"3~4문장 요약(string)","findings":["주요 발견 3~5개(string)"],"limitations":["한계 2~4개(string)"],"implications":["시사점 2~3개(string)"]}',
      required: ['abstract'],
      maxTokens: 1800
    }
  );
  const usedAi = ai._ai?.ok === true;
  const abstract = String(ai.abstract || base.abstract);
  const findings = arr(usedAi && ai.findings?.length ? ai.findings : base.findings);
  const limitations = arr(usedAi && ai.limitations?.length ? ai.limitations : base.limitations);
  const implications = arr(usedAi && ai.implications?.length ? ai.implications : base.implications);
  const sourceNote = usedAi
    ? `Workers AI (${ai._ai.model})`
    : `규칙 기반 요약 (AI 호출 실패: ${ai._ai?.error || '알 수 없음'})`;

  const md = `# ${cleanTex(p?.name || 'DCV 연구 결과')}

## 연구목적
${cleanTex(evidence.definition.research_question || '')}

## 최종 판정
- 결정: **${evidence.approval?.decision || '미확정'}**
- Evidence Level: **${evidence.approval?.evidence_level || '-'}**
- 최종 후보: estimator=${b.estimator ?? '-'}, σ=${b.sigma ?? '-'}, τ=${b.tau ?? '-'}, α=${b.alpha ?? '-'}, K=${b.K ?? '-'}, d=${b.d ?? '-'}, W=${b.W ?? '-'}, m=${b.m ?? '-'}
- Minimax Regret: ${f(b.max_regret)}
- Boundary Score: ${f(b.boundary_score)}

## 인간 검토자 보정
- ARR: ${f(rv.appropriate_reliance_rate)}
- False Acceptance: ${f(rv.false_accept_rate)}
- Correct Override: ${f(rv.correct_override_rate)}
- 평균 검토시간(초): ${f(rv.mean_delay, 2)}

## AI 기반 증거 요약
${abstract}

### 주요 발견
${findings.map(x => `- ${x}`).join('\n')}

### 한계
${limitations.map(x => `- ${x}`).join('\n')}

### 시사점
${implications.map(x => `- ${x}`).join('\n')}

---
요약 생성 방식: ${sourceNote}
본 보고서는 D1에 저장된 실행 로그와 검증 결과를 기반으로 자동 생성되었습니다.
`;
  const id = uid('report');
  await run(env.DB, `INSERT INTO reports(id,project_id,kind,title,content_markdown,data_json,created_at) VALUES(?,?,?,?,?,?,?)`,
    [id, projectId, 'paper_summary', `${p?.name || 'DCV'} 연구결과`, md, JSON.stringify({ ...evidence, ai_meta: ai._ai }), nowIso()]);
  await run(env.DB, `UPDATE projects SET current_stage='report',status='complete',updated_at=? WHERE id=?`, [nowIso(), projectId]);
  await audit(env, projectId, 'agent', 'report.generated', 'report', id, { approval: evidence.approval?.decision, ai: ai._ai });
  return { id, markdown: md, content_markdown: md, evidence, ai };
}
