# 박사논문 심사 방어 체크리스트 — DCV v0.5.0

이 문서는 특정 대학의 공식 심사기준이 아니라, 공학박사 심사에서 반복적으로 제기되는 방법론적 쟁점을 DCV 연구설계에 대응시킨 내부 점검표다.

## 1. 가장 강한 공격 지점과 코드 대응

1. **후보 탐색 후 같은 95% CI를 사용하면 선택 편향이 생기지 않는가?**
   - Exploration은 탐색으로 명시하고, confirmation/historical/stress/recompute에서 Bonferroni family-wise CI를 사용한다.
   - `UNRESOLVED != INFEASIBLE`를 유지한다.

2. **81개 사례 중 reconstructed 자료가 많아 calibration uncertainty를 과소평가하지 않는가?**
   - verified/estimated 층을 유지한 bootstrap을 수행한다.
   - estimated row에 peak_outflow ±0.05, severity ±0.10의 문서화된 측정오차를 동시에 perturb한다.
   - representative coefficient draws를 CDRS stress scenario에 투입한다.

3. **FP/FN 비용이 정말 empirical cost인가?**
   - 아니다. crisis panel은 지급정지의 직접 사회적 비용을 관측하지 않는다.
   - 코드/보고서에서 `PROXY_ONLY`로 표시하고, point estimate뿐 아니라 proxy band를 stress test한다.

4. **인간실험의 100개 trial을 100개의 독립 관측으로 보는 오류는 없는가?**
   - 참가자 단위 cluster bootstrap을 사용한다.
   - 최소 참가자 수와 correct/wrong trial 수를 사전 gate로 둔다.

5. **자동 에이전트가 자기 결과를 스스로 승인하면 circular validation 아닌가?**
   - 자동화는 `COMPUTATIONALLY_CONFIRMED`까지만 가능하다.
   - `SCIENTIFICALLY_APPROVED`는 PI/심사자의 명시적 수동 sign-off만 허용한다.

6. **다른 사례에서도 유지된다는 주장이 너무 약하지 않은가?**
   - 단순 slope sign을 폐기하고 shared sigma grid에서 Spearman rho, mean absolute K-boundary difference, non-positive slope를 동시에 요구한다.

## 2. 논문에서 반드시 제한해야 하는 주장

### 지원 가능한 주장
- 명시된 제약조건과 시나리오 집합 하에서의 Delegation Feasible Region 존재 여부
- 독립 확인표본과 강건성 시나리오를 통과한 후보의 상대적 설계 비교
- 선언된 불확실성 집합 안에서의 Minimax Regret 비교
- 인간 검토 행동을 반영했을 때 경계가 어떻게 이동하는지에 대한 조건부 결과

### 현재 자료만으로 지원하면 안 되는 주장
- 실제 국가 또는 기관의 절대 위기발생확률 예측
- FP/FN의 직접 사회적·재정적 비용 추정
- 위임권한 K의 인과효과
- 모든 공공 지급결제 업무에 공통인 보편적 최적 임계값
- 작은 인간실험 표본에서의 모집단 보편화

## 3. 국제저널 수준으로 추가하면 좋은 현실적 후속 작업

- 최소 한 개의 완전히 독립된 두 번째 공공 지급결제 사례를 사전 고정한 뒤 replication 수행
- 인간실험 표본크기 사전 power analysis 및 실험 프로토콜 preregistration
- FP/FN proxy를 실제 행정·재정 cost data로 교체하는 별도 비용연구
- sensitivity surface 전체를 archive하고 candidate-level raw seed/run manifest 공개
- 외부 연구자가 재실행할 수 있는 frozen Docker/lockfile 또는 reproducibility bundle 제공
- 제2편 논문에서는 absolute performance보다 boundary identification 방법 자체의 novelty를 전면에 배치

## 4. 방어용 한 문장

> 본 연구는 알고리즘의 절대적 우월성이나 실제 위기확률을 예측하는 연구가 아니라, 사전에 동결한 제약·불확실성·검증 규칙 하에서 집행권한 위임의 조건부 경계를 식별하고, 그 경계가 보정오차·인간행동·사례이식에도 유지되는지를 재현 가능하게 검증하는 연구이다.
