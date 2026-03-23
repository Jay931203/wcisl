#!/usr/bin/env python3

import argparse
import csv
import json
import os
import random
import re
import statistics
import time
from collections import defaultdict
from dataclasses import dataclass, asdict
from typing import Any, Callable, Dict, List, Optional, Tuple

import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


# =========================
# General utilities
# =========================

def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def payload_bits_utf8(text: str) -> int:
    return len(text.encode("utf-8")) * 8


ANSWER_PATTERNS = [
    r"ANSWER\s*[:\-]?\s*(YES|NO)",
    r"FINAL\s+ANSWER\s*[:\-]?\s*(YES|NO)",
    r"INITIAL\s+HYPOTHESIS\s*[:\-]?\s*(YES|NO)",
    r"REVISED\s+HYPOTHESIS\s*[:\-]?\s*(YES|NO)",
    r"UPDATED\s+HYPOTHESIS\s*[:\-]?\s*(YES|NO)",
    r"CURRENT\s+BEST\s+CANDIDATE\s*[:\-]?\s*(YES|NO)",
]


def extract_answer(text: str) -> Optional[str]:
    if not text or not text.strip():
        return None

    for line in reversed(text.strip().splitlines()):
        lu = line.upper()
        m = re.search(r"ANSWER\s*[:\-]?\s*(YES|NO)\b", lu)
        if m:
            return m.group(1)
        m = re.search(
            r"(?:FINAL\s+ANSWER|INITIAL\s+HYPOTHESIS|REVISED\s+HYPOTHESIS|UPDATED\s+HYPOTHESIS|CURRENT\s+BEST\s+CANDIDATE)\s*[:\-]?\s*(YES|NO)\b",
            lu,
        )
        if m:
            return m.group(1)

    upper = text.upper()
    for pattern in ANSWER_PATTERNS:
        matches = re.findall(pattern, upper)
        if matches:
            return matches[-1]

    tail = upper[-400:] if len(upper) > 400 else upper
    fallback = re.findall(r"\b(YES|NO)\b", tail)
    if fallback:
        return fallback[-1]
    return None


def _flush_file_handle(f) -> None:
    f.flush()
    try:
        os.fsync(f.fileno())
    except OSError:
        pass


# =========================
# Link-quality model
# =========================

LINK_STATES = ["EXCELLENT", "GOOD", "FAIR", "POOR"]

LINK_STATE_WEIGHTS = {
    "EXCELLENT": 5,
    "GOOD": 20,
    "FAIR": 40,
    "POOR": 35,
}
_LINK_LABEL_WEIGHT_LIST = [LINK_STATE_WEIGHTS[s] for s in LINK_STATES]

_LINK_WEIGHTS_NEAR = (93, 4, 2, 1)
_LINK_WEIGHTS_FAR = (1, 2, 4, 93)

INTERMEDIATE_ROLES = ["SYN", "ALT", "VER"]
ALL_ROLES = ["ENC", "SYN", "ALT", "VER", "FIN"]


def undirected_pair_key(a: str, b: str) -> str:
    r0, r1 = sorted((a, b), key=lambda x: ALL_ROLES.index(x))
    return f"{r0}-{r1}"


_UNDIRECTED_ROLE_PAIRS: List[Tuple[str, str]] = [
    (ALL_ROLES[i], ALL_ROLES[j]) for i in range(5) for j in range(i + 1, 5)
]


ORCHESTRATOR_PREV_MESSAGE_MAX_CHARS = 3000

ORCHESTRATOR_ROUTING_PREAMBLE_ROLE_ONLY = """You are a routing decision agent.

Your goal:
Select the next agent based only on reasoning usefulness — use each agent's role description and the prior message below.

Final instruction:
After your reasoning (if any), the last line of your reply MUST be exactly:

Next: <SYN or ALT or VER>

Even if uncertain, you MUST choose one.
Do not omit the final line.
"""

ORCHESTRATOR_ROUTING_PREAMBLE_COMM = """You are a routing decision agent.

Your goal:
Use pairwise distances, channel label probabilities implied by distance (farther -> worse labels on average), and the estimated hop times below to pick the next hop that minimizes communication delay for this step.
Prefer lower comm_sec and lower projected after_next_sec when comparing candidates.

Final instruction:
After your reasoning (if any), the last line of your reply MUST be exactly:

Next: <SYN or ALT or VER>

Even if uncertain, you MUST choose one.
Do not omit the final line.
"""

ORCHESTRATOR_ROUTING_PREAMBLE_ROLE_COMM = """You are a routing decision agent.

Your goal:
Select the next agent using both:
(a) each agent's reasoning role and the current reasoning state
(b) communication: distance, channel label probabilities, comm_sec, and projected time after that agent.

Final instruction:
After your reasoning (if any), the last line of your reply MUST be exactly:

Next: <SYN or ALT or VER>

Even if uncertain, you MUST choose one.
Do not omit the final line.
"""


def _truncate_for_orchestrator(text: str, max_chars: int = ORCHESTRATOR_PREV_MESSAGE_MAX_CHARS) -> str:
    if not text or not text.strip():
        return "(no text yet)"
    t = text.strip()
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 30].rstrip() + "\n... [truncated for orchestrator prompt]"


@dataclass
class LinkStateParams:
    throughput_bps: float
    extra_delay_mean_sec: float
    extra_delay_std_sec: float


@dataclass
class LinkQualityConfig:
    excellent_throughput_bps: float = 200_000.0
    excellent_extra_delay_mean_ms: float = 5.0

    good_throughput_bps: float = 40_000.0
    good_extra_delay_mean_ms: float = 20.0

    fair_throughput_bps: float = 10_000.0
    fair_extra_delay_mean_ms: float = 200.0

    poor_throughput_bps: float = 1_000.0
    poor_extra_delay_mean_ms: float = 500.0

    extra_delay_std_ms: float = 25.0


@dataclass
class LinkStateSample:
    state: str
    hidden_quality_score: float


@dataclass
class HopDelayBreakdown:
    state: str
    throughput_bps: float
    extra_delay_mean_sec: float
    extra_delay_std_sec: float
    random_extra_delay_sec: float
    serialization_delay_sec: float
    total_delay_sec: float
    hidden_quality_score: float


def build_link_state_table(cfg: LinkQualityConfig) -> Dict[str, LinkStateParams]:
    std_sec = cfg.extra_delay_std_ms / 1000.0
    return {
        "EXCELLENT": LinkStateParams(
            throughput_bps=cfg.excellent_throughput_bps,
            extra_delay_mean_sec=cfg.excellent_extra_delay_mean_ms / 1000.0,
            extra_delay_std_sec=std_sec,
        ),
        "GOOD": LinkStateParams(
            throughput_bps=cfg.good_throughput_bps,
            extra_delay_mean_sec=cfg.good_extra_delay_mean_ms / 1000.0,
            extra_delay_std_sec=std_sec,
        ),
        "FAIR": LinkStateParams(
            throughput_bps=cfg.fair_throughput_bps,
            extra_delay_mean_sec=cfg.fair_extra_delay_mean_ms / 1000.0,
            extra_delay_std_sec=std_sec,
        ),
        "POOR": LinkStateParams(
            throughput_bps=cfg.poor_throughput_bps,
            extra_delay_mean_sec=cfg.poor_extra_delay_mean_ms / 1000.0,
            extra_delay_std_sec=std_sec,
        ),
    }


def _representative_hidden_score_for_state(state: str) -> float:
    return {"EXCELLENT": 2.5, "GOOD": 1.7, "FAIR": 0.8, "POOR": 0.3}[state]


def _stable_edge_seed(example_seed: int, src: str, dst: str, salt: int) -> int:
    i, j = ALL_ROLES.index(src), ALL_ROLES.index(dst)
    return example_seed * 1_000_003 + i * 31 + j * 17 + salt


def _int_weights_blend_to_100(t: float) -> List[int]:
    t = max(0.0, min(1.0, t))
    raw = [
        _LINK_WEIGHTS_NEAR[k] * (1.0 - t) + _LINK_WEIGHTS_FAR[k] * t for k in range(4)
    ]
    flo = [int(x) for x in raw]
    err = 100 - sum(flo)
    frac_order = sorted(range(4), key=lambda k: raw[k] - flo[k], reverse=True)
    i = 0
    while err > 0:
        flo[frac_order[i % 4]] += 1
        err -= 1
        i += 1
    return flo


_PAIRWISE_DIST_MIN = 0.01
_PAIRWISE_DIST_MAX = 10_000.0


def sample_pairwise_distances(example_seed: int) -> Dict[Tuple[str, str], float]:
    rng = random.Random(example_seed * 1_009_901 + 246_913)
    lo, hi = _PAIRWISE_DIST_MIN, _PAIRWISE_DIST_MAX
    ratio = hi / lo
    n = len(_UNDIRECTED_ROLE_PAIRS)
    span = max(n - 1, 1)
    vals = [lo * (ratio ** (i / span)) for i in range(n)]
    rng.shuffle(vals)
    dist: Dict[Tuple[str, str], float] = {}
    for (a, b), v in zip(_UNDIRECTED_ROLE_PAIRS, vals):
        dist[(a, b)] = v
        dist[(b, a)] = v
    return dist


def precompute_edge_link_samples(
    example_seed: int,
) -> Tuple[Dict[Tuple[str, str], float], Dict[Tuple[str, str], LinkStateSample]]:
    dist_sym = sample_pairwise_distances(example_seed)
    d_vals = [dist_sym[(src, dst)] for src in ALL_ROLES for dst in ALL_ROLES if src != dst]
    d_min, d_max = min(d_vals), max(d_vals)
    span = d_max - d_min if d_max > d_min else 0.0

    out: Dict[Tuple[str, str], LinkStateSample] = {}
    for src in ALL_ROLES:
        for dst in ALL_ROLES:
            if src == dst:
                continue
            d = dist_sym[(src, dst)]
            if span > 0.0:
                t = (d - d_min) / span
            else:
                t = 0.5
            wlist = _int_weights_blend_to_100(t) if span > 0.0 else list(_LINK_LABEL_WEIGHT_LIST)
            rng = random.Random(_stable_edge_seed(example_seed, src, dst, salt=9401))
            state = rng.choices(LINK_STATES, weights=wlist, k=1)[0]
            score = _representative_hidden_score_for_state(state)
            out[(src, dst)] = LinkStateSample(state=state, hidden_quality_score=score)
    return dist_sym, out


def channel_label_pmf_for_edge(dist_sym: Dict[Tuple[str, str], float], src: str, dst: str) -> List[float]:
    d_vals = [dist_sym[(s, r)] for s in ALL_ROLES for r in ALL_ROLES if s != r]
    d_min, d_max = min(d_vals), max(d_vals)
    span = d_max - d_min if d_max > d_min else 0.0
    d = dist_sym[(src, dst)]
    if span > 0.0:
        t = (d - d_min) / span
        wlist = _int_weights_blend_to_100(t)
    else:
        wlist = list(_LINK_LABEL_WEIGHT_LIST)
    return [float(x) / 100.0 for x in wlist]


def format_channel_pmf_line(pmf: List[float]) -> str:
    return ", ".join(f"{LINK_STATES[i]}={pmf[i] * 100:.1f}%" for i in range(len(LINK_STATES)))


def hop_comm_random(example_seed: int, src: str, dst: str) -> random.Random:
    return random.Random(_stable_edge_seed(example_seed, src, dst, salt=12011))


def compute_comm_delay_from_state(
    payload_bits: int,
    state: str,
    table: Dict[str, LinkStateParams],
    hidden_quality_score: float,
    rng: random.Random,
) -> HopDelayBreakdown:
    params = table[state]
    serialization = payload_bits / params.throughput_bps if params.throughput_bps > 0 else float("inf")
    raw = rng.gauss(params.extra_delay_mean_sec, params.extra_delay_std_sec) if params.extra_delay_std_sec > 0.0 else params.extra_delay_mean_sec
    random_extra = max(0.0, raw)
    total = random_extra + serialization
    return HopDelayBreakdown(
        state=state,
        throughput_bps=params.throughput_bps,
        extra_delay_mean_sec=params.extra_delay_mean_sec,
        extra_delay_std_sec=params.extra_delay_std_sec,
        random_extra_delay_sec=random_extra,
        serialization_delay_sec=serialization,
        total_delay_sec=total,
        hidden_quality_score=hidden_quality_score,
    )


# =========================
# StrategyQA task & roles
# =========================

ROLE_META = {
    "ENC": {
        "name": "Question Decomposer",
        "goal": (
            "You are the ONLY agent that sees the full question.\n\n"
            "Your job is NOT to solve it directly.\n"
            "Convert the question into a compact reasoning state.\n\n"
            "You MUST:\n"
            "1) Rewrite the question as a clear claim to evaluate\n"
            "2) Break it into 2-4 atomic subquestions\n"
            "3) List key entities or concepts\n"
            "4) Give an initial tentative hypothesis (YES or NO)\n\n"
            "Do NOT give a final answer."
        ),
        "format_tail": (
            "End with exactly this structure:\n"
            "Claim: <one sentence>\n"
            "Subquestions:\n"
            "- <subquestion 1>\n"
            "- <subquestion 2>\n"
            "- <subquestion 3 if needed>\n"
            "Key Concepts: <comma-separated>\n"
            "Initial Hypothesis: <YES/NO>"
        ),
    },
    "ALT": {
        "name": "Alternative Expander",
        "goal": (
            "You ONLY use the incoming message.\n\n"
            "Expand missing reasoning and overlooked possibilities.\n\n"
            "You MUST:\n"
            "1) Add 2-4 missing considerations, plausible facts, or commonsense links\n"
            "2) Explicitly consider why the opposite answer might still be plausible\n"
            "3) Update the hypothesis\n\n"
            "Do NOT finalize the answer."
        ),
        "format_tail": (
            "End with exactly this structure:\n"
            "Added Considerations:\n"
            "- <item 1>\n"
            "- <item 2>\n"
            "- <item 3 if needed>\n"
            "Why YES might be true: <short>\n"
            "Why NO might be true: <short>\n"
            "Revised Hypothesis: <YES/NO>"
        ),
    },
    "VER": {
        "name": "Reasoning Verifier",
        "goal": (
            "You ONLY use the incoming message.\n\n"
            "Test the current reasoning for contradictions, weak assumptions, and unsupported jumps.\n\n"
            "You MUST:\n"
            "1) Identify the weakest part of the reasoning\n"
            "2) Point out any hidden assumption or logical gap\n"
            "3) Say whether the reasoning supports YES, supports NO, or remains mixed\n"
            "4) Update the hypothesis after verification\n\n"
            "Do NOT introduce a completely new reasoning path.\n"
            "Do NOT finalize the answer."
        ),
        "format_tail": (
            "End with exactly this structure:\n"
            "Main Weakness: <one sentence>\n"
            "Hidden Assumption: <one sentence>\n"
            "Verification Result: <supports YES / supports NO / mixed>\n"
            "Updated Hypothesis: <YES/NO>"
        ),
    },
    "SYN": {
        "name": "Decision Synthesizer",
        "goal": (
            "You ONLY use the incoming message.\n\n"
            "Synthesize the reasoning into the clearest pre-final verdict.\n\n"
            "You MUST:\n"
            "1) Summarize the strongest reason for YES\n"
            "2) Summarize the strongest reason for NO\n"
            "3) Decide which side is better supported overall\n\n"
            "Do NOT open new reasoning branches."
        ),
        "format_tail": (
            "End with exactly this structure:\n"
            "Best Reason for YES: <one sentence>\n"
            "Best Reason for NO: <one sentence>\n"
            "Current Best Candidate: <YES/NO>"
        ),
    },
    "FIN": {
        "name": "Final Answer Agent",
        "goal": (
            "You ONLY use the incoming message.\n\n"
            "Output the final answer only.\n"
            "Do NOT add new reasoning.\n"
            "Be concise and decisive."
        ),
        "format_tail": "End with exactly one line:\nAnswer: <YES/NO>",
    },
}


def build_base_problem(example: Dict) -> str:
    return f"""Question:
{example['question']}

Task:
Decide whether the answer is YES or NO.

Allowed final labels:
YES
NO
"""


def normalize_strategyqa_row(row: Dict) -> Dict:
    raw_answer = row.get("answer", row.get("label", None))
    if isinstance(raw_answer, bool):
        answer = "YES" if raw_answer else "NO"
    else:
        s = str(raw_answer).strip().lower()
        if s in ("yes", "true", "1"):
            answer = "YES"
        elif s in ("no", "false", "0"):
            answer = "NO"
        else:
            raise ValueError(f"Cannot normalize StrategyQA answer: {raw_answer}")
    return {
        "task": "strategyqa",
        "question": str(row["question"]).strip(),
        "answer": answer,
    }


def normalize_task_arg(task: str) -> str:
    k = task.strip().lower().replace("-", "_")
    if k in ("strategyqa", "strategy_qa"):
        return "strategyqa"
    raise ValueError(f"Unknown --task {task!r}; use strategyqa")


def load_examples(dataset_name: str, strategyqa_dataset_id: str, strategyqa_dataset_config: Optional[str], split: str):
    if dataset_name == "strategyqa":
        if not strategyqa_dataset_id:
            raise ValueError("--strategyqa-dataset-id is required for StrategyQA")
        if strategyqa_dataset_config:
            return load_dataset(strategyqa_dataset_id, strategyqa_dataset_config, split=split)
        return load_dataset(strategyqa_dataset_id, split=split)
    raise ValueError(f"Unknown dataset: {dataset_name}")


def prepare_example(raw: Dict, dataset_name: str) -> Dict:
    if dataset_name == "strategyqa":
        return normalize_strategyqa_row(raw)
    raise ValueError(f"Unknown dataset_name: {dataset_name}")


def build_agent_prompt(
    role: str,
    example: Dict,
    prev_output: Optional[str],
    prev_role: Optional[str],
) -> str:
    _ = prev_role
    if role not in ROLE_META:
        raise ValueError(f"Unknown role: {role}")
    m = ROLE_META[role]
    body = build_base_problem(example) if role == "ENC" else (prev_output or "")
    return (
        f"Agent {role} ({m['name']}).\n\n"
        "Strict rules:\n"
        "- Follow ONLY your assigned operation.\n"
        "- Do NOT behave like another agent.\n"
        "- Keep the required output structure exactly.\n"
        "- Be concise.\n\n"
        f"Your role:\n{m['goal']}\n\n"
        f"Input:\n{body}\n\n"
        f"{m['format_tail']}"
    )


# =========================
# Shared model wrapper
# =========================

def maybe_enable_attention_backend(attn_implementation: str) -> Optional[str]:
    if not torch.cuda.is_available():
        return None

    if hasattr(torch.backends.cuda, "enable_flash_sdp"):
        torch.backends.cuda.enable_flash_sdp(attn_implementation in {"auto", "sdpa", "flash_attention_2"})
    if hasattr(torch.backends.cuda, "enable_mem_efficient_sdp"):
        torch.backends.cuda.enable_mem_efficient_sdp(attn_implementation in {"auto", "sdpa", "flash_attention_2"})
    if hasattr(torch.backends.cuda, "enable_math_sdp"):
        torch.backends.cuda.enable_math_sdp(attn_implementation in {"auto", "eager"})

    if attn_implementation == "auto":
        return None
    return attn_implementation


class SharedLLM:
    def __init__(
        self,
        model_name: str,
        dtype: str = "float16",
        load_in_4bit: bool = False,
        quant_compute_dtype: str = "float16",
        device_map: str = "auto",
        torch_compile: bool = False,
        attn_implementation: str = "auto",
    ) -> None:
        torch_dtype = torch.bfloat16 if dtype == "bfloat16" else torch.float16
        bnb_compute_dtype = torch.bfloat16 if quant_compute_dtype == "bfloat16" else torch.float16

        quant_config = None
        if load_in_4bit:
            quant_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=bnb_compute_dtype,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
            )

        self.tokenizer = AutoTokenizer.from_pretrained(model_name, use_fast=True)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        model_kwargs = {
            "torch_dtype": torch_dtype,
            "device_map": device_map,
            "quantization_config": quant_config,
        }
        resolved_attn_impl = maybe_enable_attention_backend(attn_implementation)
        if resolved_attn_impl is not None:
            model_kwargs["attn_implementation"] = resolved_attn_impl

        self.model = AutoModelForCausalLM.from_pretrained(model_name, **model_kwargs)
        self.model.config.use_cache = True
        self.model.eval()

        if torch_compile and hasattr(torch, "compile"):
            try:
                self.model = torch.compile(self.model)  # type: ignore[assignment]
            except Exception as exc:
                print(f"[warn] torch.compile failed; continuing without compile: {exc}", flush=True)

    def _format_prompt(self, prompt: str, enable_thinking: Optional[bool] = None) -> str:
        if getattr(self.tokenizer, "chat_template", None):
            messages = [
                {"role": "system", "content": "You are a careful reasoning assistant."},
                {"role": "user", "content": prompt},
            ]
            base_kw: Dict[str, Any] = {"tokenize": False, "add_generation_prompt": True}
            if enable_thinking is None:
                return self.tokenizer.apply_chat_template(messages, **base_kw)
            try:
                return self.tokenizer.apply_chat_template(
                    messages, **base_kw, enable_thinking=enable_thinking
                )
            except TypeError:
                return self.tokenizer.apply_chat_template(messages, **base_kw)
        return prompt

    def generate(
        self,
        prompt: str,
        max_new_tokens: int,
        enable_thinking: Optional[bool] = None,
    ) -> Tuple[str, int, float]:
        formatted = self._format_prompt(prompt, enable_thinking=enable_thinking)
        inputs = self.tokenizer(formatted, return_tensors="pt", truncation=True, padding=False)
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}

        prompt_len = int(inputs["input_ids"].shape[1])
        if max_new_tokens <= 0:
            mxl = getattr(self.tokenizer, "model_max_length", 32768) or 32768
            if mxl > 1_000_000:
                mxl = 32768
            max_new_tokens = max(1, mxl - prompt_len - 8)

        start = time.perf_counter()
        with torch.inference_mode():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
                use_cache=True,
                pad_token_id=self.tokenizer.pad_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
            )
        end = time.perf_counter()

        gen_ids = outputs[0][prompt_len:]
        text = self.tokenizer.decode(gen_ids, skip_special_tokens=True)
        return text, int(gen_ids.shape[0]), float(end - start)


# =========================
# Delay estimation and orchestration
# =========================

@dataclass
class RouteDecision:
    chosen_next: str


class DelayEstimator:
    def __init__(
        self,
        roles: List[str],
        initial_compute_sec: float,
        max_new_tokens: int,
        default_message_bytes: int,
        link_state_table: Dict[str, LinkStateParams],
    ) -> None:
        self.compute_history: Dict[str, List[float]] = {r: [] for r in roles}
        self.token_history: Dict[str, List[int]] = {r: [] for r in roles}
        self.bit_history: Dict[str, List[int]] = {r: [] for r in roles}
        self.initial_compute_sec = initial_compute_sec
        self.max_new_tokens = max_new_tokens
        self.default_message_bytes = default_message_bytes
        self.link_state_table = link_state_table

    def observe(self, role: str, compute_sec: float, gen_tokens: int, message_bits: int) -> None:
        self.compute_history[role].append(compute_sec)
        self.token_history[role].append(gen_tokens)
        self.bit_history[role].append(message_bits)

    def estimate_compute(self, role: str) -> float:
        hist = self.compute_history[role]
        if hist:
            return statistics.mean(hist)
        return self.initial_compute_sec

    def estimate_output_bits(self, role: str) -> float:
        hist = self.bit_history[role]
        if hist:
            return statistics.mean(hist)
        return float(self.default_message_bytes * 8)

    def estimate_comm_from_state(self, bits: float, state: str) -> float:
        params = self.link_state_table[state]
        serialization = bits / params.throughput_bps if params.throughput_bps > 0 else float("inf")
        return params.extra_delay_mean_sec + serialization


def role_only_priority(visited: List[str], remaining: List[str]) -> List[str]:
    preferred = ["ALT", "VER", "SYN"]
    ordered = [r for r in preferred if r in remaining]
    if "FIN" in remaining and len(ordered) == 0:
        ordered.append("FIN")
    return ordered


def pick_min_immediate_comm_candidate(
    candidates: List[str],
    immediate_comm_sec: Dict[str, float],
    candidate_states: Dict[str, str],
) -> str:
    quality_rank = {"EXCELLENT": 0, "GOOD": 1, "FAIR": 2, "POOR": 3}
    role_tie = {"ALT": 0, "VER": 1, "SYN": 2}
    return min(
        candidates,
        key=lambda c: (
            immediate_comm_sec.get(c, float("inf")),
            quality_rank.get(candidate_states.get(c, "POOR"), 99),
            role_tie.get(c, 9),
        ),
    )


def parse_orchestrator_next(text: str, candidates: List[str]) -> Optional[str]:
    if not text or not candidates:
        return None
    block = text.strip()
    if "</think>" in block:
        block = block.rsplit("</think>", 1)[-1].strip()

    cand_pat = "|".join(re.escape(c) for c in sorted(candidates, key=len, reverse=True))
    last_explicit: Optional[str] = None
    for line in block.splitlines():
        m = re.search(
            rf"\b(?:NEXT|CHOICE|ROUTE|SELECT)\s*[:=]\s*({cand_pat})\b",
            line,
            re.I,
        )
        if m:
            tok = m.group(1).upper()
            if tok in candidates:
                last_explicit = tok

    if last_explicit is not None:
        return last_explicit

    nonempty = [ln.strip() for ln in block.splitlines() if ln.strip()]
    if not nonempty:
        return None
    last_line = nonempty[-1]
    mentioned = [c for c in candidates if re.search(rf"\b{re.escape(c)}\b", last_line, re.I)]
    if len(mentioned) == 1:
        return mentioned[0]
    return None


def build_orchestrator_prompt_role_only(
    visited: List[str],
    remaining: List[str],
    current_role: str,
    previous_agent_output: str,
) -> str:
    prev = _truncate_for_orchestrator(previous_agent_output)
    lines = [
        ORCHESTRATOR_ROUTING_PREAMBLE_ROLE_ONLY.rstrip(),
        "",
        "---",
        "Task (multi-agent YES/NO reasoning pipeline):",
        "Situation:",
        "  Visited (order): " + " -> ".join(visited) + f". Current node: {current_role}.",
        "  Choose exactly ONE next agent from: " + ", ".join(remaining) + ".",
        "",
        f"Message produced by agent {current_role}:",
        "---",
        prev,
        "---",
        "",
        "Remaining agents — what each can do:",
    ]
    for r in INTERMEDIATE_ROLES:
        if r in remaining:
            meta = ROLE_META[r]
            lines.append(f"- Agent {r} ({meta['name']}): {meta['goal']}")

    lines.extend(
        [
            "",
            "Decision guidance:",
            "- Select the next agent based on overall usefulness for the current reasoning state.",
            "- Compare all candidates before deciding.",
        ]
    )
    lines.extend(
        [
            "",
            "There is no mandatory fixed pipeline order.",
            "Your response must end with one line exactly of the form Next: SYN or Next: ALT or Next: VER.",
        ]
    )
    return "\n".join(lines)


def build_orchestrator_prompt_comm_only(
    visited: List[str],
    remaining: List[str],
    current_role: str,
    previous_agent_output: str,
    candidate_states: Dict[str, str],
    channel_pmfs: Dict[str, List[float]],
    immediate_comm_sec: Dict[str, float],
    projected_after_next_agent_sec: Dict[str, float],
    myopic_projection: bool,
    pairwise_distances: Dict[str, float],
) -> str:
    cands = [c for c in remaining if c in INTERMEDIATE_ROLES]
    lines = [
        ORCHESTRATOR_ROUTING_PREAMBLE_COMM.rstrip(),
        "",
        "---",
        "Task (multi-agent YES/NO reasoning pipeline):",
        "Situation:",
        "  Visited (order): " + " -> ".join(visited) + f". Current node: {current_role}.",
        "  Choose exactly ONE next agent from: " + ", ".join(remaining) + ".",
        "",
        "All pairwise distances this episode:",
    ]
    for k in sorted(pairwise_distances.keys()):
        lines.append(f"  {k}: {pairwise_distances[k]:.4f}")

    lines.extend(
        [
            "",
            f"From {current_role} to each candidate — distance, P(label|distance), sampled link, comm_sec, projected time after that agent:",
        ]
    )
    if not myopic_projection:
        lines.append("(after_next_sec includes a rough forecast of later hops.)")

    for cand in sorted(cands):
        pk = undirected_pair_key(current_role, cand)
        du = pairwise_distances.get(pk, float("nan"))
        pmf_s = format_channel_pmf_line(channel_pmfs[cand])
        st = candidate_states.get(cand, "?")
        ic = immediate_comm_sec.get(cand, float("nan"))
        pa = projected_after_next_agent_sec.get(cand, float("nan"))
        lines.append(
            f"  -> {cand}: dist_{pk}={du:.3f}; P(label|dist) [{pmf_s}]; sampled_link={st}; comm_sec={ic:.4f}; after_next_sec={pa:.4f}"
        )

    lines.extend(
        [
            "",
            "Decision guidance:",
            "- Prefer lower comm_sec and lower after_next_sec.",
            "- Compare all candidates before deciding.",
            "",
            "Your response must end with one line exactly of the form Next: SYN or Next: ALT or Next: VER.",
        ]
    )
    return "\n".join(lines)


def build_orchestrator_prompt_role_comm(
    visited: List[str],
    remaining: List[str],
    current_role: str,
    previous_agent_output: str,
    candidate_states: Dict[str, str],
    channel_pmfs: Dict[str, List[float]],
    immediate_comm_sec: Dict[str, float],
    projected_after_next_agent_sec: Dict[str, float],
    myopic_projection: bool,
    pairwise_distances: Dict[str, float],
) -> str:
    cands = [c for c in remaining if c in INTERMEDIATE_ROLES]
    prev = _truncate_for_orchestrator(previous_agent_output)
    lines = [
        ORCHESTRATOR_ROUTING_PREAMBLE_ROLE_COMM.rstrip(),
        "",
        "---",
        "Task (multi-agent YES/NO reasoning pipeline):",
        "Situation:",
        "  Visited (order): " + " -> ".join(visited) + f". Current node: {current_role}.",
        "  Choose exactly ONE next agent from: " + ", ".join(remaining) + ".",
        "",
        f"Message produced by agent {current_role}:",
        "---",
        prev,
        "---",
        "",
        "Agent roles (capabilities):",
    ]
    for r in INTERMEDIATE_ROLES:
        if r in remaining:
            meta = ROLE_META[r]
            lines.append(f"- Agent {r} ({meta['name']}): {meta['goal']}")

    lines.extend(["", "All pairwise distances this episode:"])
    for k in sorted(pairwise_distances.keys()):
        lines.append(f"  {k}: {pairwise_distances[k]:.4f}")

    lines.append("")
    lines.append(f"From {current_role} to each candidate — distance, P(label|distance), sampled link, comm_sec, projected time after that agent:")
    if not myopic_projection:
        lines.append("(after_next_sec includes a rough forecast of later hops.)")

    for cand in sorted(cands):
        pk = undirected_pair_key(current_role, cand)
        du = pairwise_distances.get(pk, float("nan"))
        pmf_s = format_channel_pmf_line(channel_pmfs[cand])
        st = candidate_states.get(cand, "?")
        ic = immediate_comm_sec.get(cand, float("nan"))
        pa = projected_after_next_agent_sec.get(cand, float("nan"))
        lines.append(
            f"  -> {cand}: dist_{pk}={du:.3f}; P(label|dist) [{pmf_s}]; sampled_link={st}; comm_sec={ic:.4f}; after_next_sec={pa:.4f}"
        )

    lines.extend(
        [
            "",
            "Decision guidance:",
            "- Use both reasoning usefulness and communication numbers.",
            "- Reasoning contribution is slightly more important than communication unless timing differences are clearly large.",
            "- Compare all candidates before deciding.",
        ]
    )
    lines.extend(
        [
            "",
            "Your response must end with one line exactly of the form Next: SYN or Next: ALT or Next: VER.",
        ]
    )
    return "\n".join(lines)


class Orchestrator:
    def __init__(
        self,
        policy_name: str,
        estimator: DelayEstimator,
        state_table: Dict[str, LinkStateParams],
        myopic_projection: bool = True,
    ) -> None:
        self.policy_name = policy_name
        self.estimator = estimator
        self.state_table = state_table
        self.myopic_projection = myopic_projection

    def _estimate_future_delay(self, chosen: str, remaining: List[str]) -> float:
        future = [r for r in remaining if r != chosen]
        if len([r for r in future if r in INTERMEDIATE_ROLES]) == 0 and "FIN" not in future:
            future.append("FIN")

        est = 0.0
        prev_role = chosen
        ordered = role_only_priority([chosen], [r for r in future if r != "FIN"]) + (["FIN"] if "FIN" in future else [])
        for r in ordered:
            est += self.estimator.estimate_compute(r)
            bits = self.estimator.estimate_output_bits(prev_role)
            est += self.estimator.estimate_comm_from_state(bits, "GOOD")
            prev_role = r
        return est

    def decide(
        self,
        current_role: str,
        current_message_bits: int,
        visited: List[str],
        remaining: List[str],
        candidate_states: Dict[str, str],
        elapsed_without_orchestrator: float,
        model: Optional["SharedLLM"] = None,
        orch_max_new_tokens: int = 256,
        previous_agent_output: str = "",
        dist_sym: Optional[Dict[Tuple[str, str], float]] = None,
        pairwise_distances: Optional[Dict[str, float]] = None,
        orchestrator_enable_thinking: bool = False,
    ) -> Tuple["RouteDecision", float, Optional[str]]:
        if len([r for r in remaining if r in INTERMEDIATE_ROLES]) == 0:
            return RouteDecision(chosen_next="FIN"), 0.0, None

        projected_delay_if_chosen: Dict[str, float] = {}
        immediate_comm_sec: Dict[str, float] = {}
        candidates = [r for r in remaining if r in INTERMEDIATE_ROLES]

        if self.policy_name == "role_only":
            if model is None:
                raise ValueError("role_only policy requires a SharedLLM model")
            prompt = build_orchestrator_prompt_role_only(
                visited, remaining, current_role, previous_agent_output
            )
            raw_text, _tok, orch_sec = model.generate(
                prompt, orch_max_new_tokens, enable_thinking=orchestrator_enable_thinking
            )
            parsed = parse_orchestrator_next(raw_text, candidates)
            fallback = random.choice(candidates)
            return RouteDecision(chosen_next=parsed if parsed is not None else fallback), orch_sec, raw_text

        if self.policy_name not in ("link_quality_aware", "link_quality_llm"):
            raise ValueError(f"Unknown orchestrator policy: {self.policy_name}")

        if dist_sym is None or pairwise_distances is None:
            raise ValueError("link_quality_aware / link_quality_llm require dist_sym and pairwise_distances")

        channel_pmfs = {c: channel_label_pmf_for_edge(dist_sym, current_role, c) for c in candidates}

        for cand in candidates:
            immediate_comm = self.estimator.estimate_comm_from_state(float(current_message_bits), candidate_states[cand])
            compute_next = self.estimator.estimate_compute(cand)
            immediate_comm_sec[cand] = immediate_comm
            tail = 0.0 if self.myopic_projection else self._estimate_future_delay(cand, remaining)
            projected_delay_if_chosen[cand] = elapsed_without_orchestrator + immediate_comm + compute_next + tail

        chosen_link_baseline = pick_min_immediate_comm_candidate(
            candidates, immediate_comm_sec, candidate_states
        )

        if self.policy_name == "link_quality_aware":
            if model is None:
                raise ValueError("link_quality_aware policy requires a SharedLLM model")
            prompt = build_orchestrator_prompt_comm_only(
                visited=visited,
                remaining=remaining,
                current_role=current_role,
                previous_agent_output=previous_agent_output,
                candidate_states=candidate_states,
                channel_pmfs=channel_pmfs,
                immediate_comm_sec=immediate_comm_sec,
                projected_after_next_agent_sec=projected_delay_if_chosen,
                myopic_projection=self.myopic_projection,
                pairwise_distances=pairwise_distances,
            )
            raw_text, _tok, orch_sec = model.generate(
                prompt, orch_max_new_tokens, enable_thinking=orchestrator_enable_thinking
            )
            parsed = parse_orchestrator_next(raw_text, candidates)
            chosen = parsed if parsed is not None else random.choice(candidates)
            return RouteDecision(chosen_next=chosen), orch_sec, raw_text

        if model is None:
            raise ValueError("link_quality_llm policy requires a SharedLLM model")

        prompt = build_orchestrator_prompt_role_comm(
            visited=visited,
            remaining=remaining,
            current_role=current_role,
            previous_agent_output=previous_agent_output,
            candidate_states=candidate_states,
            channel_pmfs=channel_pmfs,
            immediate_comm_sec=immediate_comm_sec,
            projected_after_next_agent_sec=projected_delay_if_chosen,
            myopic_projection=self.myopic_projection,
            pairwise_distances=pairwise_distances,
        )
        raw_text, _tok, orch_sec = model.generate(
            prompt, orch_max_new_tokens, enable_thinking=orchestrator_enable_thinking
        )
        parsed = parse_orchestrator_next(raw_text, candidates)
        chosen = parsed if parsed is not None else random.choice(candidates)
        return RouteDecision(chosen_next=chosen), orch_sec, raw_text


# =========================
# Episode records
# =========================

@dataclass
class HopRecord:
    src: str
    dst: str
    link_state: str
    hidden_quality_score: float
    throughput_bps: float
    extra_delay_mean_sec: float
    extra_delay_std_sec: float
    random_extra_delay_sec: float
    message_bits: int
    serialization_delay_sec: float
    communication_delay_sec: float


@dataclass
class AgentRecord:
    role: str
    role_name: str
    prompt_preview: str
    generated_text: str
    generated_tokens: int
    generated_utf8_bits: int
    compute_delay_sec: float
    parsed_candidate: Optional[str]


@dataclass
class EpisodeResult:
    idx: int
    gt: str
    pred: Optional[str]
    correct: bool
    policy: str
    visited_path: List[str]
    agent_records: List[AgentRecord]
    hop_records: List[HopRecord]
    total_compute_delay_sec: float
    total_communication_delay_sec: float
    total_orchestrator_compute_sec: float
    total_delay_sec: float
    total_compute_delay_sec_exclude_A_E: float
    total_delay_sec_exclude_A_E_compute: float
    orchestrator_outputs: List[Optional[str]]
    orchestrator_chosen_next: List[str]
    mean_quality_edge_map: Dict[str, float]
    pairwise_distances: Dict[str, float]


# =========================
# Core experiment loop
# =========================

def append_hop(
    hop_records: List[HopRecord],
    src: str,
    dst: str,
    payload_bits: int,
    state_sample: LinkStateSample,
    state_table: Dict[str, LinkStateParams],
    rng: random.Random,
) -> float:
    breakdown = compute_comm_delay_from_state(
        payload_bits=payload_bits,
        state=state_sample.state,
        table=state_table,
        hidden_quality_score=state_sample.hidden_quality_score,
        rng=rng,
    )
    hop_records.append(
        HopRecord(
            src=src,
            dst=dst,
            link_state=breakdown.state,
            hidden_quality_score=breakdown.hidden_quality_score,
            throughput_bps=breakdown.throughput_bps,
            extra_delay_mean_sec=breakdown.extra_delay_mean_sec,
            extra_delay_std_sec=breakdown.extra_delay_std_sec,
            random_extra_delay_sec=breakdown.random_extra_delay_sec,
            message_bits=payload_bits,
            serialization_delay_sec=breakdown.serialization_delay_sec,
            communication_delay_sec=breakdown.total_delay_sec,
        )
    )
    return breakdown.total_delay_sec


def run_episode(
    model: SharedLLM,
    orchestrator_model: SharedLLM,
    example: Dict,
    idx: int,
    policy_name: str,
    max_new_tokens: int,
    estimator: DelayEstimator,
    example_seed: int,
    link_quality_cfg: LinkQualityConfig,
    state_table: Dict[str, LinkStateParams],
    orch_max_new_tokens: int = 256,
    orch_myopic_projection: bool = True,
    max_new_tokens_e: Optional[int] = None,
    agent_enable_thinking: bool = False,
    agent_e_enable_thinking: bool = False,
    orchestrator_enable_thinking: bool = False,
) -> EpisodeResult:
    _ = link_quality_cfg
    e_max_new = max_new_tokens_e if max_new_tokens_e is not None else max_new_tokens

    dist_sym, edge_link_samples = precompute_edge_link_samples(example_seed)
    pairwise_distances = {f"{a}-{b}": dist_sym[(a, b)] for a, b in _UNDIRECTED_ROLE_PAIRS}
    orch = Orchestrator(
        policy_name=policy_name,
        estimator=estimator,
        state_table=state_table,
        myopic_projection=orch_myopic_projection,
    )

    visited = ["ENC"]
    remaining_intermediates = ["SYN", "ALT", "VER"]
    current_role = "ENC"

    agent_records: List[AgentRecord] = []
    hop_records: List[HopRecord] = []
    orchestrator_outputs: List[Optional[str]] = []
    orchestrator_chosen_next: List[str] = []

    total_compute = 0.0
    total_comm = 0.0
    total_orch_compute = 0.0

    prompt = build_agent_prompt("ENC", example, None, None)
    text, gen_tokens, compute_sec = model.generate(
        prompt, max_new_tokens, enable_thinking=agent_enable_thinking
    )
    message_bits = payload_bits_utf8(text)
    total_compute += compute_sec
    estimator.observe("ENC", compute_sec, gen_tokens, message_bits)
    agent_records.append(
        AgentRecord(
            role="ENC",
            role_name=ROLE_META["ENC"]["name"],
            prompt_preview=prompt[:250],
            generated_text=text,
            generated_tokens=gen_tokens,
            generated_utf8_bits=message_bits,
            compute_delay_sec=compute_sec,
            parsed_candidate=extract_answer(text),
        )
    )
    current_output = text
    current_message_bits = message_bits

    while remaining_intermediates:
        candidate_samples = {cand: edge_link_samples[(current_role, cand)] for cand in remaining_intermediates}
        candidate_states = {cand: samp.state for cand, samp in candidate_samples.items()}
        elapsed = total_compute + total_comm + total_orch_compute

        if len(remaining_intermediates) == 1:
            next_role = remaining_intermediates[0]
            orch_step_sec = 0.0
            orch_llm_raw = None
        else:
            decision, orch_step_sec, orch_llm_raw = orch.decide(
                current_role=current_role,
                current_message_bits=current_message_bits,
                visited=visited,
                remaining=list(remaining_intermediates),
                candidate_states=candidate_states,
                elapsed_without_orchestrator=elapsed,
                model=orchestrator_model if policy_name in ("role_only", "link_quality_aware", "link_quality_llm") else None,
                orch_max_new_tokens=orch_max_new_tokens,
                previous_agent_output=current_output,
                dist_sym=dist_sym,
                pairwise_distances=pairwise_distances,
                orchestrator_enable_thinking=orchestrator_enable_thinking,
            )
            next_role = decision.chosen_next

        total_orch_compute += orch_step_sec
        orchestrator_outputs.append(orch_llm_raw)
        orchestrator_chosen_next.append(next_role)

        total_comm += append_hop(
            hop_records=hop_records,
            src=current_role,
            dst=next_role,
            payload_bits=current_message_bits,
            state_sample=candidate_samples[next_role],
            state_table=state_table,
            rng=hop_comm_random(example_seed, current_role, next_role),
        )

        prompt = build_agent_prompt(next_role, example, current_output, current_role)
        text, gen_tokens, compute_sec = model.generate(
            prompt, max_new_tokens, enable_thinking=agent_enable_thinking
        )
        message_bits = payload_bits_utf8(text)
        total_compute += compute_sec
        estimator.observe(next_role, compute_sec, gen_tokens, message_bits)
        agent_records.append(
            AgentRecord(
                role=next_role,
                role_name=ROLE_META[next_role]["name"],
                prompt_preview=prompt[:250],
                generated_text=text,
                generated_tokens=gen_tokens,
                generated_utf8_bits=message_bits,
                compute_delay_sec=compute_sec,
                parsed_candidate=extract_answer(text),
            )
        )
        current_output = text
        current_message_bits = message_bits
        current_role = next_role
        visited.append(next_role)
        remaining_intermediates.remove(next_role)

    total_comm += append_hop(
        hop_records=hop_records,
        src=current_role,
        dst="FIN",
        payload_bits=current_message_bits,
        state_sample=edge_link_samples[(current_role, "FIN")],
        state_table=state_table,
        rng=hop_comm_random(example_seed, current_role, "FIN"),
    )

    prompt = build_agent_prompt("FIN", example, current_output, current_role)
    text, gen_tokens, compute_sec = model.generate(
        prompt, e_max_new, enable_thinking=agent_e_enable_thinking
    )
    message_bits = payload_bits_utf8(text)
    total_compute += compute_sec
    estimator.observe("FIN", compute_sec, gen_tokens, message_bits)
    agent_records.append(
        AgentRecord(
            role="FIN",
            role_name=ROLE_META["FIN"]["name"],
            prompt_preview=prompt[:250],
            generated_text=text,
            generated_tokens=gen_tokens,
            generated_utf8_bits=message_bits,
            compute_delay_sec=compute_sec,
            parsed_candidate=extract_answer(text),
        )
    )
    visited.append("FIN")

    pred = extract_answer(text)
    gt = example["answer"]

    total_delay = total_compute + total_comm + total_orch_compute
    total_compute_ex_ae = sum(ar.compute_delay_sec for ar in agent_records if ar.role not in ("ENC", "FIN"))
    total_delay_ex_ae_compute = total_compute_ex_ae + total_comm + total_orch_compute

    return EpisodeResult(
        idx=idx,
        gt=gt,
        pred=pred,
        correct=(pred == gt),
        policy=policy_name,
        visited_path=visited,
        agent_records=agent_records,
        hop_records=hop_records,
        total_compute_delay_sec=total_compute,
        total_communication_delay_sec=total_comm,
        total_orchestrator_compute_sec=total_orch_compute,
        total_delay_sec=total_delay,
        total_compute_delay_sec_exclude_A_E=total_compute_ex_ae,
        total_delay_sec_exclude_A_E_compute=total_delay_ex_ae_compute,
        orchestrator_outputs=orchestrator_outputs,
        orchestrator_chosen_next=orchestrator_chosen_next,
        mean_quality_edge_map={
            f"{src}->{dst}": samp.hidden_quality_score
            for (src, dst), samp in edge_link_samples.items()
        },
        pairwise_distances=pairwise_distances,
    )


# =========================
# Reporting
# =========================

SCHEME_COLUMNS: List[Tuple[str, str]] = [
    ("role_only", "Role"),
    ("link_quality_aware", "Comm"),
    ("link_quality_llm", "Role+Comm"),
]

POLICY_ORDER = [k for k, _ in SCHEME_COLUMNS]
COMPARISON_SNAPSHOT_EVERY_SAMPLES = 30


def _write_comparison_csv(csv_path: str, policy_metrics: Dict[str, Any]) -> None:
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["metric", "Role", "Comm", "Role+Comm"])
        csv_metric_rows = [
            ("accuracy", lambda m: m["accuracy"]),
            ("avg_total_delay_sec", lambda m: m["avg_total_delay_sec"]),
            ("avg_compute_delay_sec", lambda m: m["avg_compute_delay_sec"]),
            ("avg_total_delay_sec_exclude_A_E_compute", lambda m: m["avg_total_delay_sec_exclude_A_E_compute"]),
            ("avg_compute_delay_sec_exclude_A_E", lambda m: m["avg_compute_delay_sec_exclude_A_E"]),
            ("avg_communication_delay_sec", lambda m: m["avg_communication_delay_sec"]),
            ("avg_orchestrator_compute_sec", lambda m: m["avg_orchestrator_compute_sec"]),
        ]
        for name, getter in csv_metric_rows:
            row = [name]
            for policy_key, _ in SCHEME_COLUMNS:
                m = policy_metrics.get(policy_key)
                row.append(getter(m) if m is not None else "")
            writer.writerow(row)
        _flush_file_handle(f)


def aggregate_policy_metrics(episodes: List[EpisodeResult]) -> Dict:
    n = len(episodes)
    accuracy = sum(1 for ep in episodes if ep.correct) / n if n else 0.0
    avg_total_delay = statistics.mean(ep.total_delay_sec for ep in episodes) if n else 0.0
    avg_compute_delay = statistics.mean(ep.total_compute_delay_sec for ep in episodes) if n else 0.0
    avg_total_delay_ex_ae = statistics.mean(ep.total_delay_sec_exclude_A_E_compute for ep in episodes) if n else 0.0
    avg_compute_delay_ex_ae = statistics.mean(ep.total_compute_delay_sec_exclude_A_E for ep in episodes) if n else 0.0
    avg_comm_delay = statistics.mean(ep.total_communication_delay_sec for ep in episodes) if n else 0.0
    avg_hops = statistics.mean(len(ep.hop_records) for ep in episodes) if n else 0.0
    avg_orch_compute = statistics.mean(ep.total_orchestrator_compute_sec for ep in episodes) if n else 0.0

    role_to_compute = defaultdict(list)
    role_to_tokens = defaultdict(list)
    role_to_bits = defaultdict(list)
    state_counts = defaultdict(int)
    path_counts = defaultdict(int)

    for ep in episodes:
        path_counts["->".join(ep.visited_path)] += 1
        for ar in ep.agent_records:
            role_to_compute[ar.role].append(ar.compute_delay_sec)
            role_to_tokens[ar.role].append(ar.generated_tokens)
            role_to_bits[ar.role].append(ar.generated_utf8_bits)
        for hr in ep.hop_records:
            state_counts[hr.link_state] += 1

    avg_agent_compute = {r: (statistics.mean(role_to_compute[r]) if role_to_compute[r] else None) for r in ALL_ROLES}
    avg_agent_tokens = {r: (statistics.mean(role_to_tokens[r]) if role_to_tokens[r] else None) for r in ALL_ROLES}
    avg_agent_bits = {r: (statistics.mean(role_to_bits[r]) if role_to_bits[r] else None) for r in ALL_ROLES}

    return {
        "num_samples": n,
        "accuracy": accuracy,
        "avg_total_delay_sec": avg_total_delay,
        "avg_compute_delay_sec": avg_compute_delay,
        "avg_total_delay_sec_exclude_A_E_compute": avg_total_delay_ex_ae,
        "avg_compute_delay_sec_exclude_A_E": avg_compute_delay_ex_ae,
        "avg_communication_delay_sec": avg_comm_delay,
        "avg_num_hops": avg_hops,
        "avg_orchestrator_compute_sec": avg_orch_compute,
        "avg_agent_compute_sec": avg_agent_compute,
        "avg_agent_tokens": avg_agent_tokens,
        "avg_agent_utf8_bits": avg_agent_bits,
        "link_state_counts": dict(sorted(state_counts.items())),
        "path_counts": dict(sorted(path_counts.items(), key=lambda x: (-x[1], x[0]))),
    }


def make_markdown_table(policy_to_metrics: Dict[str, Dict]) -> str:
    metric_rows: List[Tuple[str, Callable[[Dict], str]]] = [
        ("Accuracy", lambda m: f"{m['accuracy']:.4f}"),
        ("Avg total delay (s)", lambda m: f"{m['avg_total_delay_sec']:.4f}"),
        ("Avg agent compute (s)", lambda m: f"{m['avg_compute_delay_sec']:.4f}"),
        ("Avg total delay excl. A/E agent compute (s)", lambda m: f"{m['avg_total_delay_sec_exclude_A_E_compute']:.4f}"),
        ("Avg SYN/ALT/VER compute excl. ENC/FIN (s)", lambda m: f"{m['avg_compute_delay_sec_exclude_A_E']:.4f}"),
        ("Avg comm (s)", lambda m: f"{m['avg_communication_delay_sec']:.4f}"),
        ("Avg orch compute (s)", lambda m: f"{m['avg_orchestrator_compute_sec']:.4f}"),
    ]
    header = ["Metric"] + [label for _, label in SCHEME_COLUMNS]
    rows: List[List[str]] = [header]
    for metric_name, fmt in metric_rows:
        row = [metric_name]
        for policy_key, _ in SCHEME_COLUMNS:
            m = policy_to_metrics.get(policy_key)
            row.append(fmt(m) if m is not None else "—")
        rows.append(row)

    widths = [max(len(str(r[i])) for r in rows) for i in range(len(header))]
    out = []
    out.append("| " + " | ".join(str(v).ljust(widths[i]) for i, v in enumerate(rows[0])) + " |")
    out.append("| " + " | ".join("-" * widths[i] for i in range(len(widths))) + " |")
    for row in rows[1:]:
        out.append("| " + " | ".join(str(v).ljust(widths[i]) for i, v in enumerate(row)) + " |")
    return "\n".join(out)


def episode_agent_outputs_payload(ep: EpisodeResult) -> Dict:
    return {
        "idx": ep.idx,
        "gt": ep.gt,
        "pred": ep.pred,
        "correct": ep.correct,
        "policy": ep.policy,
        "visited_path": ep.visited_path,
        "agent_outputs": {ar.role: ar.generated_text for ar in ep.agent_records},
        "orchestrator_outputs": ep.orchestrator_outputs,
        "orchestrator_chosen_next": ep.orchestrator_chosen_next,
        "total_compute_delay_sec_exclude_A_E": ep.total_compute_delay_sec_exclude_A_E,
        "total_delay_sec_exclude_A_E_compute": ep.total_delay_sec_exclude_A_E_compute,
    }


def serialize_episode(ep: EpisodeResult) -> Dict:
    return {
        "idx": ep.idx,
        "gt": ep.gt,
        "pred": ep.pred,
        "correct": ep.correct,
        "policy": ep.policy,
        "visited_path": ep.visited_path,
        "agent_records": [asdict(x) for x in ep.agent_records],
        "hop_records": [asdict(x) for x in ep.hop_records],
        "total_compute_delay_sec": ep.total_compute_delay_sec,
        "total_communication_delay_sec": ep.total_communication_delay_sec,
        "total_orchestrator_compute_sec": ep.total_orchestrator_compute_sec,
        "total_delay_sec": ep.total_delay_sec,
        "total_compute_delay_sec_exclude_A_E": ep.total_compute_delay_sec_exclude_A_E,
        "total_delay_sec_exclude_A_E_compute": ep.total_delay_sec_exclude_A_E_compute,
        "orchestrator_outputs": ep.orchestrator_outputs,
        "orchestrator_chosen_next": ep.orchestrator_chosen_next,
        "mean_quality_edge_map": ep.mean_quality_edge_map,
        "pairwise_distances": ep.pairwise_distances,
    }


def initialize_incremental_output_files(output_dir: str) -> None:
    for policy in POLICY_ORDER:
        with open(os.path.join(output_dir, f"details_{policy}.jsonl"), "w", encoding="utf-8") as f:
            pass
        with open(os.path.join(output_dir, f"agent_outputs_{policy}.json"), "w", encoding="utf-8") as f:
            json.dump([], f, indent=2, ensure_ascii=False)

    sample_csv = os.path.join(output_dir, "sample_metrics.csv")
    with open(sample_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "step",
                "dataset_idx",
                "role_correct",
                "comm_correct",
                "rolecomm_correct",
                "role_pred",
                "comm_pred",
                "rolecomm_pred",
                "gt",
                "role_compute_ex_ae",
                "comm_compute_ex_ae",
                "rolecomm_compute_ex_ae",
                "role_total_delay_ex_ae",
                "comm_total_delay_ex_ae",
                "rolecomm_total_delay_ex_ae",
            ]
        )
        _flush_file_handle(f)


def append_sample_metrics_row(
    output_dir: str,
    step: int,
    dataset_idx: int,
    episodes_by_policy: Dict[str, List[EpisodeResult]],
) -> None:
    r = episodes_by_policy["role_only"][-1]
    c = episodes_by_policy["link_quality_aware"][-1]
    rc = episodes_by_policy["link_quality_llm"][-1]
    sample_csv = os.path.join(output_dir, "sample_metrics.csv")
    with open(sample_csv, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                step,
                dataset_idx,
                int(r.correct),
                int(c.correct),
                int(rc.correct),
                r.pred or "",
                c.pred or "",
                rc.pred or "",
                r.gt,
                f"{r.total_compute_delay_sec_exclude_A_E:.6f}",
                f"{c.total_compute_delay_sec_exclude_A_E:.6f}",
                f"{rc.total_compute_delay_sec_exclude_A_E:.6f}",
                f"{r.total_delay_sec_exclude_A_E_compute:.6f}",
                f"{c.total_delay_sec_exclude_A_E_compute:.6f}",
                f"{rc.total_delay_sec_exclude_A_E_compute:.6f}",
            ]
        )
        _flush_file_handle(f)


def append_episode_incremental_outputs(
    policy_name: str,
    episodes: List[EpisodeResult],
    output_dir: str,
) -> None:
    ep = episodes[-1]
    with open(os.path.join(output_dir, f"details_{policy_name}.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(serialize_episode(ep), ensure_ascii=False) + "\n")
        _flush_file_handle(f)

    with open(os.path.join(output_dir, f"agent_outputs_{policy_name}.json"), "w", encoding="utf-8") as f:
        json.dump(
            [episode_agent_outputs_payload(e) for e in episodes],
            f,
            indent=2,
            ensure_ascii=False,
        )
        _flush_file_handle(f)


def write_report_bundle(
    args: argparse.Namespace,
    episodes_by_policy: Dict[str, List[EpisodeResult]],
    state_table: Dict[str, LinkStateParams],
    total_wall_clock_sec: float,
    *,
    progress: Optional[Dict[str, Any]] = None,
    snapshot_comparison_at_sample: Optional[int] = None,
) -> Tuple[Dict, str]:
    policy_metrics = {
        policy: aggregate_policy_metrics(episodes)
        for policy, episodes in episodes_by_policy.items()
    }
    comparison_table_md = make_markdown_table(policy_metrics)

    summary = {
        "config": {
            "model": args.model,
            "orchestrator_model": args.orchestrator_model,
            "num_samples": args.num_samples,
            "seed": args.seed,
            "dataset": args.dataset,
            "split": args.split,
            "max_new_tokens": args.max_new_tokens,
            "max_new_tokens_e": args.max_new_tokens_e,
            "orchestrator_max_new_tokens": args.orchestrator_max_new_tokens,
            "orchestrator_myopic_projection": not args.orchestrator_oracle_future,
            "agent_enable_thinking": args.agent_enable_thinking,
            "agent_e_enable_thinking": args.agent_e_enable_thinking,
            "orchestrator_enable_thinking": args.orchestrator_enable_thinking,
            "default_message_bytes": args.default_message_bytes,
            "link_quality_table": {k: asdict(v) for k, v in state_table.items()},
            "notes": [
                "Task is StrategyQA-style YES/NO reasoning.",
                "Only Agent ENC sees the original full question.",
                "ALT expands missing reasoning, VER audits it, SYN integrates it, FIN outputs answer only.",
                "total_delay_sec includes agent compute + communication + orchestrator compute.",
                "Metrics suffixed exclude_A_E_compute exclude ENC and FIN agent compute from the summed agent compute.",
            ],
        },
        "policies": policy_metrics,
        "comparison_table_markdown": comparison_table_md,
        "total_experiment_wall_clock_sec": total_wall_clock_sec,
    }
    if progress is not None:
        summary["run_progress"] = progress

    report_path = os.path.join(args.output_dir, "report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
        _flush_file_handle(f)

    md_path = os.path.join(args.output_dir, "report.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# Comparison Report\n\n")
        f.write(comparison_table_md)
        f.write("\n\n## Notes\n")
        for note in summary["config"]["notes"]:
            f.write(f"- {note}\n")
        _flush_file_handle(f)

    csv_path = os.path.join(args.output_dir, "comparison.csv")
    _write_comparison_csv(csv_path, policy_metrics)
    if snapshot_comparison_at_sample is not None:
        snap_path = os.path.join(args.output_dir, f"comparison_{snapshot_comparison_at_sample}.csv")
        _write_comparison_csv(snap_path, policy_metrics)

    return summary, comparison_table_md


# =========================
# Main
# =========================

def default_device_map() -> str:
    return "cuda" if torch.cuda.is_available() and torch.cuda.device_count() == 1 else "auto"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="Qwen/Qwen3-4B")
    parser.add_argument("--orchestrator-model", default="Qwen/Qwen3-4B")
    parser.add_argument("--num-samples", type=int, default=30)
    parser.add_argument("--seed", type=int, default=42)

    parser.add_argument("--task", default="strategyqa")
    parser.add_argument("--strategyqa-dataset-id", required=True)
    parser.add_argument("--strategyqa-dataset-config", default=None)
    parser.add_argument("--split", default="validation")

    parser.add_argument("--max-new-tokens", type=int, default=96)
    parser.add_argument("--max-new-tokens-e", type=int, default=32)

    parser.add_argument("--dtype", default="float16", choices=["bfloat16", "float16"])
    parser.add_argument("--load-in-4bit", action="store_true")
    parser.add_argument("--quant-compute-dtype", default="float16", choices=["bfloat16", "float16"])
    parser.add_argument("--device-map", default=default_device_map())
    parser.add_argument("--torch-compile", action="store_true")
    parser.add_argument("--attn-implementation", default="auto", choices=["auto", "sdpa", "flash_attention_2", "eager"])

    parser.add_argument("--output-dir", default="strategyqa_agents_run")
    parser.add_argument("--initial-compute-estimate-sec", type=float, default=0.8)
    parser.add_argument("--default-message-bytes", type=int, default=500)

    parser.add_argument("--orchestrator-max-new-tokens", type=int, default=256)
    parser.add_argument("--orchestrator-oracle-future", action="store_true")

    parser.add_argument("--agent-enable-thinking", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--agent-e-enable-thinking", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--orchestrator-enable-thinking", action=argparse.BooleanOptionalAction, default=False)

    parser.add_argument("--excellent-throughput-bps", type=float, default=200_000.0)
    parser.add_argument("--excellent-extra-delay-mean-ms", type=float, default=5.0)

    parser.add_argument("--good-throughput-bps", type=float, default=40_000.0)
    parser.add_argument("--good-extra-delay-mean-ms", type=float, default=20.0)

    parser.add_argument("--fair-throughput-bps", type=float, default=10_000.0)
    parser.add_argument("--fair-extra-delay-mean-ms", type=float, default=200.0)

    parser.add_argument("--poor-throughput-bps", type=float, default=1_000.0)
    parser.add_argument("--poor-extra-delay-mean-ms", type=float, default=500.0)

    parser.add_argument("--extra-delay-std-ms", type=float, default=25.0)

    args = parser.parse_args()

    args.dataset = normalize_task_arg(args.task)
    os.makedirs(args.output_dir, exist_ok=True)
    set_seed(args.seed)

    link_quality_cfg = LinkQualityConfig(
        excellent_throughput_bps=args.excellent_throughput_bps,
        excellent_extra_delay_mean_ms=args.excellent_extra_delay_mean_ms,
        good_throughput_bps=args.good_throughput_bps,
        good_extra_delay_mean_ms=args.good_extra_delay_mean_ms,
        fair_throughput_bps=args.fair_throughput_bps,
        fair_extra_delay_mean_ms=args.fair_extra_delay_mean_ms,
        poor_throughput_bps=args.poor_throughput_bps,
        poor_extra_delay_mean_ms=args.poor_extra_delay_mean_ms,
        extra_delay_std_ms=args.extra_delay_std_ms,
    )
    state_table = build_link_state_table(link_quality_cfg)

    dataset = load_examples(
        args.dataset,
        args.strategyqa_dataset_id,
        args.strategyqa_dataset_config,
        args.split,
    )

    all_indices = list(range(len(dataset)))
    random.Random(args.seed).shuffle(all_indices)
    chosen_indices = all_indices[: args.num_samples]

    model = SharedLLM(
        model_name=args.model,
        dtype=args.dtype,
        load_in_4bit=args.load_in_4bit,
        quant_compute_dtype=args.quant_compute_dtype,
        device_map=args.device_map,
        torch_compile=args.torch_compile,
        attn_implementation=args.attn_implementation,
    )
    if args.orchestrator_model == args.model:
        orchestrator_model = model
    else:
        orchestrator_model = SharedLLM(
            model_name=args.orchestrator_model,
            dtype=args.dtype,
            load_in_4bit=args.load_in_4bit,
            quant_compute_dtype=args.quant_compute_dtype,
            device_map=args.device_map,
            torch_compile=args.torch_compile,
            attn_implementation=args.attn_implementation,
        )

    estimators = {
        "role_only": DelayEstimator(
            roles=ALL_ROLES,
            initial_compute_sec=args.initial_compute_estimate_sec,
            max_new_tokens=args.max_new_tokens,
            default_message_bytes=args.default_message_bytes,
            link_state_table=state_table,
        ),
        "link_quality_aware": DelayEstimator(
            roles=ALL_ROLES,
            initial_compute_sec=args.initial_compute_estimate_sec,
            max_new_tokens=args.max_new_tokens,
            default_message_bytes=args.default_message_bytes,
            link_state_table=state_table,
        ),
        "link_quality_llm": DelayEstimator(
            roles=ALL_ROLES,
            initial_compute_sec=args.initial_compute_estimate_sec,
            max_new_tokens=args.max_new_tokens,
            default_message_bytes=args.default_message_bytes,
            link_state_table=state_table,
        ),
    }

    episodes_by_policy: Dict[str, List[EpisodeResult]] = {
        "role_only": [],
        "link_quality_aware": [],
        "link_quality_llm": [],
    }

    initialize_incremental_output_files(args.output_dir)
    total_start = time.perf_counter()

    for step, idx in enumerate(chosen_indices, start=1):
        raw = dataset[idx]
        example = prepare_example(raw, args.dataset)
        example_seed = args.seed * 1_000_003 + idx

        for policy_name in ["role_only", "link_quality_aware", "link_quality_llm"]:
            ep = run_episode(
                model=model,
                orchestrator_model=orchestrator_model,
                example=example,
                idx=idx,
                policy_name=policy_name,
                max_new_tokens=args.max_new_tokens,
                max_new_tokens_e=args.max_new_tokens_e,
                estimator=estimators[policy_name],
                example_seed=example_seed,
                link_quality_cfg=link_quality_cfg,
                state_table=state_table,
                orch_max_new_tokens=args.orchestrator_max_new_tokens,
                orch_myopic_projection=not args.orchestrator_oracle_future,
                agent_enable_thinking=args.agent_enable_thinking,
                agent_e_enable_thinking=args.agent_e_enable_thinking,
                orchestrator_enable_thinking=args.orchestrator_enable_thinking,
            )
            episodes_by_policy[policy_name].append(ep)
            append_episode_incremental_outputs(policy_name, episodes_by_policy[policy_name], args.output_dir)

            print(
                f"[{step}/{len(chosen_indices)}] policy={policy_name} idx={idx} "
                f"path={'->'.join(ep.visited_path)} gt={ep.gt} pred={ep.pred} correct={ep.correct} "
                f"total_delay={ep.total_delay_sec:.4f}s compute={ep.total_compute_delay_sec:.4f}s "
                f"total_delay_ex_ae={ep.total_delay_sec_exclude_A_E_compute:.4f}s "
                f"compute_ex_ae={ep.total_compute_delay_sec_exclude_A_E:.4f}s "
                f"comm={ep.total_communication_delay_sec:.4f}s "
                f"orch={ep.total_orchestrator_compute_sec:.4f}s",
                flush=True,
            )

        snapshot_at = step if COMPARISON_SNAPSHOT_EVERY_SAMPLES > 0 and step % COMPARISON_SNAPSHOT_EVERY_SAMPLES == 0 else None

        write_report_bundle(
            args,
            episodes_by_policy,
            state_table,
            time.perf_counter() - total_start,
            progress={
                "status": "running",
                "samples_completed": step,
                "total_planned": len(chosen_indices),
                "last_dataset_idx": idx,
            },
            snapshot_comparison_at_sample=snapshot_at,
        )

        append_sample_metrics_row(args.output_dir, step, idx, episodes_by_policy)

        extra_csv = f" comparison_{snapshot_at}.csv" if snapshot_at is not None else ""
        print(
            f"  [checkpoint] wrote report.json, report.md, comparison.csv{extra_csv}, sample_metrics.csv",
            flush=True,
        )

    total_wall_clock = time.perf_counter() - total_start

    _, comparison_table_md = write_report_bundle(
        args,
        episodes_by_policy,
        state_table,
        total_wall_clock,
        progress={
            "status": "complete",
            "samples_completed": len(chosen_indices),
            "total_planned": len(chosen_indices),
            "last_dataset_idx": chosen_indices[-1] if chosen_indices else None,
        },
    )

    print("\n=== FINAL COMPARISON ===")
    print(comparison_table_md)
    print(f"\nSaved outputs to: {args.output_dir}")


if __name__ == "__main__":
    main()