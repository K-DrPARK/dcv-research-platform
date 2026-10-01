import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_PRESETS } from '../src/lib/source_presets.js';

test('recommended official source presets cover empirical, payments and public-payment second-case layers',()=>{
  const ids=new Set(SOURCE_PRESETS.map(x=>x.id));
  for(const id of ['fdic_failures','fdic_financials','fdic_sod','bis_cpmi','bis_credit_gap','ecb_supervisory','bok_ecos','openfiscal','bojo_openapi']) assert.ok(ids.has(id),id);
  assert.ok(SOURCE_PRESETS.every(x=>x.official===true));
  assert.equal(SOURCE_PRESETS.find(x=>x.id==='fdic_sod').integration,'direct_api');
});
