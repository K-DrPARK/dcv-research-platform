import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDb} from './helpers/d1shim.mjs';
import {seedProject} from './helpers/seed.mjs';
import {ensureFrozenProtocol} from '../src/lib/rigor.js';
import {bust} from '../src/lib/memo.js';
test('new research cycles allocate globally unique protocol versions and preserve earlier protocols',async()=>{const DB=makeDb(),id=await seedProject(DB,{candidates:0,reviewer:0,episodes:0}),env={DB};const first=await ensureFrozenProtocol(env,id);assert.equal(first.version,1);DB.raw.exec('UPDATE projects SET research_cycle=3');bust(env,id);const next=await ensureFrozenProtocol(env,id);assert.equal(next.version,2);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM research_protocols').get().n,2);assert.equal(DB.raw.prepare('SELECT research_cycle FROM research_protocols WHERE version=1').get().research_cycle,1);const repeated=await ensureFrozenProtocol(env,id);assert.equal(repeated.id,next.id);DB.raw.exec('UPDATE projects SET research_cycle=4');bust(env,id);assert.equal((await ensureFrozenProtocol(env,id)).version,3);});
