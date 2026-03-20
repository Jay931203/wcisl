"""
Step 0: Base model test on CPU (3 problems quick test)
Model: Qwen2.5-1.5B-Instruct (no auth needed, small enough for CPU)
"""
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import time, re

MODEL_ID = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"

print(f"Loading {MODEL_ID} on CPU...")
t0 = time.time()
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch.float32)
print(f"Loaded in {time.time()-t0:.1f}s")

def generate(system, user, max_new_tokens=256):
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(text, return_tensors="pt")
    t0 = time.time()
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
    elapsed = time.time() - t0
    response = tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    gen_tokens = out.shape[1] - inputs["input_ids"].shape[1]
    return response, gen_tokens, elapsed

# 3문제만 빠르게 테스트
PROBLEMS = [
    {
        "id": 1, "domain": "Finance",
        "data": "Revenue=$12M, COGS=$7.2M, SGA=$1.8M, RnD=$600K, Interest=$400K, Tax_Rate=28%, Depreciation=$500K, Total_Assets=$25M, Current_Assets=$8M, Fixed_Assets=$15M, Current_Liabilities=$5M, LongTerm_Debt=$8M, Equity=$12M, Shares=2M, Dividends=$600K, CapEx=$1.5M, Cash=$1.5M",
        "b_task": "Debt-to-Equity Ratio = LongTerm_Debt / Equity",
        "b_needs": "LongTerm_Debt=$8M, Equity=$12M",
        "answer": 0.667
    },
    {
        "id": 2, "domain": "Healthcare",
        "data": "Beds=500, Occupancy=78%, Avg_Stay=4.2days, Admissions=3400/month, ER_Visits=8500/month, Surgery=600/month, Outpatient=12000/month, Doctors=200, Nurses=600, Admin=150, Budget=$50M/month, Revenue=$55M/month, Readmission=8%, Mortality=1.2%, Infection=0.5%, Wait_ER=45min",
        "b_task": "Bed_Turnover_Rate = Admissions / Beds",
        "b_needs": "Admissions=3400, Beds=500",
        "answer": 6.8
    },
    {
        "id": 3, "domain": "Demographics",
        "data": "Population=850000, Area=350km2, Growth=1.8%, Median_Age=34, Under18=22%, Over65=14%, Income=$52000, Unemployment=5.5%, Poverty=12%, College=38%, Homeownership=55%, Rent=$1200, Crime=4.2/1000, Schools=120, Hospitals=8, Parks=45, Transit=150000/day",
        "b_task": "People_Over_65 = Population * Over65_Pct",
        "b_needs": "Population=850000, Over65=14%",
        "answer": 119000
    },
]

# --- Test 1: No Context ---
print("\n" + "=" * 50)
print("No Context (A: general summary)")
print("=" * 50)

a_system = "You are a data analyst. Summarize the key findings from this data. Be comprehensive."
b_system = "Using ONLY the data summary, compute the answer. Output ONLY the number."

for p in PROBLEMS:
    print(f"\nP{p['id']} ({p['domain']}):")

    # A generates summary
    a_resp, a_tok, a_time = generate(a_system, f"Dataset:\n{p['data']}", max_new_tokens=256)
    print(f"  A: {a_tok} tokens, {a_time:.1f}s")
    print(f"  A output: {a_resp[:150]}...")

    # B computes from summary
    b_resp, b_tok, b_time = generate(b_system, f"Summary:\n{a_resp}\n\nTask: {p['b_task']}", max_new_tokens=50)
    nums = re.findall(r'-?[\d,]+\.?\d*', b_resp.replace(',', ''))
    b_ans = float(nums[0]) if nums else -999
    expected = p["answer"]
    ok = abs(b_ans - expected) / max(abs(expected), 1e-9) < 0.10
    print(f"  B: {b_ans} (expected {expected}) {'OK' if ok else 'FAIL'} ({b_time:.1f}s)")

# --- Test 2: Mutual ---
print("\n" + "=" * 50)
print("Mutual (B requests specific data)")
print("=" * 50)

a_system_mut = "Send ONLY the requested data as key=value. Nothing else."

for p in PROBLEMS:
    print(f"\nP{p['id']} ({p['domain']}):")

    a_resp, a_tok, a_time = generate(a_system_mut, f"Dataset:\n{p['data']}\n\nRequest: I need {p['b_needs']}", max_new_tokens=50)
    print(f"  A: {a_tok} tokens, {a_time:.1f}s")
    print(f"  A output: {a_resp[:150]}")

    b_resp, b_tok, b_time = generate(b_system, f"Data:\n{a_resp}\n\nTask: {p['b_task']}", max_new_tokens=50)
    nums = re.findall(r'-?[\d,]+\.?\d*', b_resp.replace(',', ''))
    b_ans = float(nums[0]) if nums else -999
    expected = p["answer"]
    ok = abs(b_ans - expected) / max(abs(expected), 1e-9) < 0.10
    print(f"  B: {b_ans} (expected {expected}) {'OK' if ok else 'FAIL'} ({b_time:.1f}s)")

print("\n" + "=" * 50)
print("DONE. Check times above to estimate full 15-problem run.")
print("=" * 50)
