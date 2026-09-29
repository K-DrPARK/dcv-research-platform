import { all, one, run, audit, enqueue } from './db.js';
import { nowIso, uid } from './util.js';

export async function fitReviewerModel(env, projectId){
  const rows=await all(env.DB,`SELECT * FROM reviewer_observations WHERE project_id=? ORDER BY created_at DESC LIMIT 5000`,[projectId]);
  if(rows.length<20){
    await audit(env,projectId,'agent','reviewer.fit.hold','project',projectId,{n:rows.length,reason:'need_at_least_20'});
    return {status:'HOLD',n:rows.length};
  }
  const correct=rows.filter(r=>Number(r.ai_correct)===1); const wrong=rows.filter(r=>Number(r.ai_correct)===0);
  const correctAccept=correct.filter(r=>Number(r.human_accept)===1).length/Math.max(1,correct.length);
  const correctOverride=wrong.filter(r=>Number(r.human_accept)===0).length/Math.max(1,wrong.length);
  const falseAccept=wrong.filter(r=>Number(r.human_accept)===1).length/Math.max(1,wrong.length);
  const unnecessaryOverride=correct.filter(r=>Number(r.human_accept)===0).length/Math.max(1,correct.length);
  const meanDelay=rows.reduce((a,r)=>a+Number(r.response_ms||0),0)/rows.length/1000;
  const recovered=wrong.filter(r=>Number(r.recovered)===1); const recoveryTime=recovered.length?recovered.reduce((a,r)=>a+Number(r.recovery_ms||0),0)/recovered.length/1000:null;
  const arr=(correct.filter(r=>Number(r.human_accept)===1).length + wrong.filter(r=>Number(r.human_accept)===0).length)/rows.length;
  const model={n:rows.length,appropriate_reliance_rate:arr,correct_accept_rate:correctAccept,correct_override_rate:correctOverride,false_accept_rate:falseAccept,unnecessary_override_rate:unnecessaryOverride,mean_delay:meanDelay,error_recovery_time:recoveryTime};
  const v=await one(env.DB,`SELECT COALESCE(MAX(version),0) v FROM reviewer_models WHERE project_id=?`,[projectId]);
  const id=uid('reviewermodel'); await run(env.DB,`INSERT INTO reviewer_models(id,project_id,version,model_json,created_at) VALUES(?,?,?,?,?)`,[id,projectId,(v?.v||0)+1,JSON.stringify(model),nowIso()]);
  await audit(env,projectId,'agent','reviewer.fit.complete','reviewer_model',id,model);
  await enqueue(env,projectId,'recompute_project',{},65);
  return {status:'CONFIRM',id,model};
}
