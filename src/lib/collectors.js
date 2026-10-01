import { all, run, audit } from './db.js';
import { nowIso, uid, safeJson } from './util.js';
import { importEmpiricalEpisodes } from './empirical.js';
import { collectFdicSource } from './fdic.js';

function getPath(obj, path){ if(!path) return obj; return String(path).split('.').reduce((a,k)=>a?.[k], obj); }
function parseCsv(text){
  const lines=text.trim().split(/\r?\n/); if(lines.length<2) return [];
  const heads=lines[0].split(',').map(x=>x.trim().replace(/^"|"$/g,''));
  return lines.slice(1).filter(Boolean).map(line=>{ const vals=line.split(',').map(x=>x.trim().replace(/^"|"$/g,'')); return Object.fromEntries(heads.map((h,i)=>[h,vals[i]])); });
}

function normalizeRows(source, body, contentType){
  const mapping=safeJson(source.mapping_json,{});
  let data;
  if(source.kind==='csv' || contentType.includes('text/csv')) data=parseCsv(body);
  else if(source.kind==='text') data=[{value:body}];
  else data=JSON.parse(body);
  const arr=getPath(data,mapping.rows_path);
  return Array.isArray(arr)?arr:[arr ?? data];
}

export async function collectProject(env, projectId){
  const sources=await all(env.DB, `SELECT * FROM data_sources WHERE project_id=? AND enabled=1`, [projectId]);
  let inserted=0, empiricalRows=0, errors=[];
  for(const s of sources){
    try{
      if(s.kind==='fdic_sod' || s.kind==='fdic_financials'){
        const fr=await collectFdicSource(env,projectId,s);
        inserted+=Number(fr.inserted||0);
        if(fr.errors?.length) errors.push(...fr.errors.map(x=>({source:s.name,...x})));
        await run(env.DB,`UPDATE data_sources SET last_fetched_at=?,last_status=? WHERE id=?`,[nowIso(),fr.errors?.length?`partial:${fr.errors.length}`:'ok',s.id]);
        continue;
      }
      const headers=safeJson(s.headers_json,{});
      const resp=await fetch(s.url,{method:s.method||'GET',headers});
      if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body=await resp.text();
      const rows=normalizeRows(s,body,resp.headers.get('content-type')||'');
      const map=safeJson(s.mapping_json,{});
      if(s.kind==='episodes' || map.target==='empirical_episodes'){
        const epRows=rows.slice(0,1000).map(row=>({
          episode_name:getPath(row,map.episode_name_path||'episode_name')??getPath(row,'name'), year:getPath(row,map.year_path||'year'), country:getPath(row,map.country_path||'country'),
          peak_outflow:getPath(row,map.peak_outflow_path||'peak_outflow'), concentration:getPath(row,map.concentration_path||'concentration'), digital_adoption:getPath(row,map.digital_adoption_path||'digital_adoption'),
          severity:getPath(row,map.severity_path||'severity'), failed:getPath(row,map.failed_path||'failed'), provenance_type:getPath(row,map.provenance_path||'provenance_type')||map.provenance_type||'external_import',
          reliability_grade:getPath(row,map.reliability_path||'reliability_grade'), source_note:`external:${s.name}`, metadata:{source_id:s.id,http_status:resp.status}
        })).filter(x=>x.episode_name);
        const ir=await importEmpiricalEpisodes(env,projectId,epRows); empiricalRows+=ir.inserted;
      } else {
        const stmts=[];
        for(const row of rows.slice(0,500)){
          const key=String(getPath(row,map.key_path)||map.key||s.name||'signal');
          const raw=getPath(row,map.value_path||'value');
          const num=Number(raw); const isNum=Number.isFinite(num);
          const observed=String(getPath(row,map.time_path)||nowIso());
          stmts.push(env.DB.prepare(`INSERT INTO raw_observations(id,project_id,source_id,observed_at,ingested_at,key,value_num,value_text,payload_json,quality_json) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(
            uid('obs'),projectId,s.id,observed,nowIso(),key,isNum?num:null,isNum?null:String(raw??''),JSON.stringify(row),JSON.stringify({http_status:resp.status})
          ));
        }
        if(stmts.length){ await env.DB.batch(stmts); inserted+=stmts.length; }
      }
      await run(env.DB,`UPDATE data_sources SET last_fetched_at=?,last_status='ok' WHERE id=?`,[nowIso(),s.id]);
    }catch(e){
      errors.push({source:s.name,error:String(e)});
      await run(env.DB,`UPDATE data_sources SET last_fetched_at=?,last_status=? WHERE id=?`,[nowIso(),`error:${String(e).slice(0,120)}`,s.id]);
    }
  }
  await audit(env,projectId,'agent','collect.complete','project',projectId,{inserted,empiricalRows,errors});
  return {inserted,empiricalRows,errors,sources:sources.length};
}
