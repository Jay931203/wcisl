// KI-1: Information Filtering Experiment
// Agent A (GPT-4o) receives large data, transmits to Agent B (GPT-4o-mini)
// Tests whether mutual cognition helps A filter the RIGHT data for B

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load API key
const envPath = 'C:/Users/hyunj/studyeng/.env.local';
const envContent = fs.readFileSync(envPath, 'utf-8');
const API_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();

const MODEL_A = 'gpt-4o';
const MODEL_B = 'gpt-4o-mini';

// ─── 15 PROBLEMS ───────────────────────────────────────────────────────────────

const PROBLEMS = [
  // === FINANCIAL ANALYSIS (1-5) ===
  {
    id: 1, domain: 'Financial Analysis', area: 'liquidity metrics',
    data: `Revenue=$5M, COGS=$3M, OpEx=$800K, Interest=$200K, Tax=25%, Depreciation=$300K, AR=$400K, Inventory=$600K, Current_Liabilities=$500K, LongTermDebt=$2M`,
    bTask: `Current Ratio = (AR + Inventory) / Current_Liabilities`,
    bNeeds: `AR, Inventory, Current_Liabilities`,
    answer: 2.0,
    tolerance: 0.1
  },
  {
    id: 2, domain: 'Financial Analysis', area: 'profitability metrics',
    data: `Revenue=$8M, COGS=$4.8M, SGA=$1.2M, RnD=$600K, Interest=$400K, Tax=30%, Total_Assets=$15M, Total_Equity=$9M, Depreciation=$500K, Net_Income=$700K`,
    bTask: `Return on Equity (ROE) = Net_Income / Total_Equity`,
    bNeeds: `Net_Income, Total_Equity`,
    answer: 0.0778,
    tolerance: 0.01
  },
  {
    id: 3, domain: 'Financial Analysis', area: 'inventory efficiency metrics',
    data: `Sales=$10M, Beginning_Inventory=$800K, Purchases=$6M, Ending_Inventory=$1.2M, AR=$1.5M, AP=$900K, Operating_Expenses=$2M, Tax=25%, Depreciation=$400K`,
    bTask: `Inventory Turnover = COGS / Average_Inventory. COGS = Beginning_Inventory + Purchases - Ending_Inventory. Average_Inventory = (Beginning_Inventory + Ending_Inventory) / 2`,
    bNeeds: `Beginning_Inventory, Purchases, Ending_Inventory`,
    answer: 5.6,
    tolerance: 0.1
  },
  {
    id: 4, domain: 'Financial Analysis', area: 'cash flow metrics',
    data: `Net_Income=$1.2M, Depreciation=$300K, Change_AR=-$200K, Change_Inventory=$150K, Change_AP=$100K, CapEx=$500K, Dividends=$200K, NewDebt=$1M, DebtRepayment=$400K, Stock_Buyback=$300K`,
    bTask: `Free Cash Flow = Net_Income + Depreciation - CapEx + Change_in_Working_Capital. Working_Capital_Change = -Change_AR - Change_Inventory + Change_AP = -(-200K) - 150K + 100K = 150K`,
    bNeeds: `Net_Income, Depreciation, CapEx, Change_AR, Change_Inventory, Change_AP`,
    answer: 1150000,
    tolerance: 0.1
  },
  {
    id: 5, domain: 'Financial Analysis', area: 'valuation metrics',
    data: `Price=$50, Shares_Outstanding=2M, Total_Debt=$30M, Cash=$5M, EBITDA=$10M, Net_Income=$4M, Revenue=$40M, Book_Value=$25M, Dividends=$1M, CapEx=$3M`,
    bTask: `EV/EBITDA = (Market_Cap + Total_Debt - Cash) / EBITDA. Market_Cap = Price × Shares_Outstanding`,
    bNeeds: `Price, Shares_Outstanding, Total_Debt, Cash, EBITDA`,
    answer: 12.5,
    tolerance: 0.1
  },

  // === ENGINEERING (6-10) ===
  {
    id: 6, domain: 'Electrical Engineering', area: 'power analysis',
    data: `Voltage=220V, Current=15A, PowerFactor=0.85, Frequency=60Hz, Resistance=10Ω, Inductance=0.05H, Capacitance=100μF, WireLength=50m, WireDiameter=2.5mm, Temperature=25°C`,
    bTask: `Real Power = Voltage × Current × PowerFactor`,
    bNeeds: `Voltage, Current, PowerFactor`,
    answer: 2805,
    tolerance: 0.1
  },
  {
    id: 7, domain: 'Structural Engineering', area: 'beam deflection analysis',
    data: `Beam_Length=6m, Load=5000N (uniformly distributed), Width=0.2m, Height=0.3m, E=200GPa, Density=7800kg/m³, Yield_Strength=250MPa, Poisson=0.3, Safety_Factor=2.0, Support_Type=Simply_Supported`,
    bTask: `Max deflection = (5 × W × L⁴) / (384 × E × I) where I = (Width × Height³) / 12. Use W=5000N total load, L=6m, E=200×10⁹Pa`,
    bNeeds: `Load, Beam_Length, Width, Height, E`,
    answer: 0.000386,
    tolerance: 0.15
  },
  {
    id: 8, domain: 'Fluid Mechanics', area: 'flow characterization',
    data: `Flow_Rate=0.5m³/s, Pipe_Diameter=0.3m, Fluid_Density=1000kg/m³, Viscosity=0.001Pa·s, Pipe_Length=100m, Roughness=0.0015mm, Elevation_Change=10m, Inlet_Pressure=300kPa, Temperature=20°C, Pipe_Material=Steel`,
    bTask: `Reynolds Number = (Fluid_Density × Velocity × Pipe_Diameter) / Viscosity. First compute Velocity = Flow_Rate / (π × (Pipe_Diameter/2)²)`,
    bNeeds: `Flow_Rate, Pipe_Diameter, Fluid_Density, Viscosity`,
    answer: 2121000,
    tolerance: 0.1
  },
  {
    id: 9, domain: 'Automotive Engineering', area: 'aerodynamic force analysis',
    data: `Mass=1500kg, Velocity=30m/s, Drag_Coefficient=0.3, Frontal_Area=2.5m², Air_Density=1.225kg/m³, Rolling_Resistance=0.015, Gravity=9.81m/s², Road_Grade=3%, Wheel_Radius=0.35m, Transmission_Efficiency=0.92`,
    bTask: `Drag Force = 0.5 × Drag_Coefficient × Frontal_Area × Air_Density × Velocity²`,
    bNeeds: `Drag_Coefficient, Frontal_Area, Air_Density, Velocity`,
    answer: 413.4,
    tolerance: 0.1
  },
  {
    id: 10, domain: 'HVAC Engineering', area: 'thermal load analysis',
    data: `Room_Volume=60m³, ACH=6, Outdoor_Temp=35°C, Indoor_Temp=24°C, Humidity=60%, Wall_Area=80m², U_Value=0.5W/(m²·K), Window_Area=15m², Window_U=2.5W/(m²·K), Occupants=4`,
    bTask: `Total heat gain through walls and windows = Wall_Area × U_Value × ΔT + Window_Area × Window_U × ΔT. ΔT = Outdoor_Temp - Indoor_Temp`,
    bNeeds: `Wall_Area, U_Value, Window_Area, Window_U, Outdoor_Temp, Indoor_Temp`,
    answer: 852.5,
    tolerance: 0.1
  },

  // === STATISTICS / OPERATIONS (11-15) ===
  {
    id: 11, domain: 'Statistics', area: 'confidence interval estimation',
    data: `Sample_Mean=52.3, Sample_Std=8.5, Sample_Size=100, Population_Mean=50, Confidence=95%, Z_critical=1.96, Alpha=0.05, Skewness=0.3, Kurtosis=2.8, Median=51.5`,
    bTask: `95% Confidence Interval lower bound = Sample_Mean - Z_critical × (Sample_Std / √Sample_Size). Report ONLY the lower bound.`,
    bNeeds: `Sample_Mean, Sample_Std, Sample_Size, Z_critical`,
    answer: 50.63,
    tolerance: 0.1
  },
  {
    id: 12, domain: 'Supply Chain', area: 'inventory safety stock calculation',
    data: `Demand_Mean=500/week, Demand_Std=80/week, Lead_Time=2weeks, Lead_Time_Std=0.5weeks, Holding_Cost=$3/unit/week, Shortage_Cost=$25/unit, Order_Cost=$100, Service_Level=95% (Z=1.645), Unit_Cost=$20, Annual_Demand=26000`,
    bTask: `Safety Stock = Z × √(Lead_Time × Demand_Std² + Demand_Mean² × Lead_Time_Std²). Z=1.645 for 95% service level.`,
    bNeeds: `Demand_Mean, Demand_Std, Lead_Time, Lead_Time_Std, Z (service level)`,
    answer: 451.4,
    tolerance: 0.1
  },
  {
    id: 13, domain: 'Queueing Theory', area: 'queue utilization analysis',
    data: `Arrival_Rate=30/hour, Service_Rate=10/hour, Servers=4, Queue_Capacity=∞, Priority_Levels=3, Avg_Wait_Target=5min, Setup_Time=0, Service_Distribution=Exponential, Arrival_Distribution=Poisson, Operating_Hours=10`,
    bTask: `Traffic Intensity ρ = Arrival_Rate / (Servers × Service_Rate)`,
    bNeeds: `Arrival_Rate, Servers, Service_Rate`,
    answer: 0.75,
    tolerance: 0.1
  },
  {
    id: 14, domain: 'Operations Research', area: 'project selection optimization',
    data: `Projects: A($50K cost, $80K return, 2yr), B($30K cost, $55K return, 1yr), C($70K cost, $120K return, 3yr), D($20K cost, $35K return, 1yr), E($45K cost, $75K return, 2yr). Budget=$100K, Min_Return=40%, Max_Projects=3, Discount_Rate=8%, Risk_Tolerance=Medium`,
    bTask: `Find the combination of projects (max 3) within $100K budget that maximizes total PROFIT (return - cost). Report the maximum total profit.`,
    bNeeds: `All project costs and returns, Budget constraint`,
    answer: 70000,
    tolerance: 0.1
  },
  {
    id: 15, domain: 'Manufacturing', area: 'production cost optimization',
    data: `Machine_A=(Production:100/hr, Defect:2%, Setup:30min, Cost:$50/hr), Machine_B=(80/hr, Defect:1%, Setup:45min, Cost:$65/hr), Machine_C=(120/hr, Defect:3%, Setup:20min, Cost:$45/hr). Order=10000units, Deadline=100hrs, Quality_Req=<2% defect rate, Penalty=$10/defective_unit, Setup_changes=2`,
    bTask: `Find the total cost (production + penalty) for the cheapest machine that meets quality requirement (<2% defect) AND deadline (100hrs). Only machines with defect rate < 2% qualify. Production time = Order/Production_rate. Total cost = production_time × hourly_cost + Order × defect_rate × penalty.`,
    bNeeds: `All machine specs, Order size, Deadline, Quality_Req, Penalty`,
    answer: 7000,
    tolerance: 0.1
  }
];

// ─── API CALL ──────────────────────────────────────────────────────────────────

async function callGPT(model, systemPrompt, userMessage, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ]
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API ${res.status}: ${errText}`);
      }
      const json = await res.json();
      return json.choices[0].message.content.trim();
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

// ─── EXTRACT NUMERIC ───────────────────────────────────────────────────────────

function extractNumber(text) {
  if (!text) return NaN;
  // Try to find numbers, handling commas, negatives, scientific notation
  const cleaned = text.replace(/,/g, '').replace(/\$/g, '').replace(/%/g, '');
  // Find all numbers in the text
  const matches = cleaned.match(/-?\d+\.?\d*(?:e[+-]?\d+)?/gi);
  if (!matches) return NaN;
  // Return the last number (usually the final answer)
  return parseFloat(matches[matches.length - 1]);
}

function gradeAnswer(extracted, expected, tolerance) {
  if (isNaN(extracted)) return false;
  if (expected === 0) return Math.abs(extracted) < 0.01;
  const relError = Math.abs(extracted - expected) / Math.abs(expected);
  return relError <= tolerance;
}

// ─── CONDITION RUNNERS ─────────────────────────────────────────────────────────

// Condition 1: No Context — A gives a GENERAL balanced summary
async function runNoContext(prob) {
  const aSys = `You are a data analyst. You receive raw data about a system. Summarize the key findings in a general overview. Cover the most important metrics. Do NOT assume what the recipient needs — give a balanced summary. Keep it concise but cover the highlights.`;
  const aUser = `Here is the raw data for a ${prob.domain} case:\n${prob.data}\n\nProvide a general balanced summary of this data.`;

  const aReply = await callGPT(MODEL_A, aSys, aUser);

  const bSys = `You are a specialist calculator. Using the data summary provided, compute the requested metric. Output ONLY the numeric answer (no units, no explanation).`;
  const bUser = `Data summary from analyst:\n${aReply}\n\nCompute: ${prob.bTask}\n\nOutput ONLY the numeric answer.`;

  const bReply = await callGPT(MODEL_B, bSys, bUser);
  const extracted = extractNumber(bReply);
  const correct = gradeAnswer(extracted, prob.answer, prob.tolerance);

  return { condition: 'no_context', aMessage: aReply, bReply, extracted, expected: prob.answer, correct };
}

// Condition 2: One-Way — A knows B's domain/area but not exact metric
async function runOneWay(prob) {
  const aSys = `You are a data analyst. The recipient is a ${prob.domain} specialist who will compute ${prob.area}. Send the data points most relevant to their analysis. Be precise with numbers. List the exact values they might need.`;
  const aUser = `Here is the raw data:\n${prob.data}\n\nExtract and send the data points most relevant for ${prob.area}.`;

  const aReply = await callGPT(MODEL_A, aSys, aUser);

  const bSys = `You are a ${prob.domain} specialist. Using the data provided, compute the requested metric. Output ONLY the numeric answer (no units, no explanation).`;
  const bUser = `Data from analyst:\n${aReply}\n\nCompute: ${prob.bTask}\n\nOutput ONLY the numeric answer.`;

  const bReply = await callGPT(MODEL_B, bSys, bUser);
  const extracted = extractNumber(bReply);
  const correct = gradeAnswer(extracted, prob.answer, prob.tolerance);

  return { condition: 'one_way', aMessage: aReply, bReply, extracted, expected: prob.answer, correct };
}

// Condition 3: Mutual — B tells A exactly what it needs, A sends precisely those
async function runMutual(prob) {
  // Step 1: B tells A what it needs
  const bRequestSys = `You are a ${prob.domain} specialist. You need to compute a specific metric. Tell the data analyst EXACTLY which data points you need. Be specific about variable names and values needed.`;
  const bRequestUser = `I need to compute: ${prob.bTask}\n\nWhat specific data points do I need from the analyst? List them precisely.`;
  const bRequest = await callGPT(MODEL_B, bRequestSys, bRequestUser);

  // Step 2: A reads B's request and sends exactly those data points
  const aSys = `You are a data analyst. A specialist has requested specific data points. Find and send EXACTLY the requested values from the raw data. Be precise with numbers.`;
  const aUser = `Specialist's request:\n${bRequest}\n\nRaw data:\n${prob.data}\n\nSend exactly the requested data points with their values.`;
  const aReply = await callGPT(MODEL_A, aSys, aUser);

  // Step 3: B computes with A's targeted response
  const bSys = `You are a ${prob.domain} specialist. Using the data provided, compute the requested metric. Output ONLY the numeric answer (no units, no explanation).`;
  const bUser = `Data from analyst (per my request):\n${aReply}\n\nCompute: ${prob.bTask}\n\nOutput ONLY the numeric answer.`;

  const bReply = await callGPT(MODEL_B, bSys, bUser);
  const extracted = extractNumber(bReply);
  const correct = gradeAnswer(extracted, prob.answer, prob.tolerance);

  return { condition: 'mutual', bRequest, aMessage: aReply, bReply, extracted, expected: prob.answer, correct };
}

// Condition 4: Progressive (3 rounds) — starts like no_context, then adapts
async function runProgressive(prob) {
  const rounds = [];

  // Round 1: No Context (same as condition 1)
  const a1Sys = `You are a data analyst. You receive raw data about a system. Summarize the key findings in a general overview. Cover the most important metrics. Do NOT assume what the recipient needs — give a balanced summary.`;
  const a1User = `Here is the raw data for a ${prob.domain} case:\n${prob.data}\n\nProvide a general balanced summary.`;
  const a1Reply = await callGPT(MODEL_A, a1Sys, a1User);

  const b1Sys = `You are a specialist calculator. Using the data summary provided, compute the requested metric. If you cannot compute it due to missing data, state what data is missing and give your best estimate. Output your numeric answer on the last line.`;
  const b1User = `Data summary from analyst:\n${a1Reply}\n\nCompute: ${prob.bTask}\n\nProvide your answer (numeric value on the last line).`;
  const b1Reply = await callGPT(MODEL_B, b1Sys, b1User);
  const ext1 = extractNumber(b1Reply);
  rounds.push({ round: 1, aMessage: a1Reply, bReply: b1Reply, extracted: ext1, correct: gradeAnswer(ext1, prob.answer, prob.tolerance) });

  // Round 2: A sees B's response and adapts
  const a2Sys = `You are a data analyst. You previously sent a general summary but the specialist struggled with their calculation. Based on their response, identify what specific data they actually needed and send a more targeted data package.`;
  const a2User = `Original data:\n${prob.data}\n\nYour previous summary:\n${a1Reply}\n\nSpecialist's response (they were trying to compute ${prob.bTask}):\n${b1Reply}\n\nSend an improved, more targeted data package that addresses what the specialist needs.`;
  const a2Reply = await callGPT(MODEL_A, a2Sys, a2User);

  const b2Sys = `You are a specialist calculator. Using the updated data provided, compute the requested metric. Output ONLY the numeric answer (no units, no explanation).`;
  const b2User = `Updated data from analyst:\n${a2Reply}\n\nCompute: ${prob.bTask}\n\nOutput ONLY the numeric answer.`;
  const b2Reply = await callGPT(MODEL_B, b2Sys, b2User);
  const ext2 = extractNumber(b2Reply);
  rounds.push({ round: 2, aMessage: a2Reply, bReply: b2Reply, extracted: ext2, correct: gradeAnswer(ext2, prob.answer, prob.tolerance) });

  // Round 3: Further refinement
  const a3Sys = `You are a data analyst. The specialist is computing a specific metric and may still need precise values. Based on their latest attempt, send the exact data points needed. List each value explicitly and numerically.`;
  const a3User = `Original data:\n${prob.data}\n\nSpecialist is computing: ${prob.bTask}\n\nTheir latest answer: ${b2Reply}\n\nSend the exact numeric values they need. Be very precise.`;
  const a3Reply = await callGPT(MODEL_A, a3Sys, a3User);

  const b3User = `Refined data from analyst:\n${a3Reply}\n\nCompute: ${prob.bTask}\n\nOutput ONLY the numeric answer.`;
  const b3Reply = await callGPT(MODEL_B, b2Sys, b3User);
  const ext3 = extractNumber(b3Reply);
  rounds.push({ round: 3, aMessage: a3Reply, bReply: b3Reply, extracted: ext3, correct: gradeAnswer(ext3, prob.answer, prob.tolerance) });

  return { condition: 'progressive', rounds, finalExtracted: ext3, expected: prob.answer, finalCorrect: gradeAnswer(ext3, prob.answer, prob.tolerance) };
}

// ─── BATCH EXECUTOR ────────────────────────────────────────────────────────────

async function runBatch(items, batchSize = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return results;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== KI-1: INFORMATION FILTERING EXPERIMENT ===');
  console.log(`Problems: ${PROBLEMS.length} | Conditions: 4 | Models: A=${MODEL_A}, B=${MODEL_B}\n`);

  const allResults = {};
  const startTime = Date.now();

  // --- Condition 1: No Context ---
  console.log('--- Condition 1: No Context ---');
  const nc = await runBatch(PROBLEMS.map(p => () => runNoContext(p)));
  allResults.no_context = nc.map((r, i) => ({ problem_id: PROBLEMS[i].id, ...r }));
  const ncCorrect = nc.filter(r => r.correct).length;
  console.log(`  Accuracy: ${ncCorrect}/${PROBLEMS.length} (${(ncCorrect/PROBLEMS.length*100).toFixed(1)}%)\n`);

  // --- Condition 2: One-Way ---
  console.log('--- Condition 2: One-Way ---');
  const ow = await runBatch(PROBLEMS.map(p => () => runOneWay(p)));
  allResults.one_way = ow.map((r, i) => ({ problem_id: PROBLEMS[i].id, ...r }));
  const owCorrect = ow.filter(r => r.correct).length;
  console.log(`  Accuracy: ${owCorrect}/${PROBLEMS.length} (${(owCorrect/PROBLEMS.length*100).toFixed(1)}%)\n`);

  // --- Condition 3: Mutual ---
  console.log('--- Condition 3: Mutual ---');
  const mt = await runBatch(PROBLEMS.map(p => () => runMutual(p)));
  allResults.mutual = mt.map((r, i) => ({ problem_id: PROBLEMS[i].id, ...r }));
  const mtCorrect = mt.filter(r => r.correct).length;
  console.log(`  Accuracy: ${mtCorrect}/${PROBLEMS.length} (${(mtCorrect/PROBLEMS.length*100).toFixed(1)}%)\n`);

  // --- Condition 4: Progressive ---
  console.log('--- Condition 4: Progressive (3 rounds) ---');
  const pg = await runBatch(PROBLEMS.map(p => () => runProgressive(p)));
  allResults.progressive = pg.map((r, i) => ({ problem_id: PROBLEMS[i].id, ...r }));
  const pgR1 = pg.filter(r => r.rounds[0].correct).length;
  const pgR2 = pg.filter(r => r.rounds[1].correct).length;
  const pgR3 = pg.filter(r => r.rounds[2].correct).length;
  console.log(`  Round 1: ${pgR1}/${PROBLEMS.length} (${(pgR1/PROBLEMS.length*100).toFixed(1)}%)`);
  console.log(`  Round 2: ${pgR2}/${PROBLEMS.length} (${(pgR2/PROBLEMS.length*100).toFixed(1)}%)`);
  console.log(`  Round 3: ${pgR3}/${PROBLEMS.length} (${(pgR3/PROBLEMS.length*100).toFixed(1)}%)\n`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ─── SUMMARY TABLE ─────────────────────────────────────────────────────────

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║        KI-1: INFORMATION FILTERING — SUMMARY TABLE             ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║ Condition        │ Correct │ Total │ Accuracy                   ║`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║ No Context       │  ${String(ncCorrect).padStart(2)}     │  ${PROBLEMS.length}   │  ${(ncCorrect/PROBLEMS.length*100).toFixed(1).padStart(5)}%                      ║`);
  console.log(`║ One-Way          │  ${String(owCorrect).padStart(2)}     │  ${PROBLEMS.length}   │  ${(owCorrect/PROBLEMS.length*100).toFixed(1).padStart(5)}%                      ║`);
  console.log(`║ Mutual           │  ${String(mtCorrect).padStart(2)}     │  ${PROBLEMS.length}   │  ${(mtCorrect/PROBLEMS.length*100).toFixed(1).padStart(5)}%                      ║`);
  console.log(`║ Progressive R1   │  ${String(pgR1).padStart(2)}     │  ${PROBLEMS.length}   │  ${(pgR1/PROBLEMS.length*100).toFixed(1).padStart(5)}%                      ║`);
  console.log(`║ Progressive R2   │  ${String(pgR2).padStart(2)}     │  ${PROBLEMS.length}   │  ${(pgR2/PROBLEMS.length*100).toFixed(1).padStart(5)}%                      ║`);
  console.log(`║ Progressive R3   │  ${String(pgR3).padStart(2)}     │  ${PROBLEMS.length}   │  ${(pgR3/PROBLEMS.length*100).toFixed(1).padStart(5)}%                      ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  // Per-problem breakdown
  console.log('\n--- PER-PROBLEM BREAKDOWN ---');
  console.log('ID | Domain                  | Expected      | NoCtx    | 1-Way    | Mutual   | Prog R3');
  console.log('---|-------------------------|---------------|----------|----------|----------|--------');
  for (let i = 0; i < PROBLEMS.length; i++) {
    const p = PROBLEMS[i];
    const ncR = allResults.no_context[i];
    const owR = allResults.one_way[i];
    const mtR = allResults.mutual[i];
    const pgR = allResults.progressive[i];
    const fmt = (r) => r.correct ? `OK(${r.extracted})` : `X(${r.extracted})`;
    const fmtP = (r) => r.rounds[2].correct ? `OK(${r.rounds[2].extracted})` : `X(${r.rounds[2].extracted})`;
    console.log(`${String(p.id).padStart(2)} | ${p.domain.padEnd(23)} | ${String(p.answer).padEnd(13)} | ${fmt(ncR).padEnd(8)} | ${fmt(owR).padEnd(8)} | ${fmt(mtR).padEnd(8)} | ${fmtP(pgR)}`);
  }

  console.log(`\nTotal time: ${elapsed}s`);

  // ─── SAVE JSON ─────────────────────────────────────────────────────────────

  const output = {
    experiment: 'KI-1 Information Filtering',
    timestamp: new Date().toISOString(),
    models: { agent_a: MODEL_A, agent_b: MODEL_B },
    temperature: 0,
    num_problems: PROBLEMS.length,
    elapsed_seconds: parseFloat(elapsed),
    summary: {
      no_context: { correct: ncCorrect, total: PROBLEMS.length, accuracy: ncCorrect / PROBLEMS.length },
      one_way: { correct: owCorrect, total: PROBLEMS.length, accuracy: owCorrect / PROBLEMS.length },
      mutual: { correct: mtCorrect, total: PROBLEMS.length, accuracy: mtCorrect / PROBLEMS.length },
      progressive_r1: { correct: pgR1, total: PROBLEMS.length, accuracy: pgR1 / PROBLEMS.length },
      progressive_r2: { correct: pgR2, total: PROBLEMS.length, accuracy: pgR2 / PROBLEMS.length },
      progressive_r3: { correct: pgR3, total: PROBLEMS.length, accuracy: pgR3 / PROBLEMS.length }
    },
    problems: PROBLEMS.map(p => ({
      id: p.id, domain: p.domain, area: p.area,
      data: p.data, bTask: p.bTask, bNeeds: p.bNeeds, answer: p.answer
    })),
    detailed_results: allResults
  };

  const outPath = path.join(__dirname, 'ki1_filter_results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
