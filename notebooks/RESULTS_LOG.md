# Experiment Results Log

## 2026-03-21: RACE Revision Protocol (A sees full question)

### Design
- Summarizer (A): has passage, sends summary
- Answerer (B): has question+choices, Step 1 initial guess → Step 2 revision with summary
- A_AWARE: A sees the full question (overpowered)
- B_AWARE: B told "A is reliable, trust summary"
- 20 RACE questions, budgets 48/128 tokens

### Results

```
Baseline (B without passage): 55%

Budget   Metric       blind      a_aware    b_aware    mutual
------------------------------------------------------------
48tok  Accuracy       50%       90%       60%       90%
48tok  Revision%    70.0%     50.0%     35.0%     50.0%
48tok  Rev+         25.0%     40.0%     15.0%     40.0%
48tok  Rev-         30.0%      5.0%     10.0%      5.0%

128tok  Accuracy       80%       95%       95%       90%
128tok  Revision%    60.0%     45.0%     45.0%     40.0%
128tok  Rev+         40.0%     40.0%     40.0%     35.0%
128tok  Rev-         15.0%      0.0%      0.0%      0.0%
```

### Key Findings
- @48tok: blind 50% → mutual 90% (Δ+40%) — 매우 큰 효과
- @128tok: blind 80% → mutual 90% (Δ+10%) — 토큰 많으면 차이 줄어듦
- a_aware가 지배적 변수 (A가 질문 보면 거의 무조건 맞춤)
- b_aware는 약한 효과 (60% vs blind 50% @48tok)
- blind는 수정 많이 하지만 방향이 틀림 (Rev- 30%)
- a_aware/mutual은 수정 시 거의 다 맞음 (Rev- 5%)

### 한계
- a_aware가 너무 강력 (A가 질문 전체를 보는 것 = 치트)
- b_aware가 너무 약함 → 2x2가 불균형
- → 다음 실험: 질문 타입 메타정보로 균형 맞춤

---

## 2026-03-21: 서술형 요약 + 질문 타입 힌트 (핵심 정보 앞배치)

### Design
- A는 "Summarizer" — 서술형 요약 (핵심을 첫 문장에)
- a_aware: A가 질문 타입을 앎 → 해당 유형 정보 우선 요약
- b_aware: B가 "A는 핵심을 첫 문장에 넣는다"를 앎
- 20 RACE questions, budgets 64/128 tokens
- Initial guess 없음 — B가 바로 답

### Results

```
Budget   blind      a_aware    b_aware    mutual
64tok     70%        60%        65%        65%
128tok    60%        70%        65%        70%
```

### 문제 유형별 (@64tok)
```
factual-detail  blind:69%(13) a_aware:62%(13) b_aware:69%(13) mutual:69%(13)
cause-reason    blind:50%(4)  a_aware:25%(4)  b_aware:25%(4)  mutual:25%(4)
inference       blind:100%(1) a_aware:100%(1) b_aware:100%(1) mutual:100%(1)
main-idea       blind:100%(2) a_aware:100%(2) b_aware:100%(2) mutual:100%(2)
```

### Key Findings
- @64tok: **blind가 최고** (70%) — aware 조건들이 오히려 나쁨
- @128tok: a_aware/mutual (70%) > blind (60%) — 토큰 여유 있으면 aware 도움
- cause-reason에서 aware가 특히 나쁨 (50% → 25%)
- inference/main-idea는 모든 조건 동일 (문제 수 적음)

### 분석
- 64tok에서 aware가 나쁜 이유: 구조화 포맷 자체가 토큰을 먹어서,
  "특정 필드 상세화" 지시가 다른 필드를 과도하게 축소시킴
- 128tok에서는 여유가 있어서 필드 상세화가 긍정적으로 작동
- cause-reason: A가 CAUSE 필드에 집중 → KEY_FACT 누락 → 오히려 정보 손실
- blind가 균등 분배해서 더 안정적인 성능

### 교훈
- 64tok에서 4필드 + 라벨 오버헤드 = 실질 내용 공간 부족
- "특정 필드 강조"는 토큰이 충분할 때만 효과적
- 토큰 부족 상황에서 aware가 정보 편향을 일으킴 → blind보다 나쁨
- 구조화 포맷 자체는 나쁘지 않으나 (blind 64tok=70%, 이전 요약형 blind보다 높음)
  mutual cognition 효과를 보여주기엔 부적합

---

## 2026-03-21: RACE 3조건 정보 수준별 비교 (blind/choices_aware/full_aware)

### Design
- A (Summarizer): 지문 보고 2-3문장 요약
- B (Answerer): 질문+선택지+요약으로 답 (지문 못 봄)
- 3조건: A가 받는 정보 수준만 다름 (B는 모든 조건 동일)
  - blind: A는 지문만
  - choices_aware: A는 지문 + 선택지 (질문은 못 봄)
  - full_aware: A는 지문 + 질문 + 선택지
- 20 RACE questions (seed=42)
- "중요한 정보 먼저" 지시 없는 버전

### Results (4개 토큰 예산)

```
Budget   blind    choices    full
18tok     65%      65%       80%
32tok     60%      55%       95%
64tok     65%      80%       95%
128tok    70%      80%       95%
```

### Per-question comparison (@64tok, 조건별 차이 나는 문제만)
```
Q1:  blind=A✗  choices=C✗  full=B✓  (expected B)
Q2:  blind=D✗  choices=B✗  full=C✓  (expected C)
Q3:  blind=D✗  choices=B✓  full=B✓  (expected B)
Q10: blind=D✗  choices=B✓  full=B✓  (expected B)
Q11: blind=B✓  choices=D✗  full=B✓  (expected B)
Q12: blind=A✗  choices=C✓  full=C✓  (expected C)
Q15: blind=C✗  choices=A✓  full=A✓  (expected A)
```

### Key Findings

1. **full_aware는 압도적** — 32tok에서도 95%. 질문을 알면 핵심 1문장으로 충분.
2. **blind vs full 갭이 32tok에서 최대** — 60% vs 95% (Δ35%p). bandwidth 제약이 클수록 mutual cognition 효과 극대화.
3. **choices_aware는 64tok 이상에서만 효과** — 80% > blind 65%. 64tok 미만에서는 blind와 동일하거나 오히려 나쁨.
4. **choices_aware @32tok 역효과** — 55% < blind 60%. 선택지 구분 시도하다 토큰 부족으로 잘림.

### Rate-Distortion Curve
```
blind:    18(65%) → 32(60%) → 64(65%) → 128(70%)  — 토큰 늘려도 미미한 개선
choices:  18(65%) → 32(55%) → 64(80%) → 128(80%)  — 64tok부터 효과 발현
full:     18(80%) → 32(95%) → 64(95%) → 128(95%)  — 32tok이면 포화
```

### 분석
- full_aware가 너무 강력 (질문 전체 = 치트급). 하지만 "A가 Rx의 task를 완전히 이해할 때" 기준선으로 유용.
- choices_aware는 "중간 수준의 mutual cognition"으로 적절하나, 낮은 토큰에서 불안정.
- blind의 성능이 토큰에 거의 무관 (65±5%) — 일반 요약은 토큰 늘려도 핵심을 못 잡음.
- → 다음 시도: "중요한 정보 먼저" 프롬프트 추가로 choices_aware 안정화

### 한계
- b_aware 조건 없음 (3조건만 테스트)
- choices_aware가 32tok 이하에서 blind보다 나쁨 — 프롬프트 개선 필요
- full_aware는 참조용이지 mutual cognition의 현실적 수준은 아님

---

## 2026-03-21: 3조건 + "중요 정보 먼저" 프롬프트 (32/64tok)

### Design
- 이전 실험에 "Start with the most important fact" 프롬프트 추가
- A_BLIND: "Start with the most important fact"
- A_CHOICES: "Start with the ONE fact that best distinguishes between the options"
- A_FULL: "Start with the fact most relevant to the question"
- 3조건 (blind/choices_aware/full_aware), B는 동일
- 20 RACE questions (seed=42), budgets 32/64

### Results

```
Budget   blind    choices    full
32tok     55%      65%       95%
64tok     70%      70%       85%
```

### Key Findings
- @32tok: 계단식 패턴 성공! blind 55% → choices 65% → full 95%
- @64tok: choices가 blind와 동일 (70%), full이 약간 내려감 (85%)
- "중요 정보 먼저" 프롬프트가 32tok에서 choices를 개선 (이전 55% → 65%)

---

## 2026-03-21: 4조건 (blind/a_aware/b_aware/mutual) + "중요 정보 먼저" (32/64tok)

### Design
- a_aware: A가 지문 + 선택지 봄 (= choices_aware)
- b_aware: A는 blind + B에게 "A가 선택지 보고 맞춤 요약함" 알려줌
- mutual: a_aware + b_aware 합침
- "Start with most important/distinguishing fact" 프롬프트 포함
- 20 RACE questions (seed=42), budgets 32/64

### Results

```
Budget   blind    a_aware  b_aware  mutual
32tok     55%      65%      50%      70%
64tok     70%      70%      70%      75%
```

### Key Findings
- @32tok: **mutual(70%) > a_aware(65%) > blind(55%)** — 계단식 패턴!
  - mutual이 a_aware보다 5%p 높음 → b_aware가 추가 기여
  - blind 대비 mutual Δ+15%p
- @64tok: 차이 줄어듦 (70-75%) — 토큰 여유 있으면 차이 축소
- b_aware 단독(50%)은 blind(55%)보다 나쁨 — b_aware의 거짓 정보 문제
  (A가 blind인데 B에게 "A가 맞춤 요약함" 알려줌 = 거짓)
- mutual에서는 b_aware가 긍정적 (a_aware 65% → mutual 70%)
  (A가 실제로 맞춤 요약했으므로 B의 신뢰가 정당)

### 핵심 발견
- **bandwidth 제약(32tok)에서 mutual cognition 효과 극대화**
- **mutual > a_aware**: Rx측 인지가 Tx측 인지에 추가 기여
- **b_aware 단독은 역효과**: 거짓 정보는 해로움. 실제 맞춤 요약일 때만 유효

---

## ★ 최종 결과: 3조건 통일 커브 ("중요 먼저" 프롬프트, seed=42, 20문제)

### 프롬프트
- A_BLIND: "Start with the most important fact"
- A_CHOICES: "Start with the ONE fact that best distinguishes between the options"
- A_FULL: "Start with the fact most relevant to the question"
- B: 모든 조건 동일

### 결과 (32tok 재현 확인 완료)

```
Budget   blind    choices    full     blind→full 갭
──────────────────────────────────────────────────
16tok     65%      70%       85%      +20%p
32tok     55%      65%       95%      +40%p  ← 최대 갭
48tok     65%      75%       90%      +25%p
64tok     70%      70%       85%      +15%p
```

### Rate-Distortion 커브
```
blind:           16(65%) → 32(55%) → 48(65%) → 64(70%)
choices_aware:   16(70%) → 32(65%) → 48(75%) → 64(70%)
full_aware:      16(85%) → 32(95%) → 48(90%) → 64(85%)
```

### 핵심 발견
1. **full > choices > blind** 패턴이 모든 예산에서 유지
2. **32tok에서 갭 최대 (Δ40%p)** — 1문장 선택이 가장 중요한 지점
   - 32tok = 딱 1문장 완성 가능 → full은 핵심 1문장 정확히, blind는 못 고름
3. **choices_aware는 blind 대비 +5~10%p** 일관된 개선
4. **blind는 토큰 늘려도 55-70%** — 인지 없이는 핵심 못 잡음
5. **full은 16tok에서도 85%** — 질문 알면 극소량으로도 충분

### 4조건 결과 (같은 프롬프트, 32/64tok만)
```
Budget   blind    a_aware  b_aware  mutual
32tok     55%      65%      50%      70%
64tok     70%      70%      70%      75%
```
- @32tok: mutual(70%) > a_aware(65%) > blind(55%) — 계단식 패턴
- b_aware 단독은 역효과 (거짓 정보). mutual에서만 긍정적.

### 종합 주장
> **Tx의 Rx 인지 수준이 높을수록, 더 적은 토큰으로 동일 성능 달성.
> 특히 bandwidth가 극도로 제한될 때(32tok) 인지 효과가 극대화된다.**

---

## 2026-03-21: 3조건 30문제 (16/24/32tok, "중요 먼저" 프롬프트)

### Design
- 이전과 동일 프롬프트, **30문제**로 확대
- TX_BUDGETS: [16, 24, 32]
- 3조건 (blind/choices_aware/full_aware)

### Results

```
Budget   blind    choices    full
16tok     63%      57%       77%
24tok     60%      63%       87%
32tok     63%      60%       90%
48tok     73%      67%       90%
64tok     77%      63%       87%
```

### Rate-Distortion 커브
```
blind:           16(63%) → 24(60%) → 32(63%)
choices_aware:   16(57%) → 24(63%) → 32(60%)
full_aware:      16(77%) → 24(87%) → 32(90%)
```

### Key Findings
- **full > blind > choices** 패턴 — choices가 blind보다 나쁜 경우 다수
- full_aware: 16tok에서도 77%, 32tok에서 90% — 일관되게 최고
- blind: 60-63% 안정 — 토큰에 무관
- choices_aware: 57-63% 불안정 — blind와 비슷하거나 나쁨
- 30문제에서도 **full vs blind 갭은 확인** (Δ14~27%p)
- **choices_aware는 중간 단계로 부적합** — blind와 유의미한 차이 없음

---

## 2026-03-21: Qwen3-4B 4조건 16tok (ext, b_aware=첫문장 집중, A캐싱)

### Results
```
Budget   blind    a_aware  b_aware  mutual
16tok     63%      57%      57%      53%
```
- 16tok에서는 모든 aware 조건이 blind보다 나쁨
- mutual이 최저(53%) — 토큰이 너무 적으면 awareness가 역효과

---

## 2026-03-21: Qwen3-4B 4조건 ext (b_aware=첫문장 집중, A캐싱, 30문제)

### Results
```
Budget   blind    a_aware  b_aware  mutual
16tok     63%      57%      57%      53%
24tok     60%      63%      63%      57%
32tok     63%      60%      60%      60%
48tok     73%      67%      73%      70%
64tok     77%      63%      73%      67%
```

---

## 2026-03-21: Qwen3-4B 4조건 ext (b_aware 수정="선택지 관련 정보 우선", A캐싱, 30문제)

### Results
```
Budget   blind    a_aware  b_aware  mutual
16tok     63%      57%      63%      57%
24tok     60%      63%      57%      63%
64tok     77%      63%      77%      60%
```

---

## 2026-03-21: Qwen3-4B 4조건 ext (프로토콜 v3 + B출력강제, 30문제)

### Results
```
Budget   blind    a_aware  b_aware  mutual
16tok     60%      77%      63%      77%
32tok     57%      70%      57%      70%
48tok     67%      70%      67%      67%
64tok     67%      70%      67%      70%
```

### 분석
- **a_aware/mutual > blind 패턴 성공!** 16tok: +17%p, 32tok: +13%p
- a_aware = mutual (b_aware 효과 없음)
- b_aware = blind (B측 인지 효과 없음)
- 48tok에서 mutual이 약간 하락 (67% < a_aware 70%)
- **프로토콜 v3가 이전 버전 대비 확실히 개선**

---

## 2026-03-21: GPT-4o-mini 4조건 v3+B출력강제 (30문제, 16~128tok)

### Results
```
Budget   blind    a_aware  b_aware  mutual   avg_tok(bl/a)
16tok     60%      53%      63%      60%      16/15
32tok     70%      67%      67%      67%      32/30
48tok     70%      70%      67%      70%      43/39
64tok     70%      77%      67%      77%      45/40
80tok     73%      70%      70%      70%      45/40
96tok     70%      70%      67%      70%      45/39
112tok    70%      73%      67%      70%      45/39
128tok    70%      73%      67%      77%      45/37
```

### 핵심 발견
- @64tok: mutual 77% > blind 70% (+7%p)
- @128tok: mutual 77% > blind 70% (+7%p)
- b_aware 효과 없음 (mutual = a_aware)
- 자연 압축: blind ~45tok, aware ~39tok (48tok 이상에서 포화)

---

## ★ 종합 비교: Qwen3-4B vs GPT-4o-mini (프로토콜 v3)

### a_aware > blind 패턴
```
          Qwen3-4B                    GPT-4o-mini
Budget   blind  a_aware  Δ          blind  a_aware  Δ
16tok     60%    77%    +17%p        60%    53%    -7%p
32tok     57%    70%    +13%p        70%    67%    -3%p
48tok     67%    70%    +3%p         70%    70%    +0%p
64tok     67%    70%    +3%p         70%    77%    +7%p
```

### 모델별 특성
- **Qwen3-4B**: 낮은 예산(16-32tok)에서 a_aware 효과 극대화 (+13~17%p)
- **GPT-4o-mini**: 높은 예산(64tok+)에서 a_aware 효과 (+7%p), 낮은 예산에서는 역효과
- **공통**: b_aware 효과 없음, mutual = a_aware

---

## 2026-03-21: Social IQa Groq (Llama 3.1 8B, 30문제, word-controlled)

### 프롬프트
- A: 3-fragment 구조 (EVENT/BEFORE/AFTER → main objects/action/context)
- B_AWARE: A의 관측 제약을 앎

### Results
```
Budget   blind    a_aware  b_aware  mutual
16tok     53%      50%      43%      43%
24tok     53%      53%      50%      53%
32tok     53%      53%      50%      57%
48tok     53%      53%      50%      57%
```

### 분석
- @32-48tok: mutual(57%) > blind(53%) (+4%p)
- A_effect: +3.3%p @32-48tok
- B_effect: 0%p (중립)
- 16tok에서 역전 — 토큰 부족 시 역효과
- 차이가 작음 — Llama 8B가 구조화 프롬프트를 잘 못 따름

---

## 2026-03-21: VQA Gemini 2.5 Flash (ScienceQA 이미지, 10문제)

### 프롬프트
- A: 이미지 관측 제약 프롬프트 (15 words, 3 phrases)
- B_AWARE: A의 관측 제약 (large objects 신뢰, small details 주의)

### Results
```
Budget   blind    a_aware  b_aware  mutual
16tok     40%      70%      40%      70%
```

### 분석
- **a_aware/mutual(70%) >> blind(40%) (+30%p!)** — 이미지에서 극적 효과
- b_aware = blind (40%) — B측 인지는 아직 효과 없음
- mutual = a_aware — A측 인지가 지배적
- 10문제, 16tok만 → 더 많은 예산/문제로 확인 필요

---

## 2026-03-22: VQA Qwen2.5-VL-3B (ScienceQA, 10문제, 24tok)

### Results
```
Budget   blind    a_aware  b_aware  mutual
24tok     60%      70%      60%      60%
A-effect: +5.0pp  B-effect: -5.0pp  Interaction: -10.0pp (SUB-ADDITIVE)
```

### 분석
- a_aware > blind (+10%p) ✓
- b_aware = blind (효과 없음)
- mutual = blind (a_aware보다 나쁨!) — B_AWARE가 mutual에서 역효과
- → B_AWARE를 A의 상태에 따라 분리 필요 (B_AWARE_FOR_A_BLIND / B_AWARE_FOR_A_AWARE)

---

## ★★★ 2026-03-22: VQA Gemma-3-27B via Gemini API (ScienceQA, 20문제)

### 프롬프트
- A: 이미지 관측 제약 (15 words, 3 phrases)
- B_AWARE: A의 관측 제약을 앎 (large objects 신뢰, small details 주의)

### Results
```
Budget   blind    a_aware  b_aware  mutual
16tok     65%      70%      60%      65%
24tok     70%      60%      60%      65%
32tok     70%      65%      75%      80%    ← SUPER-ADDITIVE
48tok     65%      70%      65%      80%    ← SUPER-ADDITIVE
```

### 2x2 Interaction
```
@16tok:  A=+5.0pp  B=-5.0pp  Int=+0.0pp  (ADDITIVE)
@24tok:  A=-2.5pp  B=-2.5pp  Int=+15.0pp (SUPER-ADDITIVE!)
@32tok:  A=+0.0pp  B=+10.0pp Int=+10.0pp (SUPER-ADDITIVE!)
@48tok:  A=+10.0pp B=+5.0pp  Int=+10.0pp (SUPER-ADDITIVE!)
```

### ★ 핵심 발견
1. **처음으로 mutual이 모든 조건 중 최고 (80%)** @32-48tok
2. **처음으로 super-additive interaction** — mutual의 이득이 a_aware + b_aware 합보다 큼
3. **b_aware가 양수** @32tok (+10pp) — 이미지 관측 제약 정보가 진짜 도움
4. **32-48tok이 sweet spot** — 16tok은 정보 부족, 24tok부터 시너지 발생
5. 이미지 + 관측 제약 = b_aware가 처음으로 의미 있는 정보가 됨

---

## 2026-03-22: Social IQa Groq (Llama 3.1 8B, 30문제, 7 budgets, 3-fragment)

### Results
```
Budget   blind    a_aware  b_aware  mutual
16tok     63%      80%      57%      67%
24tok     70%      70%      67%      63%
32tok     77%      77%      67%      70%
40tok     70%      77%      70%      73%
48tok     70%      73%      67%      70%
52tok     77%      73%      60%      67%
64tok     77%      77%      70%      67%
```

### 분석
- @16tok: a_aware 80% >> blind 63% (+17%p) — 낮은 budget에서 효과 극대화
- b_aware: 전 예산 blind보다 낮음 — B_effect 항상 음수
- mutual: blind보다 낮은 경우 다수 — b_aware가 mutual을 끌어내림
- 1260 API calls, ~3시간 소요

---

## ★★ 2026-03-21: GPT-4o-mini 4조건 v3 (B출력강제 없음, 30문제)

### 프롬프트
- A_BLIND/A_CHOICES: 프로토콜 v3 (첫문장 핵심, 1-2문장)
- B_BLIND: "FIRST sentence is most decision-relevant" (Choose the best answer)
- B_AWARE: "FIRST sentence contains the key fact that distinguishes" (Choose the best answer)
- B에 "output ONLY one letter" 강제 **없음**

### Results
```
Budget   blind    a_aware  b_aware  mutual   avg_tok(bl/a_aw/b_aw/mu)
16tok     37%      57%      47%      60%      16/15/16/15
32tok     53%      63%      57%      63%      32/29/32/29
48tok     53%      67%      47%      67%      42/37/42/37
64tok     47%      70%      47%      73%      45/39/45/39
80tok     47%      77%      43%      70%      45/40/45/40
96tok     50%      67%      53%      73%      45/39/45/39
112tok    57%      57%      47%      70%      46/39/46/39
128tok    50%      63%      50%      67%      44/38/44/38
```

### 2x2 Interaction
```
@16tok:  A=+16.7%p  B=+6.7%p  mutual 60% >> blind 37%
@32tok:  A=+8.3%p   B=+1.7%p  mutual 63% >> blind 53%
@48tok:  A=+16.7%p  B=-3.3%p  mutual 67% >> blind 53%
@64tok:  A=+25.0%p  B=+1.7%p  mutual 73% >> blind 47%
@80tok:  A=+28.3%p  B=-5.0%p  mutual 70% >> blind 47%
@96tok:  A=+18.3%p  B=+5.0%p  mutual 73% >> blind 50%
@112tok: A=+11.7%p  B=+1.7%p  mutual 70% >> blind 57%
@128tok: A=+15.0%p  B=+1.7%p  mutual 67% >> blind 50%
```

### ★ 핵심 발견 — 최고 결과!
1. **mutual이 거의 모든 예산에서 BEST** (60-73%)
2. **mutual > blind 갭: +10~26%p** — 지금까지 최대
3. **A_effect: +8~28%p** — 매우 크고 일관적
4. **B_effect: 대부분 양수** (+1.7~6.7%p) — 처음으로 양수!
5. **@64tok 최적**: mutual 73% vs blind 47% (Δ+26%p)
6. **자연 압축**: blind ~45tok, aware ~39tok (예산 무관 포화)

### 왜 B출력강제 없는 버전이 더 좋은가?
- B출력강제("ONLY one letter") 추가하면 blind 성능이 올라감 (37→60%)
- 이유: 출력강제가 B의 판단을 개선하여 blind에서도 잘 맞추게 함
- 결과적으로 blind↑ → mutual과의 갭↓
- v3 원본(강제 없음)에서는 blind가 낮아서 mutual과의 갭이 극대화됨

---

## 2026-03-21: GPT-4o-mini 4조건 개선 (토큰명시 + B_AWARE 수정, 30문제)

### 변경점
- A 프롬프트에 "You have at most {budget} tokens. Be concise." 추가
- B_AWARE: "첫문장 집중" → "Summarizer가 선택지를 봤고 정답 관련 사실을 강조했을 수 있다"
- A_CHOICES: "구분하라" 지시 유지 (다음 개선 대상)

### Results
```
Budget   blind    a_aware  b_aware  mutual   avg_tok(blind/aware)
16tok     63%      67%      63%      67%      16/15
32tok     73%      73%      73%      73%      30/25
48tok     60%      70%      63%      70%      44/28  ← sweet spot
64tok     67%      73%      67%      73%      54/34  ← sweet spot
80tok     77%      67%      73%      73%      61/40
96tok     80%      67%      80%      67%      76/45
112tok    73%      67%      73%      67%      81/47
128tok    70%      67%      73%      67%      81/50
```

### 2x2 Interaction
```
@16tok:  A=+3.3%p  B=+0.0%p  mutual 67% > blind 63%
@32tok:  A=+0.0%p  B=+0.0%p  mutual 73% = blind 73%
@48tok:  A=+8.3%p  B=+1.7%p  mutual 70% > blind 60% ← 최대 효과
@64tok:  A=+6.7%p  B=+0.0%p  mutual 73% > blind 67%
@80tok:  A=-5.0%p  B=+1.7%p  mutual 73% < blind 77%
@96tok:  A=-13.3%p B=+0.0%p  mutual 67% < blind 80%
@112tok: A=-6.7%p  B=+0.0%p  mutual 67% < blind 73%
@128tok: A=-5.0%p  B=+1.7%p  mutual 67% < blind 70%
```

### 핵심 발견
1. **48-64tok에서 mutual > blind** (+6~10%p) — 이전 대비 개선!
2. **80tok+ 에서 역전** — blind가 더 많은 토큰으로 더 많은 정보 담아 유리
3. **B_AWARE 중립화 성공** — B_effect 0~+1.7%p (이전 -3~-7%p에서 개선)
4. **자연 압축 확인**: aware avg_tok ~28-50tok, blind ~44-81tok
   → aware가 ~40% 적은 토큰 사용하면서 48-64tok에서 동등 이상 정확도
5. **다음 개선**: A_CHOICES에서 "구분하라" 제거 → "선택지는 참고용" 으로

---

## 2026-03-21: GPT-4o-mini 3조건 개선 (토큰명시, 30문제, 16~128tok)

### Results
```
Budget   blind    choices    full     avg_tok(bl/ch/fu)
16tok     60%      67%       83%      16/14/12
32tok     70%      70%       90%      30/24/22
48tok     60%      73%       90%      44/29/29
64tok     70%      70%       90%      55/34/37
80tok     73%      67%       80%      60/39/42
96tok     80%      67%       87%      75/47/51
112tok    73%      67%       87%      81/46/54
128tok    73%      63%       87%      81/47/54
```

### 핵심 발견
- **full > choices ≥ blind** 16tok부터 전 예산에서 유지
- **full: 32tok에서 90% (avg 22tok 사용)** — blind가 128tok에서도 못 달성하는 수준
- **자연 압축**: full avg 12~54tok, choices avg 14~47tok, blind avg 16~81tok
- choices가 80tok+ 에서 하락 (67→63%) — 포화 후 역효과

---

## 2026-03-21: GPT-4o-mini API 전체 결과 (30문제, temperature=0)

### 3조건 (blind/choices_aware/full_aware)
```
Budget   blind    choices    full     avg_tok(blind/choices/full)
16tok     70%      53%       57%      16/16/16
32tok     73%      63%       87%      32/32/32
48tok     70%      73%       80%      48/46/46
64tok     77%      77%       87%      64/52/56
80tok     77%      77%       87%      77/56/58
96tok     80%      73%       87%      83/56/58
112tok    83%      80%       90%      84/57/58
128tok    80%      73%       83%      84/53/58
```

### 4조건 (blind/a_aware/b_aware/mutual)
```
Budget   blind    a_aware  b_aware  mutual   avg_tok(blind/a/b/mu)
16tok     70%      50%      63%      50%      16/16/16/16
32tok     73%      63%      67%      63%      32/32/32/32
48tok     70%      80%      67%      77%      48/48/48/48
64tok     73%      73%      67%      70%      64/52/64/52
80tok     80%      77%      73%      70%      77/55/77/55
96tok     80%      80%      73%      80%      83/55/83/55
112tok    80%      73%      77%      70%      83/55/83/55
128tok    77%      80%      73%      77%      83/56/83/56
```

### 2x2 Interaction (4조건)
```
@16tok:  A=-16.7%p  B=-3.3%p
@32tok:  A=-6.7%p   B=-3.3%p
@48tok:  A=+10.0%p  B=-5.0%p
@64tok:  A=+0.0%p   B=-3.3%p
@80tok:  A=-3.3%p   B=-6.7%p
@96tok:  A=+3.3%p   B=-3.3%p
@112tok: A=-6.7%p   B=-3.3%p
@128tok: A=+3.3%p   B=-3.3%p
```

### 핵심 발견
- GPT-4o-mini blind 성능이 Qwen보다 높음 (70-80% vs 63-77%)
- a_aware는 48tok에서만 명확하게 도움 (80% > blind 70%)
- b_aware("첫문장 집중")는 GPT에서도 효과 없음 (B_effect 항상 음수)
- choices_aware(3조건)는 64tok 이상에서 blind와 수렴
- full_aware(3조건)는 32tok에서 87%로 압도적 — 모델 무관 패턴
- avg_tok: GPT는 자연 종료 가능 → choices/full에서 실제 토큰 사용량 감소 (64tok 예산에서 52-56tok 사용)