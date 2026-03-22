# Key Idea 1: 실험 문제점 + 돌파구 기록

## 반복되는 문제들

### 문제 1: Tx가 항상 128토큰 꽉 참 (TRUNCATED)
- **원인**: `do_sample=False` (greedy decoding)에서 모델이 EOS 토큰을 생성하지 않음
- **결과**: 모든 조건에서 Tx=128tok → 조건별 토큰 차이 측정 불가
- **시도한 것**: "Be concise", "one sentence", structured format (ANSWER+REASON)
- **결론**: greedy decoding + 4B 모델 = 항상 max_tokens까지 채움. 자연 압축 불가능.

### 문제 2: Rx도 128토큰 꽉 차서 \boxed{} 누락 → N/A
- **원인**: mutual/oneway_tx 조건에서 Tx가 더 구조화된 메시지를 보냄 → Rx가 더 길게 추론 → 128토큰 초과
- **결과**: mutual이 no_context보다 N/A가 더 많음 → mutual이 오히려 성능 악화
- **시도한 것**: max_tokens 256, 512, "answer first" 지시
- **교훈**: max_tokens 올리면 느려지고, 낮추면 잘림. 근본적 해결 안 됨.

### 문제 3: 도메인 잠금 실패
- **원인**: "no scientific training"이라고 해도 Qwen3-4B는 과학 지식을 씀
- **증거**: Tx가 "gyromagnetic ratio", "magnetic inclination" 등 과학 용어 사용
- **결론**: 프롬프트로 지식을 제한하는 것은 같은 모델에서 한계가 있음

### 문제 4: 답 누설 (이전 버전)
- **원인**: Tx가 "ANSWER: C" 명시적으로 보냄 → Rx가 복사만 함
- **해결**: "Do NOT reveal answer letter" 지시 → 해결됨
- **교훈**: 하지만 semantic leaking은 여전히 존재 (답 내용을 설명하면 사실상 답 노출)

### 문제 5: mutual이 no_context보다 나쁜 역설
- **원인**: mutual 조건의 프롬프트가 더 길어서 → Tx/Rx 모두 유효 토큰 공간 감소
- **결과**: Q2에서 no_context=✓, mutual=N/A (토큰 부족으로 답 못 냄)
- **핵심 모순**: mutual cognition 정보를 추가할수록 실제 통신 공간이 줄어듦

## 근본 원인 분석

### 핵심: "자연 압축"이 불가능
- 우리가 측정하고 싶은 것: "mutual cognition → Tx가 자발적으로 짧게 보냄"
- 현실: Qwen3-4B + greedy decoding = 항상 max_tokens까지 생성
- 토큰 수 차이가 나려면 모델이 스스로 EOS를 생성해야 하는데, 그렇지 않음

### 핵심: 같은 모델의 한계
- Math agent도 과학 알고, Science agent도 수학 앎
- 프롬프트 제약은 soft constraint — 모델 weights에는 모든 지식이 있음
- "진짜" 도메인 전문가 효과를 내려면 이종 모델(heterogeneous)이 필요

## 돌파구 후보

### 돌파구 A: 고정 토큰 예산 비교 (Fixed Budget Comparison)
- 자연 압축을 포기하고, **동일 토큰 예산에서 정확도 비교**
- Tx에게 32, 64, 128 토큰 각각 주고 → 어느 조건이 같은 예산에서 더 높은 정확도?
- mutual이 32토큰에서도 no_context 64토큰만큼의 정확도 → "mutual cognition이 통신 효율 개선"
- 장점: 토큰 수 측정 문제 완전 회피
- 단점: 실행 시간 3배 (3개 예산 x 4조건)

### 돌파구 B: do_sample=True 사용
- temperature=0.1 정도로 약간의 랜덤성 → EOS 생성 확률 증가
- 모델이 자연스럽게 멈출 수 있음 → 토큰 수 차이 측정 가능
- 단점: 결과 재현성 저하, 여러 번 돌려서 평균 필요

### 돌파구 C: 구조화된 종료 토큰
- Tx 프롬프트에 "End your message with [END]" 추가
- 생성 후 [END] 이후를 잘라냄 → 유효 토큰만 카운트
- 장점: greedy decoding 유지하면서 자연 종료점 확보
- 단점: 모델이 [END]를 제대로 생성하는지 불확실

### 돌파구 D: 실험 프레이밍 전환
- 토큰 효율성 측정을 포기하고, **정확도 차이만** 측정
- "mutual cognition이 통신 품질을 개선한다" (같은 토큰 예산에서 더 나은 답)
- 토큰 측정은 이종 모델 후속 연구에서
- 가장 현실적이지만, 논문 스토리가 약해질 수 있음

---

## 2026-03-21 Fix: Rx N/A 문제 근본 해결

### 근본 원인 (정확한 진단)
`\boxed{X}` 포맷이 Qwen3-4B 4B 모델에서 48 토큰 내에 생성 불가능한 이유:

1. **`\boxed{?}` 프라이밍 실패**: user message 끝에 `\boxed{?}`를 넣었지만, 모델은 이것을
   입력의 일부로 보고 새로운 문장을 시작함. 완성(completion)이 아닌 응답(response)을 생성.
2. **Preamble 문제**: "Reply ONLY with \boxed{X}"라고 해도 4B 모델은 greedy decoding에서
   "Based on the analysis..." 같은 서두를 20-40 토큰 생성한 후에야 \boxed{} 도달.
   48 토큰 한도에서 서두만으로 예산 소진.
3. **LaTeX 포맷 오버헤드**: `\boxed{A}`는 토큰화 시 `\`, `boxed`, `{`, `A`, `}` = 최소 5토큰.
   단순 "A"는 1토큰.

### 적용한 수정 (2가지)

**수정 A: Rx 프롬프트를 bare letter 출력으로 변경**
- Before: "Reply ONLY with \boxed{X} where X is A, B, C, or D."
- After: "Output ONLY a single letter: A, B, C, or D. Do not write anything else. No explanation. Just the letter."
- User message를 `"Answer:"` 로 끝냄 → 모델의 첫 토큰이 바로 A/B/C/D가 되도록 프라이밍

**수정 B: 다단계 답 추출기 (extract_answer)**
- Strategy 1: 응답이 정확히 "A"/"B"/"C"/"D" 한 글자 (이상적)
- Strategy 2: `\boxed{X}` (하위 호환)
- Strategy 3: "Answer: X", "answer is X" 패턴
- Strategy 4: 줄 시작이 "A)" 또는 "A." 형태
- Strategy 5: 단어 경계로 둘러싸인 첫 A-D 문자
- Strategy 6: 최후 수단 — 구두점 뒤의 첫 A-D

### 왜 이것이 작동하는가
- "Just the letter" + `Answer:` 프라이밍 = 모델의 첫 토큰이 높은 확률로 A/B/C/D
- 서두를 쓰더라도 extract_answer가 다단계로 잡아냄
- 48 토큰은 bare letter 출력에 충분히 넉넉 (1-5 토큰이면 됨)
- 실험 공정성 유지: 모든 4개 조건이 동일한 Rx 로직 사용

---

## 2026-03-21 Fixed-Budget Results Analysis

### Raw Results

**48 token Tx budget (20 questions, cross-domain physics+chemistry):**

| Condition | Accuracy | Score |
|-----------|----------|-------|
| blind     | 50%      | 10/20 |
| tx_aware  | 55%      | 11/20 |
| rx_aware  | 55%      | 11/20 |
| mutual    | 55%      | 11/20 |

**96 token Tx budget (same 20 questions):**

| Condition | Accuracy | Score |
|-----------|----------|-------|
| blind     | 65%      | 13/20 |
| tx_aware  | 50%      | 10/20 |
| rx_aware  | 65%      | 13/20 |
| mutual    | 55%      | 11/20 |

**Per-question breakdown (48tok) where conditions disagree:**

| Q# | Subject         | blind | tx_aware | rx_aware | mutual | Pattern                |
|----|-----------------|-------|----------|----------|--------|------------------------|
| 3  | college_chem    | X     | O        | X        | O      | Knowing Rx helps       |
| 4  | conceptual_phys | X     | X        | O        | O      | Knowing Tx helps       |
| 8  | conceptual_phys | O     | X        | O        | X      | Awareness HURTS        |
| 10 | college_chem    | X     | O        | X        | X      | Inconsistent           |
| 11 | hs_phys         | O     | X        | O        | X      | Awareness HURTS        |
| 12 | hs_chem         | X     | O        | X        | O      | Knowing Rx helps       |
| 14 | college_chem    | O     | X        | O        | X      | Awareness HURTS        |
| 18 | hs_chem         | X     | O        | X        | O      | Knowing Rx helps       |

### Diagnosis 1: Why 96tok aware conditions perform WORSE than blind

At 96 tokens, blind (65%) beats mutual (55%) by 10 percentage points. tx_aware (50%) is
the worst condition overall. This is not a fluke -- it points to a real mechanism:

**The "overthinking with wrong framing" problem.** When you tell a 4B model "send a
message to a SCIENCE expert, focus on what a scientist needs to hear," it changes what
it writes. At 48 tokens, this change is minor because there is barely any room to
elaborate either way. At 96 tokens, the model has enough room to actually act on the
instruction -- and it acts on it badly. Specifically:

1. **tx_aware distorts content selection.** The blind Tx writes whatever it thinks is
   most relevant. The tx_aware Tx tries to guess what a "science expert" would want to
   hear, and a 4B model's theory-of-mind for this is poor. It may over-emphasize
   scientific jargon, skip the actual reasoning step, or reframe the problem in a way
   that sounds scientific but loses the discriminating information Rx needs.

2. **More tokens amplify bad framing.** At 48tok, both blind and aware Tx produce
   roughly the same truncated output -- the awareness prompt barely changes the first
   48 tokens. At 96tok, the aware Tx has room to go wrong: it writes more
   "science-expert-targeted" content that is actually less useful than the blind Tx's
   straightforward analysis.

3. **Prompt tax at scale.** The aware conditions have slightly longer system prompts.
   This is a constant cost, but at 96tok the model is also trying to satisfy TWO
   objectives (analyze the problem AND tailor for a science expert), splitting its
   limited capacity.

### Diagnosis 2: Why mutual sometimes helps and sometimes hurts

Looking at the per-question breakdown, there is no coherent pattern. Questions where
mutual helps (Q3, Q4, Q12, Q18) and questions where it hurts (Q8, Q11, Q14) do not
cluster by subject, difficulty, or question type. This is the signature of noise, not
signal:

- **Same model, same weights.** Both Tx and Rx are Qwen3-4B. "Telling Tx that Rx is a
  science expert" and "telling Rx that Tx is a science expert" just adds a few tokens
  to the prompt. The model does not actually have a different knowledge base or
  reasoning style for "science mode" vs "general mode." It is the same 4B parameters
  every time.

- **Prompt sensitivity at small scale.** A 4B model's output is highly sensitive to
  small prompt changes. Adding "science expert" to the prompt changes the generation
  trajectory in unpredictable ways -- sometimes this nudge happens to produce a better
  token sequence for a particular question, sometimes worse. This is not mutual
  cognition; it is prompt perturbation.

- **No real asymmetry to exploit.** Mutual cognition theory assumes Agent A knows
  something about Agent B that it can exploit to communicate more efficiently. But
  Qwen3-4B-as-math-expert and Qwen3-4B-as-science-expert share identical weights.
  There is no genuine expertise gap that awareness could bridge. The "awareness" is
  just a system prompt string that mildly perturbs outputs.

### Diagnosis 3: Is N=20 enough?

No. The observed differences are 1-3 questions out of 20. A simple power analysis:

- At 50% baseline accuracy (pure chance among conditions), the standard error for a
  proportion with N=20 is sqrt(0.5 * 0.5 / 20) = 0.112, or 11.2 percentage points.
- The 95% confidence interval for the blind condition at 50% is roughly [28%, 72%].
- The observed 5 percentage point difference (50% vs 55%) is well within sampling noise.
- Even the 96tok result (65% blind vs 50% tx_aware = 15pp gap) has p > 0.20 by a
  two-proportion z-test. Not significant.

**To detect a true 10 percentage point effect (e.g., 50% -> 60%) at 80% power and
alpha=0.05, you need approximately N=200 questions per condition.** At 20 questions,
you can only reliably detect effect sizes of ~25 percentage points or larger.

The honest answer: with N=20, we cannot distinguish any of these results from random
fluctuation. Every "pattern" in the per-question breakdown is likely pareidolia.

### Diagnosis 4: Honest conclusion

**The fixed-budget experiment does not demonstrate mutual cognition benefits, and
there are structural reasons why it likely cannot with same-model Qwen3-4B.**

The reasons are:

1. **No real cognitive asymmetry.** Both agents share identical weights. "Math expert"
   and "science expert" are prompt decorations, not genuine capability differences.
   The model knows the same things regardless of its system prompt. Mutual cognition
   requires that knowing your partner's capabilities lets you communicate differently
   in a way that matters -- but when the partner's capabilities are identical to yours,
   there is nothing to adapt to.

2. **4B model cannot do theory-of-mind.** Even if there were a real asymmetry, a 4B
   parameter model does not reliably adjust its communication strategy based on a
   description of the receiver. The instruction "focus on what a scientist needs" gets
   interpreted as a surface-level style change (use scientific words), not as a genuine
   strategic adaptation of information content.

3. **The task is too easy or too hard.** Many MMLU questions are either answerable from
   the choices alone (Rx does not need Tx) or require specific knowledge that no amount
   of "tailoring" can convey in 48-96 tokens. The sweet spot -- questions where tailored
   communication would change the outcome -- may be very narrow, and 20 random questions
   are unlikely to contain enough of them.

4. **Greedy decoding makes conditions near-identical.** With do_sample=False, the model
   is deterministic. Small prompt changes cause small output changes. The conditions
   differ by only a few words in the system prompt, so they often produce nearly
   identical Tx outputs, making the Rx outcomes the same.

### Diagnosis 5: Is mutual cognition demonstrable with same-model Qwen3-4B?

**Almost certainly not in a scientifically convincing way.** The core problem is that
mutual cognition is a theory about agents with genuinely different capabilities.
Running both sides on the same 4B model with different system prompts creates a
cosmetic difference, not a functional one. This is like testing whether "knowing your
translator speaks French" helps communication, when both people actually speak the
same language. The "awareness" has nothing real to act on.

Even with N=200 and a statistically significant result, the interpretation would be
ambiguous: is it mutual cognition, or is it just that one specific prompt wording
happens to elicit slightly better outputs from this particular model? You cannot
separate the two with a same-model design.

### Recommended next steps (practical)

**Option A: Pivot to heterogeneous models (RECOMMENDED)**

Use two genuinely different models -- e.g., a math-specialized model (like DeepSeekMath
or a math-finetuned LLM) as Tx and a general or science-finetuned model as Rx. This
creates real capability asymmetry that mutual cognition can exploit. The hypothesis
becomes testable: does telling the math model "your partner is a science model with
no math training" cause it to explain mathematical steps more explicitly, improving
Rx accuracy?

This is the only path that makes the paper's core claim defensible.

**Option B: Pivot the claim (if heterogeneous models are not feasible)**

Reframe the paper away from "mutual cognition improves communication efficiency" and
toward something demonstrable with same-model agents, such as:
- Task scheduling (Key Idea 4 already shows domain-order effects with same model)
- Chain-of-thought delegation effects
- Information loss across agent chains

These are real, measurable phenomena that do not require genuine cognitive asymmetry.

**Option C: Increase N dramatically (NOT recommended)**

Running N=200 with 4 conditions x 2 budgets = 1600 model calls would take significant
compute time and would likely confirm the null result with higher confidence. This is
the responsible thing to do if you want to definitively close the question, but the
structural arguments above suggest the effect is not there to find.

**Do not pursue:** further prompt engineering (adding more "awareness" details, changing
wording) or adding more token budgets. The problem is not in the prompts; it is in the
experimental design. No prompt change will create genuine cognitive asymmetry between
two copies of the same 4B model.


KI1 테스트를 하는데 직관적으로 설정했던 초기 실험 (LLMU+math&science expert)이 몇가지 한계가 관찰되어서, 예전에 범듦이 세미나때 나왔던 얘기처럼 협업 필수인 task로 변경하니 의도한 성능이 좀 나오기 시작했고, 실험팀 친구들과 공유하고, 문제 설정을 좀 더 다듬어서 최종 성능을 다시 뽑는중

*한계
1. prompt만으로는 LLM의 전문 지식을 강요해도, 백본이 동일한 사전 지식을 공유하고 있어 한계가 있어보이고, 이종간 협업 성능을 유도하는 방향으로 설정하면 좋음
2. prompt로 출력 토큰의 양을 유동적으로 조절하는건 너무 의도적인 결과.
위 두개는 하려면 가능하긴 한데, prompt로 너무 결과를 강요해서 그냥 원하는 결과나 나올뿐이고, 우리가 원하는 상호 인지는 테스트가 힘듦

*변경 1
1. 기존 LLMU(수학/과학 산술 문제)에서 협업해야 풀수있는 문제와 역할(RACE,문장 독해 및 요약 전달 + 요약으로 문제풀기)문제로 변경
2. 요약 하는 prompt limit을 제한했을때,(48 vs 128) 결과 비교

위 두 방향을 좀 조정 하니 평균적으로 의도된 결과가 나오기 시작해서, 좀더 정제해서 성능 뽑는중

Budget   Metric       blind      a_aware    b_aware    mutual
------------------------------------------------------------
48tok  Accuracy       50%       90%       60%       90%
128tok  Accuracy       80%       95%       95%       90%
