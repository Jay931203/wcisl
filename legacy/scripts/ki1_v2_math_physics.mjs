/**
 * KI-1 v2: Mutual Cognitive Context Inference — Math + Physics Interdisciplinary
 *
 * Agent A (Tx): GPT-4o  — math/calculus expert
 * Agent B (Rx): GPT-4o-mini — physics/engineering expert
 *
 * 4 conditions × 15 problems, condition 4 has 3 rounds.
 */

import fs from "fs";

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY;

// ─── Pricing (per 1M tokens) ───
const PRICING = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

// ─── 15 Math-Physics Problems ───
const PROBLEMS = [
  {
    id: 1,
    question:
      "A projectile is launched at 45 degrees with initial velocity 20 m/s. Find the maximum range in meters. (g=10 m/s²)",
    answer: 40,
    domain: "mechanics",
  },
  {
    id: 2,
    question:
      "Find the sum of the eigenvalues of the matrix [[3,1],[1,3]].",
    answer: 6,
    domain: "linear algebra",
  },
  {
    id: 3,
    question:
      "A capacitor C=10μF is charged to 5V. Calculate the stored energy in μJ.",
    answer: 125,
    domain: "circuits",
  },
  {
    id: 4,
    question:
      "Solve the ODE dy/dx = 2xy with y(0)=1. Find y(1). Give the answer as e (use 2.718).",
    answer: 2.718,
    domain: "differential equations",
  },
  {
    id: 5,
    question:
      "A 2 kg mass on a spring (k=200 N/m) oscillates. Find the angular frequency ω in rad/s.",
    answer: 10,
    domain: "mechanics",
  },
  {
    id: 6,
    question:
      "Evaluate the definite integral of x² from 0 to 3.",
    answer: 9,
    domain: "calculus",
  },
  {
    id: 7,
    question:
      "An ideal gas at 300K is compressed adiabatically (γ=5/3) to 1/8 of its volume. Find the final temperature in Kelvin.",
    answer: 1200,
    domain: "thermodynamics",
  },
  {
    id: 8,
    question:
      "Find the determinant of the 3×3 matrix [[1,2,3],[0,1,4],[5,6,0]].",
    answer: 1,
    domain: "linear algebra",
  },
  {
    id: 9,
    question:
      "A series RL circuit has R=100Ω and L=0.5H. Find the time constant τ in milliseconds.",
    answer: 5,
    domain: "circuits",
  },
  {
    id: 10,
    question:
      "Find the gradient magnitude |∇f| of f(x,y)=x²+y² at the point (3,4).",
    answer: 10,
    domain: "calculus",
  },
  {
    id: 11,
    question:
      "A ball is dropped from 80 m. How long does it take to hit the ground in seconds? (g=10 m/s²)",
    answer: 4,
    domain: "mechanics",
  },
  {
    id: 12,
    question:
      "Compute the Laplace transform of f(t)=e^{-3t} evaluated at s=5. (i.e., F(5) where F(s)=1/(s+3))",
    answer: 0.125,
    domain: "differential equations",
  },
  {
    id: 13,
    question:
      "Two resistors of 6Ω and 3Ω are connected in parallel. Find the equivalent resistance in ohms.",
    answer: 2,
    domain: "circuits",
  },
  {
    id: 14,
    question:
      "Find the divergence of the vector field F=(x², y², z²) at the point (1,2,3).",
    answer: 12,
    domain: "calculus",
  },
  {
    id: 15,
    question:
      "A Carnot engine operates between 600K and 300K. What is its efficiency as a percentage?",
    answer: 50,
    domain: "thermodynamics",
  },
];

// ─── API Call ───
async function callOpenAI(model, messages, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: 2048,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429 && attempt < retries - 1) {
          const wait = (attempt + 1) * 5000;
          console.log(`  Rate limited, waiting ${wait / 1000}s...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw new Error(`API ${res.status}: ${errText}`);
      }

      const data = await res.json();
      return {
        content: data.choices[0].message.content,
        usage: data.usage,
      };
    } catch (e) {
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw e;
    }
  }
}

function computeCost(model, usage) {
  const p = PRICING[model];
  return (
    (usage.prompt_tokens * p.input) / 1e6 +
    (usage.completion_tokens * p.output) / 1e6
  );
}

function extractNumber(text) {
  // Try to find a number after common patterns
  const patterns = [
    /(?:final\s+answer|answer)\s*(?:is|:|=)\s*[≈≅~]*\s*([+-]?\d+\.?\d*)/i,
    /\\boxed\{([+-]?\d+\.?\d*)\}/,
    /\*\*([+-]?\d+\.?\d*)\*\*/,
    /(?:=\s*)([+-]?\d+\.?\d*)\s*(?:$|[.\s,;)}\]])/m,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseFloat(m[1]);
  }
  // Fallback: last number in text
  const nums = text.match(/[+-]?\d+\.?\d*/g);
  if (nums && nums.length > 0) return parseFloat(nums[nums.length - 1]);
  return null;
}

function gradeAnswer(extracted, truth) {
  if (extracted === null) return false;
  if (truth === 0) return Math.abs(extracted) < 0.01;
  return Math.abs(extracted - truth) / Math.abs(truth) <= 0.05;
}

// ─── Run a single problem through A→B pipeline ───
async function runProblem(problem, agentASystem, agentBSystem) {
  // Agent A explains
  const aMessages = [
    { role: "system", content: agentASystem },
    {
      role: "user",
      content: `Solve this problem and explain your solution:\n\n${problem.question}`,
    },
  ];
  const aResult = await callOpenAI("gpt-4o", aMessages);

  // Agent B extracts answer
  const bMessages = [
    { role: "system", content: agentBSystem },
    {
      role: "user",
      content: `Read the following explanation and extract the final numeric answer. Reply with ONLY the number.\n\nExplanation:\n${aResult.content}`,
    },
  ];
  const bResult = await callOpenAI("gpt-4o-mini", bMessages);

  const extracted = extractNumber(bResult.content);
  const correct = gradeAnswer(extracted, problem.answer);

  return {
    problemId: problem.id,
    truth: problem.answer,
    extracted,
    correct,
    aTokens: aResult.usage,
    bTokens: bResult.usage,
    aOutputTokens: aResult.usage.completion_tokens,
    aCost: computeCost("gpt-4o", aResult.usage),
    bCost: computeCost("gpt-4o-mini", bResult.usage),
    aResponse: aResult.content,
    bResponse: bResult.content,
  };
}

// Small delay between API calls
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Condition Runners ───
async function runCondition1_NoContext() {
  console.log("\n=== Condition 1: No Context ===");
  const agentA =
    "You are a helpful assistant. Solve the given math/physics problem step by step. Show your full work.";
  const agentB =
    "You are a helpful assistant. Extract the final numeric answer from the given explanation. Reply with ONLY the number.";
  const results = [];
  for (const p of PROBLEMS) {
    process.stdout.write(`  Problem ${p.id}...`);
    const r = await runProblem(p, agentA, agentB);
    console.log(` extracted=${r.extracted}, truth=${r.truth}, ${r.correct ? "OK" : "WRONG"}`);
    results.push(r);
    await delay(500);
  }
  return results;
}

async function runCondition2_OneWay() {
  console.log("\n=== Condition 2: One-Way Context ===");
  const agentA =
    "You are a math/calculus expert. The person receiving your explanation is a physics/engineering expert. Be concise — skip basic physics definitions they already know. Focus on the mathematical derivation and state the final answer clearly.";
  const agentB =
    "You are a physics and engineering expert. Extract the final numeric answer from the given explanation. Reply with ONLY the number.";
  const results = [];
  for (const p of PROBLEMS) {
    process.stdout.write(`  Problem ${p.id}...`);
    const r = await runProblem(p, agentA, agentB);
    console.log(` extracted=${r.extracted}, truth=${r.truth}, ${r.correct ? "OK" : "WRONG"}`);
    results.push(r);
    await delay(500);
  }
  return results;
}

async function runCondition3_Mutual() {
  console.log("\n=== Condition 3: Mutual Context ===");

  // B sends capability summary to A
  const bCapability = await callOpenAI("gpt-4o-mini", [
    {
      role: "system",
      content:
        "You are a physics and engineering expert with strong background in mechanics, circuits, thermodynamics, and signal processing. You are comfortable with standard calculus, linear algebra, and differential equations as used in engineering.",
    },
    {
      role: "user",
      content:
        "Briefly summarize your expertise and what mathematical notation/concepts you are comfortable with. Be concise (3-4 sentences).",
    },
  ]);

  console.log(`  B's capability summary: ${bCapability.content.slice(0, 120)}...`);

  const agentA = `You are a math/calculus expert. Your partner has described their expertise as follows:\n\n"${bCapability.content}"\n\nAdapt your explanation accordingly — skip what they know, elaborate only where needed. State the final numeric answer clearly.`;
  const agentB =
    "You are a physics and engineering expert. You know the explanation comes from a math/calculus expert. Extract the final numeric answer. Reply with ONLY the number.";

  const results = [];
  let extraCostA = computeCost("gpt-4o-mini", bCapability.usage); // capability call cost
  for (const p of PROBLEMS) {
    process.stdout.write(`  Problem ${p.id}...`);
    const r = await runProblem(p, agentA, agentB);
    console.log(` extracted=${r.extracted}, truth=${r.truth}, ${r.correct ? "OK" : "WRONG"}`);
    results.push(r);
    await delay(500);
  }
  // Add capability exchange cost to first result
  if (results.length > 0) results[0].extraCost = extraCostA;
  return results;
}

async function runCondition4_Progressive() {
  console.log("\n=== Condition 4: Progressive Inference (3 rounds) ===");
  const allRounds = [];

  let prevAResponses = [];
  let prevBResponses = [];

  for (let round = 1; round <= 3; round++) {
    console.log(`\n  --- Round ${round} ---`);

    let agentASystem, agentBSystem;

    if (round === 1) {
      agentASystem =
        "You are a helpful assistant. Solve the given math/physics problem step by step. Show your full work.";
      agentBSystem =
        "You are a helpful assistant. Extract the final numeric answer from the given explanation. Reply with ONLY the number.";
    } else {
      // Build inference from previous round
      const prevASample = prevAResponses
        .slice(0, 5)
        .map(
          (r, i) =>
            `Problem ${i + 1}: "${PROBLEMS[i].question}" → Response excerpt: "${r.slice(0, 200)}..."`
        )
        .join("\n");
      const prevBSample = prevBResponses
        .slice(0, 5)
        .map(
          (r, i) =>
            `Problem ${i + 1}: Response: "${r.slice(0, 100)}"`
        )
        .join("\n");

      agentASystem = `You are a math/calculus expert. Based on your partner's previous responses, infer their expertise level and adapt your explanations.\n\nPartner's previous responses:\n${prevBSample}\n\nBe efficient — if they seem competent in an area, be concise. State the final numeric answer clearly.`;
      agentBSystem = `You are a physics/engineering expert. Based on the explainer's previous responses, you can infer their style and expertise.\n\nExplainer's previous excerpts:\n${prevASample}\n\nExtract the final numeric answer. Reply with ONLY the number.`;
    }

    const results = [];
    const roundAResponses = [];
    const roundBResponses = [];

    for (const p of PROBLEMS) {
      process.stdout.write(`  R${round} P${p.id}...`);
      const r = await runProblem(p, agentASystem, agentBSystem);
      console.log(` extracted=${r.extracted}, truth=${r.truth}, ${r.correct ? "OK" : "WRONG"}`);
      results.push(r);
      roundAResponses.push(r.aResponse);
      roundBResponses.push(r.bResponse);
      await delay(500);
    }

    prevAResponses = roundAResponses;
    prevBResponses = roundBResponses;
    allRounds.push({ round, results });
  }

  return allRounds;
}

// ─── Aggregate stats ───
function summarize(results) {
  const correct = results.filter((r) => r.correct).length;
  const accuracy = correct / results.length;
  const aOutputTokens = results.reduce((s, r) => s + r.aOutputTokens, 0);
  const totalTokens = results.reduce(
    (s, r) =>
      s +
      r.aTokens.total_tokens +
      r.bTokens.total_tokens,
    0
  );
  const totalCost = results.reduce(
    (s, r) => s + r.aCost + r.bCost + (r.extraCost || 0),
    0
  );
  return {
    accuracy: `${correct}/${results.length} (${(accuracy * 100).toFixed(1)}%)`,
    accuracyPct: accuracy * 100,
    aOutputTokens,
    totalTokens,
    totalCost: `$${totalCost.toFixed(4)}`,
    totalCostNum: totalCost,
    correct,
    total: results.length,
  };
}

// ─── Main ───
async function main() {
  console.log("KI-1 v2: Math + Physics Interdisciplinary Experiment");
  console.log("=====================================================");
  console.log(`Problems: ${PROBLEMS.length}`);
  console.log(`Agent A: gpt-4o (math expert)`);
  console.log(`Agent B: gpt-4o-mini (physics expert)`);
  console.log(`Temperature: 0`);

  const c1 = await runCondition1_NoContext();
  const c2 = await runCondition2_OneWay();
  const c3 = await runCondition3_Mutual();
  const c4 = await runCondition4_Progressive();

  // Summarize
  const s1 = summarize(c1);
  const s2 = summarize(c2);
  const s3 = summarize(c3);

  const c4Summaries = c4.map((round) => ({
    round: round.round,
    ...summarize(round.results),
  }));

  // Print table
  console.log("\n\n========================================================");
  console.log("                    RESULTS SUMMARY");
  console.log("========================================================");
  console.log(
    "Condition                  | Accuracy     | A Output Tkn | Total Tkn | Cost"
  );
  console.log(
    "---------------------------|--------------|--------------|-----------|--------"
  );
  console.log(
    `1. No Context              | ${s1.accuracy.padEnd(12)} | ${String(s1.aOutputTokens).padEnd(12)} | ${String(s1.totalTokens).padEnd(9)} | ${s1.totalCost}`
  );
  console.log(
    `2. One-Way Context         | ${s2.accuracy.padEnd(12)} | ${String(s2.aOutputTokens).padEnd(12)} | ${String(s2.totalTokens).padEnd(9)} | ${s2.totalCost}`
  );
  console.log(
    `3. Mutual Context          | ${s3.accuracy.padEnd(12)} | ${String(s3.aOutputTokens).padEnd(12)} | ${String(s3.totalTokens).padEnd(9)} | ${s3.totalCost}`
  );
  for (const rs of c4Summaries) {
    console.log(
      `4. Progressive R${rs.round}          | ${rs.accuracy.padEnd(12)} | ${String(rs.aOutputTokens).padEnd(12)} | ${String(rs.totalTokens).padEnd(9)} | ${rs.totalCost}`
    );
  }

  // Token reduction analysis
  console.log("\n--- Token Reduction Analysis (Agent A output tokens) ---");
  const baseline = s1.aOutputTokens;
  console.log(`Baseline (No Context): ${baseline} tokens`);
  console.log(
    `One-Way:    ${s2.aOutputTokens} tokens (${(((baseline - s2.aOutputTokens) / baseline) * 100).toFixed(1)}% reduction)`
  );
  console.log(
    `Mutual:     ${s3.aOutputTokens} tokens (${(((baseline - s3.aOutputTokens) / baseline) * 100).toFixed(1)}% reduction)`
  );
  for (const rs of c4Summaries) {
    console.log(
      `Progr. R${rs.round}:  ${rs.aOutputTokens} tokens (${(((baseline - rs.aOutputTokens) / baseline) * 100).toFixed(1)}% reduction)`
    );
  }

  // Cost analysis
  console.log("\n--- Cost Analysis ---");
  const baselineCost = s1.totalCostNum;
  console.log(`Baseline (No Context): $${baselineCost.toFixed(4)}`);
  console.log(
    `One-Way:    $${s2.totalCostNum.toFixed(4)} (${(((baselineCost - s2.totalCostNum) / baselineCost) * 100).toFixed(1)}% savings)`
  );
  console.log(
    `Mutual:     $${s3.totalCostNum.toFixed(4)} (${(((baselineCost - s3.totalCostNum) / baselineCost) * 100).toFixed(1)}% savings)`
  );

  // Per-problem detail
  console.log("\n--- Per-Problem Accuracy (Conditions 1-3) ---");
  for (let i = 0; i < PROBLEMS.length; i++) {
    const p = PROBLEMS[i];
    console.log(
      `  P${String(p.id).padStart(2)}: [${c1[i].correct ? "OK" : "X "}] [${c2[i].correct ? "OK" : "X "}] [${c3[i].correct ? "OK" : "X "}] | truth=${p.truth} | domain=${p.domain}`
    );
  }

  // Save JSON
  const output = {
    experiment: "KI-1 v2: Math + Physics Interdisciplinary",
    timestamp: new Date().toISOString(),
    config: {
      agentA: "gpt-4o",
      agentB: "gpt-4o-mini",
      temperature: 0,
      problems: PROBLEMS.length,
      tolerance: "5%",
    },
    problems: PROBLEMS,
    conditions: {
      "1_no_context": {
        summary: s1,
        details: c1.map((r) => ({
          problemId: r.problemId,
          truth: r.truth,
          extracted: r.extracted,
          correct: r.correct,
          aOutputTokens: r.aOutputTokens,
          aCost: r.aCost,
          bCost: r.bCost,
        })),
      },
      "2_one_way": {
        summary: s2,
        details: c2.map((r) => ({
          problemId: r.problemId,
          truth: r.truth,
          extracted: r.extracted,
          correct: r.correct,
          aOutputTokens: r.aOutputTokens,
          aCost: r.aCost,
          bCost: r.bCost,
        })),
      },
      "3_mutual": {
        summary: s3,
        details: c3.map((r) => ({
          problemId: r.problemId,
          truth: r.truth,
          extracted: r.extracted,
          correct: r.correct,
          aOutputTokens: r.aOutputTokens,
          aCost: r.aCost,
          bCost: r.bCost,
        })),
      },
      "4_progressive": c4Summaries.map((rs, idx) => ({
        round: rs.round,
        summary: rs,
        details: c4[idx].results.map((r) => ({
          problemId: r.problemId,
          truth: r.truth,
          extracted: r.extracted,
          correct: r.correct,
          aOutputTokens: r.aOutputTokens,
          aCost: r.aCost,
          bCost: r.bCost,
        })),
      })),
    },
  };

  const outPath = "C:/Users/hyunj/wcisl/scripts/ki1_v2_results.json";
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
