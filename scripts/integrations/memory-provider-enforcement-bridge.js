#!/usr/bin/env node
'use strict';

/**
 * Convert external agent-memory records into ThumbGate enforcement candidates.
 *
 * Memory tools such as Hermes, EverOS, Honcho, Mem0, and local markdown brains
 * are useful context sources. They become operationally useful to ThumbGate only
 * when a remembered failure can be framed as a pre-action rule.
 */

const fs = require('node:fs');

const HIGH_RISK_TERMS = [
  'secret', 'credential', 'token', 'api key', 'password',
  'delete', 'rm -rf', 'destructive', 'drop table',
  'deploy', 'production', 'charge', 'payment', 'invoice',
  'corrupt', 'state corruption', 'data loss',
];

const ACTION_RISK_TERMS = [
  '429', 'timeout', 'retry', 'loop', 'external api', 'mcp',
  'tool call', 'browser', 'file edit', 'shell', 'git push',
  'claim', 'citation', 'hallucination', 'overclaim',
  'approval', 'policy', 'identity', 'permission', 'scope',
];

const NEGATIVE_TERMS = [
  'failed', 'failure', 'wrong', 'bad', 'broke', 'blocked',
  'unsafe', 'unverified', 'regressed', 'mistake', 'incident',
  'violation', 'leaked', 'ignored', 'missing', 'corrupted',
];

const POSITIVE_TERMS = [
  'worked', 'passed', 'verified', 'approved', 'fixed',
  'resolved', 'safe', 'correct', 'successful',
];

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return [
      value.text,
      value.content,
      value.summary,
      value.memory,
      value.context,
      value.lesson,
      value.observation,
      value.conclusion,
      value.reason,
    ].map(textOf).filter(Boolean).join('\n');
  }
  return '';
}

function includesAny(text, terms) {
  const lower = String(text || '').toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function providerName(input, fallback = 'generic') {
  const raw = input && typeof input === 'object'
    ? (input.provider || input.source || input.system || input.runtime || input.tool)
    : fallback;
  return String(raw || fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function collectMemoryItems(input) {
  if (typeof input === 'string') {
    return [{ kind: 'context', text: input }];
  }
  const items = [];
  const object = input && typeof input === 'object' ? input : {};
  const fields = [
    ['context', object.context],
    ['memory', object.memory],
    ['summary', object.summary],
    ['lesson', object.lesson],
    ['observation', object.observation],
    ['conclusion', object.conclusion],
  ];
  for (const [kind, value] of fields) {
    const text = textOf(value).trim();
    if (text) items.push({ kind, text });
  }
  for (const item of [
    ...asArray(object.memories),
    ...asArray(object.messages),
    ...asArray(object.events),
    ...asArray(object.episodes),
    ...asArray(object.lessons),
    ...asArray(object.cases),
  ]) {
    const text = textOf(item).trim();
    if (text) items.push({ kind: item.kind || item.role || item.type || 'item', text });
  }
  return items;
}

function normalizeMemoryProviderPayload(input, options = {}) {
  const provider = providerName(input, options.provider || 'generic');
  const items = collectMemoryItems(input)
    .map((item, index) => ({
      id: item.id || `${provider}-${index + 1}`,
      provider,
      kind: String(item.kind || 'memory'),
      text: item.text.trim(),
    }))
    .filter((item) => item.text.length > 0);
  return {
    provider,
    source: options.source || 'memory-provider-enforcement-bridge',
    items,
  };
}

function actionFor(text) {
  if (includesAny(text, HIGH_RISK_TERMS)) return 'block';
  if (includesAny(text, ACTION_RISK_TERMS) && includesAny(text, NEGATIVE_TERMS)) return 'block';
  return 'warn';
}

function signalFor(text) {
  const positive = includesAny(text, POSITIVE_TERMS);
  const negative = includesAny(text, NEGATIVE_TERMS);
  if (positive && !negative) return 'up';
  if (negative || includesAny(text, HIGH_RISK_TERMS)) return 'down';
  return null;
}

function shortPattern(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function extractEnforcementCandidates(normalized, options = {}) {
  const minLength = options.minLength || 24;
  return normalized.items
    .map((item) => {
      const signal = signalFor(item.text);
      const actionable = includesAny(item.text, ACTION_RISK_TERMS)
        || includesAny(item.text, HIGH_RISK_TERMS)
        || includesAny(item.text, NEGATIVE_TERMS);
      if (!signal || !actionable || item.text.length < minLength) return null;
      return {
        id: `${item.provider}:${item.id}`,
        provider: item.provider,
        sourceKind: item.kind,
        signal,
        action: signal === 'down' ? actionFor(item.text) : 'allow-note',
        pattern: shortPattern(item.text),
        reason: signal === 'down'
          ? 'Remembered failure contains enough action/risk language to become a ThumbGate pre-action candidate.'
          : 'Remembered success can be kept as a positive lesson, not a blocking gate.',
        tags: [
          'memory-provider',
          `provider:${item.provider}`,
          `kind:${item.kind}`,
          signal === 'down' ? 'candidate:gate' : 'candidate:positive-lesson',
        ],
        evidence: item.text,
      };
    })
    .filter(Boolean);
}

function buildCaptureParams(candidate) {
  const base = {
    signal: candidate.signal,
    context: `[${candidate.provider} memory] ${candidate.evidence}`,
    source: 'memory-provider-enforcement-bridge',
    tags: candidate.tags,
  };
  if (candidate.signal === 'down') {
    return {
      ...base,
      whatWentWrong: candidate.evidence,
      preventionHint: `Before executing a similar action, ${candidate.action === 'block' ? 'block' : 'warn on'}: ${candidate.pattern}`,
    };
  }
  return {
    ...base,
    whatWorked: candidate.evidence,
  };
}

function buildMemoryProviderBridgeReport(input, options = {}) {
  const normalized = normalizeMemoryProviderPayload(input, options);
  const candidates = extractEnforcementCandidates(normalized, options);
  return {
    provider: normalized.provider,
    source: normalized.source,
    itemsScanned: normalized.items.length,
    gateCandidates: candidates.filter((candidate) => candidate.action === 'block' || candidate.action === 'warn'),
    positiveLessons: candidates.filter((candidate) => candidate.signal === 'up'),
    candidates,
    captureParams: candidates.map(buildCaptureParams),
  };
}

function formatMemoryProviderBridgeMarkdown(report) {
  const lines = [
    `# Memory Provider Enforcement Bridge: ${report.provider}`,
    '',
    `Items scanned: ${report.itemsScanned}`,
    `Gate candidates: ${report.gateCandidates.length}`,
    `Positive lessons: ${report.positiveLessons.length}`,
    '',
  ];
  if (report.gateCandidates.length) {
    lines.push('## Proposed ThumbGate Gates', '');
    for (const candidate of report.gateCandidates) {
      lines.push(`- **${candidate.action.toUpperCase()}** ${candidate.pattern}`);
      lines.push(`  - Source: ${candidate.provider} / ${candidate.sourceKind}`);
      lines.push(`  - Reason: ${candidate.reason}`);
    }
    lines.push('');
  }
  if (report.positiveLessons.length) {
    lines.push('## Positive Lessons', '');
    for (const candidate of report.positiveLessons) {
      lines.push(`- ${candidate.pattern}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { json: false, markdown: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--markdown') args.markdown = true;
    else if (arg.startsWith('--file=')) args.file = arg.slice('--file='.length);
    else if (arg.startsWith('--provider=')) args.provider = arg.slice('--provider='.length);
  }
  return args;
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args.file ? fs.readFileSync(args.file, 'utf8') : readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = raw;
  }
  const report = buildMemoryProviderBridgeReport(payload, { provider: args.provider });
  process.stdout.write(args.markdown
    ? `${formatMemoryProviderBridgeMarkdown(report)}\n`
    : `${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizeMemoryProviderPayload,
  extractEnforcementCandidates,
  buildCaptureParams,
  buildMemoryProviderBridgeReport,
  formatMemoryProviderBridgeMarkdown,
};
