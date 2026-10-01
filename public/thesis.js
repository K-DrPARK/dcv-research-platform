// 논문 도구: 그림(PNG/SVG) · 표(CSV) · 보고서(Word .docx / Markdown+그림 ZIP / HTML) · 패키지(ZIP) 다운로드, 보고서 미리보기
import { buildFigures } from './figures.js';
import { mdToHtml, buildHtmlDocument } from './mdhtml.js';
import { buildDocx } from './docx.js';
import { zipStore } from './zip.js';

const D = window.DCV, $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TABLES = [['candidates', '후보 설계·성능 결과'], ['simulation_runs', '시뮬레이션 실행 기록'], ['validations', '검증 결과'], ['reviewer_observations', '인간 검토자 관측'], ['episodes', '위기 사례 패널'], ['audit_log', '감사 로그 (재현성 증빙)']];
const stamp = () => new Date().toISOString().slice(0, 10);
const safeName = s => String(s || 'dcv').replace(/[^\w가-힣.-]+/g, '_').slice(0, 40);

function download(blob, name) { const a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
const textBlob = (s, type) => new Blob([s], { type: `${type};charset=utf-8` });
async function authFetch(path, opts = {}) { const h = { 'cache-control':'no-cache', ...(opts.headers || {}) }, t = D.token(); if (t) h.authorization = `Bearer ${t}`; const r = await fetch(path, { cache:'no-store', ...opts, headers: h }); if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(j.error || r.statusText); e.status = r.status; throw e; } return r; }
const needProject = () => { if (!D.current()) { alert('먼저 프로젝트를 선택하세요.'); return null; } return D.current(); };

export async function svgToPngBlob(svg, w, h, scale = 3) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })), img = new Image();
  try { await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('SVG를 이미지로 변환하지 못했습니다')); img.src = url; }); } finally { URL.revokeObjectURL(url); }
  const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('PNG 생성 실패')), 'image/png'));
}
const blobToU8 = async b => new Uint8Array(await b.arrayBuffer());

// /thesis 는 D1 을 수천 행 읽는 무거운 집계다. 창을 열 때(renderFigCards)만 새로 받고, 이후 Word/MD/HTML/JSON/ZIP/그림 저장은
// 90초 동안 받아 둔 사본을 재사용한다(이전: 버튼을 누를 때마다 재조회). 오래된 사본은 자동으로 다시 받는다.
const THESIS_TTL_MS = 90_000;
const cache = { id: null, thesis: null, figs: null, at: 0, signature:null };
window.addEventListener('dcv:project-loaded',ev=>{
  const d=ev.detail||{},sig=`${d.id||''}|${Number(d.cycle||1)}|${Number(d.revision||0)}`;
  if(cache.signature&&cache.signature!==sig)Object.assign(cache,{id:null,thesis:null,figs:null,at:0});
  cache.signature=sig;
});
async function loadThesis(force = false) {
  const id = needProject(); if (!id) throw new Error('no_project');
  if (!force && cache.id === id && cache.thesis && Date.now() - cache.at < THESIS_TTL_MS) return cache;
  const t = await (await authFetch(`/api/projects/${id}/thesis`)).json();
  Object.assign(cache, { id, thesis: t, figs: buildFigures(t), at: Date.now() }); return cache;
}
async function loadReportMd() { try { const r = await (await authFetch(`/api/projects/${D.current()}/report`)).json(); return r.content_markdown || null; } catch (e) { if (e.status === 404) return null; throw e; } }

function figureKey(src=''){
  try{src=decodeURIComponent(String(src));}catch{}
  return (src.split(/[?#]/)[0].split('/').pop()||'').replace(/\.(?:png|svg|jpg|jpeg|webp)$/i,'');
}
function figureResolver(figs=[]) {
  return (alt, src) => {
    const key=figureKey(src);
    let f=figs.find(x=>x.file===key);
    if(!f){
      const n=/fig(?:ure)?[_-]?(?:M)?(\d+)/i.exec(key)?.[1]||/그림\s*(\d+)/.exec(String(alt||''))?.[1];
      if(n)f=figs.find(x=>String(x.n)===String(Number(n)));
    }
    if(!f)return `<figure class="figure-missing" data-figure="${esc(key)}"><div>그림을 불러오지 못했습니다 · ${esc(alt||key)}</div></figure>`;
    return `<figure data-figure="${esc(f.file)}">${f.svg}${f.render_status==='fallback'?`<figcaption>Figure renderer fallback · ${esc(f.render_error||'')}</figcaption>`:''}</figure>`;
  };
}
const figureLoadingResolver=(alt,src)=>`<figure class="figure-loading" data-figure="${esc(figureKey(src))}"><div>그림 불러오는 중… · ${esc(alt||'')}</div></figure>`;

/* ---------- 빠른 그림 저장 (위임 가능 영역 패널) ---------- */
async function quickFigure(kind) {
  const btns = document.querySelectorAll('.fig-quick button'); btns.forEach(b => b.disabled = true);
  try { const { figs } = await loadThesis(); const f = figs.find(x => x.n === 1); if (!f) { alert('후보 데이터가 아직 없어 그림을 만들 수 없습니다.'); return; }
    if (kind === 'svg') download(textBlob(f.svg, 'image/svg+xml'), `${f.file}.svg`); else download(await svgToPngBlob(f.svg, f.width, f.height, 3), `${f.file}.png`);
    D.toast(`그림 1 (${kind.toUpperCase()}) 저장됨`);
  } catch (e) { if (e.message !== 'no_project') alert(`그림 저장 실패: ${e.message}`); } finally { btns.forEach(b => b.disabled = false); }
}

/* ---------- 논문 도구 모달 ---------- */
function ensureModal() {
  if ($('#thesisModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="modal fade" id="thesisModal" tabindex="-1"><div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content future-modal"><div class="modal-header"><h5 class="modal-title"><i class="bi bi-mortarboard"></i> 논문 도구 (Thesis Toolkit)</h5><small id="thesisStatus" class="ms-auto me-3 text-secondary"></small><button class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div><div class="modal-body thesis-body">
  <section><h6>① 논문 패키지 (권장)</h6><p class="text-secondary small mb-2">보고서(Word .docx·Markdown·HTML) + 그림(PNG 고해상도·SVG 벡터) + 표(CSV) + 원자료(JSON)를 ZIP 하나로 내려받습니다.</p><div class="d-flex flex-wrap gap-2 align-items-center"><button class="btn-future" data-act="pkg"><i class="bi bi-file-earmark-zip"></i> 논문 패키지 ZIP</button><label class="small text-secondary">PNG 해상도 <select id="pngScale" class="form-select form-select-sm d-inline-block w-auto"><option value="2">×2</option><option value="3" selected>×3 (6인치 폭 ≈ 360dpi)</option><option value="4">×4</option></select></label></div></section>
  <section><h6>② 보고서 (편집 가능한 파일)</h6><div class=\"d-flex flex-wrap gap-2\"><button class=\"btn-future\" data-act=\"docx\"><i class=\"bi bi-file-earmark-word\"></i> Word (.docx) — 표·그림 포함</button><button class=\"btn-ghost\" data-act=\"mdzip\"><i class=\"bi bi-markdown\"></i> Markdown + 그림 (ZIP)</button><button class=\"btn-ghost\" data-act=\"md\">Markdown (텍스트만)</button><button class=\"btn-ghost\" data-act=\"html\">HTML (인쇄·PDF용)</button><button class=\"btn-ghost\" data-act=\"report-regen\"><i class=\"bi bi-stars\"></i> 보고서 새로 생성 (AI 요약)</button></div><p class=\"text-secondary small mt-2 mb-0\"><b>Word(.docx)</b>: 표는 Word 표로, 그림은 PNG로 본문에 삽입되어 그대로 편집·인쇄할 수 있습니다. <b>Markdown</b>은 그림을 파일로 참조하므로 그림이 보이려면 <b>ZIP</b>(report.md + figures/)을 받아 압축을 풀어 여세요. PDF는 HTML을 열어 인쇄(Ctrl+P) → “PDF로 저장”.</p></section>
  <section><h6>③ 그림 (논문 삽입용 · 흰 배경)</h6><div id="thesisFigs" class="fig-grid"><span class="text-secondary small">불러오는 중…</span></div></section>
  <section><h6>④ 표·원자료 (CSV, Excel에서 한글 정상 표시)</h6><div class="d-flex flex-wrap gap-2" id="thesisTables">${TABLES.map(([k, l]) => `<button class="btn-ghost" data-act="csv" data-name="${k}"><i class="bi bi-filetype-csv"></i> ${l}</button>`).join('')}<button class="btn-ghost" data-act="json"><i class="bi bi-filetype-json"></i> 전체 집계(JSON)</button></div></section>
  </div></div></div></div>`);
  $('#thesisModal').addEventListener('click', onModalClick);
}
const setStatus = s => { const el = $('#thesisStatus'); if (el) el.textContent = s || ''; };

async function renderFigCards() {
  const box = $('#thesisFigs'); box.innerHTML = '<span class="text-secondary small">불러오는 중…</span>';
  try { const { figs } = await loadThesis(true);
    box.innerHTML = figs.length ? figs.map(f => `<div class="fig-card"><div class="fig-prev">${f.svg}</div><div class="fig-cap"><b>그림 ${f.label || f.n}.</b> ${esc(f.title)}</div><div class="d-flex gap-2"><button class="btn-ghost" data-act="fig-png" data-n="${f.n}">PNG</button><button class="btn-ghost" data-act="fig-svg" data-n="${f.n}">SVG</button></div></div>`).join('') : '<span class="text-secondary small">표시할 그림이 없습니다. 후보 계산·검토자 관측·사례 패널이 쌓이면 자동으로 나타납니다.</span>';
  } catch (e) { box.innerHTML = `<span class="text-danger small">불러오기 실패: ${esc(e.message)}</span>`; }
}

async function reportOrAsk() { let md = await loadReportMd(); if (md) return md; if (!confirm('보고서가 아직 없습니다. 지금 생성할까요? (AI 요약 포함, 최대 30초)')) return null; setStatus('보고서 생성 중…'); const r = await (await authFetch(`/api/projects/${D.current()}/report`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).json(); return r.content_markdown; }

async function renderPngs(figs, scale) {
  const blobs = {}; for (const f of figs) { setStatus(`그림 ${f.n} PNG 변환 중…`); blobs[f.file] = await svgToPngBlob(f.svg, f.width, f.height, scale); } return blobs;
}
async function buildReportFiles(md, figs, scale) {
  const title = (/^#\s+(.+)$/m.exec(md) || [, 'DCV 연구 보고서'])[1], pngBlobs = await renderPngs(figs, scale), images = {};
  for (const f of figs) images[f.file] = { data: await blobToU8(pngBlobs[f.file]), w: f.width, h: f.height };
  setStatus('Word 문서 구성 중…');
  return { title, html: buildHtmlDocument(title, mdToHtml(md, { figure: figureResolver(figs) })), docx: buildDocx(md, { images, title }), pngBlobs };
}
const MD_README = (t) => `DCV 보고서 (Markdown + 그림)\n생성: ${t.generated_at}\n프로젝트: ${t.project.name} (${t.project.id})\n\nreport.md   보고서 원문. 그림은 figures/ 폴더의 PNG를 상대경로로 참조합니다.\nfigures/    그림 PNG(고해상도) · SVG(벡터, 편집 가능)\n\n※ Typora, VS Code(미리보기), Obsidian 등에서 report.md를 열면 표·그림이 함께 보입니다.\n※ report.md만 따로 옮기면 그림 링크가 끊어집니다. 폴더째 보관하세요.\n`;

async function onModalClick(ev) {
  const b = ev.target.closest('button[data-act]'); if (!b) return;
  await runAction(b.dataset.act, b.dataset, [...document.querySelectorAll('#thesisModal button[data-act]')]);
}
async function runAction(act, data = {}, btns = []) {
  const id = D.current(); if (!id) return; btns.forEach(x => x.disabled = true);
  try {
    const scale = Number($('#pngScale')?.value || 3);
    if (act === 'fig-png' || act === 'fig-svg') { const f = cache.figs.find(x => x.n === Number(data.n)); if (act === 'fig-svg') download(textBlob(f.svg, 'image/svg+xml'), `${f.file}.svg`); else download(await svgToPngBlob(f.svg, f.width, f.height, scale), `${f.file}.png`); }
    else if (act === 'csv') { const r = await authFetch(`/api/projects/${id}/export/${data.name}.csv`); download(await r.blob(), `${data.name}_${stamp()}.csv`); }
    else if (act === 'json') { const { thesis } = await loadThesis(); download(textBlob(JSON.stringify(thesis, null, 2), 'application/json'), `thesis_data_${stamp()}.json`); }
    else if (act === 'report-regen') { setStatus('보고서 생성 중… (최대 30초)'); await authFetch(`/api/projects/${id}/report`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }); setStatus('보고서 생성 완료'); await renderFigCards(); }
    else if (['md', 'mdzip', 'html', 'docx'].includes(act)) {
      const md = await reportOrAsk(); if (!md) return; const { thesis, figs } = await loadThesis();
      if (act === 'md') download(textBlob(md, 'text/markdown'), `report_${stamp()}.md`);
      else if (act === 'mdzip') {
        const pngs = await renderPngs(figs, scale), files = [{ name: 'README.txt', data: MD_README(thesis) }, { name: 'report.md', data: md }];
        for (const f of figs) { files.push({ name: `figures/${f.file}.png`, data: await blobToU8(pngs[f.file]) }, { name: `figures/${f.file}.svg`, data: f.svg }); }
        download(new Blob([zipStore(files)], { type: 'application/zip' }), `report_markdown_${safeName(thesis.project.name)}_${stamp()}.zip`); D.toast('Markdown + 그림 ZIP 저장됨');
      } else {
        const r = await buildReportFiles(md, figs, scale);
        if (act === 'html') download(textBlob(r.html, 'text/html'), `report_${stamp()}.html`);
        else { download(new Blob([r.docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `report_${safeName(thesis.project.name)}_${stamp()}.docx`); D.toast('Word 문서(.docx) 저장됨'); }
      }
    } else if (act === 'pkg') {
      const md = await reportOrAsk(); if (!md) return; const { thesis, figs } = await loadThesis(); setStatus('패키지 구성 중…');
      const r = await buildReportFiles(md, figs, scale), files = [];
      files.push({ name: 'report.docx', data: r.docx }, { name: 'report.md', data: md }, { name: 'report.html', data: r.html }, { name: 'data/thesis_data.json', data: JSON.stringify(thesis, null, 2) });
      for (const f of figs) { files.push({ name: `figures/${f.file}.svg`, data: f.svg }); files.push({ name: `figures/${f.file}.png`, data: await blobToU8(r.pngBlobs[f.file]) }); }
      for (const [k] of TABLES) { setStatus(`표 ${k} 내려받는 중…`); files.push({ name: `tables/${k}.csv`, data: new Uint8Array(await (await authFetch(`/api/projects/${id}/export/${k}.csv`)).arrayBuffer()) }); }
      files.unshift({ name: 'README.txt', data: `DCV Research Platform v${thesis.app_version} 논문 패키지\n생성: ${thesis.generated_at}\n프로젝트: ${thesis.project.name} (${thesis.project.id})\n\nreport.docx  Word 보고서 (표·그림 포함, 편집 가능)\nreport.md    보고서 원문 Markdown (그림은 figures/ 경로로 참조)\nreport.html  인쇄·PDF 저장용 (그림 벡터 삽입)\nfigures/     그림 PNG(고해상도)·SVG(벡터, 편집 가능)\ntables/      표·원자료 CSV (UTF-8 BOM, Excel 호환)\ndata/        보고서 수치의 전체 집계 JSON\n\n※ 논문 인용 전 보고서 상단의 '논문 사용 전 점검 사항'을 반드시 확인하세요.\n※ 문장형 요약·논의는 초안입니다. 표의 수치와 직접 대조하세요.\n` });
      download(new Blob([zipStore(files)], { type: 'application/zip' }), `dcv_thesis_package_${safeName(thesis.project.name)}_${stamp()}.zip`);
    }
    if (!['report-regen'].includes(act)) setStatus('완료');
  } catch (e) { if (e.message !== 'no_project') { setStatus(''); alert(`실패: ${e.message}`); } } finally { btns.forEach(x => x.disabled = false); }
}

function openThesisModal() { if (!needProject()) return; ensureModal(); setStatus(''); D.modal('thesisModal').show(); renderFigCards(); }

/* ---------- 버튼 주입 & 보고서 미리보기 ---------- */
function inject() {
  const rb = $('#reportBtn'); if (rb && !$('#thesisBtn')) rb.insertAdjacentHTML('beforebegin', '<button class="btn-ghost" id="thesisBtn"><i class="bi bi-mortarboard"></i> 논문 도구</button>');
  $('#thesisBtn')?.addEventListener('click', openThesisModal);
  const badge = $('#regionBadge'); if (badge && !$('.fig-quick')) badge.insertAdjacentHTML('beforebegin', '<span class="fig-quick"><button class="btn-ghost sm" data-q="png" title="논문용 그림 1을 PNG로 저장">PNG</button><button class="btn-ghost sm" data-q="svg" title="논문용 그림 1을 SVG로 저장">SVG</button></span>');
  document.querySelectorAll('.fig-quick button').forEach(b => b.onclick = () => quickFigure(b.dataset.q));
  const pre = $('#reportText'), modalEl = $('#reportModal'); if (!pre || !modalEl || $('#reportHtml')) return;
  pre.insertAdjacentHTML('afterend', '<div id="reportHtml" class="report-html"></div>');
  const bar = modalEl.querySelector('.modal-header .ms-auto'); bar?.insertAdjacentHTML('afterbegin', '<button type="button" id="reportToggle" class="btn-ghost sm">원문 보기</button><button type="button" id="reportDocxBtn" class="btn-future sm" title="표·그림이 포함된 편집 가능한 Word 문서"><i class="bi bi-file-earmark-word"></i> Word</button><button type="button" id="reportMdzipBtn" class="btn-ghost sm" title="report.md + figures/ (ZIP)"><i class="bi bi-markdown"></i> MD+그림</button><button type="button" id="reportToolsBtn" class="btn-ghost sm"><i class="bi bi-mortarboard"></i> 더보기</button>');
  let raw = false; const view = $('#reportHtml');
  // Render Markdown immediately so tables/headings are never replaced by the raw source view.
  // Figures are hydrated asynchronously from the current thesis snapshot.
  const render = async () => {
    const md = pre.textContent;
    if (!md) { view.innerHTML = ''; return; }
    if (raw) { pre.style.display = ''; view.style.display = 'none'; return; }
    pre.style.display = 'none'; view.style.display = '';
    view.innerHTML = mdToHtml(md,{figure:figureLoadingResolver});
    if (!D.current()) return;
    try {
      let payload;
      try{payload=await loadThesis();}catch{payload=await loadThesis(true);}
      view.innerHTML = mdToHtml(md, { figure: figureResolver(payload.figs||[]) });
    }
    catch (e) {
      view.querySelectorAll('.figure-loading').forEach(el=>{el.className='figure-missing';el.innerHTML=`<div>그림 데이터 로드 실패 · ${esc(e.message||e)}</div>`;});
    }
  };
  window.DCVReportRender = render;
  $('#reportToggle').onclick = () => { raw = !raw; $('#reportToggle').textContent = raw ? '보기 좋게' : '원문 보기'; render(); };
  for (const [sel, act] of [['#reportDocxBtn', 'docx'], ['#reportMdzipBtn', 'mdzip']]) $(sel).onclick = () => runAction(act, {}, [...document.querySelectorAll('#reportModal .modal-header button')]);
  $('#reportToolsBtn').onclick = () => { D.modal('reportModal').hide(); setTimeout(openThesisModal, 350); };
  modalEl.addEventListener('shown.bs.modal', render);
  new MutationObserver(() => { if (modalEl.classList.contains('show')) render(); }).observe(pre, { childList: true, characterData: true, subtree: true });
}
inject();
