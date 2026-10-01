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
