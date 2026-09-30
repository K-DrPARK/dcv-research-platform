import test from 'node:test';
import assert from 'node:assert/strict';
import { __test as ctest } from '../src/lib/compute.js';
import { __test as etest, empiricalScenarioFromEpisode } from '../src/lib/empirical.js';
import { __test as rtest } from '../src/lib/reviewer.js';
import { __test as xtest } from '../src/lib/crosscase.js';
import { CRISIS_EPISODES } from '../src/data/crisisEpisodes.js';

const constraints={loss_exceed_max:.10,fp_max:.08,fn_max:.10,review_burden_max:.70,recovery_time_max:4,confidence:.95};
function agg(){return {episodes:1000,lossExceed:20,fp:100,fn:120,decisions:24000,reviewN:6000,rtSum:800,rtSq:640,lossSum:100,lossSq:10,objSum:200,objSq:40,adjustments:10,scenarios:{base:{n:1000,objSum:200,lossSum:100,violations:20}}};}

test('confirmatory inference records Bonferroni familywise correction',()=>{
  const ev=ctest.finalizeAgg(agg(),constraints,.95,{method:'bonferroni',familySize:128,adjust:true});
  assert.equal(ev.inference.method,'bonferroni');
  assert.equal(ev.inference.family_size,128);
  assert.ok(ev.inference.z_critical>1.96);
});

test('loss calibration is explicitly proxy-only with sensitivity bounds',()=>{
  const c=etest.deriveLossCalibration(CRISIS_EPISODES,90);
  assert.equal(c.identification_status,'PROXY_ONLY');
  assert.ok(c.c_fp_low<=c.c_fp_high);
  assert.ok(c.c_fn_low<=c.c_fn_high);
});

test('stratified calibration bootstrap propagates reconstructed measurement error',()=>{
  const b=etest.bootstrapCalibration(CRISIS_EPISODES,{B:20,seed:7});
  assert.equal(b.status,'CONFIRM');
  assert.equal(b.B,20);
  assert.equal(b.representative_draws.length,5);
  assert.ok(b.theta2.p95>=b.theta2.p05);
});

test('historical episode calibration does not silently use inconclusive theta3 digital coefficient',()=>{
  const cal={params:{baseline_shock:{value:.75},korea_concentration_anchor:{value:.75},korea_digital_adoption:{value:.92}},coeff:{kappa:-.05,theta1:.1,theta2:.2,theta3:99,rmse:.03}};
  const r=empiricalScenarioFromEpisode({episode_name:'x',year:2020,severity:.5,concentration:.5,digital_adoption:1,peak_outflow:.1,failed:0,provenance_type:'verified'},cal);
  assert.ok(r.empirical_outflow<.2); // would clip at .75 if theta3 were improperly added
});

test('participant-cluster bootstrap treats participants as sampling units',()=>{
  const rows=[];for(let p=0;p<12;p++)for(let i=0;i<10;i++)rows.push({participant_hash:`p${p}`,ai_correct:i%2,human_accept:i%3?1:0,response_ms:1000+p*10,recovered:i%2?0:1,recovery_ms:1200});
  const b=rtest.clusterBootstrap(rows,50,11);
  assert.equal(b.status,'CONFIRM');
  assert.equal(b.participants,12);
  assert.equal(b.B,50);
});

test('cross-case criterion exposes overlap, rank consistency and boundary error',()=>{
  const a=[{sigma:.03,maxK:3},{sigma:.05,maxK:2},{sigma:.1,maxK:1}],b=[{sigma:.03,maxK:3},{sigma:.05,maxK:2},{sigma:.1,maxK:1}];
  const x=xtest.spearmanPairs(a,b);assert.equal(x.n,3);assert.ok(x.rho>=.99);assert.equal(x.mae,0);
});
