/**
 * KI-4 Redo: Agent-to-Agent Communication with Channel Corruption
 *
 * Pipeline: Question → Specialist (token-limited) → Channel corruption → Receiving Agent → Grader
 *
 * 5 Conditions: Fixed, Expertise Only, Channel Only, Joint, Joint+EarlyStop
 * Goal: Joint > Channel Only > Expertise Only > Fixed
 */

import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';

// --- API Key ---
const envContent = readFileSync('C:/Users/hyunj/studyeng/.env.local', 'utf-8');
const OPENAI_API_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();

// --- Seeded Random ---
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);

function seededShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Channel Definitions ---
const CHANNELS = {
  Good:   { maxTokens: 500, corruptionRate: 0.00 },
  Medium: { maxTokens: 120, corruptionRate: 0.25 },
  Bad:    { maxTokens: 50,  corruptionRate: 0.50 },
};

const CHANNEL_WEIGHTS = { Good: 1.0, Medium: 0.4, Bad: 0.1 };

// --- 4 Specialist Agents ---
const AGENTS = [
  { id: 0, name: 'MedicalSpecialist', domain: 'medical',  systemPrompt: 'You are a board-certified physician with expertise in internal medicine, emergency medicine, and pharmacology. Provide precise, evidence-based medical answers with specific drug names, dosages, and clinical guidelines.' },
  { id: 1, name: 'LegalSpecialist',   domain: 'legal',    systemPrompt: 'You are a practicing attorney with expertise in tort law, corporate law, real estate law, and employment law. Provide precise legal analysis citing relevant doctrines, elements, and case principles.' },
  { id: 2, name: 'FinanceSpecialist', domain: 'finance',  systemPrompt: 'You are a CFA charterholder and financial analyst. Provide precise calculations with formulas, step-by-step math, and interpret results with industry context. Always show your work.' },
  { id: 3, name: 'TechSpecialist',    domain: 'tech',     systemPrompt: 'You are a senior software architect with expertise in networking, security, distributed systems, and system design. Provide precise technical details with protocols, algorithms, and implementation specifics.' },
];

// --- 15 Questions ---
const QUESTIONS = [
  { id: 1,  text: 'What is the first-line treatment for hypertension in a patient with comorbid type 2 diabetes? Include specific drug classes and dosing.', primary: 'medical', secondary: null, ref: 'ACE inhibitor/ARB, specific dosing' },
  { id: 2,  text: 'What is the differential diagnosis for acute chest pain with troponin elevation? List the most important conditions and distinguishing features.', primary: 'medical', secondary: null, ref: 'STEMI, NSTEMI, PE, myocarditis' },
  { id: 3,  text: 'What are the key warfarin drug interactions and how should INR be managed? Include CYP enzyme details.', primary: 'medical', secondary: null, ref: 'CYP2C9 interactions, target INR 2-3' },
  { id: 4,  text: 'Describe the emergency management of anaphylaxis step by step, including drug doses and routes.', primary: 'medical', secondary: null, ref: 'IM epinephrine 0.3-0.5mg, airway, IV fluids' },
  { id: 5,  text: 'What are the four elements of negligence in tort law? Explain each element with examples.', primary: 'legal', secondary: null, ref: 'duty, breach, causation, damages' },
  { id: 6,  text: 'What is the legal difference between a merger and an acquisition? Include types of mergers and acquisition structures.', primary: 'legal', secondary: null, ref: 'statutory merger vs asset/stock purchase' },
  { id: 7,  text: 'What are a tenant\'s legal rights when a landlord fails to make necessary repairs? Include available remedies.', primary: 'legal', secondary: null, ref: 'repair and deduct, rent withholding, constructive eviction' },
  { id: 8,  text: 'What requirements must a non-compete clause meet to be enforceable? Include key factors courts examine.', primary: 'legal', secondary: null, ref: 'reasonable scope, duration, geography' },
  { id: 9,  text: 'Calculate the NPV of a $100,000 investment that generates $30,000 per year for 5 years at a 10% discount rate. Show all steps.', primary: 'finance', secondary: 'tech', ref: '$13,724' },
  { id: 10, text: 'Calculate WACC given: 60% equity at 12% cost, 40% debt at 6% cost, corporate tax rate 25%. Show the formula and calculation.', primary: 'finance', secondary: null, ref: '9.0%' },
  { id: 11, text: 'Calculate break-even point: fixed costs $500,000, variable cost $30/unit, selling price $80/unit. Explain the analysis.', primary: 'finance', secondary: null, ref: '10,000 units' },
  { id: 12, text: 'Interpret a debt-to-equity ratio of 2.5 when the industry average is 1.2. What does this mean for the company?', primary: 'finance', secondary: null, ref: 'highly leveraged, risk analysis' },
  { id: 13, text: 'Explain TCP vs UDP protocols in detail. Compare their features and provide specific use cases for each.', primary: 'tech', secondary: null, ref: 'reliable/ordered vs fast/unordered' },
  { id: 14, text: 'What are the methods to prevent SQL injection attacks? Explain each method with code-level details.', primary: 'tech', secondary: 'legal', ref: 'parameterized queries, ORM, input validation, WAF' },
  { id: 15, text: 'Design a load balancer: what strategies exist and how do health checks work? Include implementation details.', primary: 'tech', secondary: null, ref: 'round-robin, least-connections, health probes' },
];

// --- Channel Assignment: ensure diversity per question ---
// For each question, assign channels to 4 agents such that at least 1 Good and 1 Bad appear.
// Template options, shuffled per question:
const CHANNEL_TEMPLATES = [
  ['Good', 'Medium', 'Bad', 'Medium'],
  ['Good', 'Bad', 'Medium', 'Bad'],
  ['Good', 'Bad', 'Bad', 'Medium'],
  ['Good', 'Good', 'Medium', 'Bad'],
];

const channelAssignments = {}; // questionId -> { agentId: channelName }
for (const q of QUESTIONS) {
  const template = CHANNEL_TEMPLATES[Math.floor(rng() * CHANNEL_TEMPLATES.length)];
  const shuffled = seededShuffle(template);
  channelAssignments[q.id] = {};
  for (let i = 0; i < 4; i++) {
    channelAssignments[q.id][i] = shuffled[i];
  }
}

// --- Expertise Weights ---
function getExpertiseWeight(agent, question) {
  if (agent.domain === question.primary) return 1.0;
  if (question.secondary && agent.domain === question.secondary) return 0.5;
  return 0.2;
}

// --- Channel Corruption ---
function corruptMessage(text, rate) {
  if (rate === 0) return text;
  const words = text.split(/(\s+)/);
  return words.map(w => {
    if (/^\s+$/.test(w)) return w;
    if (rng() < rate) return '[???]';
    return w;
  }).join('');
}

// --- OpenAI API Call ---
async function callOpenAI(model, systemPrompt, userPrompt, maxTokens) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// --- Specialist Call + Channel Corruption ---
async function consultAgent(agentId, question) {
  const agent = AGENTS[agentId];
  const channelName = channelAssignments[question.id][agentId];
  const channel = CHANNELS[channelName];

  const rawResponse = await callOpenAI(
    'gpt-4o-mini',
    agent.systemPrompt,
    question.text,
    channel.maxTokens
  );

  const corruptedResponse = corruptMessage(rawResponse, channel.corruptionRate);

  return {
    agentId,
    agentName: agent.name,
    channelName,
    channelConfig: channel,
    rawLength: rawResponse.length,
    rawTokensApprox: rawResponse.split(/\s+/).length,
    corrupted: corruptedResponse,
    raw: rawResponse,
  };
}

// --- Receiving Agent ---
const RECEIVING_PROMPT = `You received messages that may be partially corrupted ([???] marks) or truncated. Reconstruct the meaning as best you can and provide a comprehensive answer to the question. If too much information is missing, say what you can and note the gaps.`;

async function receivingAgent(question, consultResults) {
  let messagesBlock = consultResults.map((r, i) =>
    `--- Message from ${r.agentName} (may be corrupted/truncated) ---\n${r.corrupted}`
  ).join('\n\n');

  const userPrompt = `Original Question: ${question.text}\n\nYou received the following specialist messages:\n\n${messagesBlock}\n\nBased on these messages, provide the best comprehensive answer you can.`;

  const answer = await callOpenAI('gpt-4o-mini', RECEIVING_PROMPT, userPrompt, 800);
  return answer;
}

// --- Grader ---
async function grade(question, finalAnswer) {
  const graderPrompt = `You are a strict grader evaluating the quality of an answer. Score from 0 to 10 based on:
- Accuracy and correctness (40%)
- Completeness and detail (30%)
- Specificity (exact numbers, names, formulas) (20%)
- Clarity and organization (10%)

Reference answer key points: ${question.ref}

IMPORTANT: Return ONLY a JSON object: {"score": <number 0-10>, "reason": "<brief explanation>"}
Do not include any other text.`;

  const userPrompt = `Question: ${question.text}\n\nAnswer to grade:\n${finalAnswer}`;

  const result = await callOpenAI('gpt-4o', graderPrompt, userPrompt, 200);
  try {
    const parsed = JSON.parse(result.trim());
    return parsed;
  } catch {
    const match = result.match(/(\d+(\.\d+)?)/);
    return { score: match ? parseFloat(match[1]) : 0, reason: result };
  }
}

// --- Condition Logic ---
function selectAgentsFixed(question) {
  // Fixed order: Medical(0) → Legal(1) → Finance(2). Always these 3, max 2.
  const fixedOrder = [0, 1, 2];
  return fixedOrder.slice(0, 2);
}

function selectAgentsExpertiseOnly(question) {
  // Primary domain first, then secondary. Ignore channel. Max 2.
  const ranked = [...AGENTS].sort((a, b) => {
    return getExpertiseWeight(b, question) - getExpertiseWeight(a, question);
  });
  return ranked.slice(0, 2).map(a => a.id);
}

function selectAgentsChannelOnly(question) {
  // Best channel first. Ignore expertise. Max 2.
  const agentChannels = AGENTS.map(a => ({
    id: a.id,
    channelWeight: CHANNEL_WEIGHTS[channelAssignments[question.id][a.id]],
  }));
  agentChannels.sort((a, b) => b.channelWeight - a.channelWeight);
  return agentChannels.slice(0, 2).map(a => a.id);
}

function selectAgentsJoint(question) {
  // combined_score = expertise_weight * channel_weight. Top 2.
  const scored = AGENTS.map(a => {
    const ew = getExpertiseWeight(a, question);
    const cw = CHANNEL_WEIGHTS[channelAssignments[question.id][a.id]];
    return { id: a.id, score: ew * cw, ew, cw };
  });
  scored.sort((a, b) => b.score - a.score);
  return { selected: scored.slice(0, 2).map(s => s.id), scores: scored };
}

function selectAgentsJointEarlyStop(question) {
  // Same as Joint but only 1 if top agent has combined_score > 0.8
  const scored = AGENTS.map(a => {
    const ew = getExpertiseWeight(a, question);
    const cw = CHANNEL_WEIGHTS[channelAssignments[question.id][a.id]];
    return { id: a.id, score: ew * cw, ew, cw };
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored[0].score > 0.8) {
    return { selected: [scored[0].id], scores: scored, earlyStop: true };
  }
  return { selected: scored.slice(0, 2).map(s => s.id), scores: scored, earlyStop: false };
}

// --- Run Single Condition for a Question ---
async function runCondition(conditionName, question) {
  let selectedAgentIds;
  let meta = {};

  switch (conditionName) {
    case 'Fixed':
      selectedAgentIds = selectAgentsFixed(question);
      break;
    case 'ExpertiseOnly':
      selectedAgentIds = selectAgentsExpertiseOnly(question);
      break;
    case 'ChannelOnly':
      selectedAgentIds = selectAgentsChannelOnly(question);
      break;
    case 'Joint': {
      const j = selectAgentsJoint(question);
      selectedAgentIds = j.selected;
      meta.scores = j.scores;
      break;
    }
    case 'Joint+EarlyStop': {
      const je = selectAgentsJointEarlyStop(question);
      selectedAgentIds = je.selected;
      meta.scores = je.scores;
      meta.earlyStop = je.earlyStop;
      break;
    }
  }

  // Consult selected agents
  const consultResults = [];
  for (const agentId of selectedAgentIds) {
    const result = await consultAgent(agentId, question);
    consultResults.push(result);
  }

  // Receiving agent interprets
  const finalAnswer = await receivingAgent(question, consultResults);

  // Grader scores
  const gradeResult = await grade(question, finalAnswer);

  return {
    condition: conditionName,
    questionId: question.id,
    selectedAgents: selectedAgentIds.map(id => ({
      id,
      name: AGENTS[id].name,
      domain: AGENTS[id].domain,
      channel: channelAssignments[question.id][id],
      expertiseWeight: getExpertiseWeight(AGENTS[id], question),
      channelWeight: CHANNEL_WEIGHTS[channelAssignments[question.id][id]],
      combinedScore: getExpertiseWeight(AGENTS[id], question) * CHANNEL_WEIGHTS[channelAssignments[question.id][id]],
    })),
    consultResults: consultResults.map(r => ({
      agentName: r.agentName,
      channel: r.channelName,
      rawLength: r.rawLength,
      corruptedPreview: r.corrupted.substring(0, 150) + '...',
    })),
    finalAnswerPreview: finalAnswer.substring(0, 200) + '...',
    score: gradeResult.score,
    reason: gradeResult.reason,
    ...meta,
  };
}

// --- Batch execution with concurrency limit ---
async function batchRun(tasks, concurrency = 5) {
  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
    if (i + concurrency < tasks.length) {
      console.log(`  Completed ${Math.min(i + concurrency, tasks.length)}/${tasks.length} tasks...`);
    }
  }
  return results;
}

// --- Main ---
async function main() {
  console.log('=== KI-4 Redo: Agent-to-Agent Communication Experiment ===\n');

  // Print channel assignments
  console.log('Channel Assignments (Agent0=Medical, Agent1=Legal, Agent2=Finance, Agent3=Tech):');
  for (const q of QUESTIONS) {
    const ca = channelAssignments[q.id];
    console.log(`  Q${q.id.toString().padStart(2)}: [${AGENTS.map((_, i) => ca[i].padEnd(6)).join(' | ')}]  (${q.primary})`);
  }
  console.log('');

  const CONDITIONS = ['Fixed', 'ExpertiseOnly', 'ChannelOnly', 'Joint', 'Joint+EarlyStop'];
  const allResults = [];

  for (const condition of CONDITIONS) {
    console.log(`\n--- Running condition: ${condition} ---`);
    const tasks = QUESTIONS.map(q => () => runCondition(condition, q));
    const results = await batchRun(tasks, 5);
    allResults.push(...results);

    const avg = results.reduce((s, r) => s + r.score, 0) / results.length;
    console.log(`  ${condition} avg score: ${avg.toFixed(2)}`);
  }

  // --- Summary ---
  console.log('\n\n========== SUMMARY ==========\n');

  const conditionScores = {};
  for (const condition of CONDITIONS) {
    const results = allResults.filter(r => r.condition === condition);
    const avg = results.reduce((s, r) => s + r.score, 0) / results.length;
    const scores = results.map(r => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    conditionScores[condition] = { avg, min, max, scores };
  }

  console.log('Condition           | Avg Score | Min | Max');
  console.log('-'.repeat(55));
  for (const condition of CONDITIONS) {
    const s = conditionScores[condition];
    console.log(`${condition.padEnd(20)}| ${s.avg.toFixed(2).padStart(9)} | ${s.min.toFixed(1).padStart(3)} | ${s.max.toFixed(1).padStart(3)}`);
  }

  // Per-question breakdown
  console.log('\n\nPer-Question Breakdown:');
  console.log(`${'Q#'.padEnd(4)} ${'Domain'.padEnd(10)} ${CONDITIONS.map(c => c.substring(0, 10).padEnd(12)).join('')}`);
  console.log('-'.repeat(75));
  for (const q of QUESTIONS) {
    const row = [
      `Q${q.id.toString().padStart(2)}`.padEnd(4),
      q.primary.padEnd(10),
    ];
    for (const condition of CONDITIONS) {
      const r = allResults.find(r => r.condition === condition && r.questionId === q.id);
      row.push(r.score.toFixed(1).padStart(5).padEnd(12));
    }
    console.log(row.join(''));
  }

  // Domain breakdown
  console.log('\n\nPer-Domain Average:');
  const domains = ['medical', 'legal', 'finance', 'tech'];
  console.log(`${'Domain'.padEnd(10)} ${CONDITIONS.map(c => c.substring(0, 10).padEnd(12)).join('')}`);
  console.log('-'.repeat(75));
  for (const domain of domains) {
    const row = [domain.padEnd(10)];
    for (const condition of CONDITIONS) {
      const results = allResults.filter(r => r.condition === condition && QUESTIONS.find(q => q.id === r.questionId).primary === domain);
      const avg = results.reduce((s, r) => s + r.score, 0) / results.length;
      row.push(avg.toFixed(2).padStart(5).padEnd(12));
    }
    console.log(row.join(''));
  }

  // Save results
  const output = {
    experiment: 'KI-4 Redo: Agent-to-Agent Communication',
    timestamp: new Date().toISOString(),
    config: {
      channels: CHANNELS,
      channelWeights: CHANNEL_WEIGHTS,
      expertiseWeights: { primary: 1.0, secondary: 0.5, unrelated: 0.2 },
      models: { specialist: 'gpt-4o-mini', receiver: 'gpt-4o-mini', grader: 'gpt-4o' },
    },
    channelAssignments,
    questions: QUESTIONS,
    results: allResults,
    summary: {
      conditionScores,
      perDomain: {},
    },
  };

  for (const domain of domains) {
    output.summary.perDomain[domain] = {};
    for (const condition of CONDITIONS) {
      const results = allResults.filter(r => r.condition === condition && QUESTIONS.find(q => q.id === r.questionId).primary === domain);
      output.summary.perDomain[domain][condition] = results.reduce((s, r) => s + r.score, 0) / results.length;
    }
  }

  writeFileSync('C:/Users/hyunj/wcisl/scripts/ki4_redo_results.json', JSON.stringify(output, null, 2));
  console.log('\n\nResults saved to C:/Users/hyunj/wcisl/scripts/ki4_redo_results.json');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
