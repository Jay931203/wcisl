/**
 * KI-4 v4: Adaptive Task Scheduling with Receiving Agent
 *
 * CORRECT Pipeline:
 *   Question → Specialist answers (max_tokens enforced) →
 *   Channel corruption (word replacement) →
 *   Receiving Agent interprets ALL corrupted responses →
 *   Grader grades the receiving agent's CLEAN output
 */

import fs from "fs";

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY;

// ============================================================
// Seeded RNG (Mulberry32)
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

// ============================================================
// Channel definitions
// ============================================================
const CHANNELS = {
  Good: { maxTokens: 500, corruptionRate: 0.0 },
  Medium: { maxTokens: 200, corruptionRate: 0.15 },
  Bad: { maxTokens: 80, corruptionRate: 0.4 },
};
const CHANNEL_NAMES = ["Good", "Medium", "Bad"];

// ============================================================
// Specialists
// ============================================================
const AGENTS = [
  {
    id: "Medical",
    system:
      "You are a medical and biology expert. Answer questions about medicine, anatomy, pharmacology, diseases, and biological processes with precise scientific detail.",
    domain: "medical",
  },
  {
    id: "Legal",
    system:
      "You are a legal expert. Answer questions about laws, regulations, court procedures, legal principles, and constitutional matters with precise legal reasoning.",
    domain: "legal",
  },
  {
    id: "Finance",
    system:
      "You are a finance and economics expert. Answer questions about accounting, investment, economic theory, financial markets, and corporate finance with precise quantitative reasoning.",
    domain: "finance",
  },
  {
    id: "Tech",
    system:
      "You are a programming and engineering expert. Answer questions about software development, algorithms, computer science, electrical engineering, and systems design with precise technical detail.",
    domain: "tech",
  },
];

// ============================================================
// Receiving Agent
// ============================================================
const RECEIVING_AGENT_SYSTEM = `You received specialist consultation messages that may be partially corrupted (some words replaced with [???]) or truncated mid-sentence. Your job:
1. Reconstruct the meaning from context clues, surrounding words, and domain knowledge.
2. Provide a complete, coherent final answer to the original question.
3. Do NOT mention corruption or [???] in your answer. Just give the best possible answer.`;

// ============================================================
// 15 Questions (clear domain ownership)
// ============================================================
const QUESTIONS = [
  {
    id: 1,
    text: "What is the mechanism of action of metformin in treating type 2 diabetes?",
    domain: "medical",
    reference:
      "Metformin primarily works by reducing hepatic glucose production, increasing insulin sensitivity in peripheral tissues, and decreasing intestinal absorption of glucose. It activates AMP-activated protein kinase (AMPK), which plays a key role in cellular energy homeostasis.",
  },
  {
    id: 2,
    text: "What is the difference between a felony and a misdemeanor in the US legal system?",
    domain: "legal",
    reference:
      "Felonies are serious crimes punishable by more than one year in prison (e.g., murder, robbery), while misdemeanors are less serious offenses punishable by up to one year in county jail (e.g., petty theft, simple assault). Felonies carry more severe long-term consequences including loss of voting rights and professional licenses.",
  },
  {
    id: 3,
    text: "Explain the concept of compound interest and how it differs from simple interest.",
    domain: "finance",
    reference:
      "Simple interest is calculated only on the principal amount (P×r×t). Compound interest is calculated on the principal plus accumulated interest from previous periods, following A = P(1+r/n)^(nt). Compound interest grows exponentially over time while simple interest grows linearly.",
  },
  {
    id: 4,
    text: "What is the difference between a stack and a queue data structure?",
    domain: "tech",
    reference:
      "A stack follows LIFO (Last In, First Out) - elements are added and removed from the top. A queue follows FIFO (First In, First Out) - elements are added at the rear and removed from the front. Stacks are used for function call management and undo operations; queues are used for task scheduling and BFS.",
  },
  {
    id: 5,
    text: "What are the stages of mitosis and what happens in each stage?",
    domain: "medical",
    reference:
      "Mitosis has four stages: Prophase (chromosomes condense, spindle forms), Metaphase (chromosomes align at cell equator), Anaphase (sister chromatids separate and move to poles), and Telophase (nuclear envelopes reform, chromosomes decondense). Cytokinesis then divides the cytoplasm.",
  },
  {
    id: 6,
    text: "What is the doctrine of stare decisis and why is it important?",
    domain: "legal",
    reference:
      "Stare decisis ('to stand by things decided') is the legal principle that courts should follow precedent set by previous decisions. It ensures consistency, predictability, and stability in the legal system. Courts may depart from precedent in exceptional circumstances when prior rulings are clearly erroneous.",
  },
  {
    id: 7,
    text: "Explain what a P/E ratio is and how investors use it to evaluate stocks.",
    domain: "finance",
    reference:
      "The Price-to-Earnings (P/E) ratio divides a stock's market price by its earnings per share. A high P/E may indicate expected growth or overvaluation; a low P/E may suggest undervaluation or declining prospects. Investors compare P/E ratios within industries and against historical averages to assess relative value.",
  },
  {
    id: 8,
    text: "Explain how TCP ensures reliable data transmission over unreliable networks.",
    domain: "tech",
    reference:
      "TCP ensures reliability through: sequence numbers to order segments, acknowledgments (ACKs) to confirm receipt, retransmission of lost packets via timeouts, flow control using sliding window, congestion control algorithms (slow start, congestion avoidance), and checksums for data integrity.",
  },
  {
    id: 9,
    text: "What is the pathophysiology of myocardial infarction (heart attack)?",
    domain: "medical",
    reference:
      "A myocardial infarction occurs when coronary artery blood flow is blocked, usually by rupture of an atherosclerotic plaque followed by thrombus formation. The resulting ischemia causes myocardial cell death within minutes to hours. Damage depends on the affected artery, duration of occlusion, and collateral circulation.",
  },
  {
    id: 10,
    text: "What are the key differences between civil law and common law legal systems?",
    domain: "legal",
    reference:
      "Common law systems (UK, US) rely heavily on judicial precedent and case law, with judges interpreting statutes. Civil law systems (France, Germany) are based on comprehensive codified statutes, with judges applying code provisions rather than creating law. Common law is adversarial; civil law is inquisitorial.",
  },
  {
    id: 11,
    text: "What is quantitative easing and how does it affect the economy?",
    domain: "finance",
    reference:
      "Quantitative easing (QE) is when a central bank purchases government bonds and other securities to increase money supply and lower interest rates. It aims to stimulate borrowing, investment, and spending. Risks include inflation, asset bubbles, currency depreciation, and difficulty unwinding positions.",
  },
  {
    id: 12,
    text: "Explain the difference between symmetric and asymmetric encryption with examples.",
    domain: "tech",
    reference:
      "Symmetric encryption uses the same key for encryption and decryption (e.g., AES, DES) - fast but requires secure key exchange. Asymmetric encryption uses a public/private key pair (e.g., RSA, ECC) - slower but solves key distribution. TLS/HTTPS uses asymmetric for key exchange, then symmetric for data transfer.",
  },
  {
    id: 13,
    text: "How do mRNA vaccines work and how do they differ from traditional vaccines?",
    domain: "medical",
    reference:
      "mRNA vaccines deliver synthetic mRNA encoding a viral protein (e.g., spike protein). Cells translate this mRNA into protein, triggering immune response. Unlike traditional vaccines using weakened/inactivated virus or protein subunits, mRNA vaccines don't contain any virus. They're faster to develop and manufacture but require cold storage.",
  },
  {
    id: 14,
    text: "What is the difference between a balance sheet and an income statement?",
    domain: "finance",
    reference:
      "A balance sheet shows financial position at a specific point in time (assets = liabilities + equity). An income statement shows financial performance over a period (revenue - expenses = net income). The balance sheet is a snapshot; the income statement shows flow. Net income flows into retained earnings on the balance sheet.",
  },
  {
    id: 15,
    text: "What is the CAP theorem in distributed systems?",
    domain: "tech",
    reference:
      "The CAP theorem states that a distributed system can provide at most two of three guarantees: Consistency (all nodes see same data), Availability (every request gets a response), and Partition tolerance (system operates despite network failures). Since partitions are inevitable, systems choose between CP (e.g., HBase) and AP (e.g., Cassandra).",
  },
];

// ============================================================
// Domain mapping for expertise scoring
// ============================================================
const DOMAIN_EXPERTISE = {
  medical: { Medical: 1.0, Legal: 0.2, Finance: 0.2, Tech: 0.2 },
  legal: { Medical: 0.2, Legal: 1.0, Finance: 0.5, Tech: 0.2 },
  finance: { Medical: 0.2, Legal: 0.5, Finance: 1.0, Tech: 0.2 },
  tech: { Medical: 0.2, Legal: 0.2, Finance: 0.2, Tech: 1.0 },
};

const CHANNEL_WEIGHT = { Good: 1.0, Medium: 0.6, Bad: 0.2 };

// ============================================================
// Assign channels: purely random with seed=42
// ============================================================
function assignChannels(seed = 42) {
  const rng = mulberry32(seed);
  const assignments = {}; // key: "q{id}_Agent{name}"
  for (const q of QUESTIONS) {
    for (const a of AGENTS) {
      const key = `q${q.id}_${a.id}`;
      const idx = Math.floor(rng() * 3);
      assignments[key] = CHANNEL_NAMES[idx];
    }
  }
  return assignments;
}

// ============================================================
// OpenAI API call
// ============================================================
let totalTokensUsed = 0;

async function callLLM(model, systemPrompt, userPrompt, maxTokens = 1000) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    max_tokens: maxTokens,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (resp.status === 429) {
        const wait = 5 + attempt * 5;
        console.log(`  Rate limited, waiting ${wait}s...`);
        await sleep(wait * 1000);
        continue;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      const usage = data.usage || {};
      totalTokensUsed += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
      return data.choices[0].message.content.trim();
    } catch (err) {
      if (attempt === 2) throw err;
      console.log(`  Retry ${attempt + 1}: ${err.message.slice(0, 80)}`);
      await sleep(3000);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Corruption: replace words with [???]
// ============================================================
function applyCorruption(text, rate, seed) {
  if (rate === 0) return { text, corruptedCount: 0, totalWords: text.split(/\s+/).length };
  const rng = mulberry32(seed);
  const words = text.split(/\s+/);
  let corruptedCount = 0;
  const result = words.map((w) => {
    if (rng() < rate) {
      corruptedCount++;
      return "[???]";
    }
    return w;
  });
  return { text: result.join(" "), corruptedCount, totalWords: words.length };
}

// ============================================================
// Pipeline: consult specialists, corrupt, receiving agent, grade
// ============================================================
async function runPipeline(question, selectedAgents, channelAssignments, corruptionSeed) {
  const consultations = [];
  let totalCorrupted = 0;
  let totalWords = 0;

  // Step 1: Call each specialist with channel-limited max_tokens, then corrupt
  for (const agent of selectedAgents) {
    const chKey = `q${question.id}_${agent.id}`;
    const channelName = channelAssignments[chKey];
    const channel = CHANNELS[channelName];

    // Call specialist with max_tokens from channel
    const rawAnswer = await callLLM(
      "gpt-4o-mini",
      agent.system,
      question.text,
      channel.maxTokens
    );

    // Apply corruption
    const corrupted = applyCorruption(rawAnswer, channel.corruptionRate, corruptionSeed++);
    totalCorrupted += corrupted.corruptedCount;
    totalWords += corrupted.totalWords;

    consultations.push({
      agentId: agent.id,
      channel: channelName,
      rawLength: rawAnswer.length,
      corruptedText: corrupted.text,
      corruptedWords: corrupted.corruptedCount,
      totalWords: corrupted.totalWords,
    });
  }

  // Step 2: Receiving agent interprets all corrupted responses
  const receivingInput = consultations
    .map(
      (c, i) =>
        `[Consultation ${i + 1} from ${c.agentId} specialist (channel: ${c.channel})]:\n${c.corruptedText}`
    )
    .join("\n\n");

  const receivingPrompt = `Original question: ${question.text}\n\nYou received the following specialist consultations (some may be corrupted or truncated):\n\n${receivingInput}\n\nBased on these consultations, provide the best possible answer to the original question.`;

  const finalAnswer = await callLLM(
    "gpt-4o-mini",
    RECEIVING_AGENT_SYSTEM,
    receivingPrompt,
    600
  );

  // Step 3: Grade the receiving agent's clean output
  const graderPrompt = `Question: ${question.text}

Reference answer: ${question.reference}

Student answer: ${finalAnswer}

Grade the student answer on a scale of 0-10 based on accuracy, completeness, and clarity compared to the reference answer. Consider:
- Factual correctness (most important)
- Coverage of key points
- Clarity of explanation

Respond with ONLY a JSON object: {"score": <number>, "reason": "<brief reason>"}`;

  const graderResp = await callLLM(
    "gpt-4o",
    "You are a strict but fair academic grader. Grade answers accurately. Respond only with the requested JSON.",
    graderPrompt,
    150
  );

  let score = 0;
  let reason = "";
  try {
    const parsed = JSON.parse(graderResp.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
    score = parsed.score;
    reason = parsed.reason || "";
  } catch {
    const m = graderResp.match(/(\d+(?:\.\d+)?)/);
    score = m ? parseFloat(m[1]) : 0;
    reason = graderResp.slice(0, 100);
  }

  return {
    questionId: question.id,
    consultations,
    finalAnswer: finalAnswer.slice(0, 300),
    score,
    reason,
    totalCorrupted,
    totalWords,
    numConsultations: selectedAgents.length,
  };
}

// ============================================================
// Condition implementations
// ============================================================

// 1. Fixed Order: Medical → Legal → Finance → Tech, pick first 3
function selectFixed() {
  return AGENTS.slice(0, 3); // Medical, Legal, Finance
}

// 2. Expertise Only: primary domain expert first, then secondary, then others
function selectExpertise(question) {
  const domain = question.domain;
  const scored = AGENTS.map((a) => ({
    agent: a,
    expertise: DOMAIN_EXPERTISE[domain][a.id],
  })).sort((a, b) => b.expertise - a.expertise);
  return scored.slice(0, 3).map((s) => s.agent);
}

// 3. Channel Only: pick agents with best channels
function selectChannel(question, channelAssignments) {
  const scored = AGENTS.map((a) => {
    const chKey = `q${question.id}_${a.id}`;
    const ch = channelAssignments[chKey];
    return { agent: a, weight: CHANNEL_WEIGHT[ch], channel: ch };
  }).sort((a, b) => b.weight - a.weight);
  return scored.slice(0, 3).map((s) => s.agent);
}

// 4. Joint: expertise × channel weight
function selectJoint(question, channelAssignments) {
  const domain = question.domain;
  const scored = AGENTS.map((a) => {
    const chKey = `q${question.id}_${a.id}`;
    const ch = channelAssignments[chKey];
    const expW = DOMAIN_EXPERTISE[domain][a.id];
    const chW = CHANNEL_WEIGHT[ch];
    return { agent: a, score: expW * chW, expertise: expW, channel: ch, chWeight: chW };
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((s) => s.agent);
}

// 5. Joint + Early Stop: same scoring, but stop early if confident
async function runJointEarlyStop(question, channelAssignments, corruptionSeed) {
  const domain = question.domain;
  const scored = AGENTS.map((a) => {
    const chKey = `q${question.id}_${a.id}`;
    const ch = channelAssignments[chKey];
    const expW = DOMAIN_EXPERTISE[domain][a.id];
    const chW = CHANNEL_WEIGHT[ch];
    return { agent: a, score: expW * chW, channel: ch };
  }).sort((a, b) => b.score - a.score);

  const consultations = [];
  let totalCorrupted = 0;
  let totalWords = 0;
  let finalAnswer = "";
  let stopped = false;

  for (let i = 0; i < Math.min(3, scored.length); i++) {
    const { agent, channel: channelName } = scored[i];
    const ch = CHANNELS[channelName];

    const rawAnswer = await callLLM("gpt-4o-mini", agent.system, question.text, ch.maxTokens);
    const corrupted = applyCorruption(rawAnswer, ch.corruptionRate, corruptionSeed + i);
    totalCorrupted += corrupted.corruptedCount;
    totalWords += corrupted.totalWords;

    consultations.push({
      agentId: agent.id,
      channel: channelName,
      rawLength: rawAnswer.length,
      corruptedText: corrupted.text,
      corruptedWords: corrupted.corruptedCount,
      totalWords: corrupted.totalWords,
    });

    // After each consultation, ask receiving agent for partial answer
    const partialInput = consultations
      .map(
        (c, j) =>
          `[Consultation ${j + 1} from ${c.agentId} specialist (channel: ${c.channel})]:\n${c.corruptedText}`
      )
      .join("\n\n");

    const receivingPrompt = `Original question: ${question.text}\n\nYou received the following specialist consultations (some may be corrupted or truncated):\n\n${partialInput}\n\nBased on these consultations, provide the best possible answer to the original question.`;

    finalAnswer = await callLLM("gpt-4o-mini", RECEIVING_AGENT_SYSTEM, receivingPrompt, 600);

    // Check confidence
    const lower = finalAnswer.toLowerCase();
    if (
      i >= 0 &&
      (lower.includes("therefore") ||
        lower.includes("in conclusion") ||
        lower.includes("in summary") ||
        lower.includes("to summarize"))
    ) {
      stopped = true;
      break;
    }
  }

  // Grade
  const graderPrompt = `Question: ${question.text}

Reference answer: ${question.reference}

Student answer: ${finalAnswer}

Grade the student answer on a scale of 0-10 based on accuracy, completeness, and clarity compared to the reference answer. Consider:
- Factual correctness (most important)
- Coverage of key points
- Clarity of explanation

Respond with ONLY a JSON object: {"score": <number>, "reason": "<brief reason>"}`;

  const graderResp = await callLLM(
    "gpt-4o",
    "You are a strict but fair academic grader. Grade answers accurately. Respond only with the requested JSON.",
    graderPrompt,
    150
  );

  let score = 0;
  let reason = "";
  try {
    const parsed = JSON.parse(graderResp.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
    score = parsed.score;
    reason = parsed.reason || "";
  } catch {
    const m = graderResp.match(/(\d+(?:\.\d+)?)/);
    score = m ? parseFloat(m[1]) : 0;
    reason = graderResp.slice(0, 100);
  }

  return {
    questionId: question.id,
    consultations,
    finalAnswer: finalAnswer.slice(0, 300),
    score,
    reason,
    totalCorrupted,
    totalWords,
    numConsultations: consultations.length,
    earlyStopped: stopped,
  };
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log("=== KI-4 v4: Adaptive Task Scheduling with Receiving Agent ===\n");

  const channelAssignments = assignChannels(42);

  // Print channel assignments
  console.log("Channel Assignments (seed=42):");
  for (const q of QUESTIONS) {
    const chs = AGENTS.map((a) => `${a.id}=${channelAssignments[`q${q.id}_${a.id}`]}`).join(", ");
    console.log(`  Q${q.id} (${q.domain}): ${chs}`);
  }
  console.log();

  const CONDITIONS = [
    { name: "1_FixedOrder", select: () => null },
    { name: "2_ExpertiseOnly", select: () => null },
    { name: "3_ChannelOnly", select: () => null },
    { name: "4_Joint", select: () => null },
    { name: "5_JointEarlyStop", select: () => null },
  ];

  const allResults = {};
  let corruptionSeed = 1000;

  for (const cond of CONDITIONS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Condition: ${cond.name}`);
    console.log("=".repeat(60));

    const results = [];
    const tokensBefore = totalTokensUsed;

    for (const q of QUESTIONS) {
      process.stdout.write(`  Q${q.id} (${q.domain})... `);

      let result;

      if (cond.name === "5_JointEarlyStop") {
        result = await runJointEarlyStop(q, channelAssignments, corruptionSeed);
        corruptionSeed += 10;
      } else {
        let agents;
        if (cond.name === "1_FixedOrder") agents = selectFixed();
        else if (cond.name === "2_ExpertiseOnly") agents = selectExpertise(q);
        else if (cond.name === "3_ChannelOnly") agents = selectChannel(q, channelAssignments);
        else if (cond.name === "4_Joint") agents = selectJoint(q, channelAssignments);

        result = await runPipeline(q, agents, channelAssignments, corruptionSeed);
        corruptionSeed += 10;
      }

      const agentList = result.consultations.map((c) => `${c.agentId}(${c.channel})`).join(", ");
      const corruptPct =
        result.totalWords > 0
          ? ((result.totalCorrupted / result.totalWords) * 100).toFixed(1)
          : "0.0";
      console.log(
        `Score=${result.score}/10 | Agents=[${agentList}] | Corrupt=${corruptPct}% | ${result.reason.slice(0, 60)}`
      );
      results.push(result);

      await sleep(300); // small delay between questions
    }

    const tokensUsed = totalTokensUsed - tokensBefore;
    const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
    const avgConsult = results.reduce((s, r) => s + r.numConsultations, 0) / results.length;
    const totalCorruptedWords = results.reduce((s, r) => s + r.totalCorrupted, 0);
    const totalWordsAll = results.reduce((s, r) => s + r.totalWords, 0);
    const avgCorrupt =
      totalWordsAll > 0 ? ((totalCorruptedWords / totalWordsAll) * 100).toFixed(1) : "0.0";

    const summary = {
      condition: cond.name,
      avgScore: Math.round(avgScore * 100) / 100,
      totalTokens: tokensUsed,
      avgConsultations: Math.round(avgConsult * 100) / 100,
      avgCorruptionPct: parseFloat(avgCorrupt),
      perQuestion: results.map((r) => ({
        qId: r.questionId,
        score: r.score,
        agents: r.consultations.map((c) => ({ id: c.agentId, channel: c.channel })),
        corruptedWords: r.totalCorrupted,
        totalWords: r.totalWords,
        numConsultations: r.numConsultations,
        earlyStopped: r.earlyStopped || false,
        reason: r.reason,
      })),
    };

    allResults[cond.name] = summary;

    console.log(`\n  --- ${cond.name} Summary ---`);
    console.log(`  Avg Score:        ${summary.avgScore}/10`);
    console.log(`  Total Tokens:     ${summary.totalTokens.toLocaleString()}`);
    console.log(`  Avg Consultations: ${summary.avgConsultations}`);
    console.log(`  Avg Corruption:   ${summary.avgCorruptionPct}%`);
  }

  // ============================================================
  // Final comparison
  // ============================================================
  console.log(`\n${"=".repeat(70)}`);
  console.log("FINAL COMPARISON");
  console.log("=".repeat(70));
  console.log(
    `${"Condition".padEnd(25)} ${"AvgScore".padStart(9)} ${"Tokens".padStart(10)} ${"Consults".padStart(10)} ${"Corrupt%".padStart(10)}`
  );
  console.log("-".repeat(70));

  for (const [name, s] of Object.entries(allResults)) {
    console.log(
      `${name.padEnd(25)} ${s.avgScore.toFixed(2).padStart(9)} ${s.totalTokens.toLocaleString().padStart(10)} ${s.avgConsultations.toFixed(2).padStart(10)} ${s.avgCorruptionPct.toFixed(1).padStart(9)}%`
    );
  }

  console.log(`\nTotal API tokens used: ${totalTokensUsed.toLocaleString()}`);

  // Per-question comparison
  console.log(`\n${"=".repeat(70)}`);
  console.log("PER-QUESTION SCORES");
  console.log("=".repeat(70));

  const condNames = Object.keys(allResults);
  const header = `${"Q#".padEnd(5)} ${"Domain".padEnd(10)} ${condNames.map((n) => n.replace(/^\d_/, "").padStart(12)).join(" ")}`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const scores = condNames.map((n) => {
      const pq = allResults[n].perQuestion[i];
      return pq.score.toFixed(1).padStart(12);
    });
    console.log(`Q${String(q.id).padEnd(4)} ${q.domain.padEnd(10)} ${scores.join(" ")}`);
  }

  // ============================================================
  // Save JSON
  // ============================================================
  const output = {
    experiment: "KI-4 v4: Adaptive Task Scheduling with Receiving Agent",
    date: new Date().toISOString(),
    pipeline:
      "Specialist(max_tokens) → Corruption → Receiving Agent → Grader",
    channels: CHANNELS,
    channelAssignments,
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      text: q.text,
      domain: q.domain,
      reference: q.reference,
    })),
    conditions: allResults,
    totalTokens: totalTokensUsed,
  };

  const outPath = "C:/Users/hyunj/wcisl/scripts/ki4_v4_results.json";
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\nResults saved to ${outPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
