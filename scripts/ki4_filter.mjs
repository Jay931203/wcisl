// KI-4 Filter Experiment: Channel Quality Impact WITHOUT Receiving Agent Recovery
// Corrupted text goes DIRECTLY to grader — no AI recovery step.
// This ensures channel quality directly impacts the final score.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── API Key ───
if (!apiKeyMatch) throw new Error('No OPENAI_API_KEY found');
const OPENAI_API_KEY = apiKeyMatch[1].trim();

// ─── Channel Configurations (HARSH) ───
const CHANNELS = {
  Good:   { maxTokens: 500, corruptionRate: 0.00 },
  Medium: { maxTokens: 150, corruptionRate: 0.20 },
  Bad:    { maxTokens: 60,  corruptionRate: 0.50 },
};

// ─── 4 Specialist Domains ───
const DOMAINS = ['Medical', 'Legal', 'Finance', 'Tech'];

const SPECIALIST_PROMPTS = {
  Medical: 'You are a medical specialist. Answer the following medical question accurately and concisely. Provide specific treatments, dosages, and protocols where relevant.',
  Legal: 'You are a legal specialist. Answer the following legal question accurately and concisely. Cite specific legal principles and elements.',
  Finance: 'You are a finance specialist. Answer the following finance question accurately and concisely. Show calculations where needed.',
  Tech: 'You are a technology specialist. Answer the following computer science/technology question accurately and concisely. Be specific about algorithms and mechanisms.',
};

// ─── 15 Questions with domain assignments and references ───
const QUESTIONS = [
  { id: 1,  q: "What is the first-line treatment for hypertension in a patient with diabetes?", ref: "ACE inhibitor or ARB", primary: 'Medical', secondary: 'Finance' },
  { id: 2,  q: "What is the differential diagnosis for acute right lower quadrant abdominal pain?", ref: "Appendicitis, ovarian torsion, ectopic pregnancy, Crohn's", primary: 'Medical', secondary: 'Legal' },
  { id: 3,  q: "Describe the management protocol for acute ST-elevation myocardial infarction.", ref: "PCI within 90 minutes, dual antiplatelet therapy, heparin", primary: 'Medical', secondary: 'Tech' },
  { id: 4,  q: "What is the drug of choice for status epilepticus and subsequent management?", ref: "IV lorazepam first-line, then IV phenytoin/fosphenytoin", primary: 'Medical', secondary: 'Legal' },
  { id: 5,  q: "What are the four elements required to prove negligence in tort law?", ref: "Duty, breach, causation, damages", primary: 'Legal', secondary: 'Medical' },
  { id: 6,  q: "Explain the difference between copyright and trademark protection.", ref: "Copyright protects creative expression; trademark protects brand identity/source identifiers", primary: 'Legal', secondary: 'Tech' },
  { id: 7,  q: "What makes a contract void versus voidable?", ref: "Void: illegal purpose or lack of capacity from inception; Voidable: misrepresentation, duress, undue influence", primary: 'Legal', secondary: 'Finance' },
  { id: 8,  q: "What remedies are available to an employee upon wrongful termination?", ref: "Back pay, reinstatement, compensatory and punitive damages", primary: 'Legal', secondary: 'Finance' },
  { id: 9,  q: "Calculate the NPV of a $100,000 investment that returns $30,000 per year for 5 years at a 10% discount rate.", ref: "$13,724 (NPV = -100000 + 30000*PV annuity factor)", primary: 'Finance', secondary: 'Tech' },
  { id: 10, q: "Explain the difference between operating leverage and financial leverage.", ref: "Operating leverage: proportion of fixed operating costs; Financial leverage: use of debt to amplify returns", primary: 'Finance', secondary: 'Legal' },
  { id: 11, q: "Calculate WACC given: 60% equity at 12% cost, 40% debt at 6% cost, corporate tax rate 25%.", ref: "WACC = 0.6*12% + 0.4*6%*(1-0.25) = 7.2% + 1.8% = 9.0%", primary: 'Finance', secondary: 'Tech' },
  { id: 12, q: "Perform break-even analysis: fixed costs $500,000, variable cost $30/unit, selling price $80/unit.", ref: "Break-even = 500000 / (80-30) = 10,000 units", primary: 'Finance', secondary: 'Medical' },
  { id: 13, q: "What is the time complexity of binary search and why?", ref: "O(log n) because each comparison halves the search space", primary: 'Tech', secondary: 'Finance' },
  { id: 14, q: "How does TCP ensure reliable data delivery over an unreliable network?", ref: "Sequence numbers, acknowledgments, retransmission, flow control, congestion control", primary: 'Tech', secondary: 'Legal' },
  { id: 15, q: "Explain the CAP theorem with practical examples of each tradeoff.", ref: "Consistency, Availability, Partition tolerance — can only guarantee 2 of 3. CP: MongoDB; AP: Cassandra; CA: traditional RDBMS (no partition)", primary: 'Tech', secondary: 'Medical' },
];

// ─── Deterministic channel assignment (seed=42 equivalent) ───
// Use a simple seeded PRNG
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

const rng = seededRandom(42);
const CHANNEL_NAMES = ['Good', 'Medium', 'Bad'];

// Assign channels per specialist per question (4 specialists x 15 questions)
// channelMap[questionId][domain] = 'Good'|'Medium'|'Bad'
const channelMap = {};
for (const q of QUESTIONS) {
  channelMap[q.id] = {};
  for (const d of DOMAINS) {
    const idx = Math.floor(rng() * 3);
    channelMap[q.id][d] = CHANNEL_NAMES[idx];
  }
}

// ─── Corruption function ───
function corruptText(text, rate) {
  if (rate === 0) return text;
  const words = text.split(/\s+/);
  const corrupted = words.map(w => {
    if (Math.random() < rate) return '[???]';
    return w;
  });
  return corrupted.join(' ');
}

// ─── Expertise scores ───
function getExpertise(specialistDomain, questionPrimary, questionSecondary) {
  if (specialistDomain === questionPrimary) return 1.0;
  if (specialistDomain === questionSecondary) return 0.5;
  return 0.2;
}

function getChannelScore(channelName) {
  if (channelName === 'Good') return 1.0;
  if (channelName === 'Medium') return 0.5;
  return 0.1;
}

// ─── OpenAI API call ───
async function callOpenAI(model, systemPrompt, userPrompt, maxTokens, temperature = 0) {
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
  return data.choices[0].message.content;
}

// ─── Call specialist through channel ───
async function consultSpecialist(domain, question, channelName) {
  const ch = CHANNELS[channelName];
  const raw = await callOpenAI(
    'gpt-4o-mini',
    SPECIALIST_PROMPTS[domain],
    question,
    ch.maxTokens,
    0
  );
  const corrupted = corruptText(raw, ch.corruptionRate);
  return { domain, channel: channelName, raw, corrupted };
}

// ─── Grader ───
async function gradeResponse(question, reference, corruptedText) {
  const prompt = `You are a strict academic grader. Score the following answer on a scale of 0-10.

QUESTION: ${question}
REFERENCE ANSWER: ${reference}

RECEIVED ANSWER (this is exactly what the system received — may be corrupted or truncated):
${corruptedText}

Scoring criteria:
- 0-2: Answer is mostly corrupted, unreadable, or completely wrong
- 3-4: Some relevant content but major gaps or corruption makes it largely unusable
- 5-6: Partially correct, some key points present but significant issues
- 7-8: Mostly correct with minor gaps or issues
- 9-10: Comprehensive, accurate, clearly communicated

Respond with ONLY a JSON object: {"score": <number>, "reason": "<brief explanation>"}`;

  const resp = await callOpenAI('gpt-4o', 'You are a strict grader. Output only valid JSON.', prompt, 200, 0);
  try {
    const parsed = JSON.parse(resp);
    return parsed;
  } catch {
    const match = resp.match(/(\d+(\.\d+)?)/);
    return { score: match ? parseFloat(match[1]) : 0, reason: resp };
  }
}

// ─── Condition Implementations ───

// Select which 2 specialists to consult and in what order
function selectSpecialists_FixedOrder(question, questionChannels) {
  // Always Medical -> Legal -> Finance -> Tech, pick first 2
  const order = ['Medical', 'Legal', 'Finance', 'Tech'];
  return order.slice(0, 2);
}

function selectSpecialists_ExpertiseOnly(question, questionChannels) {
  // Sort by expertise, pick top 2
  const scored = DOMAINS.map(d => ({
    domain: d,
    expertise: getExpertise(d, question.primary, question.secondary),
  }));
  scored.sort((a, b) => b.expertise - a.expertise);
  return scored.slice(0, 2).map(s => s.domain);
}

function selectSpecialists_ChannelOnly(question, questionChannels) {
  // Sort by channel quality, pick top 2
  const scored = DOMAINS.map(d => ({
    domain: d,
    channelScore: getChannelScore(questionChannels[d]),
  }));
  scored.sort((a, b) => b.channelScore - a.channelScore);
  return scored.slice(0, 2).map(s => s.domain);
}

function selectSpecialists_Joint(question, questionChannels) {
  // Sort by expertise * channel, pick top 2
  const scored = DOMAINS.map(d => ({
    domain: d,
    combined: getExpertise(d, question.primary, question.secondary) * getChannelScore(questionChannels[d]),
  }));
  scored.sort((a, b) => b.combined - a.combined);
  return scored.slice(0, 2).map(s => s.domain);
}

function selectSpecialists_JointEarlyStop(question, questionChannels) {
  // Same as Joint but only 1 if first agent is primary expert + Good channel
  const scored = DOMAINS.map(d => ({
    domain: d,
    expertise: getExpertise(d, question.primary, question.secondary),
    channel: questionChannels[d],
    combined: getExpertise(d, question.primary, question.secondary) * getChannelScore(questionChannels[d]),
  }));
  scored.sort((a, b) => b.combined - a.combined);
  const first = scored[0];
  if (first.expertise === 1.0 && first.channel === 'Good') {
    return [first.domain]; // early stop
  }
  return scored.slice(0, 2).map(s => s.domain);
}

const CONDITIONS = [
  { name: 'Fixed Order', select: selectSpecialists_FixedOrder },
  { name: 'Expertise Only', select: selectSpecialists_ExpertiseOnly },
  { name: 'Channel Only', select: selectSpecialists_ChannelOnly },
  { name: 'Joint', select: selectSpecialists_Joint },
  { name: 'Joint + Early Stop', select: selectSpecialists_JointEarlyStop },
];

// ─── Run a single question under a condition ───
async function runQuestion(condition, question) {
  const qChannels = channelMap[question.id];
  const specialists = condition.select(question, qChannels);

  // Consult each specialist through their channel
  const consultations = [];
  for (const domain of specialists) {
    const result = await consultSpecialist(domain, question.q, qChannels[domain]);
    consultations.push(result);
  }

  // Concatenate all corrupted responses (no recovery!)
  const combinedText = consultations
    .map((c, i) => `[Agent ${i+1} - ${c.domain}]: ${c.corrupted}`)
    .join('\n\n');

  // Grade the corrupted combined text directly
  const grade = await gradeResponse(question.q, question.ref, combinedText);

  return {
    questionId: question.id,
    question: question.q,
    reference: question.ref,
    primary: question.primary,
    secondary: question.secondary,
    specialists: specialists.map(d => ({
      domain: d,
      channel: qChannels[d],
      expertise: getExpertise(d, question.primary, question.secondary),
    })),
    combinedText,
    score: grade.score,
    reason: grade.reason,
  };
}

// ─── Batch helper (5 concurrent) ───
async function batchRun(tasks, batchSize = 5) {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
    if (i + batchSize < tasks.length) {
      console.log(`    Completed ${Math.min(i + batchSize, tasks.length)}/${tasks.length}`);
    }
  }
  return results;
}

// ─── Main ───
async function main() {
  console.log('=== KI-4 Filter Experiment: No Recovery, Harsh Channels ===\n');

  // Print channel assignments
  console.log('Channel Assignments (seed=42):');
  console.log('Q# | Medical | Legal | Finance | Tech');
  console.log('---|---------|-------|---------|-----');
  for (const q of QUESTIONS) {
    const cm = channelMap[q.id];
    console.log(`${String(q.id).padStart(2)} | ${cm.Medical.padEnd(7)} | ${cm.Legal.padEnd(5)} | ${cm.Finance.padEnd(7)} | ${cm.Tech}`);
  }
  console.log();

  const allResults = {};

  for (const condition of CONDITIONS) {
    console.log(`\n--- Running: ${condition.name} ---`);
    const tasks = QUESTIONS.map(q => () => runQuestion(condition, q));
    const results = await batchRun(tasks, 5);
    allResults[condition.name] = results;

    const scores = results.map(r => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`  Average score: ${avg.toFixed(2)}`);
  }

  // ─── Summary Table ───
  console.log('\n\n========================================');
  console.log('         SUMMARY TABLE');
  console.log('========================================\n');

  const conditionNames = CONDITIONS.map(c => c.name);
  const summaryRows = [];

  // Header
  console.log(`${'Condition'.padEnd(22)} | Avg   | Med   | Min   | Max   | StdDev`);
  console.log('-'.repeat(75));

  for (const name of conditionNames) {
    const scores = allResults[name].map(r => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sorted = [...scores].sort((a, b) => a - b);
    const med = sorted.length % 2 === 0
      ? (sorted[sorted.length/2 - 1] + sorted[sorted.length/2]) / 2
      : sorted[Math.floor(sorted.length/2)];
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const variance = scores.reduce((a, s) => a + (s - avg) ** 2, 0) / scores.length;
    const stddev = Math.sqrt(variance);

    console.log(`${name.padEnd(22)} | ${avg.toFixed(2)} | ${med.toFixed(2)} | ${min.toFixed(2)} | ${max.toFixed(2)} | ${stddev.toFixed(2)}`);
    summaryRows.push({ condition: name, avg, median: med, min, max, stddev });
  }

  // ─── Per-question breakdown ───
  console.log('\n\nPer-Question Scores:');
  console.log(`${'Q#'.padEnd(4)} | ${'Domain'.padEnd(8)} | ${conditionNames.map(n => n.substring(0,10).padEnd(10)).join(' | ')}`);
  console.log('-'.repeat(80));
  for (const q of QUESTIONS) {
    const scores = conditionNames.map(name => {
      const r = allResults[name].find(r => r.questionId === q.id);
      return r.score.toFixed(1).padEnd(10);
    });
    console.log(`${String(q.id).padEnd(4)} | ${q.primary.substring(0,8).padEnd(8)} | ${scores.join(' | ')}`);
  }

  // ─── Analysis ───
  console.log('\n\nKey Analysis:');
  const jointAvg = summaryRows.find(r => r.condition === 'Joint').avg;
  const fixedAvg = summaryRows.find(r => r.condition === 'Fixed Order').avg;
  const expertAvg = summaryRows.find(r => r.condition === 'Expertise Only').avg;
  const channelAvg = summaryRows.find(r => r.condition === 'Channel Only').avg;
  const earlyAvg = summaryRows.find(r => r.condition === 'Joint + Early Stop').avg;

  console.log(`  Joint vs Fixed Order:    ${(jointAvg - fixedAvg) > 0 ? '+' : ''}${(jointAvg - fixedAvg).toFixed(2)}`);
  console.log(`  Joint vs Expertise Only: ${(jointAvg - expertAvg) > 0 ? '+' : ''}${(jointAvg - expertAvg).toFixed(2)}`);
  console.log(`  Joint vs Channel Only:   ${(jointAvg - channelAvg) > 0 ? '+' : ''}${(jointAvg - channelAvg).toFixed(2)}`);
  console.log(`  Early Stop vs Joint:     ${(earlyAvg - jointAvg) > 0 ? '+' : ''}${(earlyAvg - jointAvg).toFixed(2)}`);
  console.log(`  Score range:             ${Math.min(...summaryRows.map(r => r.avg)).toFixed(2)} - ${Math.max(...summaryRows.map(r => r.avg)).toFixed(2)}`);

  // ─── Save results ───
  const output = {
    experiment: 'KI-4 Filter: No Recovery, Harsh Channels',
    timestamp: new Date().toISOString(),
    design: {
      channels: CHANNELS,
      maxConsultations: 2,
      noRecoveryAgent: true,
      graderModel: 'gpt-4o',
      specialistModel: 'gpt-4o-mini',
      temperature: 0,
    },
    channelAssignments: channelMap,
    questions: QUESTIONS,
    summary: summaryRows,
    detailed: allResults,
  };

  const outPath = path.join(__dirname, 'ki4_filter_results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(console.error);
