import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './helpers/d1shim.mjs';
import { enqueue, enqueueOnce, claimJobs } from '../src/lib/db.js';
import { advanceProject, scheduleAll } from '../src/lib/orchestrator.js';
import { cached, bust } from '../src/lib/memo.js';

const now = () => new Date().toISOString();
async function project(db, id = 'p1', status = 'draft') {
  await db.prepare(`INSERT INTO projects(id,name,description,status,current_stage,auto_run,auto_approve,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?)`).bind(id, 'n', '', status, 'define', now(), now()).run();
}
const plan = (db, sql, ...b) => db.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(...b).map(r => r.detail).join(' | ');

test('enqueueOnce coalesces queued duplicates (advance_project storm)', async () => {
  const db = makeDb(), env = { DB: db }; await project(db);
  const a = await enqueueOnce(env, 'p1', 'advance_project', {}, 98, 5);
  const b = await enqueueOnce(env, 'p1', 'advance_project', {}, 98, 5);
  assert.ok(a); assert.equal(b, null);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM jobs WHERE type='advance_project'`).get().n, 1);
});

test('enqueue records the phase column used by the jobs index', async () => {
  const db = makeDb(), env = { DB: db }; await project(db);
  await enqueue(env, 'p1', 'compute_candidate', { candidate_id: 'c', phase: 'stress', cycle: 0 }, 50);
  assert.equal(db.raw.prepare(`SELECT phase FROM jobs`).get().phase, 'stress');
});

test('finished projects cost zero reads: advance returns early and cron skips them', async () => {
  const db = makeDb(), env = { DB: db }; await project(db, 'done1', 'report_ready'); await project(db, 'live1', 'draft');
  assert.deepEqual(await advanceProject(env, 'done1'), { stage: 'complete' });
  await scheduleAll(env);
  const queued = db.raw.prepare(`SELECT project_id FROM jobs WHERE type='advance_project'`).all().map(r => r.project_id);
  assert.deepEqual(queued, ['live1']);
});

test('reviewer wait does not poll: a HOLD marker with no new observations stops re-queuing fit_reviewer', async () => {
  const db = makeDb(), env = { DB: db }; await project(db);
  db.raw.prepare(`UPDATE projects SET reviewer_hold_marker='' WHERE id='p1'`).run();
  const r = await advanceProject(env, 'p1');
  assert.equal(r.stage, 'human_review'); assert.equal(r.waiting, 'no_new_reviewer_observations');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM jobs WHERE type='fit_reviewer'`).get().n, 0);
  // 새 관측이 들어오면 마커와 달라져 다시 진행 가능(앞 단계 조건이 없는 이 최소 프로젝트에서는 define 단계로 판정되지만, 대기 분기는 탈출한다)
  await db.prepare(`INSERT INTO reviewer_observations(id,project_id,participant_hash,ai_confidence,ai_correct,human_accept,response_ms,created_at) VALUES('o1','p1','a',0.5,1,1,10,?)`).bind(now()).run();
  const r2 = await advanceProject(env, 'p1'); assert.notEqual(r2.waiting, 'no_new_reviewer_observations');
});

test('claimJobs reads in priority order using idx_jobs_claim (no temp sort over the whole queue)', async () => {
  const db = makeDb(); await project(db);
  const p = plan(db, `SELECT * FROM jobs WHERE status='queued' AND run_after<=? ORDER BY priority ASC, created_at ASC LIMIT ?`, 'x', 1);
  assert.match(p, /idx_jobs_claim/); assert.doesNotMatch(p, /TEMP B-TREE/);
  const env = { DB: db }; await enqueue(env, 'p1', 'x', {}, 90); await enqueue(env, 'p1', 'y', {}, 10);
  assert.equal((await claimJobs(env, 1))[0].type, 'y');
});

test('hot queries are index lookups, not full table scans (regression guard)', () => {
  const db = makeDb();
  const hot = [
    [`SELECT phase,COUNT(DISTINCT candidate_id) n FROM simulation_runs WHERE project_id=? AND phase IN ('historical','stress','recompute') GROUP BY phase`, 'p'],
    [`SELECT validation_type t,status s,COUNT(*) c,COUNT(DISTINCT candidate_id) d FROM validations WHERE project_id=? AND validation_type IN ('robust','human_recompute') GROUP BY validation_type,status`, 'p'],
    [`SELECT c.*, (SELECT status FROM validations v WHERE v.candidate_id=c.id AND v.validation_type='human_recompute' ORDER BY created_at DESC LIMIT 1) final_status FROM design_candidates c WHERE project_id=? ORDER BY sigma,authority_k,delay_d LIMIT 500`, 'p'],
    [`SELECT type,status,attempts,last_error,created_at,updated_at FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 20`, 'p'],
    [`SELECT 1 x FROM jobs WHERE project_id=? AND type=? AND status IN ('queued','running') AND phase=? LIMIT 1`, 'p', 't', 'x'],
    [`SELECT metrics_json FROM measurements WHERE project_id=? ORDER BY measured_at DESC LIMIT 1`, 'p'],
    [`SELECT id FROM approvals WHERE project_id=? ORDER BY created_at DESC LIMIT 1`, 'p'],
    [`SELECT id FROM reports WHERE project_id=? ORDER BY created_at DESC LIMIT 1`, 'p'],
    [`SELECT key,value_num,observed_at FROM raw_observations WHERE project_id=? AND value_num IS NOT NULL ORDER BY observed_at DESC LIMIT 5000`, 'p'],
    [`SELECT created_at FROM reviewer_observations WHERE project_id=? ORDER BY created_at DESC LIMIT 1`, 'p'],
  ];
  for (const [sql, ...b] of hot) { const p = plan(db, sql, ...b); assert.doesNotMatch(p, /\bSCAN (TABLE )?(simulation_runs|validations|jobs|measurements|approvals|reports|raw_observations|reviewer_observations)\b/, p + ' <= ' + sql); }
});

test('memo is per-DB, expires, and is busted on writes', async () => {
  const a = { DB: {} }, b = { DB: {} }; let n = 0; const load = async () => ++n;
  assert.equal(await cached(a, 'p', 'k', load), 1); assert.equal(await cached(a, 'p', 'k', load), 1);
  assert.equal(await cached(b, 'p', 'k', load), 2, 'different DB binding must not share cache');
  bust(a, 'p'); assert.equal(await cached(a, 'p', 'k', load), 3);
  assert.equal(await cached(a, 'p', 'k2', load, -1), 4); assert.equal(await cached(a, 'p', 'k2', load, -1), 5, 'ttl<=0 never hits');
});
