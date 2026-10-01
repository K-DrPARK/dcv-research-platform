import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('full module registers core and bootstrap when optional search is absent',()=>{
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
  const events=[];
  const element=()=>({style:{},classList:{},addEventListener(){},querySelectorAll:()=>[]});
  const nodes=new Map([...ids].map(id=>[id,element()]));
  const document={readyState:'loading',getElementById:id=>nodes.get(id)||null,
    querySelector:s=>s.startsWith('#')?nodes.get(s.slice(1))||null:null,
    querySelectorAll:()=>[],addEventListener:(name,fn)=>events.push([name,fn])};
  const storage={getItem:()=>null};
  const window={addEventListener(){}};
  vm.runInNewContext(app,{document,window,localStorage:storage,sessionStorage:storage,console});
  assert.equal(ids.has('globalSearch'),false);
  assert.equal(typeof window.DCV.api,'function');
  assert.equal(typeof window.DCV.current,'function');
  assert.equal(events.filter(([name])=>name==='DOMContentLoaded').length,1);
});
