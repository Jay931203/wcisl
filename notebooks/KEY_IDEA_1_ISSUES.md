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
