#!/usr/bin/env node
'use strict';

/**
 * Triage Savings & Enterprise ROI Calculator
 *
 * Quantifies the dollar value of ThumbGate pre-action interdiction using industry
 * benchmarks from WHOOP and The New Stack:
 * - 96 engineering hours per vulnerability incident (3 days x 4 engineers)
 * - 4.5 engineering hours per agent bug / regression rollback
 * - Blended engineering cost ($125/hr default)
 */

const {
  BENCHMARK_TRIAGE_HOURS_PER_INCIDENT,
  GENERAL_INTERDICTION_HOURS_SAVED,
  DEFAULT_BLENDED_HOURLY_RATE,
} = require('./vulnerability-pre-action-diode');
const { calculateRevolutInferenceSavings } = require('./token-tco');

const PRICING_TIERS = Object.freeze({
  free: { name: 'Community', monthlyCost: 0, annualCost: 0 },
  pro: { name: 'Pro Firewall', monthlyCost: 19, annualCost: 149 },
  managed: { name: 'Managed Workflow Gate', monthlyCost: 499, annualCost: 499 },
  enterprise: { name: 'Enterprise Gateway', monthlyCost: 2500, annualCost: 27000 },
});

function calculateEnterpriseRoi(metrics = {}, options = {}) {
  const vulnInterdictions = Math.max(0, Number(metrics.vulnerabilities || metrics.vulnCount || 0));
  const generalInterdictions = Math.max(0, Number(metrics.general || metrics.interdictionsCount || 0));
  const hourlyRate = Number(options.hourlyRate) || DEFAULT_BLENDED_HOURLY_RATE;
  const tierKey = String(options.tier || 'pro').toLowerCase();
  const tier = PRICING_TIERS[tierKey] || PRICING_TIERS.pro;
  const timeframeMonths = Number(options.months) || 12;

  const vulnHrs = vulnInterdictions * BENCHMARK_TRIAGE_HOURS_PER_INCIDENT;
  const generalHrs = generalInterdictions * GENERAL_INTERDICTION_HOURS_SAVED;
  const totalHoursSaved = vulnHrs + generalHrs;

  const grossSavingsDollars = totalHoursSaved * hourlyRate;
  const totalCostDollars = tier.monthlyCost * timeframeMonths;
  const netSavingsDollars = grossSavingsDollars - totalCostDollars;
  const roiMultiplier = totalCostDollars > 0
    ? Number((grossSavingsDollars / totalCostDollars).toFixed(2))
    : grossSavingsDollars > 0 ? Infinity : 1.0;

  // Single vulnerability break-even analysis
  const valuePerVulnInterdiction = BENCHMARK_TRIAGE_HOURS_PER_INCIDENT * hourlyRate;
  const annualTierCost = tier.annualCost || (tier.monthlyCost * 12);
  const costForBreakEven = totalCostDollars > 0 ? totalCostDollars : annualTierCost;
  const vulnsToBreakEven = costForBreakEven > 0
    ? Number((costForBreakEven / valuePerVulnInterdiction).toFixed(2))
    : 0;

  return {
    tier: tier.name,
    timeframeMonths,
    hourlyRate,
    inputs: {
      vulnerabilityInterdictions: vulnInterdictions,
      generalInterdictions,
    },
    hoursSaved: {
      fromVulnerabilities: vulnHrs,
      fromGeneralRegressions: generalHrs,
      totalHours: totalHoursSaved,
    },
    economics: {
      grossSavingsDollars,
      totalCostDollars,
      netSavingsDollars,
      roiMultiplier,
      valuePerVulnPrevented: valuePerVulnInterdiction,
      annualCost: annualTierCost,
      vulnsToBreakEven,
    },
    pitchSummary: `Preventing just ${vulnsToBreakEven} critical vulnerabilities pays for ${tier.name} over ${timeframeMonths} months. Current metrics show $${grossSavingsDollars.toLocaleString()} in engineering time preserved.`,
  };
}

function runCli() {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const isWhoopModel = args.includes('--model-whoop');
  const isRevolutModel = args.includes('--model-revolut');

  if (isRevolutModel) {
    // Model Revolut's real-world deployment: 2,000 developers, 90% inference cost reduction,
    // self-hosted GLM on 56 B200 GPUs ($0.30/M vs $3.00/M), +70% lead time, +60% coding productivity.
    const devCountArg = args.find((a) => a.startsWith('--devs='));
    const devs = devCountArg ? parseInt(devCountArg.slice('--devs='.length), 10) : 2000;
    const revolutCase = calculateRevolutInferenceSavings({ developerCount: devs });

    if (isJson) {
      console.log(JSON.stringify(revolutCase, null, 2));
    } else {
      console.log('=== Revolut Enterprise AI Inference Model (1 Year) ===');
      console.log(`Organization: ${revolutCase.organization}`);
      console.log(`Developers: ${revolutCase.developerCount.toLocaleString()}`);
      console.log(`Total Monthly Tokens: ${revolutCase.totalMonthlyTokensM.toLocaleString()}M`);
      console.log(`Commercial Cost (Claude/GPT): $${revolutCase.economics.monthlyCommercialCost.toLocaleString()}/mo`);
      console.log(`Self-Hosted Cost (GLM on B200s): $${revolutCase.economics.monthlySelfHostedCost.toLocaleString()}/mo`);
      console.log(`Raw Inference Slashed: ${revolutCase.economics.rawInferenceReductionPct}% (10x cost cut)`);
      console.log(`Net Cost Reduction: ${revolutCase.economics.netCostReductionPct}% (after GPU capex)`);
      console.log(`Annual Token Savings: $${revolutCase.economics.annualCostSavings.toLocaleString()}/yr`);
      console.log(`GPU Cluster Payback: ${revolutCase.economics.paybackMonths} months`);
      console.log(`Coding Productivity Boost: +${revolutCase.productivity.codingTimeImprovementPct}%`);
      console.log(`Lead Time Acceleration: +${revolutCase.productivity.leadTimeImprovementPct}%`);
      console.log(`Annual Productive Value: $${revolutCase.productivity.annualProductivityValue.toLocaleString()}/yr`);
      console.log(`Total Annual Value: $${revolutCase.totalAnnualValue.toLocaleString()}/yr`);
      console.log(`Summary: ${revolutCase.summary}`);
    }
    return;
  }

  if (isWhoopModel) {
    // Model WHOOP's exact case study: 1 vulnerability every quarter (4/year), plus 24 agent PR bug interdictions
    const whoopCase = calculateEnterpriseRoi(
      { vulnerabilities: 4, general: 24 },
      { tier: 'enterprise', months: 12, hourlyRate: 125 }
    );

    if (isJson) {
      console.log(JSON.stringify(whoopCase, null, 2));
    } else {
      console.log('=== WHOOP / TNS Enterprise Model (1 Year) ===');
      console.log(`Tier: ${whoopCase.tier}`);
      console.log(`Hours Saved: ${whoopCase.hoursSaved.totalHours} hrs`);
      console.log(`Gross Savings: $${whoopCase.economics.grossSavingsDollars.toLocaleString()}`);
      console.log(`Net Savings: $${whoopCase.economics.netSavingsDollars.toLocaleString()}`);
      console.log(`ROI Multiplier: ${whoopCase.economics.roiMultiplier}x`);
      console.log(`Break-Even: ${whoopCase.economics.vulnsToBreakEven} blocked vulnerabilities/yr`);
    }
    return;
  }

  const vulnsArg = args.find((a) => a.startsWith('--vulnerabilities='));
  const generalArg = args.find((a) => a.startsWith('--interdictions='));
  const tierArg = args.find((a) => a.startsWith('--tier='));
  const rateArg = args.find((a) => a.startsWith('--rate='));

  let vulns = 2;
  if (vulnsArg) {
    const raw = vulnsArg.slice('--vulnerabilities='.length);
    if (!/^\d+$/.test(raw)) {
      console.error(`error: invalid --vulnerabilities operand: "${raw}". Must be a non-negative integer.`);
      process.exitCode = 1;
      return;
    }
    vulns = parseInt(raw, 10);
  }

  let general = 10;
  if (generalArg) {
    const raw = generalArg.slice('--interdictions='.length);
    if (!/^\d+$/.test(raw)) {
      console.error(`error: invalid --interdictions operand: "${raw}". Must be a non-negative integer.`);
      process.exitCode = 1;
      return;
    }
    general = parseInt(raw, 10);
  }

  let tier = 'pro';
  if (tierArg) {
    const raw = tierArg.slice('--tier='.length).toLowerCase();
    if (!PRICING_TIERS[raw]) {
      console.error(`error: unknown --tier: "${raw}". Supported tiers: ${Object.keys(PRICING_TIERS).join(', ')}.`);
      process.exitCode = 1;
      return;
    }
    tier = raw;
  }

  let rate = 125;
  if (rateArg) {
    const raw = rateArg.slice('--rate='.length);
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed <= 0) {
      console.error(`error: invalid --rate operand: "${raw}". Must be a positive number.`);
      process.exitCode = 1;
      return;
    }
    rate = parsed;
  }

  const result = calculateEnterpriseRoi(
    { vulnerabilities: vulns, general },
    { tier, hourlyRate: rate }
  );

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`=== ThumbGate Triage ROI Report (${result.tier}) ===`);
    console.log(`Hours Saved: ${result.hoursSaved.totalHours}h`);
    console.log(`Gross Savings: $${result.economics.grossSavingsDollars.toLocaleString()}`);
    console.log(`Subscription Cost: $${result.economics.totalCostDollars.toLocaleString()}`);
    console.log(`Net Savings: $${result.economics.netSavingsDollars.toLocaleString()}`);
    console.log(`ROI: ${result.economics.roiMultiplier}x`);
    console.log(`Pitch: ${result.pitchSummary}`);
  }
}

module.exports = {
  PRICING_TIERS,
  calculateEnterpriseRoi,
  calculateRevolutInferenceSavings,
};

if (require.main === module) {
  runCli();
}
