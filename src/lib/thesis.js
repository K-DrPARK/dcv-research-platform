import { all, one } from './db.js';
import { safeJson, hashString, APP_VERSION, nowIso } from './util.js';
import { wilson } from './stats.js';
import { empiricalReadiness, loadEmpiricalCalibration } from './empirical.js';
import { latestProtocol } from './rigor.js';

const CLASS_SQL = `CASE
  WHEN c.status='confirmed_feasible' OR EXISTS(SELECT 1 FROM validations v WHERE v.candidate_id=c.id AND v.validation_type='human_recompute' AND v.status='CONFIRM') THEN 'confirmed'
  WHEN c.evidence_status='UNRESOLVED' OR c.status IN ('boundary_hold','unresolved') THEN 'boundary'
  WHEN c.status='provisionally_feasible' THEN 'provisional' ELSE 'infeasible' END`;
const PHASE_RANK = { confirmation: 4, refinement: 3, exploration: 2, historical: 1, stress: 1 };
const DIMS = [['sigma', 'sigma'], ['tau', 'tau'], ['alpha', 'alpha'], ['K', 'authority_k'], ['d', 'delay_d'], ['W', 'recovery_w'], ['m', 'adjust_m'], ['estimator', 'estimator']];
const r4 = v => (v == null || !Number.isFinite(Number(v))) ? null : Math.round(Number(v) * 10000) / 10000;
const med = xs => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const ci = (k, n) => { const w = wilson(k, n); return { k, n, p: r4(w.p), lo: r4(w.lo), hi: r4(w.hi) }; };

export function levelTable(cands, key) {
  const m = new Map();
  for (const c of cands) { const v = c[key] ?? '-'; const e = m.get(v) || { level: v, total: 0, confirmed: 0, boundary: 0 }; e.total++; if (c.klass === 'confirmed') e.confirmed++; if (c.klass === 'boundary') e.boundary++; m.set(v, e); }
  return [...m.values()].sort((a, b) => typeof a.level === 'number' ? a.level - b.level : String(a.level).localeCompare(String(b.level)))
    .map(e => ({ ...e, ...ci(e.confirmed, e.total), share: r4(e.total ? e.confirmed / e.total : 0) }));
}

export async function buildThesisData(env, projectId) {
  const project = await one(env.DB, `SELECT * FROM projects WHERE id=?`, [projectId]);
  if (!project) throw new Error('project_not_found');
  const cfg = await one(env.DB, `SELECT * FROM project_config WHERE project_id=?`, [projectId]) || {};
  const def = await one(env.DB, `SELECT version,content_json,gate_json,created_at FROM definitions WHERE project_id=? ORDER BY version DESC LIMIT 1`, [projectId]);
  const meas = await one(env.DB, `SELECT metrics_json,quality_json,measured_at FROM measurements WHERE project_id=? ORDER BY measured_at DESC LIMIT 1`, [projectId]);
  const appr = await one(env.DB, `SELECT * FROM approvals WHERE project_id=? ORDER BY created_at DESC LIMIT 1`, [projectId]);
  const rmodel = await one(env.DB, `SELECT model_json,version,created_at FROM reviewer_models WHERE project_id=? ORDER BY version DESC LIMIT 1`, [projectId]);
  const protocol = await latestProtocol(env, projectId);

  const candRows = await all(env.DB, `SELECT c.*, ${CLASS_SQL} AS klass FROM design_candidates c WHERE c.project_id=?`, [projectId]);
  const cands = candRows.map(c => ({ id: c.id, sigma: r4(c.sigma), tau: c.tau, alpha: r4(c.alpha), K: c.authority_k, d: c.delay_d, W: r4(c.recovery_w), m: r4(c.adjust_m), estimator: c.estimator || 'ema', status: c.status, evidence_status: c.evidence_status, klass: c.klass, boundary_score: r4(c.boundary_score), max_regret: r4(c.max_regret), objective_score: r4(c.objective_score) }));

  const runRows = await all(env.DB, `SELECT candidate_id,phase,n,loss_mean,loss_exceed_rate,fp_rate,fn_rate,review_burden,recovery_time,regret,created_at FROM simulation_runs WHERE project_id=? ORDER BY created_at`, [projectId]);
  const best = new Map(), byCandPhase = new Map();
  for (const r of runRows) {
    byCandPhase.set(`${r.candidate_id}|${r.phase}`, r);
    const cur = best.get(r.candidate_id);
    if (!cur || (PHASE_RANK[r.phase] || 0) >= (PHASE_RANK[cur.phase] || 0)) best.set(r.candidate_id, r);
  }
  const metricOf = id => { const r = best.get(id); return r ? { phase: r.phase, n: r.n, loss_mean: r4(r.loss_mean), loss_exceed_rate: r4(r.loss_exceed_rate), fp_rate: r4(r.fp_rate), fn_rate: r4(r.fn_rate), review_burden: r4(r.review_burden), recovery_time: r4(r.recovery_time), regret: r4(r.regret) } : null; };
  for (const c of cands) c.metrics = metricOf(c.id);

  const byClass = { confirmed: 0, boundary: 0, provisional: 0, infeasible: 0 };
  for (const c of cands) byClass[c.klass] = (byClass[c.klass] || 0) + 1;

  const dims = {}; for (const [name, key] of DIMS) dims[name] = levelTable(cands, key === 'authority_k' ? 'K' : key === 'delay_d' ? 'd' : key === 'recovery_w' ? 'W' : key === 'adjust_m' ? 'm' : key);
  const cellMap = new Map();
  for (const c of cands) { const k = `${c.sigma}|${c.alpha}`; const e = cellMap.get(k) || { sigma: c.sigma, alpha: c.alpha, total: 0, confirmed: 0 }; e.total++; if (c.klass === 'confirmed') e.confirmed++; cellMap.set(k, e); }
  const cells = [...cellMap.values()].map(e => ({ ...e, share: r4(e.confirmed / e.total) }));

  const estimators = dims.estimator.map(e => {
    const xs = cands.filter(c => c.estimator === e.level && c.metrics);
    const col = k => r4(avg(xs.map(c => c.metrics[k]).filter(v => v != null)));
    return { estimator: e.level, total: e.total, confirmed: e.confirmed, share: e.share, lo: e.lo, hi: e.hi, loss_mean: col('loss_mean'), fp_rate: col('fp_rate'), fn_rate: col('fn_rate'), review_burden: col('review_burden'), recovery_time: col('recovery_time') };
  });
  const finalists = cands.filter(c => c.klass === 'confirmed').sort((a, b) => (a.max_regret ?? 9e9) - (b.max_regret ?? 9e9) || (b.objective_score ?? 0) - (a.objective_score ?? 0)).slice(0, 10);
  const selectedId = appr?.candidate_id || null;
  const selected = selectedId ? cands.find(c => c.id === selectedId) || null : null;
  const selectedByPhase = selectedId ? Object.fromEntries(['exploration', 'refinement', 'confirmation', 'historical', 'stress'].map(ph => { const r = byCandPhase.get(`${selectedId}|${ph}`); return [ph, r ? { n: r.n, loss_mean: r4(r.loss_mean), loss_exceed_rate: r4(r.loss_exceed_rate), fp_rate: r4(r.fp_rate), fn_rate: r4(r.fn_rate), review_burden: r4(r.review_burden), recovery_time: r4(r.recovery_time), regret: r4(r.regret) } : null]; }).filter(([, v]) => v)) : {};
  const selectedEvidence = selectedId ? await one(env.DB, `SELECT result_json FROM simulation_runs WHERE project_id=? AND candidate_id=? AND phase IN ('confirmation','historical','stress') ORDER BY CASE phase WHEN 'stress' THEN 3 WHEN 'historical' THEN 2 ELSE 1 END DESC, created_at DESC LIMIT 1`, [projectId,selectedId]) : null;
  const selectedInference = safeJson(selectedEvidence?.result_json,{}).inference || null;

  const phases = await all(env.DB, `SELECT phase, COUNT(*) runs, SUM(n) episodes, SUM(COALESCE(json_extract(result_json,'$.decisions'),0)) decisions FROM simulation_runs WHERE project_id=? GROUP BY phase ORDER BY phase`, [projectId]);
  const validations = await all(env.DB, `SELECT validation_type, status, COUNT(*) n FROM validations WHERE project_id=? GROUP BY validation_type, status ORDER BY validation_type, status`, [projectId]);
  const scenarios = await one(env.DB, `SELECT COUNT(*) total, SUM(CASE WHEN scenario_type='historical' THEN 1 ELSE 0 END) historical, SUM(CASE WHEN scenario_type='adversarial' THEN 1 ELSE 0 END) adversarial FROM scenarios WHERE project_id=?`, [projectId]);

  // 인간 검토자 (행 단위 대신 SQL 집계 — 무료 플랜 CPU 절약)
  const rvTot = await one(env.DB, `SELECT COUNT(*) n, COUNT(DISTINCT participant_hash) participants, AVG(response_ms) mean_rt,
    SUM(CASE WHEN (ai_correct=1 AND human_accept=1) OR (ai_correct=0 AND human_accept=0) THEN 1 ELSE 0 END) appropriate,
    SUM(CASE WHEN ai_correct=0 THEN 1 ELSE 0 END) wrong_n, SUM(CASE WHEN ai_correct=0 AND human_accept=1 THEN 1 ELSE 0 END) wrong_accept,
    SUM(CASE WHEN ai_correct=1 THEN 1 ELSE 0 END) right_n, SUM(CASE WHEN ai_correct=1 AND human_accept=0 THEN 1 ELSE 0 END) right_override
    FROM reviewer_observations WHERE project_id=?`, [projectId]);
  const confRows = await all(env.DB, `SELECT ROUND(ai_confidence,2) confidence, COUNT(*) n, SUM(CASE WHEN ai_correct=1 THEN 1 ELSE 0 END) correct_n,
    SUM(CASE WHEN ai_correct=1 AND human_accept=1 THEN 1 ELSE 0 END) acc_c, SUM(CASE WHEN ai_correct=0 THEN 1 ELSE 0 END) wrong_n,
    SUM(CASE WHEN ai_correct=0 AND human_accept=1 THEN 1 ELSE 0 END) acc_w, AVG(response_ms) mean_rt
    FROM reviewer_observations WHERE project_id=? GROUP BY ROUND(ai_confidence,2) ORDER BY confidence`, [projectId]);
  const N = k => Number(rvTot?.[k] || 0);
  const byConfidence = confRows.map(e => ({ confidence: Number(e.confidence), n: e.n, correct_n: Number(e.correct_n), wrong_n: Number(e.wrong_n), accept_when_correct: ci(Number(e.acc_c), Number(e.correct_n)), accept_when_wrong: ci(Number(e.acc_w), Number(e.wrong_n)), mean_rt_ms: r4(e.mean_rt) }));
  const reviewer = {
    n: N('n'), participants: N('participants'),
    arr: ci(N('appropriate'), N('n')), false_accept: ci(N('wrong_accept'), N('wrong_n')), correct_override: ci(N('wrong_n') - N('wrong_accept'), N('wrong_n')), unnecessary_override: ci(N('right_override'), N('right_n')),
    mean_rt_ms: r4(rvTot?.mean_rt), by_confidence: byConfidence, model: safeJson(rmodel?.model_json, null), model_version: rmodel?.version ?? null, cluster_bootstrap: safeJson(rmodel?.model_json, null)?.cluster_bootstrap || null
  };

  // 실증 패널
  const empirical = await empiricalReadiness(env, projectId), cal = await loadEmpiricalCalibration(env, projectId);
  const eps = await all(env.DB, `SELECT episode_name,year,peak_outflow,concentration,digital_adoption,severity,failed,provenance_type FROM empirical_episodes WHERE project_id=? ORDER BY year, episode_name`, [projectId]);
  const stat = k => { const xs = eps.map(e => Number(e[k])).filter(Number.isFinite); return xs.length ? { mean: r4(avg(xs)), median: r4(med(xs)), min: r4(Math.min(...xs)), max: r4(Math.max(...xs)) } : null; };
  const panel = {
    n: eps.length, verified: eps.filter(e => e.provenance_type === 'verified').length, estimated: eps.filter(e => e.provenance_type !== 'verified').length,
    failed: ci(eps.filter(e => Number(e.failed) === 1).length, eps.length), year_min: eps.length ? Math.min(...eps.map(e => e.year)) : null, year_max: eps.length ? Math.max(...eps.map(e => e.year)) : null,
    descriptives: { peak_outflow: stat('peak_outflow'), concentration: stat('concentration'), digital_adoption: stat('digital_adoption'), severity: stat('severity') },
    episodes: eps.map(e => ({ ...e, peak_outflow: r4(e.peak_outflow), concentration: r4(e.concentration), digital_adoption: r4(e.digital_adoption), severity: r4(e.severity) }))
  };
  const params = await all(env.DB, `SELECT parameter_key,value_num,low_num,high_num,parameter_role,provenance_type FROM empirical_parameters WHERE project_id=? ORDER BY parameter_role,parameter_key`, [projectId]);

  const jobs = await all(env.DB, `SELECT type,status,COUNT(*) n FROM jobs WHERE project_id=? GROUP BY type,status ORDER BY type,status`, [projectId]);
  const audit = await one(env.DB, `SELECT COUNT(*) n, MIN(created_at) first_at, MAX(created_at) last_at FROM audit_log WHERE project_id=?`, [projectId]);
  const content = safeJson(def?.content_json, {}), constraints = safeJson(cfg.constraints_json, {}), design = safeJson(cfg.design_json, {});
  return {
    generated_at: nowIso(), app_version: APP_VERSION,
    project: { id: project.id, name: project.name, description: project.description, status: project.status, stage: project.current_stage, created_at: project.created_at },
    definition: { version: def?.version ?? null, research_question: content.research_question || cfg.research_question || '', content, gate: safeJson(def?.gate_json, {}) },
    constraints, design, measurement: { metrics: safeJson(meas?.metrics_json, {}), quality: safeJson(meas?.quality_json, {}), measured_at: meas?.measured_at || null },
    candidates: { total: cands.length, by_class: byClass, list: cands, dims, cells, estimators, finalists },
    selected: selected ? { ...selected, by_phase: selectedByPhase, inference:selectedInference } : null,
    approval: appr ? { decision: appr.decision, evidence_level: appr.evidence_level, automatic: !!appr.automatic, created_at: appr.created_at, basis: safeJson(appr.basis_json, {}) } : null,
    simulation: { phases, scenarios, validations }, reviewer, empirical: { readiness: empirical.status, complete_rows: empirical.complete_rows, target_rows: empirical.target_rows, profile: cal.profile?.version, coefficients: cal.coeff, calibration_uncertainty: cal.local_refit?.uncertainty || null, loss_calibration: cal.loss, parameters: params, panel },
    reproducibility: { design_seed: hashString(`${projectId}:design`), protocol: protocol ? {version:protocol.version,hash:protocol.protocol_hash,frozen_at:protocol.frozen_at,status:protocol.status,definition_version:protocol.definition_version} : null, jobs, audit: { n: audit?.n ?? 0, first_at: audit?.first_at, last_at: audit?.last_at } }
  };
}

const csvCell = v => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows, cols) => '\uFEFF' + [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';

export async function exportCsv(env, projectId, name) {
  const q = (sql, cols) => all(env.DB, sql, [projectId]).then(rows => toCsv(rows, cols));
  switch (name) {
    case 'candidates': {
      const t = await buildThesisData(env, projectId);
      const rows = t.candidates.list.map(c => ({ id: c.id, class: c.klass, estimator: c.estimator, sigma: c.sigma, tau: c.tau, alpha: c.alpha, K: c.K, d: c.d, W: c.W, m: c.m, max_regret: c.max_regret, boundary_score: c.boundary_score, objective_score: c.objective_score, phase: c.metrics?.phase, n: c.metrics?.n, loss_mean: c.metrics?.loss_mean, loss_exceed_rate: c.metrics?.loss_exceed_rate, fp_rate: c.metrics?.fp_rate, fn_rate: c.metrics?.fn_rate, review_burden: c.metrics?.review_burden, recovery_time: c.metrics?.recovery_time }));
      return toCsv(rows, ['id', 'class', 'estimator', 'sigma', 'tau', 'alpha', 'K', 'd', 'W', 'm', 'max_regret', 'boundary_score', 'objective_score', 'phase', 'n', 'loss_mean', 'loss_exceed_rate', 'fp_rate', 'fn_rate', 'review_burden', 'recovery_time']);
    }
    case 'simulation_runs': return q(`SELECT candidate_id,phase,seed,n,loss_mean,loss_exceed_rate,fp_rate,fn_rate,review_burden,recovery_time,regret,created_at FROM simulation_runs WHERE project_id=? ORDER BY created_at`, ['candidate_id', 'phase', 'seed', 'n', 'loss_mean', 'loss_exceed_rate', 'fp_rate', 'fn_rate', 'review_burden', 'recovery_time', 'regret', 'created_at']);
    case 'validations': return q(`SELECT candidate_id,validation_type,status,result_json,created_at FROM validations WHERE project_id=? ORDER BY created_at`, ['candidate_id', 'validation_type', 'status', 'result_json', 'created_at']);
    case 'reviewer_observations': return q(`SELECT participant_hash,ai_confidence,ai_correct,human_accept,response_ms,recovered,recovery_ms,created_at FROM reviewer_observations WHERE project_id=? ORDER BY created_at`, ['participant_hash', 'ai_confidence', 'ai_correct', 'human_accept', 'response_ms', 'recovered', 'recovery_ms', 'created_at']);
    case 'episodes': return q(`SELECT episode_name,year,country,peak_outflow,concentration,digital_adoption,severity,failed,provenance_type,reliability_grade,source_note FROM empirical_episodes WHERE project_id=? ORDER BY year,episode_name`, ['episode_name', 'year', 'country', 'peak_outflow', 'concentration', 'digital_adoption', 'severity', 'failed', 'provenance_type', 'reliability_grade', 'source_note']);
    case 'audit_log': return q(`SELECT created_at,actor,action,entity_type,entity_id,detail_json FROM audit_log WHERE project_id=? ORDER BY created_at`, ['created_at', 'actor', 'action', 'entity_type', 'entity_id', 'detail_json']);
    default: return null;
  }
}
export const EXPORT_NAMES = ['candidates', 'simulation_runs', 'validations', 'reviewer_observations', 'episodes', 'audit_log'];
