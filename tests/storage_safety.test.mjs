import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('migrations never destructively delete/drop projects',()=>{
  for(const name of fs.readdirSync('migrations').filter(x=>x.endsWith('.sql'))){
    const sql=fs.readFileSync(path.join('migrations',name),'utf8').replace(/--.*$/gm,' ');
    assert.equal(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?projects\b/i.test(sql),false,`${name} drops projects`);
    assert.equal(/DELETE\s+FROM\s+projects\b/i.test(sql),false,`${name} deletes projects`);
  }
});

test('project list has legacy-schema compatibility and storage lineage guard',()=>{
  const s=fs.readFileSync('src/index.js','utf8');
  assert.match(s,/compatibleProjectList/);
  assert.match(s,/storageIntegrity/);
  assert.match(s,/PRAGMA table_info\(\$\{table\}\)/);
  const ui=fs.readFileSync('public/app.js','utf8');
  assert.match(ui,/dcv_storage_lineage/);
  assert.match(ui,/기존 프로젝트가 삭제된 것으로 단정하지 마세요/);
});

test('ui recovery keeps last known project and renders current research briefing',()=>{
  const ui=fs.readFileSync('public/app.js','utf8');
  const html=fs.readFileSync('public/index.html','utf8');
  assert.match(ui,/recoverLastProject/);
  assert.match(ui,/\/api\/projects\/\$\{current\}/);
  assert.match(ui,/renderResearchBrief/);
  assert.match(html,/id="currentResearchBrief"/);
  assert.match(html,/RESEARCH BRIEFING/);
});

test('panel headings use deterministic title-description rows',()=>{
  const css=fs.readFileSync('public/style.css','utf8');
  assert.match(css,/grid-template-rows:auto auto!important/);
  assert.match(css,/panel-head>div:first-child>b/);
  assert.match(css,/panel-head>div:first-child>small/);
});
