import { all, one, run, audit, enqueue } from './db.js';
import { latestDefinition } from './define.js';
import { nowIso, uid, mulberry32, randn, clamp, safeJson, hashString, mean } from './util.js';
import { wilson } from './stats.js';
import { loadEmpiricalCalibration, empiricalScenarioFromEpisode } from './empirical.js';

const EPS=1e-9;
const ESTIMATORS=['ema','kalman','changepoint','adaptive'];
const PROB_CONSTRAINTS={loss_exceed_rate:'loss_exceed_max',fp_rate:'fp_max',fn_rate:'fn_max'};
const MEAN_CONSTRAINTS={review_burden:'review_burden_max',recovery_time:'recovery_time_max'};

function normalCI(mu,sd,n,z=1.96){
  if(!n) return {mean:0,lo:-Infinity,hi:Infinity};
  const se=(sd||0)/Math.sqrt(Math.max(1,n));
  return {mean:mu,lo:mu-z*se,hi:mu+z*se};
}
function sampleSd(sum,sumSq,n){ if(n<2) return 0; return Math.sqrt(Math.max(0,(sumSq-sum*sum/n)/(n-1))); }
function logistic(x){ return 1/(1+Math.exp(-x)); }
function empiricalChannel(cal,S,C){
  return clamp(cal.coeff.kappa + cal.coeff.theta1*S + cal.coeff.theta2*C*S, 0, 0.75);
}
function scenarioFromRow(r,cal){
  const meta=safeJson(r?.metadata_json,{});
  const S=clamp(Number(meta.severity??r?.severity??cal.params.baseline_shock?.value??0.75),0,1);
  const C=clamp(Number(meta.concentration??cal.params.korea_concentration_anchor?.value??0.75),0,1);
  const D=clamp(Number(meta.digital_adoption??cal.params.korea_digital_adoption?.value??0.92),0,1);
  return {
    key:String(r?.id||r?.name||'scenario'), name:r?.name||'scenario', severity:S, concentration:C,digital:D,
    empirical_outflow:Number(meta.empirical_outflow??empiricalChannel(cal,S,C)),
    volatility:Number(r?.volatility||1), delay_multiplier:Number(r?.delay_multiplier||1), loss_multiplier:Number(r?.loss_multiplier||1),
    drift:Number(meta.drift||0), rho:Number(meta.rho??0.82), shift_time:Number(meta.shift_time??-1),
    shift_magnitude:Number(meta.shift_magnitude||0), fraud_cost:Number(meta.fraud_cost||1.4),
    false_stop_cost:Number(meta.false_stop_cost||0.45), process_noise:Number(meta.process_noise??Math.max(.015,cal.coeff.rmse)),
    provenance:meta.provenance||'scenario_table'
  };
}
function syntheticScenarios(cal){
  const baseS=Number(cal.params.baseline_shock?.value??.75), C=Number(cal.params.korea_concentration_anchor?.value??.75), D=Number(cal.params.korea_digital_adoption?.value??.92), rmse=Math.max(.015,cal.coeff.rmse);
  const base=empiricalChannel(cal,baseS,C);
  return [
    {key:'paper_korea_baseline',name:'Published Korea baseline anchor',severity:baseS,concentration:C,digital:D,empirical_outflow:base,volatility:1,delay_multiplier:1,loss_multiplier:1,drift:0,rho:.82,shift_time:-1,shift_magnitude:0,fraud_cost:1.4,false_stop_cost:.45,process_noise:rmse,provenance:'published_summary_anchor'},
    {key:'paper_low_shock',name:'Published low-shock sensitivity',severity:.60,concentration:C,digital:D,empirical_outflow:empiricalChannel(cal,.60,C),volatility:1.05,delay_multiplier:1,loss_multiplier:1.05,drift:0,rho:.82,shift_time:-1,shift_magnitude:0,fraud_cost:1.4,false_stop_cost:.45,process_noise:rmse,provenance:'published_summary_anchor'},
    {key:'paper_high_shock',name:'Published high-shock sensitivity',severity:.90,concentration:C,digital:D,empirical_outflow:empiricalChannel(cal,.90,C),volatility:1.15,delay_multiplier:1.10,loss_multiplier:1.15,drift:0,rho:.80,shift_time:12,shift_magnitude:.10,fraud_cost:1.55,false_stop_cost:.48,process_noise:rmse*1.25,provenance:'published_summary_anchor'},
    {key:'paper_low_digital',name:'Published low-digital sensitivity',severity:baseS,concentration:C,digital:.30,empirical_outflow:base,volatility:.92,delay_multiplier:1,loss_multiplier:.95,drift:0,rho:.82,shift_time:-1,shift_magnitude:0,fraud_cost:1.35,false_stop_cost:.45,process_noise:rmse,provenance:'published_summary_anchor'}
  ];
}
function paperStressScenarios(cal){
  const out=[];
  for(const cm of [.6,1,1.4]) for(const dm of [.6,1,1.4]) for(const sm of [.6,1,1.4]){
    const C=clamp(Number(cal.params.korea_concentration_anchor?.value??.75)*cm,0,1),D=clamp(Number(cal.params.korea_digital_adoption?.value??.92)*dm,0,1),S=clamp(Number(cal.params.baseline_shock?.value??.75)*sm,0,1);
    out.push({key:`paper_wide_${cm}_${dm}_${sm}`,name:`±40% C/D/S (${cm},${dm},${sm})`,severity:S,concentration:C,digital:D,empirical_outflow:empiricalChannel(cal,S,C),volatility:1+.25*Math.abs(sm-1),delay_multiplier:1+.25*Math.max(0,sm-1),loss_multiplier:1+.35*Math.max(0,sm-1),drift:0,rho:.80,shift_time:S>.85?10:-1,shift_magnitude:S>.85?.12:0,fraud_cost:1.4+.25*S,false_stop_cost:.45,process_noise:Math.max(.015,cal.coeff.rmse)*(1+.4*Math.abs(sm-1)),provenance:'paper_robustness_grid'});
  }
  return out;
}
function estimatorStep(kind,state,y,alpha,sigma){
  const a=clamp(alpha,.03,.97);
  if(kind==='kalman' || kind==='adaptive'){
    const q=.02+.30*a*a, r=Math.max(.0025,sigma*sigma);
    const pred=state.x, pPred=(state.p??1)+q, gain=pPred/(pPred+r);
    let x=pred+gain*(y-pred), p=(1-gain)*pPred;
    if(kind==='adaptive'){
      const z=Math.abs(y-x)/Math.sqrt(Math.max(EPS,p+r));
      if(z>2.4-a*.5){ x=.65*y+.35*x; p=Math.min(2,p+r*.35); state.change=true; }
      else state.change=false;
    }
    return {...state,x,p,gain};
  }
  if(kind==='changepoint'){
    const prev=state.x??y, scale=Math.sqrt((state.var??1)+sigma*sigma+EPS), z=Math.abs(y-prev)/scale;
    const threshold=3.0-1.2*a;
    const change=z>threshold;
    const eff=change?Math.max(.65,a):a;
    const x=eff*y+(1-eff)*prev;
    const resid=y-x, v=.9*(state.var??1)+.1*resid*resid;
    return {...state,x,var:v,change};
  }
  const prev=state.x??y, x=a*y+(1-a)*prev;
  return {...state,x,var:.9*(state.var??1)+.1*(y-x)*(y-x),change:false};
}
function confidenceFor(estState,estimate,threshold,sigma){
  const distance=Math.abs(estimate-threshold);
  const uncertainty=Math.sqrt(Math.max(EPS,estState.p??estState.var??sigma*sigma));
  return clamp(.5+.5*(1-Math.exp(-distance/(uncertainty+.12))),.5,.999);
}
function reviewerDecision(rng,aiStop,shouldStop,confidence,reviewer,delayBase,delayMult){
  const falseAccept=Number(reviewer?.false_accept_rate??.08);
  const correctOverride=Number(reviewer?.correct_override_rate??.78);
  const unnecessaryOverride=Number(reviewer?.unnecessary_override_rate??Math.min(.18,falseAccept*.5));
  let finalStop=aiStop;
  if(aiStop!==shouldStop){ if(rng()<correctOverride) finalStop=shouldStop; }
  else if(rng()<unnecessaryOverride*(1-confidence)) finalStop=!aiStop;
  const base=Number(reviewer?.mean_delay??delayBase);
  return {finalStop,delay:Math.max(.05,base*delayMult*(.85+.3*rng())),falseAccept,correctOverride};
}
function simulateEpisode(c,constraints,rng,scenario,reviewer,config){
  const horizon=Number(config.horizon||24), tau=Math.max(0,Math.round(c.tau||0));
  const threshold=Number(config.risk_threshold||.68), latentThreshold=Math.log(threshold/(1-threshold));
  const history=[], est={x:0,p:1,var:1,change:false};
  let state=randn(rng)*.25, reviewN=0, rtSum=0, fp=0,fn=0, decisions=0, totalLoss=0, adjustmentN=0;
  let rollingErrors=0, safeMode=0;
  for(let t=0;t<horizon;t++){
    const shifted=scenario.shift_time>=0 && t>=scenario.shift_time ? scenario.shift_magnitude : 0;
    const digitalSens=Number(config.empirical?.params?.outflow_digital_sensitivity?.value??0.35),empiricalPulse=Number(scenario.empirical_outflow||0)*(1+digitalSens*Number(scenario.digital||0));
    state=scenario.rho*state + scenario.drift + empiricalPulse + shifted*(t===scenario.shift_time?1:.02) + randn(rng)*scenario.process_noise*scenario.volatility;
    const obs=state+randn(rng)*c.sigma*scenario.volatility;
    history.push(obs);
    const delayed=history[Math.max(0,history.length-1-tau)];
    const es=estimatorStep(c.estimator||'ema',est,delayed,c.alpha,c.sigma);
    Object.assign(est,es);
    const estimate=est.x, confidence=confidenceFor(est,estimate,latentThreshold,c.sigma);
    const shouldStop=logistic(state)>threshold;
    const aiStop=estimate>latentThreshold;
    const K=Number(c.authority_k);
    let needsReview=K===0 || K===1 || safeMode>0;
    if(K===2) needsReview=needsReview || confidence<Number(config.k2_confidence||.84);
    if(K>=3) needsReview=needsReview || confidence<Number(config.k3_confidence||.67);
    let finalStop=aiStop, decisionDelay=Math.max(.02,c.delay_d*.12*scenario.delay_multiplier);
    if(needsReview){
      reviewN++;
      const hr=reviewerDecision(rng,aiStop,shouldStop,confidence,reviewer,c.delay_d,scenario.delay_multiplier);
      finalStop=hr.finalStop; decisionDelay=hr.delay;
    }
    if(finalStop&&!shouldStop) fp++;
    if(!finalStop&&shouldStop) fn++;
    const wrong=finalStop!==shouldStop;
    rollingErrors=.82*rollingErrors+.18*(wrong?1:0);
    const riskExcess=Math.max(0,logistic(state)-threshold);
    const exposure=(!finalStop?riskExcess:0)*(1+decisionDelay*.18);
    const authorityExposure=1+.10*K;
    const decisionLoss=(finalStop&&!shouldStop?scenario.false_stop_cost:0)+(!finalStop&&shouldStop?scenario.fraud_cost:0);
    const delayLoss=(!finalStop?decisionDelay*.045*(.4+riskExcess):decisionDelay*.012);
    let loss=(decisionLoss+exposure+delayLoss)*authorityExposure*scenario.loss_multiplier;
    if(needsReview) loss+=Number(config.review_cost||.015);
    totalLoss+=loss; rtSum+=decisionDelay; decisions++;
    // Recovery: if rolling error or current exposure crosses the configured margin, temporarily reduce delegation.
    if((rollingErrors>Number(c.adjust_m)||exposure>Number(c.recovery_w)) && safeMode===0){
      safeMode=Math.max(1,Math.round(2+3*c.recovery_w)); adjustmentN++; totalLoss+=Number(config.adjustment_cost||.06);
    }
    if(safeMode>0) safeMode--;
  }
  const episodeLoss=totalLoss/Math.max(1,horizon);
  return {episodeLoss,lossExceeded:episodeLoss>constraints.loss_max,fp,fn,decisions,reviewN,recoveryTime:rtSum/Math.max(1,decisions),adjustmentN,objective:episodeLoss+Number(config.review_weight||.12)*(reviewN/Math.max(1,decisions))+Number(config.delay_weight||.03)*(rtSum/Math.max(1,decisions))+Number(config.adjustment_weight||.02)*adjustmentN};
}
function emptyAgg(){ return {episodes:0,lossExceed:0,fp:0,fn:0,decisions:0,reviewN:0,rtSum:0,rtSq:0,lossSum:0,lossSq:0,objSum:0,objSq:0,adjustments:0,scenarios:{}}; }
function addEpisode(a,e,key){
  a.episodes++; a.lossExceed+=e.lossExceeded?1:0; a.fp+=e.fp; a.fn+=e.fn; a.decisions+=e.decisions; a.reviewN+=e.reviewN;
  a.rtSum+=e.recoveryTime; a.rtSq+=e.recoveryTime*e.recoveryTime; a.lossSum+=e.episodeLoss; a.lossSq+=e.episodeLoss*e.episodeLoss; a.objSum+=e.objective; a.objSq+=e.objective*e.objective; a.adjustments+=e.adjustmentN;
  const s=a.scenarios[key]??={n:0,objSum:0,lossSum:0,violations:0}; s.n++; s.objSum+=e.objective; s.lossSum+=e.episodeLoss; s.violations+=e.lossExceeded?1:0;
}
function mergeAgg(target,src){
  for(const k of ['episodes','lossExceed','fp','fn','decisions','reviewN','rtSum','rtSq','lossSum','lossSq','objSum','objSq','adjustments']) target[k]+=Number(src[k]||0);
  for(const [k,v] of Object.entries(src.scenarios||{})){ const s=target.scenarios[k]??={n:0,objSum:0,lossSum:0,violations:0}; for(const f of ['n','objSum','lossSum','violations']) s[f]+=Number(v[f]||0); }
  return target;
}
function finalizeAgg(a,constraints,confidence=.95){
  const z=confidence>=.99?2.576:confidence>=.95?1.96:1.645;
  const nE=Math.max(1,a.episodes), nD=Math.max(1,a.decisions);
  const metrics={
    n:a.episodes,decisions:a.decisions,loss_mean:a.lossSum/nE,loss_exceed_rate:a.lossExceed/nE,
    fp_rate:a.fp/nD,fn_rate:a.fn/nD,review_burden:a.reviewN/nD,recovery_time:a.rtSum/nE,
    objective_score:a.objSum/nE,adjustment_rate:a.adjustments/nE
  };
  const lossSd=sampleSd(a.lossSum,a.lossSq,a.episodes), rtSd=sampleSd(a.rtSum,a.rtSq,a.episodes);
  const burdenCI=wilson(a.reviewN,a.decisions,z), lossCI=wilson(a.lossExceed,a.episodes,z), fpCI=wilson(a.fp,a.decisions,z), fnCI=wilson(a.fn,a.decisions,z);
  const rtCI=normalCI(metrics.recovery_time,rtSd,a.episodes,z);
  const ci={loss_exceed_rate:lossCI,fp_rate:fpCI,fn_rate:fnCI,review_burden:burdenCI,recovery_time:rtCI};
  const evals=[];
  for(const [metric,limitKey] of Object.entries(PROB_CONSTRAINTS)){ const q=ci[metric], lim=Number(constraints[limitKey]); evals.push({metric,limit:lim,lo:q.lo,hi:q.hi,mean:metrics[metric]}); }
  for(const [metric,limitKey] of Object.entries(MEAN_CONSTRAINTS)){ const q=ci[metric], lim=Number(constraints[limitKey]); evals.push({metric,limit:lim,lo:q.lo,hi:q.hi,mean:metrics[metric]}); }
  const anyFail=evals.some(x=>x.lo>x.limit), allPass=evals.every(x=>x.hi<=x.limit);
  const classification=anyFail?'INFEASIBLE':allPass?'FEASIBLE':'UNRESOLVED';
  const normalizedDistances=evals.map(x=>Math.abs(x.mean-x.limit)/Math.max(.01,Math.abs(x.limit)));
  const boundaryScore=1/(.05+Math.min(...normalizedDistances));
  const scenario_scores=Object.fromEntries(Object.entries(a.scenarios).map(([k,v])=>[k,{n:v.n,objective:v.objSum/Math.max(1,v.n),loss_mean:v.lossSum/Math.max(1,v.n),loss_exceed_rate:v.violations/Math.max(1,v.n)}]));
  return {metrics,ci,classification,boundary_score:boundaryScore,constraints:evals,scenario_scores,raw:a};
}
function deterministicSeed(projectId,candidateId,phase,cycle){ return hashString(`${projectId}|${candidateId}|${phase}|${cycle}|DCV-CDRS-v2`)&0x7fffffff; }
function configFrom(def,env,cal){
  const b=def.content.benchmark||{}, v=def.content.validation||{};
  return {horizon:Number(b.horizon||cal.params.horizon_days?.value||90),risk_threshold:Number(b.risk_threshold||cal.params.stability_theta_korea?.value||.62),review_cost:Number(b.review_cost||.015),adjustment_cost:Number(b.adjustment_cost||.06),review_weight:Number(b.review_weight||.12),delay_weight:Number(b.delay_weight||.03),adjustment_weight:Number(b.adjustment_weight||.02),k2_confidence:Number(b.k2_confidence||.84),k3_confidence:Number(b.k3_confidence||.67),max_refinement:Number(v.max_refinement||3),max_confirmation:Number(v.max_confirmation||2),confidence:Number(def.content.constraints?.confidence||.95),exploration_n:Number(v.exploration_n||env.SIM_BATCH_SIZE||180),refinement_n:Number(v.refinement_n||env.SIM_BATCH_SIZE||240),confirmation_n:Number(v.confirmation_n||Math.max(300,Number(env.SIM_BATCH_SIZE||180))),robust_n:Number(v.robust_n||Math.max(300,Number(env.SIM_BATCH_SIZE||180))),empirical:cal};
}
function cartesianDesign(d){
  const dims=['sigma','tau','alpha','K','d','W','m']; let out=[{}];
  for(const k of dims){ const vals=(d[k]||[0]).map(Number); out=out.flatMap(o=>vals.map(v=>({...o,[k]:v}))); }
  const est=(d.estimators||ESTIMATORS).filter(x=>ESTIMATORS.includes(x)); return out.flatMap(o=>est.map(estimator=>({...o,estimator})));
}
function maximinSample(xs,max,seed){
  if(xs.length<=max) return xs;
  const rng=mulberry32(seed), normKeys=['sigma','tau','alpha','K','d','W','m'];
  const range={}; for(const k of normKeys){const a=xs.map(x=>Number(x[k]));range[k]=[Math.min(...a),Math.max(...a)];}
  const dist=(a,b)=>Math.sqrt(normKeys.reduce((s,k)=>{const [lo,hi]=range[k],z=(Number(a[k])-Number(b[k]))/Math.max(EPS,hi-lo);return s+z*z;},0)+(a.estimator===b.estimator?0:1));
  const chosen=[xs[Math.floor(rng()*xs.length)]], used=new Set(chosen.map(x=>JSON.stringify(x)));
  while(chosen.length<max){ let best=null,bestD=-1; const start=Math.floor(rng()*xs.length); for(let j=0;j<Math.min(xs.length,1200);j++){const x=xs[(start+j)%xs.length],key=JSON.stringify(x);if(used.has(key))continue;const dmin=Math.min(...chosen.map(y=>dist(x,y)));if(dmin>bestD){bestD=dmin;best=x;}} if(!best)break;chosen.push(best);used.add(JSON.stringify(best)); }
  return chosen;
}
export async function seedCandidates(env,projectId){
  const existing=await one(env.DB,`SELECT COUNT(*) n FROM design_candidates WHERE project_id=?`,[projectId]); if(Number(existing?.n||0)>0)return{created:0};
  const def=await latestDefinition(env,projectId); if(!def)throw new Error('definition_missing'); const d={...(def.content.design||{})};
  const mr=await one(env.DB,`SELECT metrics_json FROM measurements WHERE project_id=? ORDER BY measured_at DESC LIMIT 1`,[projectId]);
  const mm=safeJson(mr?.metrics_json,{}),op=mm.operational||{},observedSigma=Number(mm?.pooled?.empirical_sigma);
  const robustGrid=(v,min=0,max=999,integer=false)=>{const a=[.6,1,1.4].map(m=>clamp(v*m,min,max)).map(x=>integer?Math.round(x):Number(x.toFixed(4)));return [...new Set(a)];};
  if(Number.isFinite(observedSigma)&&observedSigma>0&&Number(mm.numeric_observations||0)>=30)d.sigma=robustGrid(observedSigma,.005,.50,false);
  if(Number.isFinite(Number(op.data_latency_days)))d.tau=robustGrid(Number(op.data_latency_days),0,30,true);
  if(Number.isFinite(Number(op.approval_delay_days)))d.d=robustGrid(Number(op.approval_delay_days),0,30,false);
  const combos=maximinSample(cartesianDesign(d),Number(d.max_candidates||128),hashString(`${projectId}:design`)); const now=nowIso();
  const stmts=combos.map(x=>env.DB.prepare(`INSERT INTO design_candidates(id,project_id,sigma,tau,alpha,authority_k,delay_d,recovery_w,adjust_m,status,estimator,evidence_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,'pending',?,?)`).bind(uid('cand'),projectId,x.sigma,x.tau,x.alpha,x.K,x.d,x.W,x.m,x.estimator,now,now));
  if(stmts.length)await env.DB.batch(stmts); const cands=await all(env.DB,`SELECT id FROM design_candidates WHERE project_id=?`,[projectId]);
  for(const c of cands)await enqueue(env,projectId,'compute_candidate',{candidate_id:c.id,phase:'exploration',cycle:0},40);
  await audit(env,projectId,'agent','cdrs.seed','project',projectId,{created:stmts.length,method:'maximin',estimators:d.estimators||ESTIMATORS,empirical_grid:{sigma:d.sigma,tau:d.tau,d:d.d},source:{sigma:Number.isFinite(observedSigma)&&Number(mm.numeric_observations||0)>=30?'external_observations':'paper/default',tau:Number.isFinite(Number(op.data_latency_days))?'operational_logs':'design',approval_delay:Number.isFinite(Number(op.approval_delay_days))?'operational_logs':'design'}}); return{created:stmts.length};
}
async function loadScenarios(env,projectId,phase,cal){
  if(phase==='historical'){
    const eps=await all(env.DB,`SELECT * FROM empirical_episodes WHERE project_id=? AND peak_outflow IS NOT NULL AND concentration IS NOT NULL AND severity IS NOT NULL ORDER BY year,episode_name`,[projectId]);
    if(eps.length){const full=eps.length>=Number(cal.profile.panel_n||81);return {scenarios:eps.map(r=>empiricalScenarioFromEpisode(r,cal)),source:full?'empirical_episodes_full':'empirical_episodes_partial',empirical_ready:full,episode_n:eps.length};}
    const rows=await all(env.DB,`SELECT * FROM scenarios WHERE project_id=? AND scenario_type='historical' ORDER BY name`,[projectId]);
    if(rows.length)return {scenarios:rows.map(r=>scenarioFromRow(r,cal)),source:'user_historical_scenarios',empirical_ready:false,episode_n:0};
    return {scenarios:syntheticScenarios(cal),source:'published_summary_anchor',empirical_ready:false,episode_n:0};
  }
  if(phase==='stress'){
    const rows=await all(env.DB,`SELECT * FROM scenarios WHERE project_id=? AND scenario_type='adversarial' ORDER BY name`,[projectId]);
    return rows.length?{scenarios:rows.map(r=>scenarioFromRow(r,cal)),source:'user_adversarial_scenarios',empirical_ready:true,episode_n:rows.length}:{scenarios:paperStressScenarios(cal),source:'paper_wide_40pct_grid',empirical_ready:true,episode_n:27};
  }
  return {scenarios:syntheticScenarios(cal),source:'published_summary_anchor',empirical_ready:false,episode_n:0};
}
async function priorAggregate(env,candidateId,phase){
  let phases=phase==='refinement'?['exploration','refinement']:[phase];
  if(phase==='confirmation')phases=['confirmation'];
  const marks=phases.map(()=>'?').join(','); const rows=await all(env.DB,`SELECT result_json FROM simulation_runs WHERE candidate_id=? AND phase IN (${marks}) ORDER BY created_at`,[candidateId,...phases]);
  const a=emptyAgg(); for(const r of rows){const j=safeJson(r.result_json,{});if(j.raw)mergeAgg(a,j.raw);} return a;
}
function nForPhase(config,phase){ if(phase==='exploration')return config.exploration_n;if(phase==='refinement')return config.refinement_n;if(phase==='confirmation')return config.confirmation_n;return config.robust_n; }
export async function computeCandidate(env,projectId,candidateId,phase='exploration',cycle=0){
  const c=await one(env.DB,`SELECT * FROM design_candidates WHERE id=? AND project_id=?`,[candidateId,projectId]);if(!c)throw new Error('candidate_not_found');
  const def=await latestDefinition(env,projectId);if(!def)throw new Error('definition_missing');const constraints=def.content.constraints,cal=await loadEmpiricalCalibration(env,projectId),config=configFrom(def,env,cal);
  let reviewer=null;if(phase==='recompute'){const rm=await one(env.DB,`SELECT model_json FROM reviewer_models WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);reviewer=rm?safeJson(rm.model_json,{}):null;}
  const scenarioPack=await loadScenarios(env,projectId,phase==='recompute'?'confirmation':phase,cal),scenarios=scenarioPack.scenarios; const seed=deterministicSeed(projectId,candidateId,phase,cycle),rng=mulberry32(seed),n=nForPhase(config,phase);
  const batch=emptyAgg(); for(let i=0;i<n;i++){const sc=scenarios[i%scenarios.length];addEpisode(batch,simulateEpisode(c,constraints,rng,sc,reviewer,config),sc.key);}
  let combined=batch; if(['refinement','confirmation'].includes(phase)){const prior=await priorAggregate(env,candidateId,phase);combined=mergeAgg(prior,batch);}
  const ev=finalizeAgg(combined,constraints,config.confidence); const m=ev.metrics,id=uid('sim');
  await run(env.DB,`INSERT INTO simulation_runs(id,project_id,candidate_id,phase,seed,n,loss_mean,loss_exceed_rate,fp_rate,fn_rate,review_burden,recovery_time,regret,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,projectId,candidateId,phase,seed,n,m.loss_mean,m.loss_exceed_rate,m.fp_rate,m.fn_rate,m.review_burden,m.recovery_time,null,JSON.stringify({...ev,raw:batch,cycle,estimator:c.estimator,reviewer_used:!!reviewer,scenario_source:scenarioPack.source,empirical_ready:scenarioPack.empirical_ready,empirical_episode_n:scenarioPack.episode_n,empirical_profile:cal.profile.version}),nowIso()]);
  await run(env.DB,`INSERT INTO candidate_evidence(id,project_id,candidate_id,phase,cycle,classification,boundary_score,metrics_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,[uid('evidence'),projectId,candidateId,phase,cycle,ev.classification,ev.boundary_score,JSON.stringify(ev),nowIso()]);
  if(['exploration','refinement'].includes(phase)){
    let status=ev.classification==='FEASIBLE'?'provisionally_feasible':ev.classification==='INFEASIBLE'?'infeasible':'unresolved';
    await run(env.DB,`UPDATE design_candidates SET status=?,evidence_status=?,boundary_score=?,objective_score=?,updated_at=? WHERE id=?`,[status,ev.classification,ev.boundary_score,m.objective_score,nowIso(),candidateId]);
    if(ev.classification==='UNRESOLVED'&&cycle<config.max_refinement)await enqueue(env,projectId,'compute_candidate',{candidate_id:candidateId,phase:'refinement',cycle:cycle+1},35-Math.min(10,Math.round(ev.boundary_score)));
    else if(ev.classification==='UNRESOLVED') await run(env.DB,`UPDATE design_candidates SET status='boundary_hold',evidence_status='UNRESOLVED',boundary_score=?,updated_at=? WHERE id=?`,[ev.boundary_score,nowIso(),candidateId]);
    if(ev.classification==='FEASIBLE')await enqueue(env,projectId,'compute_candidate',{candidate_id:candidateId,phase:'confirmation',cycle:0},45);
  } else if(phase==='confirmation'){
    if(ev.classification==='FEASIBLE')await run(env.DB,`UPDATE design_candidates SET status='confirmed_feasible',evidence_status='FEASIBLE',boundary_score=?,objective_score=?,updated_at=? WHERE id=?`,[ev.boundary_score,m.objective_score,nowIso(),candidateId]);
    else if(ev.classification==='INFEASIBLE')await run(env.DB,`UPDATE design_candidates SET status='confirmation_failed',evidence_status='INFEASIBLE',updated_at=? WHERE id=?`,[nowIso(),candidateId]);
    else if(cycle<config.max_confirmation)await enqueue(env,projectId,'compute_candidate',{candidate_id:candidateId,phase:'confirmation',cycle:cycle+1},42);
    else await run(env.DB,`UPDATE design_candidates SET status='boundary_hold',evidence_status='UNRESOLVED',boundary_score=?,updated_at=? WHERE id=?`,[ev.boundary_score,nowIso(),candidateId]);
  }
  await audit(env,projectId,'agent','cdrs.run','candidate',candidateId,{phase,cycle,classification:ev.classification,boundary_score:ev.boundary_score,metrics:m,seed,scenario_source:scenarioPack.source,empirical_ready:scenarioPack.empirical_ready,empirical_profile:cal.profile.version});
  return{id,phase,cycle,seed,classification:ev.classification,boundary_score:ev.boundary_score,...m};
}
export async function enqueueRobustValidation(env,projectId){
  const cands=await all(env.DB,`SELECT id FROM design_candidates WHERE project_id=? AND status='confirmed_feasible' ORDER BY boundary_score DESC LIMIT 60`,[projectId]);
  let queued=0;
  for(const c of cands){
    const done=await all(env.DB,`SELECT DISTINCT phase FROM simulation_runs WHERE candidate_id=? AND phase IN ('historical','stress')`,[c.id]);
    const phases=new Set(done.map(x=>x.phase));
    if(!phases.has('historical')){await enqueue(env,projectId,'compute_candidate',{candidate_id:c.id,phase:'historical',cycle:0},50);queued++;}
    if(!phases.has('stress')){await enqueue(env,projectId,'compute_candidate',{candidate_id:c.id,phase:'stress',cycle:0},50);queued++;}
  }
  return{queued,candidates:cands.length};
}
export async function computeRegretTable(env,projectId){
  const cands=await all(env.DB,`SELECT id FROM design_candidates WHERE project_id=? AND status='confirmed_feasible'`,[projectId]);
  const rows=[]; for(const c of cands){const runs=await all(env.DB,`SELECT phase,result_json FROM simulation_runs WHERE candidate_id=? AND phase IN ('historical','stress') ORDER BY created_at DESC`,[c.id]);const latest={};for(const r of runs)if(!latest[r.phase])latest[r.phase]=safeJson(r.result_json,{});rows.push({id:c.id,latest});}
  const best={}; for(const row of rows)for(const ph of ['historical','stress'])for(const [s,v] of Object.entries(row.latest[ph]?.scenario_scores||{}))best[`${ph}:${s}`]=Math.min(best[`${ph}:${s}`]??Infinity,Number(v.objective));
  const result=[]; for(const row of rows){let maxRegret=0,meanRegs=[];for(const ph of ['historical','stress'])for(const [s,v] of Object.entries(row.latest[ph]?.scenario_scores||{})){const key=`${ph}:${s}`,reg=Math.max(0,Number(v.objective)-Number(best[key]));maxRegret=Math.max(maxRegret,reg);meanRegs.push(reg);}const avgRegret=mean(meanRegs);await run(env.DB,`UPDATE design_candidates SET max_regret=?,updated_at=? WHERE id=?`,[maxRegret,nowIso(),row.id]);await run(env.DB,`UPDATE simulation_runs SET regret=? WHERE candidate_id=? AND phase IN ('historical','stress')`,[maxRegret,row.id]);result.push({candidate_id:row.id,max_regret:maxRegret,mean_regret:avgRegret});}
  return result.sort((a,b)=>a.max_regret-b.max_regret);
}

// Pure helpers exposed only for deterministic unit tests; production orchestration uses the exported CDRS functions above.
export const __test = { finalizeAgg, emptyAgg, mergeAgg, estimatorStep, empiricalChannel };
