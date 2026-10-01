import {fitReviewerModel} from '../src/lib/reviewer.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeDb} from './helpers/d1shim.mjs';
import {seedProject} from './helpers/seed.mjs';
import {parseRedesignCsv,applyRedesign} from '../src/lib/redesign.js';
import {defineProject} from '../src/lib/define.js';
import {seedCandidates,computeCandidate,computeRegretTable,__test as engine} from '../src/lib/compute.js';
import {mulberry32} from '../src/lib/util.js';
import {makeHumanTask,createHumanTrial,recordHumanTrial} from '../src/lib/human_trials.js';
import {buildThesisData} from '../src/lib/thesis.js';
const csv=fs.readFileSync('data/redesign_candidates.csv','utf8');
const constraints={loss_max:.18,loss_exceed_max:.1,fp_max:.08,fn_max:.1,review_burden_max:.7,recovery_time_max:4};
const candidate={sigma:.05,tau:0,alpha:.35,authority_k:2,delay_d:0,recovery_w:.12,adjust_m:.15,estimator:'ema'};
const scenario={key:'smoke',rho:.82,drift:0,shift_time:8,shift_magnitude:.3,process_noise:.2,volatility:1,delay_multiplier:1,loss_multiplier:1,empirical_outflow:.12,digital:.8};
const config={horizon:90,risk_threshold:.62,confidence_method:'residual_common_v1'};
test('supplied 208 rows contain all twelve delay cells per base and sixteen anchors',()=>{
 const rows=parseRedesignCsv(csv);assert.equal(rows.length,208);assert.equal(rows.filter(r=>r.role==='paired_core').length,192);assert.equal(rows.filter(r=>r.role==='anchor').length,16);
 assert.throws(()=>parseRedesignCsv(csv.replace('1,B07,adaptive,2','1,B07,adaptive,1')));
});
test('missing operational values do not erase declared tau and d levels',async()=>{
 const DB=makeDb(),pid=await seedProject(DB,{candidates:0,episodes:12});const env={DB};await defineProject(env,pid);
 DB.raw.prepare("INSERT INTO measurements(id,project_id,measured_at,metrics_json,source_window_json,quality_json) VALUES('m',?,datetime('now'),?, '{}','{}')").run(pid,JSON.stringify({operational:{data_latency_days:null,approval_delay_days:null}}));
 await seedCandidates(env,pid);assert.equal(DB.raw.prepare('SELECT COUNT(DISTINCT tau) n FROM design_candidates').get().n,3);assert.equal(DB.raw.prepare('SELECT COUNT(DISTINCT delay_d) n FROM design_candidates').get().n,4);
});
test('redesign preserves previous candidates, freezes 208 paired rows and stores noninferiority results',async()=>{
 const DB=makeDb(),pid=await seedProject(DB,{candidates:8,episodes:12}),env={DB,SIM_BATCH_SIZE:12};
 const result=await applyRedesign(env,pid,{csv,noninferiority:{loss_relative_margin:.1,fn_absolute_margin:.01,fp_absolute_margin:.01}});assert.equal(result.research_cycle,2);
 await defineProject(env,pid);await seedCandidates(env,pid);
 assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM design_candidates WHERE research_cycle=1').get().n,8);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM design_candidates WHERE research_cycle=2').get().n,208);
 const c=DB.raw.prepare("SELECT id FROM design_candidates WHERE research_cycle=2 AND candidate_role='paired_core' LIMIT 1").get();await computeCandidate(env,pid,c.id);
 const run=JSON.parse(DB.raw.prepare('SELECT result_json FROM simulation_runs WHERE candidate_id=?').get(c.id).result_json);
 assert.equal(run.engine_version,'DCV-CDRS-v3');assert.equal(run.confidence_method,'residual_common_v1');assert.equal(run.noninferiority.comparisons.length,3);assert.ok(run.confidence_audit.bins.length);
});
test('d contributes to review delay and loss; tau changes loss under identical environmental draws',()=>{
 const simulate=c=>engine.simulateEpisode(c,constraints,mulberry32(7),scenario,null,config,mulberry32(9));
 const zero=simulate(candidate),delay=simulate({...candidate,delay_d:4}),stale=simulate({...candidate,tau:2});
 assert.ok(delay.recoveryTime>zero.recoveryTime);assert.ok(delay.episodeLoss>zero.episodeLoss);assert.notEqual(stale.episodeLoss,zero.episodeLoss);
 for(const K of [0,1])assert.equal(simulate({...candidate,authority_k:K}).reviewN,90);
});
test('common confidence is independent of estimator-specific p; legacy path reveals the old artifact',()=>{
 const state={p:1,var:.001,predictionVariance:.001};assert.equal(engine.confidenceFor(state,1,.5,.05),engine.confidenceFor({...state,p:.0001},1,.5,.05));
 assert.notEqual(engine.confidenceFor(state,1,.5,.05,'legacy'),engine.confidenceFor({...state,p:.0001},1,.5,.05,'legacy'));
});
test('controlled task correctness frequencies follow declared confidence without exposing the truth',()=>{
 const rng=mulberry32(123),stats=Array.from({length:3},()=>({n:0,correct:0}));for(let i=0;i<30000;i++){const t=makeHumanTask(i,rng),s=stats[i%3];s.n++;s.correct+=t.ai_correct;}
 for(let i=0;i<3;i++)assert.ok(Math.abs(stats[i].correct/stats[i].n-[.55,.75,.92][i])<.015);
});
test('server trial cannot be forged or reused and participant is capped at thirty',async()=>{
 const DB=makeDb(),pid=await seedProject(DB,{candidates:0}),env={DB},participant='participant-fixture';
 const t=await createHumanTrial(env,pid,participant);assert.equal(t.ai_correct,undefined);
 const r=await recordHumanTrial(env,pid,{trial_id:t.trial_id,participant_hash:participant,human_accept:true,response_ms:500,ai_correct:true,ai_confidence:1});
 const row=DB.raw.prepare('SELECT * FROM reviewer_observations WHERE id=?').get(r.id);assert.equal(row.ai_confidence,t.confidence);
 await assert.rejects(()=>recordHumanTrial(env,pid,{trial_id:t.trial_id,participant_hash:participant,human_accept:true,response_ms:500}));
 for(let i=1;i<30;i++)await createHumanTrial(env,pid,participant);await assert.rejects(()=>createHumanTrial(env,pid,participant),/cap/);
});
test('report scenario totals come from executed keys and estimator CI includes denominators',async()=>{
 const DB=makeDb(),pid=await seedProject(DB,{candidates:4}),env={DB};
 DB.raw.prepare("UPDATE simulation_runs SET phase='historical',result_json=? WHERE id='run_0_exploration'").run(JSON.stringify({scenario_scores:{historical_fixture:{objective:.2}}}));
 const t=await buildThesisData(env,pid);assert.equal(t.simulation.scenarios.historical,1);assert.equal(t.candidates.estimators[0].n,t.candidates.estimators[0].total);
});

test('incomplete scenario evidence cannot produce a zero regret',async()=>{
 const DB=makeDb(),pid=await seedProject(DB,{candidates:8}),env={DB};const result=await computeRegretTable(env,pid);
 assert.ok(result.length);assert.ok(result.every(r=>r.max_regret===null));assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM design_candidates WHERE status='confirmed_feasible' AND max_regret IS NOT NULL").get().n,0);
});
test('a small human sample receives descriptive cluster bootstrap without being promoted',async()=>{
 const DB=makeDb(),pid=await seedProject(DB,{candidates:0,reviewer:35}),result=await fitReviewerModel({DB},pid);
 assert.equal(result.status,'HOLD');assert.equal(result.cluster_bootstrap.B,300);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM reviewer_models').get().n,0);
});
