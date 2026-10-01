import { all, run, audit, enqueue, enqueueMany } from './db.js';
import { nowIso, uid, safeJson } from './util.js';

export async function enqueueRecompute(env,projectId){
  const confirmed=await all(env.DB,`SELECT DISTINCT candidate_id id FROM validations WHERE project_id=? AND validation_type='robust' AND status='CONFIRM' ORDER BY candidate_id LIMIT 60`,[projectId]);
  await enqueueMany(env,projectId,'compute_candidate',confirmed.map(c=>({candidate_id:c.id,phase:'recompute',cycle:0})),70);   // 루프 안 개별 enqueue → 배치
  await audit(env,projectId,'agent','recompute.queued','project',projectId,{queued:confirmed.length,model:'empirical_reviewer'});
  return{queued:confirmed.length};
}
export async function finalizeRecompute(env,projectId){
  const ids=await all(env.DB,`SELECT DISTINCT candidate_id id FROM validations WHERE project_id=? AND validation_type='robust' AND status='CONFIRM'`,[projectId]);
  // 후보마다 recompute 실행 1건을 조회하던 N+1 루프 → 프로젝트 단위 1회 조회 후 후보별 최신값 선택
  const runs=await all(env.DB,`SELECT candidate_id,result_json FROM simulation_runs WHERE project_id=? AND phase='recompute' ORDER BY created_at DESC`,[projectId]);
  const latest=new Map(); for(const r of runs) if(!latest.has(r.candidate_id)) latest.set(r.candidate_id,r);
  let confirmed=0,rejected=0,hold=0; const stmts=[],ts=nowIso();
  for(const x of ids){
    const r=latest.get(x.id)||null;
    const ev=r?safeJson(r.result_json,{}):null;
    const status=!ev?'HOLD':ev.classification==='FEASIBLE'?'CONFIRM':ev.classification==='INFEASIBLE'?'REJECT':'HOLD';
    if(status==='CONFIRM')confirmed++;else if(status==='REJECT')rejected++;else hold++;
    stmts.push(env.DB.prepare(`INSERT INTO validations(id,project_id,candidate_id,validation_type,status,result_json,created_at) VALUES(?,?,?,?,?,?,?)`).bind(uid('val'),projectId,x.id,'human_recompute',status,JSON.stringify({classification:ev?.classification||null,metrics:ev?.metrics||null,ci:ev?.ci||null,boundary_score:ev?.boundary_score||null,reviewer_used:ev?.reviewer_used||false}),ts));
  }
  for(let i=0;i<stmts.length;i+=50)await env.DB.batch(stmts.slice(i,i+50));
  const result={confirmed,rejected,hold,total:ids.length};await audit(env,projectId,'agent','recompute.finalize','project',projectId,result);if(confirmed>0)await enqueue(env,projectId,'approve_project',{},90);return result;
}
