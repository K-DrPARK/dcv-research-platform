import { claimJobs, finishJob, enqueue, enqueueOnce, pruneJobs, all, one, run, audit } from './db.js';
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
import { refitEmpiricalCalibration, seedBundledEmpiricalPanel } from './empirical.js';

// phase 컬럼(마이그레이션 0007)과 (project_id,type,status,phase) 인덱스로 존재 여부만 확인한다.
// 이전: 해당 프로젝트의 queued/running 행을 전부 읽어 JS 에서 payload_json 을 파싱.
async function jobExists(env,projectId,type,phase=null){
  const r=phase
    ? await one(env.DB,`SELECT 1 x FROM jobs WHERE project_id=? AND type=? AND status IN ('queued','running') AND phase=? LIMIT 1`,[projectId,type,phase])
    : await one(env.DB,`SELECT 1 x FROM jobs WHERE project_id=? AND type=? AND status IN ('queued','running') LIMIT 1`,[projectId,type]);
  return !!r;
}

// 모든 자동 단계를 마친 프로젝트 상태. 이 상태에서는 Cron 이 15분마다 advance 를 돌려도 읽을 것이 없다.
const TERMINAL_STATUSES = new Set(['complete','report_ready']);

async function setStage(env,p,stage){
  if(p.current_stage===stage) return;   // 같은 값이면 쓰기 생략
  p.current_stage=stage;
  await run(env.DB,`UPDATE projects SET current_stage=?,updated_at=datetime('now') WHERE id=?`,[stage,p.id]);
}

export async function advanceProject(env,projectId){
  const p=await one(env.DB,`SELECT * FROM projects WHERE id=?`,[projectId]);
  if(!p||!p.auto_run) return {status:'disabled'};
  // 보고서까지 끝난 프로젝트: 이후 단계 점검 쿼리(전체 스캔 포함)를 전부 생략
  if(TERMINAL_STATUSES.has(p.status)) return {stage:'complete'};

  // 인간 검토자 표본을 기다리는 중(마지막 fit_reviewer 가 HOLD 였고 그 뒤 새 관측이 없음)이면,
  // 앞 단계(후보/시뮬레이션/검증) 점검을 반복할 필요가 없다. 마커는 모든 앞 단계가 끝난 뒤에만 기록된다.
  if(p.reviewer_hold_marker!==null && p.reviewer_hold_marker!==undefined){
    const model=await one(env.DB,`SELECT 1 x FROM reviewer_models WHERE project_id=? LIMIT 1`,[projectId]);
    if(!model){
      const latest=await one(env.DB,`SELECT created_at FROM reviewer_observations WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]);
      if((latest?.created_at??'')===p.reviewer_hold_marker) return {stage:'human_review',waiting:'no_new_reviewer_observations'};
    }
  }

  const cand=await one(env.DB,`SELECT COUNT(*) total,SUM(CASE WHEN status='confirmed_feasible' THEN 1 ELSE 0 END) feasible,SUM(CASE WHEN status IN ('pending','unresolved','provisionally_feasible') THEN 1 ELSE 0 END) active FROM design_candidates WHERE project_id=?`,[projectId]);
  const total=Number(cand?.total||0), feasible=Number(cand?.feasible||0), active=Number(cand?.active||0);
  if(!total){
    const inFlight=await one(env.DB,`SELECT COUNT(*) n FROM jobs WHERE project_id=? AND type IN ('seed_empirical_panel','define_project','collect_project','refit_empirical','measure_project','seed_candidates') AND status IN ('queued','running')`,[projectId]);
    if(Number(inFlight?.n||0)>0){ await setStage(env,p,'measure'); return {stage:'waiting',reason:'setup_jobs_in_flight'}; }
    const doneDefine=await one(env.DB,`SELECT 1 x FROM jobs WHERE project_id=? AND type='define_project' AND status='done' LIMIT 1`,[projectId]);
    if(doneDefine){ await enqueue(env,projectId,'measure_project',{},30); await setStage(env,p,'measure'); return {stage:'measure',resumed:true}; }
    if(!(await jobExists(env,projectId,'define_project'))) await enqueue(env,projectId,'define_project',{},10);
    await setStage(env,p,'define');
    return {stage:'define'};
  }

  // active 후보가 남아 있으면 아직 탐색 중이므로 'unfinished' 작업 조회 없이 바로 반환(조회 1회 절약)
  if(active>0){ await setStage(env,p,'compute'); return {stage:'cdrs_boundary_search',active,queued:null,total}; }
  const unfinished=await jobExists(env,projectId,'compute_candidate','exploration')||await jobExists(env,projectId,'compute_candidate','refinement')||await jobExists(env,projectId,'compute_candidate','confirmation');
  if(unfinished){ await setStage(env,p,'compute'); return {stage:'cdrs_boundary_search',active,queued:1,total}; }
  if(feasible===0){ await setStage(env,p,'compute'); return {stage:'hold',reason:'no_statistically_confirmed_feasible_candidates'}; }

  // 이전: simulation_runs 를 phase 별로 3번, validations 를 3번 — 모두 project_id 인덱스가 없어 전체 스캔.
  // 이후: 커버링 인덱스로 GROUP BY 1회씩.
  const runAgg=await all(env.DB,`SELECT phase,COUNT(DISTINCT candidate_id) n FROM simulation_runs WHERE project_id=? AND phase IN ('historical','stress','recompute') GROUP BY phase`,[projectId]);
  const rn=Object.fromEntries(runAgg.map(r=>[r.phase,Number(r.n||0)]));
  if((rn.historical||0)<feasible || (rn.stress||0)<feasible){
    if(!(await jobExists(env,projectId,'compute_candidate','historical')) && !(await jobExists(env,projectId,'compute_candidate','stress'))) await enqueueRobustValidation(env,projectId);
    await setStage(env,p,'validate');
    return {stage:'robust'};
  }

  const valAgg=await all(env.DB,`SELECT validation_type t,status s,COUNT(*) c,COUNT(DISTINCT candidate_id) d FROM validations WHERE project_id=? AND validation_type IN ('robust','human_recompute') GROUP BY validation_type,status`,[projectId]);
  const robustRows=valAgg.filter(v=>v.t==='robust').reduce((a,v)=>a+Number(v.c||0),0);
  const robustConfirmed=Number(valAgg.find(v=>v.t==='robust'&&v.s==='CONFIRM')?.d||0);
  const humanRows=valAgg.filter(v=>v.t==='human_recompute').reduce((a,v)=>a+Number(v.c||0),0);
  if(robustRows<total){
    if(!(await jobExists(env,projectId,'validate_project'))) await enqueue(env,projectId,'validate_project',{},55);
    await setStage(env,p,'validate');
    return {stage:'validate'};
  }

  const reviewer=await one(env.DB,`SELECT id FROM reviewer_models WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
  if(!reviewer){
    // 이전: 표본 게이트(참가자 30명, 정답/오답 각 60건)를 통과할 때까지 fit_reviewer ↔ advance_project 가
    //       (HOLD → 900초 뒤 advance → fit_reviewer ...) 무한 반복하며 매번 reviewer_observations 를 읽었다.
    // 이후: 마지막 HOLD 이후 새 관측이 없으면 대기. 새 관측은 POST /reviewer-observations 가 advance 를 깨운다.
    const latestObs=await one(env.DB,`SELECT created_at FROM reviewer_observations WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]);
    const marker=latestObs?.created_at??'';
    if(p.reviewer_hold_marker!==null && p.reviewer_hold_marker!==undefined && p.reviewer_hold_marker===marker){
      await setStage(env,p,'validate');
      return {stage:'human_review',waiting:'no_new_reviewer_observations'};
    }
    if(!(await jobExists(env,projectId,'fit_reviewer'))) await enqueue(env,projectId,'fit_reviewer',{},60);
    await setStage(env,p,'validate');
    return {stage:'human_review'};
  }

  if((rn.recompute||0)<robustConfirmed){
    if(!(await jobExists(env,projectId,'recompute_project'))) await enqueue(env,projectId,'recompute_project',{},65);
    await setStage(env,p,'recompute');
    return {stage:'recompute'};
  }

  if(humanRows<robustConfirmed){
    if(!(await jobExists(env,projectId,'finalize_recompute'))) await enqueue(env,projectId,'finalize_recompute',{},80);
    await setStage(env,p,'recompute');
    return {stage:'recompute_finalize'};
  }

  const approval=await one(env.DB,`SELECT id FROM approvals WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]);
  if(!approval){
    if(!(await jobExists(env,projectId,'approve_project'))) await enqueue(env,projectId,'approve_project',{},90);
    await setStage(env,p,'approved');
    return {stage:'approve'};
  }

  const report=await one(env.DB,`SELECT id FROM reports WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]);
  if(!report){
    if(!(await jobExists(env,projectId,'generate_report'))) await enqueue(env,projectId,'generate_report',{},95);
    await setStage(env,p,'report');
    return {stage:'report'};
  }
  return {stage:'complete'};
}

async function execute(env,job){
  const payload=JSON.parse(job.payload_json||'{}'); const id=job.project_id;
  switch(job.type){
    case 'seed_empirical_panel': return seedBundledEmpiricalPanel(env,id);
    case 'define_project': { const r=await defineProject(env,id); if(r.status==='CONFIRM') await enqueue(env,id,'collect_project',{},20); return r; }
    case 'collect_project': { const r=await collectProject(env,id); if(Number(r.empiricalRows||0)>0) await enqueue(env,id,'refit_empirical',{},22);
      // 주기 갱신(refresh)에서 새로 들어온 행이 없으면 측정 → 후보 재시드 연쇄를 건너뛴다. 최초 실행은 항상 진행.
      if(!(payload.refresh && Number(r.inserted||0)===0 && Number(r.empiricalRows||0)===0)) await enqueue(env,id,'measure_project',{},30);
      return r; }
    case 'measure_project': { const r=await measureProject(env,id); await enqueue(env,id,'seed_candidates',{},35); return r; }
    case 'seed_candidates': return seedCandidates(env,id);
    case 'refit_empirical': { const r=await refitEmpiricalCalibration(env,id,{promote:true}); await enqueueOnce(env,id,'advance_project',{},98,5); return r; }
    case 'compute_candidate': { const r=await computeCandidate(env,id,payload.candidate_id,payload.phase,payload.cycle||0); await enqueueOnce(env,id,'advance_project',{},98,5); return r; }
    case 'advance_project': return advanceProject(env,id);
    case 'validate_project': { const r=await validateProject(env,id); await enqueueOnce(env,id,'advance_project',{},98,5); return r; }
    case 'fit_reviewer': return fitReviewerModel(env,id);   // HOLD 시 자기 재예약(900초 폴링) 제거: 새 관측이 오면 API 가 advance 를 깨운다
    case 'recompute_project': return enqueueRecompute(env,id);
    case 'finalize_recompute': { const r=await finalizeRecompute(env,id); await enqueueOnce(env,id,'advance_project',{},98,5); return r; }
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
  // 완료된 프로젝트는 대상에서 제외(이전: 모든 auto_run 프로젝트에 15분마다 advance + 데이터소스 집계)
  const ps=await all(env.DB,`SELECT id FROM projects WHERE auto_run=1 AND status NOT IN ('complete','report_ready')`);
  for(const p of ps){
    await enqueueOnce(env,p.id,'advance_project',{},99);
    const due=await one(env.DB,`SELECT 1 x FROM data_sources WHERE project_id=? AND enabled=1 AND (last_fetched_at IS NULL OR datetime(last_fetched_at, '+' || cadence_minutes || ' minutes') <= datetime('now')) LIMIT 1`,[p.id]);
    if(due && !(await jobExists(env,p.id,'collect_project'))) await enqueue(env,p.id,'collect_project',{refresh:true},25);
  }
  // 끝난 job 정리는 하루 4회(UTC 0/6/12/18시 첫 Cron)만 — 전용 인덱스를 두면 매 job 상태 변경마다 쓰기가 늘어난다.
  { const t=new Date(); if(t.getUTCHours()%6===0 && t.getUTCMinutes()<15){ try{ await pruneJobs(env); }catch(_){} } }
  return env.CDRS_QUEUE ? {scheduled:ps.length,transport:'cloudflare-queue'} : processJobs(env);
}
