import { all, run, audit } from './db.js';
import { nowIso, uid } from './util.js';
import { summarize } from './stats.js';
import { loadEmpiricalCalibration, empiricalReadiness } from './empirical.js';

export async function measureProject(env, projectId){
  const rows=await all(env.DB,`SELECT key,value_num,observed_at FROM raw_observations WHERE project_id=? AND value_num IS NOT NULL ORDER BY observed_at DESC LIMIT 5000`,[projectId]);
  const groups={}; for(const r of rows) (groups[r.key]??=[]).push(Number(r.value_num));
  const byKey={}; let pooled=[];
  for(const [k,xs] of Object.entries(groups)){ const s=summarize(xs); const variance=xs.length>1?xs.reduce((a,x)=>a+(x-s.mean)**2,0)/(xs.length-1):0; const sd=Math.sqrt(variance); byKey[k]={...s,sd,cv:Math.abs(s.mean)>1e-12?sd/Math.abs(s.mean):sd}; pooled.push(...xs); }
  const ps=summarize(pooled); const variance=pooled.length>1?pooled.reduce((a,x)=>a+(x-ps.mean)**2,0)/(pooled.length-1):0; const sd=Math.sqrt(variance);
  const cal=await loadEmpiricalCalibration(env,projectId),readiness=await empiricalReadiness(env,projectId);
  const observedSigma=rows.length?Math.abs(ps.mean)>1e-12?sd/Math.abs(ps.mean):sd:null;
  const meanKey=(...ks)=>{for(const k of ks){const g=byKey[k];if(g&&Number.isFinite(Number(g.mean)))return Number(g.mean);}return null;};
  const latencyDays=meanKey('data_latency_days','information_delay_days','tau_days') ?? (()=>{const x=meanKey('data_latency_seconds','information_delay_seconds');return x==null?null:x/86400;})();
  const approvalDays=meanKey('approval_delay_days','human_approval_delay_days','d_days') ?? (()=>{const x=meanKey('approval_delay_seconds','human_approval_delay_seconds');return x==null?null:x/86400;})();
  const metrics={numeric_observations:rows.length,series:Object.keys(groups).length,pooled:{...ps,sd,empirical_sigma:observedSigma},by_key:byKey,operational:{data_latency_days:latencyDays,approval_delay_days:approvalDays},empirical_anchor:{profile:cal.profile.version,panel_n:Number(cal.profile.panel_n||81),kappa:cal.coeff.kappa,theta1:cal.coeff.theta1,theta2:cal.coeff.theta2,theta3:cal.coeff.theta3,regression_rmse:cal.coeff.rmse,measurement_error_peak_outflow:cal.params.measurement_error_peak_outflow?.value,measurement_error_severity:cal.params.measurement_error_severity?.value},parameter_provenance:{sigma:rows.length?'estimated_from_external_observations':'paper_measurement_error_anchor',tau:'requires_operational_timestamp_data',alpha:'tuned_by_estimator_performance',K:'design_variable',d:'requires_approval_log_data',W:'design_variable',m:'design_variable'}};
  const quality={enough_data:rows.length>=30,series_count:Object.keys(groups).length,empirical_readiness:readiness.status,episode_rows:readiness.complete_rows,target_episode_rows:readiness.target_rows};
  const id=uid('measure');
  await run(env.DB,`INSERT INTO measurements(id,project_id,measured_at,metrics_json,source_window_json,quality_json) VALUES(?,?,?,?,?,?)`,[id,projectId,nowIso(),JSON.stringify(metrics),JSON.stringify({max_rows:5000}),JSON.stringify(quality)]);
  await audit(env,projectId,'agent','measure.complete','measurement',id,{quality});
  return {id,metrics,quality};
}
