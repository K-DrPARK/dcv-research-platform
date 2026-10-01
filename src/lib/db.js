import { nowIso, uid } from './util.js';

export async function one(db, sql, binds = []) { return db.prepare(sql).bind(...binds).first(); }
export async function all(db, sql, binds = []) { const r = await db.prepare(sql).bind(...binds).all(); return r.results || []; }
export async function run(db, sql, binds = []) { return db.prepare(sql).bind(...binds).run(); }

export async function audit(env, projectId, actor, action, entityType=null, entityId=null, detail={}) {
  await run(env.DB, `INSERT INTO audit_log(id,project_id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)`,
    [uid('audit'), projectId, actor, action, entityType, entityId, JSON.stringify(detail), nowIso()]);
}

export async function enqueue(env, projectId, type, payload={}, priority=100, delaySeconds=0) {
  const t = new Date(Date.now()+delaySeconds*1000).toISOString();
  const id=uid('job'), now=nowIso();
  await run(env.DB, `INSERT INTO jobs(id,project_id,type,status,priority,payload_json,phase,run_after,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?,?,?,?)`,
    [id, projectId, type, priority, JSON.stringify(payload), payload?.phase ?? null, t, now, now]);
  // Queue is the execution transport; D1 remains the durable source of truth and fallback queue.
  if (env.CDRS_QUEUE) { try { await env.CDRS_QUEUE.send({ job_id:id, project_id:projectId, type }); } catch (_) {} }
  return id;
}

// 같은 (project,type)의 대기(queued) 작업이 이미 있으면 새로 만들지 않는다.
// compute_candidate 가 끝날 때마다 advance_project 를 무조건 enqueue 하던 것(후보 수만큼 중복)을 1건으로 합친다.
// 'running' 은 중복으로 보지 않는다: 실행 중인 작업은 이미 상태를 읽었을 수 있어 뒤따르는 1건이 필요하다.
export async function enqueueOnce(env, projectId, type, payload={}, priority=100, delaySeconds=0) {
  const dup = await one(env.DB, `SELECT 1 x FROM jobs WHERE project_id IS ? AND type=? AND status='queued' LIMIT 1`, [projectId, type]);
  if (dup) return null;
  return enqueue(env, projectId, type, payload, priority, delaySeconds);
}

let lastStaleSweep = 0;
export async function recoverStaleJobs(env, minutes=8) {
  // A Worker killed by a resource limit never reaches finishJob, leaving the job 'running' forever.
  if (Date.now()-lastStaleSweep < 120000) return;   // 큐 메시지마다가 아니라 isolate 당 2분에 1회만 점검
  lastStaleSweep = Date.now();
  const cutoff = new Date(Date.now()-minutes*60000).toISOString();
  await run(env.DB, `UPDATE jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END, locked_at=NULL, run_after=?, last_error='stale_lock_recovered: worker likely exceeded resource limits', updated_at=? WHERE status='running' AND locked_at IS NOT NULL AND locked_at<?`, [nowIso(), nowIso(), cutoff]);
}

export async function enqueueMany(env, projectId, type, payloads=[], priority=100) {
  // One D1 batch + chunked queue sends instead of one round-trip per job (Free plan subrequest limit).
  if (!payloads.length) return 0;
  const now = nowIso(), ids = payloads.map(()=>uid('job'));
  await env.DB.batch(payloads.map((pl,i)=>env.DB.prepare(`INSERT INTO jobs(id,project_id,type,status,priority,payload_json,phase,run_after,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?,?,?,?)`).bind(ids[i], projectId, type, priority, JSON.stringify(pl), pl?.phase ?? null, now, now, now)));
  if (env.CDRS_QUEUE) {
    try { for (let i=0;i<ids.length;i+=100) await env.CDRS_QUEUE.sendBatch(ids.slice(i,i+100).map(id=>({body:{job_id:id, project_id:projectId, type}}))); } catch (_) {}
  }
  return ids.length;
}

export async function claimJobs(env, limit=4) {
  await recoverStaleJobs(env);
  const jobs = await all(env.DB, `SELECT * FROM jobs WHERE status='queued' AND run_after<=? ORDER BY priority ASC, created_at ASC LIMIT ?`, [nowIso(), limit]);
  const claimed=[];
  for (const j of jobs) {
    const r = await run(env.DB, `UPDATE jobs SET status='running', locked_at=?, attempts=attempts+1, updated_at=? WHERE id=? AND status='queued'`, [nowIso(), nowIso(), j.id]);
    if ((r.meta?.changes || 0) > 0) claimed.push({...j, attempts:(j.attempts||0)+1});
  }
  return claimed;
}

export async function finishJob(env, job, error=null) {
  if (!error) {
    await run(env.DB, `UPDATE jobs SET status='done', updated_at=?, last_error=NULL WHERE id=?`, [nowIso(), job.id]);
    return;
  }
  const max = job.max_attempts || 5;
  const retry = (job.attempts || 1) < max;
  const next = new Date(Date.now() + Math.min(3600, 30*Math.pow(2, job.attempts || 1))*1000).toISOString();
  await run(env.DB, `UPDATE jobs SET status=?, run_after=?, locked_at=NULL, last_error=?, updated_at=? WHERE id=?`,
    [retry?'queued':'failed', next, String(error).slice(0,2000), nowIso(), job.id]);
}

// 끝난 job 행은 더 이상 쓰이지 않지만 jobs 테이블을 계속 키워 모든 jobs 스캔/집계의 비용을 올린다.
export async function pruneJobs(env, days=3) {
  const cutoff = new Date(Date.now()-days*86400000).toISOString();
  const r = await run(env.DB, `DELETE FROM jobs WHERE status='done' AND updated_at<?`, [cutoff]);
  return r.meta?.changes || 0;
}
