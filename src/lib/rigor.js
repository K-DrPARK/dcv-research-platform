import { one, all, run, audit } from './db.js';
import { latestDefinition } from './define.js';
import { empiricalReadiness, loadEmpiricalCalibration } from './empirical.js';
import { nowIso, uid, stableStringify, sha256Hex, safeJson } from './util.js';

export async function buildProtocol(env,projectId){
  const def=await latestDefinition(env,projectId); if(!def) throw new Error('definition_missing');
  const empirical=await empiricalReadiness(env,projectId), cal=await loadEmpiricalCalibration(env,projectId);
  const design=def.content.design||{}, constraints=def.content.constraints||{}, validation=def.content.validation||{};
  const candidates=await all(env.DB,`SELECT sigma,tau,alpha,authority_k,delay_d,recovery_w,adjust_m,estimator FROM design_candidates WHERE project_id=? ORDER BY sigma,tau,alpha,authority_k,delay_d,recovery_w,adjust_m,estimator`,[projectId]);
  const actualPlan=candidates.map(c=>[Number(c.sigma),Number(c.tau),Number(c.alpha),Number(c.authority_k),Number(c.delay_d),Number(c.recovery_w),Number(c.adjust_m),String(c.estimator)]);
  return {
    schema:'DCV-PROTOCOL-1.0', project_id:projectId, definition_version:def.version,
    research_question:def.content.research_question,
    design_space:design,
    actual_candidate_plan:{count:actualPlan.length,tuples:actualPlan},
    constraints,
    estimators:design.estimators||[],
    statistical_plan:{
      exploration:'adaptive boundary search; not confirmatory',
      confirmation:'independent deterministic seed family',
      multiplicity_method:validation.multiplicity_method||'bonferroni',
      familywise_confidence:Number(validation.familywise_confidence||constraints.confidence||.95),
      family_size:Number(design.max_candidates||128),
      constraint_family:['loss_exceed_rate','fp_rate','fn_rate','review_burden','recovery_time'],
      unresolved_rule:'UNRESOLVED is not INFEASIBLE',
      selection_rule:'robust feasibility first; minimax regret second'
    },
    empirical_anchor:{
      readiness:empirical.status,panel_n:empirical.complete_rows,target_n:empirical.target_rows,verified_n:empirical.verified_rows,
      profile:cal.profile?.version,coefficients:cal.coeff,
      loss_proxy:cal.loss?{c_fp:cal.loss.c_fp,c_fn:cal.loss.c_fn,c_fp_low:cal.loss.c_fp_low,c_fp_high:cal.loss.c_fp_high,c_fn_low:cal.loss.c_fn_low,c_fn_high:cal.loss.c_fn_high,normalization:cal.loss.normalization,identification_status:cal.loss.identification_status}:null,
      loss_identification:cal.loss?.identification_status||'UNKNOWN'
    },
    claim_scope:{
      supports:['conditional delegation-region identification under explicit constraints','comparative robustness across declared scenarios','ordinal candidate selection within the model'],
      does_not_support:['causal effect of delegation','externally calibrated absolute crisis probability','universally optimal public-payment threshold','directly identified social welfare cost of FP/FN']
    }
  };
}

export async function ensureFrozenProtocol(env,projectId){
  const protocol=await buildProtocol(env,projectId), hash=await sha256Hex(stableStringify(protocol));
  const latest=await one(env.DB,`SELECT * FROM research_protocols WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
  const sims=await one(env.DB,`SELECT COUNT(*) n FROM simulation_runs WHERE project_id=?`,[projectId]);
  if(latest){
    if(latest.protocol_hash===hash) return {...latest,protocol:safeJson(latest.protocol_json,{})};
    if(Number(sims?.n||0)>0) throw new Error('protocol_drift_after_simulation_start');
  }
  const version=Number(latest?.version||0)+1,id=uid('protocol'),ts=nowIso();
  await run(env.DB,`INSERT INTO research_protocols(id,project_id,version,definition_version,status,protocol_json,protocol_hash,frozen_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,[id,projectId,version,protocol.definition_version,'FROZEN',JSON.stringify(protocol),hash,ts,ts]);
  await audit(env,projectId,'agent','protocol.frozen','research_protocol',id,{version,hash,definition_version:protocol.definition_version});
  return {id,project_id:projectId,version,definition_version:protocol.definition_version,status:'FROZEN',protocol_json:JSON.stringify(protocol),protocol_hash:hash,frozen_at:ts,protocol};
}

export async function assertProtocolIntegrity(env,projectId){
  const latest=await one(env.DB,`SELECT * FROM research_protocols WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
  if(!latest) return ensureFrozenProtocol(env,projectId);
  const current=await buildProtocol(env,projectId), hash=await sha256Hex(stableStringify(current));
  if(hash!==latest.protocol_hash) throw new Error('protocol_integrity_failure');
  return {...latest,protocol:safeJson(latest.protocol_json,{})};
}

export async function latestProtocol(env,projectId){
  const r=await one(env.DB,`SELECT * FROM research_protocols WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
  return r?{...r,protocol:safeJson(r.protocol_json,{})}:null;
}

export async function recordRigorCheck(env,projectId,checkType,status,result){
  const id=uid('rigor'); await run(env.DB,`INSERT INTO rigor_checks(id,project_id,check_type,status,result_json,created_at) VALUES(?,?,?,?,?,?)`,[id,projectId,checkType,status,JSON.stringify(result),nowIso()]);
  await audit(env,projectId,'agent',`rigor.${checkType}`,'rigor_check',id,{status,...result}); return {id,status,...result};
}
