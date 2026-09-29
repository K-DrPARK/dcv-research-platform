import { all, one, run, audit, enqueue } from './db.js';
import { latestDefinition } from './define.js';
import { nowIso, uid, safeJson } from './util.js';
import { computeRegretTable } from './compute.js';

function latestPhaseEvidence(rows,phase){
  const x=rows.find(r=>r.phase===phase); return x?safeJson(x.result_json,{}):null;
}
export async function validateProject(env,projectId){
  const def=await latestDefinition(env,projectId); if(!def)throw new Error('definition_missing');
  const cands=await all(env.DB,`SELECT * FROM design_candidates WHERE project_id=?`,[projectId]);
  const regret=await computeRegretTable(env,projectId); const regretMap=Object.fromEntries(regret.map(x=>[x.candidate_id,x]));
  let confirmed=0,boundary=0,rejected=0;
  for(const cand of cands){
    const runs=await all(env.DB,`SELECT phase,result_json FROM simulation_runs WHERE candidate_id=? AND phase IN ('confirmation','historical','stress') ORDER BY created_at DESC`,[cand.id]);
    const conf=latestPhaseEvidence(runs,'confirmation'),hist=latestPhaseEvidence(runs,'historical'),stress=latestPhaseEvidence(runs,'stress');
    let status='HOLD',reason='incomplete';
    if(cand.status==='infeasible'||cand.status==='confirmation_failed'){status='REJECT';reason='pre_robust_failure';}
    else if(cand.status==='boundary_hold'||cand.evidence_status==='UNRESOLVED'){status='HOLD';reason='statistically_unresolved';}
    else if(conf&&hist&&stress){
      const classes=[conf.classification,hist.classification,stress.classification];
      if(classes.every(x=>x==='FEASIBLE')){status='CONFIRM';reason='all_robust_phases_confirmed';}
      else if(classes.some(x=>x==='INFEASIBLE')){status='REJECT';reason='robust_constraint_violation';}
      else {status='HOLD';reason='robust_boundary_unresolved';}
    }
    const rg=regretMap[cand.id]||null;
    await run(env.DB,`INSERT INTO validations(id,project_id,candidate_id,validation_type,status,result_json,created_at) VALUES(?,?,?,?,?,?,?)`,[
      uid('val'),projectId,cand.id,'robust',status,JSON.stringify({reason,max_regret:rg?.max_regret??null,mean_regret:rg?.mean_regret??null,confirmation:conf?{classification:conf.classification,metrics:conf.metrics,ci:conf.ci}:null,historical:hist?{classification:hist.classification,metrics:hist.metrics,ci:hist.ci,scenario_scores:hist.scenario_scores}:null,stress:stress?{classification:stress.classification,metrics:stress.metrics,ci:stress.ci,scenario_scores:stress.scenario_scores}:null}),nowIso()
    ]);
    if(status==='CONFIRM')confirmed++; else if(status==='HOLD')boundary++; else rejected++;
  }
  const result={confirmed,boundary,rejected,total:cands.length,minimax_candidate:regret[0]||null};
  await audit(env,projectId,'agent','validate.robust.complete','project',projectId,result);
  const rm=await one(env.DB,`SELECT id FROM reviewer_models WHERE project_id=? LIMIT 1`,[projectId]);
  if(rm&&confirmed>0)await enqueue(env,projectId,'recompute_project',{},65); else if(confirmed>0)await enqueue(env,projectId,'fit_reviewer',{},60);
  return result;
}
export async function bestConfirmedCandidate(env,projectId,validationType='robust'){
  return one(env.DB,`SELECT c.*,v.result_json FROM design_candidates c JOIN validations v ON v.candidate_id=c.id WHERE c.project_id=? AND v.validation_type=? AND v.status='CONFIRM' ORDER BY COALESCE(c.max_regret,999999) ASC, c.authority_k DESC, c.sigma DESC LIMIT 1`,[projectId,validationType]);
}
