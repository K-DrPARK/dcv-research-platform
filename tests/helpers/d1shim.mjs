import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// 실제 SQLite(node:sqlite) 위에 D1 인터페이스(prepare/bind/first/all/run/batch)를 얹은 테스트용 shim
export function makeDb() {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '../../migrations');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  const stmt = (sql, binds = []) => ({
    bind: (...b) => stmt(sql, b),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    run: async () => { const r = db.prepare(sql).run(...binds); return { meta: { changes: r.changes } }; },
    _run: () => db.prepare(sql).run(...binds)
  });
  return { raw: db, prepare: sql => stmt(sql), batch: async list => { db.exec('BEGIN'); try { const out = list.map(s => s._run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
