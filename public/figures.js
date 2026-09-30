// 논문 삽입용 그림 생성기 (순수 함수: thesis JSON → SVG 문자열). 브라우저와 Node 테스트에서 공용.
// 흰 배경·검정 글자·색각 이상 친화 팔레트(Okabe-Ito)·흑백 인쇄에서도 구분되도록 마커 모양/수치 라벨 병기.
const FONT = `'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo','Nanum Gothic',Arial,sans-serif`;
const C = { ok: '#009E73', warn: '#E69F00', bad: '#D55E00', blue: '#0072B2', sky: '#56B4E9', ink: '#111', grid: '#d9d9d9', mute: '#555' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EST = { ema: 'EMA', kalman: 'Kalman', changepoint: 'Change-point', adaptive: 'Adaptive' };
const estName = e => EST[e] || e;
const fx = (v, d = 2) => Number(v).toFixed(d).replace(/\.?0+$/, '') || '0';
const pct = v => `${Math.round(v * 100)}%`;

export function figureCatalog(t) {
  const figs = [
    { n: 11, label: 'M1', file: 'figM1_research_model', title: '박사논문 연구모형: 데이터–결정 사슬과 위임 가능 영역 D의 정의' },
    { n: 12, label: 'M2', file: 'figM2_dcv_design', title: '연구설계: Define–Compute–Validate–Confirm 단계, 게이트, 논문 3편의 대응 및 현재 프로젝트 진행 상태' },
    { n: 13, label: 'M3', file: 'figM3_region_concept', title: '위임 가능 영역 개념도 (모식도): 이상적 검토자 영역과 실제 검토자 영역' }
  ];
  if (t.candidates.cells.length) figs.push({ n: 1, file: 'fig1_feasible_region_heatmap', title: 'σ×α 평면의 위임 가능 후보 비율 (셀 내 CONFIRMED / 전체 후보)' });
  if (t.candidates.estimators.length) figs.push({ n: 2, file: 'fig2_estimator_feasibility', title: '추정기별 위임 가능 비율과 95% Wilson 신뢰구간' });
  if (t.candidates.finalists.length) figs.push({ n: 3, file: 'fig3_regret_ranking', title: '강건 후보의 Minimax Regret 순위 (낮을수록 우수)' });
  if (t.reviewer.by_confidence.length) figs.push({ n: 4, file: 'fig4_reviewer_reliance', title: 'AI 신뢰도별 인간 검토자 수용률 (AI 정답/오답 구분, 95% CI)' });
  if (t.empirical.panel.n) figs.push({ n: 5, file: 'fig5_episode_panel', title: '위기 사례 패널: 최대 유출률 대비 심각도 (파산 여부 구분)' });
  return figs;
}

function wrap(w, h, body, desc) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}" role="img" aria-label="${esc(desc)}"><title>${esc(desc)}</title><rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>`;
}
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 13}" fill="${o.fill || C.ink}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.rot ? ` transform="rotate(${o.rot} ${x} ${y})"` : ''}>${esc(s)}</text>`;
function niceTicks(lo, hi, n = 5) {
  if (hi <= lo) hi = lo + 1; const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0)), k = step0 / mag, step = (k < 1.5 ? 1 : k < 3 ? 2 : k < 7 ? 5 : 10) * mag;
  const a = Math.floor(lo / step) * step, out = []; for (let v = a; v <= hi + step * 0.5; v += step) out.push(Math.round(v / step) * step); return out;
}
const legendRow = (x, y, items) => items.map((it, i) => `<g transform="translate(${x + i * (it.w || 150)},${y})">${it.mark}${text(18, 4, it.label, { size: 12 })}</g>`).join('');

export function figHeatmap(t) {
  const cells = t.candidates.cells, W = 720, H = 540, m = { l: 84, r: 118, t: 30, b: 74 };
  const xs = [...new Set(cells.map(c => c.sigma))].sort((a, b) => a - b), ys = [...new Set(cells.map(c => c.alpha))].sort((a, b) => b - a);
  const cw = (W - m.l - m.r) / xs.length, ch = (H - m.t - m.b) / ys.length, map = new Map(cells.map(c => [`${c.sigma}|${c.alpha}`, c]));
  const shade = s => { const k = Math.max(0, Math.min(1, s)); const r = Math.round(247 - k * (247 - 8)), g = Math.round(251 - k * (251 - 81)), b = Math.round(255 - k * (255 - 156)); return `rgb(${r},${g},${b})`; };
  let body = '';
  ys.forEach((y, j) => xs.forEach((x, i) => {
    const c = map.get(`${x}|${y}`), px = m.l + i * cw, py = m.t + j * ch, s = c ? c.share : null;
    body += `<rect x="${px}" y="${py}" width="${cw}" height="${ch}" fill="${c ? shade(s) : '#f2f2f2'}" stroke="#fff" stroke-width="2"/>`;
    if (c) body += text(px + cw / 2, py + ch / 2 - 2, pct(s), { anchor: 'middle', size: 15, weight: 700, fill: s > 0.55 ? '#fff' : C.ink }) + text(px + cw / 2, py + ch / 2 + 15, `${c.confirmed}/${c.total}`, { anchor: 'middle', size: 11, fill: s > 0.55 ? '#fff' : C.mute });
  }));
  xs.forEach((x, i) => { body += text(m.l + i * cw + cw / 2, H - m.b + 20, fx(x), { anchor: 'middle' }); });
  ys.forEach((y, j) => { body += text(m.l - 10, m.t + j * ch + ch / 2 + 4, fx(y), { anchor: 'end' }); });
  body += text(m.l + (W - m.l - m.r) / 2, H - 26, 'σ (정보오차)', { anchor: 'middle', size: 14, weight: 700 }) + text(24, m.t + (H - m.t - m.b) / 2, 'α (정보처리 강도)', { anchor: 'middle', size: 14, weight: 700, rot: -90 });
  const bx = W - m.r + 30, bh = H - m.t - m.b;
  for (let i = 0; i < 40; i++) body += `<rect x="${bx}" y="${m.t + bh * i / 40}" width="18" height="${bh / 40 + 0.5}" fill="${shade(1 - i / 39)}"/>`;
  body += `<rect x="${bx}" y="${m.t}" width="18" height="${bh}" fill="none" stroke="${C.ink}" stroke-width=".8"/>` + text(bx + 26, m.t + 10, '100%', { size: 11 }) + text(bx + 26, m.t + bh, '0%', { size: 11 }) + text(bx, m.t - 10, 'CONFIRMED', { size: 11 }) + text(bx, H - 26, `N=${t.candidates.total}`, { size: 11, fill: C.mute });
  return wrap(W, H, body, '시그마-알파 평면의 위임 가능 후보 비율 히트맵');
}

export function figEstimators(t) {
  const es = t.candidates.estimators, W = 720, H = 480, m = { l: 78, r: 30, t: 30, b: 78 }, pw = W - m.l - m.r, ph = H - m.t - m.b, bw = Math.min(90, pw / es.length * 0.55);
  const Y = v => m.t + ph * (1 - v);
  let body = '';
  for (let v = 0; v <= 1.0001; v += 0.2) body += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/>` + text(m.l - 10, Y(v) + 4, pct(v), { anchor: 'end' });
  es.forEach((e, i) => {
    const cx = m.l + pw * (i + 0.5) / es.length, y = Y(e.share || 0);
    body += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${m.t + ph - y}" fill="${C.blue}" opacity=".85"/><line x1="${cx}" x2="${cx}" y1="${Y(e.lo ?? e.share)}" y2="${Y(e.hi ?? e.share)}" stroke="${C.ink}" stroke-width="1.6"/><line x1="${cx - 7}" x2="${cx + 7}" y1="${Y(e.lo ?? e.share)}" y2="${Y(e.lo ?? e.share)}" stroke="${C.ink}" stroke-width="1.6"/><line x1="${cx - 7}" x2="${cx + 7}" y1="${Y(e.hi ?? e.share)}" y2="${Y(e.hi ?? e.share)}" stroke="${C.ink}" stroke-width="1.6"/>`;
    body += text(cx, Math.min(Y(e.hi ?? e.share) - 8, y - 8), pct(e.share || 0), { anchor: 'middle', size: 13, weight: 700 }) + text(cx, m.t + ph + 22, estName(e.estimator), { anchor: 'middle', size: 14 }) + text(cx, m.t + ph + 40, `${e.confirmed}/${e.total}`, { anchor: 'middle', size: 11, fill: C.mute });
  });
  body += `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="${C.ink}"/><line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${C.ink}"/>` + text(22, m.t + ph / 2, '위임 가능(CONFIRMED) 비율', { anchor: 'middle', size: 14, weight: 700, rot: -90 }) + text(m.l + pw / 2, H - 14, '추정기 (오차막대: 95% Wilson CI)', { anchor: 'middle', size: 13 });
  return wrap(W, H, body, '추정기별 위임 가능 비율');
}

export function figRegret(t) {
  const fs = t.candidates.finalists, sel = t.selected?.id, rowH = 34, W = 860, m = { l: 300, r: 70, t: 24, b: 84 }, H = m.t + m.b + fs.length * rowH;
  const max = Math.max(...fs.map(f => f.max_regret ?? 0), 1e-6) * 1.15, ticks = niceTicks(0, max, 5), X = v => m.l + (W - m.l - m.r) * v / max;
  let body = ticks.map(v => `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${H - m.b}" stroke="${C.grid}"/>${text(X(v), H - m.b + 18, fx(v, 3), { anchor: 'middle', size: 11 })}`).join('');
  fs.forEach((f, i) => {
    const y = m.t + i * rowH, isSel = f.id === sel, w = X(f.max_regret ?? 0) - m.l;
    body += text(m.l - 10, y + rowH / 2 + 4, `#${i + 1} ${estName(f.estimator)} σ=${fx(f.sigma)} α=${fx(f.alpha)} K=${f.K} d=${f.d}`, { anchor: 'end', size: 12, weight: isSel ? 700 : 400 }) + `<rect x="${m.l}" y="${y + 6}" width="${Math.max(1, w)}" height="${rowH - 12}" fill="${isSel ? C.ok : C.sky}"/>` + text(m.l + w + 6, y + rowH / 2 + 4, fx(f.max_regret ?? 0, 4), { size: 11 });
  });
  body += `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}" stroke="${C.ink}"/>` + text(m.l + (W - m.l - m.r) / 2, H - 14, 'Maximum regret', { anchor: 'middle', size: 13, weight: 700 }) + (sel ? legendRow(m.l, H - 34, [{ mark: `<rect width="12" height="12" y="-6" fill="${C.ok}"/>`, label: '최종 선택 후보', w: 140 }]) : '');
  return wrap(W, H, body, '강건 후보의 Minimax Regret 순위');
}

export function figReviewer(t) {
  const bc = t.reviewer.by_confidence, W = 720, H = 500, m = { l: 78, r: 30, t: 58, b: 84 }, pw = W - m.l - m.r, ph = H - m.t - m.b, Y = v => m.t + ph * (1 - v), gw = pw / bc.length, bw = Math.min(56, gw * 0.3);
  let body = '';
  for (let v = 0; v <= 1.0001; v += 0.2) body += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/>` + text(m.l - 10, Y(v) + 4, pct(v), { anchor: 'end' });
  const bar = (cx, o, color) => { if (!o.n) return text(cx, Y(0) - 6, 'n=0', { anchor: 'middle', size: 11, fill: C.mute }); return `<rect x="${cx - bw / 2}" y="${Y(o.p)}" width="${bw}" height="${Math.max(1, Y(0) - Y(o.p))}" fill="${color}"/><line x1="${cx}" x2="${cx}" y1="${Y(o.lo)}" y2="${Y(o.hi)}" stroke="${C.ink}" stroke-width="1.5"/><line x1="${cx - 6}" x2="${cx + 6}" y1="${Y(o.lo)}" y2="${Y(o.lo)}" stroke="${C.ink}" stroke-width="1.5"/><line x1="${cx - 6}" x2="${cx + 6}" y1="${Y(o.hi)}" y2="${Y(o.hi)}" stroke="${C.ink}" stroke-width="1.5"/>${text(cx, Y(o.hi) - 6, pct(o.p), { anchor: 'middle', size: 12, weight: 700 })}`; };
  bc.forEach((g, i) => {
    const cx = m.l + gw * (i + 0.5);
    body += bar(cx - bw * 0.6, g.accept_when_correct, C.ok) + bar(cx + bw * 0.6, g.accept_when_wrong, C.bad) + text(cx, m.t + ph + 22, `AI 신뢰도 ${pct(g.confidence)}`, { anchor: 'middle', size: 13 }) + text(cx, m.t + ph + 40, `정답 ${g.correct_n} · 오답 ${g.wrong_n}`, { anchor: 'middle', size: 11, fill: C.mute });
  });
  body += `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="${C.ink}"/><line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${C.ink}"/>` + text(22, m.t + ph / 2, 'AI 권고 수용률', { anchor: 'middle', size: 14, weight: 700, rot: -90 }) + legendRow(m.l, 18, [{ mark: `<rect width="12" height="12" y="-6" fill="${C.ok}"/>`, label: 'AI 정답일 때 수용', w: 170 }, { mark: `<rect width="12" height="12" y="-6" fill="${C.bad}"/>`, label: 'AI 오답일 때 수용 (오수용)', w: 220 }]) + text(m.l + pw / 2, H - 14, `N=${t.reviewer.n}, 참가자 ${t.reviewer.participants}명 (오차막대: 95% Wilson CI)`, { anchor: 'middle', size: 12, fill: C.mute });
  return wrap(W, H, body, 'AI 신뢰도별 인간 검토자 수용률');
}

export function figEpisodes(t) {
  const eps = t.empirical.panel.episodes, W = 720, H = 540, m = { l: 78, r: 30, t: 44, b: 70 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const xmax = Math.max(...eps.map(e => e.peak_outflow ?? 0), 0.05) * 1.08, xt = niceTicks(0, xmax, 6), X = v => m.l + pw * v / xt[xt.length - 1], Y = v => m.t + ph * (1 - v);
  let body = xt.map(v => `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${m.t + ph}" stroke="${C.grid}"/>${text(X(v), m.t + ph + 20, pct(v), { anchor: 'middle', size: 11 })}`).join('');
  for (let v = 0; v <= 1.0001; v += 0.2) body += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/>` + text(m.l - 10, Y(v) + 4, fx(v, 1), { anchor: 'end' });
  for (const e of eps) {
    const x = X(e.peak_outflow ?? 0), y = Y(e.severity ?? 0);
    body += Number(e.failed) === 1 ? `<circle cx="${x}" cy="${y}" r="5" fill="${C.bad}" fill-opacity=".8" stroke="#fff" stroke-width=".8"/>` : `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${C.blue}" stroke-width="1.8"/>`;
  }
  body += `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="${C.ink}"/><line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${C.ink}"/>` + text(22, m.t + ph / 2, '심각도', { anchor: 'middle', size: 14, weight: 700, rot: -90 }) + text(m.l + pw / 2, H - 22, '최대 유출률 (peak outflow)', { anchor: 'middle', size: 14, weight: 700 }) + legendRow(m.l, 22, [{ mark: `<circle r="5" cy="0" fill="${C.bad}" fill-opacity=".8"/>`, label: '파산', w: 90 }, { mark: `<circle r="5" cy="0" fill="none" stroke="${C.blue}" stroke-width="1.8"/>`, label: '비파산', w: 100 }]) + text(W - m.r, 22, `N=${eps.length}`, { anchor: 'end', size: 12, fill: C.mute });
  return wrap(W, H, body, '위기 사례 패널 최대 유출률 대비 심각도');
}


/* ---------- 연구모형·연구설계 그림 (개념도: 데이터가 없어도 항상 생성, 제약값·진행상태는 프로젝트 자료 반영) ---------- */
// 텍스트 안의 X_{sub} 를 tspan 아래첨자로 변환 (baseline-shift 미지원 렌더러 대비 dy 사용)
const SUBMAP = { a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ', 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
function rich(s) {          // X_{sub}: 유니코드 아래첨자가 있으면 그대로, 없으면 dy 이동 tspan(시작 정렬 텍스트에서만 사용)
  const parts = String(s ?? '').split(/(_\{[^}]*\})/); let shifted = false, out = '';
  for (const p of parts) {
    if (/^_\{/.test(p)) { const sub = p.slice(2, -1); if ([...sub].every(ch => SUBMAP[ch])) { out += esc([...sub].map(ch => SUBMAP[ch]).join('')); shifted = false; } else { out += `<tspan dy="3" font-size="0.72em">${esc(sub)}</tspan>`; shifted = true; } }
    else if (p) { out += shifted ? `<tspan dy="-3">${esc(p)}</tspan>` : esc(p); shifted = false; }
  }
  return out;
}
const rtext = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 13}" fill="${o.fill || C.ink}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.italic ? ' font-style="italic"' : ''}>${rich(s)}</text>`;
const box = (x, y, w, h, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 8}" fill="${o.fill || '#fff'}" stroke="${o.stroke || C.ink}" stroke-width="${o.sw || 1.4}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
const arrow = (x1, y1, x2, y2, o = {}) => { const a = Math.atan2(y2 - y1, x2 - x1), L = 9, w = .42, p1 = [x2 - L * Math.cos(a - w), y2 - L * Math.sin(a - w)], p2 = [x2 - L * Math.cos(a + w), y2 - L * Math.sin(a + w)]; return `<line x1="${x1}" y1="${y1}" x2="${x2 - 6 * Math.cos(a)}" y2="${y2 - 6 * Math.sin(a)}" stroke="${o.stroke || C.ink}" stroke-width="${o.sw || 1.6}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/><polygon points="${x2},${y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}" fill="${o.stroke || C.ink}"/>`; };
const num = v => (v == null || !Number.isFinite(Number(v))) ? '-' : String(Number(v));

export function figResearchModel(t) {
  const W = 960, H = 830, cx = 330, bx = 80, bw = 500; let b = '';
  const layer = (y, h, no, title, sub, fill, stroke) => { b += box(bx, y, bw, h, { fill, stroke }) + rtext(bx + 14, y + 22, `${no} ${title}`, { size: 14, weight: 700 }) + rtext(bx + 14, y + 42, sub, { size: 12, fill: '#333' }); };
  b += rtext(bx, 24, '데이터–결정 사슬 (Data–Decision Chain)', { size: 15, weight: 700 });
  // 환경
  b += box(bx, 40, bw, 54, { fill: '#f2f2f2', stroke: C.mute, dash: '5 3' }) + rtext(cx, 62, '환경 불확실성  s ∈ S', { size: 14, weight: 700, anchor: 'middle' }) + rtext(cx, 82, '확률적 충격 · 위기유형 · 계수 불확실성 · 상황변화 (Historical ∪ Synthetic ∪ Adversarial)', { size: 11.5, anchor: 'middle', fill: '#333' });
  const ys = [118, 204, 290, 376];
  layer(ys[0], 66, '①', '데이터 품질', '정보오차 σ │ 시차 τ │ 누락·이상치 │ 변화속도', '#e8f3fb', C.blue);
  layer(ys[1], 66, '②', '정보 처리  E', 'EMA(α) │ Kalman │ 변화점 탐지 │ 적응형 추정기', '#e8f3fb', C.blue);
  layer(ys[2], 66, '③', '알고리즘 판단', '지급 · 지급정지 · 한도조정 · 추가검토 + 신뢰도(confidence)', '#e8f3fb', C.blue);
  layer(ys[3], 66, '④', '위임 권한  K', 'K0 인간전결 │ K1 AI추천+승인 │ K2 일정범위 자동 │ K3 광범위 자동', '#fff4dc', C.warn);
  [0, 1, 2].forEach(i => { b += arrow(cx, ys[i] + 66, cx, ys[i + 1], {}); }); b += arrow(cx, 94, cx, ys[0], {});
  // ⑤ 분기
  const y5 = 474, hw = 240;
  b += box(bx, y5, hw, 64, { fill: '#fff4dc', stroke: C.warn }) + rtext(bx + 12, y5 + 22, '⑤ 인간 검토·승인', { size: 13.5, weight: 700 }) + rtext(bx + 12, y5 + 42, '승인 지연 d · 인간 편향 · 오류수정', { size: 11.5, fill: '#333' });
  b += box(bx + bw - hw, y5, hw, 64, { fill: '#fff4dc', stroke: C.warn }) + rtext(bx + bw - hw + 12, y5 + 22, '⑤ 자동 집행', { size: 13.5, weight: 700 }) + rtext(bx + bw - hw + 12, y5 + 42, '즉시 또는 제한적 실행 (K≥2)', { size: 11.5, fill: '#333' });
  b += arrow(cx - 80, ys[3] + 66, bx + hw / 2, y5) + arrow(cx + 80, ys[3] + 66, bx + bw - hw / 2, y5);
  const y6 = 574; layer(y6, 66, '⑥', '실제 결과', '손실 L │ 부정지급 FP │ 정상지급 차단 FN │ 검토부담 B │ 복구시간 T_{R}', '#fde9e0', C.bad);
  b += arrow(bx + hw / 2, y5 + 64, bx + hw / 2 + 30, y6) + arrow(bx + bw - hw / 2, y5 + 64, bx + bw - hw / 2 - 30, y6);
  const y7 = 676; layer(y7, 66, '⑦', '복구 규칙', '여유폭 W │ 재조정 기준 m │ rollback │ 재검토', '#e3f5ee', C.ok);
  b += arrow(cx, y6 + 66, cx, y7);
  // 피드백 루프
  b += `<path d="M ${bx} ${y7 + 33} L 44 ${y7 + 33} L 44 ${ys[0] + 33} L ${bx - 3} ${ys[0] + 33}" fill="none" stroke="${C.ok}" stroke-width="1.8" stroke-dasharray="6 4"/><polygon points="${bx},${ys[0] + 33} ${bx - 9},${ys[0] + 28} ${bx - 9},${ys[0] + 38}" fill="${C.ok}"/>` + rtext(36, (y7 + ys[0]) / 2 + 40, 'Feedback Loop: 데이터 · 추정 · 권한 보정', { size: 11.5, fill: C.ok, weight: 700, anchor: 'middle' }).replace('<text ', `<text transform="rotate(-90 36 ${(y7 + ys[0]) / 2 + 40})" `);
  // 우측: 제약 → D
  const rx = 640, rw = 290, cs = t.constraints || {};
  b += box(rx, 118, rw, 268, { fill: '#fff', stroke: C.ink }) + rtext(rx + 14, 142, '제약조건  g_{j}(x,s) ≤ c_{j}', { size: 14, weight: 700 });
  const rows = [['평균 손실', `L ≤ ${num(cs.loss_max)}`], ['손실 초과', `P(L>L_{max}) ≤ ${num(cs.loss_exceed_max)}`], ['부정지급', `FP ≤ ${num(cs.fp_max)}`], ['정상지급 차단', `FN ≤ ${num(cs.fn_max)}`], ['검토부담', `B ≤ ${num(cs.review_burden_max)}`], ['복구시간', `T_{R} ≤ ${num(cs.recovery_time_max)}`]];
  rows.forEach((r, i) => { b += rtext(rx + 14, 172 + i * 28, r[0], { size: 12.5, fill: '#333' }) + rtext(rx + 130, 172 + i * 28, r[1], { size: 12.5, weight: 600 }); });
  b += rtext(rx + 14, 356, `신뢰수준 ${num(cs.confidence)} · 신뢰구간 상·하한으로 판정`, { size: 11.5, fill: C.mute });
  b += `<path d="M ${bx + bw} ${y6 + 33} L 612 ${y6 + 33} L 612 330 L ${rx - 4} 330" fill="none" stroke="${C.bad}" stroke-width="1.6" stroke-dasharray="6 4"/><polygon points="${rx},330 ${rx - 9},325 ${rx - 9},335" fill="${C.bad}"/>` + rtext(618, 322, '결과 평가', { size: 11, fill: C.bad, weight: 700 });
  b += arrow(rx + rw / 2, 386, rx + rw / 2, 440);
  b += box(rx, 440, rw, 190, { fill: '#e3f5ee', stroke: C.ok, sw: 2.2 }) + rtext(rx + rw / 2, 468, '위임 가능 영역  D', { size: 16, weight: 700, anchor: 'middle' }) + rtext(rx + rw / 2, 494, 'x = (σ, τ, α, K, d, W, m, E)', { size: 13, anchor: 'middle' }) + rtext(rx + rw / 2, 520, 'P[ g_{j}(x,S) ≤ c_{j} ] ≥ 1 − ε_{j}, ∀j', { size: 13, anchor: 'middle' }) + rtext(rx + rw / 2, 552, 'FEASIBLE · UNRESOLVED · INFEASIBLE', { size: 11.5, anchor: 'middle', fill: '#333' }) + rtext(rx + rw / 2, 574, 'Safety first → Minimax Regret second', { size: 12, anchor: 'middle', weight: 700, fill: C.ok }) + rtext(rx + rw / 2, 600, 'UNRESOLVED ≠ INFEASIBLE', { size: 11.5, anchor: 'middle', fill: C.bad, weight: 700 });
  b += rtext(rx + rw / 2, 668, '핵심 질문', { size: 12, anchor: 'middle', fill: C.mute }) + rtext(rx + rw / 2, 692, 'Where can authority', { size: 14, anchor: 'middle', weight: 700 }) + rtext(rx + rw / 2, 712, 'safely be delegated?', { size: 14, anchor: 'middle', weight: 700 });
  b += rtext(W / 2, H - 14, 'Noise → Estimation → Decision → Delegation → Execution → Recovery', { size: 12.5, anchor: 'middle', fill: C.mute });
  return wrap(W, H, b, '박사논문 연구모형: 데이터 결정 사슬과 위임 가능 영역');
}

export function figDcvDesign(t) {
  const W = 1040, H = 474, bw = 158, gap = 48, x0 = 32, y0 = 92, bh = 150; let b = '';
  const ap = t.approval, cands = t.candidates || { total: 0, by_class: {} }, rv = t.reviewer || { n: 0 }, vals = t.simulation?.validations || [];
  const nVal = vals.reduce((a, v) => a + (Number(v.n) || 0), 0);
  const stages = [
    { k: 'DEFINE', sub: 'RQ1 · 제1편', lines: ['연구문제·변수·제약 정의', '위임수준 K0–K3', '복구규칙 W·m'], gate: 'Gate D0–D6', col: C.blue, fill: '#e8f3fb', st: `정의 v${t.definition?.version ?? '-'}` },
    { k: 'COMPUTE', sub: 'RQ2 · 제2편', lines: ['CDRS 경계 탐색', '탐색/확인 시드 분리', 'Historical·Synthetic·Stress'], gate: 'Gate C1–C8', col: C.ok, fill: '#e3f5ee', st: `후보 ${cands.total} · 확정 ${cands.by_class?.confirmed || 0}` },
    { k: 'VALIDATE', sub: 'RQ3 · 제3편', lines: ['독립표본 · 두 번째 사례', '인간 검토자 실험', 'ARR · ERT · FAR'], gate: 'Gate V1–V6', col: C.warn, fill: '#fff4dc', st: `검증 ${nVal}건 · 검토 ${rv.n}건` },
    { k: 'RE-COMPUTE', sub: '인간 행동 재투입', lines: ['검토자 모형 교체', 'Perfect → Empirical', 'D(ideal) vs D(human)'], gate: 'CI 재판정', col: C.bad, fill: '#fde9e0', st: rv.n ? (t.reviewer.model_version != null ? `검토자 모형 v${t.reviewer.model_version}` : '검토자 모형 적용') : '검토자 모형 없음' },
    { k: 'CONFIRM', sub: '최종 확정', lines: ['D* 확정', 'Boundary / Prohibited 구분', 'Evidence Level A–D'], gate: 'Approve', col: '#6a3d9a', fill: '#f1e9f7', st: ap ? `${String(ap.decision).replace('_DELEGATION', '')} · Level ${ap.evidence_level}` : '미확정' }
  ];
  b += rtext(x0, 26, 'DCV-C 연구설계 (Define → Compute → Validate → Re-compute → Confirm)', { size: 15, weight: 700 });
  stages.forEach((s, i) => {
    const x = x0 + i * (bw + gap);
    b += box(x, y0, bw, bh, { fill: s.fill, stroke: s.col, sw: 2 }) + rtext(x + bw / 2, y0 + 26, s.k, { size: 15, weight: 700, anchor: 'middle', fill: s.col }) + rtext(x + bw / 2, y0 + 46, s.sub, { size: 11.5, anchor: 'middle', fill: '#333', weight: 600 });
    s.lines.forEach((l, j) => { b += rtext(x + bw / 2, y0 + 76 + j * 22, l, { size: 11.5, anchor: 'middle' }); });
    if (i < stages.length - 1) b += arrow(x + bw, y0 + bh / 2, x + bw + gap, y0 + bh / 2);
    // 게이트
    b += box(x + 14, y0 + bh + 26, bw - 28, 30, { rx: 15, fill: '#fff', stroke: s.col }) + rtext(x + bw / 2, y0 + bh + 46, s.gate, { size: 12.5, anchor: 'middle', weight: 700, fill: s.col }) + `<line x1="${x + bw / 2}" y1="${y0 + bh}" x2="${x + bw / 2}" y2="${y0 + bh + 26}" stroke="${s.col}" stroke-width="1.4"/>`;
    // 현재 상태
    b += box(x, 350, bw, 44, { rx: 6, fill: '#fafafa', stroke: C.grid }) + rtext(x + bw / 2, 368, '현재 프로젝트', { size: 10.5, anchor: 'middle', fill: C.mute }) + rtext(x + bw / 2, 385, s.st, { size: 11.5, anchor: 'middle', weight: 700 });
  });
  b += rtext(x0, y0 + bh + 84, '게이트 판정:', { size: 12.5, weight: 700 }) + rtext(x0 + 88, y0 + bh + 84, 'CONFIRM(다음 단계) │ REVISE(수정 후 재평가) │ HOLD(근거 부족, 보류) │ REJECT(후보·설계 제거)', { size: 12.5 });
  // 피드백 (인간행동 → Compute)
  const xv = x0 + 3 * (bw + gap) + bw / 2, xc = x0 + 1 * (bw + gap) + bw / 2;
  b += `<path d="M ${xv} ${y0} L ${xv} ${y0 - 26} L ${xc} ${y0 - 26} L ${xc} ${y0 - 2}" fill="none" stroke="${C.bad}" stroke-width="1.6" stroke-dasharray="6 4"/><polygon points="${xc},${y0} ${xc - 5},${y0 - 9} ${xc + 5},${y0 - 9}" fill="${C.bad}"/>` + rtext((xv + xc) / 2, y0 - 34, '폐쇄 루프: 실제 인간 행동(ARR·정정개입률·지연)을 Compute 모형에 재투입', { size: 11.5, anchor: 'middle', fill: C.bad, weight: 700 });
  b += rtext(W / 2, 424, '논문 1편 = Define (정식화) · 논문 2편 = Compute (계산·경계 검증) · 논문 3편 = Validate (외적 타당성·인간 행동)', { size: 12.5, anchor: 'middle', weight: 700 });
  b += rtext(W / 2, 448, '세 편은 동일한 수학적 객체 D (위임 가능 영역)를 공유: 제1편 정의 → 제2편 계산 → 제3편 재계산', { size: 12, anchor: 'middle', fill: C.mute });
  return wrap(W, H, b, 'DCV-C 연구설계와 게이트, 논문 3편의 대응');
}

export function figRegionConcept() {
  const W = 760, H = 520, m = { l: 96, r: 40, t: 50, b: 84 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const X = v => m.l + pw * v, Y = k => m.t + ph * (1 - k / 3.4);
  // 경계: σ 구간별 위임 가능한 최대 K (계단형)
  const ideal = [3, 3, 2, 2, 1, 0], human = [2, 2, 1, 1, 0, 0], n = ideal.length, sw = 1 / n;
  const stair = arr => { let d = `M ${X(0)} ${Y(arr[0] + .4)}`; arr.forEach((k, i) => { d += ` L ${X((i + 1) * sw)} ${Y(k + .4)}`; if (i < n - 1) d += ` L ${X((i + 1) * sw)} ${Y(arr[i + 1] + .4)}`; }); return d; };
  let b = '';
  b += `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="#fde9e0"/>`;
  const fill = (arr, col, op) => { let d = `M ${X(0)} ${Y(0)}`; arr.forEach((k, i) => { d += ` L ${X(i * sw)} ${Y(k + .4)} L ${X((i + 1) * sw)} ${Y(k + .4)}`; }); d += ` L ${X(1)} ${Y(0)} Z`; return `<path d="${d}" fill="${col}" fill-opacity="${op}"/>`; };
  b += fill(ideal, C.ok, .28) + fill(human, C.ok, .42);
  for (let k = 0; k <= 3; k++) b += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(k)}" y2="${Y(k)}" stroke="${C.grid}"/>` + rtext(m.l - 12, Y(k) + 4, `K${k}`, { anchor: 'end', size: 13 });
  b += `<path d="${stair(ideal)}" fill="none" stroke="${C.ok}" stroke-width="2.6"/><path d="${stair(human)}" fill="none" stroke="${C.blue}" stroke-width="2.6" stroke-dasharray="7 4"/>`;
  b += `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="${C.ink}"/><line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${C.ink}"/>`;
  b += rtext(m.l + pw / 2, H - 46, 'σ (정보오차)  →  커질수록 위임 가능 권한 K*(σ) 하락', { anchor: 'middle', size: 13.5, weight: 700 }) + rtext(28, m.t + ph / 2, '위임 권한 K', { anchor: 'middle', size: 13.5, weight: 700 }).replace('<text ', `<text transform="rotate(-90 28 ${m.t + ph / 2})" `);
  b += rtext(X(.04), Y(1.0), 'D(human): 실제 검토자 영역', { size: 12.5, weight: 700, fill: '#fff' }) + rtext(X(.04), Y(2.9), 'D(ideal): 이상적 검토자 영역', { size: 12.5, weight: 700, fill: '#00694e' }) + rtext(X(.62), Y(3.05), 'INFEASIBLE (금지 영역)', { size: 12.5, weight: 700, fill: C.bad });
  b += arrow(X(.50), Y(2.62), X(.60), Y(2.62), { stroke: C.mute }) + rtext(X(.615), Y(2.62) + 4, 'α, d, W 조정 → 경계 이동', { size: 11.5, fill: C.mute });
  b += legendRow(m.l, H - 18, [{ mark: `<line x1="0" x2="14" y1="0" y2="0" stroke="${C.ok}" stroke-width="2.6"/>`, label: '이상적 검토자 영역 경계', w: 150 }, { mark: `<line x1="0" x2="14" y1="0" y2="0" stroke="${C.blue}" stroke-width="2.6" stroke-dasharray="5 3"/>`, label: '실제 검토자 영역 경계 (P4: 변화 여부 검증 대상)', w: 330 }, { mark: `<rect width="12" height="12" y="-6" fill="#fde9e0"/>`, label: '제약 위반', w: 100 }]);
  b += rtext(W - m.r, 30, '※ 모식도: 실제 계산 결과가 아님', { size: 11.5, anchor: 'end', fill: C.mute });
  return wrap(W, H, b, '위임 가능 영역 개념도: 이상적 검토자와 실제 검토자');
}

const BUILDERS = { 1: figHeatmap, 2: figEstimators, 3: figRegret, 4: figReviewer, 5: figEpisodes, 11: figResearchModel, 12: figDcvDesign, 13: figRegionConcept };
export function buildFigures(t) {
  return figureCatalog(t).map(g => { const svg = BUILDERS[g.n](t), m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg); return { ...g, svg, width: +m[1], height: +m[2] }; });
}
