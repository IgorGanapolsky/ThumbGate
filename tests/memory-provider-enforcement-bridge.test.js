'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeMemoryProviderPayload,
  extractEnforcementCandidates,
  buildCaptureParams,
  buildMemoryProviderBridgeReport,
  formatMemoryProviderBridgeMarkdown,
} = require('../scripts/integrations/memory-provider-enforcement-bridge');

test('normalizes Hermes memory records into provider-scoped items', () => {
  const normalized = normalizeMemoryProviderPayload({
    provider: 'Hermes',
    memories: [
      { type: 'case', text: 'Agent called an external API in a retry loop after a 429 timeout.' },
    ],
  });
  assert.equal(normalized.provider, 'hermes');
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.items[0].kind, 'case');
});

test('turns external API retry memory into a blocking ThumbGate candidate', () => {
  const report = buildMemoryProviderBridgeReport({
    provider: 'everos',
    context: 'A Claude Code agent hit a 429 timeout, retried the external API in a loop, spent money, and corrupted state.',
  });
  assert.equal(report.provider, 'everos');
  assert.equal(report.gateCandidates.length, 1);
  assert.equal(report.gateCandidates[0].action, 'block');
  assert.match(report.gateCandidates[0].pattern, /429 timeout/i);
  assert.ok(report.gateCandidates[0].tags.includes('provider:everos'));
});

test('keeps verified success as positive lesson instead of blocking gate', () => {
  const report = buildMemoryProviderBridgeReport({
    provider: 'honcho',
    memories: ['Verified approval checklist worked before deployment and kept the release safe.'],
  });
  assert.equal(report.gateCandidates.length, 0);
  assert.equal(report.positiveLessons.length, 1);
  assert.equal(report.positiveLessons[0].action, 'allow-note');
});

test('buildCaptureParams maps a negative candidate to feedback capture shape', () => {
  const [candidate] = extractEnforcementCandidates(normalizeMemoryProviderPayload({
    provider: 'hermes',
    memory: 'Hermes tool call leaked an API key into a browser automation transcript.',
  }));
  const params = buildCaptureParams(candidate);
  assert.equal(params.signal, 'down');
  assert.equal(params.source, 'memory-provider-enforcement-bridge');
  assert.match(params.whatWentWrong, /API key/i);
  assert.match(params.preventionHint, /block/i);
});

test('markdown report is useful for operator review and ad evidence', () => {
  const markdown = formatMemoryProviderBridgeMarkdown(buildMemoryProviderBridgeReport({
    provider: 'hermes',
    memory: 'Agent ignored identity scope and used the wrong tool permission before an MCP call.',
  }));
  assert.match(markdown, /Memory Provider Enforcement Bridge: hermes/);
  assert.match(markdown, /Proposed ThumbGate Gates/);
  assert.match(markdown, /identity scope/);
});

test('normalizes TencentDB Agent Memory records and compiles blocking SQL safety candidate', () => {
  const report = buildMemoryProviderBridgeReport({
    provider: 'tencentdb-agent-memory',
    db_memory: [
      { type: 'schema_failure', text: 'Database agent executed unindexed query and attempted TRUNCATE on production table.' },
    ],
  });
  assert.equal(report.provider, 'tencentdb-agent-memory');
  assert.equal(report.gateCandidates.length, 1);
  assert.equal(report.gateCandidates[0].action, 'block');
  assert.match(report.gateCandidates[0].pattern, /truncate/i);
  assert.ok(report.gateCandidates[0].tags.includes('provider:tencentdb-agent-memory'));
});
