// KI-1 Natural Token Experiment: Mutual Cognition reduces tokens AND improves accuracy
// NO max_tokens — let Agent A freely decide how much to write
// All agents: GPT-4o, temperature=0, batch 3

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read API key
const envPath = 'C:\\Users\\hyunj\\studyeng\\.env.local';
const envContent = fs.readFileSync(envPath, 'utf-8');
const API_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) throw new Error('No API key found');

const MODEL = 'gpt-4o';
const TEMP = 0;

// ============================================================
// 15 PROBLEMS — each with 15-20 data points, B needs 2-5
// ============================================================
const PROBLEMS = [
  {
    id: 1,
    domain: 'Corporate Finance',
    dataset: 'Revenue=$12M, COGS=$7.2M, SGA=$1.8M, RnD=$600K, Interest=$400K, Tax_Rate=28%, Depreciation=$500K, Amortization=$200K, Total_Assets=$25M, Current_Assets=$8M, Fixed_Assets=$15M, Intangibles=$2M, Current_Liabilities=$5M, LongTerm_Debt=$8M, Equity=$12M, Shares_Outstanding=2M, Dividends=$600K, CapEx=$1.5M, Working_Capital_Change=$300K, Cash=$1.5M',
    dataCount: 20,
    bTask: 'Compute the Debt-to-Equity Ratio = LongTerm_Debt / Equity',
    bNeeds: 'LongTerm_Debt=$8M, Equity=$12M',
    formula: 'LongTerm_Debt / Equity',
    answer: 0.667,
    tolerance: 0.1,
    generalArea: 'financial ratios and leverage analysis',
    bRequest: 'I need LongTerm_Debt and Equity values to compute Debt-to-Equity Ratio = LongTerm_Debt / Equity.'
  },
  {
    id: 2,
    domain: 'Manufacturing',
    dataset: 'Production_Rate=500units/hr, Defect_Rate=2.5%, Rework_Rate=1.5%, Scrap_Rate=1.0%, Material_Cost=$15/unit, Labor_Cost=$8/unit, Overhead=$3/unit, Energy=$2/unit, Maintenance=$50K/month, Downtime=5%, Shift_Hours=8, Shifts_Per_Day=3, Workers=120, Machines=25, Capacity_Utilization=85%, Safety_Incidents=3/yr, Waste_Rate=4%, Quality_Score=94',
    dataCount: 18,
    bTask: 'Compute Good Units Per Day = Production_Rate × (1 - Defect_Rate) × Shift_Hours × Shifts_Per_Day × (1 - Downtime)',
    bNeeds: 'Production_Rate=500, Defect_Rate=2.5%, Shift_Hours=8, Shifts_Per_Day=3, Downtime=5%',
    formula: '500 × 0.975 × 8 × 3 × 0.95',
    answer: 11115,
    tolerance: 0.10,
    generalArea: 'production output and efficiency metrics',
    bRequest: 'I need Production_Rate, Defect_Rate, Shift_Hours, Shifts_Per_Day, and Downtime to compute Good Units Per Day = Production_Rate × (1 - Defect_Rate) × Shift_Hours × Shifts_Per_Day × (1 - Downtime).'
  },
  {
    id: 3,
    domain: 'Healthcare',
    dataset: 'Beds=500, Occupancy=78%, Avg_Stay=4.2days, Admissions=3400/month, ER_Visits=8500/month, Surgery=600/month, Outpatient=12000/month, Staff_Doctors=200, Nurses=600, Admin=150, Budget=$50M/month, Revenue=$55M/month, Insurance_Claims=$45M, Patient_Satisfaction=4.2/5, Readmission_Rate=8%, Mortality_Rate=1.2%, Infection_Rate=0.5%, Wait_Time_ER=45min',
    dataCount: 18,
    bTask: 'Compute Bed Turnover Rate = Admissions / Beds',
    bNeeds: 'Admissions=3400, Beds=500',
    formula: '3400 / 500',
    answer: 6.8,
    tolerance: 0.10,
    generalArea: 'hospital capacity and utilization metrics',
    bRequest: 'I need Admissions per month and total Beds to compute Bed Turnover Rate = Admissions / Beds.'
  },
  {
    id: 4,
    domain: 'Investment Portfolio',
    dataset: 'Stock_A_Return=12%, Stock_A_Weight=30%, Stock_A_Std=25%, Stock_B_Return=8%, Stock_B_Weight=25%, Stock_B_Std=15%, Bond_C_Return=4%, Bond_C_Weight=20%, Bond_C_Std=5%, REIT_D_Return=9%, REIT_D_Weight=15%, REIT_D_Std=18%, Cash_Return=2%, Cash_Weight=10%, Cash_Std=0%, Corr_AB=0.6, Corr_AC=-0.2, Corr_AD=0.4, Risk_Free=3%, Benchmark_Return=10%',
    dataCount: 20,
    bTask: 'Compute Portfolio Expected Return = sum of (Weight_i × Return_i) for all 5 assets',
    bNeeds: 'Stock_A: 30%×12%, Stock_B: 25%×8%, Bond_C: 20%×4%, REIT_D: 15%×9%, Cash: 10%×2%',
    formula: '0.30×12 + 0.25×8 + 0.20×4 + 0.15×9 + 0.10×2',
    answer: 7.95,
    tolerance: 0.10,
    generalArea: 'portfolio return and risk analysis',
    bRequest: 'I need the weight and return for each asset (Stock_A, Stock_B, Bond_C, REIT_D, Cash) to compute Portfolio Expected Return = sum of Weight_i × Return_i.'
  },
  {
    id: 5,
    domain: 'City Demographics',
    dataset: 'Population=850000, Area=350km2, Density=2429/km2, Growth_Rate=1.8%, Median_Age=34, Under18=22%, Over65=14%, Median_Income=$52000, Unemployment=5.5%, Poverty_Rate=12%, College_Educated=38%, Homeownership=55%, Avg_Rent=$1200, Crime_Rate=4.2/1000, Schools=120, Hospitals=8, Parks=45, Public_Transit_Ridership=150000/day',
    dataCount: 18,
    bTask: 'Compute Number of people over 65 = Population × Over65_Pct',
    bNeeds: 'Population=850000, Over65=14%',
    formula: '850000 × 0.14',
    answer: 119000,
    tolerance: 0.10,
    generalArea: 'population age distribution and demographics',
    bRequest: 'I need Population and Over65 percentage to compute Number of people over 65 = Population × Over65_Pct.'
  },
  {
    id: 6,
    domain: 'Logistics',
    dataset: 'Warehouses=12, Total_Inventory=500000units, Avg_Order_Size=150units, Orders_Per_Day=2200, Fulfillment_Rate=96%, Return_Rate=3.5%, Shipping_Cost_Avg=$8.50/order, Avg_Delivery_Days=3.2, Fleet_Size=85trucks, Truck_Capacity=500units, Fuel_Cost=$0.45/mile, Avg_Route_Miles=120, Drivers=95, Loading_Time=45min, Sorting_Errors=0.8%, Packaging_Cost=$1.20/unit, Cross_Dock_Pct=35%, Last_Mile_Cost=$4.50',
    dataCount: 18,
    bTask: 'Compute Daily Shipping Revenue Needed = Orders_Per_Day × Shipping_Cost_Avg',
    bNeeds: 'Orders_Per_Day=2200, Shipping_Cost_Avg=$8.50',
    formula: '2200 × 8.50',
    answer: 18700,
    tolerance: 0.10,
    generalArea: 'order fulfillment and shipping cost analysis',
    bRequest: 'I need Orders_Per_Day and Shipping_Cost_Avg to compute Daily Shipping Revenue Needed = Orders_Per_Day × Shipping_Cost_Avg.'
  },
  {
    id: 7,
    domain: 'Energy Utility',
    dataset: 'Total_Capacity=5000MW, Solar=800MW, Wind=600MW, Natural_Gas=2200MW, Nuclear=1000MW, Hydro=400MW, Peak_Demand=4200MW, Avg_Demand=3100MW, Transmission_Loss=6%, Grid_Length=12000km, Customers=1800000, Residential=1500000, Commercial=250000, Industrial=50000, Avg_Rate=$0.12/kWh, Revenue=$2.8B/yr, Maintenance=$400M/yr, Fuel_Cost=$800M/yr, Renewable_Pct=36%, Carbon_Emissions=15M_tons/yr',
    dataCount: 19,
    bTask: 'Compute Reserve Margin = (Total_Capacity - Peak_Demand) / Peak_Demand × 100%',
    bNeeds: 'Total_Capacity=5000MW, Peak_Demand=4200MW',
    formula: '(5000 - 4200) / 4200 × 100',
    answer: 19.05,
    tolerance: 0.10,
    generalArea: 'grid capacity and reliability planning',
    bRequest: 'I need Total_Capacity and Peak_Demand to compute Reserve Margin = (Total_Capacity - Peak_Demand) / Peak_Demand × 100%.'
  },
  {
    id: 8,
    domain: 'Agriculture',
    dataset: 'Total_Acreage=2500acres, Corn=800acres, Wheat=600acres, Soy=500acres, Cotton=400acres, Fallow=200acres, Corn_Yield=180bu/acre, Wheat_Yield=55bu/acre, Soy_Yield=50bu/acre, Cotton_Yield=900lb/acre, Corn_Price=$5.80/bu, Wheat_Price=$7.20/bu, Soy_Price=$13.50/bu, Cotton_Price=$0.85/lb, Fertilizer_Cost=$120/acre, Irrigation_Cost=$80/acre, Labor=$200K/yr, Equipment=$150K/yr, Crop_Insurance=$45K/yr, Soil_pH=6.5',
    dataCount: 20,
    bTask: 'Compute Gross Corn Revenue = Corn_Acreage × Corn_Yield × Corn_Price',
    bNeeds: 'Corn=800acres, Corn_Yield=180bu/acre, Corn_Price=$5.80/bu',
    formula: '800 × 180 × 5.80',
    answer: 835200,
    tolerance: 0.10,
    generalArea: 'crop yield and revenue projections',
    bRequest: 'I need Corn acreage, Corn_Yield (bu/acre), and Corn_Price ($/bu) to compute Gross Corn Revenue = Corn_Acreage × Corn_Yield × Corn_Price.'
  },
  {
    id: 9,
    domain: 'Retail Chain',
    dataset: 'Stores=450, Avg_Store_Size=25000sqft, Total_Employees=18000, Revenue=$4.2B, COGS=$2.8B, Gross_Margin=33.3%, Inventory_Turnover=8.5, Avg_Transaction=$45, Transactions_Per_Day=12000, Loyalty_Members=5M, Online_Revenue=$800M, Online_Pct=19%, Shrinkage=1.5%, Rent_Avg=$25/sqft/yr, Marketing=$200M/yr, Same_Store_Growth=3.2%, Customer_Satisfaction=4.1/5, Foot_Traffic=2M/week',
    dataCount: 18,
    bTask: 'Compute Revenue Per Store = Total_Revenue / Stores',
    bNeeds: 'Revenue=$4.2B, Stores=450',
    formula: '4200000000 / 450',
    answer: 9333333,
    tolerance: 0.10,
    generalArea: 'store performance and sales metrics',
    bRequest: 'I need Total Revenue and number of Stores to compute Revenue Per Store = Total_Revenue / Stores.'
  },
  {
    id: 10,
    domain: 'University',
    dataset: 'Students=35000, Undergrad=25000, Grad=8000, PhD=2000, Faculty=2200, Staff=3500, Tuition_Undergrad=$42000/yr, Tuition_Grad=$38000/yr, Acceptance_Rate=22%, Yield_Rate=45%, Retention_Rate=94%, Graduation_Rate_4yr=82%, Endowment=$8.5B, Research_Funding=$600M, Dorms=8000beds, Dining_Plans=12000, Athletics_Budget=$120M, Library_Books=4M, Alumni=250000',
    dataCount: 19,
    bTask: 'Compute Student-to-Faculty Ratio = Total_Students / Faculty',
    bNeeds: 'Students=35000, Faculty=2200',
    formula: '35000 / 2200',
    answer: 15.91,
    tolerance: 0.10,
    generalArea: 'enrollment and academic resource allocation',
    bRequest: 'I need Total Students and Faculty count to compute Student-to-Faculty Ratio = Total_Students / Faculty.'
  },
  {
    id: 11,
    domain: 'Professional Sports Team',
    dataset: 'Roster=53players, Salary_Cap=$225M, Total_Payroll=$218M, Avg_Salary=$4.1M, Highest_Salary=$35M, Revenue=$550M, Ticket_Revenue=$180M, Broadcast=$200M, Merchandise=$80M, Sponsorship=$60M, Stadium_Capacity=72000, Avg_Attendance=68500, Season_Tickets=55000, Win_Pct=0.625, Playoffs_Made=8of10, Coaching_Staff=25, Training_Staff=15, Scouting_Budget=$12M, Draft_Picks=7',
    dataCount: 19,
    bTask: 'Compute Attendance Rate = Avg_Attendance / Stadium_Capacity × 100%',
    bNeeds: 'Avg_Attendance=68500, Stadium_Capacity=72000',
    formula: '68500 / 72000 × 100',
    answer: 95.14,
    tolerance: 0.10,
    generalArea: 'team revenue and fan engagement metrics',
    bRequest: 'I need Avg_Attendance and Stadium_Capacity to compute Attendance Rate = Avg_Attendance / Stadium_Capacity × 100%.'
  },
  {
    id: 12,
    domain: 'Weather Station',
    dataset: 'Avg_Temp=72F, Max_Temp=98F, Min_Temp=45F, Humidity=65%, Pressure=1013hPa, Wind_Speed=12mph, Wind_Gusts=35mph, Precipitation=4.2in/month, Rainy_Days=11/month, Sunshine_Hours=240/month, UV_Index=7, Dew_Point=58F, Cloud_Cover=40%, Visibility=10mi, Pollen_Count=8.5, Air_Quality_Index=42, Snow_Days=0, Fog_Days=3, Storm_Days=2',
    dataCount: 19,
    bTask: 'Compute Temperature Range = Max_Temp - Min_Temp',
    bNeeds: 'Max_Temp=98F, Min_Temp=45F',
    formula: '98 - 45',
    answer: 53,
    tolerance: 0.10,
    generalArea: 'temperature patterns and climate analysis',
    bRequest: 'I need Max_Temp and Min_Temp to compute Temperature Range = Max_Temp - Min_Temp.'
  },
  {
    id: 13,
    domain: 'Telecom Provider',
    dataset: 'Subscribers=25M, Prepaid=10M, Postpaid=15M, ARPU=$55, Churn_Rate=1.8%/month, Network_Towers=45000, Coverage_Area=95%, 5G_Towers=12000, 5G_Coverage=55%, Data_Usage_Avg=15GB/month, Voice_Minutes_Avg=300/month, SMS_Avg=50/month, Revenue=$16.5B, Network_Investment=$3B, Customer_Acquisition_Cost=$350, Customer_Service_Calls=2M/month, Satisfaction=3.8/5, Roaming_Revenue=$400M',
    dataCount: 18,
    bTask: 'Compute Monthly Revenue from ARPU = Subscribers × ARPU',
    bNeeds: 'Subscribers=25M, ARPU=$55',
    formula: '25000000 × 55',
    answer: 1375000000,
    tolerance: 0.10,
    generalArea: 'subscriber revenue and network utilization',
    bRequest: 'I need total Subscribers and ARPU to compute Monthly Revenue from ARPU = Subscribers × ARPU.'
  },
  {
    id: 14,
    domain: 'Airline',
    dataset: 'Fleet=320aircraft, Routes=500, Daily_Flights=2800, Passengers_Annual=95M, Load_Factor=84%, Avg_Fare=$285, Revenue=$28B, Fuel_Cost=$8B, Labor_Cost=$7B, Maintenance=$2.5B, Leasing=$3B, Avg_Flight_Distance=1200mi, On_Time=78%, Baggage_Mishandled=2.5/1000, Hubs=5, Lounges=12, Loyalty_Members=45M, Int_Revenue_Pct=40%, Cargo_Revenue=$1.2B',
    dataCount: 19,
    bTask: 'Compute Revenue Per Passenger = Annual_Revenue / Annual_Passengers',
    bNeeds: 'Revenue=$28B, Passengers_Annual=95M',
    formula: '28000000000 / 95000000',
    answer: 294.74,
    tolerance: 0.10,
    generalArea: 'passenger yield and route profitability',
    bRequest: 'I need Annual Revenue and Annual Passengers to compute Revenue Per Passenger = Annual_Revenue / Annual_Passengers.'
  },
  {
    id: 15,
    domain: 'Real Estate Developer',
    dataset: 'Projects_Active=18, Total_Units=4500, Sold_Units=3200, Avg_Price=$450K, Revenue_YTD=$1.44B, Land_Cost=$200M, Construction_Cost=$800M, Marketing=$50M, Permits=$25M, Avg_SqFt=1800, Cost_Per_SqFt=$165, Completion_Rate=72%, Avg_Days_On_Market=45, Mortgage_Rate=6.5%, Commercial_SqFt=500000, Occupancy_Commercial=88%, Rental_Income=$35M/yr, ROI_Avg=18%, Debt=$600M, Equity=$400M',
    dataCount: 20,
    bTask: 'Compute Sell-Through Rate = Sold_Units / Total_Units × 100%',
    bNeeds: 'Sold_Units=3200, Total_Units=4500',
    formula: '3200 / 4500 × 100',
    answer: 71.11,
    tolerance: 0.10,
    generalArea: 'sales performance and project completion',
    bRequest: 'I need Sold_Units and Total_Units to compute Sell-Through Rate = Sold_Units / Total_Units × 100%.'
  }
];

// ============================================================
// API Call Helper
// ============================================================
async function callGPT(systemPrompt, userPrompt, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: TEMP,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
          // NO max_tokens — let it generate freely
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
          const wait = (attempt + 1) * 15000;
          console.log(`  Rate limited, waiting ${wait/1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      return {
        content: data.choices[0].message.content,
        tokens: data.usage.completion_tokens,
        prompt_tokens: data.usage.prompt_tokens,
        total_tokens: data.usage.total_tokens
      };
    } catch (e) {
      if (attempt === retries - 1) throw e;
      console.log(`  Retry ${attempt + 1}: ${e.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ============================================================
// Extract numeric answer from B's response
// ============================================================
function extractNumber(text) {
  // Look for -999 first (data not found)
  if (text.includes('-999')) return -999;

  // Remove formatting, commas, dollar signs, percent signs
  const cleaned = text.replace(/,/g, '').replace(/\$/g, '').replace(/%/g, '');

  // Try to find numbers in common patterns
  // Match patterns like "= 0.667" or "is 6.8" or "ratio is 0.667" or just standalone numbers
  const patterns = [
    /(?:=|is|equals|result|answer|ratio|rate|return|revenue|margin|range|value)[:\s]*([+-]?\d+\.?\d*(?:e[+-]?\d+)?)/gi,
    /\*\*([+-]?\d+\.?\d*(?:e[+-]?\d+)?)\*\*/g,
    /([+-]?\d+\.?\d*(?:e[+-]?\d+)?)/g
  ];

  let candidates = [];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(cleaned)) !== null) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val !== 0 && val !== -999) {
        candidates.push(val);
      }
    }
    if (candidates.length > 0) break;
  }

  // Return the last significant number found (usually the final answer)
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function checkAccuracy(extracted, expected, tolerance) {
  if (extracted === null || extracted === -999) return false;
  if (expected === 0) return Math.abs(extracted) < 0.01;
  const relError = Math.abs(extracted - expected) / Math.abs(expected);
  return relError <= tolerance;
}

// ============================================================
// Run a single problem under a condition
// ============================================================
async function runNoContext(problem) {
  const aSystem = `You are a data analyst. You received a comprehensive dataset about a ${problem.domain} operation. Write a thorough analytical report covering all key metrics, trends, and notable findings. Be comprehensive and leave nothing out. Present your analysis in a structured format.`;
  const aUser = `Here is the complete dataset:\n${problem.dataset}\n\nPlease provide a comprehensive analytical report covering all metrics.`;

  const aResult = await callGPT(aSystem, aUser);

  const bSystem = `You are a specialist calculator. Using ONLY the information provided in the report below, compute the requested value. If the exact data needed is not explicitly stated in the report, output -999. Show your calculation and give the final numeric answer.`;
  const bUser = `REPORT:\n${aResult.content}\n\nTASK: ${problem.bTask}\n\nCompute the answer using ONLY data from the report above. If needed data is missing, output -999.`;

  const bResult = await callGPT(bSystem, bUser);
  const extracted = extractNumber(bResult.content);
  const correct = checkAccuracy(extracted, problem.answer, problem.tolerance);

  return {
    aTokens: aResult.tokens,
    bAnswer: extracted,
    correct,
    aContent: aResult.content,
    bContent: bResult.content
  };
}

async function runOneWay(problem) {
  const aSystem = `You are a data analyst. The recipient is a ${problem.domain} specialist who needs data for ${problem.generalArea}. Highlight the data most relevant to their work. Be efficient — focus on what matters for their analysis, skip irrelevant details.`;
  const aUser = `Here is the complete dataset:\n${problem.dataset}\n\nPrepare a focused summary for the specialist.`;

  const aResult = await callGPT(aSystem, aUser);

  const bSystem = `You are a specialist calculator. Using ONLY the information provided in the summary below, compute the requested value. If the exact data needed is not explicitly stated, output -999. Show your calculation and give the final numeric answer.`;
  const bUser = `SUMMARY:\n${aResult.content}\n\nTASK: ${problem.bTask}\n\nCompute the answer using ONLY data from the summary above. If needed data is missing, output -999.`;

  const bResult = await callGPT(bSystem, bUser);
  const extracted = extractNumber(bResult.content);
  const correct = checkAccuracy(extracted, problem.answer, problem.tolerance);

  return {
    aTokens: aResult.tokens,
    bAnswer: extracted,
    correct,
    aContent: aResult.content,
    bContent: bResult.content
  };
}

async function runMutual(problem) {
  // B first tells A what it needs
  const aSystem = `You are a data analyst. The recipient has requested specific data. Send ONLY what they asked for, formatted as key=value pairs. Nothing else. No explanations, no analysis, no extra data.`;
  const aUser = `Dataset:\n${problem.dataset}\n\nRecipient's request: "${problem.bRequest}"\n\nSend only the requested data as key=value pairs.`;

  const aResult = await callGPT(aSystem, aUser);

  const bSystem = `You are a specialist calculator. Using ONLY the information provided below, compute the requested value. If the exact data needed is not explicitly stated, output -999. Show your calculation and give the final numeric answer.`;
  const bUser = `DATA:\n${aResult.content}\n\nTASK: ${problem.bTask}\n\nCompute the answer.`;

  const bResult = await callGPT(bSystem, bUser);
  const extracted = extractNumber(bResult.content);
  const correct = checkAccuracy(extracted, problem.answer, problem.tolerance);

  return {
    aTokens: aResult.tokens,
    bAnswer: extracted,
    correct,
    aContent: aResult.content,
    bContent: bResult.content
  };
}

async function runProgressiveRound(problem, round, prevBContent) {
  let aSystem, aUser;

  if (round === 1) {
    // Round 1 = same as No Context
    aSystem = `You are a data analyst. You received a comprehensive dataset about a ${problem.domain} operation. Write a thorough analytical report covering all key metrics, trends, and notable findings. Be comprehensive and leave nothing out.`;
    aUser = `Here is the complete dataset:\n${problem.dataset}\n\nPlease provide a comprehensive analytical report covering all metrics.`;
  } else if (round === 2) {
    aSystem = `You are a data analyst. You previously sent a comprehensive report to a specialist, but they couldn't find some data they needed. Based on their feedback, send a more targeted message. Focus on the specific metrics they seem to need.`;
    aUser = `Dataset:\n${problem.dataset}\n\nYour previous report was too verbose. The specialist's response was:\n"${prevBContent}"\n\nSend a more focused summary targeting what they actually need.`;
  } else {
    aSystem = `You are a data analyst. After two rounds, you now have a better sense of what the specialist needs. Send only the essential data points in a concise format. Be as brief as possible while ensuring the specialist has what they need.`;
    aUser = `Dataset:\n${problem.dataset}\n\nThe specialist previously responded:\n"${prevBContent}"\n\nSend only the essential data they need, as concisely as possible.`;
  }

  const aResult = await callGPT(aSystem, aUser);

  const bSystem = `You are a specialist calculator. Using ONLY the information provided below, compute the requested value. If the exact data needed is not explicitly stated, output -999. Show your calculation and give the final numeric answer.`;
  const bUser = `DATA FROM ANALYST:\n${aResult.content}\n\nTASK: ${problem.bTask}\n\nCompute the answer using ONLY the data provided. If needed data is missing, output -999.`;

  const bResult = await callGPT(bSystem, bUser);
  const extracted = extractNumber(bResult.content);
  const correct = checkAccuracy(extracted, problem.answer, problem.tolerance);

  return {
    aTokens: aResult.tokens,
    bAnswer: extracted,
    correct,
    aContent: aResult.content,
    bContent: bResult.content
  };
}

// ============================================================
// Batch runner — 3 at a time
// ============================================================
async function runBatch(tasks, batchSize = 3) {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
    if (i + batchSize < tasks.length) {
      await new Promise(r => setTimeout(r, 2000)); // brief pause between batches
    }
  }
  return results;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('=== KI-1 NATURAL TOKEN EXPERIMENT ===');
  console.log(`Model: ${MODEL} | Temperature: ${TEMP} | Problems: ${PROBLEMS.length}`);
  console.log('No max_tokens limit — measuring natural generation length\n');

  const allResults = {
    noContext: [],
    oneWay: [],
    mutual: [],
    progressive: { r1: [], r2: [], r3: [] }
  };

  // --- Condition 1: No Context ---
  console.log('--- CONDITION 1: No Context ---');
  const ncTasks = PROBLEMS.map(p => () => {
    console.log(`  [NC] Problem ${p.id}: ${p.domain}`);
    return runNoContext(p);
  });
  allResults.noContext = await runBatch(ncTasks);
  console.log('  Done.\n');

  // --- Condition 2: One-Way ---
  console.log('--- CONDITION 2: One-Way ---');
  const owTasks = PROBLEMS.map(p => () => {
    console.log(`  [OW] Problem ${p.id}: ${p.domain}`);
    return runOneWay(p);
  });
  allResults.oneWay = await runBatch(owTasks);
  console.log('  Done.\n');

  // --- Condition 3: Mutual ---
  console.log('--- CONDITION 3: Mutual ---');
  const muTasks = PROBLEMS.map(p => () => {
    console.log(`  [MU] Problem ${p.id}: ${p.domain}`);
    return runMutual(p);
  });
  allResults.mutual = await runBatch(muTasks);
  console.log('  Done.\n');

  // --- Condition 4: Progressive (3 rounds) ---
  console.log('--- CONDITION 4: Progressive (3 rounds) ---');

  // Round 1
  console.log('  Round 1...');
  const pr1Tasks = PROBLEMS.map(p => () => {
    console.log(`    [PR1] Problem ${p.id}: ${p.domain}`);
    return runProgressiveRound(p, 1, null);
  });
  allResults.progressive.r1 = await runBatch(pr1Tasks);

  // Round 2 — depends on R1 results
  console.log('  Round 2...');
  const pr2Tasks = PROBLEMS.map((p, i) => () => {
    console.log(`    [PR2] Problem ${p.id}: ${p.domain}`);
    return runProgressiveRound(p, 2, allResults.progressive.r1[i].bContent);
  });
  allResults.progressive.r2 = await runBatch(pr2Tasks);

  // Round 3 — depends on R2 results
  console.log('  Round 3...');
  const pr3Tasks = PROBLEMS.map((p, i) => () => {
    console.log(`    [PR3] Problem ${p.id}: ${p.domain}`);
    return runProgressiveRound(p, 3, allResults.progressive.r2[i].bContent);
  });
  allResults.progressive.r3 = await runBatch(pr3Tasks);
  console.log('  Done.\n');

  // ============================================================
  // ANALYSIS
  // ============================================================
  const analyze = (results, label) => {
    const tokens = results.map(r => r.aTokens);
    const accuracies = results.map(r => r.correct ? 1 : 0);
    const avgTokens = tokens.reduce((a, b) => a + b, 0) / tokens.length;
    const accuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length * 100;
    const minTokens = Math.min(...tokens);
    const maxTokens = Math.max(...tokens);
    return { label, avgTokens: Math.round(avgTokens), accuracy: Math.round(accuracy * 10) / 10, minTokens, maxTokens, correct: accuracies.filter(a => a === 1).length, total: results.length };
  };

  const nc = analyze(allResults.noContext, 'No Context');
  const ow = analyze(allResults.oneWay, 'One-Way');
  const mu = analyze(allResults.mutual, 'Mutual');
  const pr1 = analyze(allResults.progressive.r1, 'Progressive R1');
  const pr2 = analyze(allResults.progressive.r2, 'Progressive R2');
  const pr3 = analyze(allResults.progressive.r3, 'Progressive R3');

  console.log('=====================================================');
  console.log('              KI-1 RESULTS SUMMARY');
  console.log('=====================================================');
  console.log('');
  console.log('Condition        | Avg Tokens | Min | Max  | Accuracy  | Correct');
  console.log('-----------------|------------|-----|------|-----------|--------');
  for (const s of [nc, ow, mu, pr1, pr2, pr3]) {
    console.log(`${s.label.padEnd(17)}| ${String(s.avgTokens).padStart(10)} | ${String(s.minTokens).padStart(3)} | ${String(s.maxTokens).padStart(4)} | ${String(s.accuracy + '%').padStart(9)} | ${s.correct}/${s.total}`);
  }

  console.log('');
  console.log('--- Token Reduction ---');
  console.log(`No Context → Mutual: ${nc.avgTokens} → ${mu.avgTokens} tokens (${Math.round((1 - mu.avgTokens / nc.avgTokens) * 100)}% reduction)`);
  console.log(`No Context → One-Way: ${nc.avgTokens} → ${ow.avgTokens} tokens (${Math.round((1 - ow.avgTokens / nc.avgTokens) * 100)}% reduction)`);
  console.log('');
  console.log('--- Accuracy Change ---');
  console.log(`No Context → Mutual: ${nc.accuracy}% → ${mu.accuracy}% accuracy`);
  console.log(`Progressive R1→R3: ${pr1.accuracy}% → ${pr3.accuracy}% accuracy, ${pr1.avgTokens} → ${pr3.avgTokens} tokens`);

  // Per-problem detail
  console.log('\n--- Per-Problem Detail ---');
  console.log('ID | Domain           | NC Tok | OW Tok | MU Tok | NC Acc | OW Acc | MU Acc | Expected');
  console.log('---|------------------|--------|--------|--------|--------|--------|--------|--------');
  for (let i = 0; i < PROBLEMS.length; i++) {
    const p = PROBLEMS[i];
    const ncR = allResults.noContext[i];
    const owR = allResults.oneWay[i];
    const muR = allResults.mutual[i];
    console.log(
      `${String(p.id).padStart(2)} | ${p.domain.padEnd(16)} | ${String(ncR.aTokens).padStart(6)} | ${String(owR.aTokens).padStart(6)} | ${String(muR.aTokens).padStart(6)} | ${ncR.correct ? '  OK  ' : ' FAIL '} | ${owR.correct ? '  OK  ' : ' FAIL '} | ${muR.correct ? '  OK  ' : ' FAIL '} | ${p.answer}`
    );
  }

  // Save full results
  const output = {
    experiment: 'KI-1 Natural Token',
    model: MODEL,
    temperature: TEMP,
    timestamp: new Date().toISOString(),
    design: 'No max_tokens limit. Large datasets (15-20 points). B needs 2-5 specific values.',
    problems: PROBLEMS.map(p => ({ id: p.id, domain: p.domain, dataCount: p.dataCount, answer: p.answer, formula: p.formula })),
    summary: { noContext: nc, oneWay: ow, mutual: mu, progressiveR1: pr1, progressiveR2: pr2, progressiveR3: pr3 },
    perProblem: PROBLEMS.map((p, i) => ({
      id: p.id,
      domain: p.domain,
      expected: p.answer,
      noContext: { aTokens: allResults.noContext[i].aTokens, bAnswer: allResults.noContext[i].bAnswer, correct: allResults.noContext[i].correct },
      oneWay: { aTokens: allResults.oneWay[i].aTokens, bAnswer: allResults.oneWay[i].bAnswer, correct: allResults.oneWay[i].correct },
      mutual: { aTokens: allResults.mutual[i].aTokens, bAnswer: allResults.mutual[i].bAnswer, correct: allResults.mutual[i].correct },
      progressive: {
        r1: { aTokens: allResults.progressive.r1[i].aTokens, bAnswer: allResults.progressive.r1[i].bAnswer, correct: allResults.progressive.r1[i].correct },
        r2: { aTokens: allResults.progressive.r2[i].aTokens, bAnswer: allResults.progressive.r2[i].bAnswer, correct: allResults.progressive.r2[i].correct },
        r3: { aTokens: allResults.progressive.r3[i].aTokens, bAnswer: allResults.progressive.r3[i].bAnswer, correct: allResults.progressive.r3[i].correct }
      }
    }))
  };

  const outPath = path.join(__dirname, 'ki1_natural_results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
