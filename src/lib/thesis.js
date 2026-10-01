import { all, one } from './db.js';
import { safeJson, hashString, APP_VERSION, nowIso } from './util.js';
import { wilson } from './stats.js';
import { empiricalReadiness, loadEmpiricalCalibration } from './empirical.js';
import { latestProtocol } from './rigor.js';
import { fdicStatus, getFdicReverificationRankings } from './fdic.js';

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
  const cycle=Number(project.research_cycle||1),rev=Number(project.evidence_revision||0);
  const appr = await one(env.DB, `SELECT * FROM approvals WHERE project_id=? AND research_cycle=? AND evidence_revision=? AND stale_at IS NULL ORDER BY created_at DESC LIMIT 1`, [projectId,cycle,rev]);
  const rmodel = await one(env.DB, `SELECT model_json,version,created_at FROM reviewer_models WHERE project_id=? AND research_cycle=? AND evidence_revision=? ORDER BY version DESC LIMIT 1`, [projectId,cycle,rev]);
  const protocol = await latestProtocol(env, projectId);

  const candRows = await all(env.DB, `SELECT c.*, ${CLASS_SQL} AS klass FROM design_candidates c WHERE c.project_id=? AND c.research_cycle=?`, [projectId,cycle]);
  const cands = candRows.map(c => ({ id: c.id, sigma: r4(c.sigma), tau: c.tau, alpha: r4(c.alpha), K: c.authority_k, d: c.delay_d, W: r4(c.recovery_w), m: r4(c.adjust_m), estimator: c.estimator || 'ema', status: c.status, evidence_status: c.evidence_status, klass: c.klass, boundary_score: r4(c.boundary_score), max_regret: r4(c.max_regret), objective_score: r4(c.objective_score) }));

  // simulation_runs 는 한 번만 읽는다(이전: 이 조회 + 단계별 집계 조회로 2회 스캔). decisions 는 단계별 집계용으로 함께 꺼낸다.
  const runRows = await all(env.DB, `SELECT r.candidate_id,r.phase,r.n,r.loss_mean,r.loss_exceed_rate,r.fp_rate,r.fn_rate,r.review_burden,r.recovery_time,r.regret,r.created_at,COALESCE(json_extract(r.result_json,'$.decisions'),0) AS decisions FROM simulation_runs r JOIN design_candidates c ON c.id=r.candidate_id WHERE r.project_id=? AND c.research_cycle=? ORDER BY r.created_at`, [projectId,cycle]);
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

  const phaseAgg = new Map();
  for (const r of runRows) { const e = phaseAgg.get(r.phase) || { phase: r.phase, runs: 0, episodes: 0, decisions: 0 }; e.runs++; e.episodes += Number(r.n) || 0; e.decisions += Number(r.decisions) || 0; phaseAgg.set(r.phase, e); }
  const phases = [...phaseAgg.values()].sort((a, b) => (a.phase < b.phase ? -1 : a.phase > b.phase ? 1 : 0));
  const validations = await all(env.DB, `SELECT v.validation_type, v.status, COUNT(*) n FROM validations v LEFT JOIN design_candidates c ON c.id=v.candidate_id WHERE v.project_id=? AND (v.candidate_id IS NULL OR c.research_cycle=?) AND (v.validation_type!='human_recompute' OR v.evidence_revision=?) GROUP BY v.validation_type, v.status ORDER BY v.validation_type, v.status`, [projectId,cycle,rev]);
  const scenarios = await one(env.DB, `SELECT COUNT(*) total, SUM(CASE WHEN scenario_type='historical' THEN 1 ELSE 0 END) historical, SUM(CASE WHEN scenario_type='adversarial' THEN 1 ELSE 0 END) adversarial FROM scenarios WHERE project_id=?`, [projectId]);

  // 인간 검토자: reviewer_observations 를 한 번만 스캔한다(이전: 전체 집계 + 신뢰도별 집계로 2회 스캔).
  // (신뢰도 구간 × 참가자)로 묶어 가져오면 행 수는 구간수×참가자수로 줄고, 합계·참가자 수·구간별 값을 모두 여기서 만든다.
  const rvRows = await all(env.DB, `SELECT ROUND(ai_confidence,2) confidence, participant_hash ph, COUNT(*) n, SUM(response_ms) rt,
    SUM(CASE WHEN ai_correct=1 THEN 1 ELSE 0 END) correct_n, SUM(CASE WHEN ai_correct=1 AND human_accept=1 THEN 1 ELSE 0 END) acc_c,
    SUM(CASE WHEN ai_correct=0 THEN 1 ELSE 0 END) wrong_n, SUM(CASE WHEN ai_correct=0 AND human_accept=1 THEN 1 ELSE 0 END) acc_w,
    SUM(CASE WHEN ai_correct=1 AND human_accept=0 THEN 1 ELSE 0 END) right_override,
    SUM(CASE WHEN (ai_correct=1 AND human_accept=1) OR (ai_correct=0 AND human_accept=0) THEN 1 ELSE 0 END) appropriate
    FROM reviewer_observations WHERE project_id=? GROUP BY ROUND(ai_confidence,2), participant_hash`, [projectId]);
  const rvT = { n: 0, rt: 0, appropriate: 0, wrong_n: 0, wrong_accept: 0, right_n: 0, right_override: 0 }, rvParticipants = new Set(), confMap = new Map();
  for (const g of rvRows) {
    const n = Number(g.n) || 0; rvT.n += n; rvT.rt += Number(g.rt) || 0; rvT.appropriate += Number(g.appropriate) || 0;
    rvT.wrong_n += Number(g.wrong_n) || 0; rvT.wrong_accept += Number(g.acc_w) || 0; rvT.right_n += Number(g.correct_n) || 0; rvT.right_override += Number(g.right_override) || 0;
    rvParticipants.add(g.ph);
    const k = g.confidence, e = confMap.get(k) || { confidence: k, n: 0, rt: 0, correct_n: 0, acc_c: 0, wrong_n: 0, acc_w: 0 };
    e.n += n; e.rt += Number(g.rt) || 0; e.correct_n += Number(g.correct_n) || 0; e.acc_c += Number(g.acc_c) || 0; e.wrong_n += Number(g.wrong_n) || 0; e.acc_w += Number(g.acc_w) || 0; confMap.set(k, e);
  }
  const rvTot = { n: rvT.n, participants: rvParticipants.size, mean_rt: rvT.n ? rvT.rt / rvT.n : null, appropriate: rvT.appropriate, wrong_n: rvT.wrong_n, wrong_accept: rvT.wrong_accept, right_n: rvT.right_n, right_override: rvT.right_override };
  const confRows = [...confMap.values()].sort((a, b) => a.confidence - b.confidence).map(e => ({ ...e, mean_rt: e.n ? e.rt / e.n : null }));
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

  const fdic = await fdicStatus(env, projectId);
  fdic.reverification = await getFdicReverificationRankings(env, projectId, {limit:81});

  const jobs = await all(env.DB, `SELECT type,status,COUNT(*) n FROM jobs WHERE project_id=? GROUP BY type,status ORDER BY type,status`, [projectId]);
  const audit = await one(env.DB, `SELECT COUNT(*) n, MIN(created_at) first_at, MAX(created_at) last_at FROM audit_log WHERE project_id=?`, [projectId]);
  const content = safeJson(def?.content_json, {}), constraints = safeJson(cfg.constraints_json, {}), design = safeJson(cfg.design_json, {});
  return {
    generated_at: nowIso(), app_version: APP_VERSION,
    project: { id: project.id, name: project.name, description: project.description, status: project.status, stage: project.current_stage, created_at: project.created_at, research_cycle:cycle, evidence_revision:rev, revalidation_from:project.revalidation_from, approval_stale:!!project.approval_stale, last_evidence_at:project.last_evidence_at },
    definition: { version: def?.version ?? null, research_question: content.research_question || cfg.research_question || '', content, gate: safeJson(def?.gate_json, {}) },
    constraints, design, measurement: { metrics: safeJson(meas?.metrics_json, {}), quality: safeJson(meas?.quality_json, {}), measured_at: meas?.measured_at || null },
    candidates: { total: cands.length, by_class: byClass, list: cands, dims, cells, estimators, finalists },
    selected: selected ? { ...selected, by_phase: selectedByPhase, inference:selectedInference } : null,
    approval: appr ? { decision: appr.decision, evidence_level: appr.evidence_level, automatic: !!appr.automatic, created_at: appr.created_at, basis: safeJson(appr.basis_json, {}) } : null,
    simulation: { phases, scenarios, validations }, reviewer, empirical: { readiness: empirical.status, complete_rows: empirical.complete_rows, target_rows: empirical.target_rows, profile: cal.profile?.version, coefficients: cal.coeff, calibration_uncertainty: cal.local_refit?.uncertainty || null, loss_calibration: cal.loss, parameters: params, panel, fdic },
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
    case 'fdic_links': return q(`SELECT e.episode_name,e.year,l.cert,l.institution_name,l.match_status,l.match_method,l.match_score,l.confirmed_at FROM fdic_episode_links l JOIN empirical_episodes e ON e.id=l.episode_id WHERE l.project_id=? ORDER BY e.year,e.episode_name`, ['episode_name','year','cert','institution_name','match_status','match_method','match_score','confirmed_at']);
    case 'fdic_financials': return q(`SELECT e.episode_name,f.cert,f.repdte,f.asset,f.deposits_total,f.deposits_domestic,f.uninsured_deposits,f.equity,f.fetched_at FROM fdic_financial_observations f JOIN empirical_episodes e ON e.id=f.episode_id WHERE f.project_id=? ORDER BY e.episode_name,f.repdte`, ['episode_name','cert','repdte','asset','deposits_total','deposits_domestic','uninsured_deposits','equity','fetched_at']);
    case 'fdic_sod': return q(`SELECT COALESCE(e.episode_name,'') episode_name,s.cert,s.year,s.branch_num,s.uninumber,s.state,s.county,s.cbsa,s.branch_deposits,s.fetched_at FROM fdic_sod_observations s LEFT JOIN empirical_episodes e ON e.id=s.episode_id WHERE s.project_id=? ORDER BY s.year,s.cert,s.state,s.branch_num`, ['episode_name','cert','year','branch_num','uninumber','state','county','cbsa','branch_deposits','fetched_at']);
    case 'fdic_market_metrics': return q(`SELECT e.episode_name,m.cert,m.year,m.market_type,m.market_key,m.hhi,m.bank_count,m.total_deposits,m.target_bank_share,m.methodology_version,m.quality_json FROM fdic_market_metrics m JOIN empirical_episodes e ON e.id=m.episode_id WHERE m.project_id=? ORDER BY m.year,e.episode_name`, ['episode_name','cert','year','market_type','market_key','hhi','bank_count','total_deposits','target_bank_share','methodology_version','quality_json']);
    case 'fdic_reverification': return q(`SELECT e.episode_name,e.year,r.cert,r.rank_num,r.priority_level,r.discrepancy_score,r.provenance_type,r.original_concentration,r.fdic_hhi,r.concentration_gap,r.concentration_percentile,r.original_peak_outflow,r.fdic_peak_drawdown,r.deposit_gap,r.deposit_percentile,r.financial_points,r.peak_drawdown_date,r.methodology_version,r.reason_json FROM fdic_reverification_rankings r JOIN empirical_episodes e ON e.id=r.episode_id WHERE r.project_id=? ORDER BY COALESCE(r.rank_num,999),e.year,e.episode_name`, ['episode_name','year','cert','rank_num','priority_level','discrepancy_score','provenance_type','original_concentration','fdic_hhi','concentration_gap','concentration_percentile','original_peak_outflow','fdic_peak_drawdown','deposit_gap','deposit_percentile','financial_points','peak_drawdown_date','methodology_version','reason_json']);
    case 'fdic_reverification_reviews': return q(`SELECT e.episode_name,e.year,r.priority_level,v.review_status,v.cause_code,v.cause_note,v.reviewer_name,v.reviewer_note,v.recommended_action,v.checklist_json,v.resolution_json,v.evidence_revision,v.reviewed_at,v.updated_at FROM fdic_reverification_reviews v JOIN empirical_episodes e ON e.id=v.episode_id JOIN fdic_reverification_rankings r ON r.episode_id=v.episode_id AND r.project_id=v.project_id WHERE v.project_id=? ORDER BY COALESCE(r.rank_num,999),e.year,e.episode_name`, ['episode_name','year','priority_level','review_status','cause_code','cause_note','reviewer_name','reviewer_note','recommended_action','checklist_json','resolution_json','evidence_revision','reviewed_at','updated_at']);
    case 'audit_log': return q(`SELECT created_at,actor,action,entity_type,entity_id,detail_json FROM audit_log WHERE project_id=? ORDER BY created_at`, ['created_at', 'actor', 'action', 'entity_type', 'entity_id', 'detail_json']);
    default: return null;
  }
}
export const EXPORT_NAMES = ['candidates', 'simulation_runs', 'validations', 'reviewer_observations', 'episodes', 'fdic_links', 'fdic_financials', 'fdic_sod', 'fdic_market_metrics', 'fdic_reverification', 'fdic_reverification_reviews', 'audit_log'];
