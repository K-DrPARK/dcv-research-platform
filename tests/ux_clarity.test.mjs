import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const report=fs.readFileSync(new URL('../src/lib/report.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');

test('dashboard separates robust regret from human recompute and explains gate lifecycle',()=>{
  assert.match(html,/Robust Minimax Regret \/ Human Recompute/);
  assert.match(html,/G3 Robust Validation 완료 후 Matrix\/Funnel 생성/);
  assert.match(app,/Human Recompute는 이 regret 지표에 포함되지 않습니다/);
  assert.match(app,/G5까지 완료되면 후보 검증의 인간 보정 단계가 완료됩니다/);
  assert.match(app,/G6 Scientific Sign-off는 통계 계산이 아니라 사람의 최종 학술 승인/);
});

test('project detail exposes regret provenance rather than a context-free number',()=>{
  assert.match(api,/regretMeta=/);
  assert.match(api,/scenario_count/);
  assert.match(api,/adversarial_scenarios/);
  assert.match(api,/bis_scenarios/);
  assert.match(api,/ecb_scenarios/);
  assert.match(app,/Last regret update/);
  assert.match(app,/Cycle \$\{num\(ag\.research_cycle/);
});

test('report states matrix gate timing and that human recompute is outside regret metric',()=>{
  assert.match(report,/G3 Robust Validation 완료 후 Matrix\/Funnel이 생성/);
  assert.match(report,/G5 Recompute Confirmed 완료 시 Human 열까지/);
  assert.match(report,/Human Recompute 결과는 이 regret 값 자체에 포함되지 않는다/);
});
