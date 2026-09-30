import { all, one, run, audit, enqueue } from './db.js';
import { nowIso, uid, mulberry32, quantile } from './util.js';
import { latestDefinition } from './define.js';

function metrics(rows){
  const correct=rows.filter(r=>Number(r.ai_correct)===1), wrong=rows.filter(r=>Number(r.ai_correct)===0);
  const n=Math.max(1,rows.length), wc=Math.max(1,wrong.length), cc=Math.max(1,correct.length);
  const correctAccept=correct.filter(r=>Number(r.human_accept)===1).length/cc;
  const correctOverride=wrong.filter(r=>Number(r.human_accept)===0).length/wc;
  const falseAccept=wrong.filter(r=>Number(r.human_accept)===1).length/wc;
  const unnecessaryOverride=correct.filter(r=>Number(r.human_accept)===0).length/cc;
  const meanDelay=rows.reduce((a,r)=>a+Number(r.response_ms||0),0)/n/1000;
  const recovered=wrong.filter(r=>Number(r.recovered)===1), recoveryTime=recovered.length?recovered.reduce((a,r)=>a+Number(r.recovery_ms||0),0)/recovered.length/1000:null;
  const arr=(correct.filter(r=>Number(r.human_accept)===1).length+wrong.filter(r=>Number(r.human_accept)===0).length)/n;
  return {n:rows.length,correct_n:correct.length,wrong_n:wrong.length,appropriate_reliance_rate:arr,correct_accept_rate:correctAccept,correct_override_rate:correctOverride,false_accept_rate:falseAccept,unnecessary_override_rate:unnecessaryOverride,mean_delay:meanDelay,error_recovery_time:recoveryTime};
}
function clusterBootstrap(rows,B=300,seed=20260930){
  const groups=new Map(); for(const r of rows){const k=String(r.participant_hash||'anon');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  const ids=[...groups.keys()]; if(ids.length<2)return{status:'HOLD',participants:ids.length,B:0};
  const rng=mulberry32(seed), draws=[];
  for(let b=0;b<B;b++){
    const sample=[];for(let i=0;i<ids.length;i++){const id=ids[Math.floor(rng()*ids.length)];sample.push(...groups.get(id));}
    draws.push(metrics(sample));
  }
  const interval=k=>{const xs=draws.map(x=>Number(x[k])).filter(Number.isFinite);return{lo:quantile(xs,.025),median:quantile(xs,.5),hi:quantile(xs,.975)};};
  return {status:'CONFIRM',participants:ids.length,B,seed,ci95:{appropriate_reliance_rate:interval('appropriate_reliance_rate'),false_accept_rate:interval('false_accept_rate'),correct_override_rate:interval('correct_override_rate'),unnecessary_override_rate:interval('unnecessary_override_rate'),mean_delay:interval('mean_delay')}};
}

export async function fitReviewerModel(env,projectId){
  const rows=await all(env.DB,`SELECT * FROM reviewer_observations WHERE project_id=? ORDER BY created_at DESC LIMIT 10000`,[projectId]);
  const def=await latestDefinition(env,projectId),v=def?.content?.validation||{};
  const minParticipants=Number(v.min_human_participants||30),minCorrect=Number(v.min_human_correct_trials||60),minWrong=Number(v.min_human_wrong_trials||60),B=Number(v.cluster_bootstrap_n||300);
  const participantN=new Set(rows.map(r=>String(r.participant_hash||'anon'))).size,correctN=rows.filter(r=>Number(r.ai_correct)===1).length,wrongN=rows.filter(r=>Number(r.ai_correct)===0).length;
  const gate={participants:{observed:participantN,required:minParticipants,pass:participantN>=minParticipants},correct_trials:{observed:correctN,required:minCorrect,pass:correctN>=minCorrect},wrong_trials:{observed:wrongN,required:minWrong,pass:wrongN>=minWrong}};
  if(!Object.values(gate).every(x=>x.pass)){
    await audit(env,projectId,'agent','reviewer.fit.hold','project',projectId,{n:rows.length,gate,reason:'human_validation_sample_gate'});
    return {status:'HOLD',n:rows.length,participants:participantN,gate};
  }
  const point=metrics(rows),cluster=clusterBootstrap(rows,B,20260930),model={...point,participants:participantN,cluster_bootstrap:cluster,sample_gate:gate,unit_of_inference:'participant-cluster bootstrap; repeated trials are not treated as independent participants'};
  const ver=await one(env.DB,`SELECT COALESCE(MAX(version),0) v FROM reviewer_models WHERE project_id=?`,[projectId]);
  const id=uid('reviewermodel'); await run(env.DB,`INSERT INTO reviewer_models(id,project_id,version,model_json,created_at) VALUES(?,?,?,?,?)`,[id,projectId,(ver?.v||0)+1,JSON.stringify(model),nowIso()]);
  await audit(env,projectId,'agent','reviewer.fit.complete','reviewer_model',id,model);
  await enqueue(env,projectId,'recompute_project',{},65);
  return {status:'CONFIRM',id,model};
}

export const __test={metrics,clusterBootstrap};
