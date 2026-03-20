/**
 * KI-1 Experiment: Information Filtering with Mutual Cognition
 * Both agents use GPT-4o. 4 conditions: No Context, One-Way, Mutual, Progressive (3 rounds).
 * 15 problems across Financial, Operations, Science/Engineering domains.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read API key from .env.local
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error("Set OPENAI_API_KEY env var"); process.exit(1); }
if (!OPENAI_API_KEY) throw new Error('No OPENAI_API_KEY found');

const MODEL = 'gpt-4o';
const TEMPERATURE = 0;
const TOLERANCE = 0.10; // 10%
const BATCH_SIZE = 5;

// ─── PROBLEMS ───────────────────────────────────────────────────────────────

const PROBLEMS = [
  // Financial (1-5)
  {
    id: 1, domain: 'Financial',
    data: 'Revenue=$10M, COGS=$6M, SGA=$1.5M, RnD=$500K, Interest=$300K, Tax_Rate=25%, Total_Assets=$20M, Equity=$12M, Shares=1M, Dividends=$400K',
    bTask: 'Compute Earnings Per Share (EPS) = Net_Income / Shares_Outstanding. Net_Income = (Revenue - COGS - SGA - RnD - Interest) × (1 - Tax_Rate).',
    bNeeds: 'Net_Income=$1.275M, Shares_Outstanding=1M',
    answer: 1.275,
    categoryHint: 'financial ratio (earnings per share)',
  },
  {
    id: 2, domain: 'Financial',
    data: 'Sales=$8M, AR=$600K, Inventory=$900K, Prepaid=$100K, AP=$400K, Accrued=$200K, Cash=$300K, LongTermDebt=$3M, Equipment=$5M, Depreciation=$500K',
    bTask: 'Compute Current Ratio = Current_Assets / Current_Liabilities. Current_Assets = Cash + AR + Inventory + Prepaid. Current_Liabilities = AP + Accrued.',
    bNeeds: 'Current_Assets=$1.9M (Cash=$300K, AR=$600K, Inventory=$900K, Prepaid=$100K), Current_Liabilities=$600K (AP=$400K, Accrued=$200K)',
    answer: 3.167,
    categoryHint: 'financial ratio (liquidity)',
  },
  {
    id: 3, domain: 'Financial',
    data: 'Units_Sold=50000, Price=$40, Variable_Cost=$25, Fixed_Costs=$500K, Interest=$100K, Tax=30%, Debt=$2M, Equity=$3M, Shares=500K, Retained_Earnings=$800K',
    bTask: 'Compute Profit Margin % = Net_Income / Revenue × 100. Revenue = Units_Sold × Price. Gross_Profit = Revenue - (Units_Sold × Variable_Cost). EBIT = Gross_Profit - Fixed_Costs. EBT = EBIT - Interest. Net_Income = EBT × (1 - Tax).',
    bNeeds: 'Net_Income=$105K, Revenue=$2M',
    answer: 5.25,
    categoryHint: 'financial ratio (profitability)',
  },
  {
    id: 4, domain: 'Financial',
    data: 'Beginning_Cash=$500K, Sales_Receipts=$3M, Cost_Payments=$2M, Salary=$400K, Rent=$120K, Equipment_Purchase=$300K, Loan_Received=$500K, Loan_Repayment=$200K, Tax_Paid=$150K, Dividend=$100K',
    bTask: 'Compute Ending Cash Balance = Beginning_Cash + Total_Inflows - Total_Outflows. Inflows include: Sales_Receipts, Loan_Received. Outflows include: Cost_Payments, Salary, Rent, Equipment_Purchase, Loan_Repayment, Tax_Paid, Dividend.',
    bNeeds: 'Beginning_Cash=$500K, Sales_Receipts=$3M, Cost_Payments=$2M, Salary=$400K, Rent=$120K, Equipment_Purchase=$300K, Loan_Received=$500K, Loan_Repayment=$200K, Tax_Paid=$150K, Dividend=$100K',
    answer: 730000,
    categoryHint: 'cash flow calculation',
  },
  {
    id: 5, domain: 'Financial',
    data: 'Revenue=$5M, Operating_Income=$800K, Net_Income=$500K, Total_Assets=$10M, Total_Equity=$6M, Total_Debt=$4M, Interest=$200K, EBITDA=$1.2M, Market_Cap=$15M, Free_Cash_Flow=$600K',
    bTask: 'Compute Return on Assets (ROA) = Net_Income / Total_Assets.',
    bNeeds: 'Net_Income=$500K, Total_Assets=$10M',
    answer: 0.05,
    categoryHint: 'financial ratio (return on assets)',
  },
  // Operations (6-10)
  {
    id: 6, domain: 'Operations',
    data: 'Daily_Demand_Mean=200, Daily_Demand_Std=40, Lead_Time=5days, Unit_Cost=$15, Holding_Rate=20%/year, Order_Cost=$100, Service_Level=95%, Warehouse_Capacity=5000, Current_Stock=800, Suppliers=3',
    bTask: 'Compute Reorder Point = Mean_Demand × Lead_Time + Safety_Stock. Safety_Stock = 1.645 × Demand_Std × sqrt(Lead_Time).',
    bNeeds: 'Daily_Demand_Mean=200, Daily_Demand_Std=40, Lead_Time=5 days',
    answer: 1147,
    categoryHint: 'inventory management (reorder point)',
  },
  {
    id: 7, domain: 'Operations',
    data: 'Machine_A: 100units/hr at $50/hr with 2% defect rate and 2hr setup. Machine_B: 80units/hr at $40/hr with 1% defect rate and 3hr setup. Machine_C: 120units/hr at $60/hr with 3% defect rate and 1hr setup. Order=10000units, Deadline=100hr.',
    bTask: 'Determine which single machine can produce 10000 units within 100 hours (excluding setup), then compute cost per good unit for that machine. Cost_per_good_unit = (Production_Hours × Hourly_Cost) / (Total_Units × (1 - Defect_Rate)). Machine A: 10000/100=100hr (just meets deadline). Cost = 100×$50 = $5000. Good units = 10000×0.98 = 9800. Cost/good = 5000/9800 = 0.51.',
    bNeeds: 'Machine_A: rate=100units/hr, cost=$50/hr, defect=2%. Deadline=100hr. Order=10000.',
    answer: 0.51,
    categoryHint: 'production cost analysis',
  },
  {
    id: 8, domain: 'Operations',
    data: 'Customers_per_hour=30, Avg_Service_Time=4min, Servers=3, Operating_Hours=10, Hourly_Wage=$20, Overtime_Rate=$30, Max_Wait_Target=5min, Customer_Value=$50, Abandon_Rate=10%, Peak_Multiplier=1.5',
    bTask: 'Compute Server Utilization = Arrival_Rate / (Servers × Service_Rate). Service_Rate = 60 / Avg_Service_Time (customers per hour per server).',
    bNeeds: 'Customers_per_hour=30, Avg_Service_Time=4min, Servers=3',
    answer: 0.667,
    categoryHint: 'queueing theory (utilization)',
  },
  {
    id: 9, domain: 'Operations',
    data: 'Project_Budget=$1M, Planned_Duration=12months, Earned_Value=$600K, Actual_Cost=$700K, Planned_Value=$650K, Team_Size=10, Risk_Reserve=$100K, Overhead=15%, Completion=55%, Milestones_Hit=5/8',
    bTask: 'Compute Cost Performance Index (CPI) = Earned_Value / Actual_Cost.',
    bNeeds: 'Earned_Value=$600K, Actual_Cost=$700K',
    answer: 0.857,
    categoryHint: 'project management (cost performance)',
  },
  {
    id: 10, domain: 'Operations',
    data: 'Annual_Demand=12000, Order_Cost=$75, Holding_Cost=$4/unit/year, Unit_Price=$25, Lead_Time=7days, Working_Days=250, Warehouse_Max=2000, Min_Order=500, Discount_at_1000=5%, Current_Inventory=300',
    bTask: 'Compute Economic Order Quantity (EOQ) = sqrt(2 × Annual_Demand × Order_Cost / Holding_Cost).',
    bNeeds: 'Annual_Demand=12000, Order_Cost=$75, Holding_Cost=$4/unit/year',
    answer: 670.8,
    categoryHint: 'inventory management (EOQ)',
  },
  // Science/Engineering (11-15)
  {
    id: 11, domain: 'Science',
    data: 'Mass=2kg, Velocity=10m/s, Height=5m, Gravity=9.81m/s², Spring_K=500N/m, Friction_Coeff=0.3, Angle=30deg, Air_Density=1.225kg/m³, Cross_Section=0.1m², Drag_Coeff=0.5',
    bTask: 'Compute Kinetic Energy = 0.5 × Mass × Velocity².',
    bNeeds: 'Mass=2kg, Velocity=10m/s',
    answer: 100,
    categoryHint: 'physics energy calculation',
  },
  {
    id: 12, domain: 'Science',
    data: 'Voltage=240V, Resistance=60Ω, Capacitance=100μF, Inductance=0.5H, Frequency=50Hz, Wire_Length=100m, Wire_Diameter=2mm, Temperature=25°C, Power_Factor=0.9, Phase=3',
    bTask: 'Compute Current (Amperes) = Voltage / Resistance.',
    bNeeds: 'Voltage=240V, Resistance=60Ω',
    answer: 4.0,
    categoryHint: 'electrical engineering calculation',
  },
  {
    id: 13, domain: 'Science',
    data: 'Population=100000, Birth_Rate=12/1000, Death_Rate=8/1000, Immigration=500/year, Emigration=200/year, Fertility_Rate=1.8, Life_Expectancy=78, Median_Age=35, Urban_Pct=65%, Growth_Budget=$2M',
    bTask: 'Compute Annual Population Growth = Births - Deaths + Net_Migration. Births = Population × Birth_Rate. Deaths = Population × Death_Rate. Net_Migration = Immigration - Emigration.',
    bNeeds: 'Population=100000, Birth_Rate=12/1000, Death_Rate=8/1000, Immigration=500, Emigration=200',
    answer: 700,
    categoryHint: 'demographics calculation',
  },
  {
    id: 14, domain: 'Science',
    data: 'Tank_Volume=1000L, Inflow_Rate=5L/min, Outflow_Rate=3L/min, Initial_Level=400L, Concentration_In=0.5g/L, Concentration_Current=0.2g/L, Temperature=20°C, Pressure=1atm, Density=1.0kg/L, Viscosity=0.001Pa·s',
    bTask: 'Compute Time to fill tank (minutes) = (Tank_Volume - Initial_Level) / (Inflow_Rate - Outflow_Rate).',
    bNeeds: 'Tank_Volume=1000L, Initial_Level=400L, Inflow_Rate=5L/min, Outflow_Rate=3L/min',
    answer: 300,
    categoryHint: 'fluid dynamics (fill time)',
  },
  {
    id: 15, domain: 'Science',
    data: 'Distance=500km, Speed_A=80km/h, Speed_B=120km/h, Fuel_A=8L/100km, Fuel_B=12L/100km, Fuel_Price=$1.50/L, Toll=$30, Departure_A=8AM, Departure_B=9AM, Rest_Stop=15min',
    bTask: 'Compute Total fuel cost for Vehicle A = Distance × (Fuel_A / 100) × Fuel_Price.',
    bNeeds: 'Distance=500km, Fuel_A=8L/100km, Fuel_Price=$1.50/L',
    answer: 60,
    categoryHint: 'transportation cost calculation',
  },
];

// ─── GPT-4o API CALL ────────────────────────────────────────────────────────

async function callGPT(systemPrompt, userPrompt, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: TEMPERATURE,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`API ${res.status}: ${err}`);
      }
      const json = await res.json();
      return json.choices[0].message.content.trim();
    } catch (e) {
      if (attempt === retries - 1) throw e;
      console.log(`  Retry ${attempt + 1}...`);
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

// ─── BATCH HELPER ───────────────────────────────────────────────────────────

async function runBatched(tasks, batchSize) {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
  }
  return results;
}

// ─── GRADING ────────────────────────────────────────────────────────────────

function parseNumber(text) {
  if (!text) return NaN;
  // Remove common prefixes/suffixes
  let cleaned = text.replace(/[$%,]/g, '').trim();
  // Extract the last number-like thing (handles "The answer is 1.275")
  const matches = cleaned.match(/-?\d+\.?\d*/g);
  if (!matches) return NaN;
  return parseFloat(matches[matches.length - 1]);
}

function grade(bOutput, expected) {
  const parsed = parseNumber(bOutput);
  if (isNaN(parsed)) return { score: 0, parsed: null };
  if (expected === 0) return { score: parsed === 0 ? 1 : 0, parsed };
  const relError = Math.abs(parsed - expected) / Math.abs(expected);
  return { score: relError <= TOLERANCE ? 1 : 0, parsed };
}

// ─── B's SYSTEM PROMPT (IDENTICAL everywhere) ───────────────────────────────

const B_SYSTEM = `You are given a data summary. Using ONLY the information provided in the summary, compute the answer. If the needed data is not in the summary, output -999. Output ONLY a single number.`;

// ─── CONDITION 1: NO CONTEXT ────────────────────────────────────────────────

async function runNoContext(problem) {
  const aSystem = `You are a data analyst. Given the following data, write a general summary of the key findings. Cover the most notable metrics. Do NOT assume what the recipient will compute — provide a balanced overview.`;
  const aUser = `Here is the dataset:\n${problem.data}`;

  const aSummary = await callGPT(aSystem, aUser);

  const bUser = `Task: ${problem.bTask}\nData summary: ${aSummary}`;
  const bOutput = await callGPT(B_SYSTEM, bUser);

  const result = grade(bOutput, problem.answer);
  return { condition: 'no_context', problemId: problem.id, aSummary, bOutput, ...result, expected: problem.answer };
}

// ─── CONDITION 2: ONE-WAY ───────────────────────────────────────────────────

async function runOneWay(problem) {
  const aSystem = `You are a data analyst. The recipient will compute a ${problem.categoryHint}. Send the data points most relevant to their calculation. Be precise with numbers. Do not include irrelevant data.`;
  const aUser = `Here is the dataset:\n${problem.data}`;

  const aSummary = await callGPT(aSystem, aUser);

  const bUser = `Task: ${problem.bTask}\nData summary: ${aSummary}`;
  const bOutput = await callGPT(B_SYSTEM, bUser);

  const result = grade(bOutput, problem.answer);
  return { condition: 'one_way', problemId: problem.id, aSummary, bOutput, ...result, expected: problem.answer };
}

// ─── CONDITION 3: MUTUAL ────────────────────────────────────────────────────

async function runMutual(problem) {
  // Step 1: B tells A what it needs
  const bRequest = `I need to compute: ${problem.bTask}\nI specifically need these data points: ${problem.bNeeds}`;

  // Step 2: A extracts exactly what B asked for
  const aSystem = `You are a data analyst. The recipient has requested specific data points. Extract and send exactly what they asked for from the dataset. Be precise with numbers.`;
  const aUser = `Recipient's request: ${bRequest}\n\nFull dataset:\n${problem.data}`;

  const aSummary = await callGPT(aSystem, aUser);

  const bUser = `Task: ${problem.bTask}\nData summary: ${aSummary}`;
  const bOutput = await callGPT(B_SYSTEM, bUser);

  const result = grade(bOutput, problem.answer);
  return { condition: 'mutual', problemId: problem.id, bRequest, aSummary, bOutput, ...result, expected: problem.answer };
}

// ─── CONDITION 4: PROGRESSIVE (3 ROUNDS) ────────────────────────────────────

async function runProgressive(problems) {
  const allResults = { R1: [], R2: [], R3: [] };

  // ── R1: Exactly same as No Context ──
  console.log('  Progressive R1 (= No Context prompts)...');
  const r1Tasks = problems.map(p => async () => {
    const aSystem = `You are a data analyst. Given the following data, write a general summary of the key findings. Cover the most notable metrics. Do NOT assume what the recipient will compute — provide a balanced overview.`;
    const aUser = `Here is the dataset:\n${p.data}`;
    const aSummary = await callGPT(aSystem, aUser);
    const bUser = `Task: ${p.bTask}\nData summary: ${aSummary}`;
    const bOutput = await callGPT(B_SYSTEM, bUser);
    const result = grade(bOutput, p.answer);
    return { condition: 'progressive_R1', problemId: p.id, aSummary, bOutput, ...result, expected: p.answer };
  });
  allResults.R1 = await runBatched(r1Tasks, BATCH_SIZE);

  // Identify R1 failures
  const r1Failures = allResults.R1.filter(r => r.score === 0);
  const r1FailedIds = r1Failures.map(r => r.problemId);
  const r1FailureDesc = r1Failures.map(r => {
    const p = problems.find(pp => pp.id === r.problemId);
    return `Problem ${r.problemId}: B needed to "${p.bTask}" but got ${r.bOutput} (expected ${r.expected}). B likely was missing: ${p.bNeeds}`;
  }).join('\n');

  console.log(`  R1 failures: ${r1FailedIds.length}/15 — IDs: [${r1FailedIds.join(', ')}]`);

  // ── R2: A adapts based on R1 failures ──
  console.log('  Progressive R2 (A adapts)...');
  const r2Tasks = problems.map(p => async () => {
    let aSystem;
    if (r1FailedIds.includes(p.id)) {
      aSystem = `You are a data analyst. You previously sent a general summary of a dataset and the recipient failed to compute the correct answer for their task. Here is what went wrong:\n${r1Failures.find(f => f.problemId === p.id) ? `For this dataset, the recipient needed: ${problems.find(pp => pp.id === p.id).bNeeds}` : ''}\nAnalyze what data the recipient was missing and provide a summary that includes ALL specific numerical values from the dataset. Be comprehensive and precise — include every data point with its exact value.`;
    } else {
      aSystem = `You are a data analyst. You previously sent a general summary and the recipient succeeded. Continue providing a thorough summary. Include all specific numerical values from the dataset.`;
    }
    const aUser = `Here is the dataset:\n${p.data}`;
    const aSummary = await callGPT(aSystem, aUser);
    const bUser = `Task: ${p.bTask}\nData summary: ${aSummary}`;
    const bOutput = await callGPT(B_SYSTEM, bUser);
    const result = grade(bOutput, p.answer);
    return { condition: 'progressive_R2', problemId: p.id, aSummary, bOutput, ...result, expected: p.answer };
  });
  allResults.R2 = await runBatched(r2Tasks, BATCH_SIZE);

  // Identify R2 failures
  const r2Failures = allResults.R2.filter(r => r.score === 0);
  const r2FailedIds = r2Failures.map(r => r.problemId);
  console.log(`  R2 failures: ${r2FailedIds.length}/15 — IDs: [${r2FailedIds.join(', ')}]`);

  // ── R3: A further refines based on R2 failures ──
  console.log('  Progressive R3 (A further refines)...');
  const r3Tasks = problems.map(p => async () => {
    let aSystem;
    if (r2FailedIds.includes(p.id)) {
      aSystem = `You are a data analyst. After two rounds, the recipient still failed to compute the correct answer from your summary. The recipient's task involves: ${p.bTask}\nThey specifically need these values: ${problems.find(pp => pp.id === p.id).bNeeds}\nProvide a summary that explicitly lists every single data point with its exact numerical value. Format each data point clearly on its own line.`;
    } else if (r1FailedIds.includes(p.id) && !r2FailedIds.includes(p.id)) {
      aSystem = `You are a data analyst. Your improved summary worked in the last round. Continue providing a comprehensive summary with all specific numerical values clearly listed.`;
    } else {
      aSystem = `You are a data analyst. Your summaries have been working well. Provide a comprehensive summary with all specific numerical values from the dataset.`;
    }
    const aUser = `Here is the dataset:\n${p.data}`;
    const aSummary = await callGPT(aSystem, aUser);
    const bUser = `Task: ${p.bTask}\nData summary: ${aSummary}`;
    const bOutput = await callGPT(B_SYSTEM, bUser);
    const result = grade(bOutput, p.answer);
    return { condition: 'progressive_R3', problemId: p.id, aSummary, bOutput, ...result, expected: p.answer };
  });
  allResults.R3 = await runBatched(r3Tasks, BATCH_SIZE);

  const r3Failures = allResults.R3.filter(r => r.score === 0);
  console.log(`  R3 failures: ${r3Failures.length}/15 — IDs: [${r3Failures.map(r => r.problemId).join(', ')}]`);

  return allResults;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`KI-1 Experiment: Information Filtering (GPT-4o, temp=0)`);
  console.log(`${PROBLEMS.length} problems × 4 conditions\n`);

  // ── Condition 1: No Context ──
  console.log('=== Condition 1: No Context ===');
  const noContextTasks = PROBLEMS.map(p => () => runNoContext(p));
  const noContextResults = await runBatched(noContextTasks, BATCH_SIZE);
  const ncScore = noContextResults.reduce((s, r) => s + r.score, 0);
  console.log(`  Score: ${ncScore}/15 (${(ncScore / 15 * 100).toFixed(1)}%)\n`);

  // ── Condition 2: One-Way ──
  console.log('=== Condition 2: One-Way ===');
  const oneWayTasks = PROBLEMS.map(p => () => runOneWay(p));
  const oneWayResults = await runBatched(oneWayTasks, BATCH_SIZE);
  const owScore = oneWayResults.reduce((s, r) => s + r.score, 0);
  console.log(`  Score: ${owScore}/15 (${(owScore / 15 * 100).toFixed(1)}%)\n`);

  // ── Condition 3: Mutual ──
  console.log('=== Condition 3: Mutual ===');
  const mutualTasks = PROBLEMS.map(p => () => runMutual(p));
  const mutualResults = await runBatched(mutualTasks, BATCH_SIZE);
  const muScore = mutualResults.reduce((s, r) => s + r.score, 0);
  console.log(`  Score: ${muScore}/15 (${(muScore / 15 * 100).toFixed(1)}%)\n`);

  // ── Condition 4: Progressive ──
  console.log('=== Condition 4: Progressive ===');
  const progressiveResults = await runProgressive(PROBLEMS);
  const prR1 = progressiveResults.R1.reduce((s, r) => s + r.score, 0);
  const prR2 = progressiveResults.R2.reduce((s, r) => s + r.score, 0);
  const prR3 = progressiveResults.R3.reduce((s, r) => s + r.score, 0);
  console.log(`  R1: ${prR1}/15 (${(prR1 / 15 * 100).toFixed(1)}%)`);
  console.log(`  R2: ${prR2}/15 (${(prR2 / 15 * 100).toFixed(1)}%)`);
  console.log(`  R3: ${prR3}/15 (${(prR3 / 15 * 100).toFixed(1)}%)\n`);

  // ── Summary Table ──
  console.log('╔══════════════════════╦═══════╦════════╗');
  console.log('║ Condition            ║ Score ║   %    ║');
  console.log('╠══════════════════════╬═══════╬════════╣');
  console.log(`║ No Context           ║ ${String(ncScore).padStart(2)}/15 ║ ${(ncScore / 15 * 100).toFixed(1).padStart(5)}% ║`);
  console.log(`║ One-Way              ║ ${String(owScore).padStart(2)}/15 ║ ${(owScore / 15 * 100).toFixed(1).padStart(5)}% ║`);
  console.log(`║ Mutual               ║ ${String(muScore).padStart(2)}/15 ║ ${(muScore / 15 * 100).toFixed(1).padStart(5)}% ║`);
  console.log(`║ Progressive R1       ║ ${String(prR1).padStart(2)}/15 ║ ${(prR1 / 15 * 100).toFixed(1).padStart(5)}% ║`);
  console.log(`║ Progressive R2       ║ ${String(prR2).padStart(2)}/15 ║ ${(prR2 / 15 * 100).toFixed(1).padStart(5)}% ║`);
  console.log(`║ Progressive R3       ║ ${String(prR3).padStart(2)}/15 ║ ${(prR3 / 15 * 100).toFixed(1).padStart(5)}% ║`);
  console.log('╚══════════════════════╩═══════╩════════╝');

  // ── Per-problem detail ──
  console.log('\n--- Per-Problem Results ---');
  for (const p of PROBLEMS) {
    const nc = noContextResults.find(r => r.problemId === p.id);
    const ow = oneWayResults.find(r => r.problemId === p.id);
    const mu = mutualResults.find(r => r.problemId === p.id);
    const pr1 = progressiveResults.R1.find(r => r.problemId === p.id);
    const pr2 = progressiveResults.R2.find(r => r.problemId === p.id);
    const pr3 = progressiveResults.R3.find(r => r.problemId === p.id);
    const marks = [nc, ow, mu, pr1, pr2, pr3].map(r => r.score ? 'OK' : 'X ');
    console.log(`  #${String(p.id).padStart(2)} [${p.domain.padEnd(10)}] NC=${marks[0]} OW=${marks[1]} MU=${marks[2]} P1=${marks[3]} P2=${marks[4]} P3=${marks[5]}  (ans=${p.answer})`);
  }

  // ── Save JSON ──
  const output = {
    experiment: 'KI-1 Information Filtering',
    model: MODEL,
    temperature: TEMPERATURE,
    tolerance: '10%',
    timestamp: new Date().toISOString(),
    problems: PROBLEMS.map(p => ({ id: p.id, domain: p.domain, answer: p.answer, categoryHint: p.categoryHint })),
    summary: {
      no_context: { score: ncScore, total: 15, pct: +(ncScore / 15 * 100).toFixed(1) },
      one_way: { score: owScore, total: 15, pct: +(owScore / 15 * 100).toFixed(1) },
      mutual: { score: muScore, total: 15, pct: +(muScore / 15 * 100).toFixed(1) },
      progressive_R1: { score: prR1, total: 15, pct: +(prR1 / 15 * 100).toFixed(1) },
      progressive_R2: { score: prR2, total: 15, pct: +(prR2 / 15 * 100).toFixed(1) },
      progressive_R3: { score: prR3, total: 15, pct: +(prR3 / 15 * 100).toFixed(1) },
    },
    details: {
      no_context: noContextResults,
      one_way: oneWayResults,
      mutual: mutualResults,
      progressive_R1: progressiveResults.R1,
      progressive_R2: progressiveResults.R2,
      progressive_R3: progressiveResults.R3,
    },
  };

  const outPath = path.join(__dirname, 'ki1_gpt4o_results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
