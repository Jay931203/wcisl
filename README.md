# WCISL - A2A Semantic Communication Experiments

A2A (Agent-to-Agent) semantic communication for physical AI collaboration 연구의 preliminary experiments.

## Project Structure

```
wcisl/
  notebooks/
    agents.py              # Agent 클래스, send(), chain() 등 핵심 모듈
    qwen_agent_env.ipynb   # Qwen3-4B 멀티에이전트 실험 환경
  legacy/
    scripts/               # OpenAI API 기반 실험 코드 (.mjs) + 결과 (.json)
    notebooks/             # API 기반 Python 노트북 (ki1/ki3/ki4)
  main.tex                 # 실험 결과 보고서 (Overleaf용)
  .env.example             # API 키 템플릿
```

## Quick Start (Qwen3-4B)

```bash
# 1. 환경 설치
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install transformers accelerate

# 2. Jupyter 실행
cd notebooks
jupyter notebook qwen_agent_env.ipynb
```

### Colab
`notebooks/qwen_agent_env.ipynb`를 Colab에 업로드 후 GPU 런타임 설정.

### 핵심 API (agents.py)
```python
from agents import load_model, Agent, send, chain

load_model("Qwen/Qwen3-4B")

a = Agent("Analyst", "You are a data analyst.")
b = Agent("Calculator", "Compute the value. Output only a number.")

a.say("What is 2+3?")               # 단일 에이전트
send(a, b, "Data: revenue=10M...")   # A -> B 통신
chain([a, b, c], "Data: ...")        # A -> B -> C 체인
a.set_prompt("New prompt")           # 프롬프트 변경
```

## Legacy: OpenAI API Experiments

```bash
# 1. API 키 설정
cp .env.example .env
# .env에 키 입력

# 2. 실행
export OPENAI_API_KEY=sk-proj-...
node legacy/scripts/ki1_natural.mjs
```

### 실험 목록

| 실험 | 파일 | 핵심 결과 |
|------|------|----------|
| KI-1A | ki1_natural.mjs | 토큰 98% 절감 (936->20), 정확도 80->93% |
| KI-1B | ki1_bandwidth.mjs | 40토큰 제약: 13%->60%, Progressive 13->67% |
| KI-3A | ki3_final.mjs | All Aware 40% < Tx Switch 80% |
| KI-3B | ki3_gpt4o.mjs | Both Switch > Tx-Only (GPT-4o) |
| KI-4A | ki4_filter.mjs | Fixed 4.93 < Joint+ES 7.00 |

### Key Ideas

- **KI-1**: Mutual cognitive context inference - 상호 인지가 통신 효율을 높인다
- **KI-3**: Stage-wise model switching in CoT - 추론 단계와 전송 단계를 분리하면 최적
- **KI-4**: Adaptive task scheduling - 전문성 + 채널 품질 joint optimization

## 보고서

`main.tex`를 Overleaf에 업로드하면 컴파일 가능 (XeLaTeX, kotex 필요).
