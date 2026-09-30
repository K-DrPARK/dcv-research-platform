import { claimJobs, finishJob, enqueue, all, one, run, audit } from './db.js';
import { defineProject } from './define.js';
import { collectProject } from './collectors.js';
import { measureProject } from './measure.js';
import { seedCandidates, computeCandidate, enqueueRobustValidation } from './compute.js';
import { validateProject } from './validate.js';
import { fitReviewerModel } from './reviewer.js';
import { enqueueRecompute, finalizeRecompute } from './recompute.js';
import { approveProject } from './approve.js';
import { generateReport } from './report.js';
import { compareStudy } from './crosscase.js';
import { refitEmpiricalCalibration } from './empirical.js';

async function jobExists(env,projectId,type,phase=null){
  const rows=await all(env.DB,`SELECT payload_json,status FROM jobs WHERE project_id=? AND type=? AND status IN ('queued','running')`,[projectId,type]);
  if(!phase) return rows.length>0;
  return rows.some(r=>{try{return JSON.parse(r.payload_json||'{}').phase===phase}catch{return false}});
}

async function setStage(env,id,stage){ await run(env.DB,`UPDATE projects SET current_stage=?,updated_at=datetime('now') WHERE id=?`,[stage,id]); }

export async function advanceProject(env,projectId){
  const p=await one(env.DB,`SELECT * FROM projects WHERE id=?`,[projectId]);
  if(!p||!p.auto_run) return {status:'disabled'};

  const cand=await one(env.DB,`SELECT COUNT(*) total,SUM(CASE WHEN status='confirmed_feasible' THEN 1 ELSE 0 END) feasible,SUM(CASE WHEN status IN ('pending','unresolved','provisionally_feasible') THEN 1 ELSE 0 END) active FROM design_candidates WHERE project_id=?`,[projectId]);
  const total=Number(cand?.total||0), feasible=Number(cand?.feasible||0), active=Number(cand?.active||0);
  if(!total){
    const inFlight=await one(env.DB,`SELECT COUNT(*) n FROM jobs WHERE project_id=? AND type IN ('define_project','collect_project','refit_empirical','measure_project','seed_candidates') AND status IN ('queued','running')`,[projectId]);
    if(Number(inFlight?.n||0)>0){ await setStage(env,projectId,'measure'); return {stage:'waiting',reason:'setup_jobs_in_flight'}; }
    const doneDefine=await one(env.DB,`SELECT COUNT(*) n FROM jobs WHERE project_id=? AND type='define_project' AND status='done'`,[projectId]);
    if(Number(doneDefine?.n||0)>0){ await enqueue(env,projectId,'measure_project',{},30); await setStage(env,projectId,'measure'); return {stage:'measure',resumed:true}; }
    if(!(await jobExists(env,projectId,'define_project'))) await enqueue(env,projectId,'define_project',{},10);
    await setStage(env,projectId,'define');
    return {stage:'define'};
  }

  const unfinished=await one(env.DB,`SELECT COUNT(*) n FROM jobs WHERE project_id=? AND type='compute_candidate' AND status IN ('queued','running') AND (json_extract(payload_json,'$.phase') IN ('exploration','refinement','confirmation'))`,[projectId]);
  if(Number(unfinished?.n||0)>0 || active>0){
    await setStage(env,projectId,'compute');
    return {stage:'cdrs_boundary_search',active,queued:Number(unfinished?.n||0),total};
  }
  if(feasible===0){ await setStage(env,projectId,'compute'); return {stage:'hold',reason:'no_statistically_confirmed_feasible_candidates'}; }

  const hist=await one(env.DB,`SELECT COUNT(DISTINCT candidate_id) n FROM simulation_runs WHERE project_id=? AND phase='historical'`,[projectId]);
  const stress=await one(env.DB,`SELECT COUNT(DISTINCT candidate_id) n FROM simulation_runs WHERE project_id=? AND phase='stress'`,[projectId]);
  if(Number(hist?.n||0)<feasible || Number(stress?.n||0)<feasible){
    if(!(await jobExists(env,projectId,'compute_candidate','historical')) && !(await jobExists(env,projectId,'compute_candidate','stress'))) await enqueueRobustValidation(env,projectId);
    await setStage(env,projectId,'validate');
    return {stage:'robust'};
  }

  const val=await one(env.DB,`SELECT COUNT(*) n FROM validations WHERE project_id=? AND validation_type='robust'`,[projectId]);
  if(Number(val?.n||0)<total){
    if(!(await jobExists(env,projectId,'validate_project'))) await enqueue(env,projectId,'validate_project',{},55);
    await setStage(env,projectId,'validate');
    return {stage:'validate'};
  }

  const reviewer=await one(env.DB,`SELECT id FROM reviewer_models WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
  if(!reviewer){
    if(!(await jobExists(env,projectId,'fit_reviewer'))) await enqueue(env,projectId,'fit_reviewer',{},60);
    await setStage(env,projectId,'validate');
    return {stage:'human_review'};
  }

  const rr=await one(env.DB,`SELECT COUNT(DISTINCT candidate_id) n FROM simulation_runs WHERE project_id=? AND phase='recompute'`,[projectId]);
  const robustConfirmed=await one(env.DB,`SELECT COUNT(DISTINCT candidate_id) n FROM validations WHERE project_id=? AND validation_type='robust' AND status='CONFIRM'`,[projectId]);
  if(Number(rr?.n||0)<Number(robustConfirmed?.n||0)){
    if(!(await jobExists(env,projectId,'recompute_project'))) await enqueue(env,projectId,'recompute_project',{},65);
    await setStage(env,projectId,'recompute');
    return {stage:'recompute'};
  }

  const hv=await one(env.DB,`SELECT COUNT(*) n FROM validations WHERE project_id=? AND validation_type='human_recompute'`,[projectId]);
  if(Number(hv?.n||0)<Number(robustConfirmed?.n||0)){
    if(!(await jobExists(env,projectId,'finalize_recompute'))) await enqueue(env,projectId,'finalize_recompute',{},80);
    await setStage(env,projectId,'recompute');
    return {stage:'recompute_finalize'};
  }

  const approval=await one(env.DB,`SELECT id FROM approvals WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]);
  if(!approval){
    if(!(await jobExists(env,projectId,'approve_project'))) await enqueue(env,projectId,'approve_project',{},90);
    await setStage(env,projectId,'approved');
    return {stage:'approve'};
  }

  const report=await one(env.DB,`SELECT id FROM reports WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]);
  if(!report){
    if(!(await jobExists(env,projectId,'generate_report'))) await enqueue(env,projectId,'generate_report',{},95);
    await setStage(env,projectId,'report');
    return {stage:'report'};
  }
  return {stage:'complete'};
}

async function execute(env,job){
  const payload=JSON.parse(job.payload_json||'{}'); const id=job.project_id;
  switch(job.type){
    case 'define_project': { const r=await defineProject(env,id); if(r.status==='CONFIRM') await enqueue(env,id,'collect_project',{},20); return r; }
    case 'collect_project': { const r=await collectProject(env,id); if(Number(r.empiricalRows||0)>0) await enqueue(env,id,'refit_empirical',{},22); await enqueue(env,id,'measure_project',{},30); return r; }
    case 'measure_project': { const r=await measureProject(env,id); await enqueue(env,id,'seed_candidates',{},35); return r; }
    case 'seed_candidates': return seedCandidates(env,id);
    case 'refit_empirical': { const r=await refitEmpiricalCalibration(env,id,{promote:true}); await enqueue(env,id,'advance_project',{},98,5); return r; }
    case 'compute_candidate': { const r=await computeCandidate(env,id,payload.candidate_id,payload.phase,payload.cycle||0); await enqueue(env,id,'advance_project',{},98,5); return r; }
    case 'advance_project': return advanceProject(env,id);
    case 'validate_project': { const r=await validateProject(env,id); await enqueue(env,id,'advance_project',{},98,5); return r; }
    case 'fit_reviewer': { const r=await fitReviewerModel(env,id); if(r.status==='HOLD') await enqueue(env,id,'advance_project',{},98,900); return r; }
    case 'recompute_project': return enqueueRecompute(env,id);
    case 'finalize_recompute': { const r=await finalizeRecompute(env,id); await enqueue(env,id,'advance_project',{},98,5); return r; }
    case 'approve_project': return approveProject(env,id);
    case 'generate_report': return generateReport(env,id);
    case 'compare_study': return compareStudy(env,payload.study_id);
    default: throw new Error(`unknown_job:${job.type}`);
  }
}

export async function processJobs(env){
  const jobs=await claimJobs(env,Number(env.MAX_JOBS_PER_TICK||4)); const results=[];
  for(const job of jobs){ try{ const out=await execute(env,job); await finishJob(env,job); results.push({id:job.id,type:job.type,ok:true,out}); } catch(e){ await finishJob(env,job,e); results.push({id:job.id,type:job.type,ok:false,error:String(e)}); } }
  return results;
}

export async function scheduleAll(env){
  const ps=await all(env.DB,`SELECT id FROM projects WHERE auto_run=1`);
  for(const p of ps){
    if(!(await jobExists(env,p.id,'advance_project'))) await enqueue(env,p.id,'advance_project',{},99);
    const due=await one(env.DB,`SELECT COUNT(*) n FROM data_sources WHERE project_id=? AND enabled=1 AND (last_fetched_at IS NULL OR datetime(last_fetched_at, '+' || cadence_minutes || ' minutes') <= datetime('now'))`,[p.id]);
    if(Number(due?.n||0)>0 && !(await jobExists(env,p.id,'collect_project'))) await enqueue(env,p.id,'collect_project',{refresh:true},25);
  }
  return env.CDRS_QUEUE ? {scheduled:ps.length,transport:'cloudflare-queue'} : processJobs(env);
}
