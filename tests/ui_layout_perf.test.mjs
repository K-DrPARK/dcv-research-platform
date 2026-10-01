import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fdic=fs.readFileSync(new URL('../src/lib/fdic.js',import.meta.url),'utf8');
const official=fs.readFileSync(new URL('../src/lib/official_sources.js',import.meta.url),'utf8');
const compute=fs.readFileSync(new URL('../src/lib/compute.js',import.meta.url),'utf8');

test('primary dashboard uses exact CSS grids for balanced rows and columns',()=>{
  assert.match(css,/#stats\{[\s\S]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/#computeSection\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/#projectsSection\{[\s\S]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css,/table-layout:fixed!important/);
});

test('project auxiliary panels are deferred and cached per cycle/revision',()=>{
  assert.match(app,/auxSnapshotCache=new Map\(\)/);
  assert.match(app,/requestIdleCallback/);
  assert.match(app,/Promise\.allSettled\(\[loadFdicStatus\(\),loadOfficialStatus\(\),loadExternalMatrix\(\)\]\)/);
  assert.doesNotMatch(app,/const _dcvOpenProject=openProject/);
});

test('high-frequency project compute metadata is memoized and status dashboards batch D1 reads',()=>{
  assert.match(compute,/project:compute-meta/);
  assert.match(fdic,/Status dashboard used to issue 9 sequential reads/);
  assert.match(fdic,/await env\.DB\.batch\(q\)/);
  assert.match(official,/Three dashboard reads are independent; batch them to one D1 round-trip/);
});
