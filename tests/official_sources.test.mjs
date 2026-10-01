import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './helpers/d1shim.mjs';
import { enableOfficialConnector, collectOfficialSource, officialSourceStatus, OFFICIAL_CONNECTORS } from '../src/lib/official_sources.js';

function seed(){const DB=makeDb(),now='2026-10-01T00:00:00.000Z';DB.raw.prepare(`INSERT INTO projects(id,name,description,status,current_stage,auto_run,auto_approve,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('p','x','','draft','define',1,0,now,now);return DB;}

async function source(DB,id){return DB.prepare(`SELECT * FROM data_sources WHERE project_id='p' AND connector_id=?`).bind(id).first();}

test('Case A connector activation creates separate layer and official sources',async()=>{
  const DB=seed();
  await enableOfficialConnector({DB},'p','bis_cpmi');
  await enableOfficialConnector({DB},'p','ecb_supervisory');
  await enableOfficialConnector({DB},'p','bok_ecos');
  const st=await officialSourceStatus({DB},'p');
  assert.equal(st.layers.find(x=>x.layer_code==='A').enabled,1);
  assert.equal(st.sources.length,3);
  assert.ok(st.sources.every(x=>x.case_layer==='A'));
});

test('BIS CPMI SDMX CSV collector normalizes official observations and is change-aware',async()=>{
  const DB=seed(); await enableOfficialConnector({DB},'p','bis_cpmi',{series:[{key:'A.KR.N.A.A.Z.Z.A.A.Z.A.A',metric_code:'cpmi.volume',jurisdiction:'KR',unit_hint:'Millions'}],start_period:'2023'});const s=await source(DB,'bis_cpmi');const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response('FREQ,REPORTING_COUNTRY,TIME_PERIOD,OBS_VALUE,UNIT_MEASURE\nA,KR,2023,100,Millions\nA,KR,2024,120,Millions\n',{status:200,headers:{'content-type':'text/csv'}});
  try{const a=await collectOfficialSource({DB},'p',s);assert.equal(a.changed,2);const b=await collectOfficialSource({DB},'p',s);assert.equal(b.changed,0);assert.equal(DB.raw.prepare(`SELECT COUNT(*) n FROM official_observations`).get().n,2);}finally{globalThis.fetch=old;}
});

test('ECB SUP connector imports LCR/CET1 SDMX CSV',async()=>{
  const DB=seed();await enableOfficialConnector({DB},'p','ecb_supervisory',{series:[{key:'Q.B01.W0._Z.I3017._T.SII._Z._Z._Z.PCT.C',metric_code:'ecb.lcr',jurisdiction:'SSM',unit_hint:'Percent'}]});const s=await source(DB,'ecb_supervisory'),old=globalThis.fetch;
  globalThis.fetch=async()=>new Response('KEY,TIME_PERIOD,OBS_VALUE,UNIT_MEASURE\nX,2025-Q4,158.6,Percent\n',{status:200,headers:{'content-type':'text/csv'}});
  try{const r=await collectOfficialSource({DB},'p',s);assert.equal(r.changed,1);const x=DB.raw.prepare(`SELECT * FROM official_observations WHERE metric_code='ecb.lcr'`).get();assert.equal(x.value_num,158.6);assert.equal(x.case_layer,'A');}finally{globalThis.fetch=old;}
});

test('ECOS connector uses secret and StatisticSearch row normalization',async()=>{
  const DB=seed();await enableOfficialConnector({DB},'p','bok_ecos',{stat_code:'722Y001',cycle:'D',start_period:'20261001',end_period:'20261001',item_code1:'0101000',metric_code:'ecos.base_rate'});const s=await source(DB,'bok_ecos'),old=globalThis.fetch;let called='';
  globalThis.fetch=async url=>{called=String(url);return new Response(JSON.stringify({StatisticSearch:{row:[{STAT_CODE:'722Y001',ITEM_CODE1:'0101000',ITEM_NAME1:'한국은행 기준금리',TIME:'20261001',DATA_VALUE:'2.50',UNIT_NAME:'%'}]}}),{status:200,headers:{'content-type':'application/json'}})};
  try{const r=await collectOfficialSource({DB,ECOS_API_KEY:'secret'},'p',s);assert.equal(r.changed,1);assert.match(called,/StatisticSearch\/secret\/json\/kr/);const x=DB.raw.prepare(`SELECT * FROM official_observations`).get();assert.equal(x.value_num,2.5);assert.equal(x.jurisdiction,'KR');}finally{globalThis.fetch=old;}
});

test('Case B connectors are isolated and remain CONFIG_REQUIRED without dataset endpoint',async()=>{
  const DB=seed();await enableOfficialConnector({DB},'p','openfiscal');await enableOfficialConnector({DB},'p','bojo_openapi');const st=await officialSourceStatus({DB},'p');assert.equal(st.layers.find(x=>x.layer_code==='B').enabled,1);assert.ok(st.sources.filter(x=>x.case_layer==='B').every(x=>x.config.status==='CONFIG_REQUIRED'));
  const s=await source(DB,'openfiscal');assert.equal(s.enabled,0);await assert.rejects(()=>collectOfficialSource({DB,OPENFISCAL_API_KEY:'k'},'p',s),/CONFIG_REQUIRED/);
});

test('connector registry covers requested sequence',()=>{
  for(const id of ['bis_cpmi','ecb_supervisory','bok_ecos','openfiscal','bojo_openapi'])assert.ok(OFFICIAL_CONNECTORS[id],id);
  assert.equal(OFFICIAL_CONNECTORS.openfiscal.case_layer,'B');assert.equal(OFFICIAL_CONNECTORS.bis_cpmi.case_layer,'A');
});
