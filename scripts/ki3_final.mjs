/**
 * KI-3 Stage-Wise Switching Experiment (Final)
 *
 * Tx uses 3-stage chain: Stage1 -> Stage2 -> Stage3
 * Only Stage3 output is transmitted to Rx.
 * Rx produces the final answer.
 *
 * 5 conditions x 15 hard problems = 75 trials
 * Both agents: GPT-4o-mini, Temperature=0
 * Batch concurrency: 5
 */

import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';

// Load API key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error("Set OPENAI_API_KEY env var"); process.exit(1); }
if (!OPENAI_API_KEY) throw new Error('No API key found');

const MODEL = 'gpt-4o-mini';
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
  { id: 11, category: 'multistep', text: 'A clock gains 5 minutes every hour. It is set correctly at noon. What is the real time when the clock shows 6:00 PM? Give answer as HH:MM (in real time).', answer: 5 * 60, answerAlt: '5:00 PM', tolerance: (v) => { const mins = parseTimeToMinutes(v); return mins !== null && Math.abs(mins - 300) < 15; } },
  { id: 12, category: 'multistep', text: 'Two trains are 300km apart heading toward each other at 60 km/h and 90 km/h. A fly starts at one train and bounces between them at 120 km/h until they meet. Total distance flown by the fly in km?', answer: 240 },
  { id: 13, category: 'multistep', text: 'A rope is wrapped tightly around Earth\'s equator (circumference 40000 km). You add 1 meter of rope. If the rope is lifted uniformly, how high above the surface (in meters, to 3 decimal places)?', answer: 0.159 },
  { id: 14, category: 'multistep', text: '100 lockers in a row, all closed. Student 1 opens all. Student 2 toggles every 2nd. Student k toggles every k-th locker, for k=1..100. How many lockers are open at the end?', answer: 10 },
  { id: 15, category: 'multistep', text: 'A 16-player single-elimination tournament. How many total games are played?', answer: 15 },
];

function parseTimeToMinutes(text) {
  // Try to parse "5:00 PM" or "17:00" or just "5" hours
  const pmMatch = text.match(/(\d{1,2}):(\d{2})\s*(PM|AM)/i);
  if (pmMatch) {
    let h = parseInt(pmMatch[1]);
    const m = parseInt(pmMatch[2]);
    if (pmMatch[3].toUpperCase() === 'PM' && h < 12) h += 12;
    if (pmMatch[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  const milMatch = text.match(/(\d{1,2}):(\d{2})/);
  if (milMatch) {
    return parseInt(milMatch[1]) * 60 + parseInt(milMatch[2]);
  }
  return null;
}

// ─── Condition Definitions ───
const CONDITIONS = {
  'all-general': {
    label: 'All General',
    txStages: [
      { system: 'You are a math problem solver. Solve the given problem step by step with full reasoning.' },
      { system: 'You are a math problem solver. Continue solving step by step. Build on the previous analysis.' },
      { system: 'You are a math problem solver. Provide the final clean solution with the numeric answer clearly stated.' },
    ],
    rxStages: [
      { system: 'Extract the final numeric answer from the given solution. Output ONLY the number.' },
    ],
  },
  'all-audience': {
    label: 'All Audience-Aware',
    txStages: [
      { system: 'You are solving a math problem. The recipient is a math expert. Be extremely concise. Use mathematical notation. No verbose explanations.' },
      { system: 'Continue. Stay concise. Math notation only. Expert audience.' },
      { system: 'Final answer for math expert. Minimal text. Key steps + answer only.' },
    ],
    rxStages: [
      { system: 'You are a math expert. Interpret the compact mathematical message. Extract the final numeric answer. Output ONLY the number.' },
    ],
  },
  'tx-switch': {
    label: 'Tx-Only Switch',
    txStages: [
      { system: 'You are a math problem solver. Solve step by step with full detailed reasoning.' },
      { system: 'Continue with full detailed step-by-step reasoning. Show all work.' },
      { system: 'Now compress your solution for a math expert recipient. Include only essential steps and the final answer. Use compact notation.' },
    ],
    rxStages: [
      { system: 'Extract the final numeric answer from the given message. Output ONLY the number.' },
    ],
  },
  'both-switch': {
    label: 'Both Switch',
    txStages: [
      { system: 'You are a math problem solver. Solve step by step with full detailed reasoning.' },
      { system: 'Continue with full detailed step-by-step reasoning. Show all work.' },
      { system: 'Now compress your solution for a math expert recipient. Include only essential steps and the final answer. Use compact notation.' },
    ],
    rxStages: [
      { system: 'You receive a compact mathematical message. Decompress it: interpret all notation and reconstruct the full reasoning.' },
      { system: 'Based on your interpretation, verify the solution and state the final numeric answer. Output ONLY the number.' },
    ],
  },
  'reverse': {
    label: 'Reverse',
    txStages: [
      { system: 'Be concise. Outline the approach to solve this problem in minimal words.' },
      { system: 'Now solve the problem in full detail. Show all steps and calculations.' },
      { system: 'Present the complete detailed solution with the final answer clearly stated.' },
    ],
    rxStages: [
      { system: 'Read the following solution freely and extract the final numeric answer. Output ONLY the number.' },
      { system: 'Interpret this as a compact message. Extract the number. Output ONLY the number.' },
    ],
  },
};

// ─── API Call ───
let totalAPITokens = { prompt: 0, completion: 0 };

async function callLLM(system, userMsg, retries = 3) {
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
          const wait = (attempt + 1) * 5000;
          console.log(`  Rate limited, waiting ${wait}ms...`);
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
      await new Promise(r => setTimeout(r, 2000));
    }
  }
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

function extractNumber(text) {
  // Try to find numbers in text
  const cleaned = text.replace(/,/g, '').replace(/%/g, '');
  // Look for the last standalone number
  const matches = cleaned.match(/-?\d+\.?\d*/g);
  if (!matches) return null;
  // Prefer the last number (usually the final answer)
  return parseFloat(matches[matches.length - 1]);
}

function countApproxTokens(text) {
  // Rough approximation: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// ─── Batch runner ───
async function runBatch(tasks, batchSize = 5) {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
    if (i + batchSize < tasks.length) {
      await new Promise(r => setTimeout(r, 500)); // small pause between batches
    }
  }
  return results;
}

// ─── Main ───
async function main() {
  console.log('=== KI-3 Stage-Wise Switching Experiment (Final) ===');
  console.log(`Model: ${MODEL} | Problems: ${PROBLEMS.length} | Conditions: ${Object.keys(CONDITIONS).length}`);
  console.log(`Total trials: ${PROBLEMS.length * Object.keys(CONDITIONS).length}\n`);

  const allTasks = [];
  for (const condKey of Object.keys(CONDITIONS)) {
    for (const problem of PROBLEMS) {
      allTasks.push(() => {
        console.log(`  Running: ${condKey} | Problem ${problem.id}`);
        return runTrial(problem, condKey);
      });
    }
  }

  const startTime = Date.now();
  const results = await runBatch(allTasks, 5);
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

    // By category
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
  console.log('\n' + '='.repeat(100));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(100));
  console.log(
    'Condition'.padEnd(20) +
    'Accuracy'.padEnd(12) +
    'MsgTok'.padEnd(10) +
    'TxTok'.padEnd(10) +
    'RxTok'.padEnd(10) +
    'TotalTok'.padEnd(10) +
    'Prob'.padEnd(8) +
    'Opt'.padEnd(8) +
    'Multi'.padEnd(8)
  );
  console.log('-'.repeat(100));

  for (const [key, s] of Object.entries(summary)) {
    console.log(
      s.label.padEnd(20) +
      `${s.accuracy}%`.padEnd(12) +
      `${s.avgMsgTokens}`.padEnd(10) +
      `${s.avgTxTokens}`.padEnd(10) +
      `${s.avgRxTokens}`.padEnd(10) +
      `${s.avgTotalTokens}`.padEnd(10) +
      `${s.byCategory.probability.accuracy}%`.padEnd(8) +
      `${s.byCategory.optimization.accuracy}%`.padEnd(8) +
      `${s.byCategory.multistep.accuracy}%`.padEnd(8)
    );
  }

  console.log('-'.repeat(100));
  console.log(`\nTotal API tokens: prompt=${totalAPITokens.prompt}, completion=${totalAPITokens.completion}, total=${totalAPITokens.prompt + totalAPITokens.completion}`);
  console.log(`Elapsed: ${elapsed}s`);

  // ─── Per-problem detail ───
  console.log('\n' + '='.repeat(100));
  console.log('PER-PROBLEM DETAIL');
  console.log('='.repeat(100));
  for (const problem of PROBLEMS) {
    const pResults = results.filter(r => r.problemId === problem.id);
    const correctConds = pResults.filter(r => r.correct).map(r => r.condition);
    const wrongConds = pResults.filter(r => !r.correct).map(r => `${r.condition}(got:${r.extracted})`);
    console.log(`P${problem.id} [${problem.category}] expected=${problem.answer} | PASS: ${correctConds.join(',')||'none'} | FAIL: ${wrongConds.join(',')||'none'}`);
  }

  // ─── Save JSON ───
  const output = {
    experiment: 'KI-3 Stage-Wise Switching (Final)',
    model: MODEL,
    temperature: TEMPERATURE,
    timestamp: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    totalAPITokens,
    problems: PROBLEMS.map(p => ({ id: p.id, category: p.category, text: p.text, answer: p.answer })),
    conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([k, v]) => [k, { label: v.label }])),
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

  writeFileSync('C:/Users/hyunj/wcisl/scripts/ki3_final_results.json', JSON.stringify(output, null, 2));
  console.log('\nResults saved to ki3_final_results.json');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
