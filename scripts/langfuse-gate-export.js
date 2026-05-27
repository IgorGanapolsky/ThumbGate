'use strict';

const fs = require('node:fs');

const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|client[_-]?secret|cookie|password|private[_-]?key|secret|session|token|webhook)/i;
const DEFAULT_SCORE_NAME = 'thumbgate.pre_action_gate';
const SAFE_SECRET_WORD_METADATA_KEYS = new Set([
  'token_estimate',
  'usage_bucket',
  'component_usage_percent',
]);

function normalizeDecision(value) {
  const decision = String(value || '').trim().toLowerCase();
  if (decision === 'allowed') return 'allow';
  if (decision === 'blocked') return 'block';
  if (decision === 'approved') return 'approve';
  if (decision === 'logged') return 'log';
  if (['allow', 'block', 'approve', 'log'].includes(decision)) return decision;
  return 'log';
}

function scoreForDecision(value) {
  const decision = normalizeDecision(value);
  if (decision === 'allow') return 1;
  if (decision === 'log') return 0.75;
  if (decision === 'approve') return 0.5;
  return 0;
}

function truncateString(value, maxLength = 500) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function sanitizeMetadata(input, depth = 0) {
  if (!input || typeof input !== 'object') return input;
  if (depth > 3) return '[truncated]';
  if (Array.isArray(input)) return input.slice(0, 25).map((item) => sanitizeMetadata(item, depth + 1));

  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (SAFE_SECRET_WORD_METADATA_KEYS.has(key)) return [key, value];
    if (SECRET_KEY_PATTERN.test(key)) return [key, '[redacted]'];
    if (value && typeof value === 'object') return [key, sanitizeMetadata(value, depth + 1)];
    if (typeof value === 'string' && SECRET_KEY_PATTERN.test(value)) return [key, '[redacted]'];
    return [key, value];
  }));
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function buildLangfuseGateScore(event) {
  const decision = normalizeDecision(pickFirst(event.decision, event.action, event.outcome));
  const gateId = pickFirst(event.gateId, event.gate_id, event.ruleId, event.rule_id, 'unknown-gate');
  const metadata = sanitizeMetadata({
    source: 'thumbgate',
    gate_id: gateId,
    rule_id: pickFirst(event.ruleId, event.rule_id),
    decision,
    risk_tier: pickFirst(event.riskTier, event.risk_tier, event.risk),
    tool: event.tool,
    agent: event.agent,
    workflow: event.workflow,
    runtime_component: pickFirst(event.runtimeComponent, event.runtime_component),
    usage_bucket: pickFirst(event.usageBucket, event.usage_bucket),
    budget_decision: pickFirst(event.budgetDecision, event.budget_decision),
    token_estimate: pickFirst(event.tokenEstimate, event.token_estimate),
    component_usage_percent: pickFirst(event.componentUsagePercent, event.component_usage_percent),
    prompt_version: pickFirst(event.promptVersion, event.prompt_version),
    evidence_required: pickFirst(event.evidenceRequired, event.evidence_required),
    override_reason: pickFirst(event.overrideReason, event.override_reason),
    metadata: event.metadata,
  });

  return {
    traceId: String(pickFirst(event.traceId, event.trace_id, event.trace, '') || ''),
    name: pickFirst(event.scoreName, event.score_name, DEFAULT_SCORE_NAME),
    value: scoreForDecision(decision),
    comment: truncateString(`${gateId} ${decision}: ${pickFirst(event.reason, event.message, 'gate decision recorded')}`),
    metadata,
  };
}

function buildLangfuseGateEvent(event) {
  const score = buildLangfuseGateScore(event);
  return {
    type: 'score',
    ...score,
  };
}

function parseInput(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  if (trimmed.startsWith('{') && !/\r?\n/.test(trimmed)) return [JSON.parse(trimmed)];
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function formatJsonl(events) {
  return events.map((event) => JSON.stringify(buildLangfuseGateEvent(event))).join('\n');
}

function runCli(argv = process.argv.slice(2), stdout = process.stdout) {
  const inputArg = argv.find((arg) => arg.startsWith('--input='));
  if (argv.includes('--sample')) {
    stdout.write(`${formatJsonl([{
      traceId: 'trace-demo-1',
      gateId: 'deploy-evidence-required',
      decision: 'approve',
      riskTier: 'production',
      tool: 'bash',
      agent: 'claude-code',
      promptVersion: 'deploy-v4',
      evidenceRequired: 'CI link and rollback command',
      reason: 'Production deploy requires human approval.',
    }])}\n`);
    return 0;
  }
  if (!inputArg) {
    stdout.write('Usage: node scripts/langfuse-gate-export.js --input=gate-events.jsonl\n');
    return 1;
  }

  const events = parseInput(fs.readFileSync(inputArg.slice('--input='.length), 'utf8'));
  stdout.write(`${formatJsonl(events)}\n`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === __filename) {
  process.exitCode = runCli();
}

module.exports = {
  buildLangfuseGateEvent,
  buildLangfuseGateScore,
  formatJsonl,
  normalizeDecision,
  parseInput,
  sanitizeMetadata,
  scoreForDecision,
};
