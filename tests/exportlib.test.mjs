import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipStore, crc32 } from '../public/zip.js';
import { mdToHtml } from '../public/mdhtml.js';

test('crc32 matches the standard check value', () => { assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926); });

const hasPy = (() => { try { execFileSync('python3', ['--version']); return true; } catch { return false; } })();
const hasSqlite = await import('node:sqlite').then(() => true, () => false);
test('zipStore output is a valid archive with UTF-8 names and intact content', { skip: !hasPy && 'python3 unavailable' }, () => {
  const files = [{ name: 'report.md', data: '# 제목\n한글 본문' }, { name: 'figures/fig1_한글.svg', data: '<svg/>' }, { name: 'tables/empty.csv', data: new Uint8Array(0) }, { name: 'bin.dat', data: Uint8Array.from({ length: 5000 }, (_, i) => i % 251) }];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-')), f = path.join(dir, 't.zip'); fs.writeFileSync(f, zipStore(files));
  let py; try { py = execFileSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("|".join(z.namelist()));print(z.read("report.md").decode("utf8").replace("\\n","/"));print(len(z.read("bin.dat")))`, f]).toString().trim().split('\n'); } catch (e) { assert.fail(`python zipfile rejected archive: ${e.message}`); }
  assert.equal(py[0], 'report.md|figures/fig1_한글.svg|tables/empty.csv|bin.dat'); assert.equal(py[1], '# 제목/한글 본문'); assert.equal(py[2], '5000');
});

test('mdToHtml renders headings, tables, lists, figures and escapes HTML', () => {
  const md = '# 제목\n\n> 인용 <b>x</b>\n\n**표 1. 예시**\n\n| A | B |\n|---|---|\n| 1 | **굵게** |\n\n- 항목1\n- 항목2\n\n![그림 1. 캡션](figures/a.png)\n\n*그림 1. 캡션*\n\n본문 <script>alert(1)</script> 끝';
  const h = mdToHtml(md, { figure: (alt, src) => `<figure data-src="${src}"></figure>` });
  assert.ok(h.includes('<h1>제목</h1>') && h.includes('<table>') && h.includes('<th>A</th>') && h.includes('<strong>굵게</strong>'));
  assert.ok(h.includes('<ul><li>항목1</li><li>항목2</li></ul>') && h.includes('data-src="figures/a.png"'));
  assert.ok(h.includes('class="tcap"') && h.includes('class="fcap"'));
  assert.ok(!h.includes('<script>') && h.includes('&lt;script&gt;') && !h.includes('<b>x</b>'));
});

test('generated report converts to HTML without leftover markdown table syntax', { skip: !hasSqlite && 'node:sqlite unavailable' }, async () => {
  const { makeDb } = await import('./helpers/d1shim.mjs'), { seedProject } = await import('./helpers/seed.mjs'), { generateReport } = await import('../src/lib/report.js');
  const DB = makeDb(), pid = await seedProject(DB), r = await generateReport({ DB }, pid), h = mdToHtml(r.content_markdown, { figure: (a, s) => `<figure>${s}</figure>` });
  const mdTables = (r.content_markdown.match(/^\|(---\|)+$/gm) || []).length;
  assert.ok(mdTables >= 12, `expected >=12 tables, got ${mdTables}`); // 표 1~11 + 부록 B
  assert.equal((h.match(/<table>/g) || []).length, mdTables);
  assert.ok(!/^\|/m.test(h.replace(/<[^>]+>/g, '\n')) , 'no raw pipe rows');
});
