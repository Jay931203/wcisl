/**
 * KI-3 v2: Stage-Wise Model Switching in CoT — HARDER PROBLEMS
 *
 * v1 had problems that were too easy (simple arithmetic). Conditions 3 and 4
 * both got 100%. This version uses problems where:
 *   - Tx's compressed message is AMBIGUOUS without proper interpretation
 *   - Rx's decompress/interpret step actually adds value
 *   - Multi-step reasoning with intermediate results that can mislead
 *
 * 5 Conditions:
 *   A: All General (Tx free reasoning, Rx general)
 *   B: All Audience-Aware (Tx compressed, Rx interpret)
 *   C: Tx-Only Switch (Tx free→compress, Rx GENERAL)
 *   D: Both Switch (Tx free→compress, Rx INTERPRET→free)
 *   E: Reverse (Tx compress→free, Rx free→interpret)
 */

const OPENAI_API_KEY = "OPENAI_API_KEY_REDACTED";
const MODEL = "gpt-4o-mini";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 15 HARDER Problems: Multi-step reasoning with interpretation ──────────

const PROBLEMS = [
  // ── Category 1: Probability / Statistics (5 problems) ──────────────────
  {
    id: 1,
    category: "probability",
    problem: "A rare disease affects 1% of the population. A screening test has a 95% true positive rate (sensitivity) and a 95% true negative rate (specificity). If a randomly selected person tests positive, what is the probability (in percent, rounded to 1 decimal) that they actually have the disease?",
    answer: 16.1,
    tolerance: 0.5,
    notes: "Bayes theorem. Many people intuitively guess ~95%. P(D|+) = (0.01×0.95)/(0.01×0.95 + 0.99×0.05) = 0.0095/0.0590 ≈ 16.1%"
  },
  {
    id: 2,
    category: "probability",
    problem: "You have 3 coins: Coin A is fair (50% heads), Coin B has 75% heads, Coin C has 25% heads. You pick a coin uniformly at random and flip it 3 times, getting heads all 3 times. What is the probability (in percent, rounded to 1 decimal) that you picked Coin B?",
    answer: 62.8,
    tolerance: 1.0,
    notes: "Bayesian update. P(B|HHH) = P(HHH|B)P(B) / [P(HHH|A)P(A)+P(HHH|B)P(B)+P(HHH|C)P(C)] = (0.75^3)(1/3) / [(0.5^3)(1/3)+(0.75^3)(1/3)+(0.25^3)(1/3)] = 0.140625/0.22396 ≈ 62.8%"
  },
  {
    id: 3,
    category: "probability",
    problem: "A game show has 3 doors. Behind one is a car, behind the others are goats. You pick door 1. The host, who knows what's behind each door, opens door 3 to reveal a goat. You switch to door 2. Now, a SECOND game show uses 4 doors (1 car, 3 goats). You pick door 1, the host opens one goat door, and you switch to one of the 2 remaining doors. What is the probability of winning the car in the SECOND game, expressed as a fraction with denominator 8? Give the numerator.",
    answer: 3,
    tolerance: 0,
    notes: "Monty Hall with 4 doors. P(win by switching) = P(car not behind door 1) × P(pick correct among 2 remaining) = (3/4)(1/2) = 3/8. Numerator = 3."
  },
  {
    id: 4,
    category: "probability",
    problem: "In a group of 30 people, each person independently has a birthday on any of 365 days with equal probability. Using the approximation P(at least one shared birthday) ≈ 1 - e^(-n(n-1)/(2×365)), what is this probability in percent, rounded to the nearest integer?",
    answer: 71,
    tolerance: 1,
    notes: "n=30, n(n-1)/2=435, 435/365≈1.1918, e^(-1.1918)≈0.3040, 1-0.3040≈0.696→70% or with more precise calc ≈70-71%"
  },
  {
    id: 5,
    category: "probability",
    problem: "You roll two fair six-sided dice. Given that the sum is at least 8, what is the expected value of the sum? Give your answer rounded to 2 decimal places.",
    answer: 9.47,
    tolerance: 0.05,
    notes: "P(sum≥8): outcomes sum to 15 out of 36. E[S|S≥8] = (8×5+9×4+10×3+11×2+12×1)/15 = 142/15 ≈ 9.47"
  },

  // ── Category 2: Optimization with Constraints (5 problems) ─────────────
  {
    id: 6,
    category: "optimization",
    problem: "A farmer has 200 meters of fencing and wants to create a rectangular pen against a straight river (no fence needed on the river side). Inside the pen, he wants to add one fence parallel to the river to divide it into two equal sections. What is the maximum total area of the pen in square meters?",
    answer: 5000,
    tolerance: 0,
    notes: "Let x = side perpendicular to river (2 of them), y = side parallel to river. Constraint: 2x + 2y = 200 (two x-sides + y along river... wait, river side needs no fence, plus one internal divider parallel to river). Fencing: 2x + 2y = 200 → but there's a divider. Actually: 2x + y + y = 200 where one y is the far side and one y is the internal divider, but wait... river side has no fence. So fence = 2x + 2y = 200 (far side y + divider y + 2 sides x). A = xy. From constraint y=100-x. A=x(100-x), max at x=50, A=2500. WAIT let me recount. Sides: 2 widths of x, 1 length along opposite of river = y, 1 internal divider = y. Total fence = 2x+2y=200, so x+y=100. A=xy, max at x=y=50 → WAIT no. Actually we want to maximize A=xy with 2x+2y=200. But that gives y=(200-2x)/2=100-x, A=x(100-x), A'=100-2x=0 → x=50, y=50, A=2500. Hmm, but for a pen against a river with a divider: fence needed is 2 perpendicular sides (x each) + 1 far parallel side (y) + 1 internal parallel divider (y) = 2x+2y. OK so 2x+2y=200, A=xy, max at x=50, y=50, A=2500. Let me reconsider: Actually the standard problem with a divider has 3x+y or 2x+2y depending on divider orientation. Divider parallel to river means it has length y. So fence = 2x + y (far side) + y (divider) = 2x+2y = 200. Then A = xy with y=100-x, max A = 2500. Hmm but let me reconsider... maybe the fence along the river IS omitted, so: 2 perpendicular walls (x each), 1 wall parallel to river on the far side (y), 1 internal divider parallel to river (y). Total = 2x+2y=200, A=xy, max at x=50,y=50,A=2500. Actually I want to make this 5000. Let me redesign: if the divider is perpendicular to river, fence = 3x + y = 200 (3 perpendicular fences + 1 far side). A=xy, y=200-3x, A=x(200-3x), A'=200-6x=0, x=100/3, y=100, A=100·100/3=10000/3≈3333. OK let me just fix the answer."
  },
  {
    id: 7,
    category: "optimization",
    problem: "A manufacturer can produce at most 100 units per day. Each unit costs $20 to produce. The selling price p (in dollars) depends on quantity q: p = 120 - 0.5q. Find the quantity that maximizes daily profit. What is the maximum daily profit in dollars?",
    answer: 5000,
    tolerance: 0,
    notes: "Revenue R=pq=(120-0.5q)q=120q-0.5q^2. Cost=20q. Profit=100q-0.5q^2. dP/dq=100-q=0 → q=100. This satisfies q≤100. P(100)=100(100)-0.5(10000)=10000-5000=5000."
  },
  {
    id: 8,
    category: "optimization",
    problem: "A box with a square base and no top is made from 1200 cm² of cardboard. Let the base side be s cm and the height be h cm. The constraint is s² + 4sh = 1200. What is the maximum volume of the box in cubic centimeters?",
    answer: 4000,
    tolerance: 0,
    notes: "V=s²h, h=(1200-s²)/(4s), V=s(1200-s²)/4 = 300s - s³/4. dV/ds=300-3s²/4=0 → s²=400 → s=20, h=(1200-400)/80=10, V=20²×10=4000."
  },
  {
    id: 9,
    category: "optimization",
    problem: "A company makes two products X and Y. Product X needs 2 hours of labor and 1 kg of material. Product Y needs 1 hour of labor and 3 kg of material. Available: 100 hours of labor, 90 kg of material. Profit is $40 per X and $60 per Y. What is the maximum profit in dollars?",
    answer: 2760,
    tolerance: 0,
    notes: "LP: max 40x+60y s.t. 2x+y≤100, x+3y≤90, x,y≥0. Corner points: (0,0)→0, (50,0)→2000, (0,30)→1800. Intersection of 2x+y=100 and x+3y=90: from first y=100-2x, sub: x+3(100-2x)=90 → x+300-6x=90 → -5x=-210 → x=42, y=100-84=16. Profit=40(42)+60(16)=1680+960=2640. Wait let me recheck. x=42, y=16. 2(42)+16=100 ✓, 42+3(16)=42+48=90 ✓. P=40(42)+60(16)=1680+960=2640. Hmm, I said 2760, let me fix."
  },
  {
    id: 10,
    category: "optimization",
    problem: "You need to enclose a rectangular area of exactly 800 square meters using fencing that costs $10/meter for the two longer sides and $20/meter for the two shorter sides. What is the minimum total cost in dollars? Round to the nearest dollar.",
    answer: 1600,
    tolerance: 1,
    notes: "Let x=shorter side, y=longer side (y≥x). Area=xy=800 → y=800/x. Cost=2(20x)+2(10y)=40x+20(800/x)=40x+16000/x. dC/dx=40-16000/x²=0 → x²=400 → x=20, y=40. Cost=40(20)+16000/20=800+800=1600. Check y≥x: 40≥20 ✓."
  },

  // ── Category 3: Multi-step Logic (5 problems) ──────────────────────────
  {
    id: 11,
    category: "logic",
    problem: "A clock gains 5 minutes every hour. It is set correctly at 12:00 noon. What is the actual (real) time when this faulty clock shows 6:00 PM? Express your answer in minutes after noon.",
    answer: 332,
    tolerance: 1,
    notes: "The faulty clock runs at 65 min per real 60 min. When faulty clock shows 6pm, it shows 360 faulty-minutes past noon. Real time = 360 × (60/65) = 360 × 12/13 ≈ 332.3 minutes ≈ 5 hours 32.3 minutes → 332 minutes after noon."
  },
  {
    id: 12,
    category: "logic",
    problem: "A snail climbs a 30-meter well. Each day it climbs 5 meters, but each night it slips back 3 meters. However, once the snail reaches the top during the day, it escapes and doesn't slip back. On which day does the snail escape the well?",
    answer: 14,
    tolerance: 0,
    notes: "Net progress per full day-night cycle = 2m. After n full cycles, position = 2n meters. On day n+1, it needs to reach 30m. So we need 2n + 5 ≥ 30, meaning 2n ≥ 25, n ≥ 13 (after 13 nights at 26m). On day 14, climbs 5m to 31m ≥ 30m. Escapes on day 14."
  },
  {
    id: 13,
    category: "logic",
    problem: "Three friends A, B, C have a total of $600. First, A gives B and C as much money as each of them already has. Then B gives A and C as much as each of them now has. After these two transfers, all three have equal amounts. How much did A start with?",
    answer: 300,
    tolerance: 0,
    notes: "Work backwards. End: each has 200. Before B's transfer, B gave A and C what they had (doubling them). So before B's transfer: A had 100, C had 100, B had 400. Before A's transfer, A gave B and C what they had (doubling them). So before A's transfer: B had 200, C had 50... let me redo. Let a,b,c be starting. After A gives B and C their amounts: A→a-b-c, B→2b, C→2c. After B gives A and C their new amounts: A→2(a-b-c), B→2b-(a-b-c)-2c=3b-a-c, C→4c. Equal: 2(a-b-c)=3b-a-c=4c and a+b+c=600. From 2a-2b-2c=4c → 2a-2b=6c → a-b=3c. From 3b-a-c=4c → 3b-a=5c. Add: (a-b)+(3b-a)=3c+5c → 2b=8c → b=4c. Then a=b+3c=7c. a+b+c=7c+4c+c=12c=600 → c=50. a=350. Hmm. Let me recheck. Actually let me redefine: 'A gives B and C as much as each already has' = A gives B an amount equal to B's current holdings, and gives C an amount equal to C's current holdings. After step 1: A=a-b-c, B=2b, C=2c. Step 2: B gives A what A now has, and gives C what C now has. After step 2: A=2(a-b-c), B=2b-(a-b-c)-2c = 3b-a-c, C=4c. All equal and sum to 600 → each=200. 4c=200 → c=50. 2(a-b-c)=200 → a-b-c=100. a-b=150 (since c=50). 3b-a-c=200 → 3b-a=250. From a=b+150: 3b-(b+150)=250 → 2b=400 → b=200. a=350. Hmm a=350. Let me reconsider the problem statement — maybe it's A gives both B and C, then B gives both A and C. a=350, b=200, c=50. Check: After A: A=350-200-50=100, B=400, C=100. After B: B gives A 100 and C 100. A=200, C=200, B=400-100-100=200. ✓ So a=350."
  },
  {
    id: 14,
    category: "logic",
    problem: "A water tank is being filled by a tap and drained by a leak simultaneously. The tap alone fills the tank in 6 hours. With both the tap and leak operating, it takes 8 hours to fill the tank. Once the tank is full, the tap is turned off. How many hours does it take for the leak to empty the full tank?",
    answer: 24,
    tolerance: 0,
    notes: "Tap rate = 1/6 per hour. Combined rate = 1/8 per hour. Leak rate = 1/6 - 1/8 = 4/24 - 3/24 = 1/24 per hour. Time to drain = 24 hours."
  },
  {
    id: 15,
    category: "logic",
    problem: "A monkey is at the bottom of a 40-foot deep pit. Each morning it jumps up 6 feet, but by evening it gets tired and slides back down 2 feet. However, every 5th day (day 5, 10, 15, ...) it rains and the monkey slides back an extra 2 feet that evening (total 4 feet back on rainy days). On which day does the monkey escape the pit?",
    answer: 12,
    tolerance: 0,
    notes: "Day 1: +6-2=+4 → 4. Day 2: +4 → 8. Day 3: +4 → 12. Day 4: +4 → 16. Day 5 (rain): +6-4=+2 → 18. Day 6: +4 → 22. Day 7: +4 → 26. Day 8: +4 → 30. Day 9: +4 → 34. Day 10 (rain): starts at 34, jumps to 40 → ESCAPED during the day on day 10! Wait: 34+6=40, that's exactly the top. Let me recheck whether it escapes at 40 or needs >40. 'escapes the pit' at 40 feet. So day 10 morning it jumps to 40 and escapes before sliding. Answer: 10. Hmm but let me re-verify carefully. After day 1 evening: 4. After day 2: 8. Day 3: 12. Day 4: 16. Day 5 (rain): morning 16+6=22, NOT ≥40, evening 22-4=18. Day 6: morning 24, evening 22. Day 7: morning 28, evening 26. Day 8: morning 32, evening 30. Day 9: morning 36, evening 34. Day 10 (rain): morning 34+6=40 → ESCAPED! Answer: 10."
  }
];

// Fix the answers based on the corrected notes above:
PROBLEMS[0].answer = 16.1;   // Bayes theorem
PROBLEMS[0].tolerance = 0.5;
PROBLEMS[2].answer = 3;      // Monty Hall 4 doors, numerator of 3/8
PROBLEMS[3].answer = 71;     // Birthday approximation
PROBLEMS[4].answer = 9.47;   // Conditional expected value
PROBLEMS[5].answer = 2500;   // Farmer with river + divider: 2x+2y=200, A=xy, max 2500
PROBLEMS[5].notes = "Divider parallel to river. Fence = 2x + 2y = 200 (2 perp sides + far side + divider). A=xy, y=100-x, max at x=50, y=50, A=2500.";
PROBLEMS[8].answer = 2640;   // LP corrected
PROBLEMS[8].notes = "LP: x=42, y=16. P=40(42)+60(16)=2640.";
PROBLEMS[10].answer = 332;
PROBLEMS[10].tolerance = 2;
PROBLEMS[12].answer = 350;   // Money transfer corrected
PROBLEMS[12].notes = "Work forward: a=350,b=200,c=50. After A: (100,400,100). After B gives each what they have: (200,200,200). ✓";
PROBLEMS[14].answer = 10;    // Monkey with rain corrected
PROBLEMS[14].notes = "After d9 evening: 34. Day 10 morning: 34+6=40 → escaped on day 10.";

// ─── Prompt Templates ──────────────────────────────────────────────────────

const PROMPT_FREE_REASONING = (problem, stageNum, prevWork) => {
  let msg = `You are solving a challenging math/probability/logic problem step by step.\n\n`;
  if (prevWork) msg += `Previous work:\n${prevWork}\n\n`;
  msg += `Problem: ${problem}\n\n`;
  msg += `This is stage ${stageNum} of 3. `;
  if (stageNum === 1) msg += `Carefully identify all given information, note any tricky conditions, and set up the mathematical framework (equations, probability trees, constraints, etc.). Do NOT skip steps.`;
  else if (stageNum === 2) msg += `Perform the main calculations. Show every intermediate step. Double-check any non-obvious steps.`;
  else msg += `Finalize the solution. State the final numeric answer clearly. Verify it makes sense given the problem constraints.`;
  msg += `\n\nThink carefully and show your full reasoning. These problems have common traps — watch out for them.`;
  return msg;
};

const PROMPT_AUDIENCE_AWARE = (problem, stageNum, prevWork) => {
  let msg = `You are solving a challenging math/probability/logic problem. Your output will be read by an expert Rx agent who fluently reads compressed mathematical notation.\n\n`;
  if (prevWork) msg += `Previous work:\n${prevWork}\n\n`;
  msg += `Problem: ${problem}\n\n`;
  msg += `Stage ${stageNum}/3. `;
  if (stageNum === 1) msg += `Identify key info, set up framework.`;
  else if (stageNum === 2) msg += `Core calculations.`;
  else msg += `State final numeric answer.`;
  msg += `\n\nBe EXTREMELY concise. Use dense math notation, abbreviations, symbolic shorthand. Skip ALL obvious steps. Your Rx is a math PhD — they can fill in gaps. Minimize tokens aggressively. Use formats like: "P(D|+)=P(+|D)P(D)/P(+)" rather than spelling out Bayes theorem. Use arrows, semicolons, abbreviations freely.`;
  return msg;
};

const PROMPT_COMPRESS_STAGE3 = (problem, prevWork) => {
  return `You solved a problem in stages 1-2. Now COMPRESS your full solution into a MINIMAL message for a math-expert Rx agent.

Problem: ${problem}

Your full solution so far:
${prevWork}

COMPRESSION RULES:
- Use dense mathematical notation (symbols, arrows, no English prose)
- Use abbreviations: P() for probability, E[] for expected value, s.t. for subject to
- Chain calculations with arrows: "P(D|+)=0.0095/0.059→16.1%"
- Omit all obvious intermediate algebra
- Use semicolons to separate distinct steps
- Include the final numeric value but embed it within the compressed notation (do NOT put it on a separate line)
- Goal: the message should be <50 tokens if possible

Compress now:`;
};

const PROMPT_RX_GENERAL = (problem, txMessage) => {
  return `You receive a message from another agent who solved a math problem. Produce the final numeric answer.

Original problem: ${problem}

Agent's message:
${txMessage}

Extract the final numeric answer. Output ONLY the numeric answer (a single number, no units, no explanation, no text).`;
};

const PROMPT_RX_INTERPRET = (problem, txMessage) => {
  return `You are an expert mathematical Rx agent. You receive a COMPRESSED message from a Tx agent who used dense notation, symbols, and abbreviations to save tokens. Your job is to DECOMPRESS and INTERPRET this message.

Original problem: ${problem}

Compressed message from Tx:
${txMessage}

Step-by-step decompression:
1. Identify each abbreviated expression and expand it
2. Verify each calculation step is correct
3. Check that the mathematical approach is valid for this problem type
4. If multiple numbers appear, determine which is the FINAL answer to the original question
5. If you detect any error in the Tx's reasoning, correct it

Show your decompression and verification, then state the final numeric answer.`;
};

const PROMPT_RX_FINAL_FREE = (problem, decompressed) => {
  return `Based on your analysis below, provide the final numeric answer to this problem.

Problem: ${problem}

Your analysis:
${decompressed}

Output ONLY the final numeric answer (a single number, no units, no text).`;
};

const PROMPT_RX_FINAL_INTERPRET = (problem, freeReasoning) => {
  return `You are an expert mathematical interpreter. Given the reasoning below, extract and verify the final numeric answer.

Problem: ${problem}

Reasoning:
${freeReasoning}

Verify the answer is correct for the given problem, then output ONLY the final numeric answer (a single number).`;
};

// ─── API Call ────────────────────────────────────────────────────────────────

const COST_PER_1K_INPUT = 0.00015;
const COST_PER_1K_OUTPUT = 0.0006;

async function callLLM(prompt) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 1500
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const choice = data.choices[0];
  return {
    content: choice.message.content,
    input_tokens: data.usage.prompt_tokens,
    output_tokens: data.usage.completion_tokens,
    total_tokens: data.usage.total_tokens
  };
}

function computeCost(input_tokens, output_tokens) {
  return (input_tokens / 1000) * COST_PER_1K_INPUT + (output_tokens / 1000) * COST_PER_1K_OUTPUT;
}

function countTokensApprox(text) {
  return Math.round(text.split(/[\s]+/).length * 1.33);
}

// ─── Condition Runners ───────────────────────────────────────────────────────

async function runConditionA(problem) {
  // All General: Tx 3 stages free reasoning, Rx general
  let totalIn = 0, totalOut = 0;
  let prevWork = "";

  for (let stage = 1; stage <= 3; stage++) {
    const prompt = PROMPT_FREE_REASONING(problem.problem, stage, prevWork || undefined);
    const res = await callLLM(prompt);
    totalIn += res.input_tokens;
    totalOut += res.output_tokens;
    prevWork = (prevWork ? prevWork + "\n\n" : "") + res.content;
  }

  const txMessage = prevWork;
  const msgTokens = countTokensApprox(txMessage);

  const rxRes = await callLLM(PROMPT_RX_GENERAL(problem.problem, txMessage));
  totalIn += rxRes.input_tokens;
  totalOut += rxRes.output_tokens;

  return { txMessage, rxAnswer: rxRes.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokens };
}

async function runConditionB(problem) {
  // All Audience-Aware: Tx 3 stages compressed, Rx interpret + free
  let totalIn = 0, totalOut = 0;
  let prevWork = "";

  for (let stage = 1; stage <= 3; stage++) {
    const prompt = PROMPT_AUDIENCE_AWARE(problem.problem, stage, prevWork || undefined);
    const res = await callLLM(prompt);
    totalIn += res.input_tokens;
    totalOut += res.output_tokens;
    prevWork = (prevWork ? prevWork + "\n\n" : "") + res.content;
  }

  const txMessage = prevWork;
  const msgTokens = countTokensApprox(txMessage);

  // Rx: interpret/decompress, then finalize
  const rxDecomp = await callLLM(PROMPT_RX_INTERPRET(problem.problem, txMessage));
  totalIn += rxDecomp.input_tokens;
  totalOut += rxDecomp.output_tokens;

  const rxFinal = await callLLM(PROMPT_RX_FINAL_FREE(problem.problem, rxDecomp.content));
  totalIn += rxFinal.input_tokens;
  totalOut += rxFinal.output_tokens;

  return { txMessage, rxAnswer: rxFinal.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokens };
}

async function runConditionC(problem) {
  // Tx-Only Switch: Tx stages 1-2 free, stage 3 COMPRESS. Rx GENERAL (no interpret).
  let totalIn = 0, totalOut = 0;
  let prevWork = "";

  for (let stage = 1; stage <= 2; stage++) {
    const prompt = PROMPT_FREE_REASONING(problem.problem, stage, prevWork || undefined);
    const res = await callLLM(prompt);
    totalIn += res.input_tokens;
    totalOut += res.output_tokens;
    prevWork = (prevWork ? prevWork + "\n\n" : "") + res.content;
  }

  // Stage 3: compress
  const compRes = await callLLM(PROMPT_COMPRESS_STAGE3(problem.problem, prevWork));
  totalIn += compRes.input_tokens;
  totalOut += compRes.output_tokens;

  const txMessage = compRes.content;
  const msgTokens = countTokensApprox(txMessage);

  // Rx: GENERAL (no decompression — just extract number)
  const rxRes = await callLLM(PROMPT_RX_GENERAL(problem.problem, txMessage));
  totalIn += rxRes.input_tokens;
  totalOut += rxRes.output_tokens;

  return { txMessage, rxAnswer: rxRes.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokens };
}

async function runConditionD(problem) {
  // Both Switch: Tx stages 1-2 free, stage 3 COMPRESS. Rx stage 1 INTERPRET, stage 2 FREE.
  let totalIn = 0, totalOut = 0;
  let prevWork = "";

  for (let stage = 1; stage <= 2; stage++) {
    const prompt = PROMPT_FREE_REASONING(problem.problem, stage, prevWork || undefined);
    const res = await callLLM(prompt);
    totalIn += res.input_tokens;
    totalOut += res.output_tokens;
    prevWork = (prevWork ? prevWork + "\n\n" : "") + res.content;
  }

  // Stage 3: compress
  const compRes = await callLLM(PROMPT_COMPRESS_STAGE3(problem.problem, prevWork));
  totalIn += compRes.input_tokens;
  totalOut += compRes.output_tokens;

  const txMessage = compRes.content;
  const msgTokens = countTokensApprox(txMessage);

  // Rx stage 1: INTERPRET/DECOMPRESS
  const rxDecomp = await callLLM(PROMPT_RX_INTERPRET(problem.problem, txMessage));
  totalIn += rxDecomp.input_tokens;
  totalOut += rxDecomp.output_tokens;

  // Rx stage 2: FREE reasoning to finalize
  const rxFinal = await callLLM(PROMPT_RX_FINAL_FREE(problem.problem, rxDecomp.content));
  totalIn += rxFinal.input_tokens;
  totalOut += rxFinal.output_tokens;

  return { txMessage, rxAnswer: rxFinal.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokens };
}

async function runConditionE(problem) {
  // Reverse: Tx stage 1 COMPRESS, stages 2-3 FREE. Rx stage 1 FREE, stage 2 INTERPRET.
  let totalIn = 0, totalOut = 0;

  // Tx stage 1: audience-aware/compressed
  const s1 = await callLLM(PROMPT_AUDIENCE_AWARE(problem.problem, 1, undefined));
  totalIn += s1.input_tokens;
  totalOut += s1.output_tokens;
  let prevWork = s1.content;

  // Tx stages 2-3: free reasoning
  for (let stage = 2; stage <= 3; stage++) {
    const prompt = PROMPT_FREE_REASONING(problem.problem, stage, prevWork);
    const res = await callLLM(prompt);
    totalIn += res.input_tokens;
    totalOut += res.output_tokens;
    prevWork = prevWork + "\n\n" + res.content;
  }

  const txMessage = prevWork;
  const msgTokens = countTokensApprox(txMessage);

  // Rx stage 1: general extract
  const rxFree = await callLLM(PROMPT_RX_GENERAL(problem.problem, txMessage));
  totalIn += rxFree.input_tokens;
  totalOut += rxFree.output_tokens;

  // Rx stage 2: interpret/verify
  const rxInterp = await callLLM(PROMPT_RX_FINAL_INTERPRET(problem.problem, rxFree.content));
  totalIn += rxInterp.input_tokens;
  totalOut += rxInterp.output_tokens;

  return { txMessage, rxAnswer: rxInterp.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokens };
}

// ─── Answer Extraction & Grading ─────────────────────────────────────────────

function extractNumber(text) {
  const cleaned = text.trim().replace(/,/g, "").replace(/\$/g, "").replace(/%/g, "");
  // Try to find numbers, prefer the last one (usually the final answer)
  const matches = cleaned.match(/-?\d+\.?\d*/g);
  if (!matches) return null;
  return parseFloat(matches[matches.length - 1]);
}

function checkAccuracy(rxAnswer, groundTruth, tolerance) {
  const extracted = extractNumber(rxAnswer);
  if (extracted === null) return false;
  const tol = tolerance !== undefined ? tolerance : Math.abs(groundTruth) * 0.05;
  return Math.abs(extracted - groundTruth) <= tol + 0.001;
}

// ─── Main Experiment ─────────────────────────────────────────────────────────

const CONDITIONS = [
  { name: "A: All General", key: "A", runner: runConditionA },
  { name: "B: All Audience-Aware", key: "B", runner: runConditionB },
  { name: "C: Tx-Only Switch", key: "C", runner: runConditionC },
  { name: "D: Both Switch (Paper)", key: "D", runner: runConditionD },
  { name: "E: Reverse Switch", key: "E", runner: runConditionE },
];

async function main() {
  console.log("=== KI-3 v2: Stage-Wise Model Switching — HARDER PROBLEMS ===\n");
  console.log(`Model: ${MODEL} | Temperature: 0 | Problems: ${PROBLEMS.length}`);
  console.log(`Categories: Probability(5), Optimization(5), Logic(5)`);
  console.log(`Conditions: ${CONDITIONS.length}\n`);

  const allResults = {};
  const perProblemAllConditions = {};

  for (const cond of CONDITIONS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`--- Running Condition ${cond.name} ---`);
    console.log("=".repeat(60));
    const results = [];
    let correct = 0;
    let totalMsgTokens = 0;
    let totalAllTokensIn = 0;
    let totalAllTokensOut = 0;

    for (const prob of PROBLEMS) {
      process.stdout.write(`  P${String(prob.id).padStart(2,"0")} [${prob.category.padEnd(12)}] ...`);
      try {
        const res = await cond.runner(prob);
        const isCorrect = checkAccuracy(res.rxAnswer, prob.answer, prob.tolerance);
        if (isCorrect) correct++;
        totalMsgTokens += res.messageTokens;
        totalAllTokensIn += res.totalInputTokens;
        totalAllTokensOut += res.totalOutputTokens;

        const extracted = extractNumber(res.rxAnswer);
        results.push({
          problemId: prob.id,
          category: prob.category,
          groundTruth: prob.answer,
          rxRawAnswer: res.rxAnswer.trim(),
          extractedAnswer: extracted,
          correct: isCorrect,
          messageTokens: res.messageTokens,
          txMessage: res.txMessage,
          totalInputTokens: res.totalInputTokens,
          totalOutputTokens: res.totalOutputTokens,
        });

        const mark = isCorrect ? "OK" : "WRONG";
        console.log(` ${mark.padEnd(5)} got=${extracted}, expected=${prob.answer} | msg=${res.messageTokens}tok`);
      } catch (e) {
        console.log(` ERROR: ${e.message.slice(0, 80)}`);
        results.push({
          problemId: prob.id,
          category: prob.category,
          groundTruth: prob.answer,
          rxRawAnswer: "ERROR",
          extractedAnswer: null,
          correct: false,
          messageTokens: 0,
          txMessage: "",
          totalInputTokens: 0,
          totalOutputTokens: 0,
          error: e.message
        });
      }
    }

    const accuracy = correct / PROBLEMS.length;
    const avgMsgTokens = totalMsgTokens / PROBLEMS.length;
    const totalCost = computeCost(totalAllTokensIn, totalAllTokensOut);
    const efficiency = avgMsgTokens > 0 ? accuracy / avgMsgTokens : 0;

    allResults[cond.key] = {
      conditionName: cond.name,
      results,
      summary: {
        accuracy_pct: Math.round(accuracy * 1000) / 10,
        correct,
        total: PROBLEMS.length,
        avgMessageTokens: Math.round(avgMsgTokens),
        totalInputTokens: totalAllTokensIn,
        totalOutputTokens: totalAllTokensOut,
        totalTokens: totalAllTokensIn + totalAllTokensOut,
        totalCost: Math.round(totalCost * 100000) / 100000,
        efficiency: Math.round(efficiency * 100000) / 100000
      }
    };

    console.log(`\n  => Accuracy: ${correct}/${PROBLEMS.length} (${(accuracy * 100).toFixed(1)}%) | Avg msg tokens: ${Math.round(avgMsgTokens)} | Cost: $${totalCost.toFixed(5)}`);
  }

  // ─── Detailed Per-Problem Breakdown ────────────────────────────────────
  console.log("\n\n" + "=".repeat(70));
  console.log("PER-PROBLEM BREAKDOWN");
  console.log("=".repeat(70));

  for (const prob of PROBLEMS) {
    console.log(`\nP${prob.id} [${prob.category}]: ${prob.problem.slice(0, 80)}...`);
    console.log(`  Ground truth: ${prob.answer} (tolerance: ±${prob.tolerance !== undefined ? prob.tolerance : prob.answer * 0.05})`);
    for (const cond of CONDITIONS) {
      const r = allResults[cond.key].results.find(r => r.problemId === prob.id);
      const status = r.correct ? "OK   " : "WRONG";
      console.log(`    ${cond.key}: ${status} | extracted=${r.extractedAnswer} | msg_tokens=${r.messageTokens}`);
    }
  }

  // ─── Category Breakdown ────────────────────────────────────────────────
  console.log("\n\n" + "=".repeat(70));
  console.log("CATEGORY BREAKDOWN");
  console.log("=".repeat(70));

  const categories = ["probability", "optimization", "logic"];
  for (const cat of categories) {
    console.log(`\n--- ${cat.toUpperCase()} ---`);
    const catProblems = PROBLEMS.filter(p => p.category === cat);
    for (const cond of CONDITIONS) {
      const catResults = allResults[cond.key].results.filter(r => r.category === cat);
      const catCorrect = catResults.filter(r => r.correct).length;
      console.log(`  ${cond.key}: ${catCorrect}/${catProblems.length} (${((catCorrect/catProblems.length)*100).toFixed(0)}%)`);
    }
  }

  // ─── Print Summary Table ──────────────────────────────────────────────
  console.log("\n\n" + "=".repeat(70));
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(70));
  console.log("\nCondition                   | Accuracy | Correct | Msg Tokens | Total Tokens | Cost ($)  | Efficiency");
  console.log("----------------------------|----------|---------|------------|--------------|-----------|----------");
  for (const cond of CONDITIONS) {
    const s = allResults[cond.key].summary;
    console.log(
      `${cond.name.padEnd(28)}| ${(s.accuracy_pct + "%").padEnd(9)}| ${(s.correct + "/" + s.total).padEnd(8)}| ${String(s.avgMessageTokens).padEnd(11)}| ${String(s.totalTokens).padEnd(13)}| $${s.totalCost.toFixed(5).padEnd(8)}| ${s.efficiency.toFixed(5)}`
    );
  }

  // ─── Key Comparison: C vs D ────────────────────────────────────────────
  console.log("\n\n--- KEY COMPARISON: C (Tx compress, Rx general) vs D (Tx compress, Rx interpret) ---");
  const cAcc = allResults["C"].summary.accuracy_pct;
  const dAcc = allResults["D"].summary.accuracy_pct;
  const diff = dAcc - cAcc;
  console.log(`  C accuracy: ${cAcc}%`);
  console.log(`  D accuracy: ${dAcc}%`);
  console.log(`  Difference (D-C): ${diff > 0 ? "+" : ""}${diff.toFixed(1)} percentage points`);
  console.log(`  ${diff > 0 ? "Rx INTERPRET mode helps!" : diff < 0 ? "Rx GENERAL mode was better (unexpected)" : "No difference (problems may still be too easy)"}`);

  // Problems where C and D differ
  console.log("\n  Problems where C and D DIFFER:");
  for (const prob of PROBLEMS) {
    const cR = allResults["C"].results.find(r => r.problemId === prob.id);
    const dR = allResults["D"].results.find(r => r.problemId === prob.id);
    if (cR.correct !== dR.correct) {
      console.log(`    P${prob.id}: C=${cR.correct ? "OK" : "WRONG"}(${cR.extractedAnswer}) D=${dR.correct ? "OK" : "WRONG"}(${dR.extractedAnswer}) truth=${prob.answer}`);
    }
  }

  // ─── Save JSON ────────────────────────────────────────────────────────
  const outputData = {
    metadata: {
      experiment: "KI-3 v2: Stage-Wise Model Switching (Harder Problems)",
      model: MODEL,
      temperature: 0,
      date: new Date().toISOString(),
      numProblems: PROBLEMS.length,
      numConditions: CONDITIONS.length,
      categories: ["probability", "optimization", "logic"],
    },
    problems: PROBLEMS.map(p => ({
      id: p.id,
      category: p.category,
      problem: p.problem,
      answer: p.answer,
      tolerance: p.tolerance,
      notes: p.notes
    })),
    conditions: allResults,
    summary: {
      conditionAccuracies: Object.fromEntries(CONDITIONS.map(c => [c.key, allResults[c.key].summary.accuracy_pct])),
      conditionMsgTokens: Object.fromEntries(CONDITIONS.map(c => [c.key, allResults[c.key].summary.avgMessageTokens])),
      keyComparison_C_vs_D: {
        C_accuracy: cAcc,
        D_accuracy: dAcc,
        difference: diff,
        interpretation: diff > 0 ? "Rx interpret mode improves accuracy on compressed messages" : "No significant difference"
      }
    }
  };

  const jsonPath = path.join(__dirname, "ki3_v2_results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(outputData, null, 2));
  console.log(`\nResults saved to ${jsonPath}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
