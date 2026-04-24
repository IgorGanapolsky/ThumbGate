'use strict';

/**
 * Phase 9: Intelligence — context-engine + skill-quality-tracker tests
 * Requirements: INTL-01, INTL-02, INTL-03
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// context-engine tests (INTL-01)
// ---------------------------------------------------------------------------

describe('context-engine: categorizeDoc', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/context-engine.js')];
    m = require('../scripts/context-engine.js');
  });

  it('categorizes CI-related files as ci-cd', () => {
    assert.equal(m.categorizeDoc('CI_FIXES.md'), 'ci-cd');
    assert.equal(m.categorizeDoc('BUILD_GUIDE.md'), 'ci-cd');
    assert.equal(m.categorizeDoc('WORKFLOW.md'), 'ci-cd');
  });

  it('categorizes test files as testing', () => {
    assert.equal(m.categorizeDoc('TEST_STRATEGY.md'), 'testing');
    assert.equal(m.categorizeDoc('COVERAGE_REPORT.md'), 'testing');
  });

  it('categorizes security files as security', () => {
    assert.equal(m.categorizeDoc('SECURITY_AUDIT.md'), 'security');
    assert.equal(m.categorizeDoc('CVE_POLICY.md'), 'security');
  });

  it('categorizes MCP/AI files as mcp-ai', () => {
    assert.equal(m.categorizeDoc('MCP_SERVER.md'), 'mcp-ai');
    assert.equal(m.categorizeDoc('CLAUDE_USAGE.md'), 'mcp-ai');
    assert.equal(m.categorizeDoc('AGENT_GUIDE.md'), 'mcp-ai');
  });

  it('categorizes ANDROID as mobile-dev before ci-cd', () => {
    assert.equal(m.categorizeDoc('ANDROID_BUILD.md'), 'mobile-dev');
  });

  it('returns general for unrecognized files', () => {
    assert.equal(m.categorizeDoc('RANDOM_DOC.md'), 'general');
  });
});

describe('context-engine: extractDocSummary', () => {
  let m;
  let tmpDir;
  before(() => {
    delete require.cache[require.resolve('../scripts/context-engine.js')];
    m = require('../scripts/context-engine.js');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts title and summary from markdown', () => {
    const mdPath = path.join(tmpDir, 'test.md');
    fs.writeFileSync(mdPath, '# My Title\n\nFirst paragraph.\nSecond line.\nThird line.\nFourth line.');
    const { title, summary } = m.extractDocSummary(mdPath);
    assert.equal(title, 'My Title');
    assert.ok(summary.includes('First paragraph.'));
    assert.ok(summary.includes('Third line.'));
    assert.ok(!summary.includes('Fourth line.'));
  });

  it('returns filename as title when file has no heading', () => {
    const mdPath = path.join(tmpDir, 'no-heading.md');
    fs.writeFileSync(mdPath, 'Just some text without a heading.');
    const { title } = m.extractDocSummary(mdPath);
    assert.equal(title, 'no-heading');
  });

  it('returns empty summary for missing file', () => {
    const { title, summary } = m.extractDocSummary('/nonexistent/path/file.md');
    assert.equal(summary, '');
  });
});

describe('context-engine: buildKnowledgeIndex', () => {
  let m;
  let tmpDir;
  before(() => {
    delete require.cache[require.resolve('../scripts/context-engine.js')];
    m = require('../scripts/context-engine.js');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-idx-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds index from docs directory', () => {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'CI_FIXES.md'), '# CI Fixes\nFix build issues.');
    fs.writeFileSync(path.join(docsDir, 'TEST_GUIDE.md'), '# Test Guide\nHow to write tests.');
    fs.writeFileSync(path.join(docsDir, 'RANDOM.md'), '# Random\nGeneral notes.');

    const outputPath = path.join(tmpDir, 'knowledge-index.json');
    const index = m.buildKnowledgeIndex(docsDir, outputPath);

    assert.ok(index.bundles);
    assert.ok(index.metadata);
    assert.equal(index.metadata.docCount, 3);
    assert.ok(index.bundles['ci-cd'] || index.bundles['testing'] || index.bundles['general']);
    assert.ok(fs.existsSync(outputPath));
  });

  it('returns empty bundles for missing docs dir', () => {
    const outputPath = path.join(tmpDir, 'empty-index.json');
    const index = m.buildKnowledgeIndex('/nonexistent/dir', outputPath);
    assert.equal(index.metadata.docCount, 0);
    assert.deepEqual(index.bundles, {});
  });

  it('index has checksum in metadata', () => {
    const docsDir = path.join(tmpDir, 'docs2');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'MCP_GUIDE.md'), '# MCP Guide\nHow to use MCP.');
    const outputPath = path.join(tmpDir, 'idx2.json');
    const index = m.buildKnowledgeIndex(docsDir, outputPath);
    assert.ok(index.metadata.checksum);
    assert.equal(typeof index.metadata.checksum, 'string');
  });
});

describe('context-engine: scoreBundle', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/context-engine.js')];
    m = require('../scripts/context-engine.js');
  });

  it('returns 0 for empty keywords', () => {
    const bundle = { keywords: [], docs: [{ filename: 'x.md' }] };
    assert.equal(m.scoreBundle(['test', 'fix'], bundle), 0);
  });

  it('returns 0 for empty query tokens', () => {
    const bundle = { keywords: ['test', 'build'], docs: [{ filename: 'x.md' }] };
    assert.equal(m.scoreBundle([], bundle), 0);
  });

  it('returns positive score for matching tokens', () => {
    const bundle = { keywords: ['build', 'ci', 'pipeline'], docs: [{ filename: 'CI.md' }] };
    const score = m.scoreBundle(['build', 'error'], bundle);
    assert.ok(score > 0, 'Expected positive score for matching token "build"');
  });

  it('normalized score accounts for bundle size', () => {
    const smallBundle = { keywords: ['test'], docs: [{ filename: 'TEST.md' }] };
    const largeBundle = {
      keywords: ['test', 'a', 'b', 'c', 'd'],
      docs: [{ filename: 'a.md' }, { filename: 'b.md' }, { filename: 'c.md' }, { filename: 'd.md' }],
    };
    const smallScore = m.scoreBundle(['test'], smallBundle);
    const largeScore = m.scoreBundle(['test'], largeBundle);
    // Small bundle should score higher (normalized by sqrt(size))
    assert.ok(smallScore > largeScore, `small(${smallScore}) should > large(${largeScore})`);
  });
});

describe('context-engine: routeQuery (INTL-01)', () => {
  let m;
  let tmpDir;
  let indexPath;
  before(() => {
    delete require.cache[require.resolve('../scripts/context-engine.js')];
    m = require('../scripts/context-engine.js');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-route-'));

    // Build a knowledge index with known categories
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'CI_BUILD_GUIDE.md'), '# CI Build Guide\nFix build failures and pipeline issues.');
    fs.writeFileSync(path.join(docsDir, 'TEST_STRATEGY.md'), '# Test Strategy\nHow to write unit and integration tests.');
    fs.writeFileSync(path.join(docsDir, 'MCP_SERVER.md'), '# MCP Server\nClaude agent MCP integration guide.');

    indexPath = path.join(tmpDir, 'knowledge-index.json');
    m.buildKnowledgeIndex(docsDir, indexPath);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('routes CI query to ci-cd bundle (INTL-01: single lookup)', () => {
    const result = m.routeQuery('How do I fix build failures?', indexPath, 3);
    assert.ok(result.results.length > 0, 'Should return at least one result');
    assert.equal(result.query, 'How do I fix build failures?');
    assert.ok(result.indexAge, 'Should report index age');
    const categories = result.results.map((r) => r.category);
    assert.ok(categories.includes('ci-cd'), `Expected ci-cd in ${JSON.stringify(categories)}`);
  });

  it('routes MCP query to mcp-ai bundle', () => {
    const result = m.routeQuery('How do I use Claude MCP agent integration?', indexPath, 3);
    const categories = result.results.map((r) => r.category);
    assert.ok(categories.includes('mcp-ai'), `Expected mcp-ai in ${JSON.stringify(categories)}`);
  });

  it('returns empty results for unrelated query', () => {
    const result = m.routeQuery('xyz abc nonexistent terms zzz', indexPath, 3);
    // All scores would be 0, so results array filtered to empty
    assert.equal(result.results.length, 0);
  });

  it('builds index on the fly if not found', () => {
    const missingPath = path.join(tmpDir, 'missing-index.json');
    // Should not throw; falls back to buildKnowledgeIndex()
    const result = m.routeQuery('test query', missingPath, 1);
    assert.ok(result);
    assert.equal(result.query, 'test query');
  });
});

describe('context-engine: TOOL_CONSOLIDATION', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/context-engine.js')];
    m = require('../scripts/context-engine.js');
  });

  it('uses local ThumbGate storage labels for memory query sources', () => {
    assert.deepEqual(
      m.TOOL_CONSOLIDATION['memory:query'].sources,
      ['jsonl-memory', 'lancedb-vectors']
    );
  });

  it('does not leak dropped ShieldCortex terminology into the runtime manifest', () => {
    const sources = m.TOOL_CONSOLIDATION['memory:query'].sources.join(' ');
    assert.equal(/shieldcortex/i.test(sources), false);
  });
});

describe('context-engine: scoreRetrievalQuality', () => {
  let m;
  let tmpDir;
  before(() => {
    delete require.cache[require.resolve('../scripts/context-engine.js')];
    m = require('../scripts/context-engine.js');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qual-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 precision/recall for empty inputs', () => {
    const logPath = path.join(tmpDir, 'qual.jsonl');
    // Temporarily override DEFAULT_QUALITY_LOG_PATH by passing logPath to logQualityResult
    const result = m.scoreRetrievalQuality('query', [], ['topic'], logPath);
    assert.equal(result.precision, 0);
    assert.equal(result.recall, 0);
    assert.equal(result.f1, 0);
  });

  it('computes correct precision/recall for perfect match', () => {
    const logPath = path.join(tmpDir, 'qual-perfect.jsonl');
    const result = m.scoreRetrievalQuality(
      'test query',
      ['CI_FIXES.md'],
      ['ci'],
      logPath
    );
    assert.equal(result.precision, 1);
    assert.equal(result.recall, 1);
    assert.equal(result.f1, 1);
  });

  it('computes partial recall when not all topics covered', () => {
    const logPath = path.join(tmpDir, 'qual-partial.jsonl');
    const result = m.scoreRetrievalQuality(
      'test query',
      ['CI_FIXES.md'],
      ['ci', 'security', 'testing'],
      logPath
    );
    // 1 doc covers 1 topic out of 3
    assert.equal(result.recall, Math.round((1 / 3) * 1000) / 1000);
    assert.ok(result.f1 > 0 && result.f1 < 1);
  });
});

describe('context-engine: prompt registry', () => {
  let m;
  let tmpDir;
  before(() => {
    delete require.cache[require.resolve('../scripts/context-engine.js')];
    m = require('../scripts/context-engine.js');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-reg-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers and retrieves a prompt', () => {
    const regPath = path.join(tmpDir, 'registry.json');
    const result = m.registerPrompt(
      'code-review',
      'Review this code: {{code}}',
      { version: '1.0.0', models: ['claude-opus-4-6'], category: 'code' },
      regPath
    );
    assert.equal(result.registered, true);

    const prompt = m.getPrompt('code-review', 'claude-opus-4-6', regPath);
    assert.ok(prompt);
    assert.equal(prompt.template, 'Review this code: {{code}}');
    assert.equal(prompt.compatible, true);
  });

  it('returns null for incompatible model', () => {
    const regPath = path.join(tmpDir, 'registry2.json');
    m.registerPrompt(
      'my-prompt',
      'Hello {{name}}',
      { models: ['claude-opus-4-6'], category: 'general' },
      regPath
    );
    const result = m.getPrompt('my-prompt', 'gpt-4', regPath);
    assert.equal(result, null);
  });

  it('returns null for missing prompt name', () => {
    const regPath = path.join(tmpDir, 'registry3.json');
    const result = m.getPrompt('nonexistent', null, regPath);
    assert.equal(result, null);
  });

  it('listPrompts returns all registered prompts', () => {
    const regPath = path.join(tmpDir, 'registry4.json');
    m.registerPrompt('p1', 'template1', { models: [], category: 'a' }, regPath);
    m.registerPrompt('p2', 'template2', { models: [], category: 'b' }, regPath);
    const list = m.listPrompts(regPath);
    assert.equal(list.length, 2);
    const names = list.map((e) => e.name);
    assert.ok(names.includes('p1'));
    assert.ok(names.includes('p2'));
  });

  it('supports metadata.model (single string) as well as models array', () => {
    const regPath = path.join(tmpDir, 'registry5.json');
    m.registerPrompt(
      'single-model',
      'Hello',
      { model: 'claude-opus-4-6', category: 'test' },
      regPath
    );
    const prompt = m.getPrompt('single-model', 'claude-opus-4-6', regPath);
    assert.ok(prompt);
    assert.equal(prompt.compatible, true);
  });
});

// ---------------------------------------------------------------------------
// skill-quality-tracker tests (INTL-02, INTL-03)
// ---------------------------------------------------------------------------

describe('skill-quality-tracker: parseLine', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/skill-quality-tracker.js')];
    m = require('../scripts/skill-quality-tracker.js');
  });

  it('parses valid JSON', () => {
    const result = m.parseLine('{"tool_name":"Read","timestamp":"2026-01-01T00:00:00Z"}');
    assert.ok(result);
    assert.equal(result.tool_name, 'Read');
  });

  it('returns null for invalid JSON', () => {
    assert.equal(m.parseLine('NOT JSON'), null);
    assert.equal(m.parseLine(''), null);
  });
});

describe('skill-quality-tracker: correlateFeedback (INTL-02)', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/skill-quality-tracker.js')];
    m = require('../scripts/skill-quality-tracker.js');
  });

  it('correlates feedback within window', () => {
    const baseTs = Date.now();
    const feedbackEntries = [
      { ts: baseTs + 30_000, feedback: 'positive', tool: null },
    ];
    const result = m.correlateFeedback(baseTs, 'Read', feedbackEntries);
    assert.equal(result, 'positive');
  });

  it('does not correlate feedback outside window', () => {
    const baseTs = Date.now();
    const feedbackEntries = [
      { ts: baseTs + 90_000, feedback: 'positive', tool: null },
    ];
    const result = m.correlateFeedback(baseTs, 'Read', feedbackEntries);
    assert.equal(result, null);
  });

  it('matches tool-specific feedback when tool matches', () => {
    const baseTs = Date.now();
    const feedbackEntries = [
      { ts: baseTs + 1000, feedback: 'negative', tool: 'Write' },
    ];
    // Different tool — should NOT correlate
    const result = m.correlateFeedback(baseTs, 'Read', feedbackEntries);
    assert.equal(result, null);
  });

  it('matches tool-specific feedback when tool is null (any tool)', () => {
    const baseTs = Date.now();
    const feedbackEntries = [
      { ts: baseTs + 1000, feedback: 'negative', tool: null },
    ];
    const result = m.correlateFeedback(baseTs, 'Read', feedbackEntries);
    assert.equal(result, 'negative');
  });
});

describe('skill-quality-tracker: computeSuccessRates', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/skill-quality-tracker.js')];
    m = require('../scripts/skill-quality-tracker.js');
  });

  it('computes success rate as ratio', () => {
    const breakdown = {
      Read: { uses: 10, correlatedPositive: 8, correlatedNegative: 2 },
    };
    m.computeSuccessRates(breakdown);
    assert.equal(breakdown.Read.successRate, 0.8);
  });

  it('sets successRate to null when no correlated feedback', () => {
    const breakdown = {
      Write: { uses: 5, correlatedPositive: 0, correlatedNegative: 0 },
    };
    m.computeSuccessRates(breakdown);
    assert.equal(breakdown.Write.successRate, null);
  });

  it('handles 100% success rate', () => {
    const breakdown = {
      Bash: { uses: 3, correlatedPositive: 3, correlatedNegative: 0 },
    };
    m.computeSuccessRates(breakdown);
    assert.equal(breakdown.Bash.successRate, 1.0);
  });
});

describe('skill-quality-tracker: topPerformers', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/skill-quality-tracker.js')];
    m = require('../scripts/skill-quality-tracker.js');
  });

  it('returns top performers sorted by success rate', () => {
    const breakdown = {
      Read: { uses: 20, correlatedPositive: 18, correlatedNegative: 2, successRate: 0.9 },
      Write: { uses: 15, correlatedPositive: 9, correlatedNegative: 6, successRate: 0.6 },
      Bash: { uses: 10, correlatedPositive: 5, correlatedNegative: 5, successRate: 0.5 },
    };
    const top = m.topPerformers(breakdown, 10, 3);
    assert.ok(top.length > 0);
    assert.equal(top[0].tool, 'Read');
    assert.equal(top[0].successRate, 0.9);
  });

  it('excludes tools below minimum uses threshold', () => {
    const breakdown = {
      RareSkill: { uses: 3, correlatedPositive: 3, correlatedNegative: 0, successRate: 1.0 },
      CommonSkill: { uses: 15, correlatedPositive: 12, correlatedNegative: 3, successRate: 0.8 },
    };
    const top = m.topPerformers(breakdown, 10, 5);
    const names = top.map((t) => t.tool);
    assert.ok(!names.includes('RareSkill'), 'Should exclude tools with < min uses');
    assert.ok(names.includes('CommonSkill'));
  });

  it('excludes tools with null successRate', () => {
    const breakdown = {
      UnusedFeedback: { uses: 50, correlatedPositive: 0, correlatedNegative: 0, successRate: null },
    };
    const top = m.topPerformers(breakdown, 10, 5);
    assert.equal(top.length, 0);
  });
});

describe('skill-quality-tracker: troubleSpots', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/skill-quality-tracker.js')];
    m = require('../scripts/skill-quality-tracker.js');
  });

  it('identifies high negative rate tools', () => {
    const breakdown = {
      ProblematicTool: { uses: 10, correlatedPositive: 2, correlatedNegative: 8 },
      GoodTool: { uses: 10, correlatedPositive: 9, correlatedNegative: 1 },
    };
    const spots = m.troubleSpots(breakdown);
    assert.ok(spots.some((s) => s.tool === 'ProblematicTool'));
    assert.ok(!spots.some((s) => s.tool === 'GoodTool'));
  });

  it('returns empty array when no trouble spots', () => {
    const breakdown = {
      GoodTool: { uses: 10, correlatedPositive: 9, correlatedNegative: 0 },
    };
    const spots = m.troubleSpots(breakdown);
    assert.equal(spots.length, 0);
  });
});

describe('skill-quality-tracker: generateRecommendations', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/skill-quality-tracker.js')];
    m = require('../scripts/skill-quality-tracker.js');
  });

  it('recommends investigating trouble spots', () => {
    const top = [];
    const trouble = [{ tool: 'BadTool', negativeRate: 0.7, uses: 15 }];
    const recs = m.generateRecommendations(top, trouble, {});
    assert.ok(recs.some((r) => r.includes('BadTool')));
  });

  it('recommends expanding top performers', () => {
    const top = [{ tool: 'BestTool', successRate: 0.95, uses: 20 }];
    const recs = m.generateRecommendations(top, [], {});
    assert.ok(recs.some((r) => r.includes('BestTool')));
  });

  it('returns default message when no actionable recs', () => {
    const recs = m.generateRecommendations([], [], {});
    assert.ok(recs.length > 0);
    assert.ok(recs[0].includes('No actionable'));
  });

  it('mentions uncorrelated tools when 10+ uses with no feedback', () => {
    const breakdown = {
      LostTool: { uses: 10, correlatedPositive: 0, correlatedNegative: 0, successRate: null },
    };
    const recs = m.generateRecommendations([], [], breakdown);
    assert.ok(recs.some((r) => r.includes('no correlated feedback')));
  });
});

describe('skill-quality-tracker: processMetrics', () => {
  let m;
  let tmpDir;
  before(() => {
    delete require.cache[require.resolve('../scripts/skill-quality-tracker.js')];
    m = require('../scripts/skill-quality-tracker.js');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqt-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty breakdown for missing metrics file', async () => {
    const result = await m.processMetrics('/nonexistent/metrics.jsonl', []);
    assert.equal(result.totalToolUses, 0);
    assert.deepEqual(result.breakdown, {});
  });

  it('processes metrics and correlates feedback by proximity', async () => {
    const now = Date.now();
    const metricsPath = path.join(tmpDir, 'metrics.jsonl');
    const metrics = [
      { tool_name: 'Read', timestamp: new Date(now).toISOString() },
      { tool_name: 'Write', timestamp: new Date(now + 120_000).toISOString() }, // outside window
    ];
    fs.writeFileSync(metricsPath, metrics.map((m) => JSON.stringify(m)).join('\n'));

    // Feedback 20s after Read call — within window
    const feedbackEntries = [
      { ts: now + 20_000, feedback: 'positive', tool: null },
    ];

    const { totalToolUses, breakdown } = await m.processMetrics(metricsPath, feedbackEntries);
    assert.equal(totalToolUses, 2);
    assert.equal(breakdown.Read.correlatedPositive, 1);
    assert.equal(breakdown.Write.correlatedPositive, 0);
  });
});

describe('skill-quality-tracker: INTL-03 — positive skill scores higher than mixed (INTL-03)', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/skill-quality-tracker.js')];
    m = require('../scripts/skill-quality-tracker.js');
  });

  it('consistently positive skill rates higher than mixed skill (INTL-03)', () => {
    const breakdown = {
      ConsistentSkill: { uses: 20, correlatedPositive: 18, correlatedNegative: 2 },
      MixedSkill: { uses: 20, correlatedPositive: 10, correlatedNegative: 10 },
    };
    m.computeSuccessRates(breakdown);
    assert.ok(
      breakdown.ConsistentSkill.successRate > breakdown.MixedSkill.successRate,
      `Consistent(${breakdown.ConsistentSkill.successRate}) should > Mixed(${breakdown.MixedSkill.successRate})`
    );
  });
});

describe('skill-quality-tracker: loadFeedback', () => {
  let m;
  let tmpDir;
  before(() => {
    delete require.cache[require.resolve('../scripts/skill-quality-tracker.js')];
    m = require('../scripts/skill-quality-tracker.js');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqt-fb-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array for missing file', async () => {
    const entries = await m.loadFeedback('/nonexistent/feedback.jsonl');
    assert.deepEqual(entries, []);
  });

  it('loads and normalizes feedback entries from JSONL', async () => {
    const feedbackPath = path.join(tmpDir, 'feedback.jsonl');
    const now = new Date().toISOString();
    const entries = [
      { timestamp: now, feedback: 'up' },                    // legacy feedback-field format
      { timestamp: now, signal: 'positive' },                 // ThumbGate signal format
      { timestamp: now, feedback: 'down', tool_name: 'Read' }, // with tool_name
    ];
    fs.writeFileSync(feedbackPath, entries.map((e) => JSON.stringify(e)).join('\n'));

    const loaded = await m.loadFeedback(feedbackPath);
    assert.equal(loaded.length, 3);
    assert.equal(loaded[0].feedback, 'positive'); // 'up' normalized
    assert.equal(loaded[1].feedback, 'positive'); // 'positive' unchanged
    assert.equal(loaded[2].feedback, 'negative'); // 'down' normalized
    assert.equal(loaded[2].tool, 'Read');
  });

  it('sorts entries by timestamp ascending', async () => {
    const feedbackPath = path.join(tmpDir, 'feedback-sorted.jsonl');
    const t1 = new Date(2026, 0, 1).toISOString();
    const t2 = new Date(2026, 0, 2).toISOString();
    const entries = [
      { timestamp: t2, feedback: 'up' },
      { timestamp: t1, feedback: 'down' },
    ];
    fs.writeFileSync(feedbackPath, entries.map((e) => JSON.stringify(e)).join('\n'));
    const loaded = await m.loadFeedback(feedbackPath);
    assert.ok(loaded[0].ts < loaded[1].ts, 'Should be sorted ascending');
  });
});
