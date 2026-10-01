import { one, run, audit, enqueue } from './db.js';
import { nowIso, uid, safeJson } from './util.js';
import { empiricalReadiness, loadEmpiricalCalibration } from './empirical.js';
import { latestProtocol } from './rigor.js';

export async function approveProject(env,projectId){
  const p=await one(env.DB,`SELECT * FROM projects WHERE id=?`,[projectId]);if(!p)throw new Error('project_not_found');
  const cycle=Number(p.research_cycle||1),rev=Number(p.evidence_revision||0);
  const cand=await one(env.DB,`SELECT c.*,v.result_json FROM design_candidates c JOIN validations v ON v.candidate_id=c.id WHERE c.project_id=? AND c.research_cycle=? AND v.evidence_revision=? AND v.validation_type='human_recompute' AND v.status='CONFIRM' ORDER BY COALESCE(c.max_regret,999999) ASC, c.authority_k DESC, c.sigma DESC LIMIT 1`,[projectId,cycle,rev]);
  if(!cand){await audit(env,projectId,'agent','approve.hold','project',projectId,{reason:'no_human_confirmed_candidate'});return{decision:'HOLD'};}
  const robust=await one(env.DB,`SELECT result_json FROM validations WHERE candidate_id=? AND validation_type='robust' AND status='CONFIRM' ORDER BY created_at DESC LIMIT 1`,[cand.id]);
  const reviewer=await one(env.DB,`SELECT model_json FROM reviewer_models WHERE project_id=? AND research_cycle=? AND evidence_revision=? ORDER BY version DESC LIMIT 1`,[projectId,cycle,rev]);
  const empirical=await empiricalReadiness(env,projectId),cal=await loadEmpiricalCalibration(env,projectId),protocol=await latestProtocol(env,projectId);
  const proxyOnly=cal.loss?.identification_status==='PROXY_ONLY';
  const evidenceLevel=reviewer?(empirical.status==='FULL_EPISODE_PANEL'?(proxyOnly?'A-PROXY':'A'):'B'):'C';
  // Machine completion is never labelled as final scientific approval. A human PI/committee sign-off is a separate action.
  const decision='COMPUTATIONALLY_CONFIRMED';
  const basis={selection_rule:'robust feasibility first, minimax regret second',scientific_signoff_required:true,protocol_hash:protocol?.protocol_hash||null,evidence_scope:empirical.status==='FULL_EPISODE_PANEL'?'locally reproducible empirical panel + participant-cluster human validation':'published empirical anchor + local CDRS validation; episode-level replication archive not yet complete',loss_identification:cal.loss?.identification_status||null,claim_scope:cal.loss?.claim_scope||null,empirical_readiness:{status:empirical.status,complete_rows:empirical.complete_rows,target_rows:empirical.target_rows},candidate:{id:cand.id,estimator:cand.estimator,sigma:cand.sigma,tau:cand.tau,alpha:cand.alpha,K:cand.authority_k,d:cand.delay_d,W:cand.recovery_w,m:cand.adjust_m,max_regret:cand.max_regret,boundary_score:cand.boundary_score},robust:safeJson(robust?.result_json,{}),human:safeJson(cand.result_json,{}),reviewer:safeJson(reviewer?.model_json,{})};
  const id=uid('approval');await run(env.DB,`INSERT INTO approvals(id,project_id,candidate_id,decision,evidence_level,basis_json,automatic,created_at,research_cycle,evidence_revision) VALUES(?,?,?,?,?,?,?,?,?,?)`,[id,projectId,cand.id,decision,evidenceLevel,JSON.stringify(basis),1,nowIso(),cycle,rev]);
  await run(env.DB,`UPDATE projects SET status='computationally_confirmed',current_stage='scientific_review',updated_at=? WHERE id=?`,[nowIso(),projectId]);await audit(env,projectId,'agent','approve.computational_complete','approval',id,{decision,evidenceLevel});await enqueue(env,projectId,'generate_report',{},95);return{id,decision,evidenceLevel,basis};
}

export async function scientificSignoff(env,projectId,{reviewer_name='PI',rationale=''}={}){
  const p=await one(env.DB,`SELECT research_cycle,evidence_revision FROM projects WHERE id=?`,[projectId]); const cycle=Number(p?.research_cycle||1),rev=Number(p?.evidence_revision||0);
  const prior=await one(env.DB,`SELECT * FROM approvals WHERE project_id=? AND research_cycle=? AND evidence_revision=? AND stale_at IS NULL AND decision='COMPUTATIONALLY_CONFIRMED' ORDER BY created_at DESC LIMIT 1`,[projectId,cycle,rev]);
  if(!prior)throw new Error('computational_confirmation_required');
  const basis={...safeJson(prior.basis_json,{}),scientific_reviewer:String(reviewer_name),scientific_rationale:String(rationale),signed_from_approval_id:prior.id};
  const id=uid('approval');await run(env.DB,`INSERT INTO approvals(id,project_id,candidate_id,decision,evidence_level,basis_json,automatic,created_at,research_cycle,evidence_revision) VALUES(?,?,?,?,?,?,0,?,?,?)`,[id,projectId,prior.candidate_id,'SCIENTIFICALLY_APPROVED',prior.evidence_level,JSON.stringify(basis),nowIso(),cycle,rev]);
  await run(env.DB,`UPDATE projects SET status='scientifically_approved',current_stage='approved',approval_stale=0,revalidation_from=NULL,updated_at=? WHERE id=?`,[nowIso(),projectId]);await audit(env,projectId,'user','approve.scientific_signoff','approval',id,{reviewer_name,rationale});await enqueue(env,projectId,'generate_report',{},95);
  return{id,decision:'SCIENTIFICALLY_APPROVED',evidenceLevel:prior.evidence_level};
}
