/**
 * KI-1 Bandwidth Constraint Experiment
 *
 * Core idea: Under limited communication bandwidth (token budget),
 * mutual cognition becomes essential. Maps to paper's "spectrum scarcity" argument.
 *
 * 3 bandwidth levels × 4 conditions × 15 problems = 12 experiment groups
 * Progressive condition only at Low bandwidth (3 rounds).
 */

import { readFileSync, writeFileSync } from 'fs';

// Load API key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error("Set OPENAI_API_KEY env var"); process.exit(1); }
if (!OPENAI_API_KEY) throw new Error('No OPENAI_API_KEY found');

// ── Problems ──────────────────────────────────────────────────────────────────

const PROBLEMS = [
  {
    id: 1,
    data: "Revenue=$10M, COGS=$6M, SGA=$1.5M, Interest=$300K, Tax=25%, Assets=$20M, Equity=$12M, Shares=1M",
    bTask: "Compute EPS (Earnings Per Share). EPS = Net_Income / Shares. Net_Income = (Revenue - COGS - SGA - Interest) × (1 - TaxRate).",
    category: "financial profitability",
    neededPoints: "Revenue, COGS, SGA, Interest, Tax rate, Shares outstanding",
    formula: "EPS = (Revenue - COGS - SGA - Interest) × (1 - TaxRate) / Shares",
    answer: 1.65
  },
  {
    id: 2,
    data: "Cash=$300K, AR=$600K, Inventory=$900K, Prepaid=$100K, AP=$400K, Accrued=$200K, LongTermDebt=$3M, Equipment=$5M",
    bTask: "Compute Current Ratio. Current Ratio = Current Assets / Current Liabilities. Current Assets = Cash+AR+Inventory+Prepaid. Current Liabilities = AP+Accrued.",
    category: "liquidity",
    neededPoints: "Cash, AR, Inventory, Prepaid, AP, Accrued",
    formula: "Current Ratio = (Cash+AR+Inventory+Prepaid) / (AP+Accrued)",
    answer: 3.167
  },
  {
    id: 3,
    data: "Units=50000, Price=$40, VarCost=$25, FixedCost=$500K, Interest=$100K, Tax=30%",
    bTask: "Compute Net Profit Margin (%). Revenue=Units×Price. EBIT=Revenue-Units×VarCost-FixedCost. EBT=EBIT-Interest. Net=EBT×(1-Tax). Margin=Net/Revenue×100.",
    category: "profitability margin",
    neededPoints: "Units, Price, VarCost, FixedCost, Interest, Tax rate",
    formula: "Net Profit Margin = ((Units×Price - Units×VarCost - FixedCost - Interest)×(1-Tax)) / (Units×Price) × 100",
    answer: 5.25
  },
  {
    id: 4,
    data: "BeginCash=$500K, SalesReceipts=$3M, CostPayments=$2M, Salary=$400K, Rent=$120K, EquipPurchase=$300K, LoanIn=$500K, LoanRepay=$200K, TaxPaid=$150K, Dividends=$100K",
    bTask: "Compute Ending Cash Balance. EndingCash = BeginCash + all inflows - all outflows.",
    category: "cash flow",
    neededPoints: "BeginCash, SalesReceipts, CostPayments, Salary, Rent, EquipPurchase, LoanIn, LoanRepay, TaxPaid, Dividends",
    formula: "EndingCash = BeginCash + SalesReceipts - CostPayments - Salary - Rent - EquipPurchase + LoanIn - LoanRepay - TaxPaid - Dividends",
    answer: 730000
  },
  {
    id: 5,
    data: "NetIncome=$500K, TotalAssets=$10M, Equity=$6M, Debt=$4M, Interest=$200K, EBITDA=$1.2M, MarketCap=$15M",
    bTask: "Compute ROA (Return on Assets). ROA = NetIncome / TotalAssets.",
    category: "return metric",
    neededPoints: "NetIncome, TotalAssets",
    formula: "ROA = NetIncome / TotalAssets",
    answer: 0.05
  },
  {
    id: 6,
    data: "DailyDemand=200, DemandStd=40, LeadTime=5days, UnitCost=$15, HoldingRate=20%/yr, OrderCost=$100, ServiceLevel=95% (z=1.645)",
    bTask: "Compute Reorder Point. ROP = DailyDemand×LeadTime + z×DemandStd×√LeadTime. z=1.645 for 95%.",
    category: "inventory management",
    neededPoints: "DailyDemand, DemandStd, LeadTime, z-value(1.645)",
    formula: "ROP = DailyDemand×LeadTime + 1.645×DemandStd×√LeadTime",
    answer: 1147
  },
  {
    id: 7,
    data: "MachineA(100units/hr,$50/hr,2%defect), MachineB(80units/hr,$40/hr,1%defect), MachineC(120units/hr,$60/hr,3%defect), Order=10000units, Deadline=100hr",
    bTask: "Compute cost per good unit for Machine A. Time=10000/100=100hr. Cost=100×$50=$5000. GoodUnits=10000×0.98=9800. CostPerGood=5000/9800.",
    category: "manufacturing cost",
    neededPoints: "Machine A rate (100/hr), Machine A cost ($50/hr), Machine A defect (2%), Order size (10000)",
    formula: "CostPerGoodUnit = (Order/Rate × HourlyCost) / (Order × (1-DefectRate))",
    answer: 0.51
  },
  {
    id: 8,
    data: "Customers=30/hr, ServiceTime=4min(=4 per hr capacity per server is 15/hr), Servers=3, HourlyWage=$20, MaxWait=5min",
    bTask: "Compute Server Utilization. λ=30/hr, μ=15/hr per server, s=3. Utilization = λ/(s×μ).",
    category: "queueing theory",
    neededPoints: "Arrival rate (30/hr), Service rate per server (15/hr), Number of servers (3)",
    formula: "Utilization = λ / (s × μ) = 30 / (3 × 15)",
    answer: 0.667
  },
  {
    id: 9,
    data: "Budget=$1M, Duration=12mo, EarnedValue=$600K, ActualCost=$700K, PlannedValue=$650K",
    bTask: "Compute CPI (Cost Performance Index). CPI = EV / AC.",
    category: "project management",
    neededPoints: "EarnedValue, ActualCost",
    formula: "CPI = EV / AC = 600000 / 700000",
    answer: 0.857
  },
  {
    id: 10,
    data: "Demand=12000/yr, OrderCost=$75, HoldingCost=$4/unit/yr, UnitPrice=$25, LeadTime=7days",
    bTask: "Compute EOQ (Economic Order Quantity). EOQ = √(2×D×S/H).",
    category: "inventory optimization",
    neededPoints: "Annual Demand (12000), OrderCost ($75), HoldingCost ($4/unit/yr)",
    formula: "EOQ = √(2 × 12000 × 75 / 4)",
    answer: 670.8
  },
  {
    id: 11,
    data: "Mass=2kg, Velocity=10m/s, Height=5m, Gravity=9.81m/s², SpringK=500N/m",
    bTask: "Compute Kinetic Energy. KE = 0.5 × mass × velocity².",
    category: "physics energy",
    neededPoints: "Mass (2kg), Velocity (10m/s)",
    formula: "KE = 0.5 × m × v²",
    answer: 100
  },
  {
    id: 12,
    data: "Voltage=240V, Resistance=60Ω, Capacitance=100μF, Frequency=50Hz, PowerFactor=0.9",
    bTask: "Compute Current using Ohm's law. I = V / R.",
    category: "electrical circuit",
    neededPoints: "Voltage (240V), Resistance (60Ω)",
    formula: "I = V / R = 240 / 60",
    answer: 4.0
  },
  {
    id: 13,
    data: "Population=100000, BirthRate=12/1000, DeathRate=8/1000, Immigration=500/yr, Emigration=200/yr",
    bTask: "Compute Annual Population Growth (absolute number). Growth = Births - Deaths + Immigration - Emigration.",
    category: "demographics",
    neededPoints: "Population, BirthRate, DeathRate, Immigration, Emigration",
    formula: "Growth = Pop×BirthRate - Pop×DeathRate + Immigration - Emigration",
    answer: 700
  },
  {
    id: 14,
    data: "TankVolume=1000L, Inflow=5L/min, Outflow=3L/min, InitialLevel=400L",
    bTask: "Compute Time to Fill tank (minutes). Time = (TankVolume - InitialLevel) / (Inflow - Outflow).",
    category: "fluid dynamics",
    neededPoints: "TankVolume (1000L), InitialLevel (400L), Inflow (5L/min), Outflow (3L/min)",
    formula: "Time = (1000 - 400) / (5 - 3)",
    answer: 300
  },
  {
    id: 15,
    data: "Distance=500km, FuelRate=8L/100km, FuelPrice=$1.50/L, Toll=$30",
    bTask: "Compute Fuel Cost only (not including toll). FuelCost = Distance × (FuelRate/100) × FuelPrice.",
    category: "transportation cost",
    neededPoints: "Distance (500km), FuelRate (8L/100km), FuelPrice ($1.50/L)",
    formula: "FuelCost = 500 × 0.08 × 1.50",
    answer: 60
  }
];

// ── Bandwidth levels ──────────────────────────────────────────────────────────

const BANDWIDTHS = [
  { name: 'High', maxTokens: 300 },
  { name: 'Medium', maxTokens: 100 },
  { name: 'Low', maxTokens: 40 }
];

// ── API call helper ───────────────────────────────────────────────────────────

async function callGPT4o(systemPrompt, userPrompt, maxTokens = 1000, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          temperature: 0,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (resp.status === 429) {
        console.log(`  [429 rate limit] waiting 5s...`);
        await sleep(5000);
        continue;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }

      const json = await resp.json();
      return json.choices[0].message.content.trim();
    } catch (e) {
      if (attempt === retries - 1) throw e;
      console.log(`  [Retry ${attempt + 1}] ${e.message}`);
      await sleep(3000);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Condition runners ─────────────────────────────────────────────────────────

async function runNoContext(problem, maxTokens) {
  const aSys = "You are a data analyst. Summarize the key findings from this data. Provide a balanced overview of the most notable metrics.";
  const aUser = `Data: ${problem.data}`;
  const aMsg = await callGPT4o(aSys, aUser, maxTokens);

  const bSys = "Using ONLY the data summary provided, compute the answer. If needed data is missing, output -999. Output ONLY a number, nothing else.";
  const bUser = `Data summary from analyst:\n"${aMsg}"\n\nTask: ${problem.bTask}`;
  const bAnswer = await callGPT4o(bSys, bUser, 50);

  return { aMessage: aMsg, bRaw: bAnswer, aTokens: maxTokens };
}

async function runOneWay(problem, maxTokens) {
  const aSys = `You are a data analyst. The recipient needs to compute a ${problem.category} metric. Send the most relevant data points for their calculation. Be precise with numbers.`;
  const aUser = `Data: ${problem.data}`;
  const aMsg = await callGPT4o(aSys, aUser, maxTokens);

  const bSys = "Using ONLY the data summary provided, compute the answer. If needed data is missing, output -999. Output ONLY a number, nothing else.";
  const bUser = `Data summary from analyst:\n"${aMsg}"\n\nTask: ${problem.bTask}`;
  const bAnswer = await callGPT4o(bSys, bUser, 50);

  return { aMessage: aMsg, bRaw: bAnswer, aTokens: maxTokens };
}

async function runMutual(problem, maxTokens) {
  const bRequest = `I need the following data points to compute [${problem.formula}]: ${problem.neededPoints}`;

  const aSys = "Send exactly the requested data points. Nothing else. Be concise and precise with numbers.";
  const aUser = `Request from recipient: "${bRequest}"\n\nAvailable data: ${problem.data}`;
  const aMsg = await callGPT4o(aSys, aUser, maxTokens);

  const bSys = "Using ONLY the data summary provided, compute the answer. If needed data is missing, output -999. Output ONLY a number, nothing else.";
  const bUser = `Data summary from analyst:\n"${aMsg}"\n\nTask: ${problem.bTask}`;
  const bAnswer = await callGPT4o(bSys, bUser, 50);

  return { aMessage: aMsg, bRaw: bAnswer, aTokens: maxTokens };
}

async function runProgressive(problem) {
  const maxTokens = 40; // Low bandwidth only
  const rounds = [];

  // Round 1: No Context at low bandwidth
  const r1 = await runNoContext(problem, maxTokens);
  const r1val = parseAnswer(r1.bRaw);
  const r1correct = checkAnswer(r1val, problem.answer);
  rounds.push({ round: 1, ...r1, bParsed: r1val, correct: r1correct });

  // Round 2: A sees R1 result, adapts
  const r2aSys = `You are a data analyst. Your previous summary was insufficient — the recipient got the wrong answer (they got ${r1val}, needed to compute: ${problem.bTask}). Now prioritize sending the exact numbers they need. Be extremely concise.`;
  const r2aUser = `Data: ${problem.data}`;
  const r2aMsg = await callGPT4o(r2aSys, r2aUser, maxTokens);

  const bSys = "Using ONLY the data summary provided, compute the answer. If needed data is missing, output -999. Output ONLY a number, nothing else.";
  const r2bUser = `Data summary from analyst:\n"${r2aMsg}"\n\nTask: ${problem.bTask}`;
  const r2bAnswer = await callGPT4o(bSys, r2bUser, 50);
  const r2val = parseAnswer(r2bAnswer);
  const r2correct = checkAnswer(r2val, problem.answer);
  rounds.push({ round: 2, aMessage: r2aMsg, bRaw: r2bAnswer, bParsed: r2val, correct: r2correct, aTokens: maxTokens });

  // Round 3: further refinement
  const r3aSys = `You are a data analyst. After two attempts, the recipient still needs help. Their last answer was ${r2val}. The correct calculation requires: ${problem.formula}. Send ONLY the exact numbers needed, labeled clearly. Extreme brevity.`;
  const r3aUser = `Data: ${problem.data}`;
  const r3aMsg = await callGPT4o(r3aSys, r3aUser, maxTokens);

  const r3bUser = `Data summary from analyst:\n"${r3aMsg}"\n\nTask: ${problem.bTask}`;
  const r3bAnswer = await callGPT4o(bSys, r3bUser, 50);
  const r3val = parseAnswer(r3bAnswer);
  const r3correct = checkAnswer(r3val, problem.answer);
  rounds.push({ round: 3, aMessage: r3aMsg, bRaw: r3bAnswer, bParsed: r3val, correct: r3correct, aTokens: maxTokens });

  return rounds;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function parseAnswer(raw) {
  if (!raw) return -999;
  // Extract first number (possibly negative, possibly decimal)
  const cleaned = raw.replace(/,/g, '').replace(/\$/g, '');
  const match = cleaned.match(/-?\d+\.?\d*/);
  return match ? parseFloat(match[0]) : -999;
}

function checkAnswer(got, expected) {
  if (got === -999) return false;
  // Relative tolerance for large numbers, absolute for small
  if (Math.abs(expected) > 100) {
    return Math.abs(got - expected) / Math.abs(expected) < 0.05; // 5% tolerance
  }
  return Math.abs(got - expected) < Math.max(0.1, Math.abs(expected) * 0.05);
}

// ── Batch executor ────────────────────────────────────────────────────────────

async function runBatch(tasks, batchSize = 3, delayMs = 500) {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
    if (i + batchSize < tasks.length) {
      await sleep(delayMs);
    }
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== KI-1 Bandwidth Constraint Experiment ===\n');
  console.log(`Problems: ${PROBLEMS.length}`);
  console.log(`Bandwidths: ${BANDWIDTHS.map(b => `${b.name}(${b.maxTokens})`).join(', ')}`);
  console.log(`Conditions: No Context, One-Way, Mutual, Progressive(Low only)\n`);

  const allResults = {};
  const summaryRows = [];

  // Run 3 bandwidths × 3 standard conditions
  for (const bw of BANDWIDTHS) {
    const conditions = ['NoContext', 'OneWay', 'Mutual'];

    for (const cond of conditions) {
      const key = `${bw.name}_${cond}`;
      console.log(`\n── ${key} (max_tokens=${bw.maxTokens}) ──`);

      const runner = cond === 'NoContext' ? runNoContext :
                     cond === 'OneWay' ? runOneWay : runMutual;

      const tasks = PROBLEMS.map((p, idx) => async () => {
        console.log(`  Problem ${p.id}...`);
        const result = await runner(p, bw.maxTokens);
        const parsed = parseAnswer(result.bRaw);
        const correct = checkAnswer(parsed, p.answer);
        console.log(`    B=${parsed} expected=${p.answer} ${correct ? '✓' : '✗'}`);
        return { problemId: p.id, expected: p.answer, ...result, bParsed: parsed, correct };
      });

      const results = await runBatch(tasks, 3, 500);
      const accuracy = results.filter(r => r.correct).length / results.length;
      allResults[key] = { bandwidth: bw.name, maxTokens: bw.maxTokens, condition: cond, accuracy, results };
      summaryRows.push({ bandwidth: bw.name, maxTokens: bw.maxTokens, condition: cond, accuracy: (accuracy * 100).toFixed(1) + '%', correct: results.filter(r => r.correct).length, total: results.length });
      console.log(`  => Accuracy: ${(accuracy * 100).toFixed(1)}% (${results.filter(r => r.correct).length}/${results.length})`);
    }
  }

  // Progressive condition (Low bandwidth only)
  console.log(`\n── Low_Progressive (max_tokens=40, 3 rounds) ──`);
  const progTasks = PROBLEMS.map((p) => async () => {
    console.log(`  Problem ${p.id} (3 rounds)...`);
    const rounds = await runProgressive(p);
    for (const r of rounds) {
      console.log(`    R${r.round}: B=${r.bParsed} expected=${p.answer} ${r.correct ? '✓' : '✗'}`);
    }
    return { problemId: p.id, expected: p.answer, rounds };
  });

  const progResults = await runBatch(progTasks, 3, 500);

  for (let round = 1; round <= 3; round++) {
    const correct = progResults.filter(r => r.rounds[round - 1].correct).length;
    const accuracy = correct / progResults.length;
    const key = `Low_Progressive_R${round}`;
    allResults[key] = { bandwidth: 'Low', maxTokens: 40, condition: `Progressive_R${round}`, accuracy, results: progResults.map(r => r.rounds[round - 1]) };
    summaryRows.push({ bandwidth: 'Low', maxTokens: 40, condition: `Progressive_R${round}`, accuracy: (accuracy * 100).toFixed(1) + '%', correct, total: progResults.length });
  }
  allResults['Low_Progressive_Full'] = { results: progResults };

  // ── Summary table ─────────────────────────────────────────────────────────

  console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         KI-1 BANDWIDTH CONSTRAINT — RESULTS SUMMARY        ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ Bandwidth   │ Condition       │ Accuracy │ Correct/Total   ║');
  console.log('╠═════════════╪═════════════════╪══════════╪═════════════════╣');

  for (const row of summaryRows) {
    const bw = row.bandwidth.padEnd(11);
    const cond = row.condition.padEnd(15);
    const acc = row.accuracy.padStart(7);
    const ct = `${row.correct}/${row.total}`.padStart(6);
    console.log(`║ ${bw} │ ${cond} │ ${acc}  │ ${ct}           ║`);
  }

  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Gap analysis
  console.log('\n── Bandwidth Degradation Analysis ──');
  for (const bw of BANDWIDTHS) {
    const nc = allResults[`${bw.name}_NoContext`]?.accuracy * 100;
    const mu = allResults[`${bw.name}_Mutual`]?.accuracy * 100;
    if (nc !== undefined && mu !== undefined) {
      console.log(`  ${bw.name} (${bw.maxTokens} tokens): NoContext=${nc.toFixed(1)}% → Mutual=${mu.toFixed(1)}%  GAP=${(mu - nc).toFixed(1)}pp`);
    }
  }

  console.log('\n── Progressive Learning (Low bandwidth) ──');
  for (let r = 1; r <= 3; r++) {
    const acc = allResults[`Low_Progressive_R${r}`]?.accuracy * 100;
    if (acc !== undefined) console.log(`  Round ${r}: ${acc.toFixed(1)}%`);
  }

  // Save JSON
  const output = {
    experiment: 'KI-1 Bandwidth Constraint',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o',
    temperature: 0,
    problemCount: PROBLEMS.length,
    bandwidths: BANDWIDTHS,
    summary: summaryRows,
    details: allResults
  };

  writeFileSync('C:/Users/hyunj/wcisl/scripts/ki1_bandwidth_results.json', JSON.stringify(output, null, 2));
  console.log('\nResults saved to ki1_bandwidth_results.json');
}

main().catch(console.error);
