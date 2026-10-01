import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './helpers/d1shim.mjs';
import { seedProject } from './helpers/seed.mjs';
import { refreshValidationMatrix, getValidationMatrix } from '../src/lib/validation_matrix.js';

const now=()=>new Date().toISOString();
const ev=(classification,groups={})=>JSON.stringify({classification,validation_groups:groups});

test('External Validation Matrix separates Synthetic/Historical/Adversarial/BIS/ECB/Human',async()=>{
  const DB=makeDb(),pid=await seedProject(DB,{candidates:1,reviewer:0,episodes:0}),cid='cand_0',ts=now();
  DB.raw.prepare(`DELETE FROM simulation_runs WHERE project_id=? AND candidate_id=?`).run(pid,cid);
  const ins=(id,phase,result)=>DB.raw.prepare(`INSERT INTO simulation_runs(id,project_id,candidate_id,phase,seed,n,result_json,created_at,evidence_revision) VALUES(?,?,?,?,1,100,?,?,0)`).run(id,pid,cid,phase,result,ts);
  ins('c','confirmation',ev('FEASIBLE',{Synthetic:{classification:'FEASIBLE'}}));
  ins('h','historical',ev('FEASIBLE',{Historical:{classification:'FEASIBLE'}}));
  ins('s','stress',ev('UNRESOLVED',{Adversarial:{classification:'FEASIBLE'},BIS:{classification:'INFEASIBLE'},ECB:{classification:'UNRESOLVED'}}));
  DB.raw.prepare(`DELETE FROM validations WHERE project_id=? AND candidate_id=? AND validation_type='human_recompute'`).run(pid,cid);
  DB.raw.prepare(`INSERT INTO validations(id,project_id,candidate_id,validation_type,status,result_json,created_at,evidence_revision) VALUES('hv',?,?,'human_recompute','CONFIRM','{}',?,0)`).run(pid,cid,ts);
  const r=await refreshValidationMatrix({DB},pid);assert.equal(r.rows,1);
  const vm=await getValidationMatrix({DB},pid),x=vm.rows[0];
  assert.equal(x.synthetic_status,'PASS');assert.equal(x.historical_status,'PASS');assert.equal(x.adversarial_status,'PASS');assert.equal(x.bis_status,'FAIL');assert.equal(x.ecb_status,'HOLD');assert.equal(x.human_status,'PASS');assert.equal(x.overall_status,'FAIL');
  assert.equal(vm.summary.dimensions.BIS.FAIL,1);assert.equal(vm.summary.dimensions.ECB.HOLD,1);
});

test('External Validation Matrix keeps unavailable external layers as N/A rather than failure',async()=>{
  const DB=makeDb(),pid=await seedProject(DB,{candidates:1,reviewer:0,episodes:0}),cid='cand_0',ts=now();
  DB.raw.prepare(`DELETE FROM simulation_runs WHERE project_id=? AND candidate_id=?`).run(pid,cid);
  DB.raw.prepare(`DELETE FROM validations WHERE project_id=? AND candidate_id=?`).run(pid,cid);
  DB.raw.prepare(`INSERT INTO simulation_runs(id,project_id,candidate_id,phase,seed,n,result_json,created_at,evidence_revision) VALUES('c',?,?, 'confirmation',1,100,?, ?,0)`).run(pid,cid,ev('FEASIBLE',{Synthetic:{classification:'FEASIBLE'}}),ts);
  await refreshValidationMatrix({DB},pid);const x=(await getValidationMatrix({DB},pid)).rows[0];
  assert.equal(x.synthetic_status,'PASS');assert.equal(x.bis_status,'NA');assert.equal(x.ecb_status,'NA');assert.equal(x.human_status,'NA');assert.equal(x.overall_status,'PARTIAL');
});
