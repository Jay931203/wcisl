/**
 * KI-4 v2: Adaptive Task Scheduling — Redesigned Experiment
 *
 * 4 specialist agents (Medical, Legal, Finance, Tech) with severe channel corruption.
 * 5 conditions: Fixed Order, Expertise Only, Channel Only, Joint, Joint+EarlyStop.
 * Programmatic routing (no LLM orchestrator) for Joint conditions.
 */

import OpenAI from "openai";

const OPENAI_API_KEY =
  "OPENAI_API_KEY_REDACTED";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ─── Agents ──────────────────────────────────────────────────────────────────

const AGENTS = [
  {
    id: "medical",
    name: "Agent-Medical",
    systemPrompt:
      "You are an expert physician and biomedical researcher. You have deep knowledge of human anatomy, pharmacology, pathophysiology, clinical medicine, and medical research. Answer medical and biology questions with precision and cite relevant mechanisms. If a question is outside medicine, you must still try your best but acknowledge your limitations.",
  },
  {
    id: "legal",
    name: "Agent-Legal",
    systemPrompt:
      "You are an expert attorney with broad knowledge of civil law, criminal law, corporate law, labor law, intellectual property, and regulatory compliance. Provide detailed legal analysis citing relevant principles and precedents. If a question is outside law, you must still try your best but acknowledge your limitations.",
  },
  {
    id: "finance",
    name: "Agent-Finance",
    systemPrompt:
      "You are an expert financial analyst and economist. You have deep knowledge of accounting, corporate finance, macroeconomics, taxation, investment analysis, and financial regulation. Provide precise quantitative analysis when possible. If a question is outside finance/economics, you must still try your best but acknowledge your limitations.",
  },
  {
    id: "tech",
    name: "Agent-Tech",
    systemPrompt:
      "You are an expert software engineer and systems architect. You have deep knowledge of programming languages, algorithms, distributed systems, databases, networking, cybersecurity, and engineering principles. Provide detailed technical explanations with examples. If a question is outside technology/engineering, you must still try your best but acknowledge your limitations.",
  },
];

// ─── Channel Configs ─────────────────────────────────────────────────────────

const CHANNELS = {
  good: { maxTokens: 500, corruptionRate: 0.0, label: "Good" },
  medium: { maxTokens: 200, corruptionRate: 0.15, label: "Medium" },
  bad: { maxTokens: 80, corruptionRate: 0.4, label: "Bad" },
};

// ─── Questions ───────────────────────────────────────────────────────────────

const QUESTIONS = [
  {
    id: 1,
    text: "A 45-year-old male presents with sudden crushing chest pain radiating to the left arm, diaphoresis, and shortness of breath. His ECG shows ST-elevation in leads II, III, and aVF. What is the diagnosis, immediate management, and potential complications?",
    primaryDomain: "medical",
    secondaryDomain: "none",
    reference:
      "Inferior STEMI (ST-elevation myocardial infarction). Immediate management: aspirin, nitroglycerin, heparin, morphine for pain, emergent PCI (percutaneous coronary intervention) or thrombolytics. Complications: cardiogenic shock, arrhythmias (especially heart block with inferior MI), mitral regurgitation, ventricular septal rupture, Dressler syndrome.",
  },
  {
    id: 2,
    text: "A company wants to terminate an employee who has been on medical leave for 6 months. What are the employer's legal obligations, potential liabilities, and the correct procedure to follow?",
    primaryDomain: "legal",
    secondaryDomain: "medical",
    reference:
      "Employer must comply with FMLA (12 weeks protected leave), ADA reasonable accommodation requirements, and state disability laws. Cannot terminate solely for medical leave if within protected period. Must engage in interactive process, document legitimate business reasons, consider reasonable accommodations. Liabilities include wrongful termination suit, discrimination claims, back pay, and punitive damages.",
  },
  {
    id: 3,
    text: "A startup has $2M in revenue, $3M in expenses, and is burning $80K/month. They want to raise a Series A. What valuation method should they use, what metrics will VCs scrutinize, and how should they structure the term sheet?",
    primaryDomain: "finance",
    secondaryDomain: "none",
    reference:
      "Pre-revenue/early-stage: use comparable transactions, DCF with high discount rate, or revenue multiples. VCs will scrutinize: burn rate, runway (25 months at current burn), MRR growth rate, CAC/LTV, gross margins, unit economics, churn. Term sheet: preferred stock with 1x liquidation preference, anti-dilution provisions (broad-based weighted average), board seats, pro-rata rights, information rights. Typical Series A: 20-25% dilution.",
  },
  {
    id: 4,
    text: "Design a distributed system that handles 100,000 concurrent WebSocket connections with sub-100ms latency, automatic failover, and message ordering guarantees. What architecture, technologies, and protocols would you use?",
    primaryDomain: "tech",
    secondaryDomain: "none",
    reference:
      "Architecture: horizontally scaled WebSocket servers behind a load balancer (sticky sessions or connection-aware routing). Use Redis Pub/Sub or Kafka for inter-node messaging. Consistent hashing for connection distribution. Failover: health checks, automatic reconnection with session resumption, state replication. Message ordering: per-channel sequence numbers, vector clocks, or total-order broadcast. Technologies: Node.js/Go for WS servers, Redis Cluster, Kafka for durable messaging, Consul/etcd for service discovery, HAProxy for load balancing.",
  },
  {
    id: 5,
    text: "Explain the mechanism of action of CRISPR-Cas9 gene editing, including guide RNA design, PAM sequence requirements, DNA repair pathways (NHEJ vs HDR), and current limitations for therapeutic applications.",
    primaryDomain: "medical",
    secondaryDomain: "tech",
    reference:
      "CRISPR-Cas9: Cas9 endonuclease guided by single guide RNA (sgRNA) complementary to target DNA. Requires PAM sequence (NGG for SpCas9) adjacent to target. Creates double-strand break. Repair: NHEJ (error-prone, insertions/deletions for knockouts) or HDR (precise editing with donor template, but low efficiency). Limitations: off-target effects, delivery challenges (viral vectors, lipid nanoparticles), low HDR efficiency in non-dividing cells, immune response to Cas9, mosaicism, ethical concerns for germline editing.",
  },
  {
    id: 6,
    text: "A software company's open-source contributor submitted code that was later found to contain proprietary algorithms from their employer. What are the intellectual property implications, liability exposure, and remediation steps?",
    primaryDomain: "legal",
    secondaryDomain: "tech",
    reference:
      "IP implications: potential trade secret misappropriation, copyright infringement, breach of employment contract (work-for-hire doctrine, IP assignment clauses). Liability: OSS company may face contributory infringement claims, injunctive relief, damages. Remediation: immediately remove infringing code, conduct IP audit, notify affected users, implement CLA (Contributor License Agreement), seek legal counsel for indemnification. Consider clean-room reimplementation.",
  },
  {
    id: 7,
    text: "A pharmaceutical company wants to issue convertible bonds to fund a new drug's Phase III clinical trial. Explain the optimal bond structure, accounting treatment under IFRS, tax implications, and how the conversion feature affects the company's cost of capital.",
    primaryDomain: "finance",
    secondaryDomain: "legal",
    reference:
      "Convertible bond structure: lower coupon rate (2-4% vs 5-7% for straight debt), conversion premium 20-30% above current stock price, maturity 5-7 years. IFRS treatment: bifurcate into debt component (amortized cost) and equity component (residual method) under IAS 32. Tax: interest expense deductible, conversion not a taxable event. Cost of capital: lower than straight debt due to equity upside, dilution risk priced into equity component, reduces WACC if stock appreciates past conversion price.",
  },
  {
    id: 8,
    text: "A patient with Type 2 diabetes, hypertension, and stage 3 chronic kidney disease needs a comprehensive medication review. What drug interactions should be monitored, which medications should be avoided, and what is the optimal treatment regimen?",
    primaryDomain: "medical",
    secondaryDomain: "none",
    reference:
      "Diabetes: metformin (adjust dose for eGFR 30-45, contraindicated <30), SGLT2 inhibitors (renoprotective, empagliflozin/dapagliflozin), GLP-1 agonists. Avoid: sulfonylureas (hypoglycemia risk with CKD). Hypertension: ACEi/ARB (renoprotective but monitor K+ and creatinine), amlodipine. Avoid: NSAIDs (worsen kidney function), excessive potassium-sparing diuretics. Interactions: ACEi + K-sparing diuretics = hyperkalemia risk, metformin + contrast dye = lactic acidosis risk. Monitor: eGFR, electrolytes, HbA1c, BP regularly.",
  },
  {
    id: 9,
    text: "Explain how a buffer overflow attack works at the assembly level, including stack frame layout, return address overwriting, NOP sled technique, and modern mitigations like ASLR, DEP, and stack canaries.",
    primaryDomain: "tech",
    secondaryDomain: "none",
    reference:
      "Stack frame: local variables, saved frame pointer (EBP), return address (EIP). Buffer overflow: write past buffer boundary to overwrite return address with attacker-controlled address pointing to shellcode. NOP sled: block of NOP instructions before shellcode to increase hit probability. Mitigations: ASLR (randomizes memory layout), DEP/NX (non-executable stack), stack canaries (random value between buffer and return address, checked before return), RELRO, PIE. Modern bypass: ROP (Return-Oriented Programming), information leaks to defeat ASLR.",
  },
  {
    id: 10,
    text: "A multinational corporation is restructuring its operations across 5 countries. What are the transfer pricing rules, tax treaty implications, and optimal corporate structure to minimize global tax liability while remaining compliant?",
    primaryDomain: "finance",
    secondaryDomain: "legal",
    reference:
      "Transfer pricing: arm's length principle (OECD guidelines), comparable uncontrolled price method, cost-plus, profit-split methods. Documentation required per BEPS Action 13 (master file, local file, CbCR). Tax treaties: prevent double taxation, withholding tax rates on dividends/interest/royalties, PE rules. Structure: holding company in favorable jurisdiction (Netherlands, Ireland, Singapore), IP holding in low-tax jurisdiction, substance requirements. BEPS 2.0 Pillar Two: 15% global minimum tax. Consider: PE exposure, CFC rules, thin capitalization rules, anti-avoidance provisions.",
  },
  {
    id: 11,
    text: "A patient develops anaphylaxis after a bee sting. Describe the immunological cascade (IgE, mast cells, histamine), immediate emergency treatment protocol, and long-term management including venom immunotherapy.",
    primaryDomain: "medical",
    secondaryDomain: "none",
    reference:
      "Immunology: prior sensitization produces allergen-specific IgE bound to mast cell/basophil FcεRI receptors. Re-exposure crosslinks IgE, triggering degranulation releasing histamine, tryptase, prostaglandins, leukotrienes → vasodilation, bronchoconstriction, increased permeability. Treatment: epinephrine IM (0.3-0.5mg, anterolateral thigh), secure airway, IV fluids, H1/H2 blockers, corticosteroids, observe 4-6 hours for biphasic reaction. Long-term: prescribe epinephrine auto-injector, refer for venom immunotherapy (80-98% effective over 3-5 years), allergy testing.",
  },
  {
    id: 12,
    text: "A tenant signed a 5-year commercial lease but the landlord wants to sell the building. The new buyer wants to change the property's use from commercial to residential. What are the tenant's rights, the legal process for lease assignment, and potential remedies?",
    primaryDomain: "legal",
    secondaryDomain: "finance",
    reference:
      "Tenant rights: lease survives sale (privity of estate), new owner bound by existing lease terms. Assignment: landlord can assign obligations to buyer, but tenant's rights preserved. Change of use: requires zoning approval, cannot unilaterally terminate commercial lease for redevelopment without lease provision. Remedies: tenant can enforce lease terms, seek injunctive relief, claim relocation costs, negotiate buyout (often 1-3 years rent equivalent). Key clauses: non-disturbance agreement, attornment clause, estoppel certificate.",
  },
  {
    id: 13,
    text: "Design a real-time fraud detection system for credit card transactions processing 10,000 TPS. Include the ML pipeline, feature engineering, model serving architecture, and how to handle concept drift.",
    primaryDomain: "tech",
    secondaryDomain: "finance",
    reference:
      "Architecture: stream processing (Kafka + Flink/Spark Streaming), feature store (Feast/Tecton), model serving (TensorFlow Serving/Triton). Features: transaction velocity, geo-distance, merchant category deviation, amount anomaly, device fingerprint, time-of-day patterns. Models: ensemble of gradient boosting (XGBoost for tabular features) + neural network (LSTM for sequential patterns). Concept drift: monitor feature distributions, model performance metrics, automated retraining pipeline, champion-challenger deployment. Latency: pre-compute features, model quantization, edge caching for hot paths. Alert: risk score threshold, human-in-loop for medium-risk.",
  },
  {
    id: 14,
    text: "A biotech company's clinical trial shows a drug reduces mortality by 15% but has serious liver toxicity in 8% of patients. Analyze the risk-benefit from a medical perspective, the regulatory pathway for approval, and the financial impact on the company's valuation.",
    primaryDomain: "medical",
    secondaryDomain: "finance",
    reference:
      "Medical: NNT (number needed to treat) ~7 to prevent one death, NNH ~13 for liver toxicity. Favorable if mortality benefit outweighs hepatotoxicity. Requires REMS (Risk Evaluation and Mitigation Strategy), liver monitoring protocol, patient selection criteria. Regulatory: FDA may grant conditional approval with REMS, post-marketing surveillance required, black box warning likely. Financial: approval probability ~60% with REMS, peak sales estimate adjusted for restricted use, increased pharmacovigilance costs, potential liability reserves. Valuation: risk-adjusted NPV model, comparable drug precedents.",
  },
  {
    id: 15,
    text: "A company discovers that a former employee has been running a competing business using trade secrets stolen before departure. Detail the legal causes of action, available injunctive relief, damage calculation methods, and the procedure for an emergency TRO.",
    primaryDomain: "legal",
    secondaryDomain: "finance",
    reference:
      "Causes of action: trade secret misappropriation (DTSA federal, state UTSA), breach of NDA/non-compete, breach of fiduciary duty, tortious interference, unfair competition, conversion. Injunctive relief: TRO (ex parte if irreparable harm shown, 14-day duration), preliminary injunction, permanent injunction. Damages: actual loss + unjust enrichment, reasonable royalty, exemplary damages (up to 2x for willful misappropriation), attorney fees. TRO procedure: verified complaint, declaration showing irreparable harm, likelihood of success on merits, balance of hardships, security bond. Criminal referral possible under EEA.",
  },
];

// ─── Channel Assignment ──────────────────────────────────────────────────────
// Manually assign channels so that for at least 5 questions the primary expert has Bad channel.
// Format: channelMap[questionId][agentId] = "good" | "medium" | "bad"

function buildChannelMap() {
  const map = {};
  const channelOptions = ["good", "medium", "bad"];

  // Seed a simple deterministic RNG for reproducibility
  let seed = 42;
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  for (const q of QUESTIONS) {
    map[q.id] = {};
    for (const a of AGENTS) {
      map[q.id][a.id] = channelOptions[Math.floor(rand() * 3)];
    }
  }

  // Now manually override: ensure at least 5 questions have primary expert on Bad channel
  // and a non-expert has Good channel.
  const overrides = [
    // Q1: medical is primary → give medical Bad, give legal Good
    { qId: 1, primary: "medical", overrides: { medical: "bad", legal: "good", finance: "medium", tech: "good" } },
    // Q3: finance is primary → give finance Bad, give tech Good
    { qId: 3, primary: "finance", overrides: { finance: "bad", tech: "good", medical: "medium", legal: "medium" } },
    // Q5: medical is primary → give medical Bad, give tech Good
    { qId: 5, primary: "medical", overrides: { medical: "bad", tech: "good", legal: "medium", finance: "good" } },
    // Q9: tech is primary → give tech Bad, give medical Good
    { qId: 9, primary: "tech", overrides: { tech: "bad", medical: "good", legal: "good", finance: "medium" } },
    // Q11: medical is primary → give medical Bad, give finance Good
    { qId: 11, primary: "medical", overrides: { medical: "bad", finance: "good", legal: "medium", tech: "good" } },
    // Q13: tech is primary → give tech Bad, give finance Good
    { qId: 13, primary: "tech", overrides: { tech: "bad", finance: "good", medical: "medium", legal: "medium" } },
    // Q15: legal is primary → give legal Bad, give tech Good
    { qId: 15, primary: "legal", overrides: { legal: "bad", tech: "good", medical: "medium", finance: "good" } },
  ];

  for (const ov of overrides) {
    for (const [agentId, ch] of Object.entries(ov.overrides)) {
      map[ov.qId][agentId] = ch;
    }
  }

  // For questions without overrides, ensure primary expert does NOT have bad channel
  // so we have a mix of scenarios.
  const overriddenQs = new Set(overrides.map((o) => o.qId));
  for (const q of QUESTIONS) {
    if (!overriddenQs.has(q.id)) {
      // Give primary expert a good or medium channel
      if (map[q.id][q.primaryDomain] === "bad") {
        map[q.id][q.primaryDomain] = "good";
      }
    }
  }

  return map;
}

const CHANNEL_MAP = buildChannelMap();

// ─── Corruption Function ─────────────────────────────────────────────────────

function corruptText(text, rate) {
  if (rate === 0) return text;
  const words = text.split(/\s+/);
  // Use deterministic corruption based on word index for reproducibility across conditions
  const corrupted = words.map((w, i) => {
    // Simple hash to decide corruption
    const hash = ((i + 1) * 2654435761) >>> 0;
    const threshold = hash / 0xffffffff;
    return threshold < rate ? "[???]" : w;
  });
  return corrupted.join(" ");
}

// ─── API Call ────────────────────────────────────────────────────────────────

async function callAgent(agent, question, channel) {
  const tokenInstruction = `\n\nIMPORTANT: Respond in at most ${channel.maxTokens} tokens. Be concise.`;

  const start = Date.now();
  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: channel.maxTokens,
      messages: [
        { role: "system", content: agent.systemPrompt },
        { role: "user", content: question + tokenInstruction },
      ],
    });
  } catch (e) {
    console.error(`  API error for ${agent.name}: ${e.message}`);
    return { text: "[API ERROR]", tokens: 0, latency: Date.now() - start };
  }

  const latency = Date.now() - start;
  const rawText = response.choices[0]?.message?.content || "";
  const tokens =
    (response.usage?.prompt_tokens || 0) +
    (response.usage?.completion_tokens || 0);

  // Apply corruption
  const finalText = corruptText(rawText, channel.corruptionRate);

  return { text: finalText, tokens, latency, rawText };
}

// ─── Grading ─────────────────────────────────────────────────────────────────

async function gradeAnswer(question, reference, answer) {
  const prompt = `Grade this answer on a scale of 0-10 for correctness, completeness, and relevance. Be strict.

Question: ${question}

Reference answer covers: ${reference}

Answer to grade:
${answer}

Respond with ONLY a JSON object: {"score": <number>, "reason": "<brief explanation>"}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0]?.message?.content || "";
    const tokens =
      (response.usage?.prompt_tokens || 0) +
      (response.usage?.completion_tokens || 0);

    // Parse score
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { score: parsed.score, reason: parsed.reason, graderTokens: tokens };
    }
    // Fallback: try to find a number
    const numMatch = text.match(/(\d+(\.\d+)?)/);
    return {
      score: numMatch ? parseFloat(numMatch[1]) : 5,
      reason: text,
      graderTokens: tokens,
    };
  } catch (e) {
    console.error(`  Grading error: ${e.message}`);
    return { score: 0, reason: "grading failed", graderTokens: 0 };
  }
}

// ─── Expertise & Domain Mapping ──────────────────────────────────────────────

function getExpertiseScore(agentId, question) {
  if (agentId === question.primaryDomain) return 1.0;
  if (agentId === question.secondaryDomain) return 0.5;
  return 0.2;
}

function getChannelMultiplier(channelType) {
  if (channelType === "good") return 1.0;
  if (channelType === "medium") return 0.6;
  return 0.2; // bad
}

// ─── Condition Implementations ───────────────────────────────────────────────

// Returns array of agent ids to consult in order
function selectAgents_FixedOrder(_question) {
  // Always Medical → Legal → Finance (3 consultations, fixed)
  return ["medical", "legal", "finance"];
}

function selectAgents_ExpertiseOnly(question) {
  // Primary domain first, then secondary, then fill with others
  const order = [];
  order.push(question.primaryDomain);
  if (question.secondaryDomain && question.secondaryDomain !== "none") {
    order.push(question.secondaryDomain);
  }
  // Fill remaining from all agents
  for (const a of AGENTS) {
    if (!order.includes(a.id)) order.push(a.id);
  }
  return order.slice(0, 3);
}

function selectAgents_ChannelOnly(question) {
  // Pick agents with best channel quality, ignore expertise
  const agentChannels = AGENTS.map((a) => ({
    id: a.id,
    channelType: CHANNEL_MAP[question.id][a.id],
    multiplier: getChannelMultiplier(CHANNEL_MAP[question.id][a.id]),
  }));
  agentChannels.sort((a, b) => b.multiplier - a.multiplier);
  return agentChannels.slice(0, 3).map((a) => a.id);
}

function selectAgents_Joint(question) {
  // score = expertise_relevance * channel_quality_multiplier
  const scored = AGENTS.map((a) => {
    const expertise = getExpertiseScore(a.id, question);
    const chType = CHANNEL_MAP[question.id][a.id];
    const chMult = getChannelMultiplier(chType);
    return { id: a.id, score: expertise * chMult, expertise, chType, chMult };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((a) => a.id);
}

// ─── Early Stop Heuristic ────────────────────────────────────────────────────

function shouldEarlyStop(accumulatedText) {
  const keywords = [
    "therefore",
    "in conclusion",
    "the answer is",
    "in summary",
    "to summarize",
    "the key point",
    "the main takeaway",
    "overall",
    "thus",
    "consequently",
  ];
  const lower = accumulatedText.toLowerCase();
  // Need at least some substance (200 chars) and a conclusion keyword
  if (lower.length < 200) return false;
  return keywords.some((kw) => lower.includes(kw));
}

// ─── Run One Condition ───────────────────────────────────────────────────────

async function runCondition(conditionName, selectFn, useEarlyStop = false) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Condition: ${conditionName}`);
  console.log("=".repeat(60));

  const results = [];
  let totalTokens = 0;
  let totalConsultations = 0;
  let totalCorruptedWords = 0;
  let totalWords = 0;

  for (const q of QUESTIONS) {
    const agentOrder = selectFn(q);
    let combinedAnswer = "";
    let qTokens = 0;
    let consultations = 0;

    console.log(`  Q${q.id}: agents=${agentOrder.join(",")} ...`);

    for (const agentId of agentOrder) {
      const agent = AGENTS.find((a) => a.id === agentId);
      const chType = CHANNEL_MAP[q.id][agentId];
      const channel = CHANNELS[chType];

      const result = await callAgent(agent, q.text, channel);
      qTokens += result.tokens;
      consultations++;

      // Count corruption
      const words = result.text.split(/\s+/).filter((w) => w.length > 0);
      const corrupted = words.filter((w) => w === "[???]").length;
      totalCorruptedWords += corrupted;
      totalWords += words.length;

      combinedAnswer += `\n[${agent.name} via ${chType} channel]:\n${result.text}\n`;

      if (useEarlyStop && shouldEarlyStop(combinedAnswer)) {
        console.log(`    Early stop after ${consultations} consultations`);
        break;
      }
    }

    // Grade the combined answer
    const grade = await gradeAnswer(q.text, q.reference, combinedAnswer);
    totalTokens += qTokens + grade.graderTokens;
    totalConsultations += consultations;

    console.log(
      `    Score: ${grade.score}/10 | Tokens: ${qTokens} | Consultations: ${consultations}`
    );

    results.push({
      questionId: q.id,
      primaryDomain: q.primaryDomain,
      agentsUsed: agentOrder.slice(0, consultations),
      channels: agentOrder
        .slice(0, consultations)
        .map((aid) => CHANNEL_MAP[q.id][aid]),
      score: grade.score,
      reason: grade.reason,
      tokens: qTokens,
      consultations,
      answer: combinedAnswer.substring(0, 500), // truncate for JSON
    });
  }

  const avgScore =
    results.reduce((s, r) => s + r.score, 0) / results.length;
  const avgConsultations = totalConsultations / QUESTIONS.length;
  const corruptionRate =
    totalWords > 0 ? totalCorruptedWords / totalWords : 0;

  const summary = {
    condition: conditionName,
    avgScore: Math.round(avgScore * 100) / 100,
    totalTokens,
    avgConsultations: Math.round(avgConsultations * 100) / 100,
    corruptionRate: Math.round(corruptionRate * 1000) / 1000,
    perQuestion: results,
  };

  console.log(`\n  >>> ${conditionName} Summary:`);
  console.log(`      Avg Score: ${summary.avgScore}`);
  console.log(`      Total Tokens: ${summary.totalTokens}`);
  console.log(`      Avg Consultations: ${summary.avgConsultations}`);
  console.log(`      Corruption Rate: ${(summary.corruptionRate * 100).toFixed(1)}%`);

  return summary;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("KI-4 v2: Adaptive Task Scheduling — Redesigned Experiment");
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Questions: ${QUESTIONS.length}`);
  console.log(`Agents: ${AGENTS.map((a) => a.name).join(", ")}`);

  // Print channel map summary
  console.log("\nChannel Assignment Summary:");
  console.log("Q# | Primary | Medical | Legal | Finance | Tech");
  console.log("---|---------|---------|-------|---------|-----");
  for (const q of QUESTIONS) {
    const m = CHANNEL_MAP[q.id];
    const primaryBad = m[q.primaryDomain] === "bad" ? " <<<" : "";
    console.log(
      `${String(q.id).padStart(2)} | ${q.primaryDomain.padEnd(7)} | ${m.medical.padEnd(7)} | ${m.legal.padEnd(5)} | ${m.finance.padEnd(7)} | ${m.tech}${primaryBad}`
    );
  }

  const allResults = {};

  // Condition 1: Fixed Order
  allResults.fixedOrder = await runCondition("Fixed Order", selectAgents_FixedOrder);

  // Condition 2: Expertise Only
  allResults.expertiseOnly = await runCondition("Expertise Only", selectAgents_ExpertiseOnly);

  // Condition 3: Channel Only
  allResults.channelOnly = await runCondition("Channel Only", selectAgents_ChannelOnly);

  // Condition 4: Joint
  allResults.joint = await runCondition("Joint", selectAgents_Joint);

  // Condition 5: Joint + Early Stop
  allResults.jointEarlyStop = await runCondition(
    "Joint + Early Stop",
    selectAgents_Joint,
    true
  );

  // ─── Final Report ──────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(70));
  console.log("FINAL RESULTS COMPARISON");
  console.log("=".repeat(70));
  console.log(
    "Condition           | Avg Score | Total Tokens | Avg Consults | Corruption"
  );
  console.log(
    "--------------------|-----------|--------------|--------------|----------"
  );
  for (const key of [
    "fixedOrder",
    "expertiseOnly",
    "channelOnly",
    "joint",
    "jointEarlyStop",
  ]) {
    const r = allResults[key];
    console.log(
      `${r.condition.padEnd(20)}| ${String(r.avgScore).padEnd(10)}| ${String(r.totalTokens).padEnd(13)}| ${String(r.avgConsultations).padEnd(13)}| ${(r.corruptionRate * 100).toFixed(1)}%`
    );
  }

  // Per-question comparison
  console.log("\nPer-Question Score Comparison:");
  console.log(
    "Q#  | Primary  | Fixed | Expert | Channel | Joint | Joint+ES"
  );
  console.log(
    "----|----------|-------|--------|---------|-------|--------"
  );
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const scores = [
      "fixedOrder",
      "expertiseOnly",
      "channelOnly",
      "joint",
      "jointEarlyStop",
    ].map((key) => {
      const pq = allResults[key].perQuestion.find(
        (r) => r.questionId === q.id
      );
      return pq ? String(pq.score).padEnd(7) : "N/A    ";
    });
    console.log(
      `${String(q.id).padStart(3)} | ${q.primaryDomain.padEnd(8)} | ${scores.join("| ")}`
    );
  }

  // Channel map for questions where primary expert has bad channel
  console.log("\nQuestions where primary expert has BAD channel:");
  for (const q of QUESTIONS) {
    if (CHANNEL_MAP[q.id][q.primaryDomain] === "bad") {
      console.log(
        `  Q${q.id} (${q.primaryDomain}): Joint agents = ${selectAgents_Joint(q).join(", ")}`
      );
    }
  }

  // Save JSON
  const output = {
    experiment: "KI-4 v2: Adaptive Task Scheduling",
    date: new Date().toISOString(),
    config: {
      agents: AGENTS.map((a) => ({ id: a.id, name: a.name })),
      channels: CHANNELS,
      numQuestions: QUESTIONS.length,
      consultationsPerCondition: 3,
    },
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      text: q.text,
      primaryDomain: q.primaryDomain,
      secondaryDomain: q.secondaryDomain,
      reference: q.reference,
      channels: CHANNEL_MAP[q.id],
    })),
    conditions: allResults,
    summary: Object.entries(allResults).map(([key, r]) => ({
      key,
      condition: r.condition,
      avgScore: r.avgScore,
      totalTokens: r.totalTokens,
      avgConsultations: r.avgConsultations,
      corruptionRate: r.corruptionRate,
    })),
  };

  const fs = await import("fs");
  fs.writeFileSync(
    "C:/Users/hyunj/wcisl/scripts/ki4_v2_results.json",
    JSON.stringify(output, null, 2)
  );
  console.log("\nResults saved to C:/Users/hyunj/wcisl/scripts/ki4_v2_results.json");
}

main().catch(console.error);
