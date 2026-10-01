# FDIC SOD + Financials Connector (v0.5.4)

## 목적
81개 위기 episode 중 미국 은행 사례를 FDIC Certificate Number(CERT)에 연결한 뒤, 공식 BankFind Suite API에서 Financials와 Summary of Deposits(SOD)를 자동 수집한다.

## 증거 역할
- **Financials:** 위기 전후 분기 예금·자산 변화를 독립적으로 점검하는 검증 공변량.
- **SOD:** 연도별 branch deposits와 시장 집중도 검증. 기본 지표는 target bank의 예금이 가장 큰 주(state)를 시장으로 잡아 모든 기관의 branch deposits로 HHI를 계산한다.
- **중요:** FDIC 파생치가 논문 패널의 `peak_outflow` 또는 `concentration`을 자동 덮어쓰지 않는다. 시장 정의와 측정주기가 다르기 때문이다.

## 연결 순서
1. `FDIC 패키지 활성화` → SOD/Financials source 등록.
2. 공식 Failures endpoint 전체를 1회 받아 episode 이름과 보수적으로 매칭.
3. 이름 점수 ≥0.90이고 차순위 후보와 0.12 이상 차이날 때만 자동 `confirmed`.
4. 나머지는 `pending`; UI에서 CERT를 수동 확인할 수 있다.
5. confirmed link만 자동 수집한다.

## 수집 기간
- Financials: episode year-1의 1월 1일부터 episode year 12월 31일까지. 공식 데이터 가용범위 때문에 1992년 이전은 `skipped`.
- SOD: episode year. 공식 전자 데이터 가용범위 때문에 1994년 이전은 `skipped`.

## SOD HHI
`DEPSUMBR`를 CERT별로 합산하고 state market total로 나누어 share를 만든 뒤

`HHI = Σ share_i²`

를 계산한다. 이 지표는 `FDIC-SOD-STATE-HHI-v1`이라는 별도 methodology version으로 저장된다.

## API 키
FDIC BankFind Suite는 2026 release notes에서 API-key governance rollout을 예고하고 있다. 현재 익명 호출이 허용되는 동안 키 없이 동작할 수 있지만, 필요 시 Cloudflare secret `FDIC_API_KEY`를 설정하면 `X-Api-Key`로 전송한다.

## 증거 revision
정기 재수집에서 payload가 동일하면 D1 row를 갱신하지 않고 새 Evidence Revision도 만들지 않는다. 실제 원자료가 변경된 경우만 `EXTERNAL_DATA` evidence로 등록돼 Measure부터 DCV revalidation을 시작한다.


## 재검증 우선순위 (v0.5.5)
FDIC 수집 후 `FDIC-REVERIFY-v1`이 확정 CERT 링크별로 두 진단 차이를 계산한다.

1. `|panel concentration - FDIC state-market HHI|`
2. `|panel peak_outflow - FDIC Financials 최대 peak-to-trough 분기 예금 drawdown|`

각 차이는 비교 가능한 episode 표본 안에서 empirical percentile로 변환하고, 가용 차원의 percentile 평균을 `discrepancy_score`로 사용한다. 점수는 **원자료 재검증 작업 순서**를 정하는 용도이며 통계적 이상치 검정, 오류 확정, 자동 값 교체 규칙이 아니다. reconstructed 여부는 점수에 가산하지 않고 동률 정렬 및 설명 근거에만 사용한다. 비교 차원이 없으면 `INSUFFICIENT`로 표시한다.

우선순위: `CRITICAL >= .80`, `HIGH >= .67`, `MEDIUM >= .33`, `LOW < .33`. 결과는 dashboard, 자동 보고서 표 3C, `fdic_reverification.csv`, audit log에서 확인할 수 있다.
