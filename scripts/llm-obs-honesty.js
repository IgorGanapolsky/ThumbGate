#!/usr/bin/env node
'use strict';

/**
 * Datadog LLM Observability FORMAT steal — not a product clone.
 *
 * Source: https://lp.datadoghq.com/rs/875-UVY-685/images/eBook-LLMObservabilityBestPractices.pdf
 *
 * Four practices (process only):
 *   1. operational — errors, latency breakdown, token budget alerts
 *   2. security    — prompt-injection + PII/secret scrub on traces
 *   3. quality     — failure-to-answer, topic relevancy, toxicity, user feedback
 *   4. tracing     — end-to-end parented spans for retrieve/llm/tool steps
 *
 * Maps onto existing ThumbGate rails. Does NOT clone Datadog Agent
 * Observability, Sensitive Data Scanner, dd-trace, or OTLP export.
 * Dual-edit wall: PR #3881 Datadog-style engine + PR orchestrator.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://lp.datadoghq.com/rs/875-UVY-685/images/eBook-LLMObservabilityBestPractices.pdf';

const PRACTICES = Object.freeze(['operational', 'security', 'quality', 'tracing']);

const PRACTICE_RAILS = Object.freeze({
  operational: {
    datadog: 'Request volume, errors, latency over time; token-consumption alerts; chain latency breakdown',
    rails: [
      'scripts/latency-budget.js',
      'scripts/action-receipts.js',
      'scripts/task-outcomes.js',
      'config/performance-budgets.json',
    ],
  },
  security: {
    datadog: 'Prompt-injection + toxicity highlights; Sensitive Data Scanner scrubs PII from traces',
    rails: [
      'scripts/secret-redaction.js',
      'scripts/secret-scanner.js',
      'PreToolUse gates / gates-engine.js',
    ],
  },
  quality: {
    datadog: 'Failure to answer, topic relevancy, toxicity, negative sentiment; custom evals from user feedback; topic clusters',
    rails: [
      'scripts/feedback-quality.js',
      '.claude/scripts/feedback/capture-feedback.js',
      'scripts/future-agi-evaluator.js',
    ],
  },
  tracing: {
    datadog: 'End-to-end prompt traces; highlight errors/latency; inspect RAG/LLM/tool steps',
    rails: [
      'scripts/agent-audit-trace.js',
      'scripts/action-receipts.js',
    ],
  },
});

const DEFAULT_GOLD_TRACE = Object.freeze({
  operational: {
    requestCount: 12,
    errorCount: 1,
    latencyMs: { p50: 120, p95: 380 },
    tokenIn: 2400,
    tokenOut: 600,
    budgetUsd: 10,
    spendUsd: 0.42,
    alerts: ['error_rate', 'latency', 'token_budget'],
  },
  security: {
    promptInjectionChecked: true,
    piiScrubbed: true,
    redactionRail: 'scripts/secret-redaction.js',
    rawPrompt: null,
  },
  quality: {
    failureToAnswer: false,
    topicRelevancy: 'on_topic',
    toxicity: 'clean',
    sentiment: 'neutral',
    userFeedback: 'up',
  },
  tracing: {
    traceId: 'trace-gold',
    spans: [
      { id: 's-in', parentId: null, kind: 'input', latencyMs: 4 },
      { id: 's-rag', parentId: 's-in', kind: 'retrieve', latencyMs: 18, evidenceIds: ['doc-1'] },
      { id: 's-llm', parentId: 's-in', kind: 'llm', latencyMs: 90, tokensIn: 200, tokensOut: 40 },
      { id: 's-tool', parentId: 's-in', kind: 'tool', latencyMs: 25, evidenceIds: ['receipt-1'] },
    ],
  },
});

const CLONE_PATTERNS = Object.freeze([
  { id: 'datadog_class', re: /\bDatadogAgentObservability\b/ },
  { id: 'dd_trace', re: /\b(dd-trace|datadoghq\.com\/api|DD_API_KEY|DD_LLMOBS)\b/i },
  { id: 'clone_sku', re: /\b(clone|install|vendor)\b.{0,40}\bdatadog (agent )?observability\b/i },
  { id: 'otlp_export', re: /\b(OTLP.?export|otelcol|ddog.?llmobs)\b/i },
]);

const SECRETISH_RE = /sk_live_|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9\-._]{20,}/;

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function detectCloneAttempt(text) {
  const t = String(text || '');
  return CLONE_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.id);
}

function requiredOperational(op = {}) {
  const findings = [];
  const hasCounts = Number.isFinite(Number(op.requestCount)) && Number.isFinite(Number(op.errorCount));
  const lat = op.latencyMs && typeof op.latencyMs === 'object' ? op.latencyMs : {};
  const hasLatency = Number.isFinite(Number(lat.p95)) || Number.isFinite(Number(op.latencyMs));
  const hasTokens = Number.isFinite(Number(op.tokenIn)) || Number.isFinite(Number(op.tokenOut));
  if (!hasCounts || !hasLatency || !hasTokens) {
    findings.push({
      severity: 'fail',
      id: 'missing_operational_metrics',
      message: 'Operational practice needs request/error counts, latency, and token usage. Map onto latency-budget + action-receipts + task-outcomes.',
    });
  }
  const spend = Number(op.spendUsd);
  const budget = Number(op.budgetUsd);
  const alerts = Array.isArray(op.alerts) ? op.alerts.map((a) => String(a).toLowerCase()) : [];
  if (Number.isFinite(spend) && spend > 0 && !Number.isFinite(budget)) {
    findings.push({
      severity: 'fail',
      id: 'missing_token_budget',
      message: 'Token/cost spend is recorded without a budget ceiling. Datadog practice 1 is alert-on-budget, not a dashboard of vibes.',
    });
  }
  if (Number.isFinite(spend) && Number.isFinite(budget) && spend > budget && !alerts.some((a) => /token|budget|cost/.test(a))) {
    findings.push({
      severity: 'fail',
      id: 'missing_token_budget_alert',
      message: 'Spend exceeds budget with no token_budget/cost alert. Wire the tripwire, do not clone Datadog monitors.',
    });
  }
  return findings;
}

function requiredSecurity(sec = {}) {
  const findings = [];
  if (sec.promptInjectionChecked !== true) {
    findings.push({
      severity: 'fail',
      id: 'missing_injection_check',
      message: 'Security practice requires a prompt-injection check on the trace (existing PreToolUse gates), not a Datadog SDS SKU.',
    });
  }
  if (sec.piiScrubbed !== true) {
    findings.push({
      severity: 'fail',
      id: 'missing_pii_scrub',
      message: 'Traces must be scrubbed via scripts/secret-redaction.js before persistence. Do not invent a second scanner.',
    });
  }
  if (sec.rawPrompt && SECRETISH_RE.test(String(sec.rawPrompt))) {
    findings.push({
      severity: 'fail',
      id: 'unredacted_prompt',
      message: 'Raw prompt still contains credential-shaped text. Redact before any lesson/trace write.',
    });
  }
  const rail = String(sec.redactionRail || '');
  if (sec.piiScrubbed === true && rail && !/secret-redaction/.test(rail) && /datadog|sensitive data scanner/i.test(rail)) {
    findings.push({
      severity: 'fail',
      id: 'duplicate_redaction_sku',
      message: 'Redaction must call scripts/secret-redaction.js. A parallel Datadog SDS is a clone.',
    });
  }
  return findings;
}

function requiredQuality(q = {}) {
  const findings = [];
  const hasFailure = typeof q.failureToAnswer === 'boolean';
  const hasTopic = Boolean(q.topicRelevancy);
  const hasTox = Boolean(q.toxicity);
  const hasFeedback = q.userFeedback != null && String(q.userFeedback).trim() !== '';
  if (!hasFailure || !hasTopic || !hasTox) {
    findings.push({
      severity: 'fail',
      id: 'missing_quality_evals',
      message: 'Quality practice needs failure-to-answer, topic relevancy, and toxicity (plus optional sentiment). Map onto feedback-quality / capture-feedback, not Datadog Clusters.',
    });
  }
  if (!hasFeedback) {
    findings.push({
      severity: 'warn',
      id: 'missing_user_feedback_eval',
      message: 'No user feedback on this trace. Custom evals should come from thumbs, not a Datadog cluster view.',
    });
  }
  return findings;
}

function requiredTracing(tr = {}) {
  const findings = [];
  const spans = Array.isArray(tr.spans) ? tr.spans : [];
  if (!tr.traceId || spans.length === 0) {
    findings.push({
      severity: 'fail',
      id: 'missing_trace_spans',
      message: 'Tracing practice needs a traceId and parented spans. Map onto agent-audit-trace.js.',
    });
    return findings;
  }
  const ids = new Set(spans.map((s) => s.id).filter(Boolean));
  const kinds = new Set(spans.map((s) => String(s.kind || '').toLowerCase()));
  if (![...ids].length) {
    findings.push({
      severity: 'fail',
      id: 'missing_span_ids',
      message: 'Every span needs an id so latency bottlenecks can be named.',
    });
  }
  const childMissingParent = spans.some((s) => s.parentId && !ids.has(s.parentId) && s.parentId !== s.id);
  if (childMissingParent) {
    findings.push({
      severity: 'fail',
      id: 'broken_parent_chain',
      message: 'A span parentId does not exist in this trace. End-to-end means the chain is reconstructable.',
    });
  }
  const hasRetrieve = [...kinds].some((k) => /retriev|rag|search/.test(k));
  const hasLlm = [...kinds].some((k) => /llm|model|generate/.test(k));
  if (spans.length >= 2 && !hasLlm) {
    findings.push({
      severity: 'fail',
      id: 'missing_llm_span',
      message: 'Multi-step traces need an llm/model span so token/latency attribution is not a blob.',
    });
  }
  if (hasRetrieve) {
    const rag = spans.filter((s) => /retriev|rag|search/i.test(String(s.kind || '')));
    if (rag.some((s) => !Array.isArray(s.evidenceIds) || s.evidenceIds.length === 0)) {
      findings.push({
        severity: 'fail',
        id: 'retrieve_span_requires_evidence',
        message: 'RAG/retrieve spans must cite evidenceIds (which docs actually landed in the prompt).',
      });
    }
  }
  const tools = spans.filter((s) => /tool/i.test(String(s.kind || '')) || (Array.isArray(s.toolsUsed) && s.toolsUsed.length));
  if (tools.some((s) => !Array.isArray(s.evidenceIds) || s.evidenceIds.length === 0)) {
    findings.push({
      severity: 'fail',
      id: 'tool_span_requires_evidence',
      message: 'Tool spans need evidenceIds (action-receipts). agent-audit-trace already fail-closes this.',
    });
  }
  const missingLatency = spans.filter((s) => !Number.isFinite(Number(s.latencyMs)));
  if (missingLatency.length && spans.length >= 2) {
    findings.push({
      severity: 'warn',
      id: 'missing_span_latency',
      message: 'Some spans lack latencyMs so the chain breakdown cannot name the slow hop.',
    });
  }
  return findings;
}

function auditTrace(trace = {}) {
  const findings = [];
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
    return [{
      severity: 'fail',
      id: 'empty_trace',
      message: 'Trace is missing. A fail-closed LLM-obs audit needs operational, security, quality, and tracing objects.',
    }];
  }
  const hasAny = PRACTICES.some((p) => trace[p] != null);
  if (!hasAny) {
    findings.push({
      severity: 'fail',
      id: 'empty_trace',
      message: 'Trace omits all four practices. Empty {} is not ready.',
    });
    return findings;
  }
  findings.push(...requiredOperational(trace.operational || {}));
  findings.push(...requiredSecurity(trace.security || {}));
  findings.push(...requiredQuality(trace.quality || {}));
  findings.push(...requiredTracing(trace.tracing || {}));
  return findings;
}

function probeRails(rootDir) {
  const root = rootDir || path.resolve(__dirname, '..');
  const checks = [
    { id: 'latency_budget', rel: 'scripts/latency-budget.js' },
    { id: 'action_receipts', rel: 'scripts/action-receipts.js' },
    { id: 'secret_redaction', rel: 'scripts/secret-redaction.js' },
    { id: 'agent_audit_trace', rel: 'scripts/agent-audit-trace.js' },
    { id: 'task_outcomes', rel: 'scripts/task-outcomes.js' },
  ];
  return checks.map((c) => ({
    id: c.id,
    path: c.rel,
    exists: fs.existsSync(path.join(root, c.rel)),
  }));
}

function loadJsonFile(filePath) {
  if (!filePath) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectCloneHaystack(options = {}) {
  const parts = [
    options.task,
    options.query,
    options['clone-datadog'] ? 'clone datadog agent observability' : '',
    options.cloneDatadog ? 'clone datadog agent observability DD_API_KEY' : '',
  ];
  if (Array.isArray(options.argv)) parts.push(...options.argv);
  return parts.filter(Boolean).join(' ');
}

function buildLlmObsHonestyReport(options = {}) {
  const root = options.root
    ? path.resolve(String(options.root))
    : path.resolve(__dirname, '..');
  const findings = [];
  const cloneHits = [...new Set(detectCloneAttempt(collectCloneHaystack(options)))];
  if (cloneHits.length) {
    findings.push({
      severity: 'fail',
      id: 'datadog_clone_refused',
      message: `Refusing Datadog Agent Observability / dd-trace / OTLP clone (${cloneHits.join(', ')}). Map the four practices onto existing receipts, redaction, feedback, and audit-trace rails. Do not dual-edit PR #3881.`,
    });
  }

  const mapOnly = normalizeBoolean(options.map || options['map-only']);
  let trace = null;
  if (!mapOnly) {
    if (options.trace && typeof options.trace === 'object' && !Array.isArray(options.trace)) {
      trace = options.trace;
    } else if (options.trace) {
      trace = loadJsonFile(String(options.trace));
    } else {
      trace = DEFAULT_GOLD_TRACE;
    }
    findings.push(...auditTrace(trace));
  }

  const probes = probeRails(root);
  for (const missing of probes.filter((p) => !p.exists)) {
    findings.push({
      severity: 'warn',
      id: `missing_rail_${missing.id}`,
      message: `Expected rail missing: ${missing.path}`,
    });
  }

  let status = 'ready';
  if (findings.some((f) => f.severity === 'fail')) status = 'fail';
  else if (findings.some((f) => f.severity === 'warn')) status = 'ready_with_warnings';

  const report = {
    name: 'thumbgate-llm-obs-honesty',
    status,
    ok: status !== 'fail',
    practices: PRACTICES.map((id) => ({ id, ...PRACTICE_RAILS[id] })),
    trace: mapOnly ? null : trace,
    railProbes: probes,
    compareNotClone: true,
    siblingWall: 'PR #3881 Datadog-style engine + PR orchestrator — do not dual-edit; orchestrator overlaps board-loop #3883',
    never: [
      'clone Datadog Agent Observability / Sensitive Data Scanner',
      'vendor dd-trace or DD_API_KEY LLM obs',
      'OTLP-export prompt traces',
      'duplicate secret-redaction.js',
      'dual-edit PR #3881',
      'claim Datadog MTTR/token dashboards as ThumbGate measurements',
    ],
    source: SOURCE_URL,
    disclaimer: 'FORMAT steal only. Not affiliated with Datadog. Maps existing ThumbGate receipts/redaction/feedback/audit-trace; does not ship an APM SKU.',
    findings,
  };
  if (mapOnly) report.map = report.practices;
  return report;
}

function formatLlmObsHonestyReport(report) {
  const lines = [
    'ThumbGate LLM-obs honesty (Datadog FORMAT steal)',
    `Status   : ${report.status}`,
    `ok       : ${report.ok}`,
    'Practices:',
  ];
  for (const p of report.practices || []) {
    lines.push(`  [${p.id}] ${p.datadog}`);
    lines.push(`         rails=${(p.rails || []).join(' · ')}`);
  }
  if (report.findings?.length) {
    lines.push('Findings:');
    for (const f of report.findings) {
      lines.push(`  [${f.severity}] ${f.id}: ${f.message}`);
    }
  }
  lines.push(`Never    : ${(report.never || []).join('; ')}`);
  lines.push(`Source   : ${report.source}`);
  lines.push(report.disclaimer);
  return `${lines.join('\n')}\n`;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/llm-obs-honesty.js [options]

Datadog LLM Observability FORMAT steal — four practices onto existing
ThumbGate rails. Does not clone Datadog / dd-trace / OTLP.

Options:
  --trace=<file.json>     Audit an operational/security/quality/tracing payload
  --map-only              Print four-practice rail map
  --clone-datadog         Fail closed (clone refused)
  --json
  --strict                Exit 1 unless status=ready
  --root=<dir>
`);
}

function parseArgv(argv) {
  const options = { argv };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--map' || arg === '--map-only') options.map = true;
    else if (arg === '--clone-datadog') options['clone-datadog'] = true;
    else if (arg.startsWith('--trace=')) options.trace = arg.slice('--trace='.length);
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (arg.startsWith('--task=')) options.task = arg.slice('--task='.length);
    else if (arg.startsWith('--query=')) options.query = arg.slice('--query='.length);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const options = parseArgv(argv);
  const report = buildLlmObsHonestyReport(options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatLlmObsHonestyReport(report));
  if (options.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  PRACTICES,
  PRACTICE_RAILS,
  DEFAULT_GOLD_TRACE,
  SOURCE_URL,
  detectCloneAttempt,
  auditTrace,
  probeRails,
  buildLlmObsHonestyReport,
  formatLlmObsHonestyReport,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main();
}
