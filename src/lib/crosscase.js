import { all, run, audit } from './db.js';
import { nowIso, uid } from './util.js';

async function boundaryBySigma(env,projectId){
  const rows=await all(env.DB,`SELECT c.sigma,c.authority_k,v.status FROM design_candidates c JOIN validations v ON v.candidate_id=c.id WHERE c.project_id=? AND v.validation_type='human_recompute'`,[projectId]);
  const map={}; for(const r of rows){const s=Number(r.sigma);if(r.status==='CONFIRM')map[s]=Math.max(map[s]??-1,Number(r.authority_k));}
  return Object.entries(map).map(([sigma,maxK])=>({sigma:Number(sigma),maxK})).sort((a,b)=>a.sigma-b.sigma);
}
function slope(points){if(points.length<2)return null;const mx=points.reduce((a,x)=>a+x.sigma,0)/points.length,my=points.reduce((a,x)=>a+x.maxK,0)/points.length,den=points.reduce((a,x)=>a+(x.sigma-mx)**2,0);if(!den)return 0;return points.reduce((a,x)=>a+(x.sigma-mx)*(x.maxK-my),0)/den;}
function spearmanPairs(a,b){
  const mb=new Map(b.map(x=>[x.sigma,x.maxK])),pairs=a.filter(x=>mb.has(x.sigma)).map(x=>[x.maxK,mb.get(x.sigma)]);if(pairs.length<3)return{n:pairs.length,rho:null,mae:null};
  const rank=xs=>xs.map((v,i)=>({v,i})).sort((x,y)=>x.v-y.v).reduce((r,x,j)=>(r[x.i]=j+1,r),[]),ra=rank(pairs.map(x=>x[0])),rb=rank(pairs.map(x=>x[1])),ma=ra.reduce((x,y)=>x+y,0)/ra.length,mbb=rb.reduce((x,y)=>x+y,0)/rb.length;
  const num=ra.reduce((s,x,i)=>s+(x-ma)*(rb[i]-mbb),0),da=Math.sqrt(ra.reduce((s,x)=>s+(x-ma)**2,0)),db=Math.sqrt(rb.reduce((s,x)=>s+(x-mbb)**2,0));
  return{n:pairs.length,rho:da&&db?num/(da*db):1,mae:pairs.reduce((s,x)=>s+Math.abs(x[0]-x[1]),0)/pairs.length};
}

export async function compareStudy(env,studyId){
  const cases=await all(env.DB,`SELECT sc.*,p.name FROM study_cases sc JOIN projects p ON p.id=sc.project_id WHERE sc.study_id=?`,[studyId]);
  if(cases.length<2)return{status:'HOLD',reason:'need_two_cases'};
  const detail=[];for(const c of cases){const b=await boundaryBySigma(env,c.project_id);detail.push({project_id:c.project_id,name:c.name,case_role:c.case_role,boundary:b,slope:slope(b)});}
  const base=detail[0],comparisons=[];for(const x of detail.slice(1)){const p=spearmanPairs(base.boundary,x.boundary);comparisons.push({a:base.project_id,b:x.project_id,...p,slope_sign_consistent:(base.slope??1)<=0&&(x.slope??1)<=0,pass:p.n>=3&&p.rho>=.50&&p.mae<=1&&(base.slope??1)<=0&&(x.slope??1)<=0});}
  const status=comparisons.length&&comparisons.every(x=>x.pass)?'CONFIRM':'REVISE';
  const result={status,cases:detail,comparisons,criteria:{shared_sigma_min:3,spearman_rho_min:.50,mean_absolute_K_difference_max:1,nonpositive_boundary_slope:true}};
  for(const c of cases){await run(env.DB,`INSERT INTO validations(id,project_id,candidate_id,validation_type,status,result_json,created_at) VALUES(?,?,?,?,?,?,?)`,[uid('val'),c.project_id,null,'cross_case',status,JSON.stringify({study_id:studyId,...result}),nowIso()]);await audit(env,c.project_id,'agent','validate.cross_case','study',studyId,result);}
  return result;
}

export const __test={spearmanPairs,slope};
