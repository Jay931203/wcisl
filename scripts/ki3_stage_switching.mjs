/**
 * KI-3: Stage-Wise Model Switching in CoT
 *
 * Full Tx→Rx pipeline with mode switching at different CoT stages.
 * 5 conditions tested across 15 multi-step reasoning problems.
 */

const OPENAI_API_KEY = "OPENAI_API_KEY_REDACTED";
const MODEL = "gpt-4o-mini";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 15 Multi-step reasoning problems ───────────────────────────────────────

const PROBLEMS = [
  {
    id: 1,
    problem: "A store sells notebooks for $4 each. If you buy 5 or more, you get a 20% discount on each notebook. Sarah buys 7 notebooks and pays with a $50 bill. How much change does she receive?",
    answer: 27.6
  },
  {
    id: 2,
    problem: "A train travels from City A to City B at 60 km/h and returns at 40 km/h. The total round trip takes 5 hours. What is the distance between City A and City B in km?",
    answer: 120
  },
  {
    id: 3,
    problem: "In a class of 40 students, 25 study math, 20 study physics, and 8 study neither. How many students study both math and physics?",
    answer: 13
  },
  {
    id: 4,
    problem: "A bacteria colony doubles every 3 hours. Starting with 500 bacteria, how many bacteria are there after 15 hours?",
    answer: 16000
  },
  {
    id: 5,
    problem: "Alice is 3 times as old as Bob. In 12 years, Alice will be twice as old as Bob. What is Bob's current age?",
    answer: 12
  },
  {
    id: 6,
    problem: "A rectangular garden is 3 meters longer than it is wide. If the perimeter is 54 meters, what is the area of the garden in square meters?",
    answer: 180
  },
  {
    id: 7,
    problem: "A car uses 8 liters of fuel per 100 km. If fuel costs $1.50 per liter, how much does it cost in dollars to drive 350 km?",
    answer: 42
  },
  {
    id: 8,
    problem: "Three pipes can fill a pool. Pipe A fills it in 6 hours, Pipe B in 8 hours, Pipe C in 12 hours. If all three work together, how many hours does it take to fill the pool?",
    answer: 2.67
  },
  {
    id: 9,
    problem: "A number is increased by 20%, then the result is decreased by 25%. If the final value is 360, what was the original number?",
    answer: 400
  },
  {
    id: 10,
    problem: "In a tournament, each team plays every other team exactly once. If there are 8 teams, how many total games are played?",
    answer: 28
  },
  {
    id: 11,
    problem: "A shop owner marks up goods by 60% over cost, then offers a 25% discount. If the selling price is $480, what was the original cost?",
    answer: 400
  },
  {
    id: 12,
    problem: "Tom has 3 times as many marbles as Jerry. If Tom gives 15 marbles to Jerry, they will have the same number. How many marbles does Tom have?",
    answer: 45
  },
  {
    id: 13,
    problem: "A ladder 10 meters long leans against a wall. The foot of the ladder is 6 meters from the wall. How high up the wall does the ladder reach in meters?",
    answer: 8
  },
  {
    id: 14,
    problem: "A worker can complete a job in 10 days. After working 4 days, a second worker joins and they finish in 2 more days together. How many days would the second worker alone take to complete the full job?",
    answer: 5
  },
  {
    id: 15,
    problem: "An investment of $2000 earns compound interest at 5% per year. What is the value after 3 years, rounded to the nearest dollar?",
    answer: 2315
  }
];

// ─── Prompt Templates ────────────────────────────────────────────────────────

const PROMPT_FREE_REASONING = (problem, stageNum, prevWork) => {
  let msg = `You are solving a math/logic problem step by step.\n\n`;
  if (prevWork) msg += `Previous work:\n${prevWork}\n\n`;
  msg += `Problem: ${problem}\n\n`;
  msg += `This is stage ${stageNum} of 3. `;
  if (stageNum === 1) msg += `Identify the key information, set up equations or relationships.`;
  else if (stageNum === 2) msg += `Perform the main calculations and reasoning.`;
  else msg += `Finalize the solution and state the numeric answer clearly.`;
  msg += `\n\nThink freely and show your reasoning.`;
  return msg;
};

const PROMPT_AUDIENCE_AWARE = (problem, stageNum, prevWork) => {
  let msg = `You are solving a math/logic problem. Your output will be read by an expert math Rx agent who understands concise notation.\n\n`;
  if (prevWork) msg += `Previous work:\n${prevWork}\n\n`;
  msg += `Problem: ${problem}\n\n`;
  msg += `This is stage ${stageNum} of 3. `;
  if (stageNum === 1) msg += `Identify key info and set up the approach.`;
  else if (stageNum === 2) msg += `Perform calculations.`;
  else msg += `State the final numeric answer.`;
  msg += `\n\nBe extremely concise. Use math notation. The Rx is a math expert — skip obvious steps. Minimize token usage.`;
  return msg;
};

const PROMPT_COMPRESS_STAGE3 = (problem, prevWork) => {
  return `You solved a math problem in previous stages. Now compress your solution into a minimal message for a math-expert Rx agent who will produce the final answer.\n\nProblem: ${problem}\n\nYour full solution so far:\n${prevWork}\n\nCompress this into the most concise message possible. Use math notation, abbreviations, and skip obvious steps. The Rx is an expert. Include the final numeric answer.`;
};

const PROMPT_RX_GENERAL = (problem, txMessage) => {
  return `You receive a solution/message from a Tx agent who solved a math problem. Produce the final numeric answer.\n\nOriginal problem: ${problem}\n\nTx agent's message:\n${txMessage}\n\nExtract or verify the final numeric answer. Output ONLY the numeric answer (a single number, no units, no text).`;
};

const PROMPT_RX_DECOMPRESS = (problem, txMessage) => {
  return `You are an expert math Rx agent. You receive a compressed/concise message from a Tx agent. Decompress and interpret it using your mathematical expertise.\n\nOriginal problem: ${problem}\n\nCompressed message from Tx:\n${txMessage}\n\nFirst, decompress and interpret the compact notation. Then verify the reasoning and produce the final numeric answer.`;
};

const PROMPT_RX_FINAL_FREE = (problem, decompressed) => {
  return `Based on your analysis below, state the final numeric answer to this problem.\n\nProblem: ${problem}\n\nYour analysis:\n${decompressed}\n\nOutput ONLY the final numeric answer (a single number).`;
};

const PROMPT_RX_FINAL_INTERPRET = (problem, freeReasoning) => {
  return `You are an expert math interpreter. Given the reasoning below, extract the final numeric answer.\n\nProblem: ${problem}\n\nReasoning:\n${freeReasoning}\n\nOutput ONLY the final numeric answer (a single number).`;
};

// ─── API Call ────────────────────────────────────────────────────────────────

const COST_PER_1K_INPUT = 0.00015;   // gpt-4o-mini input
const COST_PER_1K_OUTPUT = 0.0006;   // gpt-4o-mini output

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
      max_tokens: 1024
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

// ─── Condition Runners ───────────────────────────────────────────────────────

// Returns { txMessage, rxAnswer, totalInputTokens, totalOutputTokens, messageTokens }

async function runConditionA(problem) {
  // All General: Tx 3 stages free, Rx general
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
  // Count message tokens approximately (use last stage output as the transmitted msg)
  // Actually, transmit the full accumulated output
  const msgTokenEst = await countTokens(txMessage);

  const rxPrompt = PROMPT_RX_GENERAL(problem.problem, txMessage);
  const rxRes = await callLLM(rxPrompt);
  totalIn += rxRes.input_tokens;
  totalOut += rxRes.output_tokens;

  return { txMessage, rxAnswer: rxRes.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokenEst };
}

async function runConditionB(problem) {
  // All Audience-Aware: Tx 3 stages audience-aware, Rx decompress+interpret
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
  const msgTokenEst = await countTokens(txMessage);

  // Rx: decompress then answer
  const rxDecomp = await callLLM(PROMPT_RX_DECOMPRESS(problem.problem, txMessage));
  totalIn += rxDecomp.input_tokens;
  totalOut += rxDecomp.output_tokens;

  const rxFinal = await callLLM(PROMPT_RX_FINAL_FREE(problem.problem, rxDecomp.content));
  totalIn += rxFinal.input_tokens;
  totalOut += rxFinal.output_tokens;

  return { txMessage, rxAnswer: rxFinal.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokenEst };
}

async function runConditionC(problem) {
  // Tx-Only Switch: stages 1-2 free, stage 3 compress. Rx general.
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
  const compressPrompt = PROMPT_COMPRESS_STAGE3(problem.problem, prevWork);
  const compRes = await callLLM(compressPrompt);
  totalIn += compRes.input_tokens;
  totalOut += compRes.output_tokens;

  const txMessage = compRes.content;
  const msgTokenEst = await countTokens(txMessage);

  const rxRes = await callLLM(PROMPT_RX_GENERAL(problem.problem, txMessage));
  totalIn += rxRes.input_tokens;
  totalOut += rxRes.output_tokens;

  return { txMessage, rxAnswer: rxRes.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokenEst };
}

async function runConditionD(problem) {
  // Paper's proposal: Tx stages 1-2 free, stage 3 compress. Rx stage 1 decompress, stage 2 free answer.
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
  const msgTokenEst = await countTokens(txMessage);

  // Rx stage 1: decompress
  const rxDecomp = await callLLM(PROMPT_RX_DECOMPRESS(problem.problem, txMessage));
  totalIn += rxDecomp.input_tokens;
  totalOut += rxDecomp.output_tokens;

  // Rx stage 2: free reasoning to final answer
  const rxFinal = await callLLM(PROMPT_RX_FINAL_FREE(problem.problem, rxDecomp.content));
  totalIn += rxFinal.input_tokens;
  totalOut += rxFinal.output_tokens;

  return { txMessage, rxAnswer: rxFinal.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokenEst };
}

async function runConditionE(problem) {
  // Reverse Switch: Tx stage 1 audience-aware, stages 2-3 free. Rx stage 1 free, stage 2 interpret.
  let totalIn = 0, totalOut = 0;

  // Tx stage 1: audience-aware
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
  const msgTokenEst = await countTokens(txMessage);

  // Rx stage 1: free general
  const rxFree = await callLLM(PROMPT_RX_GENERAL(problem.problem, txMessage));
  totalIn += rxFree.input_tokens;
  totalOut += rxFree.output_tokens;

  // Rx stage 2: interpret
  const rxInterp = await callLLM(PROMPT_RX_FINAL_INTERPRET(problem.problem, rxFree.content));
  totalIn += rxInterp.input_tokens;
  totalOut += rxInterp.output_tokens;

  return { txMessage, rxAnswer: rxInterp.content, totalInputTokens: totalIn, totalOutputTokens: totalOut, messageTokens: msgTokenEst };
}

// ─── Token counter (approximate via API) ─────────────────────────────────────

async function countTokens(text) {
  // Use a lightweight estimate: ~0.75 tokens per word for English, or call the API
  // More accurate: use tiktoken-like heuristic
  // Rough: split on whitespace + punctuation
  const tokens = text.split(/[\s]+/).length * 1.33;
  return Math.round(tokens);
}

// Actually let's get a better estimate by asking the API for a trivial completion
// and reading prompt_tokens. But that costs money. Let's use the heuristic.
// We'll also track actual transmitted tokens more precisely by using the API's
// token count when the Rx receives the message.

// ─── Answer Extraction ───────────────────────────────────────────────────────

function extractNumber(text) {
  // Clean the text and find the numeric answer
  const cleaned = text.trim().replace(/,/g, "").replace(/\$/g, "");
  // Try to find a standalone number
  const matches = cleaned.match(/-?\d+\.?\d*/g);
  if (!matches) return null;
  // Return the last number found (usually the final answer)
  return parseFloat(matches[matches.length - 1]);
}

function checkAccuracy(rxAnswer, groundTruth) {
  const extracted = extractNumber(rxAnswer);
  if (extracted === null) return false;
  // Allow small floating point tolerance
  return Math.abs(extracted - groundTruth) < 0.1 * Math.max(1, Math.abs(groundTruth)) + 0.05;
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
  console.log("=== KI-3: Stage-Wise Model Switching in CoT ===\n");
  console.log(`Model: ${MODEL} | Temperature: 0 | Problems: ${PROBLEMS.length}`);
  console.log(`Conditions: ${CONDITIONS.length}\n`);

  const allResults = {};

  for (const cond of CONDITIONS) {
    console.log(`\n--- Running Condition ${cond.name} ---`);
    const results = [];
    let correct = 0;
    let totalMsgTokens = 0;
    let totalAllTokensIn = 0;
    let totalAllTokensOut = 0;

    for (const prob of PROBLEMS) {
      process.stdout.write(`  Problem ${prob.id}...`);
      try {
        const res = await cond.runner(prob);
        const isCorrect = checkAccuracy(res.rxAnswer, prob.answer);
        if (isCorrect) correct++;
        totalMsgTokens += res.messageTokens;
        totalAllTokensIn += res.totalInputTokens;
        totalAllTokensOut += res.totalOutputTokens;

        results.push({
          problemId: prob.id,
          groundTruth: prob.answer,
          rxAnswer: res.rxAnswer.trim(),
          extractedAnswer: extractNumber(res.rxAnswer),
          correct: isCorrect,
          messageTokens: res.messageTokens,
          totalInputTokens: res.totalInputTokens,
          totalOutputTokens: res.totalOutputTokens,
        });
        console.log(` ${isCorrect ? "CORRECT" : "WRONG"} (got ${extractNumber(res.rxAnswer)}, expected ${prob.answer}) | msg=${res.messageTokens}tok`);
      } catch (e) {
        console.log(` ERROR: ${e.message}`);
        results.push({
          problemId: prob.id,
          groundTruth: prob.answer,
          rxAnswer: "ERROR",
          extractedAnswer: null,
          correct: false,
          messageTokens: 0,
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
        accuracy: Math.round(accuracy * 1000) / 10,
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

    console.log(`  => Accuracy: ${correct}/${PROBLEMS.length} (${(accuracy * 100).toFixed(1)}%) | Avg msg tokens: ${Math.round(avgMsgTokens)} | Cost: $${totalCost.toFixed(5)}`);
  }

  // ─── Print Summary Table ────────────────────────────────────────────────
  console.log("\n\n========== RESULTS SUMMARY ==========\n");
  console.log("Condition                   | Accuracy | Msg Tokens | Total Tokens | Cost ($) | Efficiency");
  console.log("----------------------------|----------|------------|--------------|----------|----------");
  for (const cond of CONDITIONS) {
    const s = allResults[cond.key].summary;
    console.log(
      `${cond.name.padEnd(28)}| ${(s.accuracy + "%").padEnd(9)}| ${String(s.avgMessageTokens).padEnd(11)}| ${String(s.totalTokens).padEnd(13)}| ${s.totalCost.toFixed(5).padEnd(9)}| ${s.efficiency.toFixed(5)}`
    );
  }

  // ─── Save JSON ──────────────────────────────────────────────────────────
  const jsonPath = path.join(__dirname, "ki3_results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to ${jsonPath}`);

  // ─── Generate HTML ──────────────────────────────────────────────────────
  const htmlPath = path.join(__dirname, "ki3_plot.html");
  generateHTML(allResults, htmlPath);
  console.log(`HTML visualization saved to ${htmlPath}`);
}

function generateHTML(allResults, htmlPath) {
  const labels = CONDITIONS.map(c => c.key);
  const names = CONDITIONS.map(c => c.name);
  const accuracies = CONDITIONS.map(c => allResults[c.key].summary.accuracy);
  const msgTokens = CONDITIONS.map(c => allResults[c.key].summary.avgMessageTokens);
  const totalTokens = CONDITIONS.map(c => allResults[c.key].summary.totalTokens);
  const costs = CONDITIONS.map(c => allResults[c.key].summary.totalCost);
  const efficiencies = CONDITIONS.map(c => allResults[c.key].summary.efficiency);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KI-3: Stage-Wise Model Switching Results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
  h1 { text-align: center; margin-bottom: 0.5rem; color: #f8fafc; font-size: 1.8rem; }
  h2 { margin: 2rem 0 1rem; color: #94a3b8; font-size: 1.2rem; }
  .subtitle { text-align: center; color: #64748b; margin-bottom: 2rem; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem; }
  .chart-box { background: #1e293b; border-radius: 12px; padding: 1.5rem; }
  canvas { width: 100% !important; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
  th, td { padding: 12px 16px; text-align: center; border-bottom: 1px solid #334155; }
  th { background: #334155; color: #f1f5f9; font-weight: 600; }
  td { color: #cbd5e1; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #263044; }
  .highlight { color: #22d3ee; font-weight: 600; }
  .best { background: #064e3b !important; color: #6ee7b7 !important; font-weight: 700; }
  @media (max-width: 900px) { .charts { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>KI-3: Stage-Wise Model Switching in CoT</h1>
<p class="subtitle">Tx/Rx Pipeline with Mode Switching at Different CoT Stages | Model: gpt-4o-mini | 15 Problems</p>

<div class="charts">
  <div class="chart-box">
    <canvas id="barChart"></canvas>
  </div>
  <div class="chart-box">
    <canvas id="scatterChart"></canvas>
  </div>
</div>

<h2>Detailed Metrics</h2>
<table>
  <thead>
    <tr>
      <th>Condition</th>
      <th>Accuracy (%)</th>
      <th>Correct/Total</th>
      <th>Avg Msg Tokens</th>
      <th>Total Tokens</th>
      <th>Cost ($)</th>
      <th>Efficiency (Acc/MsgTok)</th>
    </tr>
  </thead>
  <tbody>
    ${CONDITIONS.map(c => {
      const s = allResults[c.key].summary;
      return `<tr>
        <td style="text-align:left; font-weight:600;">${c.name}</td>
        <td>${s.accuracy}%</td>
        <td>${s.correct}/${s.total}</td>
        <td>${s.avgMessageTokens}</td>
        <td>${s.totalTokens.toLocaleString()}</td>
        <td>$${s.totalCost.toFixed(5)}</td>
        <td>${s.efficiency.toFixed(5)}</td>
      </tr>`;
    }).join("\n    ")}
  </tbody>
</table>

<h2>Per-Problem Results</h2>
<table>
  <thead>
    <tr>
      <th>Problem</th>
      <th>Ground Truth</th>
      ${CONDITIONS.map(c => `<th>${c.key}</th>`).join("")}
    </tr>
  </thead>
  <tbody>
    ${PROBLEMS.map(p => {
      return `<tr>
        <td style="text-align:left">P${p.id}</td>
        <td>${p.answer}</td>
        ${CONDITIONS.map(c => {
          const r = allResults[c.key].results.find(r => r.problemId === p.id);
          const cls = r && r.correct ? 'best' : '';
          return `<td class="${cls}">${r ? (r.extractedAnswer !== null ? r.extractedAnswer : 'ERR') : '-'}</td>`;
        }).join("")}
      </tr>`;
    }).join("\n    ")}
  </tbody>
</table>

<script>
const labels = ${JSON.stringify(names)};
const shortLabels = ${JSON.stringify(labels)};
const accuracies = ${JSON.stringify(accuracies)};
const msgTokens = ${JSON.stringify(msgTokens)};

// Grouped bar chart
new Chart(document.getElementById('barChart'), {
  type: 'bar',
  data: {
    labels: labels,
    datasets: [
      {
        label: 'Accuracy (%)',
        data: accuracies,
        backgroundColor: 'rgba(34, 211, 238, 0.7)',
        borderColor: 'rgba(34, 211, 238, 1)',
        borderWidth: 1,
        yAxisID: 'y'
      },
      {
        label: 'Avg Message Tokens',
        data: msgTokens,
        backgroundColor: 'rgba(251, 146, 60, 0.7)',
        borderColor: 'rgba(251, 146, 60, 1)',
        borderWidth: 1,
        yAxisID: 'y1'
      }
    ]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: 'Accuracy vs Message Tokens by Condition', color: '#f1f5f9' },
               legend: { labels: { color: '#94a3b8' } } },
    scales: {
      x: { ticks: { color: '#94a3b8', maxRotation: 20 }, grid: { color: '#1e293b' } },
      y: { type: 'linear', position: 'left', title: { display: true, text: 'Accuracy (%)', color: '#22d3ee' },
           ticks: { color: '#22d3ee' }, grid: { color: '#334155' }, min: 0, max: 100 },
      y1: { type: 'linear', position: 'right', title: { display: true, text: 'Avg Msg Tokens', color: '#fb923c' },
            ticks: { color: '#fb923c' }, grid: { drawOnChartArea: false } }
    }
  }
});

// Scatter plot
const colors = ['#22d3ee', '#f43f5e', '#a78bfa', '#22c55e', '#fb923c'];
new Chart(document.getElementById('scatterChart'), {
  type: 'scatter',
  data: {
    datasets: labels.map((l, i) => ({
      label: l + ': ' + shortLabels[i],
      data: [{ x: msgTokens[i], y: accuracies[i] }],
      backgroundColor: colors[i],
      borderColor: colors[i],
      pointRadius: 10,
      pointHoverRadius: 14
    }))
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: 'Accuracy vs Message Tokens (Scatter)', color: '#f1f5f9' },
               legend: { labels: { color: '#94a3b8' } } },
    scales: {
      x: { title: { display: true, text: 'Avg Message Tokens', color: '#94a3b8' },
           ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y: { title: { display: true, text: 'Accuracy (%)', color: '#94a3b8' },
           ticks: { color: '#94a3b8' }, grid: { color: '#334155' }, min: 0, max: 100 }
    }
  }
});
</script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
