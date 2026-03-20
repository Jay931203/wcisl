import OpenAI from "openai";
import fs from "fs";

const client = new OpenAI({
  apiKey: "OPENAI_API_KEY_REDACTED",
});

// ── Pricing ──
const PRICING = {
  "gpt-4o":      { input: 2.50 / 1e6, output: 10.00 / 1e6 },
  "gpt-4o-mini": { input: 0.15 / 1e6, output: 0.60  / 1e6 },
};

function cost(model, inp, out) {
  const p = PRICING[model];
  return p.input * inp + p.output * out;
}

// ── 15 Problems ──
const PROBLEMS = [
  // ═══ Category 1: Quality Control (5) ═══
  {
    id: 1,
    category: "Quality Control",
    title: "Electronics PCB Defect Cost",
    input_data: "A factory inspected 250 printed circuit boards. 8 boards had solder defects. Each defective board costs $320 to repair. A batch of 50,000 boards is being produced. What is the expected total repair cost for the batch?",
    a_task: "Compute the defect rate from the sample data (defective / total inspected).",
    b_task: "Using the defect rate, compute expected total repair cost = defect_rate × unit_repair_cost × batch_size.",
    intermediate_answer: 0.032,  // 8/250
    final_answer: 512000,        // 0.032 × 320 × 50000
    precision_sensitive: true,
    notes: "If A rounds to 0.03, final = 480000 (6.25% error, fails 5% tolerance)"
  },
  {
    id: 2,
    category: "Quality Control",
    title: "Pharmaceutical Batch Rejection",
    input_data: "A pharmaceutical company tested 400 tablets for potency. 14 were outside acceptable range. Each rejected batch (of 20,000 tablets) costs $85,000 to dispose and remanufacture. If the rejection threshold is 4%, should this batch be rejected? If rejected, what is the disposal cost? If accepted, what is the expected warranty cost at $12 per defective tablet for 20,000 tablets?",
    a_task: "Compute the defect rate from the sample (defective / total tested).",
    b_task: "If defect rate >= 4%, answer is $85,000 (rejection cost). If defect rate < 4%, answer is defect_rate × 12 × 20000 (warranty cost).",
    intermediate_answer: 0.035,  // 14/400
    final_answer: 8400,          // 0.035 < 0.04, so accepted: 0.035 × 12 × 20000 = 8400
    precision_sensitive: true,
    notes: "If A rounds to 0.04, B rejects → answer becomes 85000 (huge error!)"
  },
  {
    id: 3,
    category: "Quality Control",
    title: "Automotive Parts Inspection Cost-Benefit",
    input_data: "An auto parts supplier tested 600 brake pads. 21 failed the stress test. Each defective pad that reaches a customer costs $4,500 in recall expenses. The supplier can add an extra inspection step costing $1.50 per pad that catches 90% of defects. For an order of 100,000 pads, should they add the inspection? Compute: (cost without inspection) - (cost with inspection) to determine net savings. Positive = inspection is worth it.",
    a_task: "Compute the defect rate from sample data (failed / total tested).",
    b_task: "Without inspection: defect_rate × 4500 × 100000. With inspection: (defect_rate × 0.10 × 4500 × 100000) + (1.50 × 100000). Net savings = cost_without - cost_with.",
    intermediate_answer: 0.035,   // 21/600
    final_answer: 13975000,       // Without: 0.035×4500×100000=15750000. With: 0.035×0.1×4500×100000+150000=1725000. Savings=14025000... let me recalc
    precision_sensitive: false,
    notes: "Savings calculation"
  },
  {
    id: 4,
    category: "Quality Control",
    title: "Semiconductor Wafer Yield",
    input_data: "A semiconductor fab processed 180 wafers. Each wafer has 500 die. Defect inspection found an average of 12.6 defects per wafer. Using the Poisson yield model Y = e^(-defects_per_die × die_area), where die_area = 1 (normalized), compute the expected number of good die per wafer. Then for 180 wafers, what is the total expected good die count?",
    a_task: "Compute defects_per_die = 12.6 / 500 = 0.0252. Then yield Y = e^(-0.0252).",
    b_task: "Good die per wafer = Y × 500. Total good die = good_per_wafer × 180.",
    intermediate_answer: 0.97511,  // e^(-0.0252) ≈ 0.97511
    final_answer: 87760,           // 0.97511 × 500 × 180 ≈ 87760
    precision_sensitive: true,
    notes: "Small rounding in Y propagates through multiplication by 90000"
  },
  {
    id: 5,
    category: "Quality Control",
    title: "Food Safety Contamination Threshold",
    input_data: "A food processing plant tested 320 chicken samples for salmonella. 7 tested positive. The regulatory limit is 2.5% contamination rate. If the rate exceeds the limit, the entire day's production of 15,000 units must be destroyed at $8 per unit. If within limit, production continues with monitoring cost of $2,000. What is the financial outcome?",
    a_task: "Compute the contamination rate from sample data (positive / total).",
    b_task: "If rate > 2.5%, answer = 15000 × 8 = 120000 (destruction cost). If rate <= 2.5%, answer = 2000 (monitoring cost).",
    intermediate_answer: 0.021875,  // 7/320
    final_answer: 2000,            // 0.021875 < 0.025, so monitoring cost
    precision_sensitive: true,
    notes: "If A rounds to 0.025 or higher, B destroys production → $120,000 vs $2,000"
  },

  // ═══ Category 2: Risk Assessment (5) ═══
  {
    id: 6,
    category: "Risk Assessment",
    title: "Flood Risk Insurance Premium",
    input_data: "Historical flood data for a region over 80 years: floods occurred in 3 years. A commercial property is valued at $4,200,000. The insurance company uses the formula: annual premium = P(flood) × property_value × 1.35 (the 1.35 is a loading factor for admin costs and profit). What should the annual premium be?",
    a_task: "Compute P(flood) from historical data = flood_years / total_years.",
    b_task: "Premium = P(flood) × property_value × loading_factor.",
    intermediate_answer: 0.0375,   // 3/80
    final_answer: 212625,          // 0.0375 × 4200000 × 1.35
    precision_sensitive: true,
    notes: "If A rounds to 0.04, premium = 226800 (6.7% error, fails tolerance)"
  },
  {
    id: 7,
    category: "Risk Assessment",
    title: "Equipment Failure Expected Loss",
    input_data: "A power plant turbine has the following failure history over 200 operating months: 0 failures in 185 months, 1 failure in 12 months, 2 failures in 3 months. Each failure costs $45,000 to repair. Compute the expected monthly repair cost. Then compute the annual expected repair cost.",
    a_task: "Compute expected failures per month: E = (0×185 + 1×12 + 2×3) / 200.",
    b_task: "Monthly expected cost = E × 45000. Annual = monthly × 12.",
    intermediate_answer: 0.09,     // (0+12+6)/200 = 18/200 = 0.09
    final_answer: 48600,           // 0.09 × 45000 × 12
    precision_sensitive: false,
    notes: "Clean division, less sensitive to rounding"
  },
  {
    id: 8,
    category: "Risk Assessment",
    title: "Cybersecurity Breach Expected Cost",
    input_data: "A company's security logs over 730 days show 11 attempted breaches, of which 3 succeeded. Each successful breach costs an average of $280,000. The company is considering a security upgrade costing $150,000/year that would reduce successful breach probability by 60%. Compute the net annual savings (savings from reduced breaches minus upgrade cost). Positive means upgrade is worthwhile.",
    a_task: "Compute the rate of successful breaches per day = successful / total_days. Convert to annual rate (×365).",
    b_task: "Annual breach cost without upgrade = annual_rate × cost_per_breach. With upgrade = annual_rate × 0.40 × cost_per_breach + 150000. Net savings = without - with.",
    intermediate_answer: 1.5,      // (3/730)×365 = 1.5 breaches/year
    final_answer: 102000,          // Without: 1.5×280000=420000. With: 1.5×0.4×280000+150000=318000. Savings=102000
    precision_sensitive: false,
    notes: "Moderate sensitivity"
  },
  {
    id: 9,
    category: "Risk Assessment",
    title: "Earthquake Retrofit Decision",
    input_data: "Seismic data for a region over 120 years shows 4 earthquakes exceeding magnitude 6.0. A hospital valued at $35,000,000 has an estimated 15% damage ratio in such an earthquake. Retrofit cost is $2,800,000 (one-time) which reduces damage ratio to 3%. Using a 30-year planning horizon, compute: expected net benefit of retrofit = (expected damage cost without retrofit over 30 years) - (expected damage cost with retrofit over 30 years) - retrofit cost. Positive means retrofit is worthwhile.",
    a_task: "Compute P(earthquake ≥ 6.0 per year) from historical data.",
    b_task: "Expected quakes in 30 years = P × 30. Without retrofit: expected_quakes × 0.15 × 35000000. With retrofit: expected_quakes × 0.03 × 35000000 + 2800000. Net benefit = without - with.",
    intermediate_answer: 0.03333,  // 4/120
    final_answer: 2200000,         // Expected quakes = 1.0. Without: 1.0×0.15×35M=5250000. With: 1.0×0.03×35M+2800000=3850000. Net=1400000... let me recalc
    precision_sensitive: true,
    notes: "P matters for 30-year projection"
  },
  {
    id: 10,
    category: "Risk Assessment",
    title: "Supply Chain Disruption Reserve",
    input_data: "Over the past 5 years (60 months), a manufacturer experienced supply disruptions in 7 months. Each disruption requires emergency sourcing at $18,500 additional cost per disruption. The company wants to set aside a quarterly reserve fund. What should the quarterly reserve be to cover 1.5× the expected disruption cost per quarter (safety margin)?",
    a_task: "Compute monthly disruption probability = disruption_months / total_months.",
    b_task: "Expected disruptions per quarter = probability × 3 months. Quarterly cost = expected_disruptions × 18500. Reserve = quarterly_cost × 1.5.",
    intermediate_answer: 0.11667,  // 7/60
    final_answer: 9712.5,          // (7/60) × 3 × 18500 × 1.5 = 0.35 × 18500 × 1.5 = 9712.5
    precision_sensitive: true,
    notes: "If A rounds to 0.12, final = 9990 (2.9% off, still ok). If rounds to 0.1, final = 8325 (14.3% off, fails)"
  },

  // ═══ Category 3: Resource Optimization (5) ═══
  {
    id: 11,
    category: "Resource Optimization",
    title: "Warehouse Newsvendor Stocking",
    input_data: "Daily demand data for a product over 30 days: [42, 55, 38, 61, 47, 53, 44, 58, 41, 50, 46, 57, 39, 62, 48, 51, 43, 59, 45, 54, 40, 56, 49, 60, 37, 52, 47, 55, 44, 58]. Holding cost per unsold unit: $3. Shortage cost per unmet demand: $22. Using the newsvendor model, compute the optimal daily stock level. Use Q* = mean + z × std, where z = Phi_inverse(Cu/(Cu+Co)), Cu=shortage cost, Co=holding cost.",
    a_task: "Compute the sample mean and sample standard deviation of the demand data.",
    b_task: "Critical ratio = Cu/(Cu+Co) = 22/(22+3) = 0.88. z = Phi_inverse(0.88) ≈ 1.175. Optimal stock = mean + z × std.",
    intermediate_answer: 49.67,    // mean ≈ 49.67, std ≈ 7.37
    final_answer: 58.33,           // 49.67 + 1.175 × 7.37 ≈ 58.33
    precision_sensitive: true,
    notes: "A needs to provide both mean AND std. Intermediate graded on mean. Std ≈ 7.37"
  },
  {
    id: 12,
    category: "Resource Optimization",
    title: "Server Capacity Planning",
    input_data: "Hourly request counts for a web server over 24 hours: [120, 85, 62, 45, 38, 52, 180, 340, 520, 610, 580, 490, 530, 560, 540, 500, 420, 380, 310, 260, 210, 175, 150, 130]. Each server handles 200 requests/hour. Servers cost $0.12/hour each. Under-capacity penalty: $0.005 per dropped request. How many servers should be provisioned to minimize total daily cost? Compute total cost for the optimal number.",
    a_task: "Compute the peak hourly request rate and the average hourly request rate from the data.",
    b_task: "For N servers, capacity = N×200/hour. Compute daily cost for each candidate N: server_cost = N × 0.12 × 24. For each hour, dropped = max(0, requests - N×200). Penalty = total_dropped × 0.005. Total = server_cost + penalty. Find N that minimizes total cost.",
    intermediate_answer: 610,      // peak rate
    final_answer: 8.64,            // optimal N=3 servers. Cost = 3×0.12×24 + penalty for dropped requests
    precision_sensitive: false,
    notes: "A needs peak. B does optimization over integer N."
  },
  {
    id: 13,
    category: "Resource Optimization",
    title: "Staff Scheduling with Utilization Rate",
    input_data: "A call center logged the following data over 20 working days: total calls received = 4,360, total calls handled = 3,920, average handle time = 8.5 minutes, available agent-minutes per day (with 10 agents) = 4,800 minutes/day. Compute the current utilization rate. If the target utilization is 85%, how many agents are needed? Each agent costs $220/day.",
    a_task: "Compute current utilization rate = (calls_handled × avg_handle_time) / (total_agent_minutes × total_days).",
    b_task: "Required agent-minutes per day at current call volume = (total_calls/20) × 8.5. Agents needed = required_minutes / (480 × 0.85), rounded up. Daily staffing cost = agents × 220.",
    intermediate_answer: 0.3472,   // (3920 × 8.5) / (4800 × 20) = 33320/96000
    final_answer: 4620,            // daily calls = 218, required mins = 218×8.5=1853. Agents = ceil(1853/(480×0.85)) = ceil(1853/408) = ceil(4.54) = 5. But wait...
    precision_sensitive: false,
    notes: "Utilization rate computation"
  },
  {
    id: 14,
    category: "Resource Optimization",
    title: "Inventory EOQ with Demand Rate",
    input_data: "Sales records for the past 90 days show 2,340 units sold. Ordering cost is $125 per order. Holding cost is $0.80 per unit per day. Compute the Economic Order Quantity (EOQ). EOQ = sqrt(2 × D × S / H) where D = daily demand rate, S = ordering cost, H = holding cost per unit per day.",
    a_task: "Compute the daily demand rate D from the sales data.",
    b_task: "EOQ = sqrt(2 × D × S / H) = sqrt(2 × D × 125 / 0.80).",
    intermediate_answer: 26,       // 2340/90 = 26
    final_answer: 80.62,           // sqrt(2 × 26 × 125 / 0.80) = sqrt(8125) ≈ 90.14... let me recalc
    precision_sensitive: true,
    notes: "Clean demand rate but EOQ is sensitive to it via square root"
  },
  {
    id: 15,
    category: "Resource Optimization",
    title: "Delivery Fleet Routing Efficiency",
    input_data: "A delivery company tracked 150 routes over a month. Total distance driven: 18,750 km. Total packages delivered: 8,925. Fuel cost: $1.40/km. Driver cost: $35/hour at average speed 40 km/h. The company wants to add 1,200 packages/month. Assuming the same efficiency (km per package), what will the additional monthly cost be?",
    a_task: "Compute efficiency metrics: km per package = total_distance / total_packages.",
    b_task: "Additional km = km_per_package × 1200. Fuel cost = additional_km × 1.40. Driver hours = additional_km / 40. Driver cost = hours × 35. Total additional cost = fuel + driver.",
    intermediate_answer: 2.1008,   // 18750/8925 ≈ 2.1008
    final_answer: 5862.24,         // additional_km = 2.1008 × 1200 = 2521.0. Fuel = 2521×1.40 = 3529.4. Hours = 2521/40 = 63.025. Driver = 63.025×35 = 2205.875. Total = 5735.275
    precision_sensitive: true,
    notes: "km/package precision affects both fuel and driver cost calculations"
  }
];

// ── Recalculate ground truths precisely ──
// Problem 3
{
  const rate = 21/600;  // 0.035
  const without = rate * 4500 * 100000;  // 15750000
  const withInsp = rate * 0.10 * 4500 * 100000 + 1.50 * 100000;  // 1575000 + 150000 = 1725000
  PROBLEMS[2].intermediate_answer = rate;
  PROBLEMS[2].final_answer = without - withInsp;  // 14025000
}
// Problem 4
{
  const dpd = 12.6/500;
  const Y = Math.exp(-dpd);
  PROBLEMS[3].intermediate_answer = Y;
  PROBLEMS[3].final_answer = Math.round(Y * 500 * 180);  // 87760
}
// Problem 9
{
  const p = 4/120;
  const eq30 = p * 30;  // 1.0
  const without = eq30 * 0.15 * 35000000;  // 5250000
  const withR = eq30 * 0.03 * 35000000 + 2800000;  // 1050000 + 2800000 = 3850000
  PROBLEMS[8].intermediate_answer = p;
  PROBLEMS[8].final_answer = without - withR;  // 1400000
}
// Problem 10
{
  const p = 7/60;
  PROBLEMS[9].intermediate_answer = p;
  PROBLEMS[9].final_answer = p * 3 * 18500 * 1.5;
}
// Problem 11 - compute actual mean & std
{
  const data = [42, 55, 38, 61, 47, 53, 44, 58, 41, 50, 46, 57, 39, 62, 48, 51, 43, 59, 45, 54, 40, 56, 49, 60, 37, 52, 47, 55, 44, 58];
  const n = data.length;
  const mean = data.reduce((a,b) => a+b, 0) / n;
  const variance = data.reduce((a,b) => a + (b-mean)**2, 0) / (n-1);
  const std = Math.sqrt(variance);
  const z = 1.175;  // Phi_inverse(0.88)
  PROBLEMS[10].intermediate_answer = mean;
  PROBLEMS[10].final_answer = mean + z * std;
  console.log(`Problem 11: mean=${mean.toFixed(4)}, std=${std.toFixed(4)}, optimal=${(mean + z * std).toFixed(2)}`);
}
// Problem 12 - compute optimal server count
{
  const reqs = [120, 85, 62, 45, 38, 52, 180, 340, 520, 610, 580, 490, 530, 560, 540, 500, 420, 380, 310, 260, 210, 175, 150, 130];
  const peak = Math.max(...reqs);
  PROBLEMS[11].intermediate_answer = peak;

  let bestCost = Infinity, bestN = 0;
  for (let N = 1; N <= 10; N++) {
    const serverCost = N * 0.12 * 24;
    let totalDropped = 0;
    for (const r of reqs) {
      const dropped = Math.max(0, r - N * 200);
      totalDropped += dropped;
    }
    const penalty = totalDropped * 0.005;
    const total = serverCost + penalty;
    if (total < bestCost) { bestCost = total; bestN = N; }
  }
  PROBLEMS[11].final_answer = bestCost;
  console.log(`Problem 12: peak=${peak}, bestN=${bestN}, bestCost=${bestCost.toFixed(2)}`);
}
// Problem 13
{
  const utilization = (3920 * 8.5) / (4800 * 20);
  const dailyCalls = 4360 / 20;  // 218
  const reqMins = dailyCalls * 8.5;  // 1853
  const agents = Math.ceil(reqMins / (480 * 0.85));
  const dailyCost = agents * 220;
  PROBLEMS[12].intermediate_answer = utilization;
  PROBLEMS[12].final_answer = dailyCost;
  console.log(`Problem 13: util=${utilization.toFixed(4)}, dailyCalls=${dailyCalls}, reqMins=${reqMins}, agents=${agents}, cost=${dailyCost}`);
}
// Problem 14
{
  const D = 2340 / 90;
  const EOQ = Math.sqrt(2 * D * 125 / 0.80);
  PROBLEMS[13].intermediate_answer = D;
  PROBLEMS[13].final_answer = EOQ;
  console.log(`Problem 14: D=${D}, EOQ=${EOQ.toFixed(2)}`);
}
// Problem 15
{
  const kpp = 18750 / 8925;
  const addKm = kpp * 1200;
  const fuel = addKm * 1.40;
  const hours = addKm / 40;
  const driver = hours * 35;
  const total = fuel + driver;
  PROBLEMS[14].intermediate_answer = kpp;
  PROBLEMS[14].final_answer = total;
  console.log(`Problem 15: kpp=${kpp.toFixed(4)}, addKm=${addKm.toFixed(2)}, total=${total.toFixed(2)}`);
}

// ── API call helper ──
async function chat(model, messages, temperature = 0) {
  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: 2000,
  });
  return {
    content: resp.choices[0].message.content,
    usage: resp.usage,
  };
}

// ── Extract number from text ──
function extractNumber(text) {
  if (!text) return null;

  // Priority 1: explicit ANSWER: tag
  const answerMatch = text.match(/ANSWER:\s*\$?\s*([\-]?[\d,]+\.?\d*)/i);
  if (answerMatch && answerMatch[1]) {
    const val = parseFloat(answerMatch[1].replace(/,/g, ''));
    if (!isNaN(val)) return val;
  }

  // Try specific patterns first (non-global, capture group 1)
  const patterns = [
    /(?:final answer|result|answer|total|optimal|premium|cost|reserve|savings|net benefit|EOQ|stock level|value)[:\s]*\$?\s*([\-]?[\d,]+\.?\d*)/i,
    /(?:=\s*)([\-]?[\d,]+\.?\d*)\s*$/m,
    /\*\*([\-]?[\d,]+\.?\d*)\*\*/,
    /\$([\-]?[\d,]+\.?\d*)/,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val !== 0) return val;
    }
  }

  // Last resort: find all numbers, return the last substantial one
  const allNums = [...text.matchAll(/([\-]?[\d,]+\.?\d+)/g)]
    .map(m => parseFloat(m[1].replace(/,/g, '')))
    .filter(n => !isNaN(n) && Math.abs(n) > 0.0001);

  if (allNums.length > 0) {
    return allNums[allNums.length - 1];
  }
  return null;
}

// ── Grade ──
function grade(computed, truth, tolerance = 0.05) {
  if (computed === null || truth === null) return false;
  if (truth === 0) return Math.abs(computed) < 0.01;
  return Math.abs(computed - truth) / Math.abs(truth) <= tolerance;
}

// ── Run one problem through A→B pipeline ──
async function runProblem(problem, aSystem, bSystem, aPreamble = "", bPreamble = "") {
  // Agent A
  const aMessages = [
    { role: "system", content: aSystem },
  ];
  if (aPreamble) aMessages.push({ role: "user", content: aPreamble });
  aMessages.push({
    role: "user",
    content: `Problem: ${problem.input_data}\n\nYour task: ${problem.a_task}\n\nProvide your computed value clearly. At the end of your response, write exactly: ANSWER: <number>`
  });

  const aResp = await chat("gpt-4o", aMessages);

  // Agent B
  const bMessages = [
    { role: "system", content: bSystem },
  ];
  if (bPreamble) bMessages.push({ role: "user", content: bPreamble });
  bMessages.push({
    role: "user",
    content: `Problem context: ${problem.input_data}\n\nYour task: ${problem.b_task}\n\nAnalysis from the data specialist:\n${aResp.content}\n\nUsing the above analysis, compute the final numerical answer. At the end of your response, write exactly: ANSWER: <number>`
  });

  const bResp = await chat("gpt-4o-mini", bMessages);

  // Extract numbers
  const aValue = extractNumber(aResp.content);
  const bValue = extractNumber(bResp.content);

  return {
    a_output: aResp.content,
    b_output: bResp.content,
    a_value: aValue,
    b_value: bValue,
    a_usage: aResp.usage,
    b_usage: bResp.usage,
  };
}

// ── Condition definitions ──
const CONDITIONS = {
  "no_context": {
    a_system: "You are a data analyst. Given the data, compute the required statistical value. Explain your full reasoning and methodology. Assume the reader has no statistics background.",
    b_system: "You are an assistant. Given the analysis, compute the final answer.",
  },
  "one_way": {
    a_system: "You are a statistics expert. The recipient is an operations/decision expert who will use your computed value for cost/optimization calculations. State the computed value clearly with appropriate precision. Be concise and ensure the numerical result is unambiguous.",
    b_system: "You are an operations expert. Given the statistical analysis from a specialist, extract the key value and compute the final decision value. Show your calculation.",
  },
  "mutual": {
    b_capability: `I am an operations/decision-making expert. My capabilities:
- Cost calculations (multiplication, addition, thresholds)
- Optimization (EOQ, newsvendor model, min-cost search)
- Decision logic (if rate > threshold, then action A, else action B)

What I need from you:
- The exact numerical value with FULL decimal precision (do NOT round)
- If there are multiple values (e.g., mean AND std deviation), state each clearly
- Label your values explicitly (e.g., "defect_rate = 0.03200")
- If the value is close to a decision threshold, mention this`,
    a_system: `You are a statistics expert communicating with an operations/decision expert. They have sent you their capability summary below. Read it carefully and adapt your output to their needs. Provide maximum precision on numerical values. Do NOT round intermediate results.`,
    b_system: `You are an operations/decision expert. You previously shared your capability summary with the data analyst. They are a statistics expert who has adapted their output for your needs. Trust their computed values and use them directly in your calculations. Show your work step by step.`,
  },
};

// ── Run all conditions ──
async function runExperiment() {
  const results = {};
  const allDetails = {};

  // ═══ Condition 1: No Context ═══
  console.log("\n" + "=".repeat(60));
  console.log("CONDITION 1: No Context");
  console.log("=".repeat(60));

  let details = [];
  for (const p of PROBLEMS) {
    process.stdout.write(`  Problem ${p.id}...`);
    const r = await runProblem(p, CONDITIONS.no_context.a_system, CONDITIONS.no_context.b_system);
    const aCorrect = grade(r.a_value, p.intermediate_answer);
    const bCorrect = grade(r.b_value, p.final_answer);
    const score = aCorrect ? (bCorrect ? 1.0 : 0.5) : 0.0;
    details.push({ ...r, problem_id: p.id, a_correct: aCorrect, b_correct: bCorrect, score });
    console.log(` A=${r.a_value?.toFixed(4) ?? 'null'} (${aCorrect?'OK':'FAIL'}), B=${r.b_value?.toFixed(2) ?? 'null'} (${bCorrect?'OK':'FAIL'}) score=${score}`);
  }
  allDetails["no_context"] = details;

  // ═══ Condition 2: One-Way ═══
  console.log("\n" + "=".repeat(60));
  console.log("CONDITION 2: One-Way Context");
  console.log("=".repeat(60));

  details = [];
  for (const p of PROBLEMS) {
    process.stdout.write(`  Problem ${p.id}...`);
    const r = await runProblem(p, CONDITIONS.one_way.a_system, CONDITIONS.one_way.b_system);
    const aCorrect = grade(r.a_value, p.intermediate_answer);
    const bCorrect = grade(r.b_value, p.final_answer);
    const score = aCorrect ? (bCorrect ? 1.0 : 0.5) : 0.0;
    details.push({ ...r, problem_id: p.id, a_correct: aCorrect, b_correct: bCorrect, score });
    console.log(` A=${r.a_value?.toFixed(4) ?? 'null'} (${aCorrect?'OK':'FAIL'}), B=${r.b_value?.toFixed(2) ?? 'null'} (${bCorrect?'OK':'FAIL'}) score=${score}`);
  }
  allDetails["one_way"] = details;

  // ═══ Condition 3: Mutual ═══
  console.log("\n" + "=".repeat(60));
  console.log("CONDITION 3: Mutual Context");
  console.log("=".repeat(60));

  details = [];
  for (const p of PROBLEMS) {
    process.stdout.write(`  Problem ${p.id}...`);
    const r = await runProblem(
      p,
      CONDITIONS.mutual.a_system,
      CONDITIONS.mutual.b_system,
      `Capability summary from your partner (the operations expert):\n${CONDITIONS.mutual.b_capability}`,
      ""
    );
    const aCorrect = grade(r.a_value, p.intermediate_answer);
    const bCorrect = grade(r.b_value, p.final_answer);
    const score = aCorrect ? (bCorrect ? 1.0 : 0.5) : 0.0;
    details.push({ ...r, problem_id: p.id, a_correct: aCorrect, b_correct: bCorrect, score });
    console.log(` A=${r.a_value?.toFixed(4) ?? 'null'} (${aCorrect?'OK':'FAIL'}), B=${r.b_value?.toFixed(2) ?? 'null'} (${bCorrect?'OK':'FAIL'}) score=${score}`);
  }
  allDetails["mutual"] = details;

  // ═══ Condition 4: Progressive (3 Rounds) ═══
  console.log("\n" + "=".repeat(60));
  console.log("CONDITION 4: Progressive (3 Rounds)");
  console.log("=".repeat(60));

  allDetails["progressive"] = { rounds: [] };

  let aInferredAboutB = "";
  let bInferredAboutA = "";

  for (let round = 1; round <= 3; round++) {
    console.log(`\n--- Round ${round} ---`);
    details = [];

    let aSys, bSys, aPre = "", bPre = "";

    if (round === 1) {
      // Same as no_context
      aSys = CONDITIONS.no_context.a_system;
      bSys = CONDITIONS.no_context.b_system;
    } else {
      // Build adapted prompts from previous round analysis
      aSys = `You are a statistics expert. Based on previous interactions, here is what you know about your partner:\n${aInferredAboutB}\n\nAdapt your output accordingly. Provide numerical values with the precision and format that would be most useful for your partner.`;
      bSys = `You are an operations/decision expert. Based on previous interactions, here is what you know about your partner:\n${bInferredAboutA}\n\nUse their analysis to compute the final answer.`;
    }

    for (const p of PROBLEMS) {
      process.stdout.write(`  R${round} P${p.id}...`);
      const r = await runProblem(p, aSys, bSys, aPre, bPre);
      const aCorrect = grade(r.a_value, p.intermediate_answer);
      const bCorrect = grade(r.b_value, p.final_answer);
      const score = aCorrect ? (bCorrect ? 1.0 : 0.5) : 0.0;
      details.push({ ...r, problem_id: p.id, a_correct: aCorrect, b_correct: bCorrect, score });
      console.log(` A=${r.a_value?.toFixed(4) ?? 'null'} (${aCorrect?'OK':'FAIL'}), B=${r.b_value?.toFixed(2) ?? 'null'} (${bCorrect?'OK':'FAIL'}) score=${score}`);
    }

    allDetails["progressive"].rounds.push(details);

    // After each round, infer partner capabilities
    if (round < 3) {
      // A infers about B from B's outputs
      const bOutputSamples = details.slice(0, 5).map(d =>
        `Problem: ${PROBLEMS[d.problem_id-1].title}\nB's work: ${d.b_output.substring(0, 300)}`
      ).join("\n---\n");

      const inferA = await chat("gpt-4o", [
        { role: "system", content: "Analyze the following outputs from a partner agent. Infer their expertise, what calculations they perform, and what input format/precision they need from you. Be specific about precision requirements." },
        { role: "user", content: `Here are samples of my partner's work:\n${bOutputSamples}\n\nWhat can I infer about their capabilities and needs?` }
      ]);
      aInferredAboutB = inferA.content;

      // B infers about A from A's outputs
      const aOutputSamples = details.slice(0, 5).map(d =>
        `Problem: ${PROBLEMS[d.problem_id-1].title}\nA's work: ${d.a_output.substring(0, 300)}`
      ).join("\n---\n");

      const inferB = await chat("gpt-4o-mini", [
        { role: "system", content: "Analyze the following outputs from a partner agent. Infer their expertise and reliability. Summarize what you know about them." },
        { role: "user", content: `Here are samples of my partner's work:\n${aOutputSamples}\n\nWhat can I infer about their expertise?` }
      ]);
      bInferredAboutA = inferB.content;

      console.log(`\n  A's inference about B: ${aInferredAboutB.substring(0, 150)}...`);
      console.log(`  B's inference about A: ${bInferredAboutA.substring(0, 150)}...`);
    }
  }

  // ═══ Aggregate results ═══
  console.log("\n\n" + "=".repeat(70));
  console.log("AGGREGATE RESULTS");
  console.log("=".repeat(70));

  const summary = {};

  for (const cond of ["no_context", "one_way", "mutual"]) {
    const d = allDetails[cond];
    const aTokens = d.reduce((s, x) => s + x.a_usage.total_tokens, 0);
    const bTokens = d.reduce((s, x) => s + x.b_usage.total_tokens, 0);
    const aOutTok = d.reduce((s, x) => s + x.a_usage.completion_tokens, 0);
    const aInTok = d.reduce((s, x) => s + x.a_usage.prompt_tokens, 0);
    const bOutTok = d.reduce((s, x) => s + x.b_usage.completion_tokens, 0);
    const bInTok = d.reduce((s, x) => s + x.b_usage.prompt_tokens, 0);

    const aAcc = d.filter(x => x.a_correct).length / d.length;
    const bAcc = d.filter(x => x.b_correct).length / d.length;
    const avgScore = d.reduce((s, x) => s + x.score, 0) / d.length;

    const totalCost = cost("gpt-4o", aInTok, aOutTok) + cost("gpt-4o-mini", bInTok, bOutTok);

    summary[cond] = {
      a_accuracy: aAcc,
      b_accuracy: bAcc,
      avg_score: avgScore,
      a_output_tokens: aOutTok,
      b_output_tokens: bOutTok,
      total_tokens: aTokens + bTokens,
      total_cost: totalCost,
    };

    console.log(`\n${cond.toUpperCase()}`);
    console.log(`  A accuracy:     ${(aAcc*100).toFixed(1)}% (${d.filter(x=>x.a_correct).length}/${d.length})`);
    console.log(`  B accuracy:     ${(bAcc*100).toFixed(1)}% (${d.filter(x=>x.b_correct).length}/${d.length})`);
    console.log(`  Avg score:      ${avgScore.toFixed(3)}`);
    console.log(`  A output tokens: ${aOutTok}`);
    console.log(`  B output tokens: ${bOutTok}`);
    console.log(`  Total tokens:   ${aTokens + bTokens}`);
    console.log(`  Total cost:     $${totalCost.toFixed(4)}`);
  }

  // Progressive rounds
  console.log(`\nPROGRESSIVE (per round)`);
  summary["progressive"] = { rounds: [] };
  for (let r = 0; r < 3; r++) {
    const d = allDetails["progressive"].rounds[r];
    const aTokens = d.reduce((s, x) => s + x.a_usage.total_tokens, 0);
    const bTokens = d.reduce((s, x) => s + x.b_usage.total_tokens, 0);
    const aOutTok = d.reduce((s, x) => s + x.a_usage.completion_tokens, 0);
    const aInTok = d.reduce((s, x) => s + x.a_usage.prompt_tokens, 0);
    const bOutTok = d.reduce((s, x) => s + x.b_usage.completion_tokens, 0);
    const bInTok = d.reduce((s, x) => s + x.b_usage.prompt_tokens, 0);

    const aAcc = d.filter(x => x.a_correct).length / d.length;
    const bAcc = d.filter(x => x.b_correct).length / d.length;
    const avgScore = d.reduce((s, x) => s + x.score, 0) / d.length;
    const totalCost = cost("gpt-4o", aInTok, aOutTok) + cost("gpt-4o-mini", bInTok, bOutTok);

    summary["progressive"].rounds.push({
      round: r + 1,
      a_accuracy: aAcc,
      b_accuracy: bAcc,
      avg_score: avgScore,
      a_output_tokens: aOutTok,
      b_output_tokens: bOutTok,
      total_tokens: aTokens + bTokens,
      total_cost: totalCost,
    });

    console.log(`  Round ${r+1}: A_acc=${(aAcc*100).toFixed(1)}%, B_acc=${(bAcc*100).toFixed(1)}%, score=${avgScore.toFixed(3)}, tokens=${aTokens+bTokens}, cost=$${totalCost.toFixed(4)}`);
  }

  // ── Per-problem breakdown ──
  console.log("\n" + "=".repeat(70));
  console.log("PER-PROBLEM BREAKDOWN");
  console.log("=".repeat(70));
  console.log(String("ID").padEnd(4) + String("Category").padEnd(24) + String("NoCtx").padEnd(8) + String("1Way").padEnd(8) + String("Mutual").padEnd(8) + String("Prog1").padEnd(8) + String("Prog2").padEnd(8) + String("Prog3").padEnd(8));
  console.log("-".repeat(68));
  for (const p of PROBLEMS) {
    const nc = allDetails["no_context"].find(d => d.problem_id === p.id)?.score ?? "-";
    const ow = allDetails["one_way"].find(d => d.problem_id === p.id)?.score ?? "-";
    const mu = allDetails["mutual"].find(d => d.problem_id === p.id)?.score ?? "-";
    const p1 = allDetails["progressive"].rounds[0].find(d => d.problem_id === p.id)?.score ?? "-";
    const p2 = allDetails["progressive"].rounds[1].find(d => d.problem_id === p.id)?.score ?? "-";
    const p3 = allDetails["progressive"].rounds[2].find(d => d.problem_id === p.id)?.score ?? "-";
    console.log(
      String(p.id).padEnd(4) +
      p.category.substring(0, 22).padEnd(24) +
      String(nc).padEnd(8) +
      String(ow).padEnd(8) +
      String(mu).padEnd(8) +
      String(p1).padEnd(8) +
      String(p2).padEnd(8) +
      String(p3).padEnd(8)
    );
  }

  // ═══ Save JSON ═══
  const output = {
    experiment: "KI-1 Mutual Cognitive Context Inference - Two-Stage Numeric (v4)",
    timestamp: new Date().toISOString(),
    models: { agent_a: "gpt-4o", agent_b: "gpt-4o-mini" },
    problems: PROBLEMS.map(p => ({
      id: p.id,
      category: p.category,
      title: p.title,
      input_data: p.input_data,
      a_task: p.a_task,
      b_task: p.b_task,
      intermediate_answer: p.intermediate_answer,
      final_answer: p.final_answer,
      precision_sensitive: p.precision_sensitive,
      notes: p.notes,
    })),
    conditions: {
      no_context: {
        description: "A and B have no knowledge of each other's role or expertise",
        ...summary["no_context"],
        details: allDetails["no_context"].map(d => ({
          problem_id: d.problem_id,
          a_value: d.a_value,
          b_value: d.b_value,
          a_correct: d.a_correct,
          b_correct: d.b_correct,
          score: d.score,
          a_tokens: d.a_usage.total_tokens,
          b_tokens: d.b_usage.total_tokens,
          a_output: d.a_output,
          b_output: d.b_output,
        })),
      },
      one_way: {
        description: "A knows B is an operations expert; B knows A is a statistics expert",
        ...summary["one_way"],
        details: allDetails["one_way"].map(d => ({
          problem_id: d.problem_id,
          a_value: d.a_value,
          b_value: d.b_value,
          a_correct: d.a_correct,
          b_correct: d.b_correct,
          score: d.score,
          a_tokens: d.a_usage.total_tokens,
          b_tokens: d.b_usage.total_tokens,
          a_output: d.a_output,
          b_output: d.b_output,
        })),
      },
      mutual: {
        description: "B sends capability summary to A; both know each other's expertise",
        ...summary["mutual"],
        details: allDetails["mutual"].map(d => ({
          problem_id: d.problem_id,
          a_value: d.a_value,
          b_value: d.b_value,
          a_correct: d.a_correct,
          b_correct: d.b_correct,
          score: d.score,
          a_tokens: d.a_usage.total_tokens,
          b_tokens: d.b_usage.total_tokens,
          a_output: d.a_output,
          b_output: d.b_output,
        })),
      },
      progressive: {
        description: "3 rounds, starting from no context, inferring partner capabilities each round",
        ...summary["progressive"],
        rounds: allDetails["progressive"].rounds.map((rd, ri) => ({
          round: ri + 1,
          ...summary["progressive"].rounds[ri],
          details: rd.map(d => ({
            problem_id: d.problem_id,
            a_value: d.a_value,
            b_value: d.b_value,
            a_correct: d.a_correct,
            b_correct: d.b_correct,
            score: d.score,
            a_tokens: d.a_usage.total_tokens,
            b_tokens: d.b_usage.total_tokens,
            a_output: d.a_output,
            b_output: d.b_output,
          })),
        })),
      },
    },
    summary: {
      no_context: summary["no_context"],
      one_way: summary["one_way"],
      mutual: summary["mutual"],
      progressive: summary["progressive"],
    },
  };

  fs.writeFileSync("C:/Users/hyunj/wcisl/scripts/ki1_v4_results.json", JSON.stringify(output, null, 2));
  console.log("\nResults saved to C:/Users/hyunj/wcisl/scripts/ki1_v4_results.json");
}

runExperiment().catch(console.error);
