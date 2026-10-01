import fs from 'node:fs';
const raw=fs.readFileSync('wrangler.jsonc','utf8');
const m=raw.match(/"database_id"\s*:\s*"([^"]+)"/);
if(!m) throw new Error('wrangler.jsonc database_id not found');
const actual=m[1], expected=process.env.DCV_EXPECTED_D1_DATABASE_ID||'';
if(expected && actual!==expected){
  console.error(`D1 BINDING MISMATCH: expected ${expected}, wrangler has ${actual}`);
  process.exit(2);
}
console.log(expected?`D1 binding verified: ${actual}`:`D1 binding check: ${actual} (set DCV_EXPECTED_D1_DATABASE_ID to lock this in CI)`);
