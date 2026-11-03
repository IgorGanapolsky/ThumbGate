'use strict';

/**
 * A peek is not a sale.
 *
 * The p-value is the one-look mixture likelihood ratio for the difference
 * of two rates. Mixing variance is 0.01 on that difference. Under a normal
 * null with variance V and a normal mix of variance tau^2, the ratio is
 * sqrt(V / (V + tau^2)) * exp(tau^2 * delta^2 / (2 * V * (V + tau^2))).
 * The p-value is min(1, 1 / ratio). This file does not call Confidence.
 */

const path = require('node:path');

const EXIT_BLOCK = 77;
const ALPHA = 0.05;
const MIXTURE_VARIANCE = 0.01;
const CATALOG = Object.freeze([
  ['ThumbGate Pro', 19, 'https://thumbgate.ai/go/pro-direct', 'a month'],
  ['ThumbGate Pro', 149, 'https://thumbgate.ai/go/pro-direct', 'a year'],
  ['ThumbGate Setup Sprint', 499, 'https://thumbgate.ai/diagnostic', 'once'],
]);

function mixturePValue(controlVisitors, controlConversions, treatmentVisitors, treatmentConversions) {
  const nC = Number(controlVisitors);
  const xC = Number(controlConversions);
  const nT = Number(treatmentVisitors);
  const xT = Number(treatmentConversions);
  if (![nC, xC, nT, xT].every((value) => Number.isFinite(value))) return null;
  if (nC <= 0 || nT <= 0 || xC < 0 || xT < 0 || xC > nC || xT > nT) return null;
  const delta = (xT / nT) - (xC / nC);
  const pooled = (xC + xT) / (nC + nT);
  const variance = pooled * (1 - pooled) * ((1 / nC) + (1 / nT));
  if (!(variance > 0)) {
    return { pValue: 1, delta, variance: 0, likelihoodRatio: 1 };
  }
  const root = Math.sqrt(variance / (variance + MIXTURE_VARIANCE));
  const exponent = (MIXTURE_VARIANCE * delta * delta) / (2 * variance * (variance + MIXTURE_VARIANCE));
  const likelihoodRatio = root * Math.exp(exponent);
  return {
    pValue: Math.min(1, 1 / likelihoodRatio),
    delta,
    variance,
    likelihoodRatio,
  };
}

function words(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function structuredHypothesis(hypothesis) {
  const list = words(hypothesis);
  const ifAt = list.indexOf('if');
  const thenAt = list.indexOf('then');
  const becauseAt = list.indexOf('because');
  return ifAt >= 0 && thenAt > ifAt && becauseAt > thenAt;
}

function fields(stats) {
  const peekingSafe = !stats || stats.pValue === Math.min(1, 1 / stats.likelihoodRatio);
  return {
    purchased: false,
    paidOrders: 0,
    outboundCashSpendUsd: 0,
    peekingSafe,
    pValue: stats ? stats.pValue : null,
    delta: stats ? stats.delta : null,
  };
}

function decide(input) {
  const action = String((input && input.action) || '').trim();
  const hypothesis = String((input && input.hypothesis) || '').trim();
  const metric = String((input && input.metric) || '').trim();
  const metrics = Array.isArray(input && input.metrics) ? input.metrics : [];
  const postHoc = Boolean(input && input.postHoc);
  const guardrailObserved = input && input.guardrailObserved;
  const guardrailMax = input && input.guardrailMax;
  if (action.toLowerCase() === 'sell') {
    return { decision: 'sell', rule: 'catalog', blockers: [], ...fields(null) };
  }
  const stats = mixturePValue(
    input && input.controlVisitors,
    input && input.controlConversions,
    input && input.treatmentVisitors,
    input && input.treatmentConversions,
  );
  const blockers = [];
  if (hypothesis && !structuredHypothesis(hypothesis)) {
    blockers.push('spotify_confidence_missing_structured_if_then_because_hypothesis');
  }
  if (postHoc) blockers.push('spotify_confidence_post_hoc_metric_selection_forbidden');
  if (metrics.length > 0 && metrics.length !== 1) {
    blockers.push('spotify_confidence_requires_exactly_one_primary_success_metric');
  }
  const guardrailBreach = Number.isFinite(Number(guardrailObserved))
    && Number.isFinite(Number(guardrailMax))
    && Number(guardrailObserved) > Number(guardrailMax);
  if (guardrailBreach) blockers.push('spotify_confidence_guardrail_metric_breached_auto_rollback_triggered');
  const base = fields(stats);
  if (!action && !hypothesis && metrics.length === 0 && !stats && !guardrailBreach && !postHoc) {
    return { decision: 'block', rule: 'missing-action', blockers: ['missing-action'], ...fields(null) };
  }
  if (blockers.length > 0) {
    const rule = guardrailBreach ? 'guardrail-breach' : blockers[0];
    return { decision: 'block', rule, blockers, ...base };
  }
  if (!stats) return { decision: 'block', rule: 'missing-counts', blockers: ['missing-counts'], ...base };
  const paidMetric = [metric, ...metrics].some((item) => {
    const list = words(item);
    return list.includes('paid') && list.some((word) => word === 'order' || word === 'orders');
  });
  if (stats.pValue <= ALPHA && stats.delta > 0 && paidMetric) {
    return { decision: 'hold', rule: 'awaiting-paid-order', blockers, ...base };
  }
  if (stats.pValue <= ALPHA && stats.delta > 0) {
    return { decision: 'hold', rule: 'significant-not-a-sale', blockers, ...base };
  }
  if (stats.delta < 0 && stats.pValue <= ALPHA) {
    return { decision: 'hold', rule: 'treatment-not-better', blockers, ...base };
  }
  return { decision: 'hold', rule: 'not-significant', blockers, ...base };
}

function formatLine(result) {
  const pValue = result.pValue == null ? '' : Number(result.pValue).toFixed(6);
  const delta = result.delta == null ? '' : Number(result.delta).toFixed(6);
  return [
    `decision=${result.decision}`,
    `rule=${result.rule}`,
    `p_value=${pValue}`,
    `delta=${delta}`,
    `peeking_safe=${result.peekingSafe}`,
    `purchased=${result.purchased}`,
    `paid_orders=${result.paidOrders}`,
    `outbound_cash_usd=${result.outboundCashSpendUsd}`,
  ].join(' ');
}

function catalogLines() {
  return CATALOG.map(([name, usd, url, period]) => `${name} $${usd} ${period} ${url}`);
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] == null) return '';
  return args[index + 1];
}

function numberFlag(args, name) {
  const raw = flag(args, name);
  if (raw === '') return undefined;
  return Number(raw);
}

function main(argv) {
  const args = argv || process.argv.slice(2);
  const command = args[0];
  if (command !== 'check' && command !== 'sell') {
    process.stderr.write('Usage: peeking-safe-p-value.js check --control-visitors N --control-conversions N --treatment-visitors N --treatment-conversions N | sell\n');
    process.exitCode = 2;
    return;
  }
  const metrics = flag(args, '--metrics');
  const result = decide({
    action: command === 'sell' ? 'sell' : (flag(args, '--action') || 'check'),
    hypothesis: flag(args, '--hypothesis'),
    metric: flag(args, '--metric'),
    metrics: metrics ? metrics.split(',').map((item) => item.trim()).filter(Boolean) : [],
    postHoc: flag(args, '--post-hoc') === 'true',
    guardrailObserved: numberFlag(args, '--guardrail-observed'),
    guardrailMax: numberFlag(args, '--guardrail-max'),
    controlVisitors: numberFlag(args, '--control-visitors'),
    controlConversions: numberFlag(args, '--control-conversions'),
    treatmentVisitors: numberFlag(args, '--treatment-visitors'),
    treatmentConversions: numberFlag(args, '--treatment-conversions'),
  });
  process.stdout.write(`${formatLine(result)}\n`);
  if (result.decision === 'sell') {
    process.stdout.write('Not purchased.\n');
    for (const line of catalogLines()) process.stdout.write(`${line}\n`);
  }
  process.exitCode = result.decision === 'block' ? EXIT_BLOCK : 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  EXIT_BLOCK,
  ALPHA,
  MIXTURE_VARIANCE,
  mixturePValue,
  decide,
  catalogLines,
  main,
};
