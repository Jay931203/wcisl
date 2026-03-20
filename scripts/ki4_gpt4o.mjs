/**
 * KI-4 Experiment: A2A Adaptive Scheduling with Receiving Agent
 * Pipeline: Question → Specialist (max_tokens enforced) → Channel corruption → Receiving Agent → Grader
 * ALL agents use GPT-4o. Batch size 3, 500ms delay between batches.
 * 5 conditions: Fixed Order, Expertise Only, Channel Only, Joint, Joint + Early Stop
 */

import fs from 'fs';

const envContent = fs.readFileSync('C:/Users/hyunj/studyeng/.env.local', 'utf-8');
const OPENAI_API_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!OPENAI_API_KEY) throw new Error('No OPENAI_API_KEY found');

const MODEL = 'gpt-4o';
const TEMPERATURE = 0;
const BATCH_SIZE = 3;
const DELAY_MS = 500;
const MAX_RETRIES = 3;

// ─── SEEDED RNG (seed=42) ──────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── CHANNELS (HARSH) ──────────────────────────────────────────────────────
const CHANNELS = {
  Good:   { maxTokens: 500, corruptionRate: 0.00 },
  Medium: { maxTokens: 120, corruptionRate: 0.25 },
  Bad:    { maxTokens: 50,  corruptionRate: 0.50 },
};
const CHANNEL_WEIGHTS = { Good: 1.0, Medium: 0.4, Bad: 0.1 };

// ─── SPECIALISTS ────────────────────────────────────────────────────────────
const SPECIALISTS = ['Medical', 'Legal', 'Finance', 'Tech'];

const SPECIALIST_PROMPTS = {
  Medical: 'You are an expert physician and medical researcher. Provide accurate, detailed medical information.',
  Legal: 'You are an expert attorney with broad legal knowledge. Provide accurate, detailed legal analysis.',
  Finance: 'You are an expert financial analyst and accountant. Provide accurate, detailed financial analysis with calculations.',
  Tech: 'You are an expert software engineer and computer scientist. Provide accurate, detailed technical explanations.',
};

// Expertise weights: primary=1.0, secondary=0.5, unrelated=0.2
const EXPERTISE_MAP = {
  medical:  { Medical: 1.0, Legal: 0.2, Finance: 0.2, Tech: 0.2 },
  legal:    { Medical: 0.2, Legal: 1.0, Finance: 0.5, Tech: 0.2 },
  finance:  { Medical: 0.2, Legal: 0.5, Finance: 1.0, Tech: 0.2 },
  tech:     { Medical: 0.2, Legal: 0.2, Finance: 0.2, Tech: 1.0 },
};

// ─── RECEIVING AGENT PROMPT ─────────────────────────────────────────────────
const RECEIVING_PROMPT = `You received messages that may be partially corrupted (words replaced with [???]) or truncated. Using your knowledge, reconstruct the meaning and provide a comprehensive answer to the original question.`;

// ─── 15 QUESTIONS ───────────────────────────────────────────────────────────
const QUESTIONS = [
  // Medical (1-4)
  { id: 1, text: 'First-line treatment for hypertension with comorbid diabetes?', primary_domain: 'medical',
    reference_answer: 'ACE inhibitors (e.g., lisinopril) or ARBs (e.g., losartan) are first-line for hypertension with diabetes due to renal protective effects. Target BP <130/80 mmHg. Can add thiazide diuretic or CCB as second agent. Avoid beta-blockers as first-line (mask hypoglycemia). SGLT2 inhibitors provide dual benefit.' },
  { id: 2, text: 'Differential diagnosis for acute chest pain with troponin elevation?', primary_domain: 'medical',
    reference_answer: 'STEMI/NSTEMI (acute coronary syndrome), myocarditis, pulmonary embolism, aortic dissection, takotsubo cardiomyopathy, severe heart failure, hypertensive crisis, cardiac contusion, sepsis with cardiac involvement, renal failure. ECG pattern, echocardiography, and clinical context differentiate causes.' },
  { id: 3, text: 'Emergency management of anaphylaxis?', primary_domain: 'medical',
    reference_answer: 'Immediate IM epinephrine 0.3-0.5mg (1:1000) in lateral thigh, repeat q5-15min. Remove trigger. Supine position with legs elevated. High-flow oxygen. IV access + NS bolus for hypotension. Adjuncts: H1 antihistamine (diphenhydramine), H2 blocker (ranitidine), corticosteroids (methylprednisolone), nebulized albuterol for bronchospasm. Observe 4-6hrs for biphasic reaction.' },
  { id: 4, text: 'Warfarin drug interactions and INR management?', primary_domain: 'medical',
    reference_answer: 'CYP2C9/3A4 interactions. Increase INR: metronidazole, fluconazole, amiodarone, NSAIDs, SSRIs, acetaminophen (high dose). Decrease INR: rifampin, carbamazepine, vitamin K foods (leafy greens). Target INR 2-3 (most indications), 2.5-3.5 (mechanical valves). Monitor weekly initially, then monthly. Genetic testing CYP2C9/VKORC1 for dosing. Bridge with LMWH for procedures.' },

  // Legal (5-8)
  { id: 5, text: 'Elements required to prove negligence in tort law?', primary_domain: 'legal',
    reference_answer: 'Four elements: (1) Duty of care - defendant owed plaintiff a legal duty, (2) Breach - defendant failed to meet reasonable standard of care, (3) Causation - both actual cause (but-for test) and proximate cause (foreseeability), (4) Damages - plaintiff suffered actual harm/loss. Burden of proof: preponderance of evidence. Defenses: contributory/comparative negligence, assumption of risk.' },
  { id: 6, text: 'Difference between merger and acquisition legally?', primary_domain: 'legal',
    reference_answer: 'Merger: two companies combine into one entity; one survives, other dissolves. Requires board and shareholder approval of both companies. Acquisition: one company purchases another; target may continue as subsidiary. Can be stock purchase (buy shares) or asset purchase (buy specific assets/liabilities). Tax implications differ. Due diligence required. Antitrust review (Hart-Scott-Rodino Act). Representations, warranties, indemnification in agreement.' },
  { id: 7, text: 'Tenant rights when landlord fails to make repairs?', primary_domain: 'legal',
    reference_answer: 'Implied warranty of habitability requires landlord maintain livable conditions. Tenant remedies: (1) Repair and deduct from rent (after written notice), (2) Rent withholding/escrow, (3) Report to housing authority/code enforcement, (4) Constructive eviction claim if uninhabitable, (5) Sue for damages and rent abatement. Must give written notice and reasonable time to repair. Retaliation by landlord is illegal.' },
  { id: 8, text: 'Non-compete clause enforceability requirements?', primary_domain: 'legal',
    reference_answer: 'Must be: (1) Supported by consideration (employment or additional compensation), (2) Reasonable in scope - geographic area, time duration (typically 1-2 years), activity restricted, (3) Protect legitimate business interest (trade secrets, client relationships), (4) Not unduly burdensome on employee. Blue-pencil doctrine allows courts to modify. Some states ban entirely (California). Must be signed voluntarily. Varies significantly by jurisdiction.' },

  // Finance (9-12)
  { id: 9, text: 'Calculate NPV: $100K investment, $30K/yr 5 years, 10% discount?', primary_domain: 'finance',
    reference_answer: 'NPV = -100,000 + 30,000/1.1 + 30,000/1.21 + 30,000/1.331 + 30,000/1.4641 + 30,000/1.61051 = -100,000 + 27,273 + 24,793 + 22,539 + 20,490 + 18,628 = $13,723. Positive NPV means project adds value. PV annuity factor = 3.7908.' },
  { id: 10, text: 'Calculate WACC: 60% equity at 12%, 40% debt at 6%, tax 25%?', primary_domain: 'finance',
    reference_answer: 'WACC = (E/V × Re) + (D/V × Rd × (1-T)) = (0.60 × 0.12) + (0.40 × 0.06 × 0.75) = 0.072 + 0.018 = 0.090 = 9.0%. Equity component contributes 7.2%, after-tax debt contributes 1.8%.' },
  { id: 11, text: 'Break-even: fixed $500K, variable $30/unit, price $80/unit?', primary_domain: 'finance',
    reference_answer: 'Break-even units = Fixed Costs / (Price - Variable Cost) = 500,000 / (80 - 30) = 500,000 / 50 = 10,000 units. Break-even revenue = 10,000 × $80 = $800,000. Contribution margin per unit = $50, contribution margin ratio = 62.5%.' },
  { id: 12, text: 'Explain operating leverage vs financial leverage?', primary_domain: 'finance',
    reference_answer: 'Operating leverage: ratio of fixed to variable costs. High OL = small revenue change causes large EBIT change. DOL = % change EBIT / % change sales. Financial leverage: use of debt financing. High FL = EBIT change amplified to larger EPS change. DFL = % change EPS / % change EBIT. Combined leverage = DOL × DFL. High OL + high FL = very volatile earnings. OL is business risk, FL is financial risk.' },

  // Tech (13-15)
  { id: 13, text: 'TCP vs UDP: differences and use cases?', primary_domain: 'tech',
    reference_answer: 'TCP: connection-oriented, reliable delivery, ordered packets, flow/congestion control, 3-way handshake, higher latency. Used for: HTTP/HTTPS, email (SMTP), file transfer (FTP), SSH. UDP: connectionless, no guaranteed delivery, no ordering, no congestion control, lower latency. Used for: DNS, streaming, gaming, VoIP, DHCP. TCP header 20+ bytes, UDP header 8 bytes.' },
  { id: 14, text: 'SQL injection prevention methods?', primary_domain: 'tech',
    reference_answer: 'Primary: (1) Parameterized queries/prepared statements (bind variables), (2) Stored procedures with parameterized inputs, (3) Input validation (whitelist allowed characters), (4) ORM frameworks. Secondary: (5) Least privilege DB accounts, (6) WAF (Web Application Firewall), (7) Escape special characters, (8) Error handling (don\'t expose DB errors). OWASP recommends parameterized queries as primary defense.' },
  { id: 15, text: 'CAP theorem explanation with examples?', primary_domain: 'tech',
    reference_answer: 'CAP theorem: distributed system can guarantee at most 2 of 3: Consistency (all nodes see same data), Availability (every request gets response), Partition tolerance (system works despite network failures). CP systems: MongoDB, HBase (sacrifice availability during partitions). AP systems: Cassandra, DynamoDB (eventual consistency). CA systems: single-node RDBMS (no partition tolerance). In practice, partitions happen, so choose CP or AP.' },
];

// ─── CHANNEL ASSIGNMENT (seed=42, shuffle [Good, Medium, Bad, Bad] per question) ─
const CHANNEL_ASSIGNMENTS = {};
for (const q of QUESTIONS) {
  const channels = shuffle(['Good', 'Medium', 'Bad', 'Bad']);
  CHANNEL_ASSIGNMENTS[q.id] = {};
  SPECIALISTS.forEach((s, i) => { CHANNEL_ASSIGNMENTS[q.id][s] = channels[i]; });
}

// ─── API CALL WITH RETRY ───────────────────────────────────────────────────
async function callGPT(systemPrompt, userPrompt, maxTokens = 1000) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: TEMPERATURE,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (resp.status === 429) {
        console.log(`  [429] Rate limited, waiting 5s (attempt ${attempt + 1})...`);
        await sleep(5000);
        continue;
      }
      const data = await resp.json();
      if (data.error) {
        console.log(`  [API Error] ${data.error.message}, retrying...`);
        await sleep(3000);
        continue;
      }
      return data.choices[0].message.content;
    } catch (e) {
      console.log(`  [Error] ${e.message}, retrying...`);
      await sleep(3000);
    }
  }
  return '[ERROR: API call failed after retries]';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── CORRUPTION ─────────────────────────────────────────────────────────────
function corrupt(text, rate) {
  if (rate <= 0) return text;
  const words = text.split(/\s+/);
  return words.map(w => rng() < rate ? '[???]' : w).join(' ');
}

// ─── SPECIALIST CALL (with channel enforcement) ─────────────────────────────
async function callSpecialist(agent, question, channel) {
  const ch = CHANNELS[channel];
  const raw = await callGPT(SPECIALIST_PROMPTS[agent], question, ch.maxTokens);
  const corrupted = corrupt(raw, ch.corruptionRate);
  return { agent, channel, raw, corrupted };
}

// ─── RECEIVING AGENT ────────────────────────────────────────────────────────
async function callReceivingAgent(question, messages) {
  const formatted = messages.map((m, i) =>
    `--- Message ${i + 1} (from ${m.agent}, channel: ${m.channel}) ---\n${m.corrupted}`
  ).join('\n\n');
  const userPrompt = `Original question: "${question}"\n\nReceived messages:\n${formatted}\n\nProvide a comprehensive answer to the original question.`;
  return await callGPT(RECEIVING_PROMPT, userPrompt, 800);
}

// ─── GRADER ─────────────────────────────────────────────────────────────────
async function grade(question, referenceAnswer, receivingAnswer) {
  const systemPrompt = `You are a strict grader. Score the answer 0-10 based on accuracy, completeness, and correctness compared to the reference. Output ONLY a JSON object: {"score": <number>, "reason": "<brief reason>"}`;
  const userPrompt = `Question: "${question}"\n\nReference Answer: "${referenceAnswer}"\n\nAnswer to Grade: "${receivingAnswer}"`;
  const raw = await callGPT(systemPrompt, userPrompt, 200);
  try {
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return { score: -1, reason: 'Parse error: ' + raw };
}

// ─── BATCH HELPER ───────────────────────────────────────────────────────────
async function batchRun(tasks) {
  const results = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
    if (i + BATCH_SIZE < tasks.length) await sleep(DELAY_MS);
  }
  return results;
}

// ─── CONDITION LOGIC ────────────────────────────────────────────────────────

function getExpertiseWeight(domain, agent) {
  return EXPERTISE_MAP[domain]?.[agent] ?? 0.2;
}

function selectAgents(condition, questionDomain, questionId) {
  const assignments = CHANNEL_ASSIGNMENTS[questionId];

  if (condition === 'fixed_order') {
    // Medical → Legal → Finance always. 2 consultations.
    return ['Medical', 'Legal', 'Finance'].slice(0, 2);
  }

  if (condition === 'expertise_only') {
    // Primary domain first, then secondary (highest expertise). Ignore channel. 2 consultations.
    const sorted = [...SPECIALISTS].sort((a, b) =>
      getExpertiseWeight(questionDomain, b) - getExpertiseWeight(questionDomain, a)
    );
    return sorted.slice(0, 2);
  }

  if (condition === 'channel_only') {
    // Best channel first, then next best. Ignore expertise. 2 consultations.
    const sorted = [...SPECIALISTS].sort((a, b) =>
      CHANNEL_WEIGHTS[assignments[b]] - CHANNEL_WEIGHTS[assignments[a]]
    );
    return sorted.slice(0, 2);
  }

  if (condition === 'joint') {
    // combined = expertise × channel. Top 2 by score.
    const scored = SPECIALISTS.map(a => ({
      agent: a,
      score: getExpertiseWeight(questionDomain, a) * CHANNEL_WEIGHTS[assignments[a]],
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 2).map(s => s.agent);
  }

  if (condition === 'joint_early_stop') {
    // Same as joint, but only 1 if top combined > 0.8
    const scored = SPECIALISTS.map(a => ({
      agent: a,
      score: getExpertiseWeight(questionDomain, a) * CHANNEL_WEIGHTS[assignments[a]],
    }));
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].score > 0.8) return [scored[0].agent];
    return scored.slice(0, 2).map(s => s.agent);
  }

  return [];
}

// ─── MAIN EXPERIMENT ────────────────────────────────────────────────────────
const CONDITIONS = ['fixed_order', 'expertise_only', 'channel_only', 'joint', 'joint_early_stop'];

async function runExperiment() {
  console.log('=== KI-4 Experiment: A2A Adaptive Scheduling (GPT-4o) ===\n');
  console.log('Channel assignments per question:');
  for (const q of QUESTIONS) {
    const a = CHANNEL_ASSIGNMENTS[q.id];
    console.log(`  Q${q.id}: Medical=${a.Medical}, Legal=${a.Legal}, Finance=${a.Finance}, Tech=${a.Tech}`);
  }
  console.log('');

  const allResults = [];
  let apiCalls = 0;

  for (const condition of CONDITIONS) {
    console.log(`\n--- Condition: ${condition} ---`);
    const conditionResults = [];

    // Process questions in batches of 3 (serialize per question since pipeline is sequential)
    for (let qi = 0; qi < QUESTIONS.length; qi++) {
      const q = QUESTIONS[qi];
      const agents = selectAgents(condition, q.primary_domain, q.id);
      console.log(`  Q${q.id} [${q.primary_domain}]: agents=${agents.join(',')} (${agents.length} consultations)`);

      // Step 1: Call specialists (can parallelize within question)
      const specialistResults = [];
      const specTasks = agents.map(agent => async () => {
        const channel = CHANNEL_ASSIGNMENTS[q.id][agent];
        apiCalls++;
        return await callSpecialist(agent, q.text, channel);
      });

      const specBatch = await Promise.all(specTasks.map(fn => fn()));
      specialistResults.push(...specBatch);
      await sleep(DELAY_MS);

      // Step 2: Receiving agent
      apiCalls++;
      const receivingAnswer = await callReceivingAgent(q.text, specialistResults);
      await sleep(DELAY_MS);

      // Step 3: Grader
      apiCalls++;
      const gradeResult = await grade(q.text, q.reference_answer, receivingAnswer);
      console.log(`    Score: ${gradeResult.score} - ${gradeResult.reason}`);

      conditionResults.push({
        question_id: q.id,
        question: q.text,
        domain: q.primary_domain,
        condition,
        agents_selected: agents,
        num_consultations: agents.length,
        channel_assignments: Object.fromEntries(agents.map(a => [a, CHANNEL_ASSIGNMENTS[q.id][a]])),
        specialist_outputs: specialistResults.map(s => ({
          agent: s.agent,
          channel: s.channel,
          raw_length: s.raw.length,
          corrupted_preview: s.corrupted.substring(0, 150) + '...',
        })),
        receiving_answer_preview: receivingAnswer.substring(0, 200) + '...',
        score: gradeResult.score,
        reason: gradeResult.reason,
      });

      // Delay between questions
      if (qi < QUESTIONS.length - 1) await sleep(DELAY_MS);
    }

    allResults.push(...conditionResults);
  }

  // ─── SUMMARY ────────────────────────────────────────────────────────────
  console.log('\n\n========== SUMMARY ==========\n');

  const summary = {};
  for (const cond of CONDITIONS) {
    const rows = allResults.filter(r => r.condition === cond);
    const scores = rows.map(r => r.score).filter(s => s >= 0);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const totalConsult = rows.reduce((a, r) => a + r.num_consultations, 0);
    const efficiency = avg / (totalConsult / rows.length);
    summary[cond] = { avg_score: +avg.toFixed(2), total_consultations: totalConsult, avg_consultations: +(totalConsult / rows.length).toFixed(2), efficiency: +efficiency.toFixed(2), n: scores.length };
    console.log(`${cond}: avg=${avg.toFixed(2)}, consultations=${totalConsult} (avg ${(totalConsult/rows.length).toFixed(1)}), efficiency=${efficiency.toFixed(2)}`);
  }

  // Per-domain breakdown
  console.log('\n--- Per-Domain Breakdown ---');
  for (const cond of CONDITIONS) {
    console.log(`\n${cond}:`);
    for (const domain of ['medical', 'legal', 'finance', 'tech']) {
      const rows = allResults.filter(r => r.condition === cond && r.domain === domain);
      const scores = rows.map(r => r.score).filter(s => s >= 0);
      const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      console.log(`  ${domain}: avg=${avg.toFixed(2)} (n=${scores.length})`);
    }
  }

  // Score table
  console.log('\n--- Score Table (Q × Condition) ---');
  const header = ['Q#', ...CONDITIONS.map(c => c.substring(0, 12))];
  console.log(header.map(h => h.padEnd(14)).join(''));
  for (const q of QUESTIONS) {
    const row = [
      `Q${q.id}(${q.primary_domain.substring(0, 3)})`,
      ...CONDITIONS.map(c => {
        const r = allResults.find(r => r.condition === c && r.question_id === q.id);
        return r ? String(r.score) : '-';
      }),
    ];
    console.log(row.map(h => h.padEnd(14)).join(''));
  }

  console.log(`\nTotal API calls: ${apiCalls}`);

  // Save results
  const output = {
    experiment: 'KI-4 A2A Adaptive Scheduling (GPT-4o)',
    model: MODEL,
    timestamp: new Date().toISOString(),
    channels: CHANNELS,
    channel_weights: CHANNEL_WEIGHTS,
    expertise_map: EXPERTISE_MAP,
    channel_assignments: CHANNEL_ASSIGNMENTS,
    summary,
    results: allResults,
  };

  fs.writeFileSync('C:/Users/hyunj/wcisl/scripts/ki4_gpt4o_results.json', JSON.stringify(output, null, 2));
  console.log('\nResults saved to ki4_gpt4o_results.json');
}

runExperiment().catch(e => { console.error('FATAL:', e); process.exit(1); });
