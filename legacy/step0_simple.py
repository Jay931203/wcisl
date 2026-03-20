"""
Step 0: TinyLlama on simple info extraction tasks
No calculation - just "find the right number in the data"
"""
import torch
import time, re

# Avoid torchvision conflict
import sys
for mod in list(sys.modules.keys()):
    if 'torchvision' in mod:
        del sys.modules[mod]

from transformers import AutoModelForCausalLM, AutoTokenizer
import time, re

MODEL_ID = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
print(f"Loading {MODEL_ID}...")
t0 = time.time()
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch.float32)
print(f"Loaded in {time.time()-t0:.1f}s")

def chat(system, user):
    prompt = f"<|system|>\n{system}</s>\n<|user|>\n{user}</s>\n<|assistant|>\n"
    inputs = tokenizer(prompt, return_tensors="pt")
    t0 = time.time()
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=100, do_sample=False)
    elapsed = time.time() - t0
    response = tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    tokens = out.shape[1] - inputs["input_ids"].shape[1]
    return response.strip(), tokens, elapsed

# 5 simple problems - B just needs ONE number from the data
PROBLEMS = [
    {
        "id": 1,
        "data": "employees=120, revenue=5000000, profit=800000, offices=3, customers=45000, founded=2010",
        "b_question": "How many employees does the company have?",
        "answer": "120"
    },
    {
        "id": 2,
        "data": "temperature=32, humidity=65, wind_speed=15, pressure=1013, visibility=10, uv_index=7",
        "b_question": "What is the wind speed?",
        "answer": "15"
    },
    {
        "id": 3,
        "data": "students=5000, teachers=200, classrooms=150, budget=2000000, graduation_rate=92, sports_teams=15",
        "b_question": "What is the graduation rate?",
        "answer": "92"
    },
    {
        "id": 4,
        "data": "beds=300, doctors=80, nurses=200, patients_per_day=150, wait_time=25, satisfaction=4.2",
        "b_question": "How many doctors are there?",
        "answer": "80"
    },
    {
        "id": 5,
        "data": "price=45, quantity=1000, discount=10, shipping=5, tax=8, weight=2.5",
        "b_question": "What is the price?",
        "answer": "45"
    },
]

print("\n" + "=" * 50)
print("TEST 1: No Context - A summarizes, B extracts")
print("=" * 50)

a_sys = "Summarize the following data in 2-3 sentences."
b_sys = "Answer the question using only the information given. Reply with just the number."

nc_correct = 0
for p in PROBLEMS:
    a_resp, a_tok, a_time = chat(a_sys, p["data"])
    b_resp, b_tok, b_time = chat(b_sys, f"Information: {a_resp}\n\nQuestion: {p['b_question']}")

    nums = re.findall(r'[\d.]+', b_resp)
    got = nums[0] if nums else "none"
    ok = got == p["answer"]
    if ok: nc_correct += 1

    print(f"  P{p['id']}: A={a_tok}tok({a_time:.1f}s) B={got} expected={p['answer']} {'OK' if ok else 'FAIL'}")
    print(f"       A said: {a_resp[:120]}")

print(f"\nNo Context: {nc_correct}/5")

print("\n" + "=" * 50)
print("TEST 2: Mutual - B tells A what to send")
print("=" * 50)

a_sys_mut = "Send only the requested value. Reply with just: key=value"
mut_correct = 0
for p in PROBLEMS:
    # B가 필요한 key를 추출
    key = p["answer"]  # simplification
    question_key = p["b_question"].lower()

    a_resp, a_tok, a_time = chat(a_sys_mut,
        f"Data: {p['data']}\n\nThe recipient asks: {p['b_question']}")
    b_resp, b_tok, b_time = chat(b_sys,
        f"Information: {a_resp}\n\nQuestion: {p['b_question']}")

    nums = re.findall(r'[\d.]+', b_resp)
    got = nums[0] if nums else "none"
    ok = got == p["answer"]
    if ok: mut_correct += 1

    print(f"  P{p['id']}: A={a_tok}tok({a_time:.1f}s) B={got} expected={p['answer']} {'OK' if ok else 'FAIL'}")
    print(f"       A said: {a_resp[:120]}")

print(f"\nMutual: {mut_correct}/5")

print("\n" + "=" * 50)
print(f"SUMMARY: No Context={nc_correct}/5, Mutual={mut_correct}/5")
print("=" * 50)
