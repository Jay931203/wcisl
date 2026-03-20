/**
 * KI-1 Experiment v4 Fast — Specialized Expert Communication
 * Agent A (Tx): GPT-4o — Statistics/Data Analysis expert
 * Agent B (Rx): GPT-4o-mini — Decision/Operations expert
 * 15 two-stage numeric problems, 4 conditions, parallel execution
 */

const OPENAI_API_KEY = 'OPENAI_API_KEY_REDACTED';
const MODEL_A = 'gpt-4o';
const MODEL_B = 'gpt-4o-mini';
const TEMP = 0;
const CONCURRENCY = 5;

import fs from 'fs';

// ─── Problems ───────────────────────────────────────────────────────────────
const PROBLEMS = [
  // Quality Control (1-5)
  {
    id: 1, category: 'Quality Control',
    problemA: '200 samples inspected, 7 defective found. Compute the defect rate (proportion).',
    groundA: 0.035,
    problemB: 'Given a defect rate of {A}, compute the expected defect cost for a batch of 5000 units at $800 replacement cost per defective unit.',
    groundB: 140000,
  },
  {
    id: 2, category: 'Quality Control',
    problemA: 'A machine has 92% uptime over 100 days. Compute the downtime rate (proportion of time down).',
    groundA: 0.08,
    problemB: 'Given a downtime rate of {A}, compute the annual downtime cost if downtime costs $5000/day and there are 365 days/year.',
    groundB: 146000,
  },
  {
    id: 3, category: 'Quality Control',
    problemA: '500 products tested, 12 fail. Compute the failure rate as a percentage.',
    groundA: 2.4,
    problemB: 'Given a failure rate of {A}%, a recall is triggered only if the rate exceeds 3%. If triggered, recall cost is $50/unit on 20000 units. What is the expected recall cost? (If no recall, cost is 0.)',
    groundB: 0,
  },
  {
    id: 4, category: 'Quality Control',
    problemA: 'Measurement data: mean=10.2, std=0.3, upper spec limit=10.8. Assuming normal distribution, what percentage of items exceed the spec limit? (Use z-score.)',
    groundA: 2.28,
    problemB: 'Given that {A}% of items are out of spec, how many defective units are expected in a production run of 50000?',
    groundB: 1140,
  },
  {
    id: 5, category: 'Quality Control',
    problemA: '3 machines with daily failure probabilities 0.02, 0.05, 0.03. Compute the probability that at least one machine fails in a given week (7 days). Use P(at least one) = 1 - product of (1-p_i)^7 for each machine.',
    groundA: 0.516,
    problemB: 'Given that the probability of at least one machine failure per week is {A}, compute the expected weekly repair cost if each failure event costs $2000.',
    groundB: 1032,
  },
  // Risk Assessment (6-10)
  {
    id: 6, category: 'Risk Assessment',
    problemA: 'Historical data: 3 floods in 50 years. Compute the annual flood probability.',
    groundA: 0.06,
    problemB: 'Given annual flood probability of {A} and property value $5M, compute the annual insurance premium at 1.5x the expected annual loss.',
    groundB: 450000,
  },
  {
    id: 7, category: 'Risk Assessment',
    problemA: 'Portfolio: Stock A returns 8%+-15% std, Stock B 5%+-8% std. 60/40 split, correlation 0.3. Compute the portfolio standard deviation. Formula: sqrt(0.6^2*15^2 + 0.4^2*8^2 + 2*0.6*0.4*15*8*0.3).',
    groundA: 10.2,
    problemB: 'Given portfolio std of {A}%, compute the 95% Value-at-Risk (VaR) for a $1M portfolio. VaR = z * std * portfolio_value, where z=1.645 for 95%.',
    groundB: 167800,
  },
  {
    id: 8, category: 'Risk Assessment',
    problemA: 'Server failure rate: 0.001/hour, operating 24/7. Compute the expected number of failures per year (8760 hours).',
    groundA: 8.76,
    problemB: 'Given {A} expected failures/year at $10000/failure, compute the annual failure cost.',
    groundB: 87600,
  },
  {
    id: 9, category: 'Risk Assessment',
    problemA: 'Drug trial: 120 treated, 15 improved (12.5%). 100 control, 8 improved (8%). Compute the Relative Risk (RR = treatment rate / control rate).',
    groundA: 1.5625,
    problemB: 'Given treatment improvement rate 12.5% and control rate 8%, compute the Number Needed to Treat (NNT = 1 / (treatment_rate - control_rate)).',
    groundB: 22.22,
  },
  {
    id: 10, category: 'Risk Assessment',
    problemA: 'Factory accident rate: 0.5/month (Poisson). Compute P(2 or more accidents next month). Use P(X>=2) = 1 - P(0) - P(1) where P(k)=e^(-λ)*λ^k/k!.',
    groundA: 0.0902,
    problemB: 'Given Poisson rate λ=0.5 accidents/month and $20000/accident, compute the expected monthly accident cost (E[cost] = λ * cost_per_accident).',
    groundB: 10000,
  },
  // Resource Optimization (11-15)
  {
    id: 11, category: 'Resource Optimization',
    problemA: 'Daily demand mean=150, std=30. Lead time=5 days. Compute the safety stock for 95% service level (z=1.645). Safety stock = z * std * sqrt(lead_time).',
    groundA: 110.2,
    problemB: 'Given safety stock of {A} units, mean daily demand 150, and lead time 5 days, compute the reorder point (ROP = mean_demand * lead_time + safety_stock).',
    groundB: 860.2,
  },
  {
    id: 12, category: 'Resource Optimization',
    problemA: 'Call center: 40 calls/hour, avg handle time 3 minutes. Compute the traffic intensity in Erlangs (arrival_rate * avg_service_time_in_hours).',
    groundA: 2.0,
    problemB: 'Given traffic intensity of {A} Erlangs, determine the minimum number of agents needed so that wait probability is below 5% using Erlang-C. (For 2.0 Erlangs, 4 agents gives ~17% wait, so typically need more — check standard Erlang-C tables.)',
    groundB: 4,
  },
  {
    id: 13, category: 'Resource Optimization',
    problemA: 'Monthly demand=1000, ordering cost=$50, holding cost=$2/unit/month. Compute EOQ = sqrt(2*D*S/H).',
    groundA: 223.6,
    problemB: 'Given EOQ={A}, monthly demand 1000, ordering cost $50, holding cost $2/unit/month: compute total annual inventory cost. Annual orders = 12*1000/{A}, annual ordering cost = orders*50, annual holding = ({A}/2)*2*12, total = ordering + holding.',
    groundB: 5367,
  },
  {
    id: 14, category: 'Resource Optimization',
    problemA: 'Project: 3 tasks with durations 5+-1, 8+-2, 3+-1 days (mean+-std). Tasks 1 and 2 run in parallel, then task 3. The parallel stage duration = max(task1, task2). Compute the expected duration of the parallel stage. (For independent normals, E[max] ≈ 8 days since task 2 dominates.)',
    groundA: 8.0,
    problemB: 'Given parallel stage expected duration {A} days and task 3 duration 3+-1 days, compute total project duration and its standard deviation. Total = {A}+3, Std = sqrt(std_parallel^2 + std_task3^2) where std_parallel ≈ 2 days.',
    groundB: 11.0,
  },
  {
    id: 15, category: 'Resource Optimization',
    problemA: 'Newsvendor problem: demand ~ N(200, 40). Unit cost $30, selling price $80, salvage $10. Compute the critical ratio CR = (price-cost)/(price-salvage) = (80-30)/(80-10).',
    groundA: 0.7143,
    problemB: 'Given critical ratio {A}, demand ~ N(200,40). The optimal order quantity Q* = mean + z*std where z = Phi_inv(CR). For CR≈0.714, z≈0.57. Compute Q*.',
    groundB: 222.8,
  },
];

// ─── API Call ───────────────────────────────────────────────────────────────
async function callGPT(model, messages, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model, messages, temperature: TEMP, max_tokens: 1024 }),
      });
      if (res.status === 429) {
        const wait = Math.pow(2, attempt) * 2000;
        console.log(`  Rate limited, waiting ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      const usage = data.usage || {};
      return {
        content: data.choices[0].message.content,
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        model,
      };
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ─── Number extraction ──────────────────────────────────────────────────────
function extractNumber(text) {
  // Try to find a "final answer" pattern first
  const finalPatterns = [
    /(?:final\s+answer|result|answer|total|value|=)\s*[:\s]*\$?\s*([-+]?\d[\d,]*\.?\d*)/i,
    /\*\*([-+]?\d[\d,]*\.?\d*)\*\*/,
    /\$([-+]?\d[\d,]*\.?\d*)/,
  ];
  for (const pat of finalPatterns) {
    const m = text.match(pat);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
  }
  // Fall back: find all numbers, pick the last one
  const nums = [...text.matchAll(/([-+]?\d[\d,]*\.?\d*)/g)]
    .map(m => parseFloat(m[1].replace(/,/g, '')))
    .filter(n => !isNaN(n) && n !== 0);
  return nums.length > 0 ? nums[nums.length - 1] : null;
}

function checkAnswer(got, expected, tolerance = 0.05) {
  if (got === null || got === undefined) return false;
  if (expected === 0) return Math.abs(got) < 0.01;
  return Math.abs(got - expected) / Math.abs(expected) <= tolerance;
}

// ─── Batch with concurrency ────────────────────────────────────────────────
async function batchRun(tasks, concurrency) {
  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
  }
  return results;
}

// ─── Run a single problem under a condition ─────────────────────────────────
async function runProblem(problem, condition, roundNum = null, prevResponses = null) {
  const { id, problemA, problemB, groundA, groundB } = problem;
  let sysA, sysB, userA, userB_prefix;
  let capabilityMsg = null;

  switch (condition) {
    case 'no_context':
      sysA = 'You are a statistics and data analysis expert. Solve the given problem step by step. Provide a clear numeric answer. Be thorough in your explanation since the recipient may not have your background.';
      sysB = 'You are a general-purpose assistant. Use the provided intermediate result to compute the final answer. Show your work and provide a clear numeric final answer.';
      break;
    case 'one_way':
      sysA = 'You are a statistics and data analysis expert. Your result will be used by an operations/decision expert. Be precise with numeric values. State your answer concisely — the recipient is technically competent.';
      sysB = 'You are a decision and operations expert. Use the provided statistical result to make your computation. Show your work and provide a clear numeric final answer.';
      break;
    case 'mutual':
      sysA = 'You are a statistics and data analysis expert. You will receive a capability summary from your partner first. Adapt your communication style accordingly. Provide precise numeric results.';
      sysB = 'You are a decision and operations expert with strong quantitative skills. Use the provided statistical result to compute the final answer. Show your work and provide a clear numeric final answer.';
      capabilityMsg = 'I am an operations and decision science expert. I am comfortable with probability, cost analysis, optimization (EOQ, newsvendor), queuing theory, and financial risk metrics like VaR. Please provide your intermediate result with the numeric value clearly stated.';
      break;
    case 'progressive':
      if (roundNum === 1) {
        sysA = 'You are a statistics and data analysis expert. Solve the given problem step by step. Provide a clear numeric answer. Be thorough in your explanation.';
        sysB = 'You are a general-purpose assistant. Use the provided intermediate result to compute the final answer. Show your work and provide a clear numeric final answer.';
      } else {
        const prevSummary = prevResponses
          ? `Based on previous interactions, your partner tends to be quantitative and precise. They work in operations/decision science.`
          : '';
        sysA = `You are a statistics and data analysis expert. ${prevSummary} Adapt accordingly. Provide a clear numeric answer.`;
        sysB = `You are a decision and operations expert. Based on prior interactions, your partner provides thorough statistical computations. Extract the key numeric value and use it. Show your work and provide a clear numeric final answer.`;
      }
      break;
  }

  // Step 1: Agent A computes intermediate
  const msgsA = [{ role: 'system', content: sysA }];
  if (condition === 'mutual' && capabilityMsg) {
    msgsA.push({ role: 'user', content: `Your partner says: "${capabilityMsg}"\n\nNow solve this problem:\n${problemA}\n\nProvide your numeric answer clearly.` });
  } else {
    msgsA.push({ role: 'user', content: `${problemA}\n\nProvide your numeric answer clearly.` });
  }

  const respA = await callGPT(MODEL_A, msgsA);
  const valueA = extractNumber(respA.content);

  // Step 2: Agent B uses A's result
  const actualProbB = problemB.replace('{A}', String(valueA ?? groundA));
  const msgsB = [
    { role: 'system', content: sysB },
    { role: 'user', content: `An analyst computed the following:\n\n${respA.content}\n\nUsing this result, solve:\n${actualProbB}\n\nProvide your numeric final answer clearly.` },
  ];

  const respB = await callGPT(MODEL_B, msgsB);
  const valueB = extractNumber(respB.content);

  const aCorrect = checkAnswer(valueA, groundA);
  const bCorrect = checkAnswer(valueB, groundB);
  const score = aCorrect ? (bCorrect ? 1.0 : 0.5) : 0.0;

  return {
    problemId: id,
    category: problem.category,
    condition,
    round: roundNum,
    agentA: { answer: valueA, expected: groundA, correct: aCorrect, response: respA.content.slice(0, 300) },
    agentB: { answer: valueB, expected: groundB, correct: bCorrect, response: respB.content.slice(0, 300) },
    score,
    tokens: {
      a_input: respA.inputTokens, a_output: respA.outputTokens,
      b_input: respB.inputTokens, b_output: respB.outputTokens,
    },
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== KI-1 v4 FAST: Specialized Expert Communication ===');
  console.log(`Agent A: ${MODEL_A} (Statistics) | Agent B: ${MODEL_B} (Operations)`);
  console.log(`Problems: ${PROBLEMS.length} | Conditions: 4 | Concurrency: ${CONCURRENCY}`);
  console.log('');

  const allResults = {};
  const startTime = Date.now();
  let totalTokens = { a_input: 0, a_output: 0, b_input: 0, b_output: 0 };

  // Condition 1: No Context
  console.log('--- Condition 1: No Context ---');
  const t1 = Date.now();
  const tasks1 = PROBLEMS.map(p => () => runProblem(p, 'no_context'));
  allResults['no_context'] = await batchRun(tasks1, CONCURRENCY);
  console.log(`  Done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  // Condition 2: One-Way
  console.log('--- Condition 2: One-Way ---');
  const t2 = Date.now();
  const tasks2 = PROBLEMS.map(p => () => runProblem(p, 'one_way'));
  allResults['one_way'] = await batchRun(tasks2, CONCURRENCY);
  console.log(`  Done in ${((Date.now() - t2) / 1000).toFixed(1)}s`);

  // Condition 3: Mutual
  console.log('--- Condition 3: Mutual ---');
  const t3 = Date.now();
  const tasks3 = PROBLEMS.map(p => () => runProblem(p, 'mutual'));
  allResults['mutual'] = await batchRun(tasks3, CONCURRENCY);
  console.log(`  Done in ${((Date.now() - t3) / 1000).toFixed(1)}s`);

  // Condition 4: Progressive (3 rounds)
  console.log('--- Condition 4: Progressive (3 Rounds) ---');
  allResults['progressive'] = {};
  let prevResponses = null;
  for (let round = 1; round <= 3; round++) {
    const tr = Date.now();
    console.log(`  Round ${round}...`);
    const tasksR = PROBLEMS.map(p => () => runProblem(p, 'progressive', round, prevResponses));
    const roundResults = await batchRun(tasksR, CONCURRENCY);
    allResults['progressive'][`round_${round}`] = roundResults;
    prevResponses = roundResults;
    console.log(`    Done in ${((Date.now() - tr) / 1000).toFixed(1)}s`);
  }

  // ─── Aggregate ──────────────────────────────────────────────────────────
  console.log('\n========== RESULTS ==========\n');

  const summary = {};
  for (const cond of ['no_context', 'one_way', 'mutual']) {
    const results = allResults[cond];
    const scores = results.map(r => r.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const aAcc = results.filter(r => r.agentA.correct).length / results.length;
    const bAcc = results.filter(r => r.agentB.correct).length / results.length;

    results.forEach(r => {
      totalTokens.a_input += r.tokens.a_input;
      totalTokens.a_output += r.tokens.a_output;
      totalTokens.b_input += r.tokens.b_input;
      totalTokens.b_output += r.tokens.b_output;
    });

    summary[cond] = { avgScore, aAccuracy: aAcc, bAccuracy: bAcc, count: results.length };

    console.log(`[${cond.toUpperCase()}] Avg Score: ${avgScore.toFixed(3)} | A Acc: ${(aAcc * 100).toFixed(1)}% | B Acc: ${(bAcc * 100).toFixed(1)}%`);

    // Per-problem detail
    for (const r of results) {
      const mark = r.score === 1.0 ? 'OK' : r.score === 0.5 ? 'A-only' : 'MISS';
      console.log(`  P${r.problemId}: A=${r.agentA.answer} (exp ${r.agentA.expected}) ${r.agentA.correct ? 'v' : 'x'} | B=${r.agentB.answer} (exp ${r.agentB.expected}) ${r.agentB.correct ? 'v' : 'x'} [${mark}]`);
    }
  }

  // Progressive
  for (let round = 1; round <= 3; round++) {
    const results = allResults['progressive'][`round_${round}`];
    const scores = results.map(r => r.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const aAcc = results.filter(r => r.agentA.correct).length / results.length;
    const bAcc = results.filter(r => r.agentB.correct).length / results.length;

    results.forEach(r => {
      totalTokens.a_input += r.tokens.a_input;
      totalTokens.a_output += r.tokens.a_output;
      totalTokens.b_input += r.tokens.b_input;
      totalTokens.b_output += r.tokens.b_output;
    });

    summary[`progressive_r${round}`] = { avgScore, aAccuracy: aAcc, bAccuracy: bAcc, count: results.length };
    console.log(`[PROGRESSIVE R${round}] Avg Score: ${avgScore.toFixed(3)} | A Acc: ${(aAcc * 100).toFixed(1)}% | B Acc: ${(bAcc * 100).toFixed(1)}%`);

    for (const r of results) {
      const mark = r.score === 1.0 ? 'OK' : r.score === 0.5 ? 'A-only' : 'MISS';
      console.log(`  P${r.problemId}: A=${r.agentA.answer} (exp ${r.agentA.expected}) ${r.agentA.correct ? 'v' : 'x'} | B=${r.agentB.answer} (exp ${r.agentB.expected}) ${r.agentB.correct ? 'v' : 'x'} [${mark}]`);
    }
  }

  // Cost
  const costA = (totalTokens.a_input / 1e6) * 2.50 + (totalTokens.a_output / 1e6) * 10.00;
  const costB = (totalTokens.b_input / 1e6) * 0.15 + (totalTokens.b_output / 1e6) * 0.60;
  const totalCost = costA + costB;

  console.log(`\n--- Token Usage ---`);
  console.log(`Agent A (${MODEL_A}): ${totalTokens.a_input} in / ${totalTokens.a_output} out | Cost: $${costA.toFixed(4)}`);
  console.log(`Agent B (${MODEL_B}): ${totalTokens.b_input} in / ${totalTokens.b_output} out | Cost: $${costB.toFixed(4)}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // ─── Save JSON ──────────────────────────────────────────────────────────
  const output = {
    experiment: 'KI-1 v4 Fast',
    timestamp: new Date().toISOString(),
    config: { modelA: MODEL_A, modelB: MODEL_B, temperature: TEMP, concurrency: CONCURRENCY },
    problems: PROBLEMS.map(p => ({
      id: p.id, category: p.category,
      groundTruthA: p.groundA, groundTruthB: p.groundB,
      descriptionA: p.problemA, descriptionB: p.problemB,
    })),
    results: allResults,
    summary,
    tokens: totalTokens,
    cost: { agentA: costA, agentB: costB, total: totalCost },
    elapsed_seconds: (Date.now() - startTime) / 1000,
  };

  const outPath = 'C:/Users/hyunj/wcisl/scripts/ki1_v4_fast_results.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
