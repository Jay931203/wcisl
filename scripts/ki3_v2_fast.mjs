/**
 * KI-3 Stage-Wise Switching Experiment v2 (Fast / Parallel)
 *
 * Tx and Rx: GPT-4o-mini, 3-stage CoT, 15 hard problems, 5 conditions.
 * Batched parallel execution (5 concurrent per batch).
 */

import fs from 'fs';

const OPENAI_API_KEY = 'OPENAI_API_KEY_REDACTED';
const MODEL = 'gpt-4o-mini';
const TEMPERATURE = 0;

// ============================================================
// PROBLEMS
// ============================================================
const PROBLEMS = [
  // Probability / Bayes (1-5)
  {
    id: 1, category: 'Probability/Bayes',
    problem: 'Disease prevalence is 1%. A test is 95% accurate (sensitivity=95%, specificity=95%). A person tests positive. What is the actual probability they have the disease?',
    answer: 16.1, unit: '%', tolerance: 0.05,
    parseAnswer: extractPercent,
  },
  {
    id: 2, category: 'Probability/Bayes',
    problem: '3 urns: A has 5 red and 3 blue balls, B has 2 red and 6 blue, C has 4 red and 4 blue. You pick a random urn uniformly and draw a red ball. What is P(urn A)?',
    answer: 0.4545, unit: '', tolerance: 0.05,
    parseAnswer: extractDecimal,
  },
  {
    id: 3, category: 'Probability/Bayes',
    problem: 'Spam filter: P(spam)=0.3, P("free"|spam)=0.8, P("free"|not spam)=0.1. An email contains the word "free". What is P(spam|"free")?',
    answer: 0.774, unit: '', tolerance: 0.05,
    parseAnswer: extractDecimal,
  },
  {
    id: 4, category: 'Probability/Bayes',
    problem: 'Factory has Machine1 (60% of production, 2% defect rate) and Machine2 (40% of production, 5% defect rate). A randomly selected item is defective. What is P(Machine1)?',
    answer: 0.375, unit: '', tolerance: 0.05,
    parseAnswer: extractDecimal,
  },
  {
    id: 5, category: 'Probability/Bayes',
    problem: 'Monty Hall problem: You picked door 1. Host opens door 3 (shows a goat). What is P(car is behind door 2)?',
    answer: 2/3, unit: '', tolerance: 0.05,
    parseAnswer: extractDecimal,
  },
  // Optimization with Constraints (6-10)
  {
    id: 6, category: 'Optimization',
    problem: 'A farmer has 100m of fence to enclose a rectangular area along a river (river side needs no fence). What is the maximum area in m²?',
    answer: 1250, unit: 'm²', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
  {
    id: 7, category: 'Optimization',
    problem: 'An open-top box has a square base and volume of 1000 cm³. What side length of the base minimizes the total surface area? Give the side length in cm.',
    answer: 10, unit: 'cm', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
  {
    id: 8, category: 'Optimization',
    problem: 'Transportation problem: Warehouse W1 (supply=50), W2 (supply=40). Store S1 (demand=30), S2 (demand=35), S3 (demand=25). Cost per unit: W1->S1=$4, W1->S2=$8, W1->S3=$1, W2->S1=$7, W2->S2=$2, W2->S3=$3. What is the minimum total shipping cost?',
    answer: 210, unit: '$', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
  {
    id: 9, category: 'Optimization',
    problem: 'f(x) = x³ - 6x² + 9x + 1 on the interval [0, 5]. What is the global maximum value?',
    answer: 21, unit: '', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
  {
    id: 10, category: 'Optimization',
    problem: 'Maximize profit: Product A gives $5 profit, requires 2hr labor and 1kg material. Product B gives $8 profit, requires 3hr labor and 2kg material. Available: 120hr labor, 50kg material. What is the maximum profit in dollars?',
    answer: 320, unit: '$', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
  // Multi-step Logic (11-15)
  {
    id: 11, category: 'Multi-step Logic',
    problem: 'A clock gains 5 minutes every hour. It is set correctly at 12:00 noon. When the clock shows 6:00 PM, what is the actual real time? Give answer as hours after noon.',
    answer: 5, unit: 'hours', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
  {
    id: 12, category: 'Multi-step Logic',
    problem: 'Two trains are 300 km apart, approaching each other at 60 km/h and 90 km/h. A fly starts at one train and bounces back and forth between them at 120 km/h. What total distance does the fly travel before the trains meet? Answer in km.',
    answer: 240, unit: 'km', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
  {
    id: 13, category: 'Multi-step Logic',
    problem: "A rope is wrapped tightly around Earth's equator (circumference = 40,000 km). You add exactly 1 meter to the rope's length and raise it uniformly. How high above the surface is the rope, in meters?",
    answer: 0.159, unit: 'm', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
  {
    id: 14, category: 'Multi-step Logic',
    problem: '100 lockers in a row, all closed. 100 students: student k toggles every k-th locker. How many lockers are open at the end?',
    answer: 10, unit: '', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
  {
    id: 15, category: 'Multi-step Logic',
    problem: 'Single elimination tournament with 16 players. How many total games are needed to determine one winner?',
    answer: 15, unit: '', tolerance: 0.05,
    parseAnswer: extractNumber,
  },
];

// ============================================================
// ANSWER PARSERS
// ============================================================
function extractPercent(text) {
  // Look for percentage patterns
  const patterns = [
    /≈?\s*([\d.]+)\s*%/,
    /approximately\s*([\d.]+)\s*%/i,
    /about\s*([\d.]+)\s*%/i,
    /probability[^.]*?([\d.]+)\s*%/i,
    /([\d.]+)\s*%/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseFloat(m[1]);
  }
  // Try decimal that could be a percentage
  const d = extractDecimal(text);
  if (d !== null && d > 0 && d < 1) return d * 100;
  return null;
}

function extractDecimal(text) {
  // Look for fraction patterns first
  const fracMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (fracMatch) return parseFloat(fracMatch[1]) / parseFloat(fracMatch[2]);
  // Look for ≈ or = followed by decimal
  const eqMatch = text.match(/[≈=]\s*(0?\.\d+)/);
  if (eqMatch) return parseFloat(eqMatch[1]);
  // Percentage to decimal
  const pctMatch = text.match(/([\d.]+)\s*%/);
  if (pctMatch) return parseFloat(pctMatch[1]) / 100;
  // Generic decimal
  const nums = text.match(/\b(0\.\d+)\b/g);
  if (nums) return parseFloat(nums[nums.length - 1]);
  // Try any number
  const anyNum = text.match(/([\d.]+)/g);
  if (anyNum) {
    for (const n of anyNum.reverse()) {
      const v = parseFloat(n);
      if (v > 0 && v < 1) return v;
    }
  }
  return null;
}

function extractNumber(text) {
  // Look for "answer is X" or "= X" patterns
  const patterns = [
    /(?:answer|result|maximum|minimum|total|distance|height|side length|profit|cost|time|games?)\s*(?:is|=|:)\s*\$?\s*([\d,.]+)/i,
    /(?:=|≈)\s*\$?\s*([\d,.]+)/,
    /\*\*([\d,.]+)\*\*/,
    /\$\s*([\d,.]+)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
  }
  // Last number in text
  const nums = text.match(/[\d,.]+/g);
  if (nums) {
    // Find the last substantial number
    for (let i = nums.length - 1; i >= 0; i--) {
      const v = parseFloat(nums[i].replace(/,/g, ''));
      if (!isNaN(v)) return v;
    }
  }
  return null;
}

// ============================================================
// LLM CALL
// ============================================================
async function callLLM(messages, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: TEMPERATURE,
          max_tokens: 1500,
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        if (resp.status === 429) {
          const wait = Math.pow(2, attempt) * 2000;
          console.log(`  Rate limited, waiting ${wait}ms...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`API ${resp.status}: ${err}`);
      }
      const data = await resp.json();
      return data.choices[0].message.content;
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// ============================================================
// TX/RX SYSTEM PROMPTS
// ============================================================
const TX_GENERAL = `You are a math/logic problem solver (Transmitter). Solve the problem step-by-step with clear reasoning. Show your work.`;

const TX_COMPRESSED = `You are a Transmitter solving problems for a Receiver AI. Your output will be sent to another AI that must extract the answer.
IMPORTANT: Be extremely concise and structured. Use notation like:
- Key values in brackets: [answer=X]
- Compressed reasoning: skip obvious steps
- Final answer clearly marked: FINAL: X
Minimize token usage while preserving all critical information.`;

const RX_GENERAL = `You are a Receiver AI. You will be given a solution from another AI. Extract the final numerical answer.
Reply with ONLY the final answer as a number (with unit if applicable). Nothing else.`;

const RX_INTERPRET = `You are a Receiver AI specialized in interpreting compressed AI-to-AI messages.
The Transmitter has sent a compressed solution. Decompress and interpret it:
1. Identify the key values and relationships
2. Verify the reasoning chain
3. Extract the final answer
Reply with your interpretation, then state FINAL ANSWER: [number]`;

// ============================================================
// CONDITIONS
// ============================================================
function getConditionConfig(conditionId) {
  switch (conditionId) {
    case 1: // All General
      return {
        name: 'All General',
        txStages: ['general', 'general', 'general'],
        rxMode: 'general',
      };
    case 2: // All Audience-Aware
      return {
        name: 'All Audience-Aware',
        txStages: ['compressed', 'compressed', 'compressed'],
        rxMode: 'interpret',
      };
    case 3: // Tx-Only Switch
      return {
        name: 'Tx-Only Switch',
        txStages: ['general', 'general', 'compressed'],
        rxMode: 'general',
      };
    case 4: // Both Switch
      return {
        name: 'Both Switch',
        txStages: ['general', 'general', 'compressed'],
        rxMode: 'both_switch',
      };
    case 5: // Reverse Switch
      return {
        name: 'Reverse Switch',
        txStages: ['compressed', 'general', 'general'],
        rxMode: 'reverse',
      };
  }
}

// ============================================================
// RUN SINGLE PROBLEM THROUGH PIPELINE
// ============================================================
async function runPipeline(problem, conditionId) {
  const config = getConditionConfig(conditionId);
  const txStages = config.txStages;

  // === TX STAGE 1 ===
  const tx1System = txStages[0] === 'compressed' ? TX_COMPRESSED : TX_GENERAL;
  const tx1Out = await callLLM([
    { role: 'system', content: tx1System },
    { role: 'user', content: `Stage 1 of 3. Problem: ${problem.problem}\n\nBegin your initial analysis and identify the key approach.` },
  ]);

  // === TX STAGE 2 ===
  const tx2System = txStages[1] === 'compressed' ? TX_COMPRESSED : TX_GENERAL;
  const tx2Out = await callLLM([
    { role: 'system', content: tx2System },
    { role: 'user', content: `Stage 2 of 3. Problem: ${problem.problem}\n\nYour Stage 1 analysis:\n${tx1Out}\n\nContinue solving. Perform the detailed calculations.` },
  ]);

  // === TX STAGE 3 (produces the transmitted message) ===
  const tx3System = txStages[2] === 'compressed' ? TX_COMPRESSED : TX_GENERAL;
  const tx3Out = await callLLM([
    { role: 'system', content: tx3System },
    { role: 'user', content: `Stage 3 of 3 (FINAL). Problem: ${problem.problem}\n\nYour Stage 2 work:\n${tx2Out}\n\nFinalize and present your complete solution with the answer.` },
  ]);

  const transmitted = tx3Out; // Only stage 3 output is transmitted

  // === RX PROCESSING ===
  let rxOut;
  if (config.rxMode === 'general') {
    rxOut = await callLLM([
      { role: 'system', content: RX_GENERAL },
      { role: 'user', content: `Extract the final answer from this solution:\n\n${transmitted}` },
    ]);
  } else if (config.rxMode === 'interpret') {
    rxOut = await callLLM([
      { role: 'system', content: RX_INTERPRET },
      { role: 'user', content: `Interpret this compressed AI message and extract the answer:\n\n${transmitted}` },
    ]);
  } else if (config.rxMode === 'both_switch') {
    // Rx stage 1: interpret/decompress
    const rx1 = await callLLM([
      { role: 'system', content: RX_INTERPRET },
      { role: 'user', content: `Stage 1: Decompress and interpret this AI-to-AI message:\n\n${transmitted}` },
    ]);
    // Rx stage 2: free reasoning to extract final answer
    rxOut = await callLLM([
      { role: 'system', content: RX_GENERAL },
      { role: 'user', content: `Based on this interpretation, extract the final numerical answer:\n\n${rx1}` },
    ]);
  } else if (config.rxMode === 'reverse') {
    // Rx stage 1: general reasoning on the (general-style) transmitted message
    const rx1 = await callLLM([
      { role: 'system', content: RX_GENERAL },
      { role: 'user', content: `Extract the final answer from this solution:\n\n${transmitted}` },
    ]);
    rxOut = rx1;
  }

  // === GRADE ===
  const parsed = problem.parseAnswer(rxOut);
  const correct = parsed !== null && Math.abs(parsed - problem.answer) / Math.abs(problem.answer) <= problem.tolerance;

  return {
    problemId: problem.id,
    condition: conditionId,
    conditionName: config.name,
    correct,
    expected: problem.answer,
    parsed,
    rxOutput: rxOut.substring(0, 300),
    txTransmitted: transmitted.substring(0, 500),
  };
}

// ============================================================
// BATCH RUNNER (5 concurrent)
// ============================================================
async function runBatch(tasks, concurrency = 5) {
  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
  }
  return results;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('=== KI-3 Stage-Wise Switching v2 (Fast) ===');
  console.log(`Model: ${MODEL} | Problems: ${PROBLEMS.length} | Conditions: 5`);
  console.log(`Total runs: ${PROBLEMS.length * 5} = ${PROBLEMS.length * 5}`);
  console.log('');

  const allResults = [];
  const conditionScores = {};

  for (let c = 1; c <= 5; c++) {
    const config = getConditionConfig(c);
    console.log(`\n--- Condition ${c}: ${config.name} ---`);
    const startTime = Date.now();

    // Create all 15 tasks for this condition
    const tasks = PROBLEMS.map(p => () => runPipeline(p, c));

    // Run with concurrency=5
    const results = await runBatch(tasks, 5);
    allResults.push(...results);

    const correctCount = results.filter(r => r.correct).length;
    conditionScores[c] = { name: config.name, correct: correctCount, total: PROBLEMS.length, pct: (correctCount / PROBLEMS.length * 100).toFixed(1) };

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Score: ${correctCount}/${PROBLEMS.length} (${conditionScores[c].pct}%) | ${elapsed}s`);

    // Per-category breakdown
    for (const cat of ['Probability/Bayes', 'Optimization', 'Multi-step Logic']) {
      const catResults = results.filter(r => PROBLEMS.find(p => p.id === r.problemId).category === cat);
      const catCorrect = catResults.filter(r => r.correct).length;
      console.log(`    ${cat}: ${catCorrect}/${catResults.length}`);
    }

    // Show misses
    const misses = results.filter(r => !r.correct);
    if (misses.length > 0) {
      console.log(`  Misses:`);
      for (const m of misses) {
        console.log(`    P${m.problemId}: expected=${m.expected}, got=${m.parsed}`);
      }
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log('Condition                | Score  | %');
  console.log('-------------------------|--------|------');
  for (let c = 1; c <= 5; c++) {
    const s = conditionScores[c];
    console.log(`${s.name.padEnd(25)}| ${s.correct}/${s.total}   | ${s.pct}%`);
  }

  // Category breakdown across conditions
  console.log('\nCategory Breakdown:');
  console.log('Category            | C1  | C2  | C3  | C4  | C5');
  console.log('--------------------|-----|-----|-----|-----|-----');
  for (const cat of ['Probability/Bayes', 'Optimization', 'Multi-step Logic']) {
    const row = [cat.padEnd(20)];
    for (let c = 1; c <= 5; c++) {
      const catResults = allResults.filter(r => r.condition === c && PROBLEMS.find(p => p.id === r.problemId).category === cat);
      const catCorrect = catResults.filter(r => r.correct).length;
      row.push(`${catCorrect}/5`.padStart(4));
    }
    console.log(row.join(' | '));
  }

  // Build output
  const output = {
    experiment: 'KI-3 Stage-Wise Switching v2 (Fast)',
    model: MODEL,
    temperature: TEMPERATURE,
    timestamp: new Date().toISOString(),
    problems: PROBLEMS.map(p => ({
      id: p.id, category: p.category, problem: p.problem,
      answer: p.answer, unit: p.unit,
    })),
    conditions: Object.fromEntries(
      Object.entries(conditionScores).map(([k, v]) => [k, v])
    ),
    results: allResults.map(r => ({
      problemId: r.problemId,
      condition: r.condition,
      conditionName: r.conditionName,
      correct: r.correct,
      expected: r.expected,
      parsed: r.parsed,
      rxOutput: r.rxOutput,
      txTransmitted: r.txTransmitted,
    })),
    summary: {
      conditionScores,
      categoryBreakdown: {},
    },
  };

  // Add category breakdown to summary
  for (const cat of ['Probability/Bayes', 'Optimization', 'Multi-step Logic']) {
    output.summary.categoryBreakdown[cat] = {};
    for (let c = 1; c <= 5; c++) {
      const catResults = allResults.filter(r => r.condition === c && PROBLEMS.find(p => p.id === r.problemId).category === cat);
      output.summary.categoryBreakdown[cat][`C${c}`] = catResults.filter(r => r.correct).length;
    }
  }

  const outPath = 'C:/Users/hyunj/wcisl/scripts/ki3_v2_fast_results.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
