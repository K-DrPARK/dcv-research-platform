// 수식 텍스트 파서: LaTeX 부분집합 → 세그먼트 배열. mdhtml.js(HTML)와 docx.js(Word)가 공용으로 사용한다.
// 지원: 그리스 문자, \le \ge \in \forall \cup \cap \times \cdot \to \Rightarrow \partial \infty \mathcal{X} \text{...}
//       _x / _{...} 아래첨자, ^x / ^{...} 위첨자, \frac{a}{b} → (a)/(b), \hat{x}, \bar{x}, \sum \min \max \arg \Pr
// 출력 세그먼트: { t: 문자열, sub?: true, sup?: true, up?: true(직립), b?: true }
const SYM = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω',
  Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', Pi: 'Π', pi: 'π', nu: 'ν', xi: 'ξ', ell: 'ℓ', Phi: 'Φ', Gamma: 'Γ', Lambda: 'Λ', psi: 'ψ', chi: 'χ', zeta: 'ζ', iota: 'ι', leftarrow: '←', Leftarrow: '⇐', uparrow: '↑', downarrow: '↓', neq: '≠', ll: '≪', gg: '≫', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', in: '∈', forall: '∀', exists: '∃', cup: '∪', cap: '∩', subseteq: '⊆', subset: '⊂', emptyset: '∅',
  times: '×', cdot: '·', to: '→', rightarrow: '→', Rightarrow: '⇒', Leftrightarrow: '⇔', partial: '∂', infty: '∞', sim: '∼', approx: '≈', pm: '±', mid: '∣', setminus: '∖', ldots: '…', cdots: '⋯', sum: '∑', prod: '∏'
};
const OPS = new Set(['min', 'max', 'arg', 'Pr', 'argmin', 'argmax', 'log', 'exp', 'Var', 'Cov', 'clip']);
const IGN = new Set(['left', 'right', 'big', 'Big', 'quad', 'qquad', ',', ';', '!', ' ']);

function readGroup(s, i) {            // s[i] 위치의 {...} 또는 단일 문자를 읽는다. 반환 [내용, 다음 위치]
  while (s[i] === ' ') i++;
  if (s[i] === '{') { let d = 1, j = i + 1; while (j < s.length && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; } return [s.slice(i + 1, j - 1), j]; }
  if (s[i] === '\\') { const m = /^\\[A-Za-z]+/.exec(s.slice(i)); if (m) return [m[0], i + m[0].length]; }
  return [s[i] ?? '', i + 1];
}

export function parseMath(src, flags = {}) {
  const s = String(src ?? ''), out = []; let i = 0;
  const push = (t, o = {}) => { if (t !== '') out.push({ t, ...flags, ...o }); };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(i));
      if (!m) { const nx = s[i + 1]; if (nx && !IGN.has(nx) && nx !== ' ') push(nx); else if (nx === ' ') push(' '); i += 2; continue; }
      const name = m[1]; i += m[0].length;
      if (name === 'text' || name === 'mathrm' || name === 'operatorname') { const [g, j] = readGroup(s, i); i = j; out.push(...parseMath(g, { ...flags, up: true })); continue; }
      if (name === 'mathcal' || name === 'mathbb' || name === 'mathbf' || name === 'boldsymbol') { const [g, j] = readGroup(s, i); i = j; out.push(...parseMath(g, { ...flags, b: name === 'mathbf' || name === 'boldsymbol' ? true : flags.b, cal: name === 'mathcal' || undefined })); continue; }
      if (name === 'frac') { const [a, j] = readGroup(s, i), [b, k] = readGroup(s, j); i = k; push('('); out.push(...parseMath(a, flags)); push(')/('); out.push(...parseMath(b, flags)); push(')'); continue; }
      if (name === 'sqrt') { const [g, j] = readGroup(s, i); i = j; push('√('); out.push(...parseMath(g, flags)); push(')'); continue; }
      if (name === 'hat' || name === 'bar' || name === 'tilde' || name === 'widehat' || name === 'widetilde' || name === 'overline') { const [g, j] = readGroup(s, i); i = j; const mk = { hat: '\u0302', widehat: '\u0302', bar: '\u0304', overline: '\u0304', tilde: '\u0303', widetilde: '\u0303' }[name]; const inner = parseMath(g, flags); if (inner.length) inner[inner.length - 1] = { ...inner[inner.length - 1], t: inner[inner.length - 1].t + mk }; out.push(...inner); continue; }
      if (OPS.has(name)) { push(name.replace('argmin', 'arg min').replace('argmax', 'arg max'), { up: true }); push('\u2009'); continue; }
      if (IGN.has(name)) continue;
      if (SYM[name]) { push(SYM[name]); continue; }
      push(name); continue;                // 모르는 명령은 이름을 그대로 출력(누락 방지)
    }
    if (ch === '_' || ch === '^') {
      const [g, j] = readGroup(s, i + 1); i = j; const tag = ch === '_' ? { sub: true } : { sup: true };
      for (const seg of parseMath(g, flags)) out.push({ ...seg, ...tag }); continue;
    }
    if (ch === '{' || ch === '}') { i++; continue; }
    // 일반 문자: 연속된 일반 문자를 한 세그먼트로
    let j = i; while (j < s.length && !'\\_^{}'.includes(s[j])) j++;
    push(s.slice(i, j)); i = j;
  }
  return out;
}

// 평문(복사·캡션용): 첨자는 _ / ^ 없이 이어 붙인다.
export const mathPlain = src => parseMath(src).map(x => x.t).join('');

// HTML 조각 (이스케이프 포함)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function mathToHtml(src) {
  return parseMath(src).map(x => {
    let h = esc(x.t);
    if (!x.up && !x.cal && /[A-Za-z]/.test(x.t)) h = `<i>${h}</i>`;
    if (x.b) h = `<b>${h}</b>`;
    if (x.sub) h = `<sub>${h}</sub>`; else if (x.sup) h = `<sup>${h}</sup>`;
    return h;
  }).join('');
}
