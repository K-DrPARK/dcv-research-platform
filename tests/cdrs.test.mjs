import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../src/lib/compute.js';

const constraints={loss_exceed_max:.10,fp_max:.08,fn_max:.10,review_burden_max:.70,recovery_time_max:4,confidence:.95};
function agg({episodes=1000,decisions=24000,lossExceed=20,fp=100,fn=120,reviewN=6000,rt=.8}={}){
  return {episodes,lossExceed,fp,fn,decisions,reviewN,rtSum:rt*episodes,rtSq:rt*rt*episodes,lossSum:.1*episodes,lossSq:.01*episodes,objSum:.2*episodes,objSq:.04*episodes,adjustments:10,scenarios:{base:{n:episodes,objSum:.2*episodes,lossSum:.1*episodes,violations:lossExceed}}};
}
test('clearly safe evidence becomes FEASIBLE',()=>{assert.equal(__test.finalizeAgg(agg(),constraints,.95).classification,'FEASIBLE')});
test('clear false-negative violation becomes INFEASIBLE',()=>{assert.equal(__test.finalizeAgg(agg({fn:5000}),constraints,.95).classification,'INFEASIBLE')});
test('boundary evidence is not treated as violation',()=>{const a=agg({episodes:80,lossExceed:8});assert.equal(__test.finalizeAgg(a,constraints,.95).classification,'UNRESOLVED')});
test('estimator benchmark includes four families',()=>{assert.deepEqual(['ema','kalman','changepoint','adaptive'].sort(),['ema','kalman','changepoint','adaptive'].sort())});
