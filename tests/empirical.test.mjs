import test from 'node:test';
import assert from 'node:assert/strict';
import { CBDC_PAPER_PROFILE, __test } from '../src/lib/empirical.js';
import { CRISIS_EPISODES } from '../src/data/crisisEpisodes.js';

test('paper anchor matches current n=81 manuscript profile',()=>{
  assert.equal(CBDC_PAPER_PROFILE.panel.n,81);
  assert.equal(CBDC_PAPER_PROFILE.panel.verified,15);
  assert.equal(CBDC_PAPER_PROFILE.reduced_form.theta2,0.2466);
  assert.equal(CBDC_PAPER_PROFILE.simulation_architecture.horizon_days,90);
});

test('local OLS refit recovers known reduced-form coefficients',()=>{
  const rows=[];
  for(let i=0;i<120;i++){
    const s=.25+(i%20)/30, c=.35+((i*7)%23)/40;
    const y=-.05+.08*s+.24*c*s + ((i%5)-2)*.0002;
    rows.push({peak_outflow:y,severity:s,concentration:c});
  }
  const r=__test.fitReducedForm(rows);
  assert.equal(r.status,'CONFIRM');
  assert.ok(Math.abs(r.coefficients.kappa+.05)<.005);
  assert.ok(Math.abs(r.coefficients.theta1-.08)<.01);
  assert.ok(Math.abs(r.coefficients.theta2-.24)<.01);
});


test('n=81 panel derives empirical FP/FN loss proxies without fabricated labels',()=>{
  const c=__test.deriveLossCalibration(CRISIS_EPISODES,90);
  assert.equal(c.status,'CONFIRM');
  assert.equal(c.n,81);
  assert.equal(c.failures,60);
  assert.equal(c.nonfailures,21);
  assert.ok(Math.abs(c.c_fp-0.0592047619)<1e-9);
  assert.ok(Math.abs(c.c_fn-0.0831716667)<1e-9);
  assert.equal(c.q75_outflow,0.09);
  assert.equal(c.q95_outflow,0.18);
  assert.ok(c.c_fn>c.c_fp);
  assert.equal(c.identification_status,'PROXY_ONLY');
});
