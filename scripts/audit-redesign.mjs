import fs from 'node:fs';
import {parseRedesignCsv} from '../src/lib/redesign.js';
import {__test as engine} from '../src/lib/compute.js';
import {mulberry32,hashString} from '../src/lib/util.js';
const rows=parseRedesignCsv(fs.readFileSync(process.argv[2]||'data/redesign_candidates.csv','utf8'));
const N=60,constraints={loss_max:.18,loss_exceed_max:.1,fp_max:.08,fn_max:.1,review_burden_max:.7,recovery_time_max:4};
const scenarios=[{key:'audit_drift',rho:.82,drift:0,shift_time:20,shift_magnitude:.3,process_noise:.2,volatility:1,delay_multiplier:1,loss_multiplier:1,empirical_outflow:.12,digital:.8},{key:'audit_shift',rho:.8,drift:.005,shift_time:30,shift_magnitude:.5,process_noise:.25,volatility:1.2,delay_multiplier:1.2,loss_multiplier:1.2,empirical_outflow:.14,digital:.8}];
function run(r,method,threshold=.84){
 const c={sigma:r.sigma,tau:r.tau,alpha:r.alpha,authority_k:r.K,delay_d:r.d,recovery_w:r.W,adjust_m:r.m,estimator:r.estimator},agg=engine.emptyAgg();
 for(let i=0;i<N;i++){const seed=hashString(r.base_id+'|'+i),sc=scenarios[i%2],episode=engine.simulateEpisode(c,constraints,mulberry32(seed),sc,null,{horizon:90,risk_threshold:.62,confidence_method:method,audit_perfect_label:method==='perfect_label_diagnostic',k2_confidence:threshold,k3_confidence:.67},mulberry32(seed^0x5a5a));
  // Aggregate once in memory; no per-episode D1 calls.
  const x={episodes:1,lossExceed:episode.lossExceeded?1:0,fp:episode.fp,fn:episode.fn,decisions:episode.decisions,reviewN:episode.reviewN,rtSum:episode.recoveryTime,rtSq:episode.recoveryTime**2,lossSum:episode.episodeLoss,lossSq:episode.episodeLoss**2,objSum:episode.objective,objSq:episode.objective**2,adjustments:episode.adjustmentN,confidenceBins:episode.confidenceBins,scenarios:{},groups:{}};engine.mergeAgg(agg,x);
 }
 const ev=engine.finalizeAgg(agg,constraints);return {cand_no:r.cand_no,base_id:r.base_id,role:r.role,estimator:r.estimator,K:r.K,tau:r.tau,d:r.d,method,threshold,...ev.metrics,classification:ev.classification,ece:ev.confidence_audit.ece,confidence_bins:ev.confidence_audit.bins,active_constraints:ev.constraints.filter(q=>q.lo>q.limit).map(q=>q.metric)};
}
const results=rows.flatMap(r=>['legacy','residual_common_v1','perfect_label_diagnostic'].map(method=>run(r,method)));
const sensitivity=rows.filter(r=>r.role==='paired_core'&&r.tau===0&&r.d===0&&r.K===2).flatMap(r=>[.75,.84,.92].map(t=>run(r,'residual_common_v1',t)));
const paired=results.filter(r=>r.role==='paired_core').map(r=>{const z=results.find(x=>x.base_id===r.base_id&&x.method===r.method&&x.tau===0&&x.d===0);return {base_id:r.base_id,method:r.method,tau:r.tau,d:r.d,delta_loss:r.loss_mean-z.loss_mean,delta_review:r.review_burden-z.review_burden,delta_delay:r.recovery_time-z.recovery_time};});
const report={scope:'LOCAL ENGINE AUDIT ONLY — synthetic smoke environments, not production research findings or calibrated journal evidence',episodes_per_cell:N,reviewer:'Unvalidated design priors; no supplied human data was promoted',design_rows:rows.length,results,sensitivity,paired,oracle:'Perfect-label foresight is a separate, unattainable diagnostic reference. It uses hidden labels only in this offline audit; it is not an externally calibrated posterior correctness oracle or a deployable algorithm.'};
fs.mkdirSync('docs/redesign-verification',{recursive:true});fs.writeFileSync('docs/redesign-verification/audit.json',JSON.stringify(report,null,2));
const dEffect=paired.filter(r=>r.method==='residual_common_v1'&&r.tau===0&&r.d===4);
console.log(JSON.stringify({scope:report.scope,rows:rows.length,ablation_cells:results.length,sensitivity_cells:sensitivity.length,delay_pairs:dEffect.length,delay_pairs_with_changed_loss:dEffect.filter(r=>Math.abs(r.delta_loss)>1e-9).length,cells_ece_above_005:results.filter(r=>r.method==='residual_common_v1'&&r.ece>.05).length},null,2));
