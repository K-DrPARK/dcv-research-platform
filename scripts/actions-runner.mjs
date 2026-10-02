import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createD1Rest} from './lib/d1-rest.mjs';
import {acquireRunner,heartbeatRunner,releaseRunner} from './lib/actions-runtime.mjs';
import {scheduleAll,processJobs} from '../src/lib/orchestrator.js';
import {scheduleLab} from '../src/lib/lab.js';
export async function runActions(env,{seconds=90,maxJobs=20,maxCalls=250}={}){
 const token=await acquireRunner(env);if(!token)return {status:'runner_already_active',jobs:0};
 const started=Date.now();let completed=0,failures=0;
 try{
  // Set-level scheduling; one claimed job at a time. The same immutable protocol/seed engine runs here.
  await heartbeatRunner(env,token);
  const initial=await scheduleAll(env);
  const first=Array.isArray(initial)?initial:[];
  completed+=first.length;failures+=first.filter(r=>!r.ok).length;
  while(Date.now()-started<seconds*1000&&completed<maxJobs&&env.DB.calls<maxCalls-80){
   await heartbeatRunner(env,token);
   const results=await processJobs(env);if(!results.length)break;
   completed+=results.length;failures+=results.filter(r=>!r.ok).length;
  }
  if(env.AI&&Date.now()-started<(seconds-50)*1000&&env.DB.calls<maxCalls-100){await heartbeatRunner(env,token);const lab=await scheduleLab(env);if(lab.error)failures++;}
  return {status:failures?'completed_with_job_errors':'completed',jobs:completed,failures,d1_api_calls:env.DB.calls,elapsed_seconds:Math.round((Date.now()-started)/1000)};
 }finally{await releaseRunner(env,token,completed-failures);}
}
async function main(){
 const cfg=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 const {CF_ACCOUNT_ID,CF_D1_DATABASE_ID,CF_D1_API_TOKEN,CF_AI_API_TOKEN}=process.env;
 if(CF_D1_DATABASE_ID!==cfg.d1_databases[0].database_id)throw new Error('Database ID does not match the platform storage binding');
 const DB=createD1Rest({accountId:CF_ACCOUNT_ID,databaseId:CF_D1_DATABASE_ID,token:CF_D1_API_TOKEN});
 const env={...cfg.vars,DB,COMPUTE_EXECUTOR:'github-actions',EXTERNAL_RUNTIME:'github-actions',MAX_JOBS_PER_TICK:'1',RUNNER_CODE_REVISION:process.env.GITHUB_SHA||'local',ECOS_API_KEY:process.env.ECOS_API_KEY,OPENFISCAL_API_KEY:process.env.OPENFISCAL_API_KEY,BOJO_API_KEY:process.env.BOJO_API_KEY,FDIC_API_KEY:process.env.FDIC_API_KEY};
 if(CF_AI_API_TOKEN)env.AI={run:async(model,input)=>{
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`,{method:'POST',headers:{authorization:`Bearer ${CF_AI_API_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(55000)});
  const j=await r.json();if(!r.ok||j.success===false)throw new Error(`Workers AI REST failed (${r.status})`);return j.result;
 }};
 const result=await runActions(env);console.log(JSON.stringify(result));if(result.failures)process.exitCode=1;
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Actions runner failed. Check credentials, migration 0021, and persisted job errors; sensitive response bodies are not logged.');process.exitCode=1;});
