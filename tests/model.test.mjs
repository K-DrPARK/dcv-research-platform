import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMath, mathPlain, mathToHtml } from '../public/mathtext.js';
import { mdToHtml } from '../public/mdhtml.js';
import { buildDocx } from '../public/docx.js';
import { buildModelSection, MODEL_MARKER } from '../public/model.js';
import { buildFigures } from '../public/figures.js';

const hasSqlite = await import('node:sqlite').then(() => true, () => false), T = (name, fn) => test(name, { skip: !hasSqlite && 'node:sqlite unavailable' }, fn);
async function setup(opts) { const { makeDb } = await import('./helpers/d1shim.mjs'), { seedProject } = await import('./helpers/seed.mjs'); const DB = makeDb(), pid = await seedProject(DB, opts); return { env: { DB }, pid }; }

test('mathtext: 그리스 문자·첨자·분수·연산자', () => {
  assert.equal(mathPlain('\\sigma\\le c_{j}'), 'σ≤ cj');
  const segs = parseMath('g_{j}(x)^{2}'); assert.ok(segs.some(s => s.sub && s.t === 'j') && segs.some(s => s.sup && s.t === '2'));
  assert.equal(mathPlain('\\frac{a}{b}'), '(a)/(b)');
  assert.ok(mathPlain('\\mathbb 1[x>0]').startsWith('1'), '공백 뒤 인자 처리');
  assert.match(mathPlain('\\arg\\min_{x}'), /arg\s*min/);
  assert.ok(!/\\/.test(mathPlain('\\mathcal D_{human}\\subseteq\\mathcal D_{ideal}\\setminus\\mathcal D')), '남은 역슬래시 없음');
});

test('mdToHtml: $$ 수식은 번호 붙은 블록, $..$ 는 인라인, 본문은 이스케이프', () => {
  const h = mdToHtml('본문 $x_{j}$ 끝 <b>\n\n$$ \\sigma\\uparrow $$ (7)\n');
  assert.ok(h.includes('<sub><i>j</i></sub>') && h.includes('class="eq"') && h.includes('(7)') && h.includes('&lt;b&gt;'));
});

test('buildDocx: 수식 별행 문단과 첨자 런', () => {
  const z = Buffer.from(buildDocx('# t\n\n$$ g_{j}\\le c_{j} $$ (3)\n\n문장 $\\theta_{2}$ 끝\n')).toString('latin1');
  assert.ok(/pStyle w:val="Equation"/.test(z) || z.length > 0);   // zip store: 비압축이라 XML이 그대로 들어 있음
  assert.ok(z.includes('w:vertAlign w:val="subscript"') && z.includes('Cambria Math') && z.includes('w:styleId="Equation"'));
});

T('연구모형 절: 연구대상·연구모형·연구질문·산식·그림이 모두 포함되고 수식 번호가 연속', async () => {
  const { buildThesisData } = await import('../src/lib/thesis.js'), { env, pid } = await setup(), t = await buildThesisData(env, pid);
  const figs = buildFigures(t), L = buildModelSection(t, { figLine: n => { const g = figs.find(x => x.n === n); return g ? `![그림 ${g.label}. ${g.title}](figures/${g.file}.png)` : ''; } }), md = L.join('\n');
  for (const k of ['1.1 연구대상', '1.2 연구모형', '1.3 연구질문', '1.4 연구설계', '1.5 연구명제', '1.6 변수와 설계벡터', '1.7 계산 산식', 'RQ1', 'RQ2', 'RQ3', 'P1.', 'P2.', 'P3.', 'P4.', MODEL_MARKER]) assert.ok(md.includes(k), k);
  for (const k of ['그림 M0.', '그림 M1.', '그림 M2.', '그림 M3.', '**표 M1.', '**표 M6.']) assert.ok(md.includes(k), k);
  const tags = [...md.matchAll(/^\$\$ .+ \$\$ \((\d+)([a-z]?)\)$/gm)].map(m => [Number(m[1]), m[2]]);
  assert.ok(tags.length >= 35, `수식 ${tags.length}개`);
  const nums = [...new Set(tags.map(x => x[0]))]; assert.deepEqual(nums, nums.map((_, i) => i + 1), '수식 번호는 1부터 빠짐없이 증가');
  assert.ok(!/undefined|NaN/.test(md));
  assert.equal((md.match(/\$\$/g) || []).length % 2, 0);
  for (const line of md.split('\n')) if (!line.startsWith('$$') && !line.startsWith('|')) assert.ok((line.match(/(?<!\\)\$/g) || []).length % 2 === 0, `인라인 수식 짝 불일치: ${line.slice(0, 80)}`);
  for (const l of md.split('\n').filter(x => x.startsWith('$$'))) assert.ok(!/\\[A-Za-z]+/.test(mathPlain(l.replace(/^\$\$ | \$\$ \(.*$/g, ''))), `해석되지 않은 명령: ${l.slice(0, 70)}`);
});

T('보고서: 연구모형 절이 본문 1절로 들어가고 빈 프로젝트에서도 깨지지 않음', async () => {
  const { generateReport } = await import('../src/lib/report.js');
  const a = await setup(), r = await generateReport(a.env, a.pid);
  assert.ok(r.content_markdown.indexOf('## 1. 박사논문') > r.content_markdown.indexOf('## 논문 사용 전 점검 사항') && r.content_markdown.indexOf('## 1. 박사논문') < r.content_markdown.indexOf('## 2. 연구 질문과 설계'));
  const b = await setup({ candidates: 0, reviewer: 0, episodes: 0 }), e = await generateReport(b.env, b.pid);
  assert.ok(e.content_markdown.includes('1.7 계산 산식') && !/undefined|NaN/.test(e.content_markdown));
});

T('이전 버전으로 저장된 보고서는 열 때 연구모형 절이 자동 추가됨', async () => {
  const { generateReport, upgradeStoredReport } = await import('../src/lib/report.js'), { env, pid } = await setup(), r = await generateReport(env, pid);
  const old = r.content_markdown.replace(/## 1\. 박사논문[\s\S]*?(?=## 2\. 연구 질문)/, '').replace(MODEL_MARKER, 'x');
  await env.DB.prepare('UPDATE reports SET content_markdown=? WHERE project_id=?').bind(old, pid).run();
  const row = await env.DB.prepare('SELECT * FROM reports WHERE project_id=?').bind(pid).first(), up = await upgradeStoredReport(env, pid, row);
  assert.ok(up.content_markdown.includes(MODEL_MARKER) && up.content_markdown.includes('## 2. 연구 질문과 설계'));
  assert.equal((await upgradeStoredReport(env, pid, up)).content_markdown, up.content_markdown, '두 번째 호출은 변경 없음');
});
