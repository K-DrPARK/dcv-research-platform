import { json, nowIso, uid, safeJson } from './lib/util.js';
import { requireAdmin } from './lib/auth.js';
import { all, one, run, enqueue, audit } from './lib/db.js';
import { processJobs, scheduleAll, advanceProject } from './lib/orchestrator.js';
import { generateReport } from './lib/report.js';
import { buildThesisData, exportCsv, EXPORT_NAMES } from './lib/thesis.js';
import { aiJson } from './lib/ai.js';
import { empiricalReadiness, ensureEmpiricalProfile, importEmpiricalEpisodes, refitEmpiricalCalibration, loadEmpiricalCalibration } from './lib/empirical.js';

async function bodyJson(request){ try{return await request.json();}catch{return {};} }
function pathParts(url){ return new URL(url).pathname.split('/').filter(Boolean); }

async function api(request,env){
  const url=new URL(request.url), parts=pathParts(request.url), method=request.method.toUpperCase();
  if(url.pathname==='/api/health') return json({ok:true,app:env.APP_NAME||'DCV Research Platform',time:nowIso()});
  const auth=requireAdmin(request,env); if(auth) return auth;

  if(url.pathname==='/api/projects' && method==='GET'){
    const rows=await all(env.DB,`SELECT p.*, (SELECT COUNT(*) FROM design_candidates c WHERE c.project_id=p.id) candidate_count, (SELECT COUNT(*) FROM approvals a WHERE a.project_id=p.id) approval_count FROM projects p ORDER BY created_at DESC`);
    return json({projects:rows});
  }
  if(url.pathname==='/api/projects' && method==='POST'){
    const b=await bodyJson(request), id=uid('project'), now=nowIso();
    const design=b.design||{sigma:[0.03,0.05,0.10],tau:[0,1,2],alpha:[0.15,0.35,0.55,0.75],K:[0,1,2,3],d:[0,1,2,4],W:[0.05,0.12,0.22],m:[0.08,0.15,0.25],estimators:['ema','kalman','changepoint','adaptive'],max_candidates:128};
    const constraints=b.constraints||{loss_max:0.28,loss_exceed_max:0.10,fp_max:0.08,fn_max:0.10,review_burden_max:0.70,recovery_time_max:4.0,confidence:0.95};
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO projects(id,name,description,status,current_stage,auto_run,auto_approve,created_at,updated_at) VALUES(?,?,?,'draft','define',1,1,?,?)`).bind(id,b.name||'DCV 연구 프로젝트',b.description||'',now,now),
      env.DB.prepare(`INSERT INTO project_config(project_id,research_question,design_json,constraints_json,benchmark_json,validation_json) VALUES(?,?,?,?,?,?)`).bind(id,b.research_question||'잡음과 승인 지연 하에서 알고리즘 위임 가능 영역은 어떻게 변화하는가?',JSON.stringify(design),JSON.stringify(constraints),JSON.stringify(b.benchmark||{}),JSON.stringify(b.validation||{}))
    ]);
    await audit(env,id,'user','project.created','project',id,b);
    await enqueue(env,id,'define_project',{},10);
    return json({id,status:'queued'},201);
  }

  if(parts[0]==='api' && parts[1]==='projects' && parts[2]){
    const projectId=parts[2];
    if(parts.length===3 && method==='GET'){
      const p=await one(env.DB,`SELECT * FROM projects WHERE id=?`,[projectId]); if(!p)return json({error:'not_found'},404);
      const def=await one(env.DB,`SELECT status,version,gate_json,content_json,ai_note,created_at FROM definitions WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
      const meas=await one(env.DB,`SELECT metrics_json,quality_json,measured_at FROM measurements WHERE project_id=? ORDER BY measured_at DESC LIMIT 1`,[projectId]);
      const counts=await one(env.DB,`SELECT COUNT(*) total,SUM(CASE WHEN status='confirmed_feasible' THEN 1 ELSE 0 END) feasible,SUM(CASE WHEN status IN ('infeasible','confirmation_failed') THEN 1 ELSE 0 END) infeasible,SUM(CASE WHEN evidence_status='UNRESOLVED' THEN 1 ELSE 0 END) unresolved,AVG(boundary_score) avg_boundary,MIN(max_regret) min_regret FROM design_candidates WHERE project_id=?`,[projectId]);
      const app=await one(env.DB,`SELECT * FROM approvals WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]);
      const reviewer=await one(env.DB,`SELECT model_json,version,created_at FROM reviewer_models WHERE project_id=? ORDER BY version DESC LIMIT 1`,[projectId]);
      const jobs=await all(env.DB,`SELECT type,status,attempts,last_error,created_at,updated_at FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 20`,[projectId]);
      const runs=await one(env.DB,`SELECT COUNT(*) total,SUM(CASE WHEN phase='exploration' THEN 1 ELSE 0 END) exploration,SUM(CASE WHEN phase='refinement' THEN 1 ELSE 0 END) refinement,SUM(CASE WHEN phase='confirmation' THEN 1 ELSE 0 END) confirmation,SUM(CASE WHEN phase IN ('historical','stress') THEN 1 ELSE 0 END) robust FROM simulation_runs WHERE project_id=?`,[projectId]);
      const scenarios=await one(env.DB,`SELECT COUNT(*) total,SUM(CASE WHEN scenario_type='historical' THEN 1 ELSE 0 END) historical,SUM(CASE WHEN scenario_type='adversarial' THEN 1 ELSE 0 END) adversarial FROM scenarios WHERE project_id=?`,[projectId]);
      const human=await one(env.DB,`SELECT COUNT(*) n FROM reviewer_observations WHERE project_id=?`,[projectId]);
      const empirical=await empiricalReadiness(env,projectId);
      return json({project:p,definition:def?{...def,gate:safeJson(def.gate_json,{}),content:safeJson(def.content_json,{}),ai:safeJson(def.ai_note,{})}:null,measurement:meas?{...meas,metrics:safeJson(meas.metrics_json,{}),quality:safeJson(meas.quality_json,{})}:null,candidates:counts,approval:app?{...app,basis:safeJson(app.basis_json,{})}:null,reviewer:reviewer?{...reviewer,model:safeJson(reviewer.model_json,{})}:null,jobs,runs,scenarios,human_reviews:Number(human?.n||0),empirical});
    }
    if(parts[3]==='run' && method==='POST'){ const r=await advanceProject(env,projectId); return json({advance:r,transport:env.CDRS_QUEUE?'cloudflare-queue':'d1-fallback'}); }
    if(parts[3]==='sources' && method==='GET'){ return json({sources:await all(env.DB,`SELECT * FROM data_sources WHERE project_id=? ORDER BY created_at DESC`,[projectId])}); }
    if(parts[3]==='sources' && method==='POST'){
      const b=await bodyJson(request), id=uid('source');
      await run(env.DB,`INSERT INTO data_sources(id,project_id,name,kind,url,method,headers_json,mapping_json,enabled,cadence_minutes,created_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)`,[id,projectId,b.name||'External Source',b.kind||'json',b.url,b.method||'GET',JSON.stringify(b.headers||{}),JSON.stringify(b.mapping||{}),Number(b.cadence_minutes||60),nowIso()]);
      await audit(env,projectId,'user','source.created','data_source',id,b); return json({id},201);
    }
    if(parts[3]==='observations' && method==='POST'){
      const b=await bodyJson(request), rows=Array.isArray(b)?b:(b.rows||[b]), stmts=[];
      for(const r of rows.slice(0,1000)) stmts.push(env.DB.prepare(`INSERT INTO raw_observations(id,project_id,source_id,observed_at,ingested_at,key,value_num,value_text,payload_json,quality_json) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(uid('obs'),projectId,null,r.observed_at||nowIso(),nowIso(),r.key||'signal',Number.isFinite(Number(r.value))?Number(r.value):null,Number.isFinite(Number(r.value))?null:String(r.value??''),JSON.stringify(r),JSON.stringify({manual:true})));
      if(stmts.length) await env.DB.batch(stmts); return json({inserted:stmts.length});
    }
    if(parts[3]==='reviewer-observations' && method==='POST'){
      const b=await bodyJson(request); const id=uid('review');
      await run(env.DB,`INSERT INTO reviewer_observations(id,project_id,participant_hash,ai_confidence,ai_correct,human_accept,response_ms,recovered,recovery_ms,context_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[id,projectId,String(b.participant_hash||'anon'),Number(b.ai_confidence),b.ai_correct?1:0,b.human_accept?1:0,Number(b.response_ms||0),b.recovered?1:0,b.recovery_ms==null?null:Number(b.recovery_ms),JSON.stringify(b.context||{}),nowIso()]);
      await enqueue(env,projectId,'advance_project',{},99); return json({id},201);
    }
    if(parts[3]==='scenarios' && method==='GET'){ return json({scenarios:await all(env.DB,`SELECT * FROM scenarios WHERE project_id=? ORDER BY scenario_type,name`,[projectId])}); }
    if(parts[3]==='scenarios' && method==='POST'){
      const b=await bodyJson(request), rows=Array.isArray(b)?b:(b.rows||[b]), stmts=[];
      for(const r of rows.slice(0,500)) stmts.push(env.DB.prepare(`INSERT INTO scenarios(id,project_id,name,scenario_type,severity,volatility,delay_multiplier,loss_multiplier,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(uid('scenario'),projectId,r.name||'scenario',r.scenario_type||'historical',Number(r.severity||1),Number(r.volatility||1),Number(r.delay_multiplier||1),Number(r.loss_multiplier||1),JSON.stringify(r.metadata||{}),nowIso()));
      if(stmts.length) await env.DB.batch(stmts); return json({inserted:stmts.length},201);
    }
    if(parts[3]==='empirical' && parts.length===4 && method==='GET'){
      const readiness=await empiricalReadiness(env,projectId),cal=await loadEmpiricalCalibration(env,projectId);
      const params=await all(env.DB,`SELECT parameter_key,value_num,low_num,high_num,unit,parameter_role,provenance_type,source_note FROM empirical_parameters WHERE project_id=? ORDER BY parameter_role,parameter_key`,[projectId]);
      return json({readiness,profile:cal.profile,parameters:params,coefficients:cal.coeff,local_refit:cal.local_refit});
    }
    if(parts[3]==='empirical' && parts[4]==='seed' && method==='POST'){
      const profile=await ensureEmpiricalProfile(env,projectId); return json({profile,readiness:await empiricalReadiness(env,projectId)});
    }
    if(parts[3]==='empirical' && parts[4]==='episodes' && method==='POST'){
      const b=await bodyJson(request),rows=Array.isArray(b)?b:(b.rows||[]),result=await importEmpiricalEpisodes(env,projectId,rows); await enqueue(env,projectId,'refit_empirical',{},22); await enqueue(env,projectId,'measure_project',{},30,2); return json(result,201);
    }
    if(parts[3]==='empirical' && parts[4]==='refit' && method==='POST'){
      const b=await bodyJson(request); return json(await refitEmpiricalCalibration(env,projectId,{promote:!!b.promote}));
    }
    if(parts[3]==='candidates' && method==='GET'){
      const rows=await all(env.DB,`SELECT c.*, (SELECT status FROM validations v WHERE v.candidate_id=c.id AND v.validation_type='human_recompute' ORDER BY created_at DESC LIMIT 1) final_status FROM design_candidates c WHERE project_id=? ORDER BY sigma,authority_k,delay_d LIMIT 500`,[projectId]); return json({candidates:rows});
    }
    if(parts[3]==='report' && method==='GET'){
      const r=await one(env.DB,`SELECT * FROM reports WHERE project_id=? ORDER BY created_at DESC LIMIT 1`,[projectId]); return r?json({...r,data:safeJson(r.data_json,{})}):json({error:'report_not_ready'},404);
    }
    if(parts[3]==='report' && method==='POST'){ return json(await generateReport(env,projectId)); }
    if(parts[3]==='thesis' && method==='GET'){ try{ return json(await buildThesisData(env,projectId)); }catch(e){ return json({error:String(e.message||e)},e.message==='project_not_found'?404:500); } }
    if(parts[3]==='export' && parts[4] && method==='GET'){
      const name=parts[4].replace(/\.csv$/,'');
      if(!EXPORT_NAMES.includes(name)) return json({error:'unknown_export',available:EXPORT_NAMES},404);
      const body=await exportCsv(env,projectId,name);
      return new Response(body,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${name}.csv"`}});
    }
    if(parts[3]==='audit' && method==='GET'){ return json({audit:await all(env.DB,`SELECT * FROM audit_log WHERE project_id=? ORDER BY created_at DESC LIMIT 300`,[projectId])}); }
  }

  if(url.pathname==='/api/ai/test' && method==='GET'){
    const r=await aiJson(env,'You are a test assistant.','Say hello in Korean.',{ok:false},{schemaHint:'{"ok":true,"message":"string"}',maxTokens:100});
    return json({binding:!!env.AI,configured_model:env.AI_MODEL||null,result:r});
  }
  if(url.pathname==='/api/jobs/process' && method==='POST') return json({results:await processJobs(env)});
  if(url.pathname==='/api/schedule' && method==='POST') return json({results:await scheduleAll(env)});

  if(url.pathname==='/api/studies' && method==='POST'){
    const b=await bodyJson(request), id=uid('study'); await run(env.DB,`INSERT INTO study_groups(id,name,created_at) VALUES(?,?,?)`,[id,b.name||'DCV Study',nowIso()]); return json({id},201);
  }
  if(parts[0]==='api'&&parts[1]==='studies'&&parts[2]&&parts[3]==='cases'&&method==='POST'){
    const b=await bodyJson(request); await run(env.DB,`INSERT OR REPLACE INTO study_cases(study_id,project_id,case_role) VALUES(?,?,?)`,[parts[2],b.project_id,b.case_role||'replication']); return json({ok:true});
  }
  if(parts[0]==='api'&&parts[1]==='studies'&&parts[2]&&parts[3]==='compare'&&method==='POST'){
    await enqueue(env,null,'compare_study',{study_id:parts[2]},90); return json({status:'queued'});
  }

  return json({error:'not_found'},404);
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')) return api(request,env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller,env,ctx){ ctx.waitUntil(scheduleAll(env)); },
  async queue(batch,env,ctx){
    for(const message of batch.messages){
      try{ await processJobs(env); message.ack(); }
      catch(e){ message.retry(); }
    }
  }
};
