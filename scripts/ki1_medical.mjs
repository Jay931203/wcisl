/**
 * KI-1 Mutual Cognitive Context Inference — Medical Domain
 *
 * Agent A (GPT-4o): Diagnosis specialist — analyzes symptoms, produces diagnosis
 * Agent B (GPT-4o-mini): Prescription specialist — given diagnosis, determines drug + dosage
 *
 * 4 conditions: No Context, One-Way, Mutual, Progressive (3 rounds)
 * 15 diverse medical cases covering infections, cardiovascular, respiratory, GI, endocrine, neurological, etc.
 */

import OpenAI from "openai";
import fs from "fs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error("Set OPENAI_API_KEY env var"); process.exit(1); }

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ── Pricing ──
const PRICING = {
  "gpt-4o": { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
};

// ── 15 Medical Cases ──
const CASES = [
  {
    id: 1,
    input: "45세 남성, 70kg. 증상: 심한 두통, 발열 38.5도, 목 경직, 빛 과민. 페니실린 알레르기.",
    ground_truth: { diagnosis: "bacterial meningitis", drug: "ceftriaxone", dosage: "2g IV q12h" },
  },
  {
    id: 2,
    input: "30세 여성, 55kg. 증상: 빈뇨, 배뇨통, 하복부 통증, 혈뇨. 알레르기 없음.",
    ground_truth: { diagnosis: "UTI", drug: "ciprofloxacin", dosage: "500mg PO bid x3days" },
  },
  {
    id: 3,
    input: "60세 남성, 85kg. 증상: 흉통(좌측 방사), 호흡곤란, 발한, 오심. 아스피린 알레르기 없음. 고혈압 병력.",
    ground_truth: { diagnosis: "acute myocardial infarction", drug: "aspirin", dosage: "325mg PO stat" },
  },
  {
    id: 4,
    input: "25세 여성, 50kg. 증상: 인후통, 발열 39도, 편도 비대 및 삼출물, 경부 림프절 종대. 알레르기 없음.",
    ground_truth: { diagnosis: "streptococcal pharyngitis", drug: "amoxicillin", dosage: "500mg PO tid x10days" },
  },
  {
    id: 5,
    input: "55세 남성, 90kg. 증상: 다뇨, 다음, 다식, 체중감소, 피로. 공복혈당 250mg/dL. 알레르기 없음.",
    ground_truth: { diagnosis: "type 2 diabetes", drug: "metformin", dosage: "500mg PO bid" },
  },
  {
    id: 6,
    input: "70세 여성, 60kg. 증상: 갑작스러운 우측 편마비, 언어장애(실어증), 안면 비대칭. 증상 발생 2시간 전. 알레르기 없음.",
    ground_truth: { diagnosis: "ischemic stroke", drug: "alteplase", dosage: "0.9mg/kg IV (max 90mg)" },
  },
  {
    id: 7,
    input: "35세 남성, 75kg. 증상: 심와부 통증(식후 악화), 속쓰림, 오심, 흑색변. H. pylori 양성. 설파 알레르기.",
    ground_truth: { diagnosis: "peptic ulcer", drug: "omeprazole", dosage: "20mg PO bid" },
  },
  {
    id: 8,
    input: "40세 여성, 65kg. 증상: 기침(3주 지속), 객혈, 야간 발한, 체중감소, 미열. 결핵 접촉력 있음. 알레르기 없음.",
    ground_truth: { diagnosis: "pulmonary tuberculosis", drug: "isoniazid", dosage: "300mg PO daily" },
  },
  {
    id: 9,
    input: "50세 여성, 70kg. 증상: 체중증가, 한불내증(추위 못 참음), 변비, 피로, 건조한 피부, 서맥. TSH 상승. 알레르기 없음.",
    ground_truth: { diagnosis: "hypothyroidism", drug: "levothyroxine", dosage: "50mcg PO daily" },
  },
  {
    id: 10,
    input: "28세 남성, 80kg. 증상: 천명음, 호흡곤란(운동 시 악화), 야간 기침, 흉부 압박감. 알레르기 없음.",
    ground_truth: { diagnosis: "asthma", drug: "albuterol", dosage: "2 puffs PRN q4-6h" },
  },
  {
    id: 11,
    input: "65세 남성, 78kg. 증상: 발목/하지 부종, 호흡곤란(특히 누울 때), 피로, 야간 호흡곤란. ACE inhibitor 알레르기(혈관부종).",
    ground_truth: { diagnosis: "congestive heart failure", drug: "losartan", dosage: "50mg PO daily" },
  },
  {
    id: 12,
    input: "22세 여성, 52kg. 증상: 우하복부 통증(이동통), 오심, 구토, 발열 37.8도, 반발압통. 알레르기 없음.",
    ground_truth: { diagnosis: "acute appendicitis", drug: "cefazolin", dosage: "2g IV preop" },
  },
  {
    id: 13,
    input: "58세 남성, 95kg. 증상: 우측 엄지발가락 극심한 통증, 발적, 부종, 열감. 갑작스러운 야간 발병. NSAID 알레르기(위출혈 병력).",
    ground_truth: { diagnosis: "gout", drug: "colchicine", dosage: "1.2mg PO then 0.6mg 1h later" },
  },
  {
    id: 14,
    input: "38세 여성, 58kg. 증상: 심한 편측 두통(박동성), 오심, 구토, 빛/소리 과민, 전조증상(시각). 알레르기 없음.",
    ground_truth: { diagnosis: "migraine", drug: "sumatriptan", dosage: "50mg PO stat" },
  },
  {
    id: 15,
    input: "72세 남성, 68kg. 증상: 기침(화농성 객담), 발열 39.2도, 호흡곤란, 흉통(흡기시), 오한. 흉부X선: 우하엽 경화. 페니실린 알레르기.",
    ground_truth: { diagnosis: "community-acquired pneumonia", drug: "levofloxacin", dosage: "750mg PO daily" },
  },
];

// ── Helper: Call OpenAI ──
async function callLLM(model, systemPrompt, userPrompt) {
  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const msg = response.choices[0].message.content;
  const usage = response.usage;
  return { text: msg, usage };
}

// ── Grading ──
function gradeCase(caseItem, agentAOutput, agentBOutput) {
  const gt = caseItem.ground_truth;
  const aLower = agentAOutput.toLowerCase();
  const bLower = agentBOutput.toLowerCase();

  // Diagnosis: check if ground truth diagnosis appears in A's output
  const diagnosisAliases = getDiagnosisAliases(gt.diagnosis);
  const diagnosisCorrect = diagnosisAliases.some(alias => aLower.includes(alias.toLowerCase()));

  // Drug: check if ground truth drug name appears in B's output
  const drugAliases = getDrugAliases(gt.drug);
  const drugCorrect = drugAliases.some(alias => bLower.includes(alias.toLowerCase()));

  // Dosage: check if ground truth dosage string (or close variant) appears in B's output
  const dosageVariants = getDosageVariants(gt.dosage);
  const dosageCorrect = dosageVariants.some(v => bLower.includes(v.toLowerCase()));

  // Final score
  let finalScore = 0;
  if (diagnosisCorrect && drugCorrect && dosageCorrect) {
    finalScore = 1.0;
  } else if (diagnosisCorrect && drugCorrect) {
    finalScore = 0.75;
  } else if (diagnosisCorrect) {
    finalScore = 0.5;
  } else {
    finalScore = 0;
  }

  return { diagnosisCorrect, drugCorrect, dosageCorrect, finalScore };
}

function getDiagnosisAliases(diagnosis) {
  const map = {
    "bacterial meningitis": ["bacterial meningitis", "meningitis"],
    "UTI": ["UTI", "urinary tract infection", "cystitis"],
    "acute myocardial infarction": ["myocardial infarction", "acute MI", "STEMI", "NSTEMI", "heart attack", "acute coronary"],
    "streptococcal pharyngitis": ["streptococcal pharyngitis", "strep pharyngitis", "strep throat", "GAS pharyngitis"],
    "type 2 diabetes": ["type 2 diabetes", "diabetes mellitus type 2", "T2DM", "type II diabetes", "diabetes mellitus"],
    "ischemic stroke": ["ischemic stroke", "cerebral infarction", "acute stroke", "CVA"],
    "peptic ulcer": ["peptic ulcer", "gastric ulcer", "duodenal ulcer", "PUD"],
    "pulmonary tuberculosis": ["pulmonary tuberculosis", "tuberculosis", "pulmonary TB", "TB"],
    "hypothyroidism": ["hypothyroidism", "underactive thyroid"],
    "asthma": ["asthma", "bronchial asthma"],
    "congestive heart failure": ["congestive heart failure", "heart failure", "CHF", "HFrEF", "HFpEF"],
    "acute appendicitis": ["acute appendicitis", "appendicitis"],
    "gout": ["gout", "gouty arthritis", "acute gout"],
    "migraine": ["migraine", "migraine with aura"],
    "community-acquired pneumonia": ["community-acquired pneumonia", "pneumonia", "CAP"],
  };
  return map[diagnosis] || [diagnosis];
}

function getDrugAliases(drug) {
  const map = {
    "ceftriaxone": ["ceftriaxone", "rocephin"],
    "ciprofloxacin": ["ciprofloxacin", "cipro"],
    "aspirin": ["aspirin", "acetylsalicylic acid", "ASA"],
    "amoxicillin": ["amoxicillin", "amoxil"],
    "metformin": ["metformin", "glucophage"],
    "alteplase": ["alteplase", "tPA", "t-PA", "activase"],
    "omeprazole": ["omeprazole", "prilosec"],
    "isoniazid": ["isoniazid", "INH"],
    "levothyroxine": ["levothyroxine", "synthroid", "L-thyroxine"],
    "albuterol": ["albuterol", "salbutamol", "ventolin", "proventil"],
    "losartan": ["losartan", "cozaar"],
    "cefazolin": ["cefazolin", "ancef", "kefzol"],
    "colchicine": ["colchicine", "colcrys"],
    "sumatriptan": ["sumatriptan", "imitrex"],
    "levofloxacin": ["levofloxacin", "levaquin"],
  };
  return map[drug] || [drug];
}

function getDosageVariants(dosage) {
  // Generate reasonable variants of the dosage string
  const variants = [dosage];
  // strip spaces around slashes, units, etc.
  variants.push(dosage.replace(/\s+/g, ""));
  // common reformulations
  if (dosage.includes("PO bid")) {
    variants.push(dosage.replace("PO bid", "orally twice daily"));
    variants.push(dosage.replace("PO bid", "twice daily"));
    variants.push(dosage.replace("PO bid", "BID"));
  }
  if (dosage.includes("PO tid")) {
    variants.push(dosage.replace("PO tid", "orally three times daily"));
    variants.push(dosage.replace("PO tid", "three times daily"));
    variants.push(dosage.replace("PO tid", "TID"));
    variants.push(dosage.replace("PO tid", "three times a day"));
  }
  if (dosage.includes("PO daily")) {
    variants.push(dosage.replace("PO daily", "orally once daily"));
    variants.push(dosage.replace("PO daily", "once daily"));
    variants.push(dosage.replace("PO daily", "daily"));
    variants.push(dosage.replace("PO daily", "orally daily"));
  }
  if (dosage.includes("PO stat")) {
    variants.push(dosage.replace("PO stat", "orally"));
    variants.push(dosage.replace("PO stat", "oral"));
  }
  if (dosage.includes("IV q12h")) {
    variants.push(dosage.replace("IV q12h", "IV every 12 hours"));
    variants.push(dosage.replace("IV q12h", "intravenous every 12 hours"));
    variants.push(dosage.replace("IV q12h", "IV every 12h"));
  }
  if (dosage.includes("IV preop")) {
    variants.push(dosage.replace("IV preop", "IV preoperative"));
    variants.push(dosage.replace("IV preop", "IV before surgery"));
    variants.push(dosage.replace("IV preop", "IV pre-op"));
  }
  // Extract the core number + unit for a loose check (e.g., "500mg", "2g", "50mcg")
  const numUnit = dosage.match(/^[\d.]+\s*(?:mg|g|mcg|puffs)/i);
  if (numUnit) {
    variants.push(numUnit[0]);
    variants.push(numUnit[0].replace(/\s+/g, ""));
  }
  // For dosages with PRN
  if (dosage.includes("PRN")) {
    variants.push(dosage.replace("PRN", "as needed"));
  }
  // colchicine special
  if (dosage.includes("1.2mg")) {
    variants.push("1.2 mg");
    variants.push("1.2mg");
  }
  // alteplase special
  if (dosage.includes("0.9mg/kg")) {
    variants.push("0.9 mg/kg");
    variants.push("0.9mg/kg");
  }
  return variants;
}

// ── Token & Cost tracking ──
function computeCost(model, usage) {
  const p = PRICING[model];
  return (usage.prompt_tokens * p.input) + (usage.completion_tokens * p.output);
}

// ── Run a single case through A→B pipeline ──
async function runCase(caseItem, sysA, sysB) {
  // Agent A: Diagnosis
  const aResult = await callLLM("gpt-4o", sysA, `Patient information:\n${caseItem.input}\n\nProvide your diagnosis.`);
  // Agent B: Prescription
  const bResult = await callLLM("gpt-4o-mini", sysB, `Diagnosis from specialist:\n${aResult.text}\n\nPatient info: ${caseItem.input}\n\nRecommend the appropriate drug, dosage, and precautions.`);

  const grade = gradeCase(caseItem, aResult.text, bResult.text);

  return {
    caseId: caseItem.id,
    agentA: { text: aResult.text, usage: aResult.usage },
    agentB: { text: bResult.text, usage: bResult.usage },
    grade,
  };
}

// ── Aggregate results for a condition ──
function aggregateResults(results) {
  let totalAInputTokens = 0, totalAOutputTokens = 0;
  let totalBInputTokens = 0, totalBOutputTokens = 0;
  let diagCorrect = 0, drugCorrect = 0, dosageCorrect = 0, fullCorrect = 0;
  let partialCorrect = 0;

  for (const r of results) {
    totalAInputTokens += r.agentA.usage.prompt_tokens;
    totalAOutputTokens += r.agentA.usage.completion_tokens;
    totalBInputTokens += r.agentB.usage.prompt_tokens;
    totalBOutputTokens += r.agentB.usage.completion_tokens;
    if (r.grade.diagnosisCorrect) { diagCorrect++; partialCorrect++; }
    if (r.grade.drugCorrect) drugCorrect++;
    if (r.grade.dosageCorrect) dosageCorrect++;
    if (r.grade.finalScore === 1.0) fullCorrect++;
  }

  const n = results.length;
  const costA = (totalAInputTokens * PRICING["gpt-4o"].input) + (totalAOutputTokens * PRICING["gpt-4o"].output);
  const costB = (totalBInputTokens * PRICING["gpt-4o-mini"].input) + (totalBOutputTokens * PRICING["gpt-4o-mini"].output);
  const totalTokens = totalAInputTokens + totalAOutputTokens + totalBInputTokens + totalBOutputTokens;

  return {
    agentA_output_tokens: totalAOutputTokens,
    agentB_output_tokens: totalBOutputTokens,
    total_tokens: totalTokens,
    cost_A: costA,
    cost_B: costB,
    total_cost: costA + costB,
    diagnosis_accuracy: diagCorrect / n,
    drug_accuracy: drugCorrect / n,
    dosage_accuracy: dosageCorrect / n,
    full_accuracy: fullCorrect / n,
    partial_accuracy: partialCorrect / n,
    n_cases: n,
  };
}

// ══════════════════════════════════════════════
// Condition 1: No Context
// ══════════════════════════════════════════════
async function runNoContext() {
  console.log("\n========== CONDITION 1: NO CONTEXT ==========");
  const sysA = "You are a medical AI. Given patient symptoms, provide a detailed diagnosis with full reasoning. Explain all medical terminology. Always state the final diagnosis clearly in English.";
  const sysB = "You are a medical AI. Given a diagnosis, recommend appropriate treatment. State the drug name (generic name in English) and exact dosage clearly.";

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`  Case ${c.id}...`);
    const r = await runCase(c, sysA, sysB);
    console.log(` diag=${r.grade.diagnosisCorrect} drug=${r.grade.drugCorrect} dosage=${r.grade.dosageCorrect}`);
    results.push(r);
  }
  return { condition: "no_context", results, aggregate: aggregateResults(results) };
}

// ══════════════════════════════════════════════
// Condition 2: One-Way Context
// ══════════════════════════════════════════════
async function runOneWay() {
  console.log("\n========== CONDITION 2: ONE-WAY CONTEXT ==========");
  const sysA = "You are a diagnosis specialist. The recipient is a prescription specialist (pharmacist-level expertise). Be concise — state the diagnosis in English, severity, and any contraindications. Skip explaining basic medical concepts. Mention patient allergies prominently.";
  const sysB = "You are a prescription specialist with deep pharmacological knowledge. Given a diagnosis from a specialist, determine the optimal drug (generic name in English) and exact dosage. Consider patient allergies and contraindications carefully.";

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`  Case ${c.id}...`);
    const r = await runCase(c, sysA, sysB);
    console.log(` diag=${r.grade.diagnosisCorrect} drug=${r.grade.drugCorrect} dosage=${r.grade.dosageCorrect}`);
    results.push(r);
  }
  return { condition: "one_way", results, aggregate: aggregateResults(results) };
}

// ══════════════════════════════════════════════
// Condition 3: Mutual Context
// ══════════════════════════════════════════════
async function runMutual() {
  console.log("\n========== CONDITION 3: MUTUAL CONTEXT ==========");

  // Step 1: B sends capability summary to A
  const bCapability = await callLLM("gpt-4o-mini",
    "You are a prescription specialist AI. Describe your capabilities concisely: what drug categories you know well, what information you need to make optimal prescriptions, and what constraints you handle (allergies, interactions, etc.).",
    "Describe your capabilities and what information you need from a diagnosis specialist to give the best prescription."
  );
  console.log("  [B's capability summary obtained]");

  const sysA = `You are a diagnosis specialist. You are communicating with a prescription specialist whose capabilities are:
---
${bCapability.text}
---
Adapt your output for this specialist: state diagnosis clearly in English, emphasize allergy information and contraindications prominently, mention severity and any comorbidities. Be concise — the recipient has pharmacist-level expertise. No need to explain basic medical concepts.`;

  const sysB = `You are a prescription specialist with deep pharmacological knowledge. You are receiving diagnoses from a trusted diagnosis specialist. The specialist is an expert — trust the diagnosis and focus on determining the optimal drug (generic English name) and exact dosage. Pay special attention to allergies and contraindications mentioned. Always state drug name and dosage clearly.`;

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`  Case ${c.id}...`);
    const r = await runCase(c, sysA, sysB);
    console.log(` diag=${r.grade.diagnosisCorrect} drug=${r.grade.drugCorrect} dosage=${r.grade.dosageCorrect}`);
    results.push(r);
  }

  // Add B's capability token cost
  const extraCost = computeCost("gpt-4o-mini", bCapability.usage);
  const agg = aggregateResults(results);
  agg.total_tokens += bCapability.usage.prompt_tokens + bCapability.usage.completion_tokens;
  agg.total_cost += extraCost;
  agg.capability_exchange_tokens = bCapability.usage.prompt_tokens + bCapability.usage.completion_tokens;

  return { condition: "mutual", results, aggregate: agg, bCapabilitySummary: bCapability.text };
}

// ══════════════════════════════════════════════
// Condition 4: Progressive (3 Rounds)
// ══════════════════════════════════════════════
async function runProgressive() {
  console.log("\n========== CONDITION 4: PROGRESSIVE (3 ROUNDS) ==========");

  const allRounds = [];

  // Round 1 = No Context
  console.log("\n  --- Round 1 (No Context baseline) ---");
  const sysA_r1 = "You are a medical AI. Given patient symptoms, provide a detailed diagnosis with full reasoning. Explain all medical terminology. Always state the final diagnosis clearly in English.";
  const sysB_r1 = "You are a medical AI. Given a diagnosis, recommend appropriate treatment. State the drug name (generic name in English) and exact dosage clearly.";

  let round1Results = [];
  for (const c of CASES) {
    process.stdout.write(`    Case ${c.id}...`);
    const r = await runCase(c, sysA_r1, sysB_r1);
    console.log(` diag=${r.grade.diagnosisCorrect} drug=${r.grade.drugCorrect} dosage=${r.grade.dosageCorrect}`);
    round1Results.push(r);
  }
  allRounds.push({ round: 1, results: round1Results, aggregate: aggregateResults(round1Results) });

  // Round 2: Agents analyze Round 1 responses and infer partner's expertise
  console.log("\n  --- Round 2 (Adapted after Round 1 analysis) ---");

  // A analyzes B's round 1 responses
  const bR1Samples = round1Results.slice(0, 5).map(r =>
    `Case ${r.caseId}: "${r.agentB.text.substring(0, 200)}..."`
  ).join("\n\n");

  const aInferB = await callLLM("gpt-4o",
    "You are analyzing your communication partner's responses to infer their expertise and communication style.",
    `Here are 5 sample responses from your partner (a prescription AI):\n\n${bR1Samples}\n\nBriefly summarize: What is their expertise level? What do they handle well? What information do they seem to need most?`
  );

  // B analyzes A's round 1 responses
  const aR1Samples = round1Results.slice(0, 5).map(r =>
    `Case ${r.caseId}: "${r.agentA.text.substring(0, 200)}..."`
  ).join("\n\n");

  const bInferA = await callLLM("gpt-4o-mini",
    "You are analyzing your communication partner's responses to infer their expertise and communication style.",
    `Here are 5 sample responses from your partner (a diagnosis AI):\n\n${aR1Samples}\n\nBriefly summarize: What is their expertise level? What is their communication style? How reliable are their diagnoses?`
  );

  const sysA_r2 = `You are a diagnosis specialist. Based on analysis of your partner's previous responses, here is what you know about the prescription specialist you are communicating with:
---
${aInferB.text}
---
Adapt your diagnosis output accordingly: be concise, emphasize the information they need most, state diagnosis in English, highlight allergies and contraindications. Skip unnecessary explanations.`;

  const sysB_r2 = `You are a prescription specialist. Based on analysis of your partner's previous responses, here is what you know about the diagnosis specialist:
---
${bInferA.text}
---
Trust the diagnosis. Focus on optimal drug selection (generic English name) and precise dosage. The specialist is reliable. Pay careful attention to any allergies or contraindications mentioned.`;

  let round2Results = [];
  for (const c of CASES) {
    process.stdout.write(`    Case ${c.id}...`);
    const r = await runCase(c, sysA_r2, sysB_r2);
    console.log(` diag=${r.grade.diagnosisCorrect} drug=${r.grade.drugCorrect} dosage=${r.grade.dosageCorrect}`);
    round2Results.push(r);
  }

  const r2Agg = aggregateResults(round2Results);
  const r2InferenceCost = computeCost("gpt-4o", aInferB.usage) + computeCost("gpt-4o-mini", bInferA.usage);
  const r2InferenceTokens = aInferB.usage.prompt_tokens + aInferB.usage.completion_tokens + bInferA.usage.prompt_tokens + bInferA.usage.completion_tokens;
  r2Agg.total_cost += r2InferenceCost;
  r2Agg.total_tokens += r2InferenceTokens;
  r2Agg.inference_overhead_tokens = r2InferenceTokens;
  allRounds.push({ round: 2, results: round2Results, aggregate: r2Agg });

  // Round 3: Agents analyze Round 2 responses
  console.log("\n  --- Round 3 (Adapted after Round 2 analysis) ---");

  const bR2Samples = round2Results.slice(0, 5).map(r =>
    `Case ${r.caseId}: "${r.agentB.text.substring(0, 200)}..."`
  ).join("\n\n");

  const aInferB_r3 = await callLLM("gpt-4o",
    "You are analyzing your communication partner's LATEST responses (after they adapted their style). Infer their updated expertise and needs.",
    `Here are 5 latest responses from your prescription specialist partner:\n\n${bR2Samples}\n\nWhat has improved? What information format works best for them? How should you further optimize your communication?`
  );

  const aR2Samples = round2Results.slice(0, 5).map(r =>
    `Case ${r.caseId}: "${r.agentA.text.substring(0, 200)}..."`
  ).join("\n\n");

  const bInferA_r3 = await callLLM("gpt-4o-mini",
    "You are analyzing your communication partner's LATEST responses (after they adapted their style). Infer their updated expertise and needs.",
    `Here are 5 latest responses from your diagnosis specialist partner:\n\n${aR2Samples}\n\nWhat has improved? How reliable are they? How should you adapt your processing?`
  );

  const sysA_r3 = `You are a diagnosis specialist in an optimized communication pipeline. After two rounds of interaction, here is your refined understanding of your prescription specialist partner:
---
Previous understanding: ${aInferB.text}
Updated understanding: ${aInferB_r3.text}
---
Provide maximally efficient diagnosis output: English diagnosis name, severity grade, key contraindications/allergies, and only clinically relevant details the prescription specialist needs. Be extremely concise.`;

  const sysB_r3 = `You are a prescription specialist in an optimized communication pipeline. After two rounds of interaction, here is your refined understanding of your diagnosis specialist partner:
---
Previous understanding: ${bInferA.text}
Updated understanding: ${bInferA_r3.text}
---
The diagnosis specialist is highly reliable and gives concise, actionable diagnoses. Respond with: drug (generic English name), exact dosage, route, duration, and key precautions. Be precise and efficient.`;

  let round3Results = [];
  for (const c of CASES) {
    process.stdout.write(`    Case ${c.id}...`);
    const r = await runCase(c, sysA_r3, sysB_r3);
    console.log(` diag=${r.grade.diagnosisCorrect} drug=${r.grade.drugCorrect} dosage=${r.grade.dosageCorrect}`);
    round3Results.push(r);
  }

  const r3Agg = aggregateResults(round3Results);
  const r3InferenceCost = computeCost("gpt-4o", aInferB_r3.usage) + computeCost("gpt-4o-mini", bInferA_r3.usage);
  const r3InferenceTokens = aInferB_r3.usage.prompt_tokens + aInferB_r3.usage.completion_tokens + bInferA_r3.usage.prompt_tokens + bInferA_r3.usage.completion_tokens;
  r3Agg.total_cost += r3InferenceCost;
  r3Agg.total_tokens += r3InferenceTokens;
  r3Agg.inference_overhead_tokens = r3InferenceTokens;
  allRounds.push({ round: 3, results: round3Results, aggregate: r3Agg });

  return { condition: "progressive", rounds: allRounds };
}

// ══════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════
async function main() {
  console.log("KI-1 Mutual Cognitive Context Inference — Medical Domain");
  console.log("=" .repeat(60));
  console.log(`Cases: ${CASES.length}`);
  console.log(`Agent A: GPT-4o (Diagnosis)`);
  console.log(`Agent B: GPT-4o-mini (Prescription)`);
  console.log(`Temperature: 0`);
  console.log();

  const startTime = Date.now();

  const cond1 = await runNoContext();
  const cond2 = await runOneWay();
  const cond3 = await runMutual();
  const cond4 = await runProgressive();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Summary ──
  console.log("\n\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));

  const summaryTable = [
    { condition: "No Context", ...cond1.aggregate },
    { condition: "One-Way", ...cond2.aggregate },
    { condition: "Mutual", ...cond3.aggregate },
  ];

  // Add progressive rounds
  for (const round of cond4.rounds) {
    summaryTable.push({ condition: `Progressive R${round.round}`, ...round.aggregate });
  }

  console.log("\n┌─────────────────────┬──────────┬──────────┬──────────┬──────────┬────────────┬────────────┐");
  console.log("│ Condition           │ Full Acc │ Diag Acc │ Drug Acc │ Dose Acc │ A Out Toks │ Total Cost │");
  console.log("├─────────────────────┼──────────┼──────────┼──────────┼──────────┼────────────┼────────────┤");

  for (const row of summaryTable) {
    const cond = row.condition.padEnd(19);
    const full = (row.full_accuracy * 100).toFixed(1).padStart(6) + "%";
    const diag = (row.diagnosis_accuracy * 100).toFixed(1).padStart(6) + "%";
    const drug = (row.drug_accuracy * 100).toFixed(1).padStart(6) + "%";
    const dose = (row.dosage_accuracy * 100).toFixed(1).padStart(6) + "%";
    const aTok = String(row.agentA_output_tokens).padStart(10);
    const cost = ("$" + row.total_cost.toFixed(4)).padStart(10);
    console.log(`│ ${cond} │ ${full} │ ${diag} │ ${drug} │ ${dose} │ ${aTok} │ ${cost} │`);
  }
  console.log("└─────────────────────┴──────────┴──────────┴──────────┴──────────┴────────────┴────────────┘");

  // Token efficiency
  console.log("\n── Token Efficiency ──");
  const noCtxToks = cond1.aggregate.agentA_output_tokens;
  for (const row of summaryTable) {
    if (row.condition === "No Context") continue;
    const reduction = ((1 - row.agentA_output_tokens / noCtxToks) * 100).toFixed(1);
    console.log(`  ${row.condition}: Agent A output tokens ${reduction}% ${reduction > 0 ? "reduction" : "increase"} vs No Context`);
  }

  // Progressive round-over-round
  console.log("\n── Progressive Round-over-Round ──");
  for (let i = 1; i < cond4.rounds.length; i++) {
    const prev = cond4.rounds[i - 1].aggregate;
    const curr = cond4.rounds[i].aggregate;
    const accDelta = ((curr.full_accuracy - prev.full_accuracy) * 100).toFixed(1);
    const tokDelta = ((1 - curr.agentA_output_tokens / prev.agentA_output_tokens) * 100).toFixed(1);
    console.log(`  Round ${i} → ${i + 1}: accuracy ${accDelta >= 0 ? "+" : ""}${accDelta}pp, A output tokens ${tokDelta}% reduction`);
  }

  console.log(`\nTotal elapsed: ${elapsed}s`);

  // ── Save JSON ──
  const output = {
    experiment: "KI-1 Mutual Cognitive Context Inference — Medical Domain",
    timestamp: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    n_cases: CASES.length,
    cases: CASES.map(c => ({ id: c.id, input: c.input, ground_truth: c.ground_truth })),
    conditions: {
      no_context: {
        aggregate: cond1.aggregate,
        per_case: cond1.results.map(r => ({
          caseId: r.caseId,
          grade: r.grade,
          agentA_output: r.agentA.text,
          agentB_output: r.agentB.text,
          agentA_tokens: r.agentA.usage,
          agentB_tokens: r.agentB.usage,
        })),
      },
      one_way: {
        aggregate: cond2.aggregate,
        per_case: cond2.results.map(r => ({
          caseId: r.caseId,
          grade: r.grade,
          agentA_output: r.agentA.text,
          agentB_output: r.agentB.text,
          agentA_tokens: r.agentA.usage,
          agentB_tokens: r.agentB.usage,
        })),
      },
      mutual: {
        aggregate: cond3.aggregate,
        bCapabilitySummary: cond3.bCapabilitySummary,
        per_case: cond3.results.map(r => ({
          caseId: r.caseId,
          grade: r.grade,
          agentA_output: r.agentA.text,
          agentB_output: r.agentB.text,
          agentA_tokens: r.agentA.usage,
          agentB_tokens: r.agentB.usage,
        })),
      },
      progressive: {
        rounds: cond4.rounds.map(round => ({
          round: round.round,
          aggregate: round.aggregate,
          per_case: round.results.map(r => ({
            caseId: r.caseId,
            grade: r.grade,
            agentA_output: r.agentA.text,
            agentB_output: r.agentB.text,
            agentA_tokens: r.agentA.usage,
            agentB_tokens: r.agentB.usage,
          })),
        })),
      },
    },
    summary: summaryTable.map(row => ({
      condition: row.condition,
      full_accuracy: row.full_accuracy,
      diagnosis_accuracy: row.diagnosis_accuracy,
      drug_accuracy: row.drug_accuracy,
      dosage_accuracy: row.dosage_accuracy,
      agentA_output_tokens: row.agentA_output_tokens,
      total_tokens: row.total_tokens,
      total_cost: row.total_cost,
    })),
  };

  const outPath = "C:/Users/hyunj/wcisl/scripts/ki1_medical_results.json";
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
