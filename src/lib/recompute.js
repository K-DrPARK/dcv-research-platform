import { all, run, audit, enqueue } from './db.js';
import { nowIso, uid, safeJson } from './util.js';

export async function enqueueRecompute(env,projectId){
  const confirmed=await all(env.DB,`SELECT DISTINCT candidate_id id FROM validations WHERE project_id=? AND validation_type='robust' AND status='CONFIRM' ORDER BY candidate_id LIMIT 60`,[projectId]);
  for(const c of confirmed)await enqueue(env,projectId,'compute_candidate',{candidate_id:c.id,phase:'recompute',cycle:0},70);
  await audit(env,projectId,'agent','recompute.queued','project',projectId,{queued:confirmed.length,model:'empirical_reviewer'});
  return{queued:confirmed.length};
}
export async function finalizeRecompute(env,projectId){
  const ids=await all(env.DB,`SELECT DISTINCT candidate_id id FROM validations WHERE project_id=? AND validation_type='robust' AND status='CONFIRM'`,[projectId]);
  let confirmed=0,rejected=0,hold=0;
  for(const x of ids){
    const r=await env.DB.prepare(`SELECT * FROM simulation_runs WHERE project_id=? AND candidate_id=? AND phase='recompute' ORDER BY created_at DESC LIMIT 1`).bind(projectId,x.id).first();
    const ev=r?safeJson(r.result_json,{}):null;
    const status=!ev?'HOLD':ev.classification==='FEASIBLE'?'CONFIRM':ev.classification==='INFEASIBLE'?'REJECT':'HOLD';
    if(status==='CONFIRM')confirmed++;else if(status==='REJECT')rejected++;else hold++;
    await run(env.DB,`INSERT INTO validations(id,project_id,candidate_id,validation_type,status,result_json,created_at) VALUES(?,?,?,?,?,?,?)`,[uid('val'),projectId,x.id,'human_recompute',status,JSON.stringify({classification:ev?.classification||null,metrics:ev?.metrics||null,ci:ev?.ci||null,boundary_score:ev?.boundary_score||null,reviewer_used:ev?.reviewer_used||false}),nowIso()]);
  }
  const result={confirmed,rejected,hold,total:ids.length};await audit(env,projectId,'agent','recompute.finalize','project',projectId,result);if(confirmed>0)await enqueue(env,projectId,'approve_project',{},90);return result;
}
