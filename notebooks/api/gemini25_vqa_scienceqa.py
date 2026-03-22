"""
VQA Mutual Cognition Experiment -- Gemini 2.5 Flash (MINIMAL TEST)
5 questions, 1 budget (16tok), 4 conditions = ~30 API calls
Uses REST API directly (no google-generativeai package needed)
"""

import requests, json, base64, time, random, re, sys, traceback
from io import BytesIO

import os; API_KEY = os.environ.get("GEMINI_API_KEY", "")

# ── Model selection ──────────────────────────────────────────────
# Try gemini-2.5-flash first, fall back if needed
MODEL_CANDIDATES = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
]

def pr(msg):
    print(msg, flush=True)

def _api_url(model_name):
    return f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={API_KEY}"

def test_model(model_name):
    """Quick text-only test to see if model works."""
    url = _api_url(model_name)
    payload = {
        "contents": [{"parts": [{"text": "Say hello in one word."}]}],
        "generationConfig": {"maxOutputTokens": 8, "temperature": 0}
    }
    try:
        r = requests.post(url, json=payload, timeout=30)
        if r.status_code == 200:
            data = r.json()
            text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
            return True, text
        else:
            return False, f"HTTP {r.status_code}: {r.text[:200]}"
    except Exception as e:
        return False, str(e)

# Find a working model
ACTIVE_MODEL = None
for candidate in MODEL_CANDIDATES:
    pr(f"Testing model: {candidate} ...")
    ok, msg = test_model(candidate)
    if ok:
        ACTIVE_MODEL = candidate
        pr(f"  OK! Response: {msg}")
        break
    else:
        pr(f"  FAILED: {msg}")

if ACTIVE_MODEL is None:
    pr("FATAL: No working Gemini model found. Exiting.")
    sys.exit(1)

pr(f"\nUsing model: {ACTIVE_MODEL}\n")
API_URL = _api_url(ACTIVE_MODEL)

# ── API call helpers ─────────────────────────────────────────────
_last_call_time = 0.0
CALL_INTERVAL = 4.5  # seconds between calls (free tier ~15 RPM)

def gemini_text(prompt, max_tokens=16):
    """Text-only Gemini call."""
    global _last_call_time

    for attempt in range(3):
        now = time.time()
        wait_needed = CALL_INTERVAL - (now - _last_call_time)
        if wait_needed > 0:
            time.sleep(wait_needed)

        _last_call_time = time.time()
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": 0,
                "thinkingConfig": {"thinkingBudget": 0},
            }
        }
        r = requests.post(API_URL, json=payload, timeout=60)
        if r.status_code == 200:
            data = r.json()
            return data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
        elif r.status_code == 429:
            wait = 10 * (attempt + 1)
            pr(f"  Rate limit, waiting {wait}s...")
            time.sleep(wait)
        else:
            pr(f"  Error {r.status_code}: {r.text[:200]}")
            return ""
    return ""

def gemini_vision(prompt, pil_image, max_tokens=16):
    """Vision Gemini call with PIL image (base64 encoded)."""
    global _last_call_time

    # Convert PIL to base64 PNG
    buf = BytesIO()
    pil_image.save(buf, format="PNG")
    img_b64 = base64.b64encode(buf.getvalue()).decode()

    for attempt in range(3):
        now = time.time()
        wait_needed = CALL_INTERVAL - (now - _last_call_time)
        if wait_needed > 0:
            time.sleep(wait_needed)

        _last_call_time = time.time()
        payload = {
            "contents": [{"parts": [
                {"inlineData": {"mimeType": "image/png", "data": img_b64}},
                {"text": prompt}
            ]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": 0,
                "thinkingConfig": {"thinkingBudget": 0},
            }
        }
        r = requests.post(API_URL, json=payload, timeout=60)
        if r.status_code == 200:
            data = r.json()
            return data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
        elif r.status_code == 429:
            wait = 10 * (attempt + 1)
            pr(f"  Rate limit, waiting {wait}s...")
            time.sleep(wait)
        else:
            pr(f"  Error {r.status_code}: {r.text[:200]}")
            return ""
    return ""

# ── Load ScienceQA ──────────────────────────────────────────────
pr("Loading ScienceQA dataset (test split)...")
dataset_loaded = False

try:
    from datasets import load_dataset
    ds = load_dataset("derek-thomas/ScienceQA", split="test")
    dataset_loaded = True
    pr(f"  Loaded: {len(ds)} rows")
except Exception as e1:
    pr(f"  derek-thomas/ScienceQA failed: {e1}")

if not dataset_loaded:
    try:
        from datasets import load_dataset
        ds = load_dataset("ScienceQA", split="test", trust_remote_code=False)
        dataset_loaded = True
        pr(f"  Loaded ScienceQA: {len(ds)} rows")
    except Exception as e2:
        pr(f"  ScienceQA fallback failed: {e2}")

if not dataset_loaded:
    try:
        from datasets import load_dataset
        ds = load_dataset("derek-thomas/ScienceQA", split="validation")
        dataset_loaded = True
        pr(f"  Loaded ScienceQA validation: {len(ds)} rows")
    except Exception as e3:
        pr(f"  FATAL: Cannot load ScienceQA: {e3}")
        sys.exit(1)

# Filter for questions with images
pr("Filtering for questions with images...")
image_rows = []
for i, row in enumerate(ds):
    img = row.get("image", None)
    if img is not None:
        choices = row.get("choices", [])
        if len(choices) >= 2:
            image_rows.append(row)

pr(f"  Found {len(image_rows)} questions with images")

# Sample 5 (minimal test)
random.seed(42)
samples = random.sample(image_rows, min(5, len(image_rows)))
pr(f"  Sampled {len(samples)} questions (minimal test)")

# Format
LETTERS = "ABCDEFGH"

def format_question(row):
    choices = row["choices"]
    choices_text = "\n".join(f"{LETTERS[i]}) {c}" for i, c in enumerate(choices))
    answer_idx = row["answer"]
    answer_letter = LETTERS[answer_idx]
    return {
        "image": row["image"],      # PIL Image
        "question": row["question"],
        "choices_text": choices_text,
        "answer": answer_letter,
        "n_choices": len(choices),
    }

questions = [format_question(s) for s in samples]

# ── Prompts ──────────────────────────────────────────────────────
A_BLIND = """You are Agent A.

You can inspect the image under these limitations:
- reliable for large objects, actions, and spatial relations
- may miss small objects, text, and subtle details
- report only visible facts; avoid guessing

Describe the image using exactly 3 short phrases:
1. main objects
2. main action or relation
3. visible context

Use at most 15 words total."""

A_AWARE = """You are Agent A.

You can inspect the image under these limitations:
- reliable for large objects, actions, and spatial relations
- may miss small objects, text, and subtle details
- report only visible facts; avoid guessing

You also know the question and answer choices.

Describe the image using exactly 3 short phrases:
1. main objects
2. main action or relation
3. the visible detail most useful for distinguishing the answer choices

Use at most 15 words total.
Do NOT mention any answer choice explicitly."""

B_BLIND = """You are Agent B.

You are given:
- a description from Agent A
- a question
- answer choices

Choose the best answer using the description.

Output ONLY: A, B, C, or D."""

B_AWARE = """You are Agent B.

You are given:
- a description from Agent A
- a question
- answer choices

About Agent A:
- A is reliable for large objects, actions, and spatial relations
- A may miss small objects, text, and subtle details
- A reports visible facts and avoids guessing

Interpret the description with this in mind:
- trust mentioned objects/actions strongly
- do not assume missing small details are absent
- rely on visible relations more than fine detail

Output ONLY: A, B, C, or D."""

# ── Conditions ───────────────────────────────────────────────────
CONDITIONS = {
    "blind":   {"a_type": "blind",  "b_knows": False},
    "a_aware": {"a_type": "aware",  "b_knows": False},
    "b_aware": {"a_type": "blind",  "b_knows": True},
    "mutual":  {"a_type": "aware",  "b_knows": True},
}

TX_BUDGET = 16  # single budget for minimal test

# ── Answer extraction ────────────────────────────────────────────
def extract_answer(resp, n_choices=4):
    valid = set(LETTERS[:n_choices])
    t = resp.strip().upper()
    if len(t) == 1 and t in valid:
        return t
    for pat in [
        r'(?:answer|choice)[\s:is]*([A-' + LETTERS[n_choices-1] + r'])\b',
        r'^([A-' + LETTERS[n_choices-1] + r'])[)\.]',
        r'\b([A-' + LETTERS[n_choices-1] + r'])\b',
    ]:
        m = re.search(pat, t, re.IGNORECASE | re.MULTILINE)
        if m and m.group(1).upper() in valid:
            return m.group(1).upper()
    return "N/A"

# ── Main experiment loop ─────────────────────────────────────────
results = {c: [] for c in CONDITIONS}
call_count = 0
t_start = time.time()

pr(f"\nVQA Mutual Cognition -- MINIMAL TEST")
pr(f"  Model: {ACTIVE_MODEL}")
pr(f"  Questions: {len(questions)}")
pr(f"  Budget: {TX_BUDGET}tok")
pr(f"  Conditions: {list(CONDITIONS.keys())}")
pr(f"  Expected calls: ~{len(questions) * (2 + 4)} (with A caching)")
pr("")

for qi, q in enumerate(questions):
    pr(f"-- Q{qi+1}/{len(questions)}: {q['question'][:60]}...")
    pr(f"   Answer: {q['answer']}")

    # Cache Agent A responses (blind vs aware)
    a_cache = {}

    for cond_name, cond in CONDITIONS.items():
        a_type = cond["a_type"]
        b_knows = cond["b_knows"]

        # ── Agent A (vision) ─────────────────────────────────
        cache_key = a_type
        if cache_key in a_cache:
            a_desc = a_cache[cache_key]
        else:
            if a_type == "blind":
                a_prompt = A_BLIND + "\n\nDescribe the image."
            else:  # aware
                a_prompt = (
                    A_AWARE
                    + f"\n\nQuestion: {q['question']}\nChoices:\n{q['choices_text']}"
                    + "\n\nDescribe the image."
                )

            a_desc = gemini_vision(a_prompt, q["image"], max_tokens=TX_BUDGET)
            a_cache[cache_key] = a_desc
            call_count += 1
            pr(f"   A[{a_type}]: {a_desc[:80]}")

        # ── Agent B (text only) ──────────────────────────────
        b_system = B_AWARE if b_knows else B_BLIND
        b_prompt = (
            b_system
            + f"\n\nDescription:\n{a_desc}\n\n"
            + f"Question: {q['question']}\n"
            + f"Choices:\n{q['choices_text']}\n\n"
            + "Answer:"
        )
        b_resp = gemini_text(b_prompt, max_tokens=3)
        call_count += 1

        pred = extract_answer(b_resp, q["n_choices"])
        correct = int(pred == q["answer"])
        results[cond_name].append(correct)

        mark = "OK" if correct else "WRONG"
        pr(f"   [{cond_name:8s}] B={b_resp:>3s} pred={pred} {mark}")

    elapsed = time.time() - t_start
    eta = elapsed / (qi + 1) * (len(questions) - qi - 1)
    pr(f"   [{call_count} calls, {elapsed:.0f}s elapsed, ETA {eta:.0f}s]\n")

# ── Results ──────────────────────────────────────────────────────
total_time = time.time() - t_start
pr(f"\n{'='*60}")
pr(f"RESULTS -- {len(questions)} questions, {call_count} API calls, {total_time:.0f}s")
pr(f"Model: {ACTIVE_MODEL}, Budget: {TX_BUDGET}tok")
pr(f"{'='*60}\n")

header = f"{'Condition':<12} {'Correct':<10} {'Accuracy':<10}"
pr(header)
pr("-" * len(header))

for c in CONDITIONS:
    vals = results[c]
    n_correct = sum(vals)
    acc = n_correct / len(vals) * 100 if vals else 0
    pr(f"{c:<12} {n_correct}/{len(vals):<8} {acc:>5.1f}%")

pr("")

# 2x2 analysis
blind_acc   = sum(results["blind"]) / len(results["blind"]) * 100
a_aware_acc = sum(results["a_aware"]) / len(results["a_aware"]) * 100
b_aware_acc = sum(results["b_aware"]) / len(results["b_aware"]) * 100
mutual_acc  = sum(results["mutual"]) / len(results["mutual"]) * 100

a_effect = ((a_aware_acc + mutual_acc) / 2) - ((blind_acc + b_aware_acc) / 2)
b_effect = ((b_aware_acc + mutual_acc) / 2) - ((blind_acc + a_aware_acc) / 2)
interaction = mutual_acc - a_aware_acc - b_aware_acc + blind_acc

pr(f"2x2 Analysis:")
pr(f"  blind={blind_acc:.1f}%  a_aware={a_aware_acc:.1f}%  b_aware={b_aware_acc:.1f}%  mutual={mutual_acc:.1f}%")
pr(f"  A-effect: {a_effect:+.1f}pp   B-effect: {b_effect:+.1f}pp   Interaction: {interaction:+.1f}pp")

if interaction > 2:
    pr(f"  >> SUPER-ADDITIVE (synergy)")
elif interaction < -2:
    pr(f"  >> SUB-ADDITIVE (redundancy)")
else:
    pr(f"  >> ADDITIVE")

pr(f"\n{'='*60}")
pr("Done.")
