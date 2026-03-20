/**
 * KI-3 Stage-Wise Switching Experiment (GPT-4o)
 *
 * BOTH Tx and Rx use GPT-4o (not mini) to avoid arithmetic errors.
 * Tx uses 3-stage chain: Stage1 -> Stage2 -> Stage3
 * Only Stage3 output is transmitted to Rx.
 * Rx produces the final answer.
 *
 * 5 conditions x 15 hard problems = 75 trials
 * Model: GPT-4o, Temperature=0, Batch concurrency: 5
 */

import { readFileSync, writeFileSync } from 'fs';

// Load API key
const envContent = readFileSync('C:/Users/hyunj/studyeng/.env.local', 'utf-8');
const OPENAI_API_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!OPENAI_API_KEY) throw new Error('No API key found');

const MODEL = 'gpt-4o';
const TEMPERATURE = 0;
const API_URL = 'https://api.openai.com/v1/chat/completions';

// ─── 15 Hard Problems ───
const PROBLEMS = [
  // Probability (1-5)
  { id: 1, category: 'probability', text: 'A disease has 1% prevalence. A test has 95% sensitivity and 95% specificity. What is P(disease | positive test result)? Give the answer as a percentage.', answer: 16.1 },
  { id: 2, category: 'probability', text: '3 urns: A has 5 red & 3 blue balls, B has 2 red & 6 blue, C has 4 red & 4 blue. Pick a random urn, draw one ball, it is red. What is P(urn A was chosen)? Give as percentage.', answer: 45.5 },
  { id: 3, category: 'probability', text: 'P(spam)=0.3, P("free"|spam)=0.8, P("free"|not spam)=0.1. What is P(spam|"free")? Give as percentage.', answer: 77.4 },
  { id: 4, category: 'probability', text: 'Machine1 produces 60% of items with 2% defect rate. Machine2 produces 40% with 5% defect rate. A defective item is found. P(Machine1 | defective)? Give as percentage.', answer: 37.5 },
  { id: 5, category: 'probability', text: 'Monty Hall problem: you picked door 1, host opens door 3 (goat). What is P(car behind door 2)? Give as percentage.', answer: 66.7 },
  // Optimization (6-10)
  { id: 6, category: 'optimization', text: 'You have 100m of fence to enclose a rectangular area along a river (river is one side, no fence needed). What is the maximum area in square meters?', answer: 1250 },
  { id: 7, category: 'optimization', text: 'An open-top box with a square base must have volume 1000 cm³. What side length of the base minimizes the total surface area? Give in cm.', answer: 10 },
  { id: 8, category: 'optimization', text: 'Find the global maximum value of f(x) = x³ - 6x² + 9x + 1 on the interval [0, 5].', answer: 21 },
  { id: 9, category: 'optimization', text: 'A farmer has 200m of fencing to enclose a rectangular field. What is the maximum area in square meters?', answer: 2500 },
  { id: 10, category: 'optimization', text: 'Product A gives $5 profit and uses 2 hours of labor. Product B gives $8 profit and uses 3 hours. You have 120 hours available. Maximize total profit. What is the max profit in dollars?', answer: 320 },
  // Multi-step (11-15)
  { id: 11, category: 'multistep', text: 'A clock gains 5 minutes every hour. It is set correctly at noon. What is the real time when the clock shows 6:00 PM? Give answer as total real minutes elapsed since noon.', answer: 300, tolerance: (v) => { const n = extractNumber(v); return n !== null && Math.abs(n - 300) < 30; } },
  { id: 12, category: 'multistep', text: 'Two trains are 300km apart heading toward each other at 60 km/h and 90 km/h. A fly starts at one train and bounces between them at 120 km/h until they meet. Total distance flown by the fly in km?', answer: 240 },
  { id: 13, category: 'multistep', text: "A rope is wrapped tightly around Earth's equator (circumference 40000 km). You add 1 meter of rope. If the rope is lifted uniformly, how high above the surface in meters? Give to 3 decimal places.", answer: 0.159 },
  { id: 14, category: 'multistep', text: '100 lockers in a row, all closed. Student 1 opens all. Student 2 toggles every 2nd. Student k toggles every k-th locker, for k=1..100. How many lockers are open at the end?', answer: 10 },
  { id: 15, category: 'multistep', text: 'A 16-player single-elimination tournament. How many total games are played?', answer: 15 },
];

// ─── Condition Definitions (exact prompts from spec) ───
const CONDITIONS = {
  'all-general': {
    label: 'All General',
    txStages: [
      { system: 'Solve step by step with full reasoning.' },
      { system: 'Solve step by step with full reasoning.' },
      { system: 'Solve step by step with full reasoning.' },
    ],
    rxStages: [
      { system: 'Read the solution and extract the final numeric answer. Output ONLY a number.' },
    ],
  },
  'all-audience': {
    label: 'All Audience-Aware',
    txStages: [
      { system: 'The recipient is a math expert. Be extremely concise. Use notation. Skip obvious steps. Minimize tokens.' },
      { system: 'The recipient is a math expert. Be extremely concise. Use notation. Skip obvious steps. Minimize tokens.' },
      { system: 'The recipient is a math expert. Be extremely concise. Use notation. Skip obvious steps. Minimize tokens.' },
    ],
    rxStages: [
      { system: 'You are a math expert. Interpret the compact message and extract the answer. Output ONLY a number.' },
    ],
  },
  'tx-switch': {
    label: 'Tx-Only Switch',
    txStages: [
      { system: 'Solve step by step with full detailed reasoning.' },
      { system: 'Solve step by step with full detailed reasoning.' },
      { system: 'Now compress your full solution into a minimal message for a math expert. Include only essential steps and the final answer.' },
    ],
    rxStages: [
      { system: 'Read the solution and extract the final numeric answer. Output ONLY a number.' },
    ],
  },
  'both-switch': {
    label: 'Both Switch',
    txStages: [
      { system: 'Solve step by step with full detailed reasoning.' },
      { system: 'Solve step by step with full detailed reasoning.' },
      { system: 'Compress your solution for a math expert recipient. Essential steps and final answer only.' },
    ],
    rxStages: [
      { system: 'You received a compressed solution from a math expert. Decompress it: expand the notation, verify each step, and reconstruct the full reasoning.' },
      { system: 'Based on your decompressed analysis, state the final numeric answer. Output ONLY a number.' },
    ],
  },
  'reverse': {
    label: 'Reverse Switch',
    txStages: [
      { system: 'Be concise. Just outline the approach briefly.' },
      { system: 'Now solve in full detail with complete reasoning.' },
      { system: 'Now solve in full detail with complete reasoning.' },
    ],
    rxStages: [
      { system: 'Read the solution freely.' },
      { system: 'Extract the final answer. Output ONLY a number.' },
    ],
  },
};

// ─── API Call ───
let totalAPITokens = { prompt: 0, completion: 0 };

async function callLLM(system, userMsg, retries = 8) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: TEMPERATURE,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
          const wait = Math.min((attempt + 1) * 15000, 60000);
          console.log(`  Rate limited (attempt ${attempt + 1}/${retries}), waiting ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const usage = data.usage || {};
      totalAPITokens.prompt += usage.prompt_tokens || 0;
      totalAPITokens.completion += usage.completion_tokens || 0;
      const content = data.choices[0].message.content;
      return { content, usage };
    } catch (e) {
      if (attempt === retries - 1) throw e;
      const wait = Math.min((attempt + 1) * 5000, 30000);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// ─── Extract number from text ───
function extractNumber(text) {
  const cleaned = text.replace(/,/g, '').replace(/%/g, '');
  const matches = cleaned.match(/-?\d+\.?\d*/g);
  if (!matches) return null;
  return parseFloat(matches[matches.length - 1]);
}

function countApproxTokens(text) {
  return Math.ceil(text.length / 4);
}

// ─── Run a single trial ───
async function runTrial(problem, conditionKey) {
  const cond = CONDITIONS[conditionKey];
  const txStages = cond.txStages;
  const rxStages = cond.rxStages;

  let txTokens = { prompt: 0, completion: 0 };
  let rxTokens = { prompt: 0, completion: 0 };
  let stageOutputs = [];

  // ── Tx 3-stage chain ──
  let prevOutput = problem.text;
  for (let i = 0; i < 3; i++) {
    const userMsg = i === 0 ? problem.text : `Previous analysis:\n${prevOutput}\n\nContinue.`;
    const { content, usage } = await callLLM(txStages[i].system, userMsg);
    txTokens.prompt += usage.prompt_tokens || 0;
    txTokens.completion += usage.completion_tokens || 0;
    stageOutputs.push(content);
    prevOutput = content;
  }

  // The transmitted message is stage 3 output
  const transmitted = stageOutputs[2];
  const msgTokens = countApproxTokens(transmitted);

  // ── Rx stages ──
  let rxPrev = transmitted;
  let rxOutput = '';
  for (let i = 0; i < rxStages.length; i++) {
    const userMsg = i === 0 ? transmitted : `Previous interpretation:\n${rxPrev}\n\nContinue.`;
    const { content, usage } = await callLLM(rxStages[i].system, userMsg);
    rxTokens.prompt += usage.prompt_tokens || 0;
    rxTokens.completion += usage.completion_tokens || 0;
    rxPrev = content;
    rxOutput = content;
  }

  // ── Grade ──
  const extracted = extractNumber(rxOutput);
  let correct = false;
  if (problem.tolerance) {
    correct = problem.tolerance(rxOutput);
  } else if (extracted !== null) {
    const tol = Math.abs(problem.answer) * 0.10;
    correct = Math.abs(extracted - problem.answer) <= Math.max(tol, 0.5);
  }

  return {
    problemId: problem.id,
    condition: conditionKey,
    correct,
    expected: problem.answer,
    extracted,
    rxOutput: rxOutput.slice(0, 200),
    msgTokens,
    txTokens: txTokens.prompt + txTokens.completion,
    rxTokens: rxTokens.prompt + rxTokens.completion,
    totalTokens: txTokens.prompt + txTokens.completion + rxTokens.prompt + rxTokens.completion,
    transmittedMsg: transmitted.slice(0, 500),
  };
}

// ─── Batch runner ───
async function runBatch(tasks, batchSize = 5) {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    console.log(`  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tasks.length / batchSize)}...`);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
    if (i + batchSize < tasks.length) {
      await new Promise(r => setTimeout(r, 2000)); // pause between batches for gpt-4o rate limits
    }
  }
  return results;
}

// ─── Main ───
async function main() {
  console.log('=== KI-3 Stage-Wise Switching Experiment (GPT-4o) ===');
  console.log(`Model: ${MODEL} | Temperature: ${TEMPERATURE}`);
  console.log(`Problems: ${PROBLEMS.length} | Conditions: ${Object.keys(CONDITIONS).length}`);
  console.log(`Total trials: ${PROBLEMS.length * Object.keys(CONDITIONS).length}\n`);

  const allTasks = [];
  for (const condKey of Object.keys(CONDITIONS)) {
    for (const problem of PROBLEMS) {
      allTasks.push(() => {
        console.log(`    ${condKey} | P${problem.id}`);
        return runTrial(problem, condKey);
      });
    }
  }

  const startTime = Date.now();
  const results = await runBatch(allTasks, 3);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ─── Aggregate by condition ───
  const summary = {};
  for (const condKey of Object.keys(CONDITIONS)) {
    const condResults = results.filter(r => r.condition === condKey);
    const correct = condResults.filter(r => r.correct).length;
    const avgMsgTokens = condResults.reduce((s, r) => s + r.msgTokens, 0) / condResults.length;
    const avgTxTokens = condResults.reduce((s, r) => s + r.txTokens, 0) / condResults.length;
    const avgRxTokens = condResults.reduce((s, r) => s + r.rxTokens, 0) / condResults.length;
    const avgTotalTokens = condResults.reduce((s, r) => s + r.totalTokens, 0) / condResults.length;

    const byCat = {};
    for (const cat of ['probability', 'optimization', 'multistep']) {
      const catResults = condResults.filter(r => PROBLEMS.find(p => p.id === r.problemId).category === cat);
      byCat[cat] = {
        correct: catResults.filter(r => r.correct).length,
        total: catResults.length,
        accuracy: ((catResults.filter(r => r.correct).length / catResults.length) * 100).toFixed(1),
      };
    }

    summary[condKey] = {
      label: CONDITIONS[condKey].label,
      accuracy: ((correct / condResults.length) * 100).toFixed(1),
      correct,
      total: condResults.length,
      avgMsgTokens: Math.round(avgMsgTokens),
      avgTxTokens: Math.round(avgTxTokens),
      avgRxTokens: Math.round(avgRxTokens),
      avgTotalTokens: Math.round(avgTotalTokens),
      byCategory: byCat,
    };
  }

  // ─── Print Summary Table ───
  console.log('\n' + '='.repeat(110));
  console.log('RESULTS SUMMARY (GPT-4o)');
  console.log('='.repeat(110));
  console.log(
    'Condition'.padEnd(22) +
    'Accuracy'.padEnd(12) +
    'MsgTok'.padEnd(10) +
    'TxTok'.padEnd(10) +
    'RxTok'.padEnd(10) +
    'TotalTok'.padEnd(10) +
    'Prob'.padEnd(10) +
    'Opt'.padEnd(10) +
    'Multi'.padEnd(10)
  );
  console.log('-'.repeat(110));

  for (const [key, s] of Object.entries(summary)) {
    console.log(
      s.label.padEnd(22) +
      `${s.accuracy}%`.padEnd(12) +
      `${s.avgMsgTokens}`.padEnd(10) +
      `${s.avgTxTokens}`.padEnd(10) +
      `${s.avgRxTokens}`.padEnd(10) +
      `${s.avgTotalTokens}`.padEnd(10) +
      `${s.byCategory.probability.accuracy}%`.padEnd(10) +
      `${s.byCategory.optimization.accuracy}%`.padEnd(10) +
      `${s.byCategory.multistep.accuracy}%`.padEnd(10)
    );
  }

  console.log('-'.repeat(110));
  console.log(`\nTotal API tokens: prompt=${totalAPITokens.prompt}, completion=${totalAPITokens.completion}, total=${totalAPITokens.prompt + totalAPITokens.completion}`);
  console.log(`Elapsed: ${elapsed}s`);

  // ─── Per-problem detail ───
  console.log('\n' + '='.repeat(110));
  console.log('PER-PROBLEM DETAIL');
  console.log('='.repeat(110));
  for (const problem of PROBLEMS) {
    const pResults = results.filter(r => r.problemId === problem.id);
    const correctConds = pResults.filter(r => r.correct).map(r => r.condition);
    const wrongConds = pResults.filter(r => !r.correct).map(r => `${r.condition}(got:${r.extracted})`);
    console.log(`P${problem.id} [${problem.category}] expected=${problem.answer} | PASS: ${correctConds.join(', ') || 'none'} | FAIL: ${wrongConds.join(', ') || 'none'}`);
  }

  // ─── Efficiency analysis ───
  console.log('\n' + '='.repeat(110));
  console.log('EFFICIENCY ANALYSIS');
  console.log('='.repeat(110));
  const txSwitch = summary['tx-switch'];
  const bothSwitch = summary['both-switch'];
  console.log(`Tx-Only Switch:  accuracy=${txSwitch.accuracy}%  msg=${txSwitch.avgMsgTokens}tok  total=${txSwitch.avgTotalTokens}tok`);
  console.log(`Both Switch:     accuracy=${bothSwitch.accuracy}%  msg=${bothSwitch.avgMsgTokens}tok  total=${bothSwitch.avgTotalTokens}tok`);
  const accDiff = (parseFloat(bothSwitch.accuracy) - parseFloat(txSwitch.accuracy)).toFixed(1);
  const tokDiff = ((bothSwitch.avgTotalTokens - txSwitch.avgTotalTokens) / txSwitch.avgTotalTokens * 100).toFixed(1);
  console.log(`Both vs Tx-Only: accuracy diff = ${accDiff}pp, token overhead = ${tokDiff}%`);
  if (parseFloat(accDiff) > 0) {
    console.log('>>> GPT-4o Rx decompression adds value (hypothesis confirmed)');
  } else {
    console.log('>>> GPT-4o Rx decompression did NOT help (hypothesis rejected)');
  }

  // ─── Save JSON ───
  const output = {
    experiment: 'KI-3 Stage-Wise Switching (GPT-4o)',
    model: MODEL,
    temperature: TEMPERATURE,
    timestamp: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    totalAPITokens,
    problems: PROBLEMS.map(p => ({ id: p.id, category: p.category, text: p.text, answer: p.answer })),
    conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([k, v]) => [k, {
      label: v.label,
      txStages: v.txStages.map(s => s.system),
      rxStages: v.rxStages.map(s => s.system),
    }])),
    summary,
    results: results.map(r => ({
      problemId: r.problemId,
      condition: r.condition,
      correct: r.correct,
      expected: r.expected,
      extracted: r.extracted,
      rxOutput: r.rxOutput,
      msgTokens: r.msgTokens,
      txTokens: r.txTokens,
      rxTokens: r.rxTokens,
      totalTokens: r.totalTokens,
      transmittedMsg: r.transmittedMsg,
    })),
  };

  writeFileSync('C:/Users/hyunj/wcisl/scripts/ki3_gpt4o_results.json', JSON.stringify(output, null, 2));
  console.log('\nResults saved to ki3_gpt4o_results.json');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
