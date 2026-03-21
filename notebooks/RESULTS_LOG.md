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

## 2026-03-21: 구조화 추출 포맷 (TOPIC/KEY_FACT/CAUSE/RESULT)

### Design
- A는 "information extractor" — 4필드 구조화 추출
- a_aware: A가 질문 타입을 앎 → 해당 필드 상세화 (인코딩 적응)
- b_aware: B가 포맷을 앎 → 관련 필드 집중 (디코딩 적응)
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
