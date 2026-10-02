import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeDb} from './helpers/d1shim.mjs';
import {seedProject} from './helpers/seed.mjs';
import {seedCandidates,computeCandidate} from '../src/lib/compute.js';
import {parseRedesignCsv} from '../src/lib/redesign.js';
import {scheduleAll,processJobs} from '../src/lib/orchestrator.js';
import {claimJobs} from '../src/lib/db.js';
test('all 208 stranded candidates are recovered and produce actual simulation metrics',async()=>{
 const DB=makeDb(),id=await seedProject(DB,{candidates:0,reviewer:0,episodes:0});
 const d=JSON.parse(DB.raw.prepare('SELECT content_json FROM definitions').get().content_json);
 d.design={candidate_rows:parseRedesignCsv(fs.readFileSync('data/redesign_candidates.csv','utf8')),max_candidates:208};
 d.constraints={loss_max:.18,loss_exceed_max:.1,fp_max:.08,fn_max:.1,review_burden_max:.7,recovery_time_max:4,confidence:.95};
 // Small preregistered fixture repetitions test orchestration, not manuscript evidence.
 d.benchmark={horizon:10};d.validation={exploration_n:8,confirmation_n:8,refinement_n:8,robust_n:8};
 DB.raw.prepare('UPDATE definitions SET content_json=?').run(JSON.stringify(d));
 const env={DB,COMPUTE_EXECUTOR:'github-actions',EXTERNAL_RUNTIME:'github-actions',MAX_JOBS_PER_TICK:1};
 await seedCandidates(env,id);DB.raw.exec('DELETE FROM jobs; DELETE FROM research_protocols');
 await seedCandidates(env,id);await scheduleAll(env,{process:false});
 const recovered=await processJobs(env);assert.equal(recovered[0].ok,true);assert.ok(DB.raw.prepare('SELECT protocol_hash FROM research_protocols').get().protocol_hash);
 for(let step=0;step<1800;step++){
  const waiting=DB.raw.prepare("SELECT COUNT(*) n FROM design_candidates WHERE status='pending'").get().n;
  if(!waiting)break;
  DB.raw.exec("UPDATE jobs SET run_after='2000-01-01T00:00:00.000Z' WHERE type='advance_project'");
  const result=await processJobs(env);assert.ok(result.every(r=>r.ok),JSON.stringify(result));
  if(!result.length)await scheduleAll(env,{process:false});
 }
 assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM simulation_runs WHERE phase='exploration'").get().n,208);
 assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM design_candidates WHERE status='pending'").get().n,0);
 assert.ok(DB.raw.prepare('SELECT MAX(loss_mean) x FROM simulation_runs').get().x>0);
});
test('collector that exceeds remaining budget cannot block candidate calculation',async()=>{
 const DB=makeDb(),id=await seedProject(DB,{candidates:0});const ts=new Date().toISOString();
 for(const [type,priority] of [['collect_project',25],['compute_candidate',40]])DB.raw.prepare("INSERT INTO jobs(id,project_id,type,status,priority,payload_json,run_after,created_at,updated_at) VALUES(?,?,?,'queued',?,'{}',?,?,?)").run(type,id,type,priority,ts,ts,ts);
 const jobs=await claimJobs({DB,EXTERNAL_RUNTIME:'github-actions',DB:Object.assign(DB,{remaining:100})},1);assert.equal(jobs[0].type,'compute_candidate');
});
