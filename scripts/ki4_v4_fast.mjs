// KI-4 Adaptive Scheduling Experiment v4 (Fast - Parallel)
// Pipeline: Specialist → Corruption → Receiving Agent → Grader

import OpenAI from "openai";
import { writeFileSync } from "fs";

const OPENAI_API_KEY = "OPENAI_API_KEY_REDACTED";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============================================================
// CHANNEL DEFINITIONS
// ============================================================
const CHANNELS = {
  Good:   { maxTokens: 500, corruptionRate: 0.00 },
  Medium: { maxTokens: 200, corruptionRate: 0.15 },
  Bad:    { maxTokens: 80,  corruptionRate: 0.40 },
};
const CHANNEL_NAMES = ["Good", "Medium", "Bad"];

// ============================================================
// SPECIALISTS
// ============================================================
const SPECIALISTS = ["Medical", "Legal", "Finance", "Tech"];

const SPECIALIST_PROMPTS = {
  Medical: "You are an expert physician and medical researcher. Provide accurate, detailed medical information.",
  Legal: "You are an expert attorney with broad legal knowledge. Provide accurate, detailed legal analysis.",
  Finance: "You are an expert financial analyst and accountant. Provide accurate, detailed financial analysis with calculations.",
  Tech: "You are an expert software engineer and computer scientist. Provide accurate, detailed technical explanations.",
};

// ============================================================
// 15 QUESTIONS
// ============================================================
const QUESTIONS = [
  {
    id: 1, text: "What are the first-line treatments for Type 2 diabetes and their mechanisms?",
    primary_domain: "Medical", secondary_domain: null,
    reference_answer: "First-line treatment is metformin (biguanide) which decreases hepatic glucose production and increases insulin sensitivity. Second-line options include sulfonylureas (stimulate insulin secretion), SGLT2 inhibitors (block glucose reabsorption in kidneys), GLP-1 receptor agonists (incretin-based, enhance insulin secretion), DPP-4 inhibitors, and thiazolidinediones (improve insulin sensitivity). Treatment choice depends on comorbidities, cardiovascular risk, and renal function."
  },
  {
    id: 2, text: "Explain the pathophysiology of myocardial infarction and emergency management steps.",
    primary_domain: "Medical", secondary_domain: null,
    reference_answer: "MI occurs when coronary artery occlusion (usually from atherosclerotic plaque rupture and thrombus formation) causes myocardial ischemia and necrosis. Emergency management: MONA (Morphine, Oxygen if SpO2<94%, Nitroglycerin, Aspirin 325mg), obtain 12-lead ECG within 10 min, troponin levels, activate cath lab for PCI within 90 min for STEMI, or fibrinolytics if PCI unavailable within 120 min. Anticoagulation with heparin, dual antiplatelet therapy."
  },
  {
    id: 3, text: "What drug interactions should be monitored when prescribing warfarin?",
    primary_domain: "Medical", secondary_domain: null,
    reference_answer: "Warfarin has extensive interactions via CYP2C9/CYP3A4. Major interactions: NSAIDs (increased bleeding risk), antibiotics (metronidazole, fluconazole increase INR; rifampin decreases), amiodarone (increases effect), SSRIs, acetaminophen (high doses). Foods: vitamin K-rich foods (leafy greens) decrease effect. Alcohol increases risk. Monitor INR regularly, target 2-3 for most indications. Genetic variations (CYP2C9, VKORC1) affect dosing."
  },
  {
    id: 4, text: "What constitutes wrongful termination under employment law?",
    primary_domain: "Legal", secondary_domain: null,
    reference_answer: "Wrongful termination occurs when an employer fires an employee in violation of law or contract. Categories: discrimination (Title VII - race, sex, religion, national origin; ADA - disability; ADEA - age), retaliation (for whistleblowing, filing complaints, exercising legal rights), breach of employment contract (express or implied), violation of public policy (refusing illegal acts). At-will employment is default but has these exceptions. Remedies include reinstatement, back pay, compensatory/punitive damages."
  },
  {
    id: 5, text: "Explain the differences between civil and criminal liability in negligence cases.",
    primary_domain: "Legal", secondary_domain: null,
    reference_answer: "Civil negligence requires: duty of care, breach, causation (actual and proximate), damages. Burden of proof: preponderance of evidence. Remedy: monetary compensation. Criminal negligence requires: gross deviation from reasonable standard of care, higher mens rea threshold. Burden: beyond reasonable doubt. Consequences: fines, imprisonment. Same act can trigger both (e.g., drunk driving causing injury). Civil suits brought by victims; criminal cases by the state."
  },
  {
    id: 6, text: "What are a landlord's legal obligations regarding property maintenance?",
    primary_domain: "Legal", secondary_domain: null,
    reference_answer: "Landlords must maintain implied warranty of habitability: structural integrity, plumbing, heating, electrical systems, pest control, common areas. Must comply with local housing codes. Duty to repair within reasonable time after notice. Must maintain security features. Cannot retaliate against tenants who report violations. Tenant remedies: repair and deduct, rent withholding, lease termination, sue for damages. Varies by jurisdiction but these are common law and statutory requirements."
  },
  {
    id: 7, text: "Calculate the NPV of a project: initial investment $100K, cash flows $30K/year for 5 years, discount rate 10%.",
    primary_domain: "Finance", secondary_domain: null,
    reference_answer: "NPV = -100,000 + 30,000/(1.1)^1 + 30,000/(1.1)^2 + 30,000/(1.1)^3 + 30,000/(1.1)^4 + 30,000/(1.1)^5 = -100,000 + 27,273 + 24,793 + 22,539 + 20,490 + 18,628 = -100,000 + 113,723 = $13,723. NPV > 0, so project is financially viable. This uses the present value of annuity formula: PV = PMT × [(1-(1+r)^-n)/r] = 30,000 × 3.7908 = $113,724."
  },
  {
    id: 8, text: "Explain the difference between FIFO and LIFO inventory accounting and their tax implications.",
    primary_domain: "Finance", secondary_domain: null,
    reference_answer: "FIFO (First-In-First-Out): oldest inventory sold first. In rising prices: higher ending inventory, lower COGS, higher net income, higher taxes. LIFO (Last-In-First-Out): newest inventory sold first. In rising prices: lower ending inventory, higher COGS, lower net income, lower taxes (tax advantage). LIFO reserve = FIFO inventory - LIFO inventory. LIFO banned under IFRS, allowed under US GAAP. LIFO conformity rule: if used for tax, must use for financial reporting."
  },
  {
    id: 9, text: "How is goodwill calculated and tested for impairment in M&A?",
    primary_domain: "Finance", secondary_domain: null,
    reference_answer: "Goodwill = Purchase price - Fair market value of identifiable net assets (assets minus liabilities). Includes brand value, customer relationships, synergies. Not amortized under US GAAP (ASC 350). Annual impairment test: compare reporting unit's carrying amount to fair value. If carrying > fair value, impairment loss = difference (not to exceed recorded goodwill). Under IFRS (IAS 36), compare carrying to recoverable amount (higher of value in use and fair value less costs to sell)."
  },
  {
    id: 10, text: "Explain the time complexity of merge sort vs quicksort and when to prefer each.",
    primary_domain: "Tech", secondary_domain: null,
    reference_answer: "Merge sort: O(n log n) worst/average/best case. Stable sort. Requires O(n) extra space. Preferred for linked lists, external sorting, when stability needed. Quicksort: O(n log n) average, O(n²) worst case (mitigated by random pivot). In-place (O(log n) stack space). Better cache locality. Preferred for arrays in practice due to smaller constants and cache efficiency. Introsort (hybrid) switches to heapsort if recursion too deep, guaranteeing O(n log n)."
  },
  {
    id: 11, text: "Design a rate limiter for an API that handles 1000 req/sec with burst tolerance.",
    primary_domain: "Tech", secondary_domain: null,
    reference_answer: "Token bucket algorithm: bucket capacity (burst size, e.g., 1500), refill rate 1000 tokens/sec. Each request consumes 1 token. If empty, reject (429). Alternative: sliding window log or counter. Implementation: Redis with MULTI/EXEC for atomicity. Key per client (IP or API key). Lua script: check tokens, decrement if available, return allow/deny. Distributed: use Redis cluster. Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset. Consider: graceful degradation, priority queues, retry-after header."
  },
  {
    id: 12, text: "What are the ACID properties in databases and how does eventual consistency differ?",
    primary_domain: "Tech", secondary_domain: null,
    reference_answer: "ACID: Atomicity (all-or-nothing transactions), Consistency (valid state transitions), Isolation (concurrent transactions don't interfere, levels: read uncommitted/committed, repeatable read, serializable), Durability (committed data persists). Eventual consistency (BASE): Basically Available, Soft state, Eventually consistent. Trades strong consistency for availability and partition tolerance (CAP theorem). Used in distributed systems (DynamoDB, Cassandra). Conflict resolution: last-write-wins, vector clocks, CRDTs."
  },
  {
    id: 13, text: "A tech startup needs Series A funding. What legal structures and financial metrics matter?",
    primary_domain: "Finance", secondary_domain: "Legal",
    reference_answer: "Legal: Delaware C-Corp preferred. Preferred stock with liquidation preference, anti-dilution (weighted average), board seats, protective provisions, information rights. SAFE/convertible notes for bridge. IP assignment agreements. Financial metrics: ARR/MRR, growth rate (3x YoY ideal), burn rate, runway (18+ months post-raise), CAC/LTV ratio (>3:1), gross margins, net dollar retention. Valuation methods: comparable transactions, DCF (rare at this stage), revenue multiples. Due diligence: cap table, contracts, IP ownership."
  },
  {
    id: 14, text: "A hospital wants to implement an AI diagnostic system. What are the regulatory and technical requirements?",
    primary_domain: "Tech", secondary_domain: "Medical",
    reference_answer: "Regulatory: FDA clearance (510(k) or De Novo for SaMD - Software as Medical Device), CE marking (EU MDR), HIPAA compliance for patient data, clinical validation studies. Technical: training data quality and bias mitigation, model explainability (XAI), integration with EHR (HL7 FHIR), edge deployment for latency, continuous monitoring for model drift, audit trails. Also: malpractice liability considerations, informed consent for AI-assisted diagnosis, clinician override capability, cybersecurity requirements."
  },
  {
    id: 15, text: "Calculate depreciation for manufacturing equipment ($500K, 10yr useful life, straight-line) and explain tax implications.",
    primary_domain: "Finance", secondary_domain: "Legal",
    reference_answer: "Straight-line: ($500,000 - $0 salvage) / 10 years = $50,000/year depreciation expense. Accumulated depreciation grows $50K/year, book value decreases. Tax implications: depreciation is tax-deductible expense, reduces taxable income. At 21% corporate rate, annual tax shield = $50,000 × 0.21 = $10,500. Alternative: MACRS (7-year for manufacturing equipment, accelerated). Section 179: immediate full deduction up to limit. Bonus depreciation: 100% first-year deduction (phase-out schedule). Choice affects cash flow timing."
  },
];

// ============================================================
// SEEDED RANDOM for channel assignment (seed=42)
// ============================================================
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);

// Assign channels: 4 specialists × 15 questions = 60 assignments
// For each question, assign a channel to each specialist
const CHANNEL_ASSIGNMENTS = {};
for (const q of QUESTIONS) {
  CHANNEL_ASSIGNMENTS[q.id] = {};
  for (const spec of SPECIALISTS) {
    const r = rng();
    const idx = Math.floor(r * 3); // 0,1,2 → 1/3 each
    CHANNEL_ASSIGNMENTS[q.id][spec] = CHANNEL_NAMES[idx];
  }
}

// ============================================================
// CORRUPTION FUNCTION
// ============================================================
function corruptText(text, rate, seed) {
  if (rate === 0) return text;
  const localRng = mulberry32(seed);
  const words = text.split(/(\s+)/);
  return words.map((w) => {
    if (/^\s+$/.test(w)) return w;
    if (localRng() < rate) return "[???]";
    return w;
  }).join("");
}

// ============================================================
// LLM CALL HELPERS
// ============================================================
const CONCURRENCY = 5;

async function callLLM(model, systemPrompt, userPrompt, maxTokens) {
  const res = await openai.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return res.choices[0].message.content.trim();
}

// Semaphore for concurrency control
class Semaphore {
  constructor(max) { this.max = max; this.count = 0; this.queue = []; }
  async acquire() {
    if (this.count < this.max) { this.count++; return; }
    await new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    this.count--;
    if (this.queue.length > 0) { this.count++; this.queue.shift()(); }
  }
}

const sem = new Semaphore(CONCURRENCY);

async function withSem(fn) {
  await sem.acquire();
  try { return await fn(); } finally { sem.release(); }
}

// ============================================================
// SPECIALIST CALL
// ============================================================
async function callSpecialist(specialist, question, channelName) {
  const ch = CHANNELS[channelName];
  const raw = await callLLM(
    "gpt-4o-mini",
    SPECIALIST_PROMPTS[specialist],
    question,
    ch.maxTokens
  );
  const corruptionSeed = hashStr(`${specialist}-${question}-${channelName}`);
  const corrupted = corruptText(raw, ch.corruptionRate, corruptionSeed);
  return { specialist, channel: channelName, raw, corrupted, maxTokens: ch.maxTokens, corruptionRate: ch.corruptionRate };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

// ============================================================
// RECEIVING AGENT
// ============================================================
async function callReceivingAgent(question, consultations) {
  const msgs = consultations.map((c, i) =>
    `--- Consultation ${i + 1} (${c.specialist} specialist, ${c.channel} channel) ---\n${c.corrupted}`
  ).join("\n\n");

  const systemPrompt = `You are a receiving agent. You receive potentially corrupted messages from specialist consultants (some words may be replaced with [???]). Your job is to:
1. Interpret the corrupted messages as best you can
2. Synthesize information from all consultations
3. Produce a clear, accurate, and complete answer to the original question
Focus on recovering the intended meaning despite corruption.`;

  const userPrompt = `Original question: ${question}\n\nConsultation responses:\n${msgs}\n\nBased on these consultations, provide a clear and complete answer to the question.`;

  return await callLLM("gpt-4o-mini", systemPrompt, userPrompt, 600);
}

// ============================================================
// GRADER
// ============================================================
async function grade(question, referenceAnswer, finalAnswer) {
  const systemPrompt = `You are an expert grader. Score the answer on a scale of 0-10 based on accuracy, completeness, and correctness compared to the reference answer. Respond with ONLY a JSON object: {"score": <number>, "reason": "<brief explanation>"}`;

  const userPrompt = `Question: ${question}\n\nReference Answer: ${referenceAnswer}\n\nAnswer to Grade: ${finalAnswer}`;

  const raw = await callLLM("gpt-4o", systemPrompt, userPrompt, 200);
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const m = raw.match(/(\d+(\.\d+)?)/);
    return { score: m ? parseFloat(m[1]) : 0, reason: raw };
  }
}

// ============================================================
// CONFIDENCE CHECK (for Condition 5)
// ============================================================
async function checkConfidence(question, receivingAnswer) {
  const systemPrompt = `You assess whether an answer is confident and complete. Respond with ONLY a JSON object: {"confident": true/false, "reason": "<brief>"}. Mark confident=true ONLY if the answer is comprehensive and clearly correct.`;
  const userPrompt = `Question: ${question}\n\nAnswer: ${receivingAnswer}\n\nIs this answer confident and complete?`;
  const raw = await callLLM("gpt-4o-mini", systemPrompt, userPrompt, 100);
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { confident: false, reason: raw };
  }
}

// ============================================================
// CONDITION LOGIC: agent selection
// ============================================================
function getExpertiseWeight(specialist, question) {
  if (specialist === question.primary_domain) return 1.0;
  if (specialist === question.secondary_domain) return 0.5;
  return 0.2;
}

function getChannelWeight(channelName) {
  return { Good: 1.0, Medium: 0.6, Bad: 0.2 }[channelName];
}

function selectAgents(conditionId, questionObj) {
  const qid = questionObj.id;
  const channels = CHANNEL_ASSIGNMENTS[qid];

  switch (conditionId) {
    case 1: // Fixed Order: Medical → Legal → Finance
      return ["Medical", "Legal", "Finance"];

    case 2: { // Expertise Only: primary domain expert first, then others by expertise
      const sorted = [...SPECIALISTS].sort((a, b) => {
        return getExpertiseWeight(b, questionObj) - getExpertiseWeight(a, questionObj);
      });
      return sorted.slice(0, 3);
    }

    case 3: { // Channel Only: best channel first
      const sorted = [...SPECIALISTS].sort((a, b) => {
        return getChannelWeight(channels[b]) - getChannelWeight(channels[a]);
      });
      return sorted.slice(0, 3);
    }

    case 4:
    case 5: { // Joint: expertise × channel
      const scored = SPECIALISTS.map((s) => ({
        specialist: s,
        score: getExpertiseWeight(s, questionObj) * getChannelWeight(channels[s]),
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 3).map((s) => s.specialist);
    }

    default:
      throw new Error(`Unknown condition: ${conditionId}`);
  }
}

// ============================================================
// RUN ONE QUESTION UNDER ONE CONDITION
// ============================================================
async function runQuestion(conditionId, questionObj) {
  const agents = selectAgents(conditionId, questionObj);
  const channels = CHANNEL_ASSIGNMENTS[questionObj.id];
  const consultations = [];

  if (conditionId === 5) {
    // Early stop: iterate, check confidence after each
    for (let i = 0; i < agents.length; i++) {
      const spec = agents[i];
      const ch = channels[spec];
      const consultation = await withSem(() => callSpecialist(spec, questionObj.text, ch));
      consultations.push(consultation);

      // After at least 1 consultation, check confidence
      const recvAnswer = await withSem(() => callReceivingAgent(questionObj.text, consultations));
      const conf = await withSem(() => checkConfidence(questionObj.text, recvAnswer));
      if (conf.confident && i < agents.length - 1) {
        // Early stop
        const gradeResult = await withSem(() => grade(questionObj.text, questionObj.reference_answer, recvAnswer));
        return {
          question_id: questionObj.id,
          condition: conditionId,
          agents_selected: agents,
          agents_used: agents.slice(0, i + 1),
          early_stop: true,
          stopped_after: i + 1,
          channels_used: consultations.map((c) => ({ specialist: c.specialist, channel: c.channel })),
          final_answer: recvAnswer,
          score: gradeResult.score,
          grade_reason: gradeResult.reason,
          consultations: consultations.map((c) => ({
            specialist: c.specialist,
            channel: c.channel,
            maxTokens: c.maxTokens,
            corruptionRate: c.corruptionRate,
            raw_length: c.raw.length,
            corrupted_length: c.corrupted.length,
          })),
        };
      }
      // If last iteration, use this answer
      if (i === agents.length - 1) {
        const gradeResult = await withSem(() => grade(questionObj.text, questionObj.reference_answer, recvAnswer));
        return {
          question_id: questionObj.id,
          condition: conditionId,
          agents_selected: agents,
          agents_used: agents,
          early_stop: false,
          stopped_after: agents.length,
          channels_used: consultations.map((c) => ({ specialist: c.specialist, channel: c.channel })),
          final_answer: recvAnswer,
          score: gradeResult.score,
          grade_reason: gradeResult.reason,
          consultations: consultations.map((c) => ({
            specialist: c.specialist,
            channel: c.channel,
            maxTokens: c.maxTokens,
            corruptionRate: c.corruptionRate,
            raw_length: c.raw.length,
            corrupted_length: c.corrupted.length,
          })),
        };
      }
    }
  }

  // Conditions 1-4: call all 3 specialists in parallel
  const specCalls = agents.map((spec) => {
    const ch = channels[spec];
    return withSem(() => callSpecialist(spec, questionObj.text, ch));
  });
  const results = await Promise.all(specCalls);
  consultations.push(...results);

  // Receiving agent
  const recvAnswer = await withSem(() => callReceivingAgent(questionObj.text, consultations));

  // Grader
  const gradeResult = await withSem(() => grade(questionObj.text, questionObj.reference_answer, recvAnswer));

  return {
    question_id: questionObj.id,
    condition: conditionId,
    agents_selected: agents,
    agents_used: agents,
    early_stop: false,
    stopped_after: agents.length,
    channels_used: consultations.map((c) => ({ specialist: c.specialist, channel: c.channel })),
    final_answer: recvAnswer,
    score: gradeResult.score,
    grade_reason: gradeResult.reason,
    consultations: consultations.map((c) => ({
      specialist: c.specialist,
      channel: c.channel,
      maxTokens: c.maxTokens,
      corruptionRate: c.corruptionRate,
      raw_length: c.raw.length,
      corrupted_length: c.corrupted.length,
    })),
  };
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("=== KI-4 Adaptive Scheduling v4 (Fast) ===");
  console.log(`Questions: ${QUESTIONS.length}, Conditions: 5, Concurrency: ${CONCURRENCY}`);
  console.log("");

  // Print channel assignments
  console.log("Channel Assignments (seed=42):");
  for (const q of QUESTIONS) {
    const ch = CHANNEL_ASSIGNMENTS[q.id];
    console.log(`  Q${q.id}: ${SPECIALISTS.map((s) => `${s[0]}=${ch[s]}`).join(", ")}`);
  }
  console.log("");

  const allResults = [];
  const startTime = Date.now();

  // Process all 5 conditions
  for (let cond = 1; cond <= 5; cond++) {
    const condStart = Date.now();
    console.log(`--- Condition ${cond} ---`);

    let condResults;
    if (cond === 5) {
      // Condition 5 is sequential per question (early stop), but questions in parallel
      condResults = await Promise.all(
        QUESTIONS.map((q) => runQuestion(cond, q))
      );
    } else {
      // Conditions 1-4: all 15 questions in parallel
      condResults = await Promise.all(
        QUESTIONS.map((q) => runQuestion(cond, q))
      );
    }

    const scores = condResults.map((r) => r.score);
    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
    const condTime = ((Date.now() - condStart) / 1000).toFixed(1);

    console.log(`  Avg score: ${avg} | Time: ${condTime}s`);
    console.log(`  Scores: [${scores.join(", ")}]`);
    if (cond === 5) {
      const stops = condResults.map((r) => r.stopped_after);
      console.log(`  Consultations used: [${stops.join(", ")}]`);
    }
    console.log("");

    allResults.push(...condResults);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Total time: ${totalTime}s`);

  // Summary table
  console.log("\n=== SUMMARY ===");
  console.log("Condition | Avg Score | Min | Max | Std Dev");
  console.log("----------|-----------|-----|-----|--------");
  for (let cond = 1; cond <= 5; cond++) {
    const scores = allResults.filter((r) => r.condition === cond).map((r) => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const std = Math.sqrt(scores.reduce((s, x) => s + (x - avg) ** 2, 0) / scores.length);
    console.log(`    ${cond}     |   ${avg.toFixed(2)}   | ${min.toFixed(1)} | ${max.toFixed(1)} |  ${std.toFixed(2)}`);
  }

  // Per-question breakdown
  console.log("\n=== PER-QUESTION SCORES ===");
  console.log("Q#  | C1  | C2  | C3  | C4  | C5  | Domain");
  console.log("----|-----|-----|-----|-----|-----|-------");
  for (const q of QUESTIONS) {
    const row = [1, 2, 3, 4, 5].map((c) => {
      const r = allResults.find((r) => r.question_id === q.id && r.condition === c);
      return r ? r.score.toFixed(1).padStart(4) : " N/A";
    });
    console.log(`${String(q.id).padStart(2)}  |${row.join(" |")} | ${q.primary_domain}`);
  }

  // Save results
  const output = {
    experiment: "KI-4 Adaptive Scheduling v4 (Fast)",
    timestamp: new Date().toISOString(),
    config: {
      channels: CHANNELS,
      concurrency: CONCURRENCY,
      seed: 42,
      specialists: SPECIALISTS,
      models: { specialist: "gpt-4o-mini", receiving: "gpt-4o-mini", grader: "gpt-4o" },
    },
    channel_assignments: CHANNEL_ASSIGNMENTS,
    questions: QUESTIONS.map((q) => ({ id: q.id, text: q.text, primary_domain: q.primary_domain, secondary_domain: q.secondary_domain })),
    results: allResults,
    summary: {
      conditions: [1, 2, 3, 4, 5].map((c) => {
        const scores = allResults.filter((r) => r.condition === c).map((r) => r.score);
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const std = Math.sqrt(scores.reduce((s, x) => s + (x - avg) ** 2, 0) / scores.length);
        return {
          condition: c,
          name: ["Fixed Order", "Expertise Only", "Channel Only", "Joint", "Joint + Early Stop"][c - 1],
          avg_score: +avg.toFixed(2),
          min_score: Math.min(...scores),
          max_score: Math.max(...scores),
          std_dev: +std.toFixed(2),
          scores,
        };
      }),
    },
    total_time_seconds: +totalTime,
  };

  const outPath = "C:/Users/hyunj/wcisl/scripts/ki4_v4_fast_results.json";
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
