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
