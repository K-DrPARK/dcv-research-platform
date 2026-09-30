import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleDesign } from '../src/lib/compute.js';

const design={sigma:[0.05,0.12,0.20,0.30,0.42],tau:[0,1,2],alpha:[0.12,0.30,0.55,0.78],K:[0,1,2,3],d:[0,1,2,4],W:[0.05,0.12,0.22],m:[0.08,0.15,0.25],estimators:['ema','kalman','changepoint','adaptive']};

test('sampleDesign returns max unique deterministic points without full grid', () => {
  const a=sampleDesign(design,128,42), b=sampleDesign(design,128,42);
  assert.equal(a.length,128);
  assert.equal(new Set(a.map(x=>JSON.stringify(x))).size,128);
  assert.deepEqual(a,b);
  assert.equal(new Set(a.map(x=>x.estimator)).size,4);
});

test('sampleDesign enumerates everything when the grid is small', () => {
  const small={sigma:[0.1,0.2],tau:[0],alpha:[0.5],K:[1],d:[0],W:[0.1],m:[0.1],estimators:['ema','kalman']};
  assert.equal(sampleDesign(small,128,1).length,4);
});

test('sampleDesign is fast enough for a 10 ms CPU budget', () => {
  sampleDesign(design,128,1);
  const t=performance.now(); sampleDesign(design,128,7); const ms=performance.now()-t;
  assert.ok(ms<8,`took ${ms.toFixed(1)}ms`);
});
