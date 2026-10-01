import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBankName, bankNameScore, computeHhi, summarizeFinancialRows } from '../src/lib/fdic.js';
import { SOURCE_PRESETS } from '../src/lib/source_presets.js';

test('FDIC name normalisation removes legal/noise tokens without inventing a match',()=>{
  assert.equal(normalizeBankName('First Republic Bank, N.A.'),'first republic');
  assert.ok(bankNameScore('washington_mutual','Washington Mutual Bank')>0.90);
  assert.ok(bankNameScore('credit_suisse','Silverton Bank')<0.2);
});

test('SOD HHI is computed from institution deposit shares',()=>{
  const r=computeHhi({a:50,b:30,c:20});
  assert.equal(r.bank_count,3); assert.equal(r.total,100);
  assert.ok(Math.abs(r.hhi-(0.25+0.09+0.04))<1e-12);
});

test('Financials summary derives deposit change from ordered report dates',()=>{
  const r=summarizeFinancialRows([{REPDTE:'2022-12-31',DEPDOM:100},{REPDTE:'2023-03-31',DEPDOM:90},{REPDTE:'2023-12-31',DEPDOM:80}]);
  assert.equal(r.deposit_points,3); assert.ok(Math.abs(r.deposit_change+0.2)<1e-12);
});

test('FDIC presets use dedicated connectors rather than generic unfiltered JSON ingestion',()=>{
  const sod=SOURCE_PRESETS.find(x=>x.id==='fdic_sod'),fin=SOURCE_PRESETS.find(x=>x.id==='fdic_financials');
  assert.equal(sod.kind,'fdic_sod'); assert.equal(fin.kind,'fdic_financials');
  assert.equal(sod.integration,'episode_cert_connector'); assert.equal(fin.integration,'episode_cert_connector');
  assert.match(sod.note,/does not silently replace|does not silently/i);
});

test('FDIC collector source is change-aware so an unchanged scheduled fetch does not become new evidence', async()=>{
  const fs=await import('node:fs/promises');
  const src=await fs.readFile(new URL('../src/lib/fdic.js',import.meta.url),'utf8');
  assert.match(src,/WHERE fdic_financial_observations\.payload_json<>excluded\.payload_json/);
  assert.match(src,/WHERE fdic_sod_observations\.payload_json<>excluded\.payload_json/);
  assert.match(src,/enableFdicConnectors/);
});

import { makeDb } from './helpers/d1shim.mjs';
import { resolveFdicLinks, collectFdicSource } from '../src/lib/fdic.js';

function seedFdicDb(){
  const DB=makeDb(), now='2026-10-01T00:00:00.000Z';
  DB.raw.prepare(`INSERT INTO projects(id,name,description,status,current_stage,auto_run,auto_approve,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('p','x','', 'draft','define',1,0,now,now);
  DB.raw.prepare(`INSERT INTO empirical_episodes(id,project_id,episode_name,year,peak_outflow,concentration,digital_adoption,severity,failed,provenance_type,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('e','p','washington_mutual',2008,.09,.55,.45,.55,1,'verified','{}',now,now);
  return DB;
}

test('FDIC failures resolver confirms only a high-confidence unique bank-name match', async()=>{
  const DB=seedFdicDb(), old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[{data:{NAME:'Washington Mutual Bank',CERT:32633}},{data:{NAME:'Other Bank',CERT:9}}],meta:{total:2}}),{status:200,headers:{'content-type':'application/json'}});
  try{
    const r=await resolveFdicLinks({DB},'p');
    assert.equal(r.confirmed,1);
    const link=DB.raw.prepare(`SELECT * FROM fdic_episode_links WHERE project_id='p'`).get();
    assert.equal(link.cert,32633); assert.equal(link.match_status,'confirmed');
  } finally { globalThis.fetch=old; }
});

test('FDIC Financials connector stores CERT-linked quarterly rows', async()=>{
  const DB=seedFdicDb(), now='2026-10-01T00:00:00.000Z';
  DB.raw.prepare(`INSERT INTO fdic_episode_links(id,project_id,episode_id,cert,institution_name,match_status,match_method,match_score,candidate_json,confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('l','p','e',32633,'Washington Mutual Bank','confirmed','manual',1,'{}',now,now,now);
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[{data:{CERT:32633,REPDTE:'2007-12-31',DEPDOM:100,ASSET:150}},{data:{CERT:32633,REPDTE:'2008-06-30',DEPDOM:80,ASSET:140}}],meta:{total:2}}),{status:200,headers:{'content-type':'application/json'}});
  try{
    const r=await collectFdicSource({DB},'p',{id:'s',kind:'fdic_financials'});
    assert.equal(r.linked,1); assert.equal(r.inserted,2);
    assert.equal(DB.raw.prepare(`SELECT COUNT(*) n FROM fdic_financial_observations`).get().n,2);
    assert.ok(Math.abs(r.details[0].summary.deposit_change+0.2)<1e-12);
  } finally { globalThis.fetch=old; }
});

test('FDIC SOD connector computes a separate state-market HHI without overwriting thesis concentration', async()=>{
  const DB=seedFdicDb(), now='2026-10-01T00:00:00.000Z';
  DB.raw.prepare(`INSERT INTO fdic_episode_links(id,project_id,episode_id,cert,institution_name,match_status,match_method,match_score,candidate_json,confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('l','p','e',32633,'Washington Mutual Bank','confirmed','manual',1,'{}',now,now,now);
  const old=globalThis.fetch;
  globalThis.fetch=async url=>{
    const u=new URL(url),filter=u.searchParams.get('filters')||'';
    const data=filter.includes('CERT:32633')
      ? [{data:{YEAR:2008,CERT:32633,UNINUMBR:'1',BRNUM:'1',STALPBR:'CA',DEPSUMBR:50}}]
      : [{data:{YEAR:2008,CERT:32633,UNINUMBR:'1',BRNUM:'1',STALPBR:'CA',DEPSUMBR:50}},{data:{YEAR:2008,CERT:2,UNINUMBR:'2',BRNUM:'1',STALPBR:'CA',DEPSUMBR:30}},{data:{YEAR:2008,CERT:3,UNINUMBR:'3',BRNUM:'1',STALPBR:'CA',DEPSUMBR:20}}];
    return new Response(JSON.stringify({data,meta:{total:data.length}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const r=await collectFdicSource({DB},'p',{id:'s',kind:'fdic_sod'});
    assert.equal(r.details[0].metric.state,'CA');
    assert.ok(Math.abs(r.details[0].metric.hhi-.38)<1e-12);
    const ep=DB.raw.prepare(`SELECT concentration FROM empirical_episodes WHERE id='e'`).get();
    assert.equal(ep.concentration,.55);
  } finally { globalThis.fetch=old; }
});

import { buildFdicReverificationRankings, getFdicReverificationRankings } from '../src/lib/fdic.js';

function seedRankEpisode(DB,{id,name,year=2008,C=.5,out=.1,prov='estimated',cert}){
  const now='2026-10-01T00:00:00.000Z';
  DB.raw.prepare(`INSERT INTO empirical_episodes(id,project_id,episode_name,year,peak_outflow,concentration,digital_adoption,severity,failed,provenance_type,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,'p',name,year,out,C,.5,.6,1,prov,'{}',now,now);
  DB.raw.prepare(`INSERT INTO fdic_episode_links(id,project_id,episode_id,cert,institution_name,match_status,match_method,match_score,candidate_json,confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,'confirmed','manual',1,'{}',?,?,?)`).run('l_'+id,'p',id,cert,name,now,now,now);
}
function seedMetric(DB,{episode,cert,hhi,year=2008}){
  const now='2026-10-01T00:00:00.000Z';
  DB.raw.prepare(`INSERT INTO fdic_market_metrics(id,project_id,episode_id,cert,year,market_type,market_key,hhi,bank_count,total_deposits,target_bank_share,methodology_version,quality_json,created_at,updated_at) VALUES(?,?,?,?,?,'state','CA',?,3,100,.5,'FDIC-SOD-STATE-HHI-v1','{}',?,?)`).run('m_'+episode,'p',episode,cert,year,hhi,now,now);
}
function seedFin(DB,{episode,cert,points}){
  const now='2026-10-01T00:00:00.000Z';
  points.forEach(([d,dep],i)=>DB.raw.prepare(`INSERT INTO fdic_financial_observations(id,project_id,episode_id,cert,repdte,deposits_total,deposits_domestic,payload_json,fetched_at) VALUES(?,?,?,?,?,?,?,'{}',?)`).run(`f_${episode}_${i}`,'p',episode,cert,d,dep,dep,now));
}

test('FDIC reverification ranking prioritises the largest empirical discrepancy and never overwrites panel values', async()=>{
  const DB=makeDb(), now='2026-10-01T00:00:00.000Z';
  DB.raw.prepare(`INSERT INTO projects(id,name,description,status,current_stage,auto_run,auto_approve,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('p','x','', 'draft','define',1,0,now,now);
  seedRankEpisode(DB,{id:'e_low',name:'low_gap',C:.50,out:.10,prov:'verified',cert:1});
  seedRankEpisode(DB,{id:'e_mid',name:'mid_gap',C:.50,out:.10,prov:'estimated',cert:2});
  seedRankEpisode(DB,{id:'e_hi',name:'high_gap',C:.50,out:.10,prov:'estimated',cert:3});
  seedMetric(DB,{episode:'e_low',cert:1,hhi:.51});
  seedMetric(DB,{episode:'e_mid',cert:2,hhi:.60});
  seedMetric(DB,{episode:'e_hi',cert:3,hhi:.85});
  seedFin(DB,{episode:'e_low',cert:1,points:[['2007-12-31',100],['2008-12-31',90]]}); // dd .10, gap 0
  seedFin(DB,{episode:'e_mid',cert:2,points:[['2007-12-31',100],['2008-12-31',80]]}); // dd .20, gap .10
  seedFin(DB,{episode:'e_hi',cert:3,points:[['2007-12-31',100],['2008-12-31',60]]}); // dd .40, gap .30
  const r=await buildFdicReverificationRankings({DB},'p');
  assert.equal(r.rows[0].episode_name,'high_gap');
  assert.equal(r.rows[0].rank_num,1);
  assert.equal(r.rows[0].priority_level,'CRITICAL');
  assert.ok(r.rows[0].concentration_gap>.3);
  assert.ok(r.rows[0].deposit_gap>.29);
  const reasons=JSON.parse(r.rows[0].reason_json).reasons.join(' ');
  assert.match(reasons,/reconstructed episode/);
  const original=DB.raw.prepare(`SELECT concentration,peak_outflow FROM empirical_episodes WHERE id='e_hi'`).get();
  assert.equal(original.concentration,.50);
  assert.equal(original.peak_outflow,.10);
});

test('FDIC reverification ranking marks linked episodes without comparable dimensions as INSUFFICIENT', async()=>{
  const DB=makeDb(), now='2026-10-01T00:00:00.000Z';
  DB.raw.prepare(`INSERT INTO projects(id,name,description,status,current_stage,auto_run,auto_approve,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('p','x','', 'draft','define',1,0,now,now);
  seedRankEpisode(DB,{id:'e',name:'no_coverage',C:.5,out:.1,prov:'estimated',cert:9});
  const r=await buildFdicReverificationRankings({DB},'p');
  assert.equal(r.rows[0].priority_level,'INSUFFICIENT');
  assert.equal(r.rows[0].rank_num,null);
  const g=await getFdicReverificationRankings({DB},'p');
  assert.equal(g.summary.insufficient,1);
});

import { getFdicReverificationWorkbench, saveFdicReverificationReview } from '../src/lib/fdic.js';

test('Episode Reverification Workbench exposes panel values, FDIC raw evidence and suggested causes without overwriting panel', async()=>{
  const DB=makeDb(), now='2026-10-01T00:00:00.000Z';
  DB.raw.prepare(`INSERT INTO projects(id,name,description,status,current_stage,auto_run,auto_approve,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('p','x','', 'draft','define',1,0,now,now);
  seedRankEpisode(DB,{id:'e',name:'workbench_bank',C:.50,out:.10,prov:'estimated',cert:77});
  seedMetric(DB,{episode:'e',cert:77,hhi:.82});
  seedFin(DB,{episode:'e',cert:77,points:[['2007-12-31',100],['2008-03-31',92],['2008-06-30',70],['2008-12-31',65]]});
  DB.raw.prepare(`INSERT INTO fdic_sod_observations(id,project_id,episode_id,cert,year,branch_num,uninumber,state,county,cbsa,branch_deposits,payload_json,fetched_at,row_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('s','p','e',77,2008,'1','u','CA','X','Y',50,'{}',now,'2008|77|u|1|CA');
  await buildFdicReverificationRankings({DB},'p');
  const w=await getFdicReverificationWorkbench({DB},'p','e');
  assert.equal(w.episode.concentration,.50);
  assert.equal(w.ranking.fdic_hhi,.82);
  assert.equal(w.financials.rows.length,4);
  assert.equal(w.sod.rows.length,1);
  assert.ok(w.suggested_causes.some(x=>x.code==='MARKET_DEFINITION'));
  assert.ok(w.suggested_causes.some(x=>x.code==='PANEL_RECONSTRUCTION'));
  const original=DB.raw.prepare(`SELECT concentration,peak_outflow FROM empirical_episodes WHERE id='e'`).get();
  assert.equal(original.concentration,.50); assert.equal(original.peak_outflow,.10);
});

test('Workbench RESOLVED requires every checklist item and a reviewer note, then requests evidence registration', async()=>{
  const DB=makeDb(), now='2026-10-01T00:00:00.000Z';
  DB.raw.prepare(`INSERT INTO projects(id,name,description,status,current_stage,auto_run,auto_approve,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('p','x','', 'draft','define',1,0,now,now);
  seedRankEpisode(DB,{id:'e',name:'review_bank',C:.50,out:.10,prov:'estimated',cert:88});
  seedMetric(DB,{episode:'e',cert:88,hhi:.80}); seedFin(DB,{episode:'e',cert:88,points:[['2007-12-31',100],['2008-12-31',70]]});
  await buildFdicReverificationRankings({DB},'p');
  await assert.rejects(()=>saveFdicReverificationReview({DB},'p','e',{review_status:'RESOLVED',reviewer_note:'checked',checklist:{cert_link:true}}),/checklist_incomplete/);
  const checks=Object.fromEntries((await getFdicReverificationWorkbench({DB},'p','e')).checklist.map(x=>[x.id,true]));
  const r=await saveFdicReverificationReview({DB},'p','e',{review_status:'RESOLVED',cause_code:'PANEL_RECONSTRUCTION',reviewer_name:'PI',reviewer_note:'Primary source check completed; keep panel pending source archive.',recommended_action:'KEEP_PANEL',checklist:checks});
  assert.equal(r.review_status,'RESOLVED'); assert.equal(r.checklist_complete,true); assert.equal(r.needs_evidence_registration,true);
  const row=DB.raw.prepare(`SELECT * FROM fdic_reverification_reviews WHERE episode_id='e'`).get();
  assert.equal(row.recommended_action,'KEEP_PANEL'); assert.equal(row.review_status,'RESOLVED');
});
