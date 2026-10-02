import {one,run} from '../../src/lib/db.js';
import {uid,nowIso} from '../../src/lib/util.js';
export async function acquireRunner(env,minutes=6){
 const token=uid('actions'),ts=nowIso(),until=new Date(Date.now()+minutes*60000).toISOString();
 const r=await run(env.DB,`INSERT INTO external_runner_leases(id,token,lease_until,updated_at) VALUES('research',?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE external_runner_leases.lease_until<?`,[token,until,ts,ts]);
 return Number(r.meta?.changes||0)?token:null;
}
export async function heartbeatRunner(env,token){const ts=nowIso();const r=await run(env.DB,`UPDATE external_runner_leases SET lease_until=?,updated_at=? WHERE id='research' AND token=? AND lease_until>?`,[new Date(Date.now()+360000).toISOString(),ts,token,ts]);if(!r.meta?.changes)throw new Error('external_runner_lease_lost');}
export async function releaseRunner(env,token,count){await run(env.DB,`UPDATE external_runner_leases SET lease_until=?,updated_at=?,last_completed_at=?,jobs_completed=jobs_completed+? WHERE id='research' AND token=?`,[nowIso(),nowIso(),nowIso(),count,token]);}
