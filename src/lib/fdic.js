import { all, one, run, audit } from './db.js';
import { nowIso, uid } from './util.js';

const BASE='https://api.fdic.gov/banks';
const PAGE_LIMIT=10000;

export function normalizeBankName(s=''){
  return String(s).toLowerCase()
    .replace(/[_/.-]+/g,' ')
    .replace(/\b(stress|mm|wm|bk|fsb|na|n a|national association|national bank|bank|bancorp|financial|savings|association|corp|corporation|company|co|plc|ag|sa)\b/g,' ')
    .replace(/[^a-z0-9 ]+/g,' ')
    .replace(/\s+/g,' ').trim();
}

function tokens(s){ return new Set(normalizeBankName(s).split(' ').filter(x=>x.length>1)); }
export function bankNameScore(a,b){
  const A=tokens(a),B=tokens(b); if(!A.size||!B.size)return 0;
  const inter=[...A].filter(x=>B.has(x)).length, union=new Set([...A,...B]).size;
  const jac=inter/union;
  const na=normalizeBankName(a),nb=normalizeBankName(b);
  const contain=(na.includes(nb)||nb.includes(na))?1:0;
  return Math.min(1,0.78*jac+0.22*contain);
}

export function computeHhi(bankDeposits){
  const vals=Object.values(bankDeposits||{}).map(Number).filter(x=>Number.isFinite(x)&&x>0);
  const total=vals.reduce((a,b)=>a+b,0); if(!total)return {hhi:null,total:0,bank_count:0};
  return {hhi:vals.reduce((a,v)=>a+(v/total)**2,0),total,bank_count:vals.length};
}

export function summarizeFinancialRows(rows=[]){
  const xs=rows.map(unwrap).map(r=>({
    repdte:String(pick(r,['REPDTE','repdte','REPORT_DATE','date'])||''),
    deposits:toNum(pick(r,['DEPDOM','DEP','DEPOSITS','depdom','dep'])),
    asset:toNum(pick(r,['ASSET','asset'])),
    raw:r
  })).filter(x=>x.repdte).sort((a,b)=>a.repdte.localeCompare(b.repdte));
  const ds=xs.filter(x=>Number.isFinite(x.deposits)&&x.deposits>0);
  if(ds.length<2)return {quarters:xs.length,deposit_points:ds.length,deposit_change:null,deposit_outflow_proxy:null,peak_drawdown:null,peak_date:null,first:null,last:null};
  const first=ds[0],last=ds[ds.length-1];
  let runningPeak=ds[0].deposits,peakDrawdown=0,peakDate=ds[0].repdte;
  for(const x of ds){
    if(x.deposits>runningPeak)runningPeak=x.deposits;
    const dd=runningPeak>0?(runningPeak-x.deposits)/runningPeak:0;
    if(dd>peakDrawdown){peakDrawdown=dd;peakDate=x.repdte;}
  }
  const depositChange=first.deposits>0?last.deposits/first.deposits-1:null;
  return {quarters:xs.length,deposit_points:ds.length,deposit_change:depositChange,deposit_outflow_proxy:Math.max(0,-depositChange),peak_drawdown:peakDrawdown,peak_date:peakDate,first:{repdte:first.repdte,deposits:first.deposits},last:{repdte:last.repdte,deposits:last.deposits}};
}

function toNum(v){ if(v===null||v===undefined||v==='')return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function pick(o,keys){ for(const k of keys) if(o?.[k]!==undefined&&o?.[k]!==null&&o?.[k]!=='')return o[k]; return null; }
function unwrap(r){ return r?.data && typeof r.data==='object' ? r.data : r; }
function qDate(y,m,d){ return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function rowKey(r){
  const x=unwrap(r); return [pick(x,['YEAR','year']),pick(x,['CERT','cert']),pick(x,['UNINUMBR','uninumber']),pick(x,['BRNUM','brnum']),pick(x,['STALPBR','state'])].join('|');
}

function headers(env){
  const h={accept:'application/json'};
  if(env.FDIC_API_KEY) h['X-Api-Key']=env.FDIC_API_KEY;
  return h;
}

async function fdicFetch(env, endpoint, params={}, {maxPages=20}={}){
  let offset=0, out=[], total=null, pages=0;
  do{
    const u=new URL(`${BASE}/${endpoint}`);
    const p={...params,limit:Math.min(PAGE_LIMIT,Number(params.limit||PAGE_LIMIT)),offset,format:'json'};
    for(const [k,v] of Object.entries(p)) if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));
    const resp=await fetch(u.toString(),{headers:headers(env)});
    if(!resp.ok) throw new Error(`FDIC ${endpoint} HTTP ${resp.status}`);
    const j=await resp.json();
    const rows=Array.isArray(j?.data)?j.data:[]; out.push(...rows);
    total=Number(j?.meta?.total ?? j?.metadata?.total ?? j?.meta?.total_count ?? rows.length);
    pages++; offset+=rows.length;
    if(!rows.length||rows.length<Number(p.limit)||out.length>=total)break;
  }while(pages<maxPages);
  return {rows:out,total:Number.isFinite(total)?total:out.length,pages,truncated:Number.isFinite(total)&&out.length<total};
}

export async function resolveFdicLinks(env,projectId,{autoConfirm=true,maxEpisodes=81}={}){
  // One Failure endpoint fetch resolves many failed US episodes without 81 network calls.
  const eps=await all(env.DB,`SELECT e.* FROM empirical_episodes e LEFT JOIN fdic_episode_links l ON l.episode_id=e.id AND l.project_id=e.project_id WHERE e.project_id=? AND (l.id IS NULL OR l.match_status!='confirmed') ORDER BY e.year,e.episode_name LIMIT ?`,[projectId,maxEpisodes]);
  if(!eps.length)return {episodes:0,confirmed:0,pending:0,candidates:0};
  const failureResp=await fdicFetch(env,'failures',{limit:10000},{maxPages:2});
  const failures=failureResp.rows.map(unwrap);
  let confirmed=0,pending=0,candidates=0;
  for(const e of eps){
    const scored=failures.map(r=>({r,score:bankNameScore(e.episode_name,pick(r,['NAME','NAMEFULL','name'])||'')})).filter(x=>x.score>=0.48).sort((a,b)=>b.score-a.score).slice(0,5);
    if(!scored.length)continue;
    candidates+=scored.length;
    const best=scored[0], second=scored[1];
    const cert=Number(pick(best.r,['CERT','cert'])); if(!Number.isFinite(cert))continue;
    const strong=best.score>=0.90 && (!second || best.score-second.score>=0.12);
    const status=autoConfirm&&strong?'confirmed':'pending';
    const now=nowIso(),name=String(pick(best.r,['NAME','NAMEFULL','name'])||'');
    await run(env.DB,`INSERT INTO fdic_episode_links(id,project_id,episode_id,cert,institution_name,match_status,match_method,match_score,candidate_json,confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,episode_id) DO UPDATE SET cert=excluded.cert,institution_name=excluded.institution_name,match_status=CASE WHEN fdic_episode_links.match_status='confirmed' THEN 'confirmed' ELSE excluded.match_status END,match_method=excluded.match_method,match_score=excluded.match_score,candidate_json=excluded.candidate_json,confirmed_at=CASE WHEN fdic_episode_links.match_status='confirmed' THEN fdic_episode_links.confirmed_at ELSE excluded.confirmed_at END,updated_at=excluded.updated_at`,[
      uid('fdiclink'),projectId,e.id,cert,name,status,strong?'failure_exact':'failure_fuzzy',best.score,JSON.stringify(scored.map(x=>({cert:pick(x.r,['CERT','cert']),name:pick(x.r,['NAME','NAMEFULL','name']),score:Number(x.score.toFixed(4))}))),status==='confirmed'?now:null,now,now]);
    status==='confirmed'?confirmed++:pending++;
  }
  await audit(env,projectId,'agent','fdic.links.resolved','fdic_link',null,{episodes:eps.length,confirmed,pending,candidates,failure_total:failureResp.total});
  return {episodes:eps.length,confirmed,pending,candidates,failure_total:failureResp.total};
}

export async function confirmFdicLink(env,projectId,{episode_id,episode_name,cert,institution_name='',method='manual'}={}){
  let ep=episode_id?await one(env.DB,`SELECT * FROM empirical_episodes WHERE id=? AND project_id=?`,[episode_id,projectId]):null;
  if(!ep&&episode_name)ep=await one(env.DB,`SELECT * FROM empirical_episodes WHERE project_id=? AND episode_name=? ORDER BY year DESC LIMIT 1`,[projectId,episode_name]);
  if(!ep)throw new Error('episode_not_found'); const c=Number(cert); if(!Number.isFinite(c)||c<=0)throw new Error('invalid_fdic_cert');
  const now=nowIso();
  await run(env.DB,`INSERT INTO fdic_episode_links(id,project_id,episode_id,cert,institution_name,match_status,match_method,match_score,candidate_json,confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,'confirmed',?,1,'{}',?,?,?) ON CONFLICT(project_id,episode_id) DO UPDATE SET cert=excluded.cert,institution_name=excluded.institution_name,match_status='confirmed',match_method=excluded.match_method,match_score=1,confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at`,[uid('fdiclink'),projectId,ep.id,c,institution_name,method,now,now,now]);
  await audit(env,projectId,'user','fdic.link.confirmed','empirical_episode',ep.id,{cert:c,institution_name,method});
  return {episode_id:ep.id,episode_name:ep.episode_name,cert:c,status:'confirmed'};
}

async function collectFinancialForLink(env,projectId,link){
  const y=Number(link.year); if(!Number.isFinite(y)||y<1992)return {inserted:0,skipped:'financials_before_1992'};
  const filters=`CERT:${link.cert} AND REPDTE:[${qDate(y-1,1,1)} TO ${qDate(y,12,31)}]`;
  const r=await fdicFetch(env,'financials',{filters,sort_by:'REPDTE',sort_order:'ASC',limit:1000},{maxPages:4});
  let inserted=0; const now=nowIso();
  for(const row0 of r.rows){ const row=unwrap(row0),rep=String(pick(row,['REPDTE','repdte'])||''); if(!rep)continue;
    const rr=await run(env.DB,`INSERT INTO fdic_financial_observations(id,project_id,episode_id,cert,repdte,asset,deposits_total,deposits_domestic,uninsured_deposits,equity,payload_json,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,cert,repdte) DO UPDATE SET episode_id=excluded.episode_id,asset=excluded.asset,deposits_total=excluded.deposits_total,deposits_domestic=excluded.deposits_domestic,uninsured_deposits=excluded.uninsured_deposits,equity=excluded.equity,payload_json=excluded.payload_json,fetched_at=excluded.fetched_at WHERE fdic_financial_observations.payload_json<>excluded.payload_json`,[
      uid('fdicfin'),projectId,link.episode_id,link.cert,rep,toNum(pick(row,['ASSET','asset'])),toNum(pick(row,['DEP','DEPOSITS','dep'])),toNum(pick(row,['DEPDOM','depdom'])),toNum(pick(row,['DEPUNINS','UNINSDEP','depunins'])),toNum(pick(row,['EQ','EQV','EQTOT','equity'])),JSON.stringify(row),now]);
    inserted+=Number(rr.meta?.changes||0)>0?1:0;
  }
  const summary=summarizeFinancialRows(r.rows);
  return {inserted,rows:r.rows.length,total:r.total,truncated:r.truncated,summary};
}

async function collectSodForLink(env,projectId,link,{marketHhi=true}={}){
  const y=Number(link.year); if(!Number.isFinite(y)||y<1994)return {inserted:0,skipped:'sod_before_1994'};
  const target=await fdicFetch(env,'sod',{filters:`CERT:${link.cert} AND YEAR:${y}`,limit:10000},{maxPages:4});
  const now=nowIso(); let inserted=0;
  const targetRows=target.rows.map(unwrap);
  const stateTotals={};
  for(const row of targetRows){
    const dep=toNum(pick(row,['DEPSUMBR','DEPOSITS','dep'])); const state=String(pick(row,['STALPBR','STALP','state'])||'').toUpperCase(); if(state&&Number.isFinite(dep))stateTotals[state]=(stateTotals[state]||0)+dep;
    const key=rowKey(row)||`${y}|${link.cert}|${uid('row')}`;
    const rr=await run(env.DB,`INSERT INTO fdic_sod_observations(id,project_id,episode_id,cert,year,branch_num,uninumber,state,county,cbsa,branch_deposits,payload_json,fetched_at,row_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,row_key) DO UPDATE SET episode_id=excluded.episode_id,branch_deposits=excluded.branch_deposits,payload_json=excluded.payload_json,fetched_at=excluded.fetched_at WHERE fdic_sod_observations.payload_json<>excluded.payload_json`,[
      uid('fdicsod'),projectId,link.episode_id,link.cert,y,String(pick(row,['BRNUM','brnum'])||''),String(pick(row,['UNINUMBR','uninumber'])||''),state,String(pick(row,['CNTYNAMB','COUNTY','county'])||''),String(pick(row,['CBSA','MSA_NO','cbsa'])||''),dep,JSON.stringify(row),now,key]);
    inserted+=Number(rr.meta?.changes||0)>0?1:0;
  }
  const primaryState=Object.entries(stateTotals).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  let metric=null;
  if(marketHhi&&primaryState){
    const market=await fdicFetch(env,'sod',{filters:`STALPBR:${primaryState} AND YEAR:${y}`,limit:10000},{maxPages:12});
    const byBank={};
    for(const row0 of market.rows){ const row=unwrap(row0),cert=String(pick(row,['CERT','cert'])||''),dep=toNum(pick(row,['DEPSUMBR','DEPOSITS','dep'])); if(cert&&Number.isFinite(dep)&&dep>0)byBank[cert]=(byBank[cert]||0)+dep; }
    const h=computeHhi(byBank),targetDep=Number(byBank[String(link.cert)]||0),share=h.total?targetDep/h.total:null;
    const quality={source:'FDIC Summary of Deposits',scope:'state',state:primaryState,market_rows:market.rows.length,truncated:market.truncated,as_reported:true,interpretation:'verification_covariate_not_automatic_replacement_for_thesis_C'};
    const existing=await one(env.DB,`SELECT id FROM fdic_market_metrics WHERE project_id=? AND episode_id=? AND year=? AND market_type='state' AND market_key=?`,[projectId,link.episode_id,y,primaryState]);
    const id=existing?.id||uid('fdicmetric');
    await run(env.DB,`INSERT INTO fdic_market_metrics(id,project_id,episode_id,cert,year,market_type,market_key,hhi,bank_count,total_deposits,target_bank_share,methodology_version,quality_json,created_at,updated_at) VALUES(?,?,?,?,?,'state',?,?,?,?,?,'FDIC-SOD-STATE-HHI-v1',?,?,?) ON CONFLICT(project_id,episode_id,year,market_type,market_key) DO UPDATE SET hhi=excluded.hhi,bank_count=excluded.bank_count,total_deposits=excluded.total_deposits,target_bank_share=excluded.target_bank_share,quality_json=excluded.quality_json,updated_at=excluded.updated_at`,[id,projectId,link.episode_id,link.cert,y,primaryState,h.hhi,h.bank_count,h.total,share,JSON.stringify(quality),now,now]);
    metric={state:primaryState,hhi:h.hhi,bank_count:h.bank_count,total_deposits:h.total,target_bank_share:share,truncated:market.truncated};
  }
  return {inserted,target_rows:targetRows.length,total:target.total,primary_state:primaryState,metric};
}

export async function collectFdicSource(env,projectId,source){
  const links=await all(env.DB,`SELECT l.*,e.year,e.episode_name FROM fdic_episode_links l JOIN empirical_episodes e ON e.id=l.episode_id WHERE l.project_id=? AND l.match_status='confirmed' ORDER BY e.year,e.episode_name`,[projectId]);
  if(!links.length)return {inserted:0,linked:0,warning:'no_confirmed_fdic_episode_links'};
  let inserted=0,details=[],errors=[];
  for(const link of links){
    try{
      const r=source.kind==='fdic_sod'?await collectSodForLink(env,projectId,link):await collectFinancialForLink(env,projectId,link);
      inserted+=Number(r.inserted||0); details.push({episode:link.episode_name,cert:link.cert,...r});
    }catch(e){errors.push({episode:link.episode_name,cert:link.cert,error:String(e.message||e)});}
  }
  await audit(env,projectId,'agent',`fdic.collect.${source.kind}`,'data_source',source.id,{linked:links.length,inserted,errors:errors.length});
  let reverification=null;
  try{ reverification=await buildFdicReverificationRankings(env,projectId); }
  catch(e){ errors.push({scope:'reverification_ranking',error:String(e.message||e)}); }
  return {inserted,linked:links.length,details,errors,reverification};
}

export async function enableFdicConnectors(env,projectId){
  const defs=[
    {kind:'fdic_financials',name:'FDIC BankFind — Financials',url:`${BASE}/financials`,cadence:10080},
    {kind:'fdic_sod',name:'FDIC BankFind — Summary of Deposits',url:`${BASE}/sod`,cadence:43200}
  ];
  const created=[];
  for(const d of defs){
    const exists=await one(env.DB,`SELECT id FROM data_sources WHERE project_id=? AND kind=? LIMIT 1`,[projectId,d.kind]);
    if(exists)continue;
    const id=uid('source');
    await run(env.DB,`INSERT INTO data_sources(id,project_id,name,kind,url,method,headers_json,mapping_json,enabled,cadence_minutes,created_at) VALUES(?,?,?,?,?,'GET','{}','{}',1,?,?)`,[id,projectId,d.name,d.kind,d.url,d.cadence,nowIso()]);
    created.push({id,kind:d.kind});
  }
  await audit(env,projectId,'user','fdic.connectors.enabled','data_source',null,{created});
  return {created};
}


function empiricalPercentile(values,x){
  const xs=values.filter(Number.isFinite).sort((a,b)=>a-b); if(!xs.length||!Number.isFinite(x))return null;
  const le=xs.filter(v=>v<=x).length; return le/xs.length;
}

export async function buildFdicReverificationRankings(env,projectId){
  const rows=await all(env.DB,`SELECT e.id episode_id,e.episode_name,e.year,e.concentration,e.peak_outflow,e.provenance_type,l.cert,l.institution_name,
    (SELECT m.hhi FROM fdic_market_metrics m WHERE m.project_id=e.project_id AND m.episode_id=e.id ORDER BY m.updated_at DESC LIMIT 1) fdic_hhi
    FROM empirical_episodes e JOIN fdic_episode_links l ON l.episode_id=e.id AND l.project_id=e.project_id
    WHERE e.project_id=? AND l.match_status='confirmed' ORDER BY e.year,e.episode_name`,[projectId]);
  const provisional=[];
  for(const r of rows){
    const fin=await all(env.DB,`SELECT repdte,deposits_domestic DEPDOM,deposits_total DEP FROM fdic_financial_observations WHERE project_id=? AND episode_id=? ORDER BY repdte`,[projectId,r.episode_id]);
    const fs=summarizeFinancialRows(fin);
    const C=toNum(r.concentration),hhi=toNum(r.fdic_hhi),po=toNum(r.peak_outflow),dd=toNum(fs.peak_drawdown);
    provisional.push({...r,
      concentration_gap:Number.isFinite(C)&&Number.isFinite(hhi)?Math.abs(C-hhi):null,
      deposit_gap:Number.isFinite(po)&&Number.isFinite(dd)?Math.abs(po-dd):null,
      fdic_peak_drawdown:Number.isFinite(dd)?dd:null,
      deposit_change:fs.deposit_change,
      financial_points:fs.deposit_points,
      peak_drawdown_date:fs.peak_date,
      comparable_dimensions:(Number.isFinite(C)&&Number.isFinite(hhi)?1:0)+(Number.isFinite(po)&&Number.isFinite(dd)?1:0)
    });
  }
  const cg=provisional.map(x=>x.concentration_gap).filter(Number.isFinite), dg=provisional.map(x=>x.deposit_gap).filter(Number.isFinite);
  for(const x of provisional){
    x.concentration_percentile=empiricalPercentile(cg,x.concentration_gap);
    x.deposit_percentile=empiricalPercentile(dg,x.deposit_gap);
    const ps=[x.concentration_percentile,x.deposit_percentile].filter(Number.isFinite);
    x.discrepancy_score=ps.length?ps.reduce((a,b)=>a+b,0)/ps.length:null;
  }
  provisional.sort((a,b)=>(b.discrepancy_score??-1)-(a.discrepancy_score??-1) || (a.provenance_type==='verified'?1:0)-(b.provenance_type==='verified'?1:0) || a.episode_name.localeCompare(b.episode_name));
  const now=nowIso(); let rank=0;
  for(const x of provisional){
    if(Number.isFinite(x.discrepancy_score))rank++;
    const score=x.discrepancy_score;
    const priority=!Number.isFinite(score)?'INSUFFICIENT':score>=0.80?'CRITICAL':score>=0.67?'HIGH':score>=0.33?'MEDIUM':'LOW';
    const reasons=[];
    if(Number.isFinite(x.concentration_gap))reasons.push(`concentration Δ=${x.concentration_gap.toFixed(4)} (FDIC state-HHI vs panel C; diagnostic only)`);
    if(Number.isFinite(x.deposit_gap))reasons.push(`deposit dynamics Δ=${x.deposit_gap.toFixed(4)} (FDIC peak drawdown vs panel peak_outflow; diagnostic proxy)`);
    if(x.provenance_type!=='verified')reasons.push('reconstructed episode: primary-source reverification has higher evidentiary value');
    if(x.financial_points!=null&&x.financial_points<4)reasons.push('limited quarterly Financials coverage');
    const existing=await one(env.DB,`SELECT id FROM fdic_reverification_rankings WHERE project_id=? AND episode_id=?`,[projectId,x.episode_id]);
    await run(env.DB,`INSERT INTO fdic_reverification_rankings(id,project_id,episode_id,cert,rank_num,priority_level,discrepancy_score,original_concentration,fdic_hhi,concentration_gap,concentration_percentile,original_peak_outflow,fdic_peak_drawdown,deposit_gap,deposit_percentile,financial_points,peak_drawdown_date,provenance_type,methodology_version,reason_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'FDIC-REVERIFY-v1',?,?,?)
      ON CONFLICT(project_id,episode_id) DO UPDATE SET cert=excluded.cert,rank_num=excluded.rank_num,priority_level=excluded.priority_level,discrepancy_score=excluded.discrepancy_score,original_concentration=excluded.original_concentration,fdic_hhi=excluded.fdic_hhi,concentration_gap=excluded.concentration_gap,concentration_percentile=excluded.concentration_percentile,original_peak_outflow=excluded.original_peak_outflow,fdic_peak_drawdown=excluded.fdic_peak_drawdown,deposit_gap=excluded.deposit_gap,deposit_percentile=excluded.deposit_percentile,financial_points=excluded.financial_points,peak_drawdown_date=excluded.peak_drawdown_date,provenance_type=excluded.provenance_type,reason_json=excluded.reason_json,updated_at=excluded.updated_at`,[
      existing?.id||uid('fdicrank'),projectId,x.episode_id,x.cert,Number.isFinite(score)?rank:null,priority,score,x.concentration,x.fdic_hhi,x.concentration_gap,x.concentration_percentile,x.peak_outflow,x.fdic_peak_drawdown,x.deposit_gap,x.deposit_percentile,x.financial_points,x.peak_drawdown_date,x.provenance_type,JSON.stringify({reasons,comparability:{concentration:'state-market HHI is a validation covariate, not an automatic replacement for thesis C',deposit:'maximum quarterly peak-to-trough drawdown over episode year-1 through episode year is a diagnostic proxy, not the same measurement window as peak_outflow'}}),now,now]);
  }
  await audit(env,projectId,'agent','fdic.reverification.ranked','empirical_episode',null,{episodes:provisional.length,ranked:rank,methodology:'FDIC-REVERIFY-v1'});
  return getFdicReverificationRankings(env,projectId);
}

export async function getFdicReverificationRankings(env,projectId,{limit=81}={}){
  const rows=await all(env.DB,`SELECT r.*,e.episode_name,e.year,l.institution_name FROM fdic_reverification_rankings r JOIN empirical_episodes e ON e.id=r.episode_id LEFT JOIN fdic_episode_links l ON l.episode_id=r.episode_id AND l.project_id=r.project_id WHERE r.project_id=? ORDER BY CASE r.priority_level WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,COALESCE(r.rank_num,999),e.year LIMIT ?`,[projectId,limit]);
  const summary=await one(env.DB,`SELECT COUNT(*) total,SUM(CASE WHEN priority_level='CRITICAL' THEN 1 ELSE 0 END) critical,SUM(CASE WHEN priority_level='HIGH' THEN 1 ELSE 0 END) high,SUM(CASE WHEN priority_level='MEDIUM' THEN 1 ELSE 0 END) medium,SUM(CASE WHEN priority_level='LOW' THEN 1 ELSE 0 END) low,SUM(CASE WHEN priority_level='INSUFFICIENT' THEN 1 ELSE 0 END) insufficient,AVG(discrepancy_score) mean_score FROM fdic_reverification_rankings WHERE project_id=?`,[projectId]);
  return {summary:summary||{},rows,methodology:{version:'FDIC-REVERIFY-v1',ranking:'mean empirical percentile of available absolute discrepancy dimensions; provenance is a tie-break/context flag rather than a numeric weight',concentration:'|panel concentration C - FDIC state-market HHI|; market definitions may differ, so diagnostic only',deposit:'|panel peak_outflow - FDIC maximum quarterly peak-to-trough deposit drawdown over year-1..year|; measurement windows differ, so diagnostic proxy',priority:'CRITICAL >=80th percentile aggregate; HIGH >=67th; MEDIUM >=33rd; LOW below 33rd; INSUFFICIENT when no comparable dimension'}};
}

export async function fdicStatus(env,projectId){
  const linkCounts=await one(env.DB,`SELECT COUNT(*) total,SUM(CASE WHEN match_status='confirmed' THEN 1 ELSE 0 END) confirmed,SUM(CASE WHEN match_status='pending' THEN 1 ELSE 0 END) pending FROM fdic_episode_links WHERE project_id=?`,[projectId]);
  const fin=await one(env.DB,`SELECT COUNT(*) rows,COUNT(DISTINCT episode_id) episodes,MIN(repdte) first_date,MAX(repdte) last_date FROM fdic_financial_observations WHERE project_id=?`,[projectId]);
  const sod=await one(env.DB,`SELECT COUNT(*) rows,COUNT(DISTINCT episode_id) episodes,MIN(year) first_year,MAX(year) last_year FROM fdic_sod_observations WHERE project_id=?`,[projectId]);
  const metrics=await one(env.DB,`SELECT COUNT(*) rows,COUNT(DISTINCT episode_id) episodes FROM fdic_market_metrics WHERE project_id=?`,[projectId]);
  const links=await all(env.DB,`SELECT l.id,l.episode_id,e.episode_name,e.year,l.cert,l.institution_name,l.match_status,l.match_method,l.match_score,l.candidate_json FROM fdic_episode_links l JOIN empirical_episodes e ON e.id=l.episode_id WHERE l.project_id=? ORDER BY CASE l.match_status WHEN 'confirmed' THEN 0 ELSE 1 END,e.year,e.episode_name LIMIT 100`,[projectId]);
  const latestMetrics=await all(env.DB,`SELECT m.*,e.episode_name FROM fdic_market_metrics m JOIN empirical_episodes e ON e.id=m.episode_id WHERE m.project_id=? ORDER BY m.updated_at DESC LIMIT 30`,[projectId]);
  const reverification=await getFdicReverificationRankings(env,projectId,{limit:10});
  return {links:{total:Number(linkCounts?.total||0),confirmed:Number(linkCounts?.confirmed||0),pending:Number(linkCounts?.pending||0),rows:links},financials:fin||{},sod:sod||{},market_metrics:{...(metrics||{}),rows_detail:latestMetrics},reverification,methodology:{financials:'CERT-linked quarterly FDIC Financials, episode year-1 through episode year; stored as verification covariates',sod:'CERT-linked SOD at episode year; optional state-market HHI uses all institutions in target bank primary deposit state',promotion:'FDIC-derived measures do not overwrite thesis concentration/peak_outflow automatically'}};
}
