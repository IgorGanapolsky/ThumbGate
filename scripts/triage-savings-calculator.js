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
  const vulnsToBreakEven = annualTierCost > 0
    ? Number((annualTierCost / valuePerVulnInterdiction).toFixed(2))
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
    pitchSummary: `Preventing just ${vulnsToBreakEven} critical vulnerabilities pays for ${tier.name} for an entire year. Current metrics show $${grossSavingsDollars.toLocaleString()} in engineering time preserved.`,
  };
}

function runCli() {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const isWhoopModel = args.includes('--model-whoop');

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
};

if (require.main === module) {
  runCli();
}
