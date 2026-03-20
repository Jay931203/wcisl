// KI-4 Adaptive Scheduling - Final Implementation
// Pipeline: Question → Specialist answers (max_tokens enforced) → Corruption → Receiving Agent → Grader

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error("Set OPENAI_API_KEY env var"); process.exit(1); }

// ============================================================
// Seeded RNG (mulberry32)
// ============================================================
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);

// ============================================================
// Questions
// ============================================================
const QUESTIONS = [
  { id: 1, text: "What are the first-line treatments for Type 2 diabetes and their mechanisms of action?", primary: "medical",
    reference: "First-line treatment is metformin, which reduces hepatic glucose production and improves insulin sensitivity. Additional options include SGLT2 inhibitors (block glucose reabsorption in kidneys) and GLP-1 receptor agonists (enhance insulin secretion and slow gastric emptying)." },
  { id: 2, text: "What is the pathophysiology of myocardial infarction and its emergency management?", primary: "medical",
    reference: "MI occurs when coronary artery occlusion (usually from ruptured atherosclerotic plaque and thrombus) causes myocardial ischemia and necrosis. Emergency management includes aspirin, heparin, nitroglycerin, oxygen if hypoxic, and urgent reperfusion via PCI or thrombolytics within the time window." },
  { id: 3, text: "What are the key drug interactions with warfarin that clinicians must monitor?", primary: "medical",
    reference: "Warfarin interacts with CYP2C9/3A4 inhibitors (azole antifungals, amiodarone, SSRIs) increasing bleeding risk, and inducers (rifampin, carbamazepine) reducing efficacy. Vitamin K-rich foods, NSAIDs, and antibiotics also significantly alter INR and require close monitoring." },
  { id: 4, text: "What are the symptoms and diagnostic approach for pulmonary embolism?", primary: "medical",
    reference: "PE presents with acute dyspnea, pleuritic chest pain, tachycardia, and sometimes hemoptysis. Diagnosis uses Wells score for pre-test probability, D-dimer for low-risk exclusion, and CT pulmonary angiography as the gold standard confirmatory test." },
  { id: 5, text: "What constitutes wrongful termination under employment law?", primary: "legal",
    reference: "Wrongful termination occurs when an employer fires an employee in violation of law or contract, including discrimination based on protected characteristics, retaliation for whistleblowing, or breach of implied/express employment contracts. Remedies include reinstatement, back pay, and compensatory damages." },
  { id: 6, text: "How do civil and criminal liability differ in negligence cases?", primary: "legal",
    reference: "Civil negligence requires proving duty, breach, causation, and damages by preponderance of evidence, resulting in monetary compensation. Criminal negligence requires a higher mens rea standard (gross deviation from reasonable care) proven beyond reasonable doubt, with penalties including fines and imprisonment." },
  { id: 7, text: "What are a landlord's legal obligations for property maintenance?", primary: "legal",
    reference: "Landlords must maintain habitable conditions including structural integrity, plumbing, heating, and compliance with building codes (implied warranty of habitability). Failure to repair after proper notice may allow tenants to withhold rent, repair-and-deduct, or terminate the lease depending on jurisdiction." },
  { id: 8, text: "What are the primary defenses against patent infringement claims?", primary: "legal",
    reference: "Key defenses include non-infringement (accused product doesn't meet all claim elements), invalidity (prior art, obviousness, or inadequate disclosure), exhaustion (authorized first sale), and experimental use. Licensees may also assert implied license or equitable estoppel." },
  { id: 9, text: "Calculate the NPV of a $100,000 investment yielding $30,000 per year for 5 years at a 10% discount rate.", primary: "finance",
    reference: "NPV = -100,000 + 30,000/(1.1) + 30,000/(1.1)^2 + 30,000/(1.1)^3 + 30,000/(1.1)^4 + 30,000/(1.1)^5 = -100,000 + 113,724 = $13,724 (approximately). The positive NPV indicates the investment creates value above the required 10% return." },
  { id: 10, text: "Explain FIFO vs LIFO inventory methods and their tax implications.", primary: "finance",
    reference: "FIFO (first-in-first-out) matches oldest costs to COGS, resulting in lower COGS and higher taxable income during inflation. LIFO (last-in-first-out) matches newest costs, yielding higher COGS, lower taxable income, and tax deferral benefits, though IFRS prohibits LIFO." },
  { id: 11, text: "How is goodwill calculated in mergers and acquisitions?", primary: "finance",
    reference: "Goodwill equals the purchase price minus the fair market value of identifiable net assets (assets minus liabilities) acquired. It represents intangible value like brand reputation, customer relationships, and synergies, and must be tested annually for impairment under ASC 350." },
  { id: 12, text: "Compare merge sort and quicksort in terms of time complexity and when to prefer each.", primary: "tech",
    reference: "Merge sort guarantees O(n log n) worst-case but requires O(n) extra space; prefer it for linked lists and stable sorting needs. Quicksort averages O(n log n) with O(log n) space but degrades to O(n^2) worst-case; prefer it for arrays due to better cache locality and lower constant factors." },
  { id: 13, text: "Design a rate limiter for an API handling 1000 requests per second.", primary: "tech",
    reference: "Use a token bucket or sliding window algorithm with atomic operations in Redis for distributed environments. Configure bucket capacity of 1000 tokens refilling at 1000/sec, with per-client tracking via API keys, returning HTTP 429 with Retry-After headers when limits are exceeded." },
  { id: 14, text: "Explain ACID properties vs eventual consistency trade-offs.", primary: "tech",
    reference: "ACID (Atomicity, Consistency, Isolation, Durability) guarantees strong consistency suitable for financial transactions but limits horizontal scalability. Eventual consistency (BASE model) accepts temporary inconsistency for higher availability and partition tolerance per the CAP theorem, suitable for distributed systems like social media feeds." },
  { id: 15, text: "What are effective methods for preventing SQL injection attacks?", primary: "tech",
    reference: "Primary defense is parameterized queries (prepared statements) which separate SQL code from data. Additional layers include input validation/sanitization, stored procedures, least-privilege database accounts, WAF rules, and ORM frameworks that abstract raw SQL." },
];

// ============================================================
// Agents & Channels
// ============================================================
const AGENTS = [
  { id: "medical", name: "Medical Specialist", systemPrompt: "You are a medical specialist. Provide accurate, detailed medical information based on current clinical evidence and guidelines." },
  { id: "legal", name: "Legal Specialist", systemPrompt: "You are a legal specialist. Provide accurate legal analysis based on established legal principles and case law." },
  { id: "finance", name: "Finance Specialist", systemPrompt: "You are a finance specialist. Provide accurate financial analysis with precise calculations and reasoning." },
  { id: "tech", name: "Tech Specialist", systemPrompt: "You are a technology specialist. Provide accurate technical explanations with proper algorithmic and systems design reasoning." },
];

const CHANNEL_CONFIGS = {
  good:   { maxTokens: 500, corruptionRate: 0.00 },
  medium: { maxTokens: 200, corruptionRate: 0.15 },
  bad:    { maxTokens: 80,  corruptionRate: 0.40 },
};

const CHANNEL_NAMES = ["good", "medium", "bad"];

// Assign channels: each agent gets a random channel (equal 1/3 probability, seeded)
function assignChannels() {
  const channels = {};
  for (const agent of AGENTS) {
    const roll = rng();
    if (roll < 1 / 3) channels[agent.id] = "good";
    else if (roll < 2 / 3) channels[agent.id] = "medium";
    else channels[agent.id] = "bad";
  }
  return channels;
}

const AGENT_CHANNELS = assignChannels();
console.log("Channel assignments:", AGENT_CHANNELS);

// ============================================================
// Domain relationships for expertise weights
// ============================================================
const DOMAIN_RELATIONS = {
  medical: { secondary: ["tech"] },      // biotech overlap
  legal:   { secondary: ["finance"] },    // financial regulation
  finance: { secondary: ["legal"] },      // financial law
  tech:    { secondary: ["finance"] },     // fintech overlap
};

function getExpertiseWeight(agentDomain, questionDomain) {
  if (agentDomain === questionDomain) return 1.0;
  if (DOMAIN_RELATIONS[questionDomain]?.secondary?.includes(agentDomain)) return 0.5;
  return 0.2;
}

function getChannelWeight(channelName) {
  if (channelName === "good") return 1.0;
  if (channelName === "medium") return 0.6;
  return 0.2;
}

// ============================================================
// Corruption function (seeded)
// ============================================================
// Create a separate seeded RNG for corruption so channel assignment doesn't affect it
let corruptionRng = mulberry32(42 * 7);

function corrupt(text, rate) {
  if (rate === 0) return text;
  const words = text.split(/\s+/);
  const corrupted = words.map(w => {
    if (corruptionRng() < rate) return "[???]";
    return w;
  });
  return corrupted.join(" ");
}

// ============================================================
// LLM call
// ============================================================
let totalTokensUsed = 0;

async function callLLM(model, systemPrompt, userPrompt, maxTokens) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const usage = data.usage || {};
  const tokens = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  totalTokensUsed += tokens;
  return { content: data.choices[0].message.content, tokens };
}

// Batch helper
async function batchCall(calls, batchSize = 5) {
  const results = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
  }
  return results;
}

// ============================================================
// Condition selection logic
// ============================================================
function selectAgents_FixedOrder(question, channels) {
  // Always Medical → Legal → Finance, first 3
  const order = ["medical", "legal", "finance"];
  return order.map(id => ({
    agent: AGENTS.find(a => a.id === id),
    channel: CHANNEL_CONFIGS[channels[id]],
    channelName: channels[id],
  }));
}

function selectAgents_ExpertiseOnly(question, channels) {
  // Sort by expertise weight descending, take top 3
  const scored = AGENTS.map(a => ({
    agent: a,
    expertiseWeight: getExpertiseWeight(a.id, question.primary),
    channel: CHANNEL_CONFIGS[channels[a.id]],
    channelName: channels[a.id],
  }));
  scored.sort((a, b) => b.expertiseWeight - a.expertiseWeight);
  return scored.slice(0, 3);
}

function selectAgents_ChannelOnly(question, channels) {
  // Sort by channel weight descending, take top 3
  const scored = AGENTS.map(a => ({
    agent: a,
    channelWeight: getChannelWeight(channels[a.id]),
    channel: CHANNEL_CONFIGS[channels[a.id]],
    channelName: channels[a.id],
  }));
  scored.sort((a, b) => b.channelWeight - a.channelWeight);
  return scored.slice(0, 3);
}

function selectAgents_Joint(question, channels) {
  // score = expertise_weight × channel_weight, top 3
  const scored = AGENTS.map(a => {
    const ew = getExpertiseWeight(a.id, question.primary);
    const cw = getChannelWeight(channels[a.id]);
    return {
      agent: a,
      jointScore: ew * cw,
      expertiseWeight: ew,
      channelWeight: cw,
      channel: CHANNEL_CONFIGS[channels[a.id]],
      channelName: channels[a.id],
    };
  });
  scored.sort((a, b) => b.jointScore - a.jointScore);
  return scored.slice(0, 3);
}

function selectAgents_JointEarlyStop(question, channels) {
  // Same ranking as Joint, but we'll handle early stop in the pipeline
  return selectAgents_Joint(question, channels);
}

const CONDITIONS = [
  { name: "1_Fixed_Order", select: selectAgents_FixedOrder, earlyStop: false },
  { name: "2_Expertise_Only", select: selectAgents_ExpertiseOnly, earlyStop: false },
  { name: "3_Channel_Only", select: selectAgents_ChannelOnly, earlyStop: false },
  { name: "4_Joint", select: selectAgents_Joint, earlyStop: false },
  { name: "5_Joint_EarlyStop", select: selectAgents_JointEarlyStop, earlyStop: true },
];

// ============================================================
// Pipeline per condition per question
// ============================================================
async function runPipeline(condition, question, channels) {
  const selectedAgents = condition.select(question, channels);
  const corruptedResponses = [];
  let consultations = 0;

  for (let i = 0; i < selectedAgents.length; i++) {
    const { agent, channel, channelName } = selectedAgents[i];

    // Specialist answers
    const specialistResult = await callLLM(
      "gpt-4o-mini",
      agent.systemPrompt,
      `Answer this question concisely and accurately:\n\n${question.text}`,
      channel.maxTokens
    );

    // Corruption applied
    const corruptedText = corrupt(specialistResult.content, channel.corruptionRate);
    corruptedResponses.push({
      agentId: agent.id,
      channelName,
      original: specialistResult.content,
      corrupted: corruptedText,
      tokens: specialistResult.tokens,
    });
    consultations++;

    // Early stop check after 1-2 consultations
    if (condition.earlyStop && consultations >= 1 && consultations <= 2) {
      // Quick check: ask receiving agent to interpret so far
      const checkPrompt = `You are an expert analyst. Based on the following consultation responses about the question, provide a brief interpretation. If you can form a confident answer, begin your conclusion with "Therefore" or "In conclusion".\n\nQuestion: ${question.text}\n\n${corruptedResponses.map((r, idx) => `Consultation ${idx + 1} (${r.agentId}): ${r.corrupted}`).join("\n\n")}`;

      const checkResult = await callLLM(
        "gpt-4o-mini",
        "You are a receiving agent that interprets potentially corrupted messages from specialists. Synthesize the information available.",
        checkPrompt,
        200
      );

      const lower = checkResult.content.toLowerCase();
      if (lower.includes("therefore") || lower.includes("in conclusion")) {
        // Early stop triggered - use this as final answer
        const gradeResult = await callLLM(
          "gpt-4o",
          "You are an expert grader. Score the answer from 0 to 10 based on accuracy, completeness, and correctness compared to the reference. Respond with ONLY a JSON object: {\"score\": <number>, \"reason\": \"<brief reason>\"}",
          `Question: ${question.text}\n\nReference Answer: ${question.reference}\n\nAnswer to Grade: ${checkResult.content}`,
          150
        );

        let score = 0;
        try {
          const parsed = JSON.parse(gradeResult.content);
          score = parsed.score;
        } catch {
          const match = gradeResult.content.match(/(\d+(\.\d+)?)/);
          score = match ? parseFloat(match[1]) : 0;
        }

        return {
          questionId: question.id,
          condition: condition.name,
          score,
          consultations,
          earlyStop: true,
          agentsUsed: corruptedResponses.map(r => r.agentId),
          channelsUsed: corruptedResponses.map(r => r.channelName),
          avgCorruption: corruptedResponses.reduce((s, r) => s + CHANNEL_CONFIGS[r.channelName].corruptionRate, 0) / corruptedResponses.length,
        };
      }
    }
  }

  // Receiving Agent interprets all corrupted responses
  const receivingPrompt = `You are an expert analyst receiving potentially corrupted messages from domain specialists. Some words may be replaced with [???]. Interpret and synthesize the information to answer the question as accurately as possible.\n\nQuestion: ${question.text}\n\n${corruptedResponses.map((r, idx) => `Consultation ${idx + 1} (${r.agentId} specialist): ${r.corrupted}`).join("\n\n")}\n\nProvide your best interpretation and answer:`;

  const receivingResult = await callLLM(
    "gpt-4o-mini",
    "You are a receiving agent that interprets potentially corrupted messages from multiple domain specialists. Synthesize all available information to provide the most accurate answer possible.",
    receivingPrompt,
    400
  );

  // Grader scores clean output (GPT-4o)
  const gradeResult = await callLLM(
    "gpt-4o",
    "You are an expert grader. Score the answer from 0 to 10 based on accuracy, completeness, and correctness compared to the reference. Respond with ONLY a JSON object: {\"score\": <number>, \"reason\": \"<brief reason>\"}",
    `Question: ${question.text}\n\nReference Answer: ${question.reference}\n\nAnswer to Grade: ${receivingResult.content}`,
    150
  );

  let score = 0;
  try {
    const parsed = JSON.parse(gradeResult.content);
    score = parsed.score;
  } catch {
    const match = gradeResult.content.match(/(\d+(\.\d+)?)/);
    score = match ? parseFloat(match[1]) : 0;
  }

  return {
    questionId: question.id,
    condition: condition.name,
    score,
    consultations,
    earlyStop: false,
    agentsUsed: corruptedResponses.map(r => r.agentId),
    channelsUsed: corruptedResponses.map(r => r.channelName),
    avgCorruption: corruptedResponses.reduce((s, r) => s + CHANNEL_CONFIGS[r.channelName].corruptionRate, 0) / corruptedResponses.length,
  };
}

// ============================================================
// Main execution
// ============================================================
async function main() {
  console.log("=== KI-4 Adaptive Scheduling - Final ===\n");
  console.log("Channel Assignments:");
  for (const [agentId, ch] of Object.entries(AGENT_CHANNELS)) {
    const cfg = CHANNEL_CONFIGS[ch];
    console.log(`  ${agentId}: ${ch} (maxTokens=${cfg.maxTokens}, corruption=${cfg.corruptionRate})`);
  }
  console.log();

  const allResults = [];

  for (const condition of CONDITIONS) {
    console.log(`\n--- Condition: ${condition.name} ---`);

    // Reset corruption RNG for each condition for consistency
    corruptionRng = mulberry32(42 * 7 + CONDITIONS.indexOf(condition) * 1000);

    // Run questions in batches of 5
    const conditionResults = [];
    for (let i = 0; i < QUESTIONS.length; i += 5) {
      const batch = QUESTIONS.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(q => runPipeline(condition, q, AGENT_CHANNELS))
      );
      conditionResults.push(...batchResults);

      // Progress
      for (const r of batchResults) {
        console.log(`  Q${r.questionId}: score=${r.score}, consultations=${r.consultations}, earlyStop=${r.earlyStop}, agents=[${r.agentsUsed.join(",")}]`);
      }
    }

    allResults.push(...conditionResults);
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log("\n\n========================================");
  console.log("         SUMMARY TABLE");
  console.log("========================================\n");

  const summary = {};
  for (const condition of CONDITIONS) {
    const results = allResults.filter(r => r.condition === condition.name);
    const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
    const avgConsultations = results.reduce((s, r) => s + r.consultations, 0) / results.length;
    const avgCorruption = results.reduce((s, r) => s + r.avgCorruption, 0) / results.length;
    const earlyStops = results.filter(r => r.earlyStop).length;

    summary[condition.name] = {
      avgScore: Math.round(avgScore * 100) / 100,
      avgConsultations: Math.round(avgConsultations * 100) / 100,
      avgCorruptionPct: Math.round(avgCorruption * 10000) / 100,
      earlyStops,
    };
  }

  // Print table
  console.log("Condition                | Avg Score | Avg Consult | Corruption% | Early Stops");
  console.log("-------------------------|-----------|-------------|-------------|------------");
  for (const [name, s] of Object.entries(summary)) {
    console.log(
      `${name.padEnd(25)}| ${String(s.avgScore).padEnd(10)}| ${String(s.avgConsultations).padEnd(12)}| ${String(s.avgCorruptionPct + "%").padEnd(12)}| ${s.earlyStops}`
    );
  }

  console.log(`\nTotal tokens used: ${totalTokensUsed}`);

  // ============================================================
  // Save JSON results
  // ============================================================
  const output = {
    metadata: {
      experiment: "KI-4 Adaptive Scheduling - Final",
      timestamp: new Date().toISOString(),
      totalTokens: totalTokensUsed,
      channelAssignments: AGENT_CHANNELS,
      seed: 42,
    },
    summary,
    questions: QUESTIONS.map(q => ({
      id: q.id,
      text: q.text,
      primary: q.primary,
      reference: q.reference,
    })),
    results: allResults,
  };

  const fs = await import("fs");
  fs.writeFileSync(
    "C:/Users/hyunj/wcisl/scripts/ki4_final_results.json",
    JSON.stringify(output, null, 2)
  );
  console.log("\nResults saved to C:/Users/hyunj/wcisl/scripts/ki4_final_results.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
