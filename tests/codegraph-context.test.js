const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeCodeGraphImpact,
  extractSymbolHints,
  formatCodeGraphRecallSection,
  looksLikeCodeWorkflow,
} = require('../scripts/codegraph-context');

const STUB_RESPONSE = JSON.stringify({
  source: 'stub',
  symbols: ['planIntent'],
  callers: ['src/api/server.js -> planIntent', 'adapters/mcp/server-stdio.js -> planIntent'],
  callees: ['rankActions', 'decomposeActions'],
  deadCode: ['legacyIntentPlanner'],
});

test('looksLikeCodeWorkflow detects code paths and symbols', () => {
  assert.equal(looksLikeCodeWorkflow({ context: 'Refactor `planIntent` in scripts/intent-router.js' }), true);
  assert.equal(looksLikeCodeWorkflow({ context: 'Write a customer follow-up email' }), false);
});

test('extractSymbolHints prioritizes code-like identifiers', () => {
  const symbols = extractSymbolHints('Refactor `planIntent` in scripts/intent-router.js and verify rankActions()');
  assert.ok(symbols.includes('planIntent'));
  assert.ok(symbols.includes('rankActions'));
});

test('extractSymbolHints safely handles long non-symbol noise before PascalCase tokens', () => {
  const symbols = extractSymbolHints(`${'0A'.repeat(4000)} review ReliabilityStudioCompareAndDeploy`);
  assert.ok(symbols.includes('ReliabilityStudioCompareAndDeploy'));
});

test('analyzeCodeGraphImpact normalizes stub evidence and verification hints', () => {
  const previous = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = STUB_RESPONSE;

  try {
    const impact = analyzeCodeGraphImpact({
      context: 'Refactor `planIntent` in scripts/intent-router.js',
    });

    assert.equal(impact.enabled, true);
    assert.equal(impact.source, 'stub');
    assert.equal(impact.symbols[0], 'planIntent');
    assert.equal(impact.evidence.callerCount, 2);
    assert.equal(impact.evidence.deadCodeCount, 1);
    assert.ok(impact.verificationHints.some((hint) => /dead code/i.test(hint)));
  } finally {
    if (previous === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previous;
  }
});

test('analyzeCodeGraphImpact ignores malformed stub JSON', () => {
  const previous = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = '{invalid json';

  try {
    const impact = analyzeCodeGraphImpact({
      context: 'Refactor `planIntent` in scripts/intent-router.js',
    });

    assert.equal(impact.enabled, false);
    assert.equal(impact.hasImpact, false);
    assert.equal(impact.summary, '');
  } finally {
    if (previous === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previous;
  }
});

test('formatCodeGraphRecallSection returns readable structural evidence', () => {
  const section = formatCodeGraphRecallSection({
    enabled: true,
    hasImpact: true,
    summary: 'Focus symbol: planIntent. 2 caller paths to verify.',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent'],
    callees: ['rankActions'],
    deadCode: ['legacyIntentPlanner'],
    verificationHints: ['Review potential dead code before merge.'],
  });

  assert.match(section, /## Code Graph Impact/);
  assert.match(section, /Potential dead code/);
  assert.match(section, /planIntent/);
});
