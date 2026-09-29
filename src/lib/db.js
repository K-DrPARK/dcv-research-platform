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
  await run(env.DB, `INSERT INTO jobs(id,project_id,type,status,priority,payload_json,run_after,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?,?,?)`,
    [id, projectId, type, priority, JSON.stringify(payload), t, now, now]);
  // Queue is the execution transport; D1 remains the durable source of truth and fallback queue.
  if (env.CDRS_QUEUE) { try { await env.CDRS_QUEUE.send({ job_id:id, project_id:projectId, type }); } catch (_) {} }
  return id;
}

export async function claimJobs(env, limit=4) {
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
