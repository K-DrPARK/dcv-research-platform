import test from 'node:test';
import assert from 'node:assert/strict';
import { CBDC_PAPER_PROFILE, __test } from '../src/lib/empirical.js';

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
