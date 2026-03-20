/**
 * KI-4: Adaptive Task Scheduling with Channel Simulation
 *
 * Multiple specialist agents + orchestrator. Channel quality simulated
 * via token limits AND noise corruption.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── API Key ──
if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

// ── Constants ──
const CHANNEL_QUALITIES = {
  Good:   { maxTokens: 300, corruptionRate: 0.00 },
  Medium: { maxTokens: 150, corruptionRate: 0.10 },
  Bad:    { maxTokens: 50,  corruptionRate: 0.30 },
};
const CHANNEL_LEVELS = ['Good', 'Medium', 'Bad'];

const AGENTS = ['Math', 'Physics', 'Code', 'General'];

const AGENT_SYSTEM_PROMPTS = {
  Math: 'You are a math and statistics expert. Provide precise mathematical derivations, formulas, and calculations. Be concise and rigorous.',
  Physics: 'You are a physics and wireless communications expert. Explain physical phenomena, signal propagation, antenna theory, and electromagnetic concepts. Be concise and precise.',
  Code: 'You are a programming and simulation expert. Write clean, working code (Python preferred) for simulations and numerical analysis. Be concise.',
  General: 'You are a knowledgeable generalist. Synthesize information across domains, provide context, and fill knowledge gaps. Be concise.',
};

// Expertise scores per topic area (used by orchestrator)
const EXPERTISE_SCORES = {
  Math:    { math: 10, physics: 3, coding: 2, general: 4 },
  Physics: { math: 5, physics: 10, coding: 2, general: 4 },
  Code:    { math: 3, physics: 2, coding: 10, general: 4 },
  General: { math: 5, physics: 5, coding: 5, general: 10 },
};

// ── 15 Interdisciplinary Questions ──
const QUESTIONS = [
  {
    id: 1,
    text: "Derive the SNR expression for a 4x4 MIMO system with zero-forcing receiver and write Python code to simulate BER vs SNR.",
    domains: ['math', 'physics', 'coding'],
  },
  {
    id: 2,
    text: "Calculate the Doppler shift for a vehicle at 120km/h at 28GHz carrier frequency and explain its impact on beam tracking in 5G NR.",
    domains: ['math', 'physics'],
  },
  {
    id: 3,
    text: "Derive the channel capacity of a Rayleigh fading channel and write a Monte Carlo simulation in Python to verify it.",
    domains: ['math', 'physics', 'coding'],
  },
  {
    id: 4,
    text: "Explain the mathematical basis of OFDM, derive the condition for subcarrier orthogonality, and write Python code for a simple OFDM transmitter.",
    domains: ['math', 'physics', 'coding'],
  },
  {
    id: 5,
    text: "Calculate the path loss at 3.5GHz for an urban microcell at 200m distance using the 3GPP UMi model and compare with free-space path loss.",
    domains: ['math', 'physics'],
  },
  {
    id: 6,
    text: "Derive the Cramér-Rao lower bound for DOA estimation with a ULA and write Python code to plot CRLB vs SNR.",
    domains: ['math', 'coding'],
  },
  {
    id: 7,
    text: "Explain how CSI feedback compression works using autoencoders, derive the compression ratio formula, and outline a PyTorch implementation.",
    domains: ['physics', 'math', 'coding'],
  },
  {
    id: 8,
    text: "Calculate the coherence time and coherence bandwidth for a channel with 120ns RMS delay spread and 50Hz maximum Doppler shift.",
    domains: ['math', 'physics'],
  },
  {
    id: 9,
    text: "Derive the waterfilling power allocation for a 4-subcarrier OFDM system and write Python code to visualize the allocation.",
    domains: ['math', 'coding'],
  },
  {
    id: 10,
    text: "Explain the difference between Type I and Type II codebooks in 5G NR and compute the feedback overhead for a 32-antenna system.",
    domains: ['physics', 'math'],
  },
  {
    id: 11,
    text: "Derive the probability of outage for a dual-branch MRC system over Rayleigh fading and simulate it in Python.",
    domains: ['math', 'physics', 'coding'],
  },
  {
    id: 12,
    text: "Calculate the spectral efficiency of NOMA with 2 users and SIC, and compare with OMA. Provide a Python simulation.",
    domains: ['math', 'physics', 'coding'],
  },
  {
    id: 13,
    text: "Explain the mathematical formulation of hybrid beamforming, derive the analog/digital precoder decomposition, and outline a simulation approach.",
    domains: ['math', 'physics', 'coding'],
  },
  {
    id: 14,
    text: "Derive the bit error rate of BPSK over an AWGN channel using the Q-function and write Python code to verify with simulation.",
    domains: ['math', 'coding'],
  },
  {
    id: 15,
    text: "Explain how RIS (Reconfigurable Intelligent Surface) enhances coverage, derive the received signal model, and compute the SNR gain for 64 elements.",
    domains: ['physics', 'math'],
  },
];

// ── Pre-generate channel assignments (fixed across conditions) ──
function generateChannelAssignments() {
  const assignments = {};
  for (const q of QUESTIONS) {
    assignments[q.id] = {};
    for (const agent of AGENTS) {
      const idx = Math.floor(Math.random() * 3);
      assignments[q.id][agent] = CHANNEL_LEVELS[idx];
    }
  }
  return assignments;
}

// ── Corruption function ──
function corruptResponse(text, corruptionRate) {
  if (corruptionRate === 0) return { corrupted: text, corruptedWordCount: 0 };
  const words = text.split(/\s+/);
  let corruptedCount = 0;
  const result = words.map(w => {
    if (Math.random() < corruptionRate) {
      corruptedCount++;
      return '[???]';
    }
    return w;
  });
  return { corrupted: result.join(' '), corruptedWordCount: corruptedCount };
}

// ── OpenAI API call ──
async function callOpenAI({ model, systemPrompt, userPrompt, maxTokens, temperature = 0 }) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const content = data.choices[0]?.message?.content || '';
  const usage = data.usage || {};
  return { content, tokensUsed: usage.total_tokens || 0, completionTokens: usage.completion_tokens || 0 };
}

// ── Call a specialist agent with channel simulation ──
async function callAgent(agentName, question, channelQuality, context = '') {
  const ch = CHANNEL_QUALITIES[channelQuality];
  const sysPrompt = AGENT_SYSTEM_PROMPTS[agentName] + `\nYou must respond in at most ${ch.maxTokens} tokens.`;
  const userPrompt = context
    ? `Previous context:\n${context}\n\nQuestion: ${question}`
    : `Question: ${question}`;

  const { content, tokensUsed } = await callOpenAI({
    model: 'gpt-4o-mini',
    systemPrompt: sysPrompt,
    userPrompt,
    maxTokens: ch.maxTokens,
    temperature: 0,
  });

  const { corrupted, corruptedWordCount } = corruptResponse(content, ch.corruptionRate);
  const totalWords = content.split(/\s+/).length;

  return {
    agent: agentName,
    channel: channelQuality,
    rawResponse: content,
    corruptedResponse: corrupted,
    tokensUsed,
    corruptedWords: corruptedWordCount,
    totalWords,
  };
}

// ── Grader ──
async function gradeAnswer(question, finalAnswer) {
  const sysPrompt = `You are a strict academic grader. Evaluate the following answer to a technical question.
Score from 0 to 10 where:
- 0-2: Completely wrong or incoherent
- 3-4: Partially correct but major errors or missing key parts
- 5-6: Mostly correct but incomplete
- 7-8: Good answer with minor issues
- 9-10: Excellent, comprehensive answer

Respond with ONLY a JSON object: {"score": <number>, "reason": "<brief explanation>"}`;

  const userPrompt = `Question: ${question}\n\nAnswer:\n${finalAnswer}`;
  const { content, tokensUsed } = await callOpenAI({
    model: 'gpt-4o',
    systemPrompt: sysPrompt,
    userPrompt,
    maxTokens: 200,
    temperature: 0,
  });

  try {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return { score: parsed.score, reason: parsed.reason, tokensUsed };
  } catch {
    const match = content.match(/(\d+(\.\d+)?)/);
    return { score: match ? parseFloat(match[1]) : 5, reason: content, tokensUsed };
  }
}

// ── Orchestrator: pick next agent ──
async function orchestratorPick({ question, context, channels, availableAgents, condition, consultationsSoFar }) {
  const agentStatusLines = availableAgents.map(a => {
    const ch = channels[a];
    const chInfo = CHANNEL_QUALITIES[ch];
    const exp = EXPERTISE_SCORES[a];
    return `- ${a}: expertise=${JSON.stringify(exp)}, channel=${ch} (max ${chInfo.maxTokens} tokens, ${(chInfo.corruptionRate * 100).toFixed(0)}% corruption)`;
  });

  const stopOption = condition === 'joint_early_stop'
    ? '\nYou may also choose STOP if the gathered information is sufficient to answer the question well.'
    : '';

  const sysPrompt = `You are an orchestrator that selects the best specialist agent to consult next.

Available agents and their current status:
${agentStatusLines.join('\n')}

Based on the current task progress and information gathered so far,
select the next agent. Optimize for answer quality while considering communication reliability.
A higher corruption rate means more information loss. A lower token limit means less detail.${stopOption}

Respond with ONLY the agent name (Math, Physics, Code, or General)${condition === 'joint_early_stop' ? ' or STOP' : ''}.`;

  const userPrompt = `Question: ${question}\n\nConsultations so far (${consultationsSoFar}/3):\n${context || '(none yet)'}`;

  const { content, tokensUsed } = await callOpenAI({
    model: 'gpt-4o-mini',
    systemPrompt: sysPrompt,
    userPrompt,
    maxTokens: 20,
    temperature: 0.3,
  });

  const pick = content.trim().replace(/[^a-zA-Z]/g, '');
  if (condition === 'joint_early_stop' && pick.toUpperCase() === 'STOP') {
    return { agent: 'STOP', tokensUsed };
  }
  const matched = availableAgents.find(a => pick.toLowerCase().includes(a.toLowerCase()));
  return { agent: matched || availableAgents[0], tokensUsed };
}

// ── Synthesize final answer from gathered responses ──
async function synthesize(question, responses) {
  const gathered = responses.map((r, i) =>
    `[Agent ${r.agent} via ${r.channel} channel]:\n${r.corruptedResponse}`
  ).join('\n\n');

  const sysPrompt = 'You are an expert synthesizer. Combine the following specialist responses into a coherent, comprehensive answer. Fill in gaps where [???] corruption markers appear if possible. Be thorough but concise.';
  const userPrompt = `Question: ${question}\n\nGathered responses:\n${gathered}\n\nProvide a synthesized answer:`;

  const { content, tokensUsed } = await callOpenAI({
    model: 'gpt-4o-mini',
    systemPrompt: sysPrompt,
    userPrompt,
    maxTokens: 500,
    temperature: 0,
  });
  return { content, tokensUsed };
}

// ── Condition runners ──

// 1. Fixed Order: Math → Physics → Code
async function runFixedOrder(question, channels) {
  const order = ['Math', 'Physics', 'Code'];
  const responses = [];
  let totalTokens = 0;
  let context = '';

  for (const agent of order) {
    const r = await callAgent(agent, question.text, channels[agent], context);
    responses.push(r);
    totalTokens += r.tokensUsed;
    context += `[${r.agent}]: ${r.corruptedResponse}\n\n`;
  }

  const synth = await synthesize(question.text, responses);
  totalTokens += synth.tokensUsed;

  return { responses, finalAnswer: synth.content, totalTokens, consultations: 3 };
}

// 2. Expertise Only: pick by topic relevance
function pickByExpertise(question) {
  const domainMap = { math: 'Math', physics: 'Physics', coding: 'Code', general: 'General' };
  const agents = [];
  for (const d of question.domains) {
    const a = domainMap[d];
    if (a && !agents.includes(a)) agents.push(a);
  }
  while (agents.length < 3) {
    for (const a of AGENTS) {
      if (!agents.includes(a)) { agents.push(a); break; }
    }
  }
  return agents.slice(0, 3);
}

async function runExpertiseOnly(question, channels) {
  const order = pickByExpertise(question);
  const responses = [];
  let totalTokens = 0;
  let context = '';

  for (const agent of order) {
    const r = await callAgent(agent, question.text, channels[agent], context);
    responses.push(r);
    totalTokens += r.tokensUsed;
    context += `[${r.agent}]: ${r.corruptedResponse}\n\n`;
  }

  const synth = await synthesize(question.text, responses);
  totalTokens += synth.tokensUsed;

  return { responses, finalAnswer: synth.content, totalTokens, consultations: 3 };
}

// 3. Channel Only: pick agent with best channel
function pickByChannel(channels) {
  const ranked = [...AGENTS].sort((a, b) => {
    const order = { Good: 0, Medium: 1, Bad: 2 };
    return order[channels[a]] - order[channels[b]];
  });
  return ranked.slice(0, 3);
}

async function runChannelOnly(question, channels) {
  const order = pickByChannel(channels);
  const responses = [];
  let totalTokens = 0;
  let context = '';

  for (const agent of order) {
    const r = await callAgent(agent, question.text, channels[agent], context);
    responses.push(r);
    totalTokens += r.tokensUsed;
    context += `[${r.agent}]: ${r.corruptedResponse}\n\n`;
  }

  const synth = await synthesize(question.text, responses);
  totalTokens += synth.tokensUsed;

  return { responses, finalAnswer: synth.content, totalTokens, consultations: 3 };
}

// 4. Joint: orchestrator picks based on expertise + channel
async function runJoint(question, channels) {
  const responses = [];
  let totalTokens = 0;
  let context = '';

  for (let i = 0; i < 3; i++) {
    const { agent, tokensUsed: orchTokens } = await orchestratorPick({
      question: question.text,
      context,
      channels,
      availableAgents: AGENTS,
      condition: 'joint',
      consultationsSoFar: i,
    });
    totalTokens += orchTokens;

    const r = await callAgent(agent, question.text, channels[agent], context);
    responses.push(r);
    totalTokens += r.tokensUsed;
    context += `[${r.agent}]: ${r.corruptedResponse}\n\n`;
  }

  const synth = await synthesize(question.text, responses);
  totalTokens += synth.tokensUsed;

  return { responses, finalAnswer: synth.content, totalTokens, consultations: 3 };
}

// 5. Joint + Early Stop
async function runJointEarlyStop(question, channels) {
  const responses = [];
  let totalTokens = 0;
  let context = '';
  let consultations = 0;

  for (let i = 0; i < 3; i++) {
    const { agent, tokensUsed: orchTokens } = await orchestratorPick({
      question: question.text,
      context,
      channels,
      availableAgents: AGENTS,
      condition: 'joint_early_stop',
      consultationsSoFar: i,
    });
    totalTokens += orchTokens;

    if (agent === 'STOP') break;

    const r = await callAgent(agent, question.text, channels[agent], context);
    responses.push(r);
    totalTokens += r.tokensUsed;
    consultations++;
    context += `[${r.agent}]: ${r.corruptedResponse}\n\n`;
  }

  if (responses.length === 0) {
    // Fallback: at least consult one agent
    const best = pickByChannel(channels)[0];
    const r = await callAgent(best, question.text, channels[best], '');
    responses.push(r);
    totalTokens += r.tokensUsed;
    consultations = 1;
  }

  const synth = await synthesize(question.text, responses);
  totalTokens += synth.tokensUsed;

  return { responses, finalAnswer: synth.content, totalTokens, consultations };
}

// ── Main experiment ──
async function main() {
  console.log('=== KI-4: Adaptive Task Scheduling with Channel Simulation ===\n');

  const channelAssignments = generateChannelAssignments();

  // Print channel assignments
  console.log('Channel Assignments (per question per agent):');
  for (const q of QUESTIONS) {
    const chs = AGENTS.map(a => `${a}=${channelAssignments[q.id][a]}`).join(', ');
    console.log(`  Q${q.id}: ${chs}`);
  }
  console.log('');

  const CONDITIONS = [
    { name: 'Fixed Order', runner: runFixedOrder },
    { name: 'Expertise Only', runner: runExpertiseOnly },
    { name: 'Channel Only', runner: runChannelOnly },
    { name: 'Joint', runner: runJoint },
    { name: 'Joint + Early Stop', runner: runJointEarlyStop },
  ];

  const allResults = {};

  for (const cond of CONDITIONS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Condition: ${cond.name}`);
    console.log('='.repeat(60));

    const questionResults = [];

    for (const q of QUESTIONS) {
      process.stdout.write(`  Q${q.id}...`);
      const channels = channelAssignments[q.id];

      const result = await cond.runner(q, channels);

      // Grade
      const grade = await gradeAnswer(q.text, result.finalAnswer);
      result.totalTokens += grade.tokensUsed;

      const totalCorrupted = result.responses.reduce((s, r) => s + r.corruptedWords, 0);
      const totalWords = result.responses.reduce((s, r) => s + r.totalWords, 0);

      const qResult = {
        questionId: q.id,
        question: q.text,
        domains: q.domains,
        channels,
        agentsConsulted: result.responses.map(r => r.agent),
        channelDetails: result.responses.map(r => ({
          agent: r.agent,
          channel: r.channel,
          corruptedWords: r.corruptedWords,
          totalWords: r.totalWords,
        })),
        consultations: result.consultations,
        totalTokens: result.totalTokens,
        gradeScore: grade.score,
        gradeReason: grade.reason,
        corruptedWords: totalCorrupted,
        totalWords,
        finalAnswer: result.finalAnswer,
      };
      questionResults.push(qResult);
      console.log(` score=${grade.score}, tokens=${result.totalTokens}, consults=${result.consultations}, corrupted=${totalCorrupted}/${totalWords}`);
    }

    // Aggregate
    const avgScore = questionResults.reduce((s, r) => s + r.gradeScore, 0) / questionResults.length;
    const totalTokens = questionResults.reduce((s, r) => s + r.totalTokens, 0);
    const avgConsultations = questionResults.reduce((s, r) => s + r.consultations, 0) / questionResults.length;
    const totalCorrupted = questionResults.reduce((s, r) => s + r.corruptedWords, 0);
    const totalWords = questionResults.reduce((s, r) => s + r.totalWords, 0);
    const effectiveInfoRate = avgScore / (totalTokens / 1000);

    allResults[cond.name] = {
      questions: questionResults,
      summary: {
        avgScore: Math.round(avgScore * 100) / 100,
        totalTokens,
        avgConsultations: Math.round(avgConsultations * 100) / 100,
        effectiveInfoRate: Math.round(effectiveInfoRate * 1000) / 1000,
        totalCorruptedWords: totalCorrupted,
        totalWords,
        corruptionRatio: totalWords > 0 ? Math.round((totalCorrupted / totalWords) * 10000) / 10000 : 0,
      },
    };

    console.log(`\n  Summary: avg_score=${avgScore.toFixed(2)}, total_tokens=${totalTokens}, avg_consults=${avgConsultations.toFixed(2)}, info_rate=${effectiveInfoRate.toFixed(3)}, corruption=${totalCorrupted}/${totalWords}`);
  }

  // ── Print final comparison ──
  console.log('\n\n' + '='.repeat(70));
  console.log('FINAL COMPARISON');
  console.log('='.repeat(70));
  console.log(`${'Condition'.padEnd(22)} ${'AvgScore'.padStart(9)} ${'Tokens'.padStart(9)} ${'Consults'.padStart(9)} ${'InfoRate'.padStart(9)} ${'Corrupt%'.padStart(9)}`);
  console.log('-'.repeat(70));
  for (const cond of CONDITIONS) {
    const s = allResults[cond.name].summary;
    console.log(
      `${cond.name.padEnd(22)} ${s.avgScore.toFixed(2).padStart(9)} ${String(s.totalTokens).padStart(9)} ${s.avgConsultations.toFixed(2).padStart(9)} ${s.effectiveInfoRate.toFixed(3).padStart(9)} ${(s.corruptionRatio * 100).toFixed(1).padStart(8)}%`
    );
  }

  // ── Save JSON ──
  const jsonPath = path.join(__dirname, 'ki4_results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to ${jsonPath}`);

  // ── Generate HTML ──
  generateHTML(allResults, CONDITIONS.map(c => c.name));
}

function generateHTML(results, conditionNames) {
  const summaries = conditionNames.map(c => results[c].summary);
  const labels = JSON.stringify(conditionNames);
  const scores = JSON.stringify(summaries.map(s => s.avgScore));
  const tokens = JSON.stringify(summaries.map(s => s.totalTokens));
  const corrupted = JSON.stringify(summaries.map(s => s.totalCorruptedWords));
  const useful = JSON.stringify(summaries.map(s => s.totalWords - s.totalCorruptedWords));
  const infoRates = JSON.stringify(summaries.map(s => s.effectiveInfoRate));

  // Per-question scores for scatter
  const scatterData = conditionNames.map((c, i) => {
    return results[c].questions.map(q => ({
      x: q.totalTokens,
      y: q.gradeScore,
    }));
  });

  const colors = [
    'rgba(239, 68, 68, 0.8)',   // red
    'rgba(59, 130, 246, 0.8)',  // blue
    'rgba(34, 197, 94, 0.8)',   // green
    'rgba(168, 85, 247, 0.8)',  // purple
    'rgba(245, 158, 11, 0.8)',  // amber
  ];
  const bgColors = colors.map(c => c.replace('0.8', '0.6'));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KI-4: Adaptive Task Scheduling Results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
  h1 { text-align: center; margin-bottom: 8px; font-size: 1.8rem; color: #f1f5f9; }
  .subtitle { text-align: center; color: #94a3b8; margin-bottom: 30px; font-size: 0.95rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 1400px; margin: 0 auto; }
  .chart-card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
  .chart-card h2 { font-size: 1rem; color: #94a3b8; margin-bottom: 12px; text-align: center; }
  canvas { width: 100% !important; }
  .summary { max-width: 1400px; margin: 30px auto 0; background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
  .summary h2 { font-size: 1rem; color: #94a3b8; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 14px; text-align: center; border-bottom: 1px solid #334155; }
  th { color: #94a3b8; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; }
  td { color: #e2e8f0; font-size: 0.95rem; }
  tr:hover td { background: #334155; }
  .best { color: #4ade80; font-weight: 700; }
</style>
</head>
<body>
<h1>KI-4: Adaptive Task Scheduling with Channel Simulation</h1>
<p class="subtitle">15 interdisciplinary questions &middot; 4 specialist agents &middot; 5 scheduling conditions &middot; Simulated channel degradation</p>

<div class="grid">
  <div class="chart-card">
    <h2>Average Answer Quality (0-10)</h2>
    <canvas id="qualityChart"></canvas>
  </div>
  <div class="chart-card">
    <h2>Total Tokens Used</h2>
    <canvas id="tokensChart"></canvas>
  </div>
  <div class="chart-card">
    <h2>Quality vs Tokens (per question)</h2>
    <canvas id="scatterChart"></canvas>
  </div>
  <div class="chart-card">
    <h2>Corrupted vs Useful Words</h2>
    <canvas id="stackedChart"></canvas>
  </div>
</div>

<div class="summary">
  <h2>Summary Table</h2>
  <table>
    <tr><th>Condition</th><th>Avg Score</th><th>Total Tokens</th><th>Avg Consultations</th><th>Info Rate (score/kToken)</th><th>Corruption %</th></tr>
    ${conditionNames.map((c, i) => {
      const s = results[c].summary;
      return `<tr><td style="text-align:left;font-weight:600">${c}</td><td>${s.avgScore.toFixed(2)}</td><td>${s.totalTokens.toLocaleString()}</td><td>${s.avgConsultations.toFixed(2)}</td><td>${s.effectiveInfoRate.toFixed(3)}</td><td>${(s.corruptionRatio*100).toFixed(1)}%</td></tr>`;
    }).join('\n    ')}
  </table>
</div>

<script>
const labels = ${labels};
const colors = ${JSON.stringify(colors)};
const bgColors = ${JSON.stringify(bgColors)};

// Quality bar chart
new Chart(document.getElementById('qualityChart'), {
  type: 'bar',
  data: {
    labels,
    datasets: [{
      data: ${scores},
      backgroundColor: bgColors,
      borderColor: colors,
      borderWidth: 2,
      borderRadius: 6,
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, max: 10, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      x: { ticks: { color: '#94a3b8', maxRotation: 20 }, grid: { display: false } }
    }
  }
});

// Tokens bar chart
new Chart(document.getElementById('tokensChart'), {
  type: 'bar',
  data: {
    labels,
    datasets: [{
      data: ${tokens},
      backgroundColor: bgColors,
      borderColor: colors,
      borderWidth: 2,
      borderRadius: 6,
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      x: { ticks: { color: '#94a3b8', maxRotation: 20 }, grid: { display: false } }
    }
  }
});

// Scatter: quality vs tokens
const scatterData = ${JSON.stringify(scatterData)};
new Chart(document.getElementById('scatterChart'), {
  type: 'scatter',
  data: {
    datasets: labels.map((label, i) => ({
      label,
      data: scatterData[i],
      backgroundColor: colors[i],
      borderColor: colors[i],
      pointRadius: 5,
      pointHoverRadius: 7,
    }))
  },
  options: {
    responsive: true,
    plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12 } } },
    scales: {
      x: { title: { display: true, text: 'Tokens Used', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y: { title: { display: true, text: 'Quality Score', color: '#94a3b8' }, beginAtZero: true, max: 10, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
    }
  }
});

// Stacked bar: corrupted vs useful
new Chart(document.getElementById('stackedChart'), {
  type: 'bar',
  data: {
    labels,
    datasets: [
      {
        label: 'Useful Words',
        data: ${useful},
        backgroundColor: 'rgba(34, 197, 94, 0.7)',
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Corrupted Words',
        data: ${corrupted},
        backgroundColor: 'rgba(239, 68, 68, 0.7)',
        borderColor: 'rgba(239, 68, 68, 1)',
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  },
  options: {
    responsive: true,
    plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12 } } },
    scales: {
      x: { stacked: true, ticks: { color: '#94a3b8', maxRotation: 20 }, grid: { display: false } },
      y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
    }
  }
});
</script>
</body>
</html>`;

  const htmlPath = path.join(__dirname, 'ki4_plot.html');
  fs.writeFileSync(htmlPath, html);
  console.log(`HTML report saved to ${htmlPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
