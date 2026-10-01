import { all, one, run } from './db.js';
import { nowIso, uid, safeJson } from './util.js';
import { loadEmpiricalCalibration } from './empirical.js';
import { cached, bust } from './memo.js';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number(x)));
const finite=x=>Number.isFinite(Number(x));
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

function averageRank01(values,target){
  const xs=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b); if(!xs.length||!finite(target))return null;
  if(xs.length===1)return .5;
  const t=Number(target); let lo=0,hi=0; for(const x of xs){if(x<t)lo++;if(x<=t)hi++;}
  const avgRank=((lo+1)+hi)/2; return clamp((avgRank-1)/(xs.length-1));
}
function byMetric(rows,code){return rows.filter(r=>r.metric_code===code&&finite(r.value_num)).sort((a,b)=>String(a.period).localeCompare(String(b.period)));}
function newestCommon(a,b){const bm=new Map(b.map(x=>[String(x.period),x]));for(let i=a.length-1;i>=0;i--){const y=bm.get(String(a[i].period));if(y)return[a[i],y];}return null;}
function headroom(value,minimum){const x=Number(value),m=Number(minimum);return x>0&&m>0?clamp(1-m/x):null;}

export function deriveBisDigitalMapping(rows){
  const total=byMetric(rows,'cpmi.cashless.volume.total');
  const fast=byMetric(rows,'cpmi.cashless.volume.fast');
  if(!total.length)return {status:'INSUFFICIENT',reason:'cashless_total_missing'};
  const latest=total[total.length-1];
  const levelScore=averageRank01(total.map(x=>Math.log1p(Number(x.value_num))),Math.log1p(Number(latest.value_num)));
  const pair=newestCommon(total,fast);
  let fastShare=null,period=String(latest.period),fastValue=null,totalAtFast=null;
  if(pair){totalAtFast=Number(pair[0].value_num);fastValue=Number(pair[1].value_num);fastShare=totalAtFast>0?clamp(fastValue/totalAtFast):null;period=String(pair[0].period);}
  const components=[levelScore,fastShare].filter(Number.isFinite);
  const composite=avg(components);
  return {status:composite==null?'INSUFFICIENT':'READY',mapping_key:'D_CPMI',method:'BIS-CPMI-D-v1',period,
    value:composite,components:{historical_level_percentile:levelScore,fast_payment_share:fastShare,total_cashless_latest:Number(latest.value_num),total_cashless_fast_period:totalAtFast,fast_volume:fastValue},
    sensitivity:{level_only:levelScore,fast_only:fastShare,equal_weight:composite},
    interpretation:'External digital-payment-intensity proxy. Equal-weight composite of the within-series historical percentile of total cashless-payment volume and the fast-payment share when available. It validates/stress-tests D and does not replace the panel digital_adoption variable.'};
}

export function deriveEcbResilienceMapping(rows,thetaLow=.62,thetaHigh=.74){
  const lcr=byMetric(rows,'ecb.sup.lcr.si'),cet1=byMetric(rows,'ecb.sup.cet1.si');
  const pair=newestCommon(lcr,cet1); if(!pair)return {status:'INSUFFICIENT',reason:'common_lcr_cet1_period_missing'};
  const L=Number(pair[0].value_num),C=Number(pair[1].value_num),lcrScore=headroom(L,100),cet1Score=headroom(C,4.5);
  const R=avg([lcrScore,cet1Score].filter(Number.isFinite)); if(R==null)return{status:'INSUFFICIENT',reason:'invalid_values'};
  const lo=Number(thetaLow),hi=Number(thetaHigh),map=x=>clamp(lo+(hi-lo)*clamp(x),Math.min(lo,hi),Math.max(lo,hi));
  return {status:'READY',mapping_key:'R_ECB',method:'ECB-RESILIENCE-v1',period:String(pair[0].period),value:R,
    components:{lcr_pct:L,cet1_pct:C,lcr_headroom:lcrScore,cet1_headroom:cet1Score,basel_lcr_minimum:100,basel_cet1_minimum:4.5},
    theta_external:map(R),theta_range:[lo,hi],sensitivity:{lcr_only:map(lcrScore),cet1_only:map(cet1Score),equal_weight:map(R)},
    interpretation:'External banking-resilience proxy. Regulatory headroom h(x,m)=max(0,1-m/x) is computed against Basel minima (LCR 100%, CET1 4.5%), averaged, then mapped only to the predeclared model theta range. This is an external validation/stress mapping, not a direct Korea calibration.'};
}

async function upsertMetric(env,projectId,connectorId,mapping){
  if(!mapping||mapping.status!=='READY')return 0;const ts=nowIso();
  const payload=JSON.stringify(mapping),components=JSON.stringify(mapping.components||{}),sensitivity=JSON.stringify(mapping.sensitivity||{});
  const prior=await one(env.DB,`SELECT value_num,period,payload_json FROM external_validation_metrics WHERE project_id=? AND mapping_key=?`,[projectId,mapping.mapping_key]);
  if(prior&&Number(prior.value_num)===Number(mapping.value)&&String(prior.period||'')===String(mapping.period||'')&&String(prior.payload_json||'')===payload)return 0;
  await run(env.DB,`INSERT INTO external_validation_metrics(id,project_id,connector_id,mapping_key,method_version,period,value_num,components_json,sensitivity_json,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,mapping_key) DO UPDATE SET connector_id=excluded.connector_id,method_version=excluded.method_version,period=excluded.period,value_num=excluded.value_num,components_json=excluded.components_json,sensitivity_json=excluded.sensitivity_json,payload_json=excluded.payload_json,updated_at=excluded.updated_at`,[uid('extmap'),projectId,connectorId,mapping.mapping_key,mapping.method,mapping.period,Number(mapping.value),components,sensitivity,payload,ts,ts]);
  bust(env,projectId);return 1;
}

export async function refreshOfficialMappings(env,projectId,connectorId=null){
  const cal=await loadEmpiricalCalibration(env,projectId),out={updated:0,mappings:[]};
  if(!connectorId||connectorId==='bis_cpmi'){
    const rows=await all(env.DB,`SELECT metric_code,period,value_num,unit FROM official_observations WHERE project_id=? AND connector_id='bis_cpmi' AND metric_code IN ('cpmi.cashless.volume.total','cpmi.cashless.volume.fast') ORDER BY period`,[projectId]);
    const m=deriveBisDigitalMapping(rows);out.mappings.push(m);out.updated+=await upsertMetric(env,projectId,'bis_cpmi',m);
  }
  if(!connectorId||connectorId==='ecb_supervisory'){
    const rows=await all(env.DB,`SELECT metric_code,period,value_num,unit FROM official_observations WHERE project_id=? AND connector_id='ecb_supervisory' AND metric_code IN ('ecb.sup.lcr.si','ecb.sup.cet1.si') ORDER BY period`,[projectId]);
    const lo=Number(cal.params.stability_theta_range_low?.value??.62),hi=Number(cal.params.stability_theta_range_high?.value??.74);
    const m=deriveEcbResilienceMapping(rows,lo,hi);out.mappings.push(m);out.updated+=await upsertMetric(env,projectId,'ecb_supervisory',m);
  }
  return out;
}

export async function getOfficialMappings(env,projectId){
  return cached(env,projectId,'official:mappings',async()=>{
    const rows=await all(env.DB,`SELECT connector_id,mapping_key,method_version,period,value_num,components_json,sensitivity_json,payload_json,updated_at FROM external_validation_metrics WHERE project_id=? ORDER BY mapping_key`,[projectId]);
    return rows.map(r=>({...r,components:safeJson(r.components_json,{}),sensitivity:safeJson(r.sensitivity_json,{}),payload:safeJson(r.payload_json,{})}));
  },120000);
}

export async function officialValidationScenarios(env,projectId,cal){
  const maps=await getOfficialMappings(env,projectId),baseS=Number(cal.params.baseline_shock?.value??.75),C=Number(cal.params.korea_concentration_anchor?.value??.75),D0=Number(cal.params.korea_digital_adoption?.value??.92),rmse=Math.max(.015,Number(cal.coeff.rmse||.03));
  const baseOut=clamp(Number(cal.coeff.kappa)+Number(cal.coeff.theta1)*baseS+Number(cal.coeff.theta2)*C*baseS,0,.75),out=[];
  const common={severity:baseS,concentration:C,empirical_outflow:baseOut,volatility:1,delay_multiplier:1,loss_multiplier:1,drift:0,rho:.82,shift_time:-1,shift_magnitude:0,process_noise:rmse,provenance:'official_external_validation'};
  const dm=maps.find(x=>x.mapping_key==='D_CPMI');if(dm){for(const [k,v] of Object.entries(dm.sensitivity||{})){if(!finite(v))continue;out.push({...common,key:`official_bis_D_${k}`,name:`BIS CPMI external D · ${k}`,digital:clamp(v),external_mapping:{mapping_key:'D_CPMI',method:dm.method_version,period:dm.period,baseline_D:D0,proxy_D:Number(v)}});}}
  const rm=maps.find(x=>x.mapping_key==='R_ECB');if(rm){for(const [k,v] of Object.entries(rm.sensitivity||{})){if(!finite(v))continue;out.push({...common,key:`official_ecb_R_${k}`,name:`ECB external resilience · ${k}`,digital:D0,risk_threshold_override:Number(v),external_mapping:{mapping_key:'R_ECB',method:rm.method_version,period:rm.period,theta_external:Number(v)}});}}
  return out;
}
