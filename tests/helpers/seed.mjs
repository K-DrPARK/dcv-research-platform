import { mulberry32 } from '../../src/lib/util.js';

export async function seedProject(db, { candidates = 60, reviewer = 40, episodes = 30 } = {}) {
  const rng = mulberry32(7), now = new Date().toISOString(), pid = 'project_test';
  const run = (sql, ...b) => db.prepare(sql).bind(...b).run();
  await run(`INSERT INTO projects(id,name,description,status,current_stage,auto_run,auto_approve,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?)`, pid, '테스트 프로젝트', '', 'complete', 'report', now, now);
  await run(`INSERT INTO project_config(project_id,research_question,design_json,constraints_json,benchmark_json,validation_json) VALUES(?,?,?,?,?,?)`, pid, '잡음과 승인 지연 하에서 위임 가능 영역은?',
    JSON.stringify({ sigma: [0.03, 0.05, 0.1], tau: [0, 1, 2], alpha: [0.15, 0.35, 0.55, 0.75], K: [0, 1, 2, 3], d: [0, 1, 2, 4], W: [0.05, 0.12], m: [0.08, 0.15], estimators: ['ema', 'kalman', 'changepoint', 'adaptive'], max_candidates: 128 }),
    JSON.stringify({ loss_max: 0.28, loss_exceed_max: 0.1, fp_max: 0.08, fn_max: 0.1, review_burden_max: 0.7, recovery_time_max: 4, confidence: 0.95 }), '{}', '{}');
  await run(`INSERT INTO definitions(id,project_id,version,status,content_json,gate_json,created_at) VALUES(?,?,?,?,?,?,?)`, 'def1', pid, 1, 'approved', JSON.stringify({ research_question: '잡음과 승인 지연 하에서 위임 가능 영역은?' }), '{}', now);
  const sig = [0.03, 0.05, 0.1], alp = [0.15, 0.35, 0.55, 0.75], est = ['ema', 'kalman', 'changepoint', 'adaptive'];
  let best = null;
  for (let i = 0; i < candidates; i++) {
    const s = sig[i % 3], a = alp[i % 4], e = est[i % 4], ok = rng() < (0.55 - s * 2 + a * 0.2), id = `cand_${i}`, regret = 0.02 + rng() * 0.1;
    await run(`INSERT INTO design_candidates(id,project_id,sigma,tau,alpha,authority_k,delay_d,recovery_w,adjust_m,status,estimator,evidence_status,boundary_score,max_regret,objective_score,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, pid, s, i % 3, a, i % 4, [0, 1, 2, 4][i % 4], 0.05, 0.08, ok ? 'confirmed_feasible' : 'infeasible', e, ok ? 'CONFIRMED' : 'INFEASIBLE', rng() * 2, ok ? regret : null, rng(), now);
    for (const ph of ['exploration', 'confirmation']) await run(`INSERT INTO simulation_runs(id,project_id,candidate_id,phase,seed,n,loss_mean,loss_exceed_rate,fp_rate,fn_rate,review_burden,recovery_time,regret,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, `run_${i}_${ph}`, pid, id, ph, i, 180, 0.04 + rng() * 0.1, rng() * 0.1, rng() * 0.05, rng() * 0.08, rng(), rng() * 2, regret, JSON.stringify({ decisions: 16200 }), now);
    if (ok) { await run(`INSERT INTO validations(id,project_id,candidate_id,validation_type,status,result_json,created_at) VALUES(?,?,?,?,?,?,?)`, `val_${i}`, pid, id, 'human_recompute', 'CONFIRM', '{}', now); if (!best || regret < best.regret) best = { id, regret }; }
  }
  if (best) await run(`INSERT INTO approvals(id,project_id,candidate_id,decision,evidence_level,basis_json,automatic,created_at) VALUES(?,?,?,?,?,?,1,?)`, 'appr1', pid, best.id, 'CONFIRMED_DELEGATION', 'B', JSON.stringify({ selection_rule: 'robust feasibility first, minimax regret second' }), now);
  for (let i = 0; i < reviewer; i++) { const conf = [0.55, 0.75, 0.92][i % 3], correct = rng() < 0.65, accept = correct ? rng() < 0.8 : rng() < 0.6; await run(`INSERT INTO reviewer_observations(id,project_id,participant_hash,ai_confidence,ai_correct,human_accept,response_ms,recovered,recovery_ms,context_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, `rev_${i}`, pid, `p${i % 4}`, conf, correct ? 1 : 0, accept ? 1 : 0, 1500 + Math.round(rng() * 2000), 0, null, '{}', now); }
  for (let i = 0; i < episodes; i++) { const sev = rng(), out = rng() * 0.4; await run(`INSERT INTO empirical_episodes(id,project_id,episode_name,year,peak_outflow,concentration,digital_adoption,severity,failed,provenance_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, `ep_${i}`, pid, `episode_${i}`, 1984 + i, out, rng(), rng(), sev, sev > 0.5 ? 1 : 0, i % 3 ? 'estimated' : 'verified', now, now); }
  await run(`UPDATE projects SET candidate_count=(SELECT COUNT(*) FROM design_candidates WHERE project_id=?), reviewer_obs_count=(SELECT COUNT(*) FROM reviewer_observations WHERE project_id=?) WHERE id=?`, pid, pid, pid);
  return pid;
}
