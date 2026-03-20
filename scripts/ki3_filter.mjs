/**
 * KI-3 Filter Experiment: Multi-result CoT where Tx must SELECT which results to transmit.
 *
 * Key insight: Each problem produces 3-4 intermediate results during CoT.
 * Only 1-2 are what Rx needs for the final answer.
 * If Tx sends the wrong intermediate results, Rx gets the wrong answer.
 *
 * 5 conditions × 15 problems × 1 trial = 75 calls pairs
 * Model: GPT-4o-mini for both Tx and Rx, temperature=0
 * Batch: Promise.all with batch size 5
 */

import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';

const env = readFileSync('C:/Users/hyunj/studyeng/.env.local', 'utf-8');
const API_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) throw new Error('No API key found');

const MODEL = 'gpt-4o-mini';
const TEMPERATURE = 0;
const BATCH_SIZE = 5;

// ═══════════════════════════════════════════════════════
// 15 PROBLEMS
// ═══════════════════════════════════════════════════════

const PROBLEMS = [
  {
    id: 1,
    domain: 'finance',
    scenario: `Company data: Revenue $10M, costs $7M, total assets $20M, total liabilities $12M.`,
    tx_task: `Analyze this company's financials. Compute ALL of the following intermediate metrics:\n1. Profit margin = (Revenue - Costs) / Revenue\n2. Debt ratio = Liabilities / Assets\n3. Return on Assets (ROA) = Net Income / Assets (where Net Income = Revenue - Costs)\n4. Current ratio = Assets / Liabilities`,
    rx_task: `Using the intermediate values provided by the analyst, compute the risk-adjusted return = ROA × (1 - debt_ratio). Give a single numeric answer as a decimal.`,
    rx_needs: ['ROA', 'debt_ratio'],
    answer: 0.06,
    tolerance: 0.1,
    general_hint: 'a risk-related financial metric',
    specific_hint: 'The recipient needs ROA and debt_ratio to compute risk-adjusted return = ROA × (1 - debt_ratio).'
  },
  {
    id: 2,
    domain: 'physics',
    scenario: `Circuit: V=120V, R1=20Ω in series with a parallel combination of R2=30Ω and R3=50Ω.`,
    tx_task: `Analyze this circuit completely. Compute ALL of the following:\n1. R_parallel (parallel resistance of R2 and R3)\n2. R_total (total circuit resistance)\n3. I_total (total current from source)\n4. V_R1 (voltage across R1)\n5. V_parallel (voltage across the parallel combination)\n6. P_total (total power from source)`,
    rx_task: `Using the intermediate values provided, compute the power dissipated in R2 specifically. Use P = V²/R where V is the voltage across R2. R2=30Ω. Give a single numeric answer in watts.`,
    rx_needs: ['V_parallel'],
    answer: 112.4,
    tolerance: 0.1,
    general_hint: 'a power calculation for a specific component',
    specific_hint: 'The recipient needs the voltage across the parallel combination (V_parallel) to compute power in R2 = V_parallel²/30.'
  },
  {
    id: 3,
    domain: 'economics',
    scenario: `City has 500,000 people, population growth 2%/year, 60% working age, unemployment rate 8%, average salary $40,000, income tax rate 20%.`,
    tx_task: `Compute ALL of the following:\n1. Total working age population\n2. Number of employed workers\n3. Number of unemployed\n4. Total payroll (employed × avg salary)\n5. Tax revenue (20% of total payroll)\n6. Population in 5 years (compound growth)`,
    rx_task: `Using the intermediate values provided, compute the annual tax revenue from employed workers. Tax revenue = employed × avg_salary × tax_rate. Give answer in billions of dollars.`,
    rx_needs: ['employed', 'avg_salary', 'tax_rate'],
    answer: 2.208,
    tolerance: 0.1,
    general_hint: 'a government revenue calculation',
    specific_hint: 'The recipient needs the number of employed workers to compute tax revenue = employed × $40,000 × 20%.'
  },
  {
    id: 4,
    domain: 'manufacturing',
    scenario: `Factory has 3 production lines. Line A: 200 units/hr, 3% defect rate, operating cost $50/hr. Line B: 150 units/hr, 1% defect rate, operating cost $70/hr. Line C: 300 units/hr, 5% defect rate, operating cost $40/hr. Defect penalty is $100 per defective unit.`,
    tx_task: `Compute ALL of the following for each line and overall:\n1. Total output across all lines\n2. Defective units per hour for each line (A, B, C)\n3. Good units per hour for each line\n4. Total defects per hour\n5. Overall defect rate\n6. Cost per good unit for each line: (operating_cost + defects × $100) / good_units`,
    rx_task: `Using the intermediate values provided, determine which production line has the LOWEST cost per good unit when accounting for defect penalties. Cost per good unit = (operating_cost_per_hr + defects_per_hr × $100) / good_units_per_hr. Give the line letter AND the cost per good unit rounded to 2 decimal places.`,
    rx_needs: ['per-line costs, defects, good units'],
    answer: 1.48,
    tolerance: 0.1,
    general_hint: 'a cost efficiency comparison',
    specific_hint: 'The recipient needs per-line production rates, defect rates, and operating costs to compute cost per good unit for each line and find the minimum.'
  },
  {
    id: 5,
    domain: 'finance',
    scenario: `Investment portfolio: $100K split into Stock (60%), Bond (30%), Cash (10%). Expected returns: Stock 12%, Bond 5%, Cash 2%. Standard deviations: Stock 20%, Bond 5%, Cash 0%. Correlation between stock and bond = -0.2. Risk-free rate = 2%.`,
    tx_task: `Compute ALL of the following:\n1. Portfolio expected return (weighted average)\n2. Portfolio variance (considering weights, stds, and correlation between stock and bond)\n3. Portfolio standard deviation\n4. Sharpe ratio = (portfolio_return - risk_free) / portfolio_std\n5. Maximum expected drawdown estimate\n6. Risk contribution from each asset`,
    rx_task: `Using the intermediate values provided, compute the Sharpe ratio = (portfolio_return - risk_free_rate) / portfolio_std. Risk-free rate is 2%. Give a single numeric answer rounded to 3 decimal places.`,
    rx_needs: ['portfolio_return', 'portfolio_std'],
    answer: 0.496,
    tolerance: 0.15,
    general_hint: 'a risk-adjusted performance measure',
    specific_hint: 'The recipient needs portfolio_return and portfolio_std to compute Sharpe = (return - 2%) / std.'
  },
  {
    id: 6,
    domain: 'project management',
    scenario: `Project tasks: A (5 days), B (3 days), C (4 days), D (6 days), E (2 days). Dependencies: A→C, B→C (both must finish before C starts), C→D, A→E.`,
    tx_task: `Compute ALL of the following:\n1. Critical path and its total duration\n2. Earliest start and finish for each task\n3. Latest start and finish for each task\n4. Slack/float for each task\n5. Which tasks are on the critical path`,
    rx_task: `Using the intermediate values provided, compute: if task C is delayed by 2 days, what is the new total project duration? Give a single numeric answer in days.`,
    rx_needs: ['critical_path_includes_C', 'original_duration'],
    answer: 17,
    tolerance: 0.05,
    general_hint: 'a schedule impact analysis',
    specific_hint: 'The recipient needs to know whether C is on the critical path and the original project duration to compute the impact of a 2-day delay to C.'
  },
  {
    id: 7,
    domain: 'finance',
    scenario: `Mortgage loan: $200,000 principal, 6% annual interest rate (0.5% monthly), 30-year term (360 months).`,
    tx_task: `Compute ALL of the following:\n1. Monthly payment using amortization formula\n2. Total interest over loan life\n3. Remaining balance after 5 years\n4. Total interest paid in first year (sum of monthly interest for months 1-12)\n5. Total principal paid in first year\n6. Total payments in first year`,
    rx_task: `Using the intermediate values provided, compute what percentage of first-year total payments goes to interest. Answer = (interest_first_year / total_payments_first_year) × 100. Give a single numeric answer as a percentage.`,
    rx_needs: ['interest_first_year', 'total_payments_first_year'],
    answer: 82.9,
    tolerance: 0.1,
    general_hint: 'a payment composition analysis',
    specific_hint: 'The recipient needs total interest paid in year 1 and total payments in year 1 to compute the interest percentage.'
  },
  {
    id: 8,
    domain: 'chemistry',
    scenario: `First-order reaction A→B. Rate constant k=0.05/min at 300K. Initial concentration [A]₀=2.0 M. Activation energy Ea=50 kJ/mol. R=8.314 J/(mol·K).`,
    tx_task: `Compute ALL of the following:\n1. Half-life = ln(2)/k\n2. [A] at t=10 min\n3. [B] at t=10 min\n4. Rate constant at 350K using Arrhenius equation\n5. Initial reaction rate = k × [A]₀\n6. [B] at t=20 min = [A]₀ - [A]₀×e^(-k×t)`,
    rx_task: `Using the intermediate values provided, compute the concentration of product B after 20 minutes. For first-order: [B] = [A]₀ - [A]₀×e^(-k×t) where k=0.05/min, [A]₀=2.0M, t=20min. Give a single numeric answer in mol/L (M).`,
    rx_needs: ['k', '[A]₀', 'or direct [B] at 20min'],
    answer: 1.264,
    tolerance: 0.1,
    general_hint: 'a concentration calculation at a specific time',
    specific_hint: 'The recipient needs [B] at t=20min, or equivalently k and [A]₀ to compute [B]=2.0-2.0×e^(-0.05×20).'
  },
  {
    id: 9,
    domain: 'statistics',
    scenario: `Survey of 1000 respondents. 45% prefer Product A, 35% prefer Product B, 20% no preference. Age groups: 18-30 (30% of total), 31-50 (45% of total), 51+ (25% of total). Among 18-30 age group, 60% prefer A. Among 31-50 age group, 40% prefer A.`,
    tx_task: `Compute ALL of the following:\n1. Total people preferring A = 450\n2. Total people preferring B = 350\n3. People aged 18-30 who prefer A = 300 × 0.6 = 180\n4. People aged 31-50 who prefer A = 450 × 0.4 = 180\n5. People aged 51+ who prefer A = 450 - 180 - 180 = 90\n6. Margin of error at 95% confidence\n7. Proportion of each age group preferring A`,
    rx_task: `Using the intermediate values provided, compute how many people aged 31-50 prefer Product A, given that 40% of the 31-50 age group prefers A. The 31-50 group is 45% of 1000 total respondents. Give a single numeric answer (number of people).`,
    rx_needs: ['count of 31-50 group', 'percentage preferring A in that group'],
    answer: 180,
    tolerance: 0.05,
    general_hint: 'a demographic preference count',
    specific_hint: 'The recipient needs the size of the 31-50 age group (450) and the 40% preference rate to compute 450 × 0.4 = 180.'
  },
  {
    id: 10,
    domain: 'energy',
    scenario: `Solar panel: 300W rated power, 6 peak sun hours/day, system efficiency 90% (after inverter losses). Battery: 10 kWh capacity, 95% charge efficiency. Daily household consumption: 8 kWh.`,
    tx_task: `Compute ALL of the following:\n1. Daily energy per panel = 300W × 6h × 0.9 = 1.62 kWh\n2. Panels needed for daily consumption = ceil(8/1.62) = 5\n3. Panels needed to fill battery = ceil(10/(1.62×0.95)) = 7\n4. Annual generation per panel\n5. System cost estimate\n6. CO2 savings per year`,
    rx_task: `Using the intermediate values provided, compute how many panels are needed to fully charge the 10 kWh battery in one day. Daily generation per panel after system efficiency = 300W × 6h × 0.9 = 1.62 kWh. Battery charge efficiency = 95%. Panels needed = ceil(battery_capacity / (daily_per_panel × charge_efficiency)). Give a single integer answer.`,
    rx_needs: ['daily_generation_per_panel', 'battery_capacity', 'charge_efficiency'],
    answer: 7,
    tolerance: 0.05,
    general_hint: 'a system sizing calculation',
    specific_hint: 'The recipient needs daily generation per panel (1.62 kWh) and battery specs to compute panels = ceil(10/(1.62×0.95)).'
  },
  // --- 5 more problems (11-15) ---
  {
    id: 11,
    domain: 'logistics',
    scenario: `Warehouse ships to 3 regions. Region X: 500 orders/day, avg 2.5 kg/order, distance 100km, shipping cost $0.05/kg/km. Region Y: 300 orders/day, avg 4 kg/order, distance 250km, cost $0.04/kg/km. Region Z: 200 orders/day, avg 3 kg/order, distance 50km, cost $0.06/kg/km.`,
    tx_task: `Compute ALL of the following:\n1. Daily shipping weight per region (X, Y, Z)\n2. Daily shipping cost per region\n3. Total daily shipping cost\n4. Cost per order per region\n5. Total daily orders\n6. Average cost per order across all regions\n7. Revenue per region if avg order value is $50`,
    rx_task: `Using the intermediate values provided, compute the total daily shipping cost for Region Y. Cost = orders × avg_weight × distance × rate = 300 × 4 × 250 × 0.04. Give a single numeric answer in dollars.`,
    rx_needs: ['Region Y parameters or direct cost'],
    answer: 12000,
    tolerance: 0.1,
    general_hint: 'a regional cost calculation',
    specific_hint: 'The recipient needs Region Y shipping cost = 300 orders × 4 kg × 250 km × $0.04/kg/km = $12,000.'
  },
  {
    id: 12,
    domain: 'healthcare',
    scenario: `Hospital data: 1000 patients tested for disease. Prevalence (true positive rate in population) = 5%. Test sensitivity = 90% (true positive rate). Test specificity = 95% (true negative rate).`,
    tx_task: `Compute ALL of the following:\n1. True positives = 1000 × 0.05 × 0.90 = 45\n2. False negatives = 1000 × 0.05 × 0.10 = 5\n3. True negatives = 1000 × 0.95 × 0.95 = 902.5\n4. False positives = 1000 × 0.95 × 0.05 = 47.5\n5. Positive predictive value (PPV) = TP/(TP+FP)\n6. Negative predictive value (NPV) = TN/(TN+FN)\n7. Overall accuracy = (TP+TN)/total`,
    rx_task: `Using the intermediate values provided, compute the Positive Predictive Value (PPV) = TP / (TP + FP). This is the probability that a positive test result is actually correct. Give a single numeric answer as a decimal between 0 and 1, rounded to 3 decimal places.`,
    rx_needs: ['TP', 'FP'],
    answer: 0.486,
    tolerance: 0.1,
    general_hint: 'a diagnostic accuracy metric',
    specific_hint: 'The recipient needs True Positives (45) and False Positives (47.5) to compute PPV = 45/(45+47.5) ≈ 0.486.'
  },
  {
    id: 13,
    domain: 'marketing',
    scenario: `Marketing campaign: 3 channels. Email: 50,000 sent, 20% open rate, 5% click rate (of opened), $2,000 cost. Social: 100,000 impressions, 3% click rate, $5,000 cost. Search: 20,000 clicks, $3 CPC ($60,000 cost). Conversion rate from click to purchase: Email 8%, Social 2%, Search 5%. Average order value: $75.`,
    tx_task: `Compute ALL of the following:\n1. Clicks per channel (Email: 50000×0.2×0.05=500, Social: 100000×0.03=3000, Search: 20000)\n2. Conversions per channel\n3. Revenue per channel\n4. ROI per channel = (revenue - cost) / cost\n5. Total conversions\n6. Total revenue\n7. Total cost\n8. Overall ROI`,
    rx_task: `Using the intermediate values provided, compute the ROI for the Search channel. ROI = (revenue - cost) / cost. Search has 20,000 clicks × 5% conversion = 1000 purchases × $75 = $75,000 revenue. Cost = $60,000. Give a single numeric answer as a decimal (e.g., 0.25 for 25% ROI).`,
    rx_needs: ['search_revenue', 'search_cost'],
    answer: 0.25,
    tolerance: 0.1,
    general_hint: 'a channel performance metric',
    specific_hint: 'The recipient needs Search channel revenue ($75,000) and cost ($60,000) to compute ROI = (75000-60000)/60000 = 0.25.'
  },
  {
    id: 14,
    domain: 'environmental',
    scenario: `City emissions: Transportation 40% of total, Buildings 35%, Industry 25%. Total annual emissions: 2,000,000 tons CO2. Reduction targets: Transportation -15%, Buildings -10%, Industry -20%. Cost per ton reduced: Transportation $50, Buildings $80, Industry $30.`,
    tx_task: `Compute ALL of the following:\n1. Emissions per sector (Transport=800K, Buildings=700K, Industry=500K)\n2. Reduction per sector in tons\n3. New emissions per sector after reduction\n4. Total reduction in tons\n5. New total emissions\n6. Percentage total reduction\n7. Cost per sector for reductions\n8. Total cost of all reductions`,
    rx_task: `Using the intermediate values provided, compute the total cost of emission reductions across ALL sectors. Cost = sum of (reduction_tons × cost_per_ton) for each sector. Give a single numeric answer in millions of dollars.`,
    rx_needs: ['reduction per sector', 'cost per ton per sector'],
    answer: 14.6,
    tolerance: 0.1,
    general_hint: 'a total program cost estimate',
    specific_hint: 'The recipient needs reduction tons per sector (120K, 70K, 100K) and costs ($50, $80, $30/ton) to compute total = 120K×50 + 70K×80 + 100K×30 = $14.6M.'
  },
  {
    id: 15,
    domain: 'sports',
    scenario: `Basketball player stats over 20 games: Points scored: [25, 30, 18, 22, 35, 28, 15, 32, 27, 20, 24, 31, 19, 26, 33, 21, 29, 16, 34, 23]. Field goal attempts per game: 20. Free throw attempts per game: 8. Three-point attempts per game: 6.`,
    tx_task: `Compute ALL of the following:\n1. Total points = 528\n2. Average points per game = 26.4\n3. Median points\n4. Standard deviation of points\n5. Highest and lowest scoring games\n6. Points per field goal attempt = 26.4/20 = 1.32\n7. Games above 25 points\n8. Scoring consistency (coefficient of variation = std/mean)`,
    rx_task: `Using the intermediate values provided, compute the player's scoring efficiency as points per field goal attempt. Average points = 26.4, field goal attempts per game = 20. Give a single numeric answer rounded to 2 decimal places.`,
    rx_needs: ['average_points', 'field_goal_attempts'],
    answer: 1.32,
    tolerance: 0.1,
    general_hint: 'a per-attempt efficiency metric',
    specific_hint: 'The recipient needs average points per game (26.4) and field goal attempts (20) to compute efficiency = 26.4/20 = 1.32.'
  }
];

// ═══════════════════════════════════════════════════════
// 5 CONDITIONS
// ═══════════════════════════════════════════════════════

function buildTxPrompt(problem, condition) {
  const { scenario, tx_task, general_hint, specific_hint } = problem;

  switch (condition) {
    case 1: // All General
      return [
        { role: 'system', content: `You are an analyst. You will be given data and asked to compute several intermediate results. After computing, summarize your key findings.` },
        { role: 'user', content: `Data:\n${scenario}\n\nTask:\n${tx_task}\n\nAfter computing all results, provide a general summary of your key findings.` }
      ];

    case 2: // All Audience-Aware
      return [
        { role: 'system', content: `You are an analyst communicating to an expert colleague. Be concise and focus on the most important results.` },
        { role: 'user', content: `Data:\n${scenario}\n\nTask:\n${tx_task}\n\nSend only the single most important result to your expert colleague.` }
      ];

    case 3: // Tx-Only Switch (general hint)
      return [
        { role: 'system', content: `You are an analyst. First compute all intermediate results. Then carefully select and send ONLY the intermediate results that would be relevant for someone who needs to compute ${general_hint}.` },
        { role: 'user', content: `Data:\n${scenario}\n\nStep 1 & 2 - Compute all intermediate results:\n${tx_task}\n\nStep 3 - Now select and send ONLY the intermediate values that would be needed by a recipient computing ${general_hint}. List just the selected values clearly.` }
      ];

    case 4: // Both Switch (specific hint)
      return [
        { role: 'system', content: `You are an analyst. First compute all intermediate results. Then carefully select and send ONLY the specific intermediate results needed by the recipient.\n\nRecipient's exact need: ${specific_hint}` },
        { role: 'user', content: `Data:\n${scenario}\n\nStep 1 & 2 - Compute all intermediate results:\n${tx_task}\n\nStep 3 - Select and send ONLY the values the recipient needs. ${specific_hint}\nList just the selected values clearly with labels.` }
      ];

    case 5: // Reverse (select before solving)
      return [
        { role: 'system', content: `You are an analyst. FIRST, before doing any calculations, decide which of the requested metrics would be most useful to send to a colleague. Then compute only those selected metrics.` },
        { role: 'user', content: `Data:\n${scenario}\n\nThe following metrics could be computed:\n${tx_task}\n\nStep 1 - WITHOUT computing anything yet, select which 1-2 metrics you think would be most useful.\nStep 2 - Now compute only those selected metrics.\nStep 3 - Send your results.` }
      ];

    default:
      throw new Error(`Unknown condition: ${condition}`);
  }
}

function buildRxPrompt(txOutput, problem, condition) {
  const { rx_task } = problem;

  switch (condition) {
    case 1: // All General
    case 2: // All Audience-Aware
    case 3: // Tx-Only Switch
      return [
        { role: 'system', content: `You are a decision-maker who receives analysis from a colleague. Use the provided information to compute the requested value. Give your final numeric answer on the last line in the format: ANSWER: <number>` },
        { role: 'user', content: `Your colleague sent you this analysis:\n\n---\n${txOutput}\n---\n\nYour task: ${rx_task}\n\nExtract the needed values from the analysis above and compute the answer. End with ANSWER: <number>` }
      ];

    case 4: // Both Switch (Rx also guided)
      return [
        { role: 'system', content: `You are a decision-maker who receives targeted data from an analyst. The analyst was instructed to send you specific values you need. Interpret what was sent and compute the requested value. Give your final numeric answer on the last line in the format: ANSWER: <number>` },
        { role: 'user', content: `Your analyst sent you these targeted values:\n\n---\n${txOutput}\n---\n\nStep 1: Identify which intermediate values were sent and why.\nStep 2: ${rx_task}\n\nEnd with ANSWER: <number>` }
      ];

    case 5: // Reverse (Rx unguided)
      return [
        { role: 'system', content: `You are a decision-maker. Your colleague sent some analysis, but it may not contain exactly what you need. Do your best. Give your final numeric answer on the last line in the format: ANSWER: <number>` },
        { role: 'user', content: `Your colleague sent this:\n\n---\n${txOutput}\n---\n\nYour task: ${rx_task}\n\nWork with whatever information is available. End with ANSWER: <number>` }
      ];

    default:
      throw new Error(`Unknown condition: ${condition}`);
  }
}

// ═══════════════════════════════════════════════════════
// API CALLING
// ═══════════════════════════════════════════════════════

async function callGPT(messages, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: TEMPERATURE,
          max_tokens: 1500
        })
      });

      if (!res.ok) {
        const err = await res.text();
        if (res.status === 429) {
          const wait = Math.pow(2, attempt) * 2000;
          console.log(`  Rate limited, waiting ${wait}ms...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`API ${res.status}: ${err}`);
      }

      const data = await res.json();
      return data.choices[0].message.content;
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

function parseAnswer(text) {
  // Try ANSWER: pattern first
  const match = text.match(/ANSWER:\s*\$?\s*([-\d.,]+)/i);
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''));
  }
  // Fallback: last number in text
  const nums = text.match(/[-]?\d+[.,]?\d*/g);
  if (nums && nums.length > 0) {
    return parseFloat(nums[nums.length - 1].replace(/,/g, ''));
  }
  return null;
}

function isCorrect(parsed, expected, tolerance) {
  if (parsed === null) return false;
  if (expected === 0) return Math.abs(parsed) < 0.5;
  const relError = Math.abs(parsed - expected) / Math.abs(expected);
  return relError <= tolerance;
}

// ═══════════════════════════════════════════════════════
// BATCH RUNNER
// ═══════════════════════════════════════════════════════

async function runBatch(tasks) {
  const results = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
  }
  return results;
}

async function runTrial(problem, condition) {
  // Tx call
  const txMessages = buildTxPrompt(problem, condition);
  const txOutput = await callGPT(txMessages);

  // Rx call
  const rxMessages = buildRxPrompt(txOutput, problem, condition);
  const rxOutput = await callGPT(rxMessages);

  const parsed = parseAnswer(rxOutput);
  const correct = isCorrect(parsed, problem.answer, problem.tolerance);

  return {
    problem_id: problem.id,
    domain: problem.domain,
    condition,
    tx_output: txOutput,
    rx_output: rxOutput,
    parsed_answer: parsed,
    expected: problem.answer,
    correct,
    rel_error: parsed !== null ? Math.abs(parsed - problem.answer) / Math.abs(problem.answer) : null
  };
}

// ═══════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════

const CONDITION_NAMES = {
  1: 'All General',
  2: 'All Audience-Aware',
  3: 'Tx-Only Switch',
  4: 'Both Switch (Paper)',
  5: 'Reverse'
};

async function main() {
  console.log('KI-3 Filter Experiment: Multi-result CoT Selection');
  console.log('='.repeat(60));
  console.log(`Model: ${MODEL} | Temperature: ${TEMPERATURE} | Batch: ${BATCH_SIZE}`);
  console.log(`Problems: ${PROBLEMS.length} | Conditions: 5 | Total trials: ${PROBLEMS.length * 5}`);
  console.log('='.repeat(60));

  const allResults = [];
  const startTime = Date.now();

  for (let cond = 1; cond <= 5; cond++) {
    console.log(`\n>>> Condition ${cond}: ${CONDITION_NAMES[cond]}`);

    const tasks = PROBLEMS.map(p => () => runTrial(p, cond));
    const results = await runBatch(tasks);
    allResults.push(...results);

    const correct = results.filter(r => r.correct).length;
    console.log(`  Result: ${correct}/${PROBLEMS.length} correct (${(correct/PROBLEMS.length*100).toFixed(1)}%)`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ─── Summary ───
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const summary = {};
  for (let cond = 1; cond <= 5; cond++) {
    const condResults = allResults.filter(r => r.condition === cond);
    const correct = condResults.filter(r => r.correct).length;
    const accuracy = correct / condResults.length;
    const avgError = condResults
      .filter(r => r.rel_error !== null)
      .reduce((s, r) => s + r.rel_error, 0) / condResults.filter(r => r.rel_error !== null).length;

    summary[cond] = {
      name: CONDITION_NAMES[cond],
      correct,
      total: condResults.length,
      accuracy: (accuracy * 100).toFixed(1) + '%',
      avg_rel_error: (avgError * 100).toFixed(1) + '%'
    };

    console.log(`  C${cond} ${CONDITION_NAMES[cond].padEnd(25)} ${correct}/${condResults.length}  ${(accuracy*100).toFixed(1)}%  avg_err=${(avgError*100).toFixed(1)}%`);
  }

  // Per-problem breakdown
  console.log('\n--- Per-problem breakdown ---');
  console.log('Problem'.padEnd(10) + 'Domain'.padEnd(16) + 'C1  C2  C3  C4  C5');
  for (const p of PROBLEMS) {
    const row = [p.id.toString().padEnd(10), p.domain.padEnd(16)];
    for (let c = 1; c <= 5; c++) {
      const r = allResults.find(r => r.problem_id === p.id && r.condition === c);
      row.push(r.correct ? ' ✓ ' : ' ✗ ');
    }
    console.log(row.join(''));
  }

  // ─── Save JSON ───
  const output = {
    experiment: 'KI-3 Filter: Multi-result CoT Selection',
    timestamp: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    model: MODEL,
    temperature: TEMPERATURE,
    design: {
      description: 'Tx computes multiple intermediate results, must SELECT which to send to Rx. Rx needs specific values for final computation.',
      pipeline: 'Tx Stage 1 (understand) → Stage 2 (solve all) → Stage 3 (select what to send) → Rx (compute final)',
      key_difference: 'Stage 3 is selection, not compression. Without knowing Rx task, Tx may send wrong intermediates.',
      num_problems: PROBLEMS.length,
      num_conditions: 5
    },
    conditions: summary,
    problems: PROBLEMS.map(p => ({
      id: p.id,
      domain: p.domain,
      scenario: p.scenario,
      rx_task: p.rx_task,
      rx_needs: p.rx_needs,
      expected_answer: p.answer,
      tolerance: p.tolerance
    })),
    results: allResults.map(r => ({
      problem_id: r.problem_id,
      condition: r.condition,
      condition_name: CONDITION_NAMES[r.condition],
      tx_output: r.tx_output,
      rx_output: r.rx_output,
      parsed_answer: r.parsed_answer,
      expected: r.expected,
      correct: r.correct,
      rel_error: r.rel_error
    }))
  };

  writeFileSync('C:/Users/hyunj/wcisl/scripts/ki3_filter_results.json', JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ki3_filter_results.json`);
  console.log(`Total time: ${elapsed}s`);
}

main().catch(console.error);
