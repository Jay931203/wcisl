#!/usr/bin/env python3

import argparse
import json
import os
import random
import re
import statistics
import time
from dataclasses import dataclass, asdict, field
from typing import Dict, List, Optional, Tuple, Any

import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


# =========================================================
# Constants
# =========================================================

ALL_ROLES = ["ENC", "ALT", "VER", "SYN", "FIN"]
INTERMEDIATE_ROLES = ["ALT", "VER", "SYN"]
LINK_STATES = ["EXCELLENT", "GOOD", "FAIR", "POOR"]

ROLE_META = {
    "ENC": {
        "name": "Question Decomposer",
        "goal": (
            "You are the ONLY agent that sees the full question.\n"
            "Rewrite the question as a claim, break it into 2-4 subquestions, "
            "list key concepts, and provide an initial hypothesis.\n"
            "Do NOT give a final answer."
        ),
        "format": (
            "Claim: <one sentence>\n"
            "Subquestions:\n"
            "- <subquestion 1>\n"
            "- <subquestion 2>\n"
            "Key Concepts: <comma-separated>\n"
            "Initial Hypothesis: <YES/NO>"
        ),
    },
    "ALT": {
        "name": "Alternative Expander",
        "goal": (
            "Expand missing considerations and overlooked possibilities.\n"
            "Add 2-4 missing considerations, explain why YES may be true and why NO may be true, "
            "then revise the hypothesis.\n"
            "Do NOT finalize the answer."
        ),
        "format": (
            "Added Considerations:\n"
            "- <item 1>\n"
            "- <item 2>\n"
            "Why YES might be true: <short>\n"
            "Why NO might be true: <short>\n"
            "Revised Hypothesis: <YES/NO>"
        ),
    },
    "VER": {
        "name": "Reasoning Verifier",
        "goal": (
            "Audit the current reasoning. Identify the weakest part, hidden assumptions, "
            "and whether the reasoning supports YES, supports NO, or is mixed.\n"
            "Then update the hypothesis.\n"
            "Do NOT finalize the answer."
        ),
        "format": (
            "Main Weakness: <one sentence>\n"
            "Hidden Assumption: <one sentence>\n"
            "Verification Result: <supports YES / supports NO / mixed>\n"
            "Updated Hypothesis: <YES/NO>"
        ),
    },
    "SYN": {
        "name": "Decision Synthesizer",
        "goal": (
            "Summarize the strongest reason for YES and the strongest reason for NO, "
            "then decide which side is better supported overall."
        ),
        "format": (
            "Best Reason for YES: <one sentence>\n"
            "Best Reason for NO: <one sentence>\n"
            "Current Best Candidate: <YES/NO>"
        ),
    },
    "FIN": {
        "name": "Final Answer Agent",
        "goal": "Output the final answer only. Do NOT add new reasoning.",
        "format": "Answer: <YES/NO>",
    },
}


# =========================================================
# Utilities
# =========================================================

def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def payload_bits_utf8(text: str) -> int:
    return len(text.encode("utf-8")) * 8


def normalize_answer(raw: Any) -> str:
    if isinstance(raw, bool):
        return "YES" if raw else "NO"
    s = str(raw).strip().lower()
    if s in ("yes", "true", "1"):
        return "YES"
    if s in ("no", "false", "0"):
        return "NO"
    raise ValueError(f"Cannot normalize answer: {raw}")


ANSWER_PATTERNS = [
    r"ANSWER\s*[:\-]?\s*(YES|NO)",
    r"FINAL\s+ANSWER\s*[:\-]?\s*(YES|NO)",
    r"INITIAL\s+HYPOTHESIS\s*[:\-]?\s*(YES|NO)",
    r"REVISED\s+HYPOTHESIS\s*[:\-]?\s*(YES|NO)",
    r"UPDATED\s+HYPOTHESIS\s*[:\-]?\s*(YES|NO)",
    r"CURRENT\s+BEST\s+CANDIDATE\s*[:\-]?\s*(YES|NO)",
]


def extract_answer(text: str) -> Optional[str]:
    if not text:
        return None
    upper = text.upper()

    for line in reversed(upper.splitlines()):
        m = re.search(r"(ANSWER|FINAL ANSWER|INITIAL HYPOTHESIS|REVISED HYPOTHESIS|UPDATED HYPOTHESIS|CURRENT BEST CANDIDATE)\s*[:\-]?\s*(YES|NO)\b", line)
        if m:
            return m.group(2)

    for pattern in ANSWER_PATTERNS:
        matches = re.findall(pattern, upper)
        if matches:
            return matches[-1]

    fallback = re.findall(r"\b(YES|NO)\b", upper[-300:])
    return fallback[-1] if fallback else None


def preview(text: str, n: int = 250) -> str:
    text = text.strip()
    return text if len(text) <= n else text[:n] + "..."


# =========================================================
# Data classes
# =========================================================

@dataclass
class LinkConfig:
    throughput_bps: Dict[str, float]
    mean_delay_sec: Dict[str, float]
    std_delay_sec: float = 0.025


@dataclass
class RoleTokenConfig:
    enc: int = 96
    alt: int = 96
    ver: int = 96
    syn: int = 96
    fin: int = 32
    orch: int = 128

    def get(self, role: str) -> int:
        table = {
            "ENC": self.enc,
            "ALT": self.alt,
            "VER": self.ver,
            "SYN": self.syn,
            "FIN": self.fin,
            "ORCH": self.orch,
        }
        return table[role]


@dataclass
class AgentStep:
    role: str
    output: str
    parsed_answer: Optional[str]
    gen_tokens: int
    compute_sec: float
    message_bits: int


@dataclass
class HopStep:
    src: str
    dst: str
    state: str
    message_bits: int
    serialization_sec: float
    propagation_sec: float
    total_sec: float


@dataclass
class EpisodeResult:
    idx: int
    policy: str
    gt: str
    pred: Optional[str]
    correct: bool
    path: List[str]
    agents: List[AgentStep] = field(default_factory=list)
    hops: List[HopStep] = field(default_factory=list)
    total_compute_sec: float = 0.0
    total_comm_sec: float = 0.0
    total_orch_sec: float = 0.0

    @property
    def total_delay_sec(self) -> float:
        return self.total_compute_sec + self.total_comm_sec + self.total_orch_sec


# =========================================================
# LLM wrapper
# =========================================================

class SharedLLM:
    def __init__(
        self,
        model_name: str,
        dtype: str = "float16",
        load_in_4bit: bool = False,
        quant_compute_dtype: str = "float16",
        device_map: str = "auto",
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

        self.model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch_dtype,
            quantization_config=quant_config,
            device_map=device_map,
        )
        self.model.eval()
        self.model.config.use_cache = True

    def _format_prompt(self, prompt: str) -> str:
        if getattr(self.tokenizer, "chat_template", None):
            try:
                return self.tokenizer.apply_chat_template(
                    [
                        {"role": "system", "content": "You are a careful reasoning assistant."},
                        {"role": "user", "content": prompt},
                    ],
                    tokenize=False,
                    add_generation_prompt=True,
                    enable_thinking=False,
                )
            except TypeError:
                return self.tokenizer.apply_chat_template(
                    [
                        {"role": "system", "content": "You are a careful reasoning assistant."},
                        {"role": "user", "content": prompt},
                    ],
                    tokenize=False,
                    add_generation_prompt=True,
                )
        return prompt

    def generate(self, prompt: str, max_new_tokens: int) -> Tuple[str, int, float]:
        prompt = self._format_prompt(prompt)
        inputs = self.tokenizer(prompt, return_tensors="pt")
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}

        start = time.perf_counter()
        with torch.inference_mode():
            out = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
                use_cache=True,
                pad_token_id=self.tokenizer.pad_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
            )
        elapsed = time.perf_counter() - start

        prompt_len = inputs["input_ids"].shape[1]
        gen_ids = out[0][prompt_len:]
        text = self.tokenizer.decode(gen_ids, skip_special_tokens=True)
        return text, int(gen_ids.shape[0]), elapsed


# =========================================================
# Dataset
# =========================================================

def load_strategyqa(dataset_id: str, dataset_config: Optional[str], split: str):
    if dataset_config:
        ds = load_dataset(dataset_id, dataset_config, split=split)
    else:
        ds = load_dataset(dataset_id, split=split)
    return ds


def prepare_example(row: Dict) -> Dict[str, str]:
    return {
        "question": str(row["question"]).strip(),
        "answer": normalize_answer(row.get("answer", row.get("label"))),
    }


# =========================================================
# Prompt builders
# =========================================================

def base_question_block(example: Dict[str, str]) -> str:
    return (
        f"Question:\n{example['question']}\n\n"
        "Task:\nDecide whether the answer is YES or NO."
    )


def build_agent_prompt(role: str, example: Dict[str, str], prev_text: Optional[str]) -> str:
    meta = ROLE_META[role]
    input_block = base_question_block(example) if role == "ENC" else (prev_text or "")

    return (
        f"Agent {role} ({meta['name']})\n\n"
        "Rules:\n"
        "- Follow only your assigned role\n"
        "- Be concise\n"
        "- Keep the required output structure exactly\n\n"
        f"Your role:\n{meta['goal']}\n\n"
        f"Input:\n{input_block}\n\n"
        f"Output format:\n{meta['format']}"
    )


def build_orchestrator_prompt(
    policy: str,
    current_role: str,
    visited: List[str],
    remaining: List[str],
    prev_output: str,
    comm_info: Optional[Dict[str, Dict[str, Any]]] = None,
) -> str:
    lines = [
        "You are a routing decision agent.",
        "",
        f"Current role: {current_role}",
        f"Visited path: {' -> '.join(visited)}",
        f"Choose exactly one next agent from: {', '.join(remaining)}",
        "",
        "Previous agent output:",
        preview(prev_output, 1800),
        "",
    ]

    if policy in ("role", "role_comm"):
        lines += [
            "Role guidance:",
            "- ALT expands missing possibilities",
            "- VER audits and tests assumptions",
            "- SYN integrates into a pre-final verdict",
            "",
        ]

    if policy in ("comm", "role_comm") and comm_info is not None:
        lines.append("Communication guidance:")
        for cand in remaining:
            info = comm_info[cand]
            lines.append(
                f"- {cand}: state={info['state']}, "
                f"comm_sec={info['comm_sec']:.4f}, "
                f"after_sec={info['after_sec']:.4f}"
            )
        lines.append("")

    lines += [
        "Final instruction:",
        "Last line must be exactly:",
        "Next: <ALT or VER or SYN>",
    ]
    return "\n".join(lines)


def parse_next_role(text: str, candidates: List[str]) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"Next\s*:\s*(ALT|VER|SYN)\b", text, re.I)
    if m:
        choice = m.group(1).upper()
        if choice in candidates:
            return choice

    last_line = text.strip().splitlines()[-1].upper()
    for c in candidates:
        if c in last_line:
            return c
    return None


# =========================================================
# Link / delay model
# =========================================================

def sample_pairwise_distances(seed: int) -> Dict[Tuple[str, str], float]:
    rng = random.Random(seed)
    pairs = {}
    roles = ALL_ROLES
    values = [10 ** rng.uniform(-2, 4) for _ in range(len(roles) * (len(roles) - 1) // 2)]
    rng.shuffle(values)

    idx = 0
    for i in range(len(roles)):
        for j in range(i + 1, len(roles)):
            a, b = roles[i], roles[j]
            d = values[idx]
            idx += 1
            pairs[(a, b)] = d
            pairs[(b, a)] = d
    return pairs


def distance_to_state_probs(d: float, dmin: float, dmax: float) -> List[float]:
    if dmax <= dmin:
        return [0.25, 0.25, 0.25, 0.25]
    t = (d - dmin) / (dmax - dmin)

    near = [0.93, 0.04, 0.02, 0.01]
    far = [0.01, 0.02, 0.04, 0.93]
    probs = [(1 - t) * near[i] + t * far[i] for i in range(4)]
    s = sum(probs)
    return [p / s for p in probs]


def sample_edge_states(seed: int, dist_map: Dict[Tuple[str, str], float]) -> Dict[Tuple[str, str], str]:
    rng = random.Random(seed + 777)
    vals = [v for (a, b), v in dist_map.items() if a != b]
    dmin, dmax = min(vals), max(vals)

    out = {}
    for (a, b), d in dist_map.items():
        if a == b:
            continue
        probs = distance_to_state_probs(d, dmin, dmax)
        out[(a, b)] = rng.choices(LINK_STATES, weights=probs, k=1)[0]
    return out


def compute_hop_delay(bits: int, state: str, cfg: LinkConfig, rng: random.Random) -> Tuple[float, float, float]:
    throughput = cfg.throughput_bps[state]
    mean = cfg.mean_delay_sec[state]
    serialization = bits / throughput
    propagation = max(0.0, rng.gauss(mean, cfg.std_delay_sec))
    total = serialization + propagation
    return serialization, propagation, total


# =========================================================
# Delay estimator
# =========================================================

class DelayEstimator:
    def __init__(self, default_compute_sec: float, default_message_bits: int, link_cfg: LinkConfig):
        self.default_compute_sec = default_compute_sec
        self.default_message_bits = default_message_bits
        self.link_cfg = link_cfg
        self.compute_hist: Dict[str, List[float]] = {r: [] for r in ALL_ROLES}
        self.bits_hist: Dict[str, List[int]] = {r: [] for r in ALL_ROLES}

    def observe(self, role: str, compute_sec: float, bits: int) -> None:
        self.compute_hist[role].append(compute_sec)
        self.bits_hist[role].append(bits)

    def estimate_compute(self, role: str) -> float:
        h = self.compute_hist[role]
        return statistics.mean(h) if h else self.default_compute_sec

    def estimate_bits(self, role: str) -> float:
        h = self.bits_hist[role]
        return statistics.mean(h) if h else self.default_message_bits

    def estimate_comm(self, bits: float, state: str) -> float:
        return bits / self.link_cfg.throughput_bps[state] + self.link_cfg.mean_delay_sec[state]


# =========================================================
# Orchestrator
# =========================================================

class Orchestrator:
    def __init__(self, policy: str, estimator: DelayEstimator):
        self.policy = policy
        self.estimator = estimator

    def fallback_choice(self, current_role: str, remaining: List[str]) -> str:
        # soft default order
        preferred = {
            "ENC": ["ALT", "VER", "SYN"],
            "ALT": ["VER", "SYN"],
            "VER": ["SYN", "ALT"],
            "SYN": ["VER", "ALT"],
        }.get(current_role, ["ALT", "VER", "SYN"])
        for x in preferred:
            if x in remaining:
                return x
        return remaining[0]

    def decide(
        self,
        llm: SharedLLM,
        token_cfg: RoleTokenConfig,
        current_role: str,
        visited: List[str],
        remaining: List[str],
        prev_output: str,
        current_bits: int,
        edge_states: Dict[Tuple[str, str], str],
        elapsed_sec: float,
    ) -> Tuple[str, float, Optional[str]]:
        if len(remaining) == 1:
            return remaining[0], 0.0, None

        comm_info = {}
        for cand in remaining:
            state = edge_states[(current_role, cand)]
            comm_sec = self.estimator.estimate_comm(current_bits, state)
            after_sec = elapsed_sec + comm_sec + self.estimator.estimate_compute(cand)
            comm_info[cand] = {
                "state": state,
                "comm_sec": comm_sec,
                "after_sec": after_sec,
            }

        prompt = build_orchestrator_prompt(
            policy=self.policy,
            current_role=current_role,
            visited=visited,
            remaining=remaining,
            prev_output=prev_output,
            comm_info=comm_info,
        )

        text, _, orch_sec = llm.generate(prompt, token_cfg.get("ORCH"))
        choice = parse_next_role(text, remaining)

        if choice is None:
            if self.policy == "comm":
                choice = min(remaining, key=lambda c: (comm_info[c]["comm_sec"], comm_info[c]["after_sec"]))
            else:
                choice = self.fallback_choice(current_role, remaining)

        return choice, orch_sec, text


# =========================================================
# Core episode
# =========================================================

def run_agent(
    llm: SharedLLM,
    role: str,
    token_cfg: RoleTokenConfig,
    example: Dict[str, str],
    prev_text: Optional[str],
) -> AgentStep:
    prompt = build_agent_prompt(role, example, prev_text)
    text, gen_tokens, compute_sec = llm.generate(prompt, token_cfg.get(role))
    bits = payload_bits_utf8(text)
    return AgentStep(
        role=role,
        output=text,
        parsed_answer=extract_answer(text),
        gen_tokens=gen_tokens,
        compute_sec=compute_sec,
        message_bits=bits,
    )


def run_episode(
    example: Dict[str, str],
    idx: int,
    policy: str,
    llm: SharedLLM,
    orch_llm: SharedLLM,
    token_cfg: RoleTokenConfig,
    estimator: DelayEstimator,
    link_cfg: LinkConfig,
    seed: int,
) -> EpisodeResult:
    dist_map = sample_pairwise_distances(seed + idx * 1009)
    edge_states = sample_edge_states(seed + idx * 2003, dist_map)
    hop_rng = random.Random(seed + idx * 3001)

    result = EpisodeResult(
        idx=idx,
        policy=policy,
        gt=example["answer"],
        pred=None,
        correct=False,
        path=[],
    )

    # ENC
    enc = run_agent(llm, "ENC", token_cfg, example, None)
    result.agents.append(enc)
    result.total_compute_sec += enc.compute_sec
    result.path.append("ENC")
    estimator.observe("ENC", enc.compute_sec, enc.message_bits)

    current_role = "ENC"
    current_text = enc.output
    current_bits = enc.message_bits
    remaining = ["ALT", "VER", "SYN"]

    orch = Orchestrator(policy=policy, estimator=estimator)

    while remaining:
        elapsed = result.total_compute_sec + result.total_comm_sec + result.total_orch_sec
        next_role, orch_sec, _ = orch.decide(
            llm=orch_llm,
            token_cfg=token_cfg,
            current_role=current_role,
            visited=result.path.copy(),
            remaining=remaining.copy(),
            prev_output=current_text,
            current_bits=current_bits,
            edge_states=edge_states,
            elapsed_sec=elapsed,
        )
        result.total_orch_sec += orch_sec

        state = edge_states[(current_role, next_role)]
        ser, prop, total = compute_hop_delay(current_bits, state, link_cfg, hop_rng)
        result.hops.append(
            HopStep(
                src=current_role,
                dst=next_role,
                state=state,
                message_bits=current_bits,
                serialization_sec=ser,
                propagation_sec=prop,
                total_sec=total,
            )
        )
        result.total_comm_sec += total

        step = run_agent(llm, next_role, token_cfg, example, current_text)
        result.agents.append(step)
        result.total_compute_sec += step.compute_sec
        estimator.observe(next_role, step.compute_sec, step.message_bits)

        result.path.append(next_role)
        current_role = next_role
        current_text = step.output
        current_bits = step.message_bits
        remaining.remove(next_role)

    # final hop to FIN
    final_state = edge_states[(current_role, "FIN")]
    ser, prop, total = compute_hop_delay(current_bits, final_state, link_cfg, hop_rng)
    result.hops.append(
        HopStep(
            src=current_role,
            dst="FIN",
            state=final_state,
            message_bits=current_bits,
            serialization_sec=ser,
            propagation_sec=prop,
            total_sec=total,
        )
    )
    result.total_comm_sec += total

    fin = run_agent(llm, "FIN", token_cfg, example, current_text)
    result.agents.append(fin)
    result.total_compute_sec += fin.compute_sec
    estimator.observe("FIN", fin.compute_sec, fin.message_bits)
    result.path.append("FIN")

    result.pred = fin.parsed_answer
    result.correct = (result.pred == result.gt)
    return result


# =========================================================
# Reporting
# =========================================================

def summarize(episodes: List[EpisodeResult]) -> Dict[str, Any]:
    n = len(episodes)
    if n == 0:
        return {}

    return {
        "num_samples": n,
        "accuracy": sum(ep.correct for ep in episodes) / n,
        "avg_total_delay_sec": statistics.mean(ep.total_delay_sec for ep in episodes),
        "avg_compute_sec": statistics.mean(ep.total_compute_sec for ep in episodes),
        "avg_comm_sec": statistics.mean(ep.total_comm_sec for ep in episodes),
        "avg_orch_sec": statistics.mean(ep.total_orch_sec for ep in episodes),
        "paths": {
            p: sum(1 for ep in episodes if "->".join(ep.path) == p)
            for p in sorted(set("->".join(ep.path) for ep in episodes))
        },
    }


def save_jsonl(path: str, rows: List[Dict[str, Any]]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


# =========================================================
# Main
# =========================================================

def default_device_map() -> str:
    return "cuda" if torch.cuda.is_available() and torch.cuda.device_count() == 1 else "auto"


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("--model", default="Qwen/Qwen3-4B")
    parser.add_argument("--orchestrator-model", default="Qwen/Qwen3-4B")
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--dataset-config", default=None)
    parser.add_argument("--split", default="validation")
    parser.add_argument("--num-samples", type=int, default=30)
    parser.add_argument("--seed", type=int, default=42)

    parser.add_argument("--dtype", default="float16", choices=["float16", "bfloat16"])
    parser.add_argument("--quant-compute-dtype", default="float16", choices=["float16", "bfloat16"])
    parser.add_argument("--load-in-4bit", action="store_true")
    parser.add_argument("--device-map", default=default_device_map())

    # role-wise token control
    parser.add_argument("--tokens-enc", type=int, default=96)
    parser.add_argument("--tokens-alt", type=int, default=96)
    parser.add_argument("--tokens-ver", type=int, default=96)
    parser.add_argument("--tokens-syn", type=int, default=96)
    parser.add_argument("--tokens-fin", type=int, default=32)
    parser.add_argument("--tokens-orch", type=int, default=128)

    parser.add_argument("--default-compute-sec", type=float, default=0.8)
    parser.add_argument("--default-message-bytes", type=int, default=500)

    parser.add_argument("--excellent-throughput-bps", type=float, default=200000.0)
    parser.add_argument("--good-throughput-bps", type=float, default=40000.0)
    parser.add_argument("--fair-throughput-bps", type=float, default=10000.0)
    parser.add_argument("--poor-throughput-bps", type=float, default=1000.0)

    parser.add_argument("--excellent-delay-ms", type=float, default=5.0)
    parser.add_argument("--good-delay-ms", type=float, default=20.0)
    parser.add_argument("--fair-delay-ms", type=float, default=200.0)
    parser.add_argument("--poor-delay-ms", type=float, default=500.0)
    parser.add_argument("--delay-std-ms", type=float, default=25.0)

    parser.add_argument("--output-dir", default="clean_strategyqa_run")

    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    set_seed(args.seed)

    token_cfg = RoleTokenConfig(
        enc=args.tokens_enc,
        alt=args.tokens_alt,
        ver=args.tokens_ver,
        syn=args.tokens_syn,
        fin=args.tokens_fin,
        orch=args.tokens_orch,
    )

    link_cfg = LinkConfig(
        throughput_bps={
            "EXCELLENT": args.excellent_throughput_bps,
            "GOOD": args.good_throughput_bps,
            "FAIR": args.fair_throughput_bps,
            "POOR": args.poor_throughput_bps,
        },
        mean_delay_sec={
            "EXCELLENT": args.excellent_delay_ms / 1000.0,
            "GOOD": args.good_delay_ms / 1000.0,
            "FAIR": args.fair_delay_ms / 1000.0,
            "POOR": args.poor_delay_ms / 1000.0,
        },
        std_delay_sec=args.delay_std_ms / 1000.0,
    )

    dataset = load_strategyqa(args.dataset_id, args.dataset_config, args.split)
    indices = list(range(len(dataset)))
    random.Random(args.seed).shuffle(indices)
    indices = indices[:args.num_samples]

    llm = SharedLLM(
        model_name=args.model,
        dtype=args.dtype,
        load_in_4bit=args.load_in_4bit,
        quant_compute_dtype=args.quant_compute_dtype,
        device_map=args.device_map,
    )

    orch_llm = llm if args.orchestrator_model == args.model else SharedLLM(
        model_name=args.orchestrator_model,
        dtype=args.dtype,
        load_in_4bit=args.load_in_4bit,
        quant_compute_dtype=args.quant_compute_dtype,
        device_map=args.device_map,
    )

    estimators = {
        "role": DelayEstimator(args.default_compute_sec, args.default_message_bytes * 8, link_cfg),
        "comm": DelayEstimator(args.default_compute_sec, args.default_message_bytes * 8, link_cfg),
        "role_comm": DelayEstimator(args.default_compute_sec, args.default_message_bytes * 8, link_cfg),
    }

    all_results: Dict[str, List[EpisodeResult]] = {k: [] for k in estimators.keys()}

    start = time.perf_counter()

    for step, idx in enumerate(indices, start=1):
        example = prepare_example(dataset[idx])

        for policy in ["role", "comm", "role_comm"]:
            ep = run_episode(
                example=example,
                idx=idx,
                policy=policy,
                llm=llm,
                orch_llm=orch_llm,
                token_cfg=token_cfg,
                estimator=estimators[policy],
                link_cfg=link_cfg,
                seed=args.seed,
            )
            all_results[policy].append(ep)

            print(
                f"[{step}/{len(indices)}] "
                f"policy={policy} idx={idx} "
                f"path={'->'.join(ep.path)} "
                f"gt={ep.gt} pred={ep.pred} correct={ep.correct} "
                f"delay={ep.total_delay_sec:.4f}s "
                f"compute={ep.total_compute_sec:.4f}s "
                f"comm={ep.total_comm_sec:.4f}s "
                f"orch={ep.total_orch_sec:.4f}s",
                flush=True,
            )

    wall = time.perf_counter() - start

    summary = {
        "config": {
            "model": args.model,
            "orchestrator_model": args.orchestrator_model,
            "num_samples": args.num_samples,
            "tokens": asdict(token_cfg),
        },
        "results": {policy: summarize(eps) for policy, eps in all_results.items()},
        "wall_clock_sec": wall,
    }

    with open(os.path.join(args.output_dir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    for policy, eps in all_results.items():
        save_jsonl(
            os.path.join(args.output_dir, f"{policy}_episodes.jsonl"),
            [
                {
                    "idx": ep.idx,
                    "policy": ep.policy,
                    "gt": ep.gt,
                    "pred": ep.pred,
                    "correct": ep.correct,
                    "path": ep.path,
                    "total_delay_sec": ep.total_delay_sec,
                    "total_compute_sec": ep.total_compute_sec,
                    "total_comm_sec": ep.total_comm_sec,
                    "total_orch_sec": ep.total_orch_sec,
                    "agents": [asdict(a) for a in ep.agents],
                    "hops": [asdict(h) for h in ep.hops],
                }
                for ep in eps
            ],
        )

    print("\n=== FINAL SUMMARY ===")
    print(json.dumps(summary["results"], indent=2, ensure_ascii=False))
    print(f"\nSaved to: {args.output_dir}")


if __name__ == "__main__":
    main()