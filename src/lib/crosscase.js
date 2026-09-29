import { all, run, audit } from './db.js';
import { nowIso, uid, safeJson } from './util.js';

async function boundaryBySigma(env,projectId){
  const rows=await all(env.DB,`SELECT c.sigma,c.authority_k,v.status FROM design_candidates c JOIN validations v ON v.candidate_id=c.id WHERE c.project_id=? AND v.validation_type='human_recompute'`,[projectId]);
  const map={}; for(const r of rows){ const s=Number(r.sigma); if(r.status==='CONFIRM') map[s]=Math.max(map[s]??-1,Number(r.authority_k)); }
  return Object.entries(map).map(([sigma,maxK])=>({sigma:Number(sigma),maxK})).sort((a,b)=>a.sigma-b.sigma);
}
function slope(points){ if(points.length<2)return null; const mx=points.reduce((a,x)=>a+x.sigma,0)/points.length, my=points.reduce((a,x)=>a+x.maxK,0)/points.length; const den=points.reduce((a,x)=>a+(x.sigma-mx)**2,0); if(!den)return 0; return points.reduce((a,x)=>a+(x.sigma-mx)*(x.maxK-my),0)/den; }

export async function compareStudy(env,studyId){
  const cases=await all(env.DB,`SELECT sc.*,p.name FROM study_cases sc JOIN projects p ON p.id=sc.project_id WHERE sc.study_id=?`,[studyId]);
  if(cases.length<2) return {status:'HOLD',reason:'need_two_cases'};
  const detail=[]; for(const c of cases){ const b=await boundaryBySigma(env,c.project_id); detail.push({project_id:c.project_id,name:c.name,case_role:c.case_role,boundary:b,slope:slope(b)}); }
  const valid=detail.filter(x=>x.slope!==null); const signs=valid.map(x=>Math.sign(x.slope)); const status=valid.length>=2 && signs.every(s=>s<=0)?'CONFIRM':'REVISE';
  for(const c of cases){ await run(env.DB,`INSERT INTO validations(id,project_id,candidate_id,validation_type,status,result_json,created_at) VALUES(?,?,?,?,?,?,?)`,[uid('val'),c.project_id,null,'cross_case',status,JSON.stringify({study_id:studyId,cases:detail}),nowIso()]); await audit(env,c.project_id,'agent','validate.cross_case','study',studyId,{status,detail}); }
  return {status,cases:detail};
}
