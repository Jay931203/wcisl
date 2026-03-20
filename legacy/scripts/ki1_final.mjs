// KI-1 Final Experiment: Two-Agent Knowledge Interface
// Agent A (GPT-4o): Statistics expert → intermediate numeric value
// Agent B (GPT-4o-mini): Operations expert → final numeric answer using A's value
// 4 Conditions: No Context, One-Way, Mutual, Progressive (3 rounds)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error("Set OPENAI_API_KEY env var"); process.exit(1); }

const PROBLEMS = [
  {
    id: 1,
    a_prompt: "200 samples were tested and 7 were defective. Compute the defect rate as a decimal. Output ONLY the numeric value.",
    a_expected: 0.035,
    b_prompt_template: (aVal) => `Agent A computed the defect rate: ${aVal}. If 5000 units are produced and each defect costs $800, compute the expected defect cost. Output ONLY the numeric value.`,
    b_expected: 140000,
    desc: "Defect rate → expected cost"
  },
  {
    id: 2,
    a_prompt: "A machine has 92% uptime over 100 days. Compute the downtime rate as a decimal. Output ONLY the numeric value.",
    a_expected: 0.08,
    b_prompt_template: (aVal) => `Agent A computed the downtime rate: ${aVal}. If downtime costs $5000/day, compute the annual downtime cost (365 days). Output ONLY the numeric value.`,
    b_expected: 146000,
    desc: "Downtime rate → annual cost"
  },
  {
    id: 3,
    a_prompt: "500 items were tested and 12 failed. Compute the failure rate as a percentage. Output ONLY the numeric value (e.g. 2.4).",
    a_expected: 2.4,
    b_prompt_template: (aVal) => `Agent A computed the failure rate: ${aVal}%. The recall threshold is 3%. If the rate exceeds 3%, recall cost is $50/unit on 20000 units. If not, cost is 0. Compute the recall cost. Output ONLY the numeric value.`,
    b_expected: 0,
    desc: "Fail rate → recall cost (threshold)"
  },
  {
    id: 4,
    a_prompt: "A process has mean=10.2, std=0.3, upper spec limit=10.8. Using the normal distribution, compute the percentage of items out of spec (above 10.8). Output ONLY the numeric value (e.g. 2.28).",
    a_expected: 2.28,
    b_prompt_template: (aVal) => `Agent A computed that ${aVal}% of items are out of spec. Out of 50000 units produced, compute the expected number of out-of-spec units. Output ONLY the numeric value.`,
    b_expected: 1140,
    desc: "Out-of-spec % → defective units"
  },
  {
    id: 5,
    a_prompt: "3 machines have independent daily failure rates of 0.02, 0.05, and 0.03. Compute P(at least one machine fails in 7 days). Use: P(at least one) = 1 - product of P(no fail in 7 days) for each machine. Output ONLY the numeric value as a decimal (e.g. 0.516).",
    a_expected: 0.516,
    b_prompt_template: (aVal) => `Agent A computed P(at least one failure in 7 days) = ${aVal}. The expected number of individual machine failures over 7 days is (0.02+0.05+0.03)*7 = 0.7. At $2000 per failure, compute the expected failure cost over 7 days. Output ONLY the numeric value.`,
    b_expected: 1400,
    desc: "P(failure) → expected cost"
  },
  {
    id: 6,
    a_prompt: "3 floods occurred in 50 years. Compute the probability of a flood in any given year. Output ONLY the numeric value as a decimal (e.g. 0.06).",
    a_expected: 0.06,
    b_prompt_template: (aVal) => `Agent A computed the annual flood probability: ${aVal}. An insurance company prices flood insurance at 1.5x the expected annual loss. If the property value at risk is $5,000,000, compute the annual insurance premium. Premium = 1.5 * P(flood) * property_value. Output ONLY the numeric value.`,
    b_expected: 450000,
    desc: "Flood probability → insurance premium"
  },
  {
    id: 7,
    a_prompt: "Stock A: return 8%, std 15%. Stock B: return 5%, std 8%. Portfolio: 60% A, 40% B. Correlation = 0.3. Compute the portfolio standard deviation using: sqrt(0.6^2*0.15^2 + 0.4^2*0.08^2 + 2*0.6*0.4*0.15*0.08*0.3). Output ONLY the numeric value as a percentage (e.g. 10.2).",
    a_expected: 10.2,
    b_prompt_template: (aVal) => `Agent A computed the portfolio standard deviation: ${aVal}%. For a $1,000,000 portfolio, compute the 95% Value at Risk (VaR). VaR = 1.645 * (std/100) * portfolio_value. Output ONLY the numeric value.`,
    b_expected: 167790,
    desc: "Portfolio std → 95% VaR"
  },
  {
    id: 8,
    a_prompt: "A server has a failure rate of 0.001 per hour, running 24/7 for a year (8760 hours). Compute the expected number of failures per year. Output ONLY the numeric value.",
    a_expected: 8.76,
    b_prompt_template: (aVal) => `Agent A computed expected failures per year: ${aVal}. Each failure costs $10,000 to repair. Compute the annual failure cost. Output ONLY the numeric value.`,
    b_expected: 87600,
    desc: "Server failures → annual cost"
  },
  {
    id: 9,
    a_prompt: "Daily demand has mean=150 and std=30. Lead time is 5 days. For a 95% service level (z=1.645), compute the safety stock. Safety stock = z * std * sqrt(lead_time) = 1.645 * 30 * sqrt(5). Output ONLY the numeric value rounded to 1 decimal.",
    a_expected: 110.3,
    b_prompt_template: (aVal) => `Agent A computed safety stock: ${aVal} units. The reorder point = mean_demand * lead_time + safety_stock = 150*5 + ${aVal}. Compute the reorder point. Output ONLY the numeric value.`,
    b_expected: 860,
    desc: "Safety stock → reorder point"
  },
  {
    id: 10,
    a_prompt: "A call center receives 40 calls/hour. Each call takes 3 minutes (0.05 hours) to handle. Compute the traffic intensity in Erlangs. Traffic intensity = arrival_rate * service_time = 40 * 0.05. Output ONLY the numeric value.",
    a_expected: 2.0,
    b_prompt_template: (aVal) => `Agent A computed traffic intensity: ${aVal} Erlangs. To keep the probability of waiting below 5%, the minimum number of agents needed is ceil(traffic_intensity) + 2. Compute the minimum number of agents. Output ONLY the numeric value.`,
    b_expected: 4,
    desc: "Traffic intensity → min agents"
  },
  {
    id: 11,
    a_prompt: "Monthly demand is 1000 units, ordering cost is $50 per order, holding cost is $2/unit/month. Compute the Economic Order Quantity: EOQ = sqrt(2*D*S/H) = sqrt(2*1000*50/2). Output ONLY the numeric value rounded to 1 decimal.",
    a_expected: 223.6,
    b_prompt_template: (aVal) => `Agent A computed EOQ: ${aVal} units. Total monthly inventory cost = (D/EOQ)*S + (EOQ/2)*H where D=1000, S=$50, H=$2. Compute the total monthly cost. Output ONLY the numeric value rounded to nearest integer.`,
    b_expected: 447,
    desc: "EOQ → total monthly cost"
  },
  {
    id: 12,
    a_prompt: "Three project tasks: Task 1 takes 5±1 days, Task 2 takes 8±2 days, Task 3 takes 3±0 days. Tasks 1 and 2 run in parallel, then Task 3 runs after both complete. Compute the expected duration of the parallel phase: max(E[Task1], E[Task2]) = max(5, 8). Output ONLY the numeric value.",
    a_expected: 8,
    b_prompt_template: (aVal) => `Agent A computed the expected parallel phase duration: ${aVal} days. Task 3 takes 3 days and runs after the parallel phase. Compute the total expected project duration. Output ONLY the numeric value.`,
    b_expected: 11,
    desc: "Parallel duration → total project time"
  },
  {
    id: 13,
    a_prompt: "Newsvendor problem: demand ~ N(200, 40), cost=$30, selling price=$80, salvage=$10. Compute the critical ratio: CR = (price-cost)/(price-salvage) = (80-30)/(80-10). Then find the optimal order quantity: Q* = mean + z*std where z = invNorm(CR). Output ONLY the optimal order quantity rounded to nearest integer.",
    a_expected: 223,
    b_prompt_template: (aVal) => `Agent A computed the optimal order quantity: ${aVal} units using the newsvendor model with demand~N(200,40), cost=$30, price=$80, salvage=$10. The critical ratio is (80-30)/(80-10) = 0.714, z=0.57, so Q*=200+0.57*40=${aVal}. Confirm this is the optimal order quantity. Output ONLY the numeric value.`,
    b_expected: 223,
    desc: "Critical ratio → optimal order"
  },
  {
    id: 14,
    a_prompt: "Drug trial: 120 treated patients, 15 improved. 100 control patients, 8 improved. Compute the relative risk (RR): RR = (15/120) / (8/100). Output ONLY the numeric value rounded to 4 decimal places.",
    a_expected: 1.5625,
    b_prompt_template: (aVal) => `Agent A computed the relative risk: ${aVal}. The absolute risk reduction (ARR) = treatment_rate - control_rate = 15/120 - 8/100 = 0.125 - 0.08 = 0.045. Compute the Number Needed to Treat (NNT) = ceil(1/ARR). Output ONLY the numeric value.`,
    b_expected: 23,
    desc: "Relative risk → NNT"
  },
  {
    id: 15,
    a_prompt: "Accidents follow a Poisson process with rate 0.5/month. Compute P(2 or more accidents next month). P(X>=2) = 1 - P(X=0) - P(X=1) where P(X=k) = e^(-0.5) * 0.5^k / k!. Output ONLY the numeric value rounded to 4 decimal places.",
    a_expected: 0.0902,
    b_prompt_template: (aVal) => `Agent A computed P(2+ accidents) = ${aVal}. The expected number of accidents per month is 0.5 (the Poisson rate). At $20,000 per accident, compute the expected monthly accident cost. Expected cost = rate * cost_per_accident = 0.5 * 20000. Output ONLY the numeric value.`,
    b_expected: 10000,
    desc: "Poisson probability → expected cost"
  }
];

// Pricing per 1M tokens
const PRICING = {
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 }
};

async function callOpenAI(model, systemMsg, userMsg) {
  const startTime = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg }
      ]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`OpenAI error: ${data.error.message}`);
  const latency = Date.now() - startTime;
  return {
    content: data.choices[0].message.content.trim(),
    usage: data.usage,
    latency
  };
}

function parseNumeric(text) {
  // Try to extract the last numeric value from the text
  const cleaned = text.replace(/,/g, "").replace(/\$/g, "").replace(/%/g, "");
  const matches = cleaned.match(/-?\d+\.?\d*/g);
  if (!matches) return NaN;
  return parseFloat(matches[matches.length - 1]);
}

function isCorrect(actual, expected, tolerance = 0.10) {
  if (isNaN(actual)) return false;
  if (expected === 0) return Math.abs(actual) < 1;
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerance;
}

function computeCost(usage, model) {
  const p = PRICING[model];
  return (usage.prompt_tokens * p.input + usage.completion_tokens * p.output) / 1_000_000;
}

// Run a single problem through A then B
async function runProblem(prob, aSystem, bSystem, bPreamble = null) {
  // Agent A
  const aResult = await callOpenAI("gpt-4o", aSystem, prob.a_prompt);
  const aNumeric = parseNumeric(aResult.content);

  // Agent B
  const bUserMsg = prob.b_prompt_template(aResult.content);
  const fullBUser = bPreamble ? `${bPreamble}\n\n${bUserMsg}` : bUserMsg;
  const bResult = await callOpenAI("gpt-4o-mini", bSystem, fullBUser);
  const bNumeric = parseNumeric(bResult.content);

  return {
    problem_id: prob.id,
    a_raw: aResult.content,
    a_numeric: aNumeric,
    a_expected: prob.a_expected,
    a_correct: isCorrect(aNumeric, prob.a_expected),
    a_output_tokens: aResult.usage.completion_tokens,
    a_total_tokens: aResult.usage.total_tokens,
    a_cost: computeCost(aResult.usage, "gpt-4o"),
    a_latency: aResult.latency,
    b_raw: bResult.content,
    b_numeric: bNumeric,
    b_expected: prob.b_expected,
    b_correct: isCorrect(bNumeric, prob.b_expected),
    b_output_tokens: bResult.usage.completion_tokens,
    b_total_tokens: bResult.usage.total_tokens,
    b_cost: computeCost(bResult.usage, "gpt-4o-mini"),
    b_latency: bResult.latency
  };
}

// Run batch of problems in parallel batches of 5
async function runBatch(problems, aSystem, bSystem, bPreamble = null) {
  const results = [];
  for (let i = 0; i < problems.length; i += 5) {
    const batch = problems.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(p => runProblem(p, aSystem, bSystem, bPreamble))
    );
    results.push(...batchResults);
  }
  return results;
}

function summarize(results) {
  const aCorrect = results.filter(r => r.a_correct).length;
  const bCorrect = results.filter(r => r.b_correct).length;
  const aOutputTokens = results.reduce((s, r) => s + r.a_output_tokens, 0);
  const bOutputTokens = results.reduce((s, r) => s + r.b_output_tokens, 0);
  const aTotalTokens = results.reduce((s, r) => s + r.a_total_tokens, 0);
  const bTotalTokens = results.reduce((s, r) => s + r.b_total_tokens, 0);
  const totalTokens = aTotalTokens + bTotalTokens;
  const aCost = results.reduce((s, r) => s + r.a_cost, 0);
  const bCost = results.reduce((s, r) => s + r.b_cost, 0);
  const totalCost = aCost + bCost;
  const avgALatency = results.reduce((s, r) => s + r.a_latency, 0) / results.length;
  const avgBLatency = results.reduce((s, r) => s + r.b_latency, 0) / results.length;

  return {
    a_accuracy: `${aCorrect}/${results.length}`,
    b_accuracy: `${bCorrect}/${results.length}`,
    a_accuracy_pct: (aCorrect / results.length * 100).toFixed(1),
    b_accuracy_pct: (bCorrect / results.length * 100).toFixed(1),
    a_output_tokens: aOutputTokens,
    b_output_tokens: bOutputTokens,
    total_tokens: totalTokens,
    a_cost: aCost.toFixed(6),
    b_cost: bCost.toFixed(6),
    total_cost: totalCost.toFixed(6),
    avg_a_latency_ms: Math.round(avgALatency),
    avg_b_latency_ms: Math.round(avgBLatency)
  };
}

async function main() {
  console.log("=== KI-1 Final Experiment: Two-Agent Knowledge Interface ===\n");
  console.log(`Problems: ${PROBLEMS.length}`);
  console.log(`Agent A: gpt-4o (Statistics Expert)`);
  console.log(`Agent B: gpt-4o-mini (Operations Expert)`);
  console.log(`Conditions: 4 (No Context, One-Way, Mutual, Progressive x3 rounds)\n`);

  const allConditions = {};

  // ── Condition 1: No Context ──
  console.log("── Condition 1: No Context ──");
  const nc_aSystem = "You are a helpful assistant. Explain your full reasoning step by step, then state the final numeric answer.";
  const nc_bSystem = "Read the explanation and compute the answer.";
  const ncResults = await runBatch(PROBLEMS, nc_aSystem, nc_bSystem);
  const ncSummary = summarize(ncResults);
  allConditions["1_no_context"] = { results: ncResults, summary: ncSummary };
  console.log(`  A accuracy: ${ncSummary.a_accuracy} (${ncSummary.a_accuracy_pct}%)`);
  console.log(`  B accuracy: ${ncSummary.b_accuracy} (${ncSummary.b_accuracy_pct}%)`);
  console.log(`  A output tokens: ${ncSummary.a_output_tokens}, Total tokens: ${ncSummary.total_tokens}`);
  console.log(`  Cost: $${ncSummary.total_cost}\n`);

  // ── Condition 2: One-Way ──
  console.log("── Condition 2: One-Way ──");
  const ow_aSystem = "You are a statistics expert. The recipient is an operations expert. State the numeric value precisely and concisely. Skip basic explanations.";
  const ow_bSystem = "You are an operations expert.";
  const owResults = await runBatch(PROBLEMS, ow_aSystem, ow_bSystem);
  const owSummary = summarize(owResults);
  allConditions["2_one_way"] = { results: owResults, summary: owSummary };
  console.log(`  A accuracy: ${owSummary.a_accuracy} (${owSummary.a_accuracy_pct}%)`);
  console.log(`  B accuracy: ${owSummary.b_accuracy} (${owSummary.b_accuracy_pct}%)`);
  console.log(`  A output tokens: ${owSummary.a_output_tokens}, Total tokens: ${owSummary.total_tokens}`);
  console.log(`  Cost: $${owSummary.total_cost}\n`);

  // ── Condition 3: Mutual ──
  console.log("── Condition 3: Mutual ──");
  const mu_aSystem = "You are a statistics expert. You will receive a capability summary from your partner (an operations expert). Adapt your response to their expertise. State the numeric value precisely.";
  const mu_bSystem = "You are an operations expert. You know your partner is a statistics expert.";
  const bCapabilitySummary = "I am an operations expert specializing in cost analysis, inventory management, queueing theory, and project scheduling. I can compute costs, optimal quantities, and operational metrics from statistical inputs.";
  const muResults = await runBatch(PROBLEMS, mu_aSystem, mu_bSystem, bCapabilitySummary);
  const muSummary = summarize(muResults);
  allConditions["3_mutual"] = { results: muResults, summary: muSummary };
  console.log(`  A accuracy: ${muSummary.a_accuracy} (${muSummary.a_accuracy_pct}%)`);
  console.log(`  B accuracy: ${muSummary.b_accuracy} (${muSummary.b_accuracy_pct}%)`);
  console.log(`  A output tokens: ${muSummary.a_output_tokens}, Total tokens: ${muSummary.total_tokens}`);
  console.log(`  Cost: $${muSummary.total_cost}\n`);

  // ── Condition 4: Progressive (3 rounds) ──
  console.log("── Condition 4: Progressive (3 rounds) ──");
  const progressiveRounds = [];

  for (let round = 1; round <= 3; round++) {
    console.log(`  Round ${round}:`);
    let pASystem, pBSystem;

    if (round === 1) {
      // R1 = No Context
      pASystem = nc_aSystem;
      pBSystem = nc_bSystem;
    } else {
      // R2+: infer partner expertise from previous responses
      const prevResults = progressiveRounds[round - 2].results;
      const aSamples = prevResults.slice(0, 3).map(r => `Q${r.problem_id}: "${r.a_raw.slice(0, 80)}..."`).join("\n");
      const bSamples = prevResults.slice(0, 3).map(r => `Q${r.problem_id}: "${r.b_raw.slice(0, 80)}..."`).join("\n");

      pASystem = `You are a statistics expert. Based on previous interactions, your partner responded like this:\n${bSamples}\nAdapt your communication style. Be precise and concise with numeric outputs.`;
      pBSystem = `You are an operations expert. Based on previous interactions, your partner (statistics expert) responded like this:\n${aSamples}\nUse their style to interpret their output accurately.`;
    }

    const pResults = await runBatch(PROBLEMS, pASystem, pBSystem);
    const pSummary = summarize(pResults);
    progressiveRounds.push({ round, results: pResults, summary: pSummary });
    console.log(`    A accuracy: ${pSummary.a_accuracy} (${pSummary.a_accuracy_pct}%)`);
    console.log(`    B accuracy: ${pSummary.b_accuracy} (${pSummary.b_accuracy_pct}%)`);
    console.log(`    A output tokens: ${pSummary.a_output_tokens}, Total tokens: ${pSummary.total_tokens}`);
    console.log(`    Cost: $${pSummary.total_cost}`);
  }
  allConditions["4_progressive"] = {
    rounds: progressiveRounds.map(r => ({ round: r.round, results: r.results, summary: r.summary }))
  };
  console.log();

  // ── Summary Table ──
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("                         SUMMARY TABLE");
  console.log("═══════════════════════════════════════════════════════════════════════");
  const header = "Condition".padEnd(22) + "A Acc".padEnd(10) + "B Acc".padEnd(10) + "A OutTok".padEnd(10) + "TotalTok".padEnd(10) + "Cost($)".padEnd(12) + "A Lat(ms)".padEnd(10) + "B Lat(ms)";
  console.log(header);
  console.log("─".repeat(92));

  const rows = [
    { name: "1. No Context", s: ncSummary },
    { name: "2. One-Way", s: owSummary },
    { name: "3. Mutual", s: muSummary },
  ];
  for (const r of rows) {
    console.log(
      r.name.padEnd(22) +
      `${r.s.a_accuracy_pct}%`.padEnd(10) +
      `${r.s.b_accuracy_pct}%`.padEnd(10) +
      `${r.s.a_output_tokens}`.padEnd(10) +
      `${r.s.total_tokens}`.padEnd(10) +
      `$${r.s.total_cost}`.padEnd(12) +
      `${r.s.avg_a_latency_ms}`.padEnd(10) +
      `${r.s.avg_b_latency_ms}`
    );
  }
  for (const pr of progressiveRounds) {
    const s = pr.summary;
    console.log(
      `4. Progressive R${pr.round}`.padEnd(22) +
      `${s.a_accuracy_pct}%`.padEnd(10) +
      `${s.b_accuracy_pct}%`.padEnd(10) +
      `${s.a_output_tokens}`.padEnd(10) +
      `${s.total_tokens}`.padEnd(10) +
      `$${s.total_cost}`.padEnd(12) +
      `${s.avg_a_latency_ms}`.padEnd(10) +
      `${s.avg_b_latency_ms}`
    );
  }
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  // Compute grand totals
  const allSummaries = [ncSummary, owSummary, muSummary, ...progressiveRounds.map(r => r.summary)];
  const grandTotalCost = allSummaries.reduce((s, x) => s + parseFloat(x.total_cost), 0);
  const grandTotalTokens = allSummaries.reduce((s, x) => s + x.total_tokens, 0);
  console.log(`Grand total cost: $${grandTotalCost.toFixed(6)}`);
  console.log(`Grand total tokens: ${grandTotalTokens}`);

  // ── Detailed per-problem results ──
  console.log("\n── Per-Problem Details (Condition 2: One-Way) ──");
  for (const r of owResults) {
    const aOk = r.a_correct ? "✓" : "✗";
    const bOk = r.b_correct ? "✓" : "✗";
    console.log(`  Q${String(r.problem_id).padEnd(3)} A: ${String(r.a_numeric).padEnd(12)} (exp ${String(r.a_expected).padEnd(10)}) ${aOk}  |  B: ${String(r.b_numeric).padEnd(12)} (exp ${String(r.b_expected).padEnd(10)}) ${bOk}`);
  }

  // ── Save JSON ──
  const output = {
    experiment: "KI-1 Final",
    timestamp: new Date().toISOString(),
    config: {
      agent_a_model: "gpt-4o",
      agent_b_model: "gpt-4o-mini",
      temperature: 0,
      num_problems: PROBLEMS.length,
      tolerance: "10%",
      batch_size: 5,
      pricing: PRICING
    },
    problems: PROBLEMS.map(p => ({
      id: p.id,
      desc: p.desc,
      a_prompt: p.a_prompt,
      a_expected: p.a_expected,
      b_expected: p.b_expected
    })),
    conditions: allConditions,
    grand_total_cost: grandTotalCost.toFixed(6),
    grand_total_tokens: grandTotalTokens
  };

  const fs = await import("fs");
  fs.writeFileSync("C:/Users/hyunj/wcisl/scripts/ki1_final_results.json", JSON.stringify(output, null, 2));
  console.log("\nResults saved to C:/Users/hyunj/wcisl/scripts/ki1_final_results.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
