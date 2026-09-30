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
  const figs = [];
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

const BUILDERS = { 1: figHeatmap, 2: figEstimators, 3: figRegret, 4: figReviewer, 5: figEpisodes };
export function buildFigures(t) {
  return figureCatalog(t).map(g => { const svg = BUILDERS[g.n](t), m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg); return { ...g, svg, width: +m[1], height: +m[2] }; });
}
