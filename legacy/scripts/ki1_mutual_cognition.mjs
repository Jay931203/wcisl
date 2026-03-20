/**
 * KI-1: Mutual Cognitive Context Inference Experiment
 *
 * Two heterogeneous agents (gpt-4o as Tx, gpt-4o-mini as Rx) answer
 * 15 wireless/signal-processing questions under 4 context conditions.
 * Measures token usage, accuracy, and cost.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── API Setup ──────────────────────────────────────────────────────
const ENV_PATH = path.resolve(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(ENV_PATH, 'utf-8');
const OPENAI_API_KEY = envContent
  .split('\n')
  .find(l => l.startsWith('OPENAI_API_KEY='))
  ?.split('=')
  .slice(1)
  .join('=')
  .trim();

if (!OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY not found in .env.local');
  process.exit(1);
}

// ── Pricing (per 1M tokens, USD) ──────────────────────────────────
const PRICING = {
  'gpt-4o':      { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
};

function cost(model, inputTok, outputTok) {
  const p = PRICING[model];
  return (inputTok * p.input + outputTok * p.output) / 1_000_000;
}

// ── OpenAI Chat Helper ────────────────────────────────────────────
async function chat(model, messages, temperature = 0) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 1024 }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${model} error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return {
    content: data.choices[0].message.content,
    usage: data.usage,  // { prompt_tokens, completion_tokens, total_tokens }
  };
}

// ── 15 Technical Questions ────────────────────────────────────────
const QUESTIONS = [
  {
    id: 1,
    q: "In massive MIMO, what is the optimal linear precoding strategy when perfect CSI is available at the transmitter?",
    choices: ["A) Zero-Forcing (ZF)", "B) Matched Filter / MRT", "C) MMSE precoding", "D) Dirty Paper Coding"],
    answer: "C",
    explanation: "MMSE precoding maximizes SINR by balancing interference suppression and noise enhancement, optimal among linear precoders."
  },
  {
    id: 2,
    q: "What is the relationship between OFDM subcarrier spacing (Δf) and the maximum tolerable delay spread (τ_max)?",
    choices: ["A) Δf >> 1/τ_max", "B) Δf << 1/τ_max", "C) Δf = τ_max", "D) No relationship"],
    answer: "B",
    explanation: "Subcarrier spacing must be much less than the inverse of delay spread so each subcarrier experiences flat fading (coherence bandwidth >> Δf)."
  },
  {
    id: 3,
    q: "In a Rayleigh fading channel, what is the distribution of the instantaneous SNR?",
    choices: ["A) Gaussian", "B) Exponential", "C) Rayleigh", "D) Chi-squared with 2 DOF"],
    answer: "B",
    explanation: "If the channel amplitude is Rayleigh distributed, the power (and thus SNR) follows an exponential distribution."
  },
  {
    id: 4,
    q: "What is the primary advantage of LDPC codes over turbo codes at very high code rates?",
    choices: ["A) Lower encoding complexity", "B) Better error floor performance", "C) Shorter block lengths", "D) Simpler decoder"],
    answer: "B",
    explanation: "LDPC codes exhibit lower error floors at high code rates, making them preferred in 5G NR data channels."
  },
  {
    id: 5,
    q: "In compressed sensing for sparse channel estimation, what condition must the measurement matrix satisfy?",
    choices: ["A) Orthogonality", "B) Restricted Isometry Property (RIP)", "C) Positive definiteness", "D) Toeplitz structure"],
    answer: "B",
    explanation: "RIP ensures that sparse signals can be recovered from underdetermined measurements with high probability."
  },
  {
    id: 6,
    q: "What is the capacity of a point-to-point MIMO channel with n_t transmit and n_r receive antennas at high SNR?",
    choices: ["A) min(n_t, n_r) · log2(SNR)", "B) max(n_t, n_r) · log2(SNR)", "C) (n_t + n_r) · log2(SNR)", "D) n_t · n_r · log2(SNR)"],
    answer: "A",
    explanation: "At high SNR, MIMO capacity scales linearly with min(n_t, n_r), the multiplexing gain."
  },
  {
    id: 7,
    q: "In OFDM, what is the purpose of the cyclic prefix?",
    choices: ["A) Increase spectral efficiency", "B) Eliminate inter-symbol interference (ISI)", "C) Reduce PAPR", "D) Enable frequency hopping"],
    answer: "B",
    explanation: "The cyclic prefix absorbs multipath delay spread, converting a linear convolution into a circular one and eliminating ISI."
  },
  {
    id: 8,
    q: "What does the Wiener filter minimize in channel estimation?",
    choices: ["A) Bit error rate", "B) Mean squared error (MSE)", "C) Peak-to-average power ratio", "D) Mutual information loss"],
    answer: "B",
    explanation: "The Wiener filter (MMSE estimator) minimizes the mean squared error between the estimated and true channel."
  },
  {
    id: 9,
    q: "In a CDMA system, what limits capacity in the uplink?",
    choices: ["A) Bandwidth", "B) Near-far problem / multiple access interference", "C) Carrier frequency", "D) Modulation order"],
    answer: "B",
    explanation: "Multiple access interference and the near-far problem are the dominant capacity-limiting factors in CDMA uplink."
  },
  {
    id: 10,
    q: "What is the Cramér-Rao Lower Bound (CRLB) used for in signal processing?",
    choices: ["A) Maximum data rate", "B) Minimum achievable variance of an unbiased estimator", "C) Maximum channel capacity", "D) Minimum BER"],
    answer: "B",
    explanation: "CRLB provides a theoretical lower bound on the variance of any unbiased estimator of a parameter."
  },
  {
    id: 11,
    q: "In hybrid beamforming, why is a combination of analog and digital precoding used?",
    choices: ["A) To increase transmit power", "B) To reduce the number of RF chains while maintaining spatial multiplexing", "C) To simplify channel estimation", "D) To avoid OFDM"],
    answer: "B",
    explanation: "Hybrid beamforming reduces hardware cost/power by using fewer RF chains than antennas, with analog phase shifters compensating."
  },
  {
    id: 12,
    q: "What is the key idea behind successive interference cancellation (SIC)?",
    choices: ["A) Decode all users simultaneously", "B) Decode strongest signal first, subtract it, then decode next", "C) Use orthogonal codes for all users", "D) Apply maximum likelihood detection"],
    answer: "B",
    explanation: "SIC decodes users sequentially from strongest to weakest, subtracting each decoded signal from the received composite."
  },
  {
    id: 13,
    q: "In deep learning-based CSI feedback, what is the role of the encoder at the UE?",
    choices: ["A) Channel estimation", "B) Compress CSI matrix into a low-dimensional codeword", "C) Beamforming weight calculation", "D) Power control"],
    answer: "B",
    explanation: "The encoder (typically a CNN or Transformer) compresses the high-dimensional CSI matrix into a compact representation for feedback."
  },
  {
    id: 14,
    q: "What is the diversity order of a 2x2 MIMO system using Alamouti space-time block coding?",
    choices: ["A) 1", "B) 2", "C) 4", "D) 8"],
    answer: "C",
    explanation: "Alamouti STBC with 2 Tx and 2 Rx antennas achieves full diversity order of n_t × n_r = 4."
  },
  {
    id: 15,
    q: "In 5G NR, what is the purpose of the SSB (Synchronization Signal Block)?",
    choices: ["A) Data transmission", "B) Initial cell search, timing/frequency synchronization, and beam management", "C) HARQ feedback", "D) Uplink power control"],
    answer: "B",
    explanation: "SSB carries PSS, SSS, and PBCH for initial access, synchronization, and beam sweeping in 5G NR."
  },
];

// ── Grading ───────────────────────────────────────────────────────
function grade(response, correctAnswer) {
  const upper = response.toUpperCase();
  // Check for the letter answer pattern
  const letter = correctAnswer.toUpperCase();
  // Look for the letter at the start, or "answer is X", "X)", etc.
  if (upper.includes(`${letter})`) || upper.includes(`ANSWER: ${letter}`) ||
      upper.includes(`ANSWER IS ${letter}`) || upper.startsWith(letter) ||
      upper.includes(`(${letter})`) || upper.includes(`**${letter}**`) ||
      upper.includes(`OPTION ${letter}`) || upper.includes(`CHOICE ${letter}`)) {
    return true;
  }
  // Also check if the letter appears alone near the beginning
  const firstLine = upper.split('\n')[0];
  if (firstLine.trim() === letter || firstLine.trim().startsWith(`${letter}.`) || firstLine.trim().startsWith(`${letter}:`)) {
    return true;
  }
  return false;
}

// ── Format question for Agent A (Tx) ─────────────────────────────
function formatQuestionForA(q) {
  return `Question ${q.id}: ${q.q}\n${q.choices.join('\n')}`;
}

// ── Condition Runners ─────────────────────────────────────────────

async function runNoContext() {
  console.log('\n═══ Condition 1: No Context ═══');
  let totalTokensA_in = 0, totalTokensA_out = 0;
  let totalTokensB_in = 0, totalTokensB_out = 0;
  let correct = 0;

  for (const q of QUESTIONS) {
    // Agent A: generic, explains fully
    const aResult = await chat('gpt-4o', [
      { role: 'system', content: 'You are a helpful assistant. The user will ask a technical question. Provide a thorough explanation and clearly state the answer.' },
      { role: 'user', content: formatQuestionForA(q) },
    ]);
    totalTokensA_in += aResult.usage.prompt_tokens;
    totalTokensA_out += aResult.usage.completion_tokens;

    // Agent B: generic, receives A's explanation
    const bResult = await chat('gpt-4o-mini', [
      { role: 'system', content: 'You are a helpful assistant. Read the following explanation and answer with just the letter of the correct choice (A, B, C, or D). Start your response with the letter.' },
      { role: 'user', content: `Based on this explanation, what is the answer?\n\nExplanation: ${aResult.content}\n\nQuestion: ${q.q}\n${q.choices.join('\n')}` },
    ]);
    totalTokensB_in += bResult.usage.prompt_tokens;
    totalTokensB_out += bResult.usage.completion_tokens;

    const isCorrect = grade(bResult.content, q.answer);
    if (isCorrect) correct++;
    console.log(`  Q${q.id}: A_out=${aResult.usage.completion_tokens}tok, B=${isCorrect ? '✓' : '✗'} (${bResult.content.substring(0, 40).replace(/\n/g, ' ')})`);
  }

  return {
    condition: 'No Context',
    agentA_output_tokens: totalTokensA_out,
    agentB_accuracy: correct / QUESTIONS.length,
    correct,
    total: QUESTIONS.length,
    total_tokens: totalTokensA_in + totalTokensA_out + totalTokensB_in + totalTokensB_out,
    cost_usd: cost('gpt-4o', totalTokensA_in, totalTokensA_out) + cost('gpt-4o-mini', totalTokensB_in, totalTokensB_out),
    breakdown: { A_in: totalTokensA_in, A_out: totalTokensA_out, B_in: totalTokensB_in, B_out: totalTokensB_out },
  };
}

async function runOneWayContext() {
  console.log('\n═══ Condition 2: One-Way Context ═══');
  let totalTokensA_in = 0, totalTokensA_out = 0;
  let totalTokensB_in = 0, totalTokensB_out = 0;
  let correct = 0;

  for (const q of QUESTIONS) {
    // Agent A knows B is signal processing expert → be concise
    const aResult = await chat('gpt-4o', [
      { role: 'system', content: 'You are a wireless communication expert. The recipient is a signal processing expert, so be concise and use technical terminology freely. Skip basic explanations. Give your answer with brief reasoning.' },
      { role: 'user', content: formatQuestionForA(q) },
    ]);
    totalTokensA_in += aResult.usage.prompt_tokens;
    totalTokensA_out += aResult.usage.completion_tokens;

    // Agent B has expert prompt
    const bResult = await chat('gpt-4o-mini', [
      { role: 'system', content: 'You are a signal processing expert with deep knowledge of estimation theory, spectral analysis, and digital communications. Read the explanation and answer with the correct letter (A, B, C, or D). Start your response with the letter.' },
      { role: 'user', content: `Based on this expert explanation, what is the answer?\n\n${aResult.content}\n\nQuestion: ${q.q}\n${q.choices.join('\n')}` },
    ]);
    totalTokensB_in += bResult.usage.prompt_tokens;
    totalTokensB_out += bResult.usage.completion_tokens;

    const isCorrect = grade(bResult.content, q.answer);
    if (isCorrect) correct++;
    console.log(`  Q${q.id}: A_out=${aResult.usage.completion_tokens}tok, B=${isCorrect ? '✓' : '✗'} (${bResult.content.substring(0, 40).replace(/\n/g, ' ')})`);
  }

  return {
    condition: 'One-Way Context',
    agentA_output_tokens: totalTokensA_out,
    agentB_accuracy: correct / QUESTIONS.length,
    correct,
    total: QUESTIONS.length,
    total_tokens: totalTokensA_in + totalTokensA_out + totalTokensB_in + totalTokensB_out,
    cost_usd: cost('gpt-4o', totalTokensA_in, totalTokensA_out) + cost('gpt-4o-mini', totalTokensB_in, totalTokensB_out),
    breakdown: { A_in: totalTokensA_in, A_out: totalTokensA_out, B_in: totalTokensB_in, B_out: totalTokensB_out },
  };
}

async function runMutualContext() {
  console.log('\n═══ Condition 3: Mutual Context ═══');
  let totalTokensA_in = 0, totalTokensA_out = 0;
  let totalTokensB_in = 0, totalTokensB_out = 0;
  let correct = 0;

  // Step 1: B sends capability summary to A
  const capResult = await chat('gpt-4o-mini', [
    { role: 'system', content: 'You are a signal processing expert. Summarize your expertise and capabilities in 2-3 sentences so a collaborator knows what you already understand. Focus on: estimation theory, spectral analysis, Fourier transforms, filter design, statistical signal processing, and digital communications basics.' },
    { role: 'user', content: 'Please summarize your expertise for a wireless communications expert who will be sending you technical explanations.' },
  ]);
  const capabilitySummary = capResult.content;
  totalTokensB_in += capResult.usage.prompt_tokens;
  totalTokensB_out += capResult.usage.completion_tokens;
  console.log(`  B's capability summary: "${capabilitySummary.substring(0, 100)}..."`);

  for (const q of QUESTIONS) {
    // Agent A reads B's capability and adapts
    const aResult = await chat('gpt-4o', [
      { role: 'system', content: `You are a wireless communication expert. Your recipient has described their expertise as follows:\n"${capabilitySummary}"\nAdapt your explanation accordingly—skip what they already know, focus on wireless-specific concepts they may not know. Be efficient.` },
      { role: 'user', content: formatQuestionForA(q) },
    ]);
    totalTokensA_in += aResult.usage.prompt_tokens;
    totalTokensA_out += aResult.usage.completion_tokens;

    // Agent B knows A is wireless expert
    const bResult = await chat('gpt-4o-mini', [
      { role: 'system', content: 'You are a signal processing expert. The explanation comes from a wireless communication expert (gpt-4o) who has adapted their explanation to your background. Answer with the correct letter (A, B, C, or D). Start your response with the letter.' },
      { role: 'user', content: `${aResult.content}\n\nQuestion: ${q.q}\n${q.choices.join('\n')}` },
    ]);
    totalTokensB_in += bResult.usage.prompt_tokens;
    totalTokensB_out += bResult.usage.completion_tokens;

    const isCorrect = grade(bResult.content, q.answer);
    if (isCorrect) correct++;
    console.log(`  Q${q.id}: A_out=${aResult.usage.completion_tokens}tok, B=${isCorrect ? '✓' : '✗'} (${bResult.content.substring(0, 40).replace(/\n/g, ' ')})`);
  }

  return {
    condition: 'Mutual Context',
    agentA_output_tokens: totalTokensA_out,
    agentB_accuracy: correct / QUESTIONS.length,
    correct,
    total: QUESTIONS.length,
    total_tokens: totalTokensA_in + totalTokensA_out + totalTokensB_in + totalTokensB_out,
    cost_usd: cost('gpt-4o', totalTokensA_in, totalTokensA_out) + cost('gpt-4o-mini', totalTokensB_in, totalTokensB_out),
    breakdown: { A_in: totalTokensA_in, A_out: totalTokensA_out, B_in: totalTokensB_in, B_out: totalTokensB_out },
  };
}

async function runProgressiveInference() {
  console.log('\n═══ Condition 4: Progressive Inference (3 Rounds) ═══');
  const rounds = [];
  let inferredBProfile = '';
  let inferredAProfile = '';
  let previousBResponses = [];
  let previousAResponses = [];

  for (let round = 0; round < 3; round++) {
    console.log(`\n  ── Round ${round + 1} ──`);
    let totalTokensA_in = 0, totalTokensA_out = 0;
    let totalTokensB_in = 0, totalTokensB_out = 0;
    let correct = 0;

    // At start of round 2+, agents infer each other's expertise from previous responses
    if (round > 0) {
      // A infers B's expertise from B's previous responses
      const inferB = await chat('gpt-4o', [
        { role: 'system', content: 'You are analyzing a collaborator\'s technical responses to infer their expertise level and knowledge areas. Provide a brief 2-3 sentence profile.' },
        { role: 'user', content: `Based on these responses from my collaborator, what is their expertise?\n\n${previousBResponses.slice(-5).map((r, i) => `Response ${i + 1}: ${r.substring(0, 200)}`).join('\n\n')}` },
      ]);
      inferredBProfile = inferB.content;
      totalTokensA_in += inferB.usage.prompt_tokens;
      totalTokensA_out += inferB.usage.completion_tokens;
      console.log(`  A's inference about B: "${inferredBProfile.substring(0, 80)}..."`);

      // B infers A's expertise from A's previous responses
      const inferA = await chat('gpt-4o-mini', [
        { role: 'system', content: 'You are analyzing a collaborator\'s technical explanations to infer their expertise. Provide a brief 2-3 sentence profile.' },
        { role: 'user', content: `Based on these explanations from my collaborator, what is their expertise?\n\n${previousAResponses.slice(-5).map((r, i) => `Explanation ${i + 1}: ${r.substring(0, 200)}`).join('\n\n')}` },
      ]);
      inferredAProfile = inferA.content;
      totalTokensB_in += inferA.usage.prompt_tokens;
      totalTokensB_out += inferA.usage.completion_tokens;
      console.log(`  B's inference about A: "${inferredAProfile.substring(0, 80)}..."`);
    }

    previousAResponses = [];
    previousBResponses = [];

    for (const q of QUESTIONS) {
      let aSystemMsg;
      if (round === 0) {
        aSystemMsg = 'You are a helpful assistant. The user will ask a technical question. Provide a thorough explanation and clearly state the answer.';
      } else {
        aSystemMsg = `You are a wireless communication expert. Based on previous interactions, you've inferred your recipient's profile: "${inferredBProfile}". Adapt your explanation—be concise where they're strong, elaborate only where needed. Skip unnecessary basics.`;
      }

      const aResult = await chat('gpt-4o', [
        { role: 'system', content: aSystemMsg },
        { role: 'user', content: formatQuestionForA(q) },
      ]);
      totalTokensA_in += aResult.usage.prompt_tokens;
      totalTokensA_out += aResult.usage.completion_tokens;
      previousAResponses.push(aResult.content);

      let bSystemMsg;
      if (round === 0) {
        bSystemMsg = 'You are a helpful assistant. Read the following explanation and answer with just the letter of the correct choice (A, B, C, or D). Start your response with the letter.';
      } else {
        bSystemMsg = `You are a signal processing expert. You've inferred that the sender is: "${inferredAProfile}". Trust their domain expertise on wireless-specific topics. Answer with the correct letter (A, B, C, or D). Start your response with the letter.`;
      }

      const bResult = await chat('gpt-4o-mini', [
        { role: 'system', content: bSystemMsg },
        { role: 'user', content: `${aResult.content}\n\nQuestion: ${q.q}\n${q.choices.join('\n')}` },
      ]);
      totalTokensB_in += bResult.usage.prompt_tokens;
      totalTokensB_out += bResult.usage.completion_tokens;
      previousBResponses.push(bResult.content);

      const isCorrect = grade(bResult.content, q.answer);
      if (isCorrect) correct++;
      console.log(`    Q${q.id}: A_out=${aResult.usage.completion_tokens}tok, B=${isCorrect ? '✓' : '✗'}`);
    }

    rounds.push({
      round: round + 1,
      agentA_output_tokens: totalTokensA_out,
      agentB_accuracy: correct / QUESTIONS.length,
      correct,
      total: QUESTIONS.length,
      total_tokens: totalTokensA_in + totalTokensA_out + totalTokensB_in + totalTokensB_out,
      cost_usd: cost('gpt-4o', totalTokensA_in, totalTokensA_out) + cost('gpt-4o-mini', totalTokensB_in, totalTokensB_out),
      breakdown: { A_in: totalTokensA_in, A_out: totalTokensA_out, B_in: totalTokensB_in, B_out: totalTokensB_out },
    });
  }

  // Aggregate for the condition summary
  const lastRound = rounds[rounds.length - 1];
  return {
    condition: 'Progressive Inference',
    agentA_output_tokens: lastRound.agentA_output_tokens,
    agentB_accuracy: lastRound.agentB_accuracy,
    correct: lastRound.correct,
    total: QUESTIONS.length,
    total_tokens: lastRound.total_tokens,
    cost_usd: rounds.reduce((s, r) => s + r.cost_usd, 0),
    breakdown: lastRound.breakdown,
    rounds,
  };
}

// ── HTML Report Generator ─────────────────────────────────────────
function generateHTML(results) {
  const conditions = results.map(r => r.condition);
  const tokens = results.map(r => r.agentA_output_tokens);
  const accuracy = results.map(r => (r.agentB_accuracy * 100).toFixed(1));
  const totalTokens = results.map(r => r.total_tokens);
  const costs = results.map(r => r.cost_usd.toFixed(4));

  const prog = results.find(r => r.rounds);
  const progRounds = prog?.rounds || [];
  const progRoundLabels = progRounds.map(r => `Round ${r.round}`);
  const progTokens = progRounds.map(r => r.agentA_output_tokens);
  const progAccuracy = progRounds.map(r => (r.agentB_accuracy * 100).toFixed(1));
  const progTotalTokens = progRounds.map(r => r.total_tokens);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>KI-1 Mutual Cognitive Context Inference — Results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
  h1 { text-align: center; margin-bottom: 0.5rem; font-size: 1.6rem; color: #38bdf8; }
  h2 { margin: 2rem 0 1rem; font-size: 1.2rem; color: #94a3b8; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
  .subtitle { text-align: center; color: #64748b; margin-bottom: 2rem; font-size: 0.9rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; max-width: 1100px; margin: 0 auto; }
  .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; }
  .card.full { grid-column: 1 / -1; }
  canvas { width: 100% !important; max-height: 350px; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.85rem; }
  th, td { padding: 0.6rem 0.8rem; text-align: center; border-bottom: 1px solid #334155; }
  th { background: #334155; color: #38bdf8; font-weight: 600; }
  td { color: #cbd5e1; }
  tr:hover td { background: #1e3a5f; }
  .highlight { color: #4ade80; font-weight: 600; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
  .badge-green { background: #064e3b; color: #34d399; }
  .badge-yellow { background: #713f12; color: #fbbf24; }
  .badge-blue { background: #1e3a5f; color: #38bdf8; }
</style>
</head>
<body>
<h1>KI-1: Mutual Cognitive Context Inference</h1>
<p class="subtitle">Agent A (gpt-4o, Tx) → Agent B (gpt-4o-mini, Rx) · 15 wireless/signal-processing questions · ${new Date().toISOString().split('T')[0]}</p>

<h2>Summary Table</h2>
<table>
<thead><tr><th>Condition</th><th>A Output Tokens</th><th>B Accuracy</th><th>Total Tokens</th><th>Cost (USD)</th></tr></thead>
<tbody>
${results.map(r => `<tr>
  <td>${r.condition}</td>
  <td>${r.agentA_output_tokens.toLocaleString()}</td>
  <td><span class="badge ${r.agentB_accuracy >= 0.9 ? 'badge-green' : r.agentB_accuracy >= 0.7 ? 'badge-yellow' : 'badge-blue'}">${(r.agentB_accuracy * 100).toFixed(1)}%</span></td>
  <td>${r.total_tokens.toLocaleString()}</td>
  <td>$${r.cost_usd.toFixed(4)}</td>
</tr>`).join('\n')}
</tbody>
</table>

${progRounds.length > 0 ? `
<h2>Progressive Inference — Round Details</h2>
<table>
<thead><tr><th>Round</th><th>A Output Tokens</th><th>B Accuracy</th><th>Total Tokens</th><th>Cost (USD)</th></tr></thead>
<tbody>
${progRounds.map(r => `<tr>
  <td>Round ${r.round}</td>
  <td>${r.agentA_output_tokens.toLocaleString()}</td>
  <td><span class="badge ${r.agentB_accuracy >= 0.9 ? 'badge-green' : r.agentB_accuracy >= 0.7 ? 'badge-yellow' : 'badge-blue'}">${(r.agentB_accuracy * 100).toFixed(1)}%</span></td>
  <td>${r.total_tokens.toLocaleString()}</td>
  <td>$${r.cost_usd.toFixed(4)}</td>
</tr>`).join('\n')}
</tbody>
</table>
` : ''}

<div class="grid">
  <div class="card">
    <h2 style="margin-top:0">Agent A Output Tokens per Condition</h2>
    <canvas id="chartTokens"></canvas>
  </div>
  <div class="card">
    <h2 style="margin-top:0">Agent B Accuracy per Condition</h2>
    <canvas id="chartAccuracy"></canvas>
  </div>
  <div class="card">
    <h2 style="margin-top:0">Total Tokens per Condition</h2>
    <canvas id="chartTotal"></canvas>
  </div>
  <div class="card">
    <h2 style="margin-top:0">Cost per Condition (USD)</h2>
    <canvas id="chartCost"></canvas>
  </div>
  ${progRounds.length > 0 ? `
  <div class="card full">
    <h2 style="margin-top:0">Progressive Inference — Token Reduction Across Rounds</h2>
    <canvas id="chartProg"></canvas>
  </div>
  ` : ''}
</div>

<script>
const colors = ['#f87171','#fbbf24','#4ade80','#38bdf8'];
const conditions = ${JSON.stringify(conditions)};
const barOpts = (title) => ({
  responsive: true,
  plugins: { legend: { display: false }, title: { display: true, text: title, color: '#94a3b8' } },
  scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } } }
});

new Chart(document.getElementById('chartTokens'), {
  type: 'bar',
  data: { labels: conditions, datasets: [{ data: ${JSON.stringify(tokens)}, backgroundColor: colors }] },
  options: barOpts('Agent A Output Tokens')
});

new Chart(document.getElementById('chartAccuracy'), {
  type: 'bar',
  data: { labels: conditions, datasets: [{ data: ${JSON.stringify(accuracy.map(Number))}, backgroundColor: colors }] },
  options: { ...barOpts('Accuracy (%)'), scales: { ...barOpts('').scales, y: { ...barOpts('').scales.y, min: 0, max: 100 } } }
});

new Chart(document.getElementById('chartTotal'), {
  type: 'bar',
  data: { labels: conditions, datasets: [{ data: ${JSON.stringify(totalTokens)}, backgroundColor: colors }] },
  options: barOpts('Total Tokens (A+B)')
});

new Chart(document.getElementById('chartCost'), {
  type: 'bar',
  data: { labels: conditions, datasets: [{ data: ${JSON.stringify(costs.map(Number))}, backgroundColor: colors }] },
  options: barOpts('Cost (USD)')
});

${progRounds.length > 0 ? `
const progLabels = ${JSON.stringify(progRoundLabels)};
new Chart(document.getElementById('chartProg'), {
  type: 'line',
  data: {
    labels: progLabels,
    datasets: [
      { label: 'A Output Tokens', data: ${JSON.stringify(progTokens)}, borderColor: '#f87171', backgroundColor: '#f8717133', tension: 0.3, yAxisID: 'y' },
      { label: 'Total Tokens', data: ${JSON.stringify(progTotalTokens)}, borderColor: '#38bdf8', backgroundColor: '#38bdf833', tension: 0.3, yAxisID: 'y' },
      { label: 'Accuracy (%)', data: ${JSON.stringify(progAccuracy.map(Number))}, borderColor: '#4ade80', backgroundColor: '#4ade8033', tension: 0.3, yAxisID: 'y1' },
    ]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: 'Progressive Inference Over 3 Rounds', color: '#94a3b8' } },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
      y: { type: 'linear', position: 'left', ticks: { color: '#94a3b8' }, grid: { color: '#334155' }, title: { display: true, text: 'Tokens', color: '#94a3b8' } },
      y1: { type: 'linear', position: 'right', min: 0, max: 100, ticks: { color: '#4ade80' }, grid: { display: false }, title: { display: true, text: 'Accuracy (%)', color: '#4ade80' } },
    }
  }
});
` : ''}
</script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('KI-1: Mutual Cognitive Context Inference Experiment');
  console.log(`Questions: ${QUESTIONS.length}`);
  console.log(`Agent A: gpt-4o (Tx, wireless comm expert)`);
  console.log(`Agent B: gpt-4o-mini (Rx, signal processing expert)`);
  console.log(`Temperature: 0\n`);

  const startTime = Date.now();

  const r1 = await runNoContext();
  const r2 = await runOneWayContext();
  const r3 = await runMutualContext();
  const r4 = await runProgressiveInference();

  const results = [r1, r2, r3, r4];
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Print summary table
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    KI-1 EXPERIMENT RESULTS SUMMARY                              ║');
  console.log('╠═══════════════════════╦═══════════════╦══════════╦══════════════╦════════════════╣');
  console.log('║ Condition             ║ A Out Tokens  ║ Accuracy ║ Total Tokens ║ Cost (USD)     ║');
  console.log('╠═══════════════════════╬═══════════════╬══════════╬══════════════╬════════════════╣');
  for (const r of results) {
    const name = r.condition.padEnd(21);
    const aTok = String(r.agentA_output_tokens).padStart(11);
    const acc = `${(r.agentB_accuracy * 100).toFixed(1)}%`.padStart(7);
    const tot = String(r.total_tokens).padStart(10);
    const c = `$${r.cost_usd.toFixed(4)}`.padStart(12);
    console.log(`║ ${name} ║ ${aTok}   ║ ${acc}  ║ ${tot}   ║ ${c}   ║`);
  }
  console.log('╚═══════════════════════╩═══════════════╩══════════╩══════════════╩════════════════╝');

  if (r4.rounds) {
    console.log('\n  Progressive Inference Round Details:');
    for (const r of r4.rounds) {
      console.log(`    Round ${r.round}: A_out=${r.agentA_output_tokens} tokens, Accuracy=${(r.agentB_accuracy * 100).toFixed(1)}%, Total=${r.total_tokens}, Cost=$${r.cost_usd.toFixed(4)}`);
    }
    const reduction = ((1 - r4.rounds[2].agentA_output_tokens / r4.rounds[0].agentA_output_tokens) * 100).toFixed(1);
    console.log(`    Token reduction (Round 1→3): ${reduction}%`);
  }

  console.log(`\n  Total experiment time: ${elapsed}s`);
  console.log(`  Total cost: $${results.reduce((s, r) => s + r.cost_usd, 0).toFixed(4)}`);

  // Save JSON
  const jsonPath = path.join(__dirname, 'ki1_results.json');
  const jsonOut = {
    experiment: 'KI-1 Mutual Cognitive Context Inference',
    date: new Date().toISOString(),
    agents: { A: 'gpt-4o', B: 'gpt-4o-mini' },
    num_questions: QUESTIONS.length,
    questions: QUESTIONS,
    elapsed_seconds: parseFloat(elapsed),
    results,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2));
  console.log(`\n  Results saved to: ${jsonPath}`);

  // Save HTML
  const htmlPath = path.join(__dirname, 'ki1_plot.html');
  fs.writeFileSync(htmlPath, generateHTML(results));
  console.log(`  HTML report saved to: ${htmlPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
