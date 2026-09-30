import { all, one, run, audit } from './db.js';
import { nowIso, uid, clamp, safeJson, mulberry32, quantile as qUtil } from './util.js';
import { CRISIS_EPISODES } from '../data/crisisEpisodes.js';

// Anchors transcribed from the user-supplied current CBDC paper (n=81 version).
// This registry deliberately separates directly estimated quantities from literature-bounded,
// author-calibrated and design/tuning quantities. It does NOT fabricate the 81 episode rows.
export const CBDC_PAPER_PROFILE = {
  version: 'CBDC_PAPER_n81_2026',
  name: 'CBDC Paper — historically calibrated n=81 anchor',
  panel: { n:81, verified:15, reconstructed:66, failures:60, year_start:1984, year_end:2023 },
  reduced_form: {
    specification:'peak_outflow = kappa + theta1*S + theta2*(C*S) + error',
    kappa:-0.0683,
    theta1:0.0597,
    theta2:0.2466,
    theta2_se:0.0655,
    theta2_ci_low:0.1162,
    theta2_ci_high:0.3770,
    r2:0.553,
    rmse:0.030,
    aic:-325.77,
    bic:-318.66
  },
  extended: { theta2:0.209, theta3_digital:0.0394, r2:0.574, aic:-327.46 },
  simulation_architecture: {
    horizon_days:90,
    stability_k:13,
    stability_theta_korea:0.62,
    stability_theta_range_low:0.62,
    stability_theta_range_high:0.74,
    lolr_trigger:0.45,
    lolr_excess_slope:0.55,
    lolr_max_relief:0.22,
    lolr_effectiveness:0.35,
    dynamic_cap_floor:0.30,
    dynamic_cap_slope:0.30,
    baseline_shock:0.75,
    korea_digital_adoption:0.92,
    korea_concentration_anchor:0.75,
    baseline_mc_n:300,
    seed:20260618
  },
  literature_bounded: {
    outflow_digital_sensitivity:{value:0.35,low:0.28,high:0.42},
    outflow_risk_sensitivity:{value:0.16,low:0.12,high:0.20},
    outflow_cap_base:{value:0.05,low:0.04,high:0.06},
    outflow_cap_slope:{value:0.06,low:0.05,high:0.08},
    outflow_cash_buffer:{value:0.35,low:0.30,high:0.40},
    disinter_outflow_coeff:{value:0.95,low:0.90,high:1.00}
  },
  welfare_weights: {pay_eff:0.25,inclusion:0.10,innovation:0.15,risk:-0.30,disinter:-0.15,oper:-0.05},
  measurement_error: {peak_outflow_half_width:0.05,severity_half_width:0.10},
  robustness: {bootstrap_refits:60,perturbation_envelope:0.40,sobol_cap_total_order:0.44},
  notes: {
    episode_rows:'The supplied paper reports panel aggregates and empirical coefficients, but the authoritative machine-readable 81-row crisis_episodes archive is not embedded in the PDF. Episode-level historical validation remains PARTIAL until those rows are imported.',
    digital:'theta3 is positive but not conventionally significant; it is not used to recalibrate the literature-bounded per-agent digital sensitivity.',
    cap:'Dynamic-cap floor and slope are author-calibrated; formal empirical cap-adjustment calibration remains future work.'
  }
};

const PARAMS = [
  ['kappa',-0.0683,null,null,'outflow share','structural_channel','estimated','Table 2, Specification I'],
  ['theta1_severity',0.0597,null,null,'coefficient','structural_channel','estimated','Table 2, Specification I'],
  ['theta2_concentration_x_shock',0.2466,0.1162,0.3770,'coefficient','structural_channel','estimated','Table 2, Specification I; 95% CI'],
  ['theta2_se',0.0655,null,null,'coefficient','uncertainty','estimated','Table 2'],
  ['theta3_digital',0.0394,null,null,'coefficient','secondary_channel','estimated_inconclusive','Table 2b; positive but not conventionally significant'],
  ['regression_rmse',0.030,null,null,'outflow share','uncertainty','estimated','Table 2'],
  ['regression_r2',0.553,null,null,'share','fit','estimated','Table 2'],
  ['measurement_error_peak_outflow',0.05,null,null,'absolute share','measurement','documented_reconstruction_precision','Appendix E / reconstruction rule'],
  ['measurement_error_severity',0.10,null,null,'index points','measurement','documented_reconstruction_precision','Appendix E'],
  ['horizon_days',90,null,null,'days','simulation_architecture','model_architecture','Section 3.1'],
  ['stability_k',13,null,null,'logistic slope','simulation_architecture','model_architecture','Section 3.1'],
  ['stability_theta_korea',0.62,null,null,'index','simulation_architecture','author_calibrated','Five-country profile'],
  ['lolr_trigger',0.45,0.50,0.60,'stress index','simulation_architecture','author_recalibrated','Section 3.1; cited range refers to prior/BIS-motivated range'],
  ['lolr_excess_slope',0.55,null,null,'multiplier','simulation_architecture','author_calibrated','Section 3.1'],
  ['lolr_max_relief',0.22,null,null,'stress index','simulation_architecture','author_calibrated','Section 3.1'],
  ['lolr_effectiveness',0.35,null,null,'multiplier','simulation_architecture','author_calibrated','Section 3.1'],
  ['dynamic_cap_floor',0.30,null,null,'share','recovery_rule','author_calibrated','Section 3.1'],
  ['dynamic_cap_slope',0.30,null,null,'multiplier','recovery_rule','author_calibrated','Section 3.1'],
  ['baseline_shock',0.75,0.60,0.90,'severity index','scenario','design_stress_level','Tables 4/F3'],
  ['korea_digital_adoption',0.92,null,null,'share','country_profile','observed_or_sourced','Five-country table'],
  ['korea_concentration_anchor',0.75,null,null,'index','country_profile','published_mechanism_anchor','Section 6.4 mechanism calculation'],
  ['outflow_digital_sensitivity',0.35,0.28,0.42,'coefficient','simulation_channel','literature_bounded','Table 3'],
  ['outflow_risk_sensitivity',0.16,0.12,0.20,'coefficient','simulation_channel','literature_bounded','Table 3'],
  ['outflow_cap_base',0.05,0.04,0.06,'coefficient','simulation_channel','literature_bounded','Table 3'],
  ['outflow_cap_slope',0.06,0.05,0.08,'coefficient','simulation_channel','literature_bounded','Table 3'],
  ['outflow_cash_buffer',0.35,0.30,0.40,'coefficient','simulation_channel','literature_bounded','Table 3'],
  ['disinter_outflow_coeff',0.95,0.90,1.00,'coefficient','simulation_channel','literature_bounded','Table 3'],
  ['w_pay_eff',0.25,null,null,'weight','welfare','author_specified','Section 3.9'],
  ['w_inclusion',0.10,null,null,'weight','welfare','author_specified','Section 3.9'],
  ['w_innovation',0.15,null,null,'weight','welfare','author_specified','Section 3.9'],
  ['w_risk',-0.30,null,null,'weight','welfare','author_specified','Section 3.9'],
  ['w_disinter',-0.15,null,null,'weight','welfare','author_specified','Section 3.9'],
  ['w_oper',-0.05,null,null,'weight','welfare','author_specified','Section 3.9']
];

function quantile(values,q){
  const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!a.length) return null;
  const pos=(a.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos),w=pos-lo;
  return a[lo]*(1-w)+a[hi]*w;
}
export function deriveLossCalibration(rows,horizon=90){
  const clean=(rows||[]).filter(r=>Number.isFinite(Number(r.peak_outflow)) && (Number(r.failed)===0 || Number(r.failed)===1));
  if(!clean.length) return {status:'HOLD',n:0,reason:'no_episode_outcomes'};
  const all=clean.map(r=>Number(r.peak_outflow)),fail=clean.filter(r=>Number(r.failed)===1).map(r=>Number(r.peak_outflow)),ok=clean.filter(r=>Number(r.failed)===0).map(r=>Number(r.peak_outflow));
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const mu=avg(all),muFail=avg(fail),muOk=avg(ok),q75=quantile(all,.75),q95=quantile(all,.95),T=Math.max(1,Number(horizon)||90);
  if(!Number.isFinite(muFail)||!Number.isFinite(muOk)||!Number.isFinite(q95)) return {status:'HOLD',n:clean.length,reason:'outcome_strata_incomplete'};
  const fpLow=quantile(ok,.50),fpHigh=quantile(ok,.75),fnLow=quantile(fail,.50),fnHigh=quantile(fail,.75);
  return {
    status: clean.length>=81?'CONFIRM':'PARTIAL', n:clean.length, failures:fail.length, nonfailures:ok.length, horizon:T,
    mean_outflow:mu, mean_failed_outflow:muFail, mean_nonfailed_outflow:muOk, q75_outflow:q75, q95_outflow:q95,
    c_fp:muOk, c_fp_low:fpLow, c_fp_high:fpHigh,
    c_fn:muFail, c_fn_low:fnLow, c_fn_high:fnHigh,
    review_cost:muOk/T, adjustment_cost:muFail/T, delay_cost_scale:mu, normalization:q95,
    provenance: clean.length>=81?'empirical_n81_proxy':'empirical_partial_proxy',
    identification_status:'PROXY_ONLY',
    claim_scope:'The crisis panel does not observe the social or fiscal cost of a payment stop decision. c_fp/c_fn are empirically anchored peak-outflow proxies, not directly identified welfare costs.',
    method:'Outcome-stratified peak-outflow proxy calibration on imported crisis episodes; no fabricated FP/FN labels. Point values use stratum means; median-to-75th-percentile bands are retained for sensitivity analysis.'
  };
}


export async function ensureEmpiricalProfile(env,projectId){
  let p=await one(env.DB,`SELECT * FROM empirical_profiles WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]);
  if(p) return p;
  const id=uid('emp'),now=nowIso();
  await run(env.DB,`INSERT INTO empirical_profiles(id,project_id,name,version,status,panel_n,verified_n,reconstructed_n,failure_n,year_start,year_end,source_label,source_note,parameters_json,provenance_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    id,projectId,CBDC_PAPER_PROFILE.name,CBDC_PAPER_PROFILE.version,'published_anchor',81,15,66,60,1984,2023,'User-supplied CBDC_PAPER.pdf',CBDC_PAPER_PROFILE.notes.episode_rows,JSON.stringify(CBDC_PAPER_PROFILE),JSON.stringify({estimated:'panel regression',literature_bounded:'Table 3 ranges',author_calibrated:'simulation architecture',design:'DCV experimental variables'}),now,now
  ]);
  const stmts=PARAMS.map(([key,val,lo,hi,unit,role,prov,note])=>env.DB.prepare(`INSERT INTO empirical_parameters(id,project_id,profile_id,parameter_key,value_num,low_num,high_num,unit,parameter_role,provenance_type,source_note,locked,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(uid('param'),projectId,id,key,val,lo,hi,unit,role,prov,note,1,now));
  if(stmts.length) await env.DB.batch(stmts);
  await audit(env,projectId,'agent','empirical.profile.seeded','empirical_profile',id,{version:CBDC_PAPER_PROFILE.version,panel:CBDC_PAPER_PROFILE.panel});
  return one(env.DB,`SELECT * FROM empirical_profiles WHERE id=?`,[id]);
}

export async function seedBundledEmpiricalPanel(env,projectId){
  await ensureEmpiricalProfile(env,projectId);
  const result=await importEmpiricalEpisodes(env,projectId,CRISIS_EPISODES);
  const refit=await refitEmpiricalCalibration(env,projectId,{promote:true});
  await audit(env,projectId,'agent','empirical.bundled_panel.seeded','project',projectId,{rows:CRISIS_EPISODES.length,refit});
  return {rows:CRISIS_EPISODES.length,refit,readiness:await empiricalReadiness(env,projectId)};
}

export async function empiricalReadiness(env,projectId){
  const profile=await ensureEmpiricalProfile(env,projectId);
  const c=await one(env.DB,`SELECT COUNT(*) n,SUM(CASE WHEN peak_outflow IS NOT NULL AND concentration IS NOT NULL AND severity IS NOT NULL THEN 1 ELSE 0 END) complete,SUM(CASE WHEN provenance_type='verified' THEN 1 ELSE 0 END) verified FROM empirical_episodes WHERE project_id=?`,[projectId]);
  const n=Number(c?.n||0),complete=Number(c?.complete||0),verified=Number(c?.verified||0);
  const local=await one(env.DB,`SELECT * FROM calibration_runs WHERE project_id=? AND promoted=1 ORDER BY created_at DESC LIMIT 1`,[projectId]);
  const status=complete>=Number(profile.panel_n||81)?'FULL_EPISODE_PANEL':complete>=30?'PARTIAL_EPISODE_PANEL':'PUBLISHED_SUMMARY_ANCHOR';
  return {status,episode_rows:n,complete_rows:complete,verified_rows:verified,target_rows:Number(profile.panel_n||81),local_refit:local?safeJson(local.result_json,{}):null,profile};
}

export async function loadEmpiricalCalibration(env,projectId){
  const profile=await ensureEmpiricalProfile(env,projectId);
  const rows=await all(env.DB,`SELECT parameter_key,value_num,low_num,high_num,parameter_role,provenance_type,source_note FROM empirical_parameters WHERE project_id=? AND profile_id=?`,[projectId,profile.id]);
  const params={}; for(const r of rows) params[r.parameter_key]={value:Number(r.value_num),low:r.low_num==null?null:Number(r.low_num),high:r.high_num==null?null:Number(r.high_num),role:r.parameter_role,provenance:r.provenance_type,source_note:r.source_note};
  const promoted=await one(env.DB,`SELECT result_json FROM calibration_runs WHERE project_id=? AND promoted=1 ORDER BY created_at DESC LIMIT 1`,[projectId]);
  const local=promoted?safeJson(promoted.result_json,{}):null;
  // Published profile remains controlling unless an explicit local refit is promoted.
  const coeff={
    kappa:Number(local?.coefficients?.kappa ?? params.kappa?.value ?? -0.0683),
    theta1:Number(local?.coefficients?.theta1 ?? params.theta1_severity?.value ?? 0.0597),
    theta2:Number(local?.coefficients?.theta2 ?? params.theta2_concentration_x_shock?.value ?? 0.2466),
    theta3:Number(params.theta3_digital?.value ?? 0.0394),
    rmse:Number(local?.rmse ?? params.regression_rmse?.value ?? 0.03),
    r2:Number(local?.r2 ?? params.regression_r2?.value ?? 0.553),
    theta2_se:Number(local?.theta2_se ?? params.theta2_se?.value ?? 0.0655),
    theta2_ci:Array.isArray(local?.theta2_ci)?local.theta2_ci:[params.theta2_concentration_x_shock?.low,params.theta2_concentration_x_shock?.high]
  };
  const episodes=await all(env.DB,`SELECT peak_outflow,failed FROM empirical_episodes WHERE project_id=?`,[projectId]);
  const loss=deriveLossCalibration(episodes,Number(params.horizon_days?.value??90));
  return {profile,params,coeff,loss,local_refit:local};
}

export async function importEmpiricalEpisodes(env,projectId,rows=[]){
  await ensureEmpiricalProfile(env,projectId);
  const now=nowIso(), stmts=[];
  for(const r of rows.slice(0,1000)){
    if(!r?.episode_name && !r?.name) continue;
    const name=String(r.episode_name||r.name).trim(),year=r.year==null?null:Number(r.year);
    stmts.push(env.DB.prepare(`INSERT INTO empirical_episodes(id,project_id,episode_name,year,country,peak_outflow,concentration,digital_adoption,severity,failed,provenance_type,reliability_grade,source_note,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,episode_name,year) DO UPDATE SET country=excluded.country,peak_outflow=excluded.peak_outflow,concentration=excluded.concentration,digital_adoption=excluded.digital_adoption,severity=excluded.severity,failed=excluded.failed,provenance_type=excluded.provenance_type,reliability_grade=excluded.reliability_grade,source_note=excluded.source_note,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`).bind(
      uid('episode'),projectId,name,year,r.country||null,numOrNull(r.peak_outflow),numOrNull(r.concentration),numOrNull(r.digital_adoption),numOrNull(r.severity),r.failed==null?null:(Number(r.failed)?1:0),r.provenance_type||'unverified_import',r.reliability_grade||null,r.source_note||null,JSON.stringify(r.metadata||{}),now,now
    ));
  }
  if(stmts.length) await env.DB.batch(stmts);
  const readiness=await empiricalReadiness(env,projectId);
  await audit(env,projectId,'user','empirical.episodes.imported','project',projectId,{inserted:stmts.length,readiness});
  return {inserted:stmts.length,readiness};
}
function numOrNull(v){ return v==null||v===''||!Number.isFinite(Number(v))?null:Number(v); }

function inverse3(a){
  const [a00,a01,a02,a10,a11,a12,a20,a21,a22]=a.flat();
  const c00=a11*a22-a12*a21,c01=-(a10*a22-a12*a20),c02=a10*a21-a11*a20;
  const c10=-(a01*a22-a02*a21),c11=a00*a22-a02*a20,c12=-(a00*a21-a01*a20);
  const c20=a01*a12-a02*a11,c21=-(a00*a12-a02*a10),c22=a00*a11-a01*a10;
  const det=a00*c00+a01*c01+a02*c02;
  if(Math.abs(det)<1e-12) return null;
  return [[c00,c10,c20],[c01,c11,c21],[c02,c12,c22]].map(row=>row.map(x=>x/det));
}
function matVec(m,v){ return m.map(row=>row.reduce((s,x,i)=>s+x*v[i],0)); }
export function fitReducedForm(rows){
  const xs=[],ys=[];
  for(const r of rows){const y=Number(r.peak_outflow),s=Number(r.severity),c=Number(r.concentration);if([y,s,c].every(Number.isFinite)){xs.push([1,s,c*s]);ys.push(y);}}
  const n=ys.length;if(n<6)return{status:'HOLD',reason:'insufficient_complete_rows',n};
  const xtx=Array.from({length:3},()=>Array(3).fill(0)),xty=Array(3).fill(0);
  for(let i=0;i<n;i++)for(let a=0;a<3;a++){xty[a]+=xs[i][a]*ys[i];for(let b=0;b<3;b++)xtx[a][b]+=xs[i][a]*xs[i][b];}
  const inv=inverse3(xtx);if(!inv)return{status:'HOLD',reason:'singular_design',n};
  const beta=matVec(inv,xty),pred=xs.map(x=>x.reduce((s,v,j)=>s+v*beta[j],0)),mean=ys.reduce((a,b)=>a+b,0)/n;
  const sse=ys.reduce((a,y,i)=>a+(y-pred[i])**2,0),sst=ys.reduce((a,y)=>a+(y-mean)**2,0),df=Math.max(1,n-3),sigma2=sse/df,se=Math.sqrt(Math.max(0,sigma2*inv[2][2]));
  const rmse=Math.sqrt(sse/n),r2=1-sse/Math.max(1e-12,sst),theta2=beta[2],z=theta2/Math.max(1e-12,se);
  return {status:'CONFIRM',n,coefficients:{kappa:beta[0],theta1:beta[1],theta2},theta2_se:se,theta2_z:z,theta2_ci:[theta2-1.96*se,theta2+1.96*se],rmse,r2};
}


function sampleWithReplacement(rng,rows,n){const out=[];for(let i=0;i<n;i++)out.push(rows[Math.floor(rng()*rows.length)]);return out;}
export function bootstrapCalibration(rows,{B=60,seed=20260618}={}){
  const clean=(rows||[]).filter(r=>[r.peak_outflow,r.severity,r.concentration].every(v=>Number.isFinite(Number(v))));
  if(clean.length<20)return{status:'HOLD',reason:'insufficient_rows',B:0,draws:[]};
  const verified=clean.filter(r=>r.provenance_type==='verified'),estimated=clean.filter(r=>r.provenance_type!=='verified'),rng=mulberry32(seed),draws=[];
  for(let b=0;b<B;b++){
    let boot=[];
    if(verified.length)boot.push(...sampleWithReplacement(rng,verified,verified.length));
    if(estimated.length)boot.push(...sampleWithReplacement(rng,estimated,estimated.length));
    if(!verified.length||!estimated.length)boot=sampleWithReplacement(rng,clean,clean.length);
    const perturbed=boot.map(r=>{
      const est=r.provenance_type!=='verified';
      return {...r,peak_outflow:clamp(Number(r.peak_outflow)+(est?(rng()*2-1)*0.05:0),0,.50),severity:clamp(Number(r.severity)+(est?(rng()*2-1)*0.10:0),0,1)};
    });
    const fit=fitReducedForm(perturbed);if(fit.status==='CONFIRM')draws.push({kappa:fit.coefficients.kappa,theta1:fit.coefficients.theta1,theta2:fit.coefficients.theta2,rmse:fit.rmse,r2:fit.r2});
  }
  if(!draws.length)return{status:'HOLD',reason:'bootstrap_failed',B:0,draws:[]};
  const vals=draws.map(x=>x.theta2).sort((a,b)=>a-b),pick=q=>vals[Math.round((vals.length-1)*q)];
  const reps=[.05,.25,.50,.75,.95].map(q=>{const target=pick(q);return draws.reduce((best,x)=>Math.abs(x.theta2-target)<Math.abs(best.theta2-target)?x:best,draws[0]);});
  return {status:'CONFIRM',B:draws.length,seed,theta2:{p05:qUtil(vals,.05),p50:qUtil(vals,.50),p95:qUtil(vals,.95),positive_share:vals.filter(x=>x>0).length/vals.length},representative_draws:reps};
}

export async function refitEmpiricalCalibration(env,projectId,{promote=false}={}){
  const profile=await ensureEmpiricalProfile(env,projectId),rows=await all(env.DB,`SELECT peak_outflow,concentration,severity,digital_adoption,provenance_type FROM empirical_episodes WHERE project_id=?`,[projectId]);
  const base=fitReducedForm(rows),uncertainty=bootstrapCalibration(rows,{B:Number(env.CALIBRATION_BOOTSTRAP_N||60),seed:Number(CBDC_PAPER_PROFILE.simulation_architecture.seed||20260618)}),result={...base,uncertainty},id=uid('cal');
  // Promotion requires the full published panel size; this prevents a partial import from silently replacing the paper anchor.
  const canPromote=promote && result.status==='CONFIRM' && result.n>=Number(profile.panel_n||81);
  await run(env.DB,`INSERT INTO calibration_runs(id,project_id,profile_id,run_type,status,n,result_json,promoted,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,[id,projectId,profile.id,'ols_main_effects',result.status,result.n||0,JSON.stringify(result),canPromote?1:0,nowIso()]);
  if(canPromote) await run(env.DB,`UPDATE calibration_runs SET promoted=0 WHERE project_id=? AND id<>?`,[projectId,id]);
  await audit(env,projectId,'agent','empirical.refit','calibration_run',id,{...result,promoted:canPromote});
  return {id,...result,promoted:canPromote};
}

export function empiricalScenarioFromEpisode(r,cal){
  const S=clamp(Number(r.severity??cal.params.baseline_shock?.value??0.75),0,1),C=clamp(Number(r.concentration??cal.params.korea_concentration_anchor?.value??0.75),0,1),D=clamp(Number(r.digital_adoption??cal.params.korea_digital_adoption?.value??0.92),0,1);
  const fitted=clamp(cal.coeff.kappa+cal.coeff.theta1*S+cal.coeff.theta2*C*S,0,0.75); // theta3 is intentionally excluded: the paper treats the direct digital effect as statistically inconclusive and not a calibration coefficient.
  return {key:String(r.id||`${r.episode_name}:${r.year}`),name:r.episode_name||'historical episode',severity:S,concentration:C,digital:D,empirical_outflow:fitted,observed_outflow:r.peak_outflow==null?null:Number(r.peak_outflow),failed:r.failed==null?null:Number(r.failed),volatility:1,delay_multiplier:1,loss_multiplier:1,drift:0,rho:.82,shift_time:8,shift_magnitude:fitted,process_noise:Math.max(.015,cal.coeff.rmse),provenance:r.provenance_type||'imported'};
}

export const __test={fitReducedForm,deriveLossCalibration,bootstrapCalibration};
