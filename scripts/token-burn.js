'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_MODEL_MIX,
  DEFAULT_MODEL_PRICES,
  blendedPricePer1M,
  formatDollars,
  formatTokens,
} = require('./token-savings');

const DEFAULT_WINDOW_DAYS = 30;

const TOKEN_USAGE_JSONL_FILES = Object.freeze([
  'token-usage.jsonl',
  'provider-actions.jsonl',
  'action-log.jsonl',
  'delegation-log.jsonl',
  'workflow-runs.jsonl',
  'workflow-sentinel.jsonl',
  'reasoning-traces.jsonl',
  'agent-reasoning-traces.jsonl',
  'audit-trail.jsonl',
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function dayKeyFromTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, delta) {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

function estimateCostUsd({ inputTokens, outputTokens, totalTokens, model, modelPrices }) {
  const prices = modelPrices || DEFAULT_MODEL_PRICES;
  const normalizedModel = firstText(model).toLowerCase();
  const directPrice = prices[normalizedModel];
  if (directPrice) {
    return ((inputTokens * directPrice.input) + (outputTokens * directPrice.output)) / 1_000_000;
  }

  const blended = blendedPricePer1M(DEFAULT_MODEL_MIX, prices);
  if (inputTokens > 0 || outputTokens > 0) {
    return ((inputTokens * blended.input) + (outputTokens * blended.output)) / 1_000_000;
  }
  return (totalTokens * ((blended.input + blended.output) / 2)) / 1_000_000;
}

function normalizeTokenUsageEvent(event = {}, options = {}) {
  const usage = asObject(event.usage || event.tokenUsage || event.usageMetadata || event.metrics);
  const model = firstText(
    event.model,
    event.llmModel,
    event.providerModel,
    event.modelName,
    usage.model,
    usage.modelName,
    'unknown',
  ).toLowerCase();
  const provider = firstText(event.provider, event.vendor, event.source, event.sourceProvider, 'unknown').toLowerCase();
  const timestamp = firstText(event.timestamp, event.ts, event.createdAt, event.completedAt, event.startedAt, event.at);

  const inputTokens = firstNumber(
    event.inputTokens,
    event.input_tokens,
    usage.inputTokens,
    usage.input_tokens,
    usage.promptTokens,
    usage.prompt_tokens,
    usage.promptTokenCount,
  );
  const outputTokens = firstNumber(
    event.outputTokens,
    event.output_tokens,
    usage.outputTokens,
    usage.output_tokens,
    usage.completionTokens,
    usage.completion_tokens,
    usage.candidatesTokenCount,
  );
  const explicitTotal = firstNumber(
    event.totalTokens,
    event.total_tokens,
    event.tokenEstimate,
    event.estimatedTokens,
    usage.totalTokens,
    usage.total_tokens,
    usage.totalTokenCount,
  );
  const totalTokens = explicitTotal || inputTokens + outputTokens;
  const explicitCostUsd = firstNumber(
    event.costUsd,
    event.estimatedCostUsd,
    event.amountUsd,
    usage.costUsd,
    usage.estimatedCostUsd,
  );
  const estimatedCostUsd = explicitCostUsd || estimateCostUsd({
    inputTokens,
    outputTokens,
    totalTokens,
    model,
    modelPrices: options.modelPrices,
  });

  return {
    timestamp: timestamp || null,
    dayKey: dayKeyFromTimestamp(timestamp || new Date()),
    model,
    provider,
    source: firstText(event.__sourceFile, event.source, event.eventType, event.type, 'unknown'),
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    hasUsage: totalTokens > 0 || estimatedCostUsd > 0,
  };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function collectCandidateDirs(feedbackDir, options = {}) {
  const dirs = [];
  const seen = new Set();
  function add(dir) {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (seen.has(resolved) || !fs.existsSync(resolved)) return;
    seen.add(resolved);
    dirs.push(resolved);
  }

  add(feedbackDir);
  add(options.projectFeedbackDir);

  const projectsDir = feedbackDir ? path.join(feedbackDir, 'projects') : null;
  if (projectsDir && fs.existsSync(projectsDir)) {
    for (const name of fs.readdirSync(projectsDir)) {
      add(path.join(projectsDir, name));
    }
  }
  return dirs;
}

function collectBudgetLedgerEvents(dir) {
  const ledgerPath = path.join(dir, 'budget-ledger.json');
  if (!fs.existsSync(ledgerPath)) return [];
  try {
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    const months = asObject(ledger.months);
    const events = [];
    for (const [month, data] of Object.entries(months)) {
      const entries = Array.isArray(data.entries) ? data.entries : [];
      for (const entry of entries) {
        events.push({
          ...entry,
          timestamp: entry.ts || `${month}-01T00:00:00.000Z`,
          provider: 'budget-ledger',
          model: 'cost-ledger',
          __sourceFile: 'budget-ledger.json',
        });
      }
    }
    return events;
  } catch {
    return [];
  }
}

function collectTokenBurnEvents(feedbackDir, options = {}) {
  const dirs = collectCandidateDirs(feedbackDir, options);
  const events = [];
  const files = options.files || TOKEN_USAGE_JSONL_FILES;
  for (const dir of dirs) {
    for (const file of files) {
      const filePath = path.join(dir, file);
      for (const row of readJsonl(filePath)) {
        events.push({ ...row, __sourceFile: file });
      }
    }
    events.push(...collectBudgetLedgerEvents(dir));
  }
  return events;
}

function buildWindowDays(now, windowDays) {
  const end = new Date(now || Date.now());
  const days = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    days.push(dayKeyFromTimestamp(addDays(end, -i)));
  }
  return days;
}

function intensityFor(value, maxValue) {
  if (!value || !maxValue) return 0;
  const numerator = Math.log10(value + 1);
  const denominator = Math.log10(maxValue + 1);
  return Math.max(1, Math.min(4, Math.ceil((numerator / denominator) * 4)));
}

function computeTokenBurnDashboard(events = [], options = {}) {
  const windowDays = Math.max(1, Number(options.windowDays) || DEFAULT_WINDOW_DAYS);
  const dayKeys = buildWindowDays(options.now, windowDays);
  const daySet = new Set(dayKeys);
  const byDay = new Map(dayKeys.map((dayKey) => [dayKey, {
    dayKey,
    events: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  }]));
  const byModel = new Map();
  const normalized = [];

  for (const event of events) {
    const item = normalizeTokenUsageEvent(event, options);
    if (!item.hasUsage) continue;
    normalized.push(item);
    if (!daySet.has(item.dayKey)) continue;

    const day = byDay.get(item.dayKey);
    day.events += 1;
    day.inputTokens += item.inputTokens;
    day.outputTokens += item.outputTokens;
    day.totalTokens += item.totalTokens;
    day.estimatedCostUsd += item.estimatedCostUsd;

    const model = item.model || 'unknown';
    if (!byModel.has(model)) {
      byModel.set(model, { model, events: 0, totalTokens: 0, estimatedCostUsd: 0 });
    }
    const modelRow = byModel.get(model);
    modelRow.events += 1;
    modelRow.totalTokens += item.totalTokens;
    modelRow.estimatedCostUsd += item.estimatedCostUsd;
  }

  const days = Array.from(byDay.values());
  const maxTokens = Math.max(0, ...days.map((day) => day.totalTokens));
  for (const day of days) {
    day.intensity = intensityFor(day.totalTokens || day.estimatedCostUsd, maxTokens || Math.max(...days.map((d) => d.estimatedCostUsd), 0));
    day.tokensDisplay = formatTokens(day.totalTokens);
    day.costDisplay = formatDollars(day.estimatedCostUsd);
    day.estimatedCostUsd = Number(day.estimatedCostUsd.toFixed(6));
  }

  const inputTokens = days.reduce((sum, day) => sum + day.inputTokens, 0);
  const outputTokens = days.reduce((sum, day) => sum + day.outputTokens, 0);
  const totalTokens = days.reduce((sum, day) => sum + day.totalTokens, 0);
  const estimatedCostUsd = Number(days.reduce((sum, day) => sum + day.estimatedCostUsd, 0).toFixed(6));
  const topDays = days
    .filter((day) => day.totalTokens > 0 || day.estimatedCostUsd > 0)
    .sort((a, b) => (b.totalTokens - a.totalTokens) || (b.estimatedCostUsd - a.estimatedCostUsd))
    .slice(0, 10);
  const modelDistribution = Array.from(byModel.values())
    .sort((a, b) => (b.totalTokens - a.totalTokens) || (b.estimatedCostUsd - a.estimatedCostUsd))
    .map((row) => ({
      ...row,
      share: totalTokens > 0 ? Number((row.totalTokens / totalTokens).toFixed(4)) : 0,
      tokensDisplay: formatTokens(row.totalTokens),
      costDisplay: formatDollars(row.estimatedCostUsd),
      estimatedCostUsd: Number(row.estimatedCostUsd.toFixed(6)),
    }));

  const dashboard = {
    available: normalized.length > 0,
    windowDays,
    totalEvents: events.length,
    trackedEvents: normalized.length,
    inputTokens,
    outputTokens,
    totalTokens,
    totalTokensDisplay: formatTokens(totalTokens),
    estimatedCostUsd,
    estimatedCostDisplay: formatDollars(estimatedCostUsd),
    days,
    topDays,
    modelDistribution,
    methodology: 'Aggregates local token/cost traces from token-usage, provider/action, delegation, workflow, reasoning, audit, and budget ledgers. Missing provider usage stays absent rather than filled with sample data.',
  };
  dashboard.weeklyReview = buildWeeklyBehaviorReview(dashboard, options);
  return dashboard;
}

function buildWeeklyBehaviorReview(burn, options = {}) {
  const savings = options.tokenSavings || {};
  const recommendations = [];
  const controls = [];

  if (!burn.available) {
    recommendations.push({
      severity: 'high',
      action: 'Instrument provider token usage',
      rationale: 'No token/cost traces were found, so the dashboard cannot identify expensive agent habits yet.',
    });
    controls.push('Emit usage.input_tokens/output_tokens or tokenEstimate/costUsd into token-usage.jsonl for every model-backed workflow.');
  } else {
    const topDay = burn.topDays[0];
    if (topDay && burn.totalTokens > 0 && topDay.totalTokens / burn.totalTokens >= 0.45) {
      recommendations.push({
        severity: 'medium',
        action: `Review ${topDay.dayKey}`,
        rationale: `${topDay.tokensDisplay} tokens were concentrated in one day; inspect the workflow and promote repeat failures into gates.`,
      });
    }

    const unknown = burn.modelDistribution.find((row) => row.model === 'unknown');
    if (unknown && unknown.share >= 0.25) {
      recommendations.push({
        severity: 'medium',
        action: 'Label model/provider usage',
        rationale: `${Math.round(unknown.share * 100)}% of tracked burn has no model label, which hides routing mistakes.`,
      });
    }

    if ((burn.estimatedCostUsd || 0) > 0 && !(savings.blockedCalls > 0)) {
      recommendations.push({
        severity: 'high',
        action: 'Create gates for repeated high-burn loops',
        rationale: 'Token spend exists, but no blocked calls are saving retries yet. Convert the top repeated failure into a PreToolUse gate.',
      });
    }

    controls.push('Keep tokenomics-cost-guard enabled for hard monthly spend caps.');
    controls.push('Use top-burn days as the weekly review queue: identify the workflow, failed assumption, and gate candidate.');
    controls.push('Route detail-only child tasks to smaller/local models when the model mix shows heavy premium-model concentration.');
  }

  if (recommendations.length === 0) {
    recommendations.push({
      severity: 'low',
      action: 'Keep reviewing weekly',
      rationale: 'No obvious token-burn hotspot crossed the current thresholds.',
    });
  }

  return {
    summary: burn.available
      ? `${burn.estimatedCostDisplay} estimated burn across ${burn.trackedEvents} tracked event(s) in ${burn.windowDays} days.`
      : 'No token burn telemetry found yet.',
    recommendations,
    controls,
  };
}

module.exports = {
  TOKEN_USAGE_JSONL_FILES,
  collectTokenBurnEvents,
  computeTokenBurnDashboard,
  normalizeTokenUsageEvent,
  buildWeeklyBehaviorReview,
};
