// 박사논문 연구모형 전체 설계 섹션 (Markdown). report.js가 보고서 본문에 삽입한다.
// 구성: 연구대상 · 연구모형(그림) · 연구질문 · 연구설계·게이트 · 연구명제 · 변수 · 계산 산식 · 증거수준
// 수식은 $$ ... $$ (n) 줄로 쓰며 mathtext.js 문법을 따른다 (HTML·Word 모두 첨자/그리스 문자 렌더링).
export const MODEL_MARKER = '박사논문 연구모형 전체 설계';

const cell = v => String(v ?? '-').replace(/\|/g, '/').replace(/\n/g, ' ');
const mdTable = (head, rows) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map(r => `| ${r.map(cell).join(' | ')} |`).join('\n')}`;
const fmt = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? '-' : String(Number(Number(v).toFixed(4)));
const lv = a => Array.isArray(a) && a.length ? a.join(', ') : '-';
const pct = v => (v == null || !Number.isFinite(Number(v))) ? '-' : `${(Number(v) * 100).toFixed(1)}%`;

export function buildModelSection(t, { figLine = () => '', estName = e => e, clean = x => String(x ?? '') } = {}) {
  const L = [], cs = t.constraints || {}, d = t.design || {}, c = t.candidates || { total: 0, by_class: {}, dims: {} };
  const params = Object.fromEntries((t.empirical?.parameters || []).map(p => [p.parameter_key, Number(p.value_num)]));
  const P = (k, fb) => Number.isFinite(params[k]) ? params[k] : fb;
  const bm = t.definition?.content?.benchmark || {};
  const lc = t.empirical?.loss_calibration || {};
  const cfg = { T: P('horizon_days', 90), th0: Number(bm.risk_threshold || P('stability_theta_korea', 0.62)), k2: Number(bm.k2_confidence || 0.84), k3: Number(bm.k3_confidence || 0.67), gam: P('outflow_digital_sensitivity', 0.35), recAlpha: Number(bm.recovery_alpha ?? 0.18), cFP: Number(lc.c_fp ?? 0.0592), cFN: Number(lc.c_fn ?? 0.0832), cReview: Number(lc.review_cost ?? 0.000658), cAdjust: Number(lc.adjustment_cost ?? 0.000924), cDelay: Number(lc.delay_cost_scale ?? 0.07696), lossNorm: Number(lc.normalization ?? 0.18), lossN: Number(lc.n ?? 0), lossProv: lc.provenance || 'fallback' };
  const ec=t.empirical?.coefficients||{}, kap=Number(ec.kappa??P('kappa',-0.0683)), th1=Number(ec.theta1??P('theta1_severity',0.0597)), th2=Number(ec.theta2??P('theta2_concentration_x_shock',0.2466)), th2se=Number(ec.theta2_se??P('theta2_se',0.0655)), rmse=Number(ec.rmse??P('regression_rmse',0.03)), r2=Number(ec.r2??P('regression_r2',0.553));
  const ORDER = ['chain', 'p1', 'p2', 'p3', 'p4', 'xvec', 'dyn', 'chan', 'obs', 'ema', 'kalman', 'cp', 'adaptive', 'dec', 'conf', 'rev', 'ovr', 'loss', 'expo', 'delay', 'agg', 'agg2', 'rec', 'obj', 'D', 'wil', 'cls', 'bs', 'seed', 'stress', 'regret', 'mr', 'xstar', 'ols', 'arr', 'hpar', 'recomp'];
  const used = [];
  const n = name => ORDER.indexOf(name) + 1;                       // 식 번호 (본문 속 교차참조와 공용)
  const eq = (name, tex, sfx = '') => { used.push(name); return `$$ ${tex} $$ (${n(name)}${sfx})`; };
  const S = (...x) => L.push(...x);

  S(`## 1. ${MODEL_MARKER}`, '', '> 이 절은 박사논문 전체(제1편 Define · 제2편 Compute · 제3편 Validate)의 연구모형·연구대상·연구질문·계산 산식을 한 곳에 정리한 것이다. 그림·표 번호 앞의 “M”은 연구모형(Model) 절의 자료임을 뜻한다. 이 절의 구조와 산식은 연구설계 문서이고, 이후 절(2~10)의 수치는 이 프로젝트의 실행 결과다.', figLine(10), '');

  /* 1.1 연구대상 */
  S('### 1.1 연구대상', '', '본 연구는 “어떤 알고리즘이 더 정확한가”를 비교하는 연구가 아니다. 연구대상은 **알고리즘에 집행권한을 위임할 수 있는 조건의 경계**, 곧 위임 가능 영역 $\\mathcal D$를 설계·탐색·검증하는 일이다.', '',
    '> **핵심 연구명제**: 잡음이 존재하는 정보와 승인 지연 환경에서 알고리즘에 부여할 수 있는 집행권한의 범위는 고정되어 있지 않으며, 데이터 품질·정보처리 방식·권한 수준·승인지연·복구규칙의 결합에 의해 결정된다.', '',
    '**표 M1. 연구대상의 구조**', '',
    mdTable(['구분', '내용'], [
      ['연구대상', '위임 가능 영역 $\\mathcal D$: 설계변수 조합 가운데 위험·손실·지연·검토부담 제약을 사전에 정한 신뢰수준 이상으로 충족하는 집합'],
      ['연구 맥락', '공공 지급결제 의사결정 (지급 · 지급정지 · 한도조정 · 추가검토 · 보류)'],
      ['분석 단위', `설계 후보 $x$ (이 프로젝트 ${c.total}개) → 시뮬레이션 에피소드(시나리오 × 독립 시드) → 위기 사례 패널(${t.empirical?.panel?.n || 0}건 적재) → 인간 검토자 관측(${t.reviewer?.n || 0}건)`],
      ['성과 기준', '정확도가 아니라 제약 충족 여부 $\\text{Feasible}(x)\\in\\{0,1\\}$ 와 그 경계'],
      ['비교의 초점', '“EMA가 Kalman보다 좋은가”가 아니라 “어떤 정보처리법을 써도 위임 경계의 구조가 유지되는가”'],
      ['최종 산출물', '① Confirmed Region ② Boundary/Unresolved Region ③ Prohibited Region ④ 영역별 Evidence Level']
    ]), '', `이 프로젝트의 연구질문: ${clean(t.definition?.research_question) || '-'}`, '');

  /* 1.2 연구모형 */
  S('### 1.2 연구모형: 데이터–결정 사슬', '', '연구모형은 정보의 잡음에서 출발하여 추정 → 판단 → 위임 → 집행 → 복구로 이어지는 사슬이다(그림 M1). 사슬 전체에 제약조건을 걸어 위임 가능 영역을 정의한다.', figLine(11), '',
    eq('chain', '\\text{Noise}\\to\\text{Estimation}\\to\\text{Decision}\\to\\text{Delegation}\\to\\text{Execution}\\to\\text{Recovery}'), '',
    '위임은 이진(자동화/비자동화) 문제가 아니라 단계화된 권한 $K$의 문제로 다룬다. 다음 표는 각 권한 수준이 계산 엔진에서 어떻게 작동하는지를 보여 준다.', '',
    '**표 M2. 위임 권한 수준 $K$의 정의와 엔진 구현**', '',
    mdTable(['수준', '의미', '인간 검토 조건 (엔진 구현)'], [
      ['$K_0$', '인간 판단·집행', '모든 결정을 인간이 검토'],
      ['$K_1$', 'AI 추천 + 인간 승인', '모든 결정에 인간 승인'],
      ['$K_2$', '정상범위 자동집행, 예외 인간승인', `AI 신뢰도 $\\Phi_t<${cfg.k2}$ 일 때 검토`],
      ['$K_3$', '자동판단·집행, 사후감사', `AI 신뢰도 $\\Phi_t<${cfg.k3}$ 일 때 검토`]
    ]), '', `모든 수준에서 복구규칙이 작동하면 일정 기간 검토가 강화된다(safe mode, 식 ${n('rec')}).`, '');

  /* 1.3 연구질문 */
  S('### 1.3 연구질문', '', '세 개의 연구질문은 Define → Compute → Validate 구조로 대응한다.', '', '**표 M3. 연구질문과 논문 구성**', '',
    mdTable(['번호', '연구질문', '단계', '논문', '핵심 산출물'], [
      ['RQ1', '데이터 품질, 정보처리, 판단, 권한, 집행 및 복구를 어떻게 하나의 위임 설계체계로 정식화할 수 있는가?', 'Define', '제1편 (개념·정식화)', '데이터–결정 사슬, 위임 수준 $K$, 위임 가능 영역 $\\mathcal D$의 정의'],
      ['RQ2', '정보오차 $\\sigma$, 처리강도 $\\alpha$, 위임권한 $K$, 승인지연 $d$, 복구규칙의 상호작용은 위임 가능 영역의 크기와 경계를 어떻게 변화시키는가?', 'Compute', '제2편 (계산·경계 식별)', '위임 가능 영역 지도와 경계조건, UNRESOLVED 구분, Minimax Regret 대표 정책'],
      ['RQ3', '시뮬레이션으로 도출된 위임 가능 영역은 다른 공공 지급결제 사례와 실제 인간 검토자 환경에서도 유지되는가?', 'Validate', '제3편 (외적 타당성·인간행동)', '$\\mathcal D_{ideal}$ 대 $\\mathcal D_{human}$, 사례 이식 결과, 최종 $\\mathcal D^{*}$']
    ]), '',
    '논문의 논리는 다음과 같이 이어진다. 제1편: 어떤 조건을 만족해야 위임이 정당화되는가 → 제2편: 그 조건을 만족하는 영역을 어떻게 계산하고 경계를 검증하는가 → 제3편: 그 경계가 새로운 사례와 실제 인간 행동을 넣어도 유지되는가. 결론적으로 알고리즘 위임은 AI 정확도의 문제가 아니라 정보–처리–권한–인간–복구가 결합된 시스템 설계 문제로 본다.', '');

  /* 1.4 연구설계 */
  S('### 1.4 연구설계: DCV-C 절차와 게이트', '', '연구는 Define → Compute → Validate → Re-compute → Confirm 순서로 진행하며, 각 단계는 사전에 정한 게이트를 통과해야 다음 단계로 간다(그림 M2). 인간 검토자 실험에서 얻은 실제 행동 모수를 다시 계산 모형에 넣어 최종 $\\mathcal D^{*}$를 확정하므로 Validate는 끝이 아니다.', figLine(12), '',
    '**표 M4. 단계별 게이트와 판정 규칙**', '',
    mdTable(['단계', '게이트 (통과 조건)', '판정'], [
      ['Define', 'D0 실증 기준 정의 · D1 계산 가능한 연구질문 · D2 독립/결과변수 분리 · D3 제약조건 존재 · D4 제약 기준값 수치화 · D5 위임수준 $K$ 정의 · D6 복구·재조정 규칙 포함', '전부 충족 CONFIRM · 5개 이상 REVISE · 그 미만 HOLD'],
      ['Compute', 'C1 독립 시드 · C2 탐색/확인 표본 분리 · C3 FEASIBLE/INFEASIBLE/UNRESOLVED 구분 · C4 Historical·Synthetic·Stress 통과 · C5 경계 후보 추가 배분 · C6 벤치마크 비교 · C7 신뢰구간 기반 판정 · C8 제약 통과 후보 안에서만 최대후회 적용', '8개 충족 CONFIRM · 6~7개 REVISE · 명시적 제약 위반 REJECT · 근거 부족 HOLD'],
      ['Validate', 'V1 독립표본 유지 · V2 두 번째 사례 방향성 · V3 인간 행동 반영 후에도 영역 존재 · V4 경계 이동 원인 설명 · V5 명제 P1~P4 재현 · V6 단일 알고리즘 비의존', '6개 충족 CONFIRM · 4~5개 REVISE · 일부 명제만 유지 CONDITIONAL · 외적 검증 붕괴 HOLD'],
      ['Re-compute / Confirm', '검토자 모형을 교체하여 재계산한 제약 신뢰구간으로 재판정', 'FEASIBLE → CONFIRM · INFEASIBLE → REJECT · UNRESOLVED → HOLD']
    ]), '',
    `현재 프로젝트 상태: 후보 ${c.total}개 중 CONFIRMED ${c.by_class?.confirmed || 0}, BOUNDARY ${c.by_class?.boundary || 0}, INFEASIBLE ${c.by_class?.infeasible || 0}. 인간 검토자 관측 ${t.reviewer?.n || 0}건. 최종 판정 ${t.approval ? `${t.approval.decision} (Evidence Level ${t.approval.evidence_level})` : '미확정'}.`, '');

  /* 1.5 연구명제 */
  const sg = (c.dims?.sigma || []).filter(x => x.total > 0), mono = sg.length > 1 && sg.every((x, i) => i === 0 || (x.share ?? 0) <= (sg[i - 1].share ?? 0) + 1e-9);
  S('### 1.5 연구명제', '', '명제는 가설이며, 이 보고서의 수치가 곧 입증을 뜻하지 않는다. 각 명제가 어느 논문에서 검증되는지를 함께 표시한다.', '',
    '**P1. 정보품질 (제2편)**', '', eq('p1', '\\sigma\\uparrow\\ \\Rightarrow\\ \\mid\\mathcal D\\mid\\downarrow'), '',
    '정보오차가 커질수록 동일한 위험·손실 제약을 충족하는 위임 가능 영역은 줄어든다.', '',
    '**P2. 교호작용 (제2편)**', '', eq('p2', 'K^{*}(\\sigma)=\\max\\{K:\\ (\\sigma,\\tau,\\alpha,K,d,W,m,E)\\in\\mathcal D\\},\\qquad \\frac{\\partial K^{*}}{\\partial\\sigma}=f(\\alpha,d)'), '',
    '정보품질이 위임 가능 권한에 미치는 효과는 정보처리 강도와 승인 지연에 따라 달라진다.', '',
    '**P3. 복구규칙 (제2편)**', '', eq('p3', 'W\\uparrow\\ \\Rightarrow\\ \\text{AdjustFreq}\\downarrow\\ \\text{and}\\ \\text{ExposureLoss}\\uparrow'), '',
    '복구 여유폭은 재조정 빈도와 손실노출 사이의 교환관계(trade-off)를 만든다.', '',
    '**P4. 인간 검토자 (제3편)**', '', eq('p4', 'H_{4}:\\ \\mathcal D_{human}\\subseteq\\mathcal D_{ideal}\\qquad(\\text{성립을 전제하지 않고 검증})'), '',
    '인간 검토자의 편향·오류·승인지연을 반영하면 이상적 검토자를 가정한 영역의 크기와 경계가 변한다.', '',
    `이 프로젝트 자료의 예비 관찰(기술통계, 주변비율이며 인과효과 아님): σ 수준별 CONFIRMED 비율은 ${sg.length ? sg.map(x => `σ=${x.level}: ${pct(x.share)}`).join(', ') : '자료 없음'}${sg.length > 1 ? `로, σ가 커질 때 ${mono ? '비율이 줄거나 같은 방향이다(P1과 같은 방향).' : '단조 감소가 아니다(P1과 다른 방향이므로 후보 수와 교란 변수를 점검해야 한다).'}` : '.'} 인간 검토자 자료는 ${t.reviewer?.n || 0}건으로, P4는 ${t.reviewer?.n ? '표 10·11과 제3편 재계산에서' : '검토자 관측이 쌓인 뒤'} 검증한다.`, '');

  /* 1.6 변수 */
  S('### 1.6 변수와 설계벡터', '', '설계벡터는 다음과 같으며, 불확실한 환경 $s\\in S$ 아래에서 평가한다.', '',
    eq('xvec', 'x=(\\sigma,\\tau,\\alpha,K,d,W,m,E),\\qquad K\\in\\{0,1,2,3\\},\\quad s\\in S=S_{H}\\cup S_{S}\\cup S_{A}'), '',
    '$S_H$는 역사적 위기 사례, $S_S$는 Monte Carlo 계수 공동변동, $S_A$는 경계 붕괴를 노린 적대적(stress) 시나리오이다.', '',
    '**표 M5. 변수 설계표 (이 프로젝트의 수준)**', '',
    mdTable(['계층', '변수', '기호', '유형', '이 프로젝트의 수준/값'], [
      ['환경', '충격·위기유형', '$s$', '외생', `${t.simulation?.scenarios?.total ?? 0}개 시나리오 (역사적 ${t.simulation?.scenarios?.historical ?? 0}, 적대적 ${t.simulation?.scenarios?.adversarial ?? 0})`],
      ['데이터', '정보오차', '$\\sigma$', '독립', lv(d.sigma)], ['데이터', '정보 시차', '$\\tau$', '독립', lv(d.tau)],
      ['처리', '평활·정보처리 강도', '$\\alpha$', '설계', lv(d.alpha)], ['처리', '추정기', '$E$', '설계', lv((d.estimators || []).map(estName))],
      ['권한', '위임 수준', '$K$', '핵심 설계', lv(d.K)], ['조직', '승인 지연', '$d$', '독립', lv(d.d)],
      ['복구', '복구 여유폭', '$W$', '설계', lv(d.W)], ['복구', '재조정 기준', '$m$', '설계', lv(d.m)],
      ['결과', '손실 / 손실 초과율', '$L$, $P(L>L_{max})$', '결과', `상한 ${fmt(cs.loss_max)} / ${fmt(cs.loss_exceed_max)}`],
      ['결과', '정지 오판 (정상지급 차단)', '$FP$', '결과', `상한 ${fmt(cs.fp_max)}`],
      ['결과', '정지 누락 (부정지급·유출)', '$FN$', '결과', `상한 ${fmt(cs.fn_max)}`],
      ['결과', '검토 부담 / 복구시간', '$B$, $T_R$', '결과', `상한 ${fmt(cs.review_burden_max)} / ${fmt(cs.recovery_time_max)}`],
      ['인간', '적절한 의존 / 오류 복구시간', '$ARR$, $ERT$', '결과', `${t.reviewer?.n ? `ARR ${pct(t.reviewer.arr?.p)}` : '관측 없음'}`],
      ['최종', '위임 가능 여부', '$\\text{Feasible}(x)$', '핵심 결과', `CONFIRMED ${c.by_class?.confirmed || 0} / 전체 ${c.total}`]
    ]), '',
    '');

  /* 1.7 계산 산식 */
  S('### 1.7 계산 산식', '', '아래 식은 계산 엔진(CDRS v2)이 실제로 수행하는 연산을 논문 표기로 옮긴 것이다. 괄호 안 숫자 값은 엔진 기본값이며 프로젝트 설정에서 바뀔 수 있다.', '');

  S('**(가) 환경과 관측**', '',
    `잠재 위험 상태 $z_t$는 시나리오 $s$ 아래에서 다음처럼 움직인다. 실증 채널 $\\Pi_s$는 논문 Specification I의 계수로 주어진다($\\kappa=${fmt(kap)}$, $\\theta_1=${fmt(th1)}$, $\\theta_2=${fmt(th2)}$, $SE(\\theta_2)=${fmt(th2se)}$, $R^2=${fmt(r2)}$, $RMSE=${fmt(rmse)}$).`, '',
    eq('dyn', 'z_{t}=\\rho_{s}\\,z_{t-1}+\\mu_{s}+\\Pi_{s}\\,(1+\\gamma D_{s})+\\delta_{t}+\\nu_{s}\\,\\xi_{t},\\qquad \\xi_{t}\\sim N(0,1)'),
    eq('chan', `\\Pi_{s}=\\mathrm{clip}\\,(\\kappa+\\theta_{1}S_{s}+\\theta_{2}\\,C_{s}S_{s},\\ 0,\\ 0.75),\\qquad \\gamma=${fmt(cfg.gam)}`),
    eq('obs', 'y_{t}=z_{t}+\\sigma\\,v_{s}\\,\\varepsilon_{t},\\qquad \\tilde y_{t}=y_{t-\\tau},\\qquad \\varepsilon_{t}\\sim N(0,1)'), '',
    '$\\rho_s$는 지속성, $\\mu_s$는 표류, $\\delta_t$는 구조변화(regime shift), $\\nu_s$는 공정 잡음, $v_s$는 변동성 배수, $D_s$는 디지털 이용도이다. $\\gamma$는 문헌 범위가 설정된 민감도로서 추정계수와 구분해 다룬다.', '');

  S('**(나) 정보처리 (추정기 $E$)**', '',
    eq('ema', '\\hat z_{t}=\\alpha\\,\\tilde y_{t}+(1-\\alpha)\\,\\hat z_{t-1}\\qquad(\\text{EMA})'),
    eq('kalman', 'G_{t}=\\frac{P_{t}^{-}}{P_{t}^{-}+R},\\qquad \\hat z_{t}=\\hat z_{t-1}+G_{t}(\\tilde y_{t}-\\hat z_{t-1})\\qquad(\\text{Kalman})'),
    eq('cp', 'c_{t}=\\mathbb 1\\left[\\frac{\\mid\\tilde y_{t}-\\hat z_{t-1}\\mid}{\\sqrt{V_{t-1}+\\sigma^{2}}}>3.0-1.2\\alpha\\right],\\quad \\alpha_{t}^{eff}=\\max(0.65,\\alpha)\\ \\text{if}\\ c_{t}=1\\qquad(\\text{변화점})'),
    eq('adaptive', '\\text{Kalman 갱신 후 }\\ \\frac{\\mid\\tilde y_{t}-\\hat z_{t}\\mid}{\\sqrt{P_{t}+R}}>2.4-0.5\\alpha\\ \\Rightarrow\\ \\hat z_{t}\\leftarrow0.65\\,\\tilde y_{t}+0.35\\,\\hat z_{t}\\qquad(\\text{적응형})'), '',
    `Kalman 식에서 $P_t^{-}=P_{t-1}+q$, $q=0.02+0.30\\alpha^{2}$, $R=\\max(0.0025,\\sigma^{2})$이다. 네 추정기(${(d.estimators || []).map(estName).join(', ') || 'EMA, Kalman, Change-point, Adaptive'})는 같은 입력에 같은 판단 규칙을 적용해 위임 경계가 추정기에 의존하는지 비교하기 위한 벤치마크다.`, '');

  S('**(다) 판단·위임·인간 검토**', '',
    eq('dec', `a_{t}=\\mathbb 1[\\hat z_{t}>\\lambda],\\quad s_{t}=\\mathbb 1[\\mathrm{logistic}(z_{t})>\\theta_{0}],\\quad \\lambda=\\ln\\frac{\\theta_{0}}{1-\\theta_{0}},\\quad \\theta_{0}=${fmt(cfg.th0)}`),
    eq('conf', bm.confidence_method==='residual_common_v1'?'\\Phi_t=\\mathrm{clip}(0.5+0.5(1-e^{-\\mid\\hat z_t-\\lambda\\mid/\\sqrt{\\max(\\sigma^2,V_{t-1})}}),0.5,0.999)': '\\Phi_{t}=\\mathrm{clip}(0.5+0.5(1-e^{-\\mid\\hat z_{t}-\\lambda\\mid/(\\sqrt{P_t}+0.12)}),0.5,0.999)'),
    eq('rev', `r_{t}=\\mathbb 1\\left[K\\le1\\ \\text{or}\\ \\text{safe}_{t}>0\\ \\text{or}\\ (K=2\\ \\text{and}\\ \\Phi_{t}<${cfg.k2})\\ \\text{or}\\ (K=3\\ \\text{and}\\ \\Phi_{t}<${cfg.k3})\\right]`),
    eq('ovr', 'P(\\hat a_{t}=s_{t}\\mid a_{t}\\ne s_{t},\\,r_{t}=1)=q_{o},\\qquad P(\\hat a_{t}\\ne a_{t}\\mid a_{t}=s_{t},\\,r_{t}=1)=u'), '',
    `$a_t$는 알고리즘 판단, $s_t$는 실제 정지 필요 여부, $\\Phi_t$는 신뢰도, $r_t$는 인간 검토 여부, $\\hat a_t$는 최종 집행이다. $q_o$(정정 개입률)와 $u$(불필요 개입률)는 현재 revision의 표본 기준을 충족한 인간 검토자 모델이 있을 때 재계산에 사용하며, 그 이전에는 검증되지 않은 설계 prior를 사용한다(식 ${n('arr')}~${n('hpar')}).`, '');

  S('공통 신뢰도는 네 추정기의 이전 상태에 대한 지연 관측의 1-step 잔차 제곱을 동일한 EWMA 규칙으로 갱신한 V를 사용한다. 현재 관측 잔차는 다음 단계에 반영하며 정답 s는 신뢰도에 입력하지 않는다. ECE와 신뢰도 분포는 별도 진단이며 확률 교정을 보장하지 않는다. K0/K1의 전량 검토는 정의상 점검 기준선이다. 검토 지연은 d 일과 실험 응답시간을 86400으로 나눈 일 단위의 합이며 자율 실행은 0.02일 기본값이다.', '');
  S('**(라) 손실·복구·목적함수**', '',
    eq('loss', `\\ell_{t}=c_{FP}\\,\\mathbb 1_{FP,t}+c_{FN}\\,\\mathbb 1_{FN,t}+e_{t}+h_{t}+c_{R}r_{t},\\qquad (c_{FP},c_{FN},c_{R})=(${fmt(cfg.cFP)},${fmt(cfg.cFN)},${fmt(cfg.cReview)})`),
    eq('expo', `e_{t}=c_{FN}\\,\\mathbb 1[\\hat a_{t}=0]\\cdot\\max(0,\\mathrm{logistic}(z_{t})-\\theta_{0})\\left(1+\\frac{\\Delta_{t}}{T}\\right),\\qquad c_{FN}=${fmt(cfg.cFN)}`),
    eq('delay', `h_{t}=\\frac{\\Delta_{t}}{T}\\left[c_{FN}\\,\\mathbb 1(\\hat a_{t}=0)+c_{FP}\\,\\mathbb 1(\\hat a_{t}=1)\\right],\\qquad T=${cfg.T}`),
    eq('agg', 'L=\\frac{1}{T}\\sum_{t=1}^{T}\\ell_{t};\\qquad B=\\frac{\\sum_{t}r_{t}}{N_{dec}},\\qquad T_{R}=\\frac{1}{N_{dec}}\\sum_{t}\\Delta_{t}'),
    eq('agg2', '\\widehat{FP}=\\frac{\\sum_{t}\\mathbb 1[\\hat a_{t}=1,s_{t}=0]}{N_{dec}},\\qquad \\widehat{FN}=\\frac{\\sum_{t}\\mathbb 1[\\hat a_{t}=0,s_{t}=1]}{N_{dec}}'),
    eq('rec', `\\rho_{t}^{err}=(1-\\lambda_{rec})\\rho_{t-1}^{err}+\\lambda_{rec}\\mathbb 1[\\hat a_{t}\\ne s_{t}],\\quad \\lambda_{rec}=${fmt(cfg.recAlpha)};\\quad \\text{safe mode if }\\rho_{t}^{err}>m\\ \\text{or}\\ e_{t}>W`),
    eq('obj', `J(x,s)=\\frac{E[L]}{q_{.95}}+B+\\frac{T_{R}}{T}+\\frac{N_{adj}}{T},\\qquad q_{.95}=${fmt(cfg.lossNorm)}`), '',
    `손실계수는 위기 사례 패널 ${cfg.lossN || '-'}건의 결과층으로 보정한다. $c_{FP}=${fmt(cfg.cFP)}$는 비실패 사례 평균 peak outflow를 이용한 **정지 오판(정상지급 차단)** 비용 proxy, $c_{FN}=${fmt(cfg.cFN)}$는 실패 사례 평균 peak outflow를 이용한 **정지 누락(부정지급·유출 미차단)** 비용 proxy다. 검토비용 $c_R=${fmt(cfg.cReview)}$와 safe-mode 전환비용 $c_A=${fmt(cfg.cAdjust)}$는 각각 $c_{FP}/T$, $c_{FN}/T$로 동일 단위에 맞췄다. 목적함수는 임의 가중치 대신 손실을 패널의 95백분위 $q_{.95}=${fmt(cfg.lossNorm)}$로 정규화하고 검토부담·평균 지연·재조정 빈도를 무차원화해 합산한다. 복구 EWMA의 $\\lambda_{rec}$는 81개 횡단면 패널에서 식별할 수 없으므로 설계 파라미터로 남겨 둔다.`, '');

  S('**(마) 제약·위임 가능 영역·판정**', '',
    eq('D', 'g=(L,\\ P(L>L_{max}),\\ FP,\\ FN,\\ B,\\ T_{R}),\\qquad \\mathcal D=\\left\\{x:\\ P\\left[g_{j}(x,S)\\le c_{j}\\right]\\ge1-\\epsilon_{j},\\ \\forall j\\right\\}'),
    eq('wil', '\\hat p=\\frac{k}{n},\\qquad CI_{W}=\\frac{\\hat p+\\frac{z^{2}}{2n}\\ \\pm\\ z\\sqrt{\\frac{\\hat p(1-\\hat p)}{n}+\\frac{z^{2}}{4n^{2}}}}{1+\\frac{z^{2}}{n}}\\qquad(\\text{Wilson}, z=1.96)'), '',
    '확률형 제약(손실 초과·FP·FN·검토부담)에는 Wilson 구간을, 평균형 제약(복구시간)에는 정규근사 구간 $[\\ell_j,u_j]$를 쓴다. 판정은 구간의 위치로 내린다.', '',
    eq('cls', '\\text{FEASIBLE}:\\ u_{j}\\le c_{j}\\ \\ \\forall j', 'a'), eq('cls', '\\text{INFEASIBLE}:\\ \\exists j\\ \\ \\ell_{j}>c_{j}', 'b'), eq('cls', '\\text{UNRESOLVED}:\\ \\text{그 외}\\qquad(\\text{UNRESOLVED}\\ne\\text{INFEASIBLE})', 'c'), '',
    eq('bs', 'BS(x)=\\frac{1}{0.05+\\min_{j}\\ \\mid\\hat g_{j}-c_{j}\\mid/\\max(0.01,\\mid c_{j}\\mid)}'), '',
    '경계 점수 $BS$가 큰(제약 경계에 가까운) UNRESOLVED 후보에 추가 시뮬레이션을 배분한다(경계 집중 정밀화). 탐색 시드와 확인 시드는 서로소이며 시드는 프로젝트·후보·단계·주기로부터 결정적으로 생성한다.', '',
    eq('seed', '\\text{Seed}_{search}\\cap\\text{Seed}_{confirm}=\\emptyset,\\qquad \\text{seed}=h(\\text{project}\\mid\\text{candidate}\\mid\\text{phase}\\mid\\text{cycle}\\mid\\text{CDRS-v2})'), '');

  S('**(바) 강건성과 Minimax Regret (Safety first, regret second)**', '',
    eq('stress', '(C,D,S)=(m_{C}C_{0},\\ m_{D}D_{0},\\ m_{S}S_{0}),\\quad m_{C},m_{D},m_{S}\\in\\{0.6,\\ 1.0,\\ 1.4\\}\\ \\ (3\\times3\\times3=27),\\ \\text{clip to }[0,1]'),
    eq('regret', 'R(x,s)=J(x,s)-J^{*}(s),\\quad J^{*}(s)=\\min_{x\'}J(x\',s)'),
    eq('mr', 'MR(x)=\\max_{s\\in S_{H}\\cup S_{A}}R(x,s)'),
    eq('xstar', 'x^{*}=\\arg\\min_{x\\in\\mathcal D_{rob}}MR(x),\\qquad \\mathcal D_{rob}=\\left\\{x\\in\\mathcal D:\\ \\text{역사적·적대적 시나리오에서도 FEASIBLE}\\right\\}'), '',
    'Minimax Regret는 위임 가능성의 1차 기준이 아니다. 먼저 $x\\in\\mathcal D_{rob}$인지 확인한 뒤, 그 안에서만 최대 후회가 가장 작은 설계를 대표 정책으로 고른다.', '');

  S('**(사) 실증 보정 회귀와 인간 검토자 재계산**', '',
    eq('ols', `\\text{peak outflow}_{i}=\\kappa+\\theta_{1}S_{i}+\\theta_{2}\\,(C_{i}S_{i})+\\epsilon_{i},\\qquad \\hat\\theta_{2}=${fmt(th2)}\\ (SE=${fmt(th2se)})`),
    eq('arr', 'ARR=\\frac{N_{\\text{correct accept}}+N_{\\text{correct override}}}{N},\\qquad ERT=\\frac{1}{\\mid\\mathcal W_{rec}\\mid}\\sum_{i\\in\\mathcal W_{rec}}\\left(T_{i}^{corr}-T_{i}^{exp}\\right)'),
    eq('hpar', '\\hat q_{o}=P(\\text{override}\\mid AI\\ \\text{wrong},c),\\qquad \\hat f_{a}=P(\\text{accept}\\mid AI\\ \\text{wrong},c),\\qquad d_{h}\\sim F_{d}'),
    eq('recomp', '\\mathcal D_{ideal}\\ \\to\\ \\mathcal D_{human}\\ \\ (\\text{검토자 모형 교체 후 재계산}),\\qquad \\Delta\\mathcal D=\\frac{\\mid\\mathcal D_{ideal}\\setminus\\mathcal D_{human}\\mid}{\\mid\\mathcal D_{ideal}\\mid}'), '',
    `$\\theta_2$는 위기 사례 패널에서 추정된 계수이고, $\\gamma$와 같은 시뮬레이션 민감도는 문헌 범위로 묶인 값이므로 같은 증거로 취급하지 않는다. 인간 검토자 모수는 식 (${n('rev')})·(${n('ovr')})의 $q_o$, $u$, $\\Delta_t$를 대체하여 $\\mathcal D_{human}$을 계산한다.`, '');

  /* 1.8 증거수준 + 개념도 */
  S('### 1.8 위임 가능 영역 개념도와 증거수준', '', '개념적으로 위임 가능 영역은 정보오차 $\\sigma$가 커질수록 허용되는 최대 권한 $K^{*}(\\sigma)$가 낮아지는 계단형 경계로 나타나며, 인간 검토자의 실제 행동을 반영하면 이 경계가 이동할 수 있다(그림 M3, 모식도).', figLine(13), '',
    '**표 M6. 결과 영역과 증거수준**', '',
    mdTable(['구분', '정의', '증거수준', '조건'], [
      ['Confirmed Region $\\mathcal D^{*}$', '제약 충족이 독립 확인 표본·강건 시나리오·인간 검토자 재계산에서 유지됨', 'A', '전체 위기 사례 패널(81건) 적재 + 로컬 재추정 + 강건 CDRS + 인간 검증'],
      ['Boundary Region', '제약 충족 여부가 표본 부족으로 판정되지 않음 (UNRESOLVED)', 'B', '발표된 실증 계수 기준 + 강건 CDRS + 인간 검증'],
      ['Prohibited Region', '하나 이상의 제약 위반이 신뢰구간으로 확인됨 (INFEASIBLE)', 'C', '시뮬레이션 확인'],
      ['탐색적 결과', '탐색 단계 결과만 있음', 'D', '탐색 시뮬레이션']
    ]), '',
    `이 프로젝트의 현재 증거수준: ${t.approval ? `Level ${t.approval.evidence_level}` : '미확정'}. 실증 패널 상태: ${t.empirical?.readiness || '-'} (${t.empirical?.complete_rows ?? 0}/${t.empirical?.target_rows ?? 81}).`, '');
  L.eqUsed = used;
  return L;
}
export const MODEL_EQ_ORDER = null;
