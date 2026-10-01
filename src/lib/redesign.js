import {one,all,run,audit} from './db.js';
import {safeJson,nowIso} from './util.js';
import {registerEvidence} from './evidence.js';
import {bust} from './memo.js';

export function parseRedesignCsv(csv){
 if(typeof csv!=='string'||new TextEncoder().encode(csv).length>150000)throw new Error('CSV must be at most 150KB');
 const lines=String(csv).replace(/^\uFEFF/,'').trim().split(/\r?\n/),head=lines.shift().split(',');
 if(lines.length!==208)throw new Error('Expected the supplied 208-row paired design');
 const rows=lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[head[i],v.trim()])));
 const bases=new Map(),keys=new Set(),numbers=new Set();
 for(const r of rows){
  if(/^anchor_K[01]$/.test(r.role))r.role='anchor';
  for(const k of ['cand_no','K','sigma','alpha','tau','d','W','m']){r[k]=Number(r[k]);if(!Number.isFinite(r[k]))throw new Error('Invalid numeric field: '+k);}
  if(!['ema','kalman','changepoint','adaptive'].includes(r.estimator)||!['paired_core','anchor'].includes(r.role)||!r.base_id)throw new Error('Invalid estimator, role or base');
  if(![0,1,2].includes(r.tau)||![0,1,2,4].includes(r.d)||!(r.sigma>0&&r.sigma<=1)||!(r.alpha>0&&r.alpha<1)||!(r.W>=0&&r.W<=1)||!(r.m>=0&&r.m<=1))throw new Error('Candidate outside declared design levels');
  if(!Number.isInteger(r.cand_no)||r.cand_no<1||r.cand_no>208||numbers.has(r.cand_no))throw new Error('Candidate numbers must be unique 1..208');numbers.add(r.cand_no);
  const key=[r.base_id,r.estimator,r.K,r.tau,r.d].join('|');if(keys.has(key))throw new Error('Duplicate paired cell');keys.add(key);
  if(r.role==='paired_core'){
   if(![2,3].includes(r.K))throw new Error('Core authority must be K2/K3');
   const signature=[r.estimator,r.K,r.sigma,r.alpha,r.W,r.m].join('|');
   const b=bases.get(r.base_id)||{signature,n:0};if(b.signature!==signature)throw new Error('Base covariates change within delay pairs');b.n++;bases.set(r.base_id,b);
  }else if(![0,1].includes(r.K))throw new Error('Anchor authority must be K0/K1');
 }
 if(bases.size!==16||[...bases.values()].some(b=>b.n!==12)||rows.filter(r=>r.role==='anchor').length!==16)throw new Error('Expected 16 complete 12-cell bases and 16 anchors');
 return rows;
}
export async function applyRedesign(env,projectId,input){
 const rows=parseRedesignCsv(input.csv),p=await one(env.DB,'SELECT * FROM project_config WHERE project_id=?',[projectId]);if(!p)throw new Error('project_not_found');
 const pending=await one(env.DB,"SELECT 1 x FROM jobs WHERE project_id=? AND status='running' LIMIT 1",[projectId]);if(pending)throw new Error('Wait until the running project job finishes before redesign');
 const benchmark={...safeJson(p.benchmark_json),confidence_method:'residual_common_v1',k2_confidence:.84,k3_confidence:.67};
 delete benchmark.noninferiority;
 // Margins are chosen before execution; never select them to manufacture a boundary.
 if(input.noninferiority){const n=input.noninferiority;if(!Number.isFinite(n.loss_relative_margin)||n.loss_relative_margin<0||n.loss_relative_margin>1||!Number.isFinite(n.fn_absolute_margin)||n.fn_absolute_margin<0||n.fn_absolute_margin>1||!Number.isFinite(n.fp_absolute_margin)||n.fp_absolute_margin<0||n.fp_absolute_margin>1)throw new Error('Declare valid non-inferiority margins before execution');benchmark.noninferiority=n;}
 const design={...safeJson(p.design_json),candidate_rows:rows,max_candidates:208,grid_source:'preregistered_csv',estimators:['ema','kalman','changepoint','adaptive']};
 const validation={...safeJson(p.validation_json),min_human_participants:30,min_human_correct_trials:60,min_human_wrong_trials:60,max_trials_per_participant:30,cluster_bootstrap_n:300,human_protocol:'calibrated-task-v2'};
 // Archive existing results and open a new evidence cycle before changing definitions.
 const ev=await registerEvidence(env,projectId,{kind:'DESIGN_CHANGE',force_new_cycle:true,source:'paired_redesign_csv',config_update:{design,benchmark,validation},detail:{rows:208,core:192,anchors:16,noninferiority:benchmark.noninferiority||null}});

 bust(env,projectId);await audit(env,projectId,'user','research.redesign','project',projectId,{rows:208,...ev});return {rows:208,...ev};
}
