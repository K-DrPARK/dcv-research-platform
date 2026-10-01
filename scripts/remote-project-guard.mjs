import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const mode=process.argv[2]||'snapshot', file='.dcv-project-count-before.json';
function count(){
  const r=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['wrangler','d1','execute','DB','--remote','--command','SELECT COUNT(*) AS n FROM projects;','--json'],{encoding:'utf8',env:process.env});
  if(r.status!==0){
    const text=(r.stderr||'')+(r.stdout||'');
    if(/no such table|does not exist/i.test(text)) return 0;
    throw new Error(text||`wrangler exited ${r.status}`);
  }
  const arr=JSON.parse(r.stdout||'[]');
  const walk=x=>Array.isArray(x)?x.flatMap(walk):x&&typeof x==='object'?[x,...Object.values(x).flatMap(walk)]:[];
  const hit=walk(arr).find(x=>Object.prototype.hasOwnProperty.call(x,'n'));
  return Number(hit?.n||0);
}
if(mode==='snapshot'){
  const n=count();fs.writeFileSync(file,JSON.stringify({project_count:n,at:new Date().toISOString()}));console.log(`Remote project snapshot: ${n}`);
}else if(mode==='check'){
  const before=JSON.parse(fs.readFileSync(file,'utf8')).project_count||0, after=count();
  console.log(`Remote projects before=${before} after=${after}`);
  if(after<before){console.error('ABORT: migration reduced project count. Existing research projects must be preserved.');process.exit(3);}
}else throw new Error('use snapshot|check');
