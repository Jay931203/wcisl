"""
Multi-Agent Communication Framework
사용법:
    from agents import load_model, Agent, send, chain

    load_model("Qwen/Qwen3-4B")  # 최초 1회

    a = Agent("Analyst", "You are a data analyst.")
    b = Agent("Calculator", "Compute the value. Output only a number.")

    # 단일 에이전트
    result = a.say("What is 2+3?")

    # A -> B 통신
    result = send(a, b, "Data: revenue=10M, cost=6M")

    # A -> B -> C 체인
    result = chain([a, b, c], "Data: revenue=10M")
"""

import torch
import time
import re

# Global model/tokenizer (load_model로 초기화)
_model = None
_tokenizer = None
_device = None


def load_model(model_id: str = "Qwen/Qwen3-4B"):
    """모델 로드. 최초 1회만 실행."""
    global _model, _tokenizer, _device

    from transformers import AutoModelForCausalLM, AutoTokenizer

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if _device == "cuda" else torch.float32

    print(f"Device: {_device}")
    if _device == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")

    print(f"Loading {model_id}...")
    t0 = time.time()
    _tokenizer = AutoTokenizer.from_pretrained(model_id)
    _model = AutoModelForCausalLM.from_pretrained(
        model_id, torch_dtype=dtype,
        device_map="auto" if _device == "cuda" else None,
    )
    if _device == "cpu":
        _model = _model.to(_device)

    params = sum(p.numel() for p in _model.parameters()) / 1e9
    print(f"Loaded in {time.time()-t0:.1f}s ({params:.1f}B params)")


class Agent:
    """LLM 에이전트. system_prompt로 역할/전문성 부여."""

    def __init__(self, name: str, system_prompt: str):
        self.name = name
        self.system_prompt = system_prompt
        self.history = []

    def say(self, message: str, max_tokens: int = 256) -> dict:
        """메시지에 응답. {response, tokens, time} 반환."""
        if _model is None:
            raise RuntimeError("load_model()을 먼저 실행하세요.")

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": message},
        ]
        text = _tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = _tokenizer(text, return_tensors="pt").to(_model.device)

        t0 = time.time()
        with torch.no_grad():
            output = _model.generate(
                **inputs, max_new_tokens=max_tokens, do_sample=False
            )
        elapsed = time.time() - t0

        response = _tokenizer.decode(
            output[0][inputs["input_ids"].shape[1]:],
            skip_special_tokens=True
        ).strip()
        gen_tokens = output.shape[1] - inputs["input_ids"].shape[1]

        result = {"response": response, "tokens": gen_tokens, "time": round(elapsed, 1)}
        self.history.append({"input": message, **result})
        return result

    def set_prompt(self, new_prompt: str):
        """system prompt 변경."""
        self.system_prompt = new_prompt
        return self

    def __repr__(self):
        return f"Agent('{self.name}')"


def send(sender: Agent, receiver: Agent, message: str,
         max_tokens: int = 256, verbose: bool = True) -> dict:
    """sender가 message 처리 -> 출력을 receiver에게 전달."""
    s = sender.say(message, max_tokens=max_tokens)
    r = receiver.say(s["response"], max_tokens=max_tokens)

    if verbose:
        print(f"[{sender.name}] {s['tokens']}tok, {s['time']}s")
        print(f"  >> {s['response'][:200]}")
        print(f"[{receiver.name}] {r['tokens']}tok, {r['time']}s")
        print(f"  >> {r['response'][:200]}")

    return {
        "sender": s,
        "receiver": r,
        "tx_tokens": s["tokens"],
        "total_tokens": s["tokens"] + r["tokens"],
    }


def chain(agents: list, message: str,
          max_tokens: int = 256, verbose: bool = True) -> dict:
    """여러 에이전트를 순차 체인. A -> B -> C -> ..."""
    current = message
    results = []

    for agent in agents:
        r = agent.say(current, max_tokens=max_tokens)
        results.append({"agent": agent.name, **r})
        if verbose:
            print(f"[{agent.name}] {r['tokens']}tok, {r['time']}s")
            print(f"  >> {r['response'][:200]}")
        current = r["response"]

    return {
        "steps": results,
        "final": results[-1]["response"],
        "total_tokens": sum(r["tokens"] for r in results),
    }


def extract_number(text: str) -> float:
    """텍스트에서 첫 번째 숫자 추출."""
    nums = re.findall(r'-?[\d,]+\.?\d*', text.replace(',', ''))
    return float(nums[0]) if nums else -999


def grade(got: float, expected: float, tolerance: float = 0.1) -> bool:
    """정답 채점. tolerance 비율 허용."""
    if expected == 0:
        return abs(got) < tolerance
    return abs(got - expected) / abs(expected) < tolerance
