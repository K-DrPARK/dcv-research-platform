import { one, all, run, audit } from './db.js';
import { aiJson } from './ai.js';
import { nowIso, uid, safeJson } from './util.js';
import { empiricalReadiness, loadEmpiricalCalibration } from './empirical.js';

export async function generateReport(env,projectId){
  const p=await one(env.DB,`SELECT * FROM projects WHERE id=?`,[projectId]);
  const def=await one(env.DB,`SELECT * FROM definitions WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
  const meas=await one(env.DB,`SELECT * FROM measurements WHERE project_id=? ORDER BY measured_at DESC LIMIT 1`,[projectId]);
  const appr=await one(env.DB,`SELECT * FROM approvals WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]);
  const rm=await one(env.DB,`SELECT * FROM reviewer_models WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
  const counts=await one(env.DB,`SELECT COUNT(*) total, SUM(CASE WHEN status='CONFIRM' THEN 1 ELSE 0 END) confirmed FROM validations WHERE project_id=? AND validation_type='human_recompute'`,[projectId]);
  const empirical=await empiricalReadiness(env,projectId),cal=await loadEmpiricalCalibration(env,projectId);
  const evidence={project:p,definition:safeJson(def?.content_json,{}),measurement:safeJson(meas?.metrics_json,{}),approval:appr?{decision:appr.decision,evidence_level:appr.evidence_level,basis:safeJson(appr.basis_json,{})}:null,reviewer:safeJson(rm?.model_json,{}),final_region:counts,empirical:{readiness:empirical.status,complete_rows:empirical.complete_rows,target_rows:empirical.target_rows,profile:cal.profile.version,coefficients:cal.coeff}};
  const ai=await aiJson(env,'You are an academic research reporting assistant. Do not invent evidence. Summarize only the supplied structured evidence and explicitly state limitations.',JSON.stringify(evidence),{abstract:'자동 요약을 생성하지 못했습니다.',findings:[],limitations:['AI 요약 미사용'],implications:[]});
  const b=evidence.approval?.basis?.candidate||{};
  const md=`# ${p?.name||'DCV 연구 결과'}\n\n## 연구목적\n${evidence.definition.research_question||''}\n\n## 최종 판정\n- 결정: **${evidence.approval?.decision||'미확정'}**\n- Evidence Level: **${evidence.approval?.evidence_level||'-'}**\n- 최종 후보: estimator=${b.estimator??'-'}, σ=${b.sigma??'-'}, τ=${b.tau??'-'}, α=${b.alpha??'-'}, K=${b.K??'-'}, d=${b.d??'-'}, W=${b.W??'-'}, m=${b.m??'-'}
- Minimax Regret: ${b.max_regret??'-'}
- Boundary Score: ${b.boundary_score??'-'}\n\n## 인간 검토자 보정\n- ARR: ${evidence.reviewer.appropriate_reliance_rate??'-'}\n- False Acceptance: ${evidence.reviewer.false_accept_rate??'-'}\n- Correct Override: ${evidence.reviewer.correct_override_rate??'-'}\n- 평균 검토시간(초): ${evidence.reviewer.mean_delay??'-'}\n\n## AI 기반 증거 요약\n${ai.abstract||''}\n\n### 주요 발견\n${(ai.findings||[]).map(x=>`- ${x}`).join('\n')}\n\n### 한계\n${(ai.limitations||[]).map(x=>`- ${x}`).join('\n')}\n\n### 시사점\n${(ai.implications||[]).map(x=>`- ${x}`).join('\n')}\n\n---\n본 보고서는 D1에 저장된 실행 로그와 검증 결과를 기반으로 자동 생성되었습니다.\n`;
  const id=uid('report'); await run(env.DB,`INSERT INTO reports(id,project_id,kind,title,content_markdown,data_json,created_at) VALUES(?,?,?,?,?,?,?)`,[id,projectId,'paper_summary',`${p?.name||'DCV'} 연구결과`,md,JSON.stringify(evidence),nowIso()]);
  await run(env.DB,`UPDATE projects SET current_stage='report',status='complete',updated_at=? WHERE id=?`,[nowIso(),projectId]);
  await audit(env,projectId,'agent','report.generated','report',id,{approval:evidence.approval?.decision});
  return {id,markdown:md,evidence,ai};
}
