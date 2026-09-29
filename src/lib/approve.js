import { one, run, audit, enqueue } from './db.js';
import { nowIso, uid, safeJson } from './util.js';
import { empiricalReadiness } from './empirical.js';
export async function approveProject(env,projectId){
  const p=await one(env.DB,`SELECT * FROM projects WHERE id=?`,[projectId]);if(!p)throw new Error('project_not_found');
  const cand=await one(env.DB,`SELECT c.*,v.result_json FROM design_candidates c JOIN validations v ON v.candidate_id=c.id WHERE c.project_id=? AND v.validation_type='human_recompute' AND v.status='CONFIRM' ORDER BY COALESCE(c.max_regret,999999) ASC, c.authority_k DESC, c.sigma DESC LIMIT 1`,[projectId]);
  if(!cand){await audit(env,projectId,'agent','approve.hold','project',projectId,{reason:'no_human_confirmed_candidate'});return{decision:'HOLD'};}
  const robust=await one(env.DB,`SELECT result_json FROM validations WHERE candidate_id=? AND validation_type='robust' AND status='CONFIRM' ORDER BY created_at DESC LIMIT 1`,[cand.id]);
  const reviewer=await one(env.DB,`SELECT model_json FROM reviewer_models WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
  const empirical=await empiricalReadiness(env,projectId);
  const evidenceLevel=reviewer?(empirical.status==='FULL_EPISODE_PANEL'?'A':'B'):'C',autoAllowed=String(env.AUTO_APPROVE||'false')==='true'||Number(p.auto_approve)===1,decision=autoAllowed?'CONFIRMED_DELEGATION':'READY_FOR_APPROVAL';
  const basis={selection_rule:'robust feasibility first, minimax regret second',evidence_scope:empirical.status==='FULL_EPISODE_PANEL'?'locally reproducible empirical panel + human validation':'published empirical anchor + local CDRS validation; episode-level replication archive not yet complete',empirical_readiness:{status:empirical.status,complete_rows:empirical.complete_rows,target_rows:empirical.target_rows},candidate:{id:cand.id,estimator:cand.estimator,sigma:cand.sigma,tau:cand.tau,alpha:cand.alpha,K:cand.authority_k,d:cand.delay_d,W:cand.recovery_w,m:cand.adjust_m,max_regret:cand.max_regret,boundary_score:cand.boundary_score},robust:safeJson(robust?.result_json,{}),human:safeJson(cand.result_json,{}),reviewer:safeJson(reviewer?.model_json,{})};
  const id=uid('approval');await run(env.DB,`INSERT INTO approvals(id,project_id,candidate_id,decision,evidence_level,basis_json,automatic,created_at) VALUES(?,?,?,?,?,?,?,?)`,[id,projectId,cand.id,decision,evidenceLevel,JSON.stringify(basis),autoAllowed?1:0,nowIso()]);
  await run(env.DB,`UPDATE projects SET status=?,current_stage='approved',updated_at=? WHERE id=?`,[decision.toLowerCase(),nowIso(),projectId]);await audit(env,projectId,'agent','approve.complete','approval',id,{decision,evidenceLevel,autoAllowed});await enqueue(env,projectId,'generate_report',{},95);return{id,decision,evidenceLevel,basis};
}
