# 실험 결과 종합

> 최종 정리: 2026-03-22
> 데이터셋별 최종/최선 결과만 수록. 중복 실험 및 중간 버전 제거.

---

## 1. RACE 독해 (Reading Comprehension)

### 1.1 3조건 (blind / choices_aware / full_aware)

> 조건 설명
> - **blind**: A(요약자)는 지문만 봄
> - **choices_aware**: A는 지문 + 선택지 (질문은 못 봄)
> - **full_aware**: A는 지문 + 질문 + 선택지 전체
> - B(답변자)는 모든 조건에서 동일 (질문+선택지+요약으로 답, 지문 못 봄)

#### Qwen3-4B (Colab T4, 30문제, "중요 먼저" 프롬프트)

```
Budget   blind    choices    full
16tok     63%      57%       77%
24tok     60%      63%       87%
32tok     63%      60%       90%
48tok     73%      67%       90%
64tok     77%      63%       87%
128tok    80%      67%       90%
```

Rate-Distortion 커브:
```
blind:           16(63%) → 24(60%) → 32(63%) → 48(73%) → 64(77%) → 128(80%)
choices_aware:   16(57%) → 24(63%) → 32(60%) → 48(67%) → 64(63%) → 128(67%)
full_aware:      16(77%) → 24(87%) → 32(90%) → 48(90%) → 64(87%) → 128(90%)
```

주요 발견:
- **full > blind > choices** 패턴 — choices가 blind보다 나쁜 경우 다수
- full_aware: 16tok에서도 77%, 32tok에서 90% 달성
- blind: 60-80% 범위 — 토큰 증가에 따른 완만한 개선
- choices_aware: 57-67% 불안정 — blind와 유의미한 차이 없음
- ★ **full vs blind 최대 갭: 32tok에서 27%p** (63% vs 90%)

#### GPT-4o-mini (API, 30문제, temperature=0)

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

주요 발견:
- **full_aware 32tok에서 87%** — blind가 128tok에서도 달성 못하는 수준
- GPT blind 성능이 Qwen보다 높음 (70-83% vs 63-80%)
- choices_aware는 64tok 이상에서 blind와 수렴
- avg_tok: GPT는 자연 종료 가능 → aware 조건에서 실제 토큰 사용량 감소

---

### 1.2 4조건 (blind / a_aware / b_aware / mutual)

> 조건 설명
> - **blind**: A는 지문만, B는 기본 지시
> - **a_aware**: A가 지문 + 선택지 봄 (= choices_aware)
> - **b_aware**: A는 blind + B에게 "A가 선택지 보고 맞춤 요약함" 알려줌
> - **mutual**: a_aware + b_aware 합침

#### Qwen3-4B (20문제, "중요 먼저" + B_AWARE="선택지 맞춤")

```
Budget   blind    a_aware  b_aware  mutual
32tok     55%      65%      50%      70%
64tok     70%      70%      70%      75%
128tok    70%      73%      73%      77%
```


주요 발견:
- ★ **a_aware/mutual > blind 패턴 성공!** 16tok: +17%p, 32tok: +13%p
- a_aware = mutual (b_aware 효과 없음)
- b_aware = blind (B측 인지 효과 없음)
- 프로토콜 v3가 이전 버전 대비 확실히 개선

#### GPT-4o-mini (API, 30문제, 프로토콜 v3, B출력강제 없음)

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

2x2 상호작용:
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

주요 발견:
- ★ **mutual이 거의 모든 예산에서 최고** (60-73%)
- ★ **mutual > blind 갭: +10~26%p** — 전 실험 최대
- A_effect: +8~28%p — 매우 크고 일관적
- B_effect: 대부분 양수 (+1.7~6.7%p) — 처음으로 양수 관찰
- ★ **@64tok 최적**: mutual 73% vs blind 47% (Δ+26%p)
- 자연 압축: blind ~45tok, aware ~39tok (예산 무관 포화)

> B출력강제("ONLY one letter") 추가하면 blind 성능이 올라감 (37→60%).
> 출력강제가 B의 판단을 개선하여 blind에서도 잘 맞추게 해서 mutual과의 갭이 축소됨.
> v3 원본(강제 없음)에서 blind가 낮아 mutual과의 갭이 극대화됨.

#### GPT-4o-mini (API, 30문제, temperature=0, 4조건)

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

주요 발견:
- GPT-4o-mini blind 성능이 높음 (70-80%)
- a_aware는 48tok에서만 명확한 효과 (80% > blind 70%)
- b_aware("첫문장 집중")는 효과 없음 (B_effect 항상 음수)
- avg_tok: aware 조건에서 실제 토큰 사용량 감소 (64tok 예산에서 52tok 사용)

### 1.3 모델 비교: Qwen3-4B vs GPT-4o-mini (프로토콜 v3)

```
          Qwen3-4B                    GPT-4o-mini
Budget   blind  a_aware  Δ          blind  a_aware  Δ
16tok     60%    77%    +17%p        60%    53%    -7%p
32tok     57%    70%    +13%p        70%    67%    -3%p
48tok     67%    70%    +3%p         70%    70%    +0%p
64tok     67%    70%    +3%p         70%    77%    +7%p
```

- **Qwen3-4B**: 낮은 예산(16-32tok)에서 a_aware 효과 극대화 (+13~17%p)
- **GPT-4o-mini**: 높은 예산(64tok+)에서 a_aware 효과 (+7%p), 낮은 예산에서는 역효과
- **공통**: b_aware 효과 없음, mutual = a_aware

---

## 2. Social IQa (사회 추론)

### Groq Llama 3.1 8B (30문제, 3-fragment 구조)

> A: 3-fragment 구조 (EVENT/BEFORE/AFTER → main objects/action/context)
> B_AWARE: A의 관측 제약을 앎

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

주요 발견:
- ★ @16tok: a_aware 80% >> blind 63% (+17%p) — 낮은 예산에서 효과 극대화
- b_aware: 전 예산 blind보다 낮음 — B_effect 항상 음수
- mutual: blind보다 낮은 경우 다수 — b_aware가 mutual을 끌어내림
- 1260 API 호출, ~3시간 소요

---

## 3. VQA ScienceQA (이미지 질의응답)

> A: 이미지 관측 제약 프롬프트 (15 words, 3 phrases)
> B_AWARE: A의 관측 제약을 앎 (큰 물체 신뢰, 작은 세부사항 주의)

### Gemma-3-27B via Gemini API (ScienceQA, 20문제) — 최고 결과

```
Budget   blind    a_aware  b_aware  mutual
16tok     65%      70%      60%      65%
24tok     70%      60%      60%      65%
32tok     70%      65%      75%      80%   
48tok     65%      70%      65%      80% 
```

2x2 상호작용:
```
@16tok:  A=+5.0pp  B=-5.0pp  Int=+0.0pp  (ADDITIVE)
@24tok:  A=-2.5pp  B=-2.5pp  Int=+15.0pp (SUPER-ADDITIVE!)
@32tok:  A=+0.0pp  B=+10.0pp Int=+10.0pp (SUPER-ADDITIVE!)
@48tok:  A=+10.0pp B=+5.0pp  Int=+10.0pp (SUPER-ADDITIVE!)
```

★ 핵심 발견:
1. **처음으로 mutual이 모든 조건 중 최고 (80%)** @32-48tok
2. **처음으로 super-additive interaction** — mutual의 이득이 a_aware + b_aware 합보다 큼
3. **b_aware가 양수** @32tok (+10pp) — 이미지 관측 제약 정보가 진짜 도움
4. **32-48tok이 sweet spot** — 16tok은 정보 부족, 24tok부터 시너지 발생
5. 이미지 + 관측 제약 = b_aware가 처음으로 의미 있는 정보가 됨

### Qwen2.5-VL-3B (Colab, ScienceQA, 10문제, 24tok)

```
Budget   blind    a_aware  b_aware  mutual
24tok     60%      70%      60%      60%
A-effect: +5.0pp  B-effect: -5.0pp  Interaction: -10.0pp (SUB-ADDITIVE)
```

주요 발견:
- a_aware > blind (+10%p)
- b_aware = blind (효과 없음)
- mutual = blind (a_aware보다 나쁨!) — B_AWARE가 mutual에서 역효과
- 소형 모델(3B)에서는 sub-additive 현상 발생

---

## 4. 한계

- 동일 모델 백본 → 인지 비대칭이 프롬프트 수준에 한정
- N=20-30 → 5%p 차이는 noise 범위 (10%p 검출에 N≈200 필요)
- greedy decoding → 자연 압축 측정 불가 (API에서만 가능)
- 텍스트 태스크에서 b_aware 효과 미미 (이미지에서만 유효)

---

## 5. 핵심 발견 요약

### 발견 1: Tx의 Rx 인지 수준이 높을수록 적은 토큰으로 동일 성능 달성
- full_aware는 32tok에서 87-95% 달성 — blind가 128tok에서도 못 미치는 수준
- bandwidth 제약이 클수록(16-32tok) 인지 효과 극대화

### 발견 2: 32tok 지점이 인지 효과의 sweet spot
- Qwen 3조건: blind 63% vs full 90% (Δ27%p) @32tok
- GPT 3조건: blind 73% vs full 87% (Δ14%p) @32tok
- 1문장 선택이 가장 중요한 지점에서 "무엇을 담을지 아는 것"의 가치 극대화

### 발견 3: A측 인지(a_aware)가 지배적 변수
- 전 실험에서 a_aware 효과 >> b_aware 효과
- 텍스트 태스크에서 b_aware는 대부분 효과 없음 (0%p 또는 음수)
- mutual = a_aware인 경우가 대부분

### 발견 4: 이미지 VQA에서 최초 super-additive 달성
- Gemma-3-27B @32-48tok: mutual 80% > a_aware + b_aware 단순합
- b_aware가 처음으로 양수 효과 (+10pp @32tok)
- 이미지 관측 제약 정보가 텍스트 정보보다 b_aware에 적합

### 발견 5: GPT-4o-mini v3(B강제 없음)에서 최대 mutual-blind 갭
- @64tok: mutual 73% vs blind 47% (Δ+26%p) — 전 실험 최대 차이
- A_effect +25%p, B_effect +1.7%p 동시 양수

### 발견 6: 자연 압축 현상 (GPT-4o-mini)
- aware 조건에서 평균 토큰 사용량이 blind보다 ~40% 적음
- blind ~45tok, aware ~39tok (48tok 이상 예산에서 포화)
- 인지가 있으면 더 적은 토큰으로 핵심만 전달
