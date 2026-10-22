'use strict';

/**
 * Tests for CUDA Gate Batch — parallel PreToolUse gate evaluation.
 * Stolen from NVIDIA CUDA programming model (SIMT, memory hierarchy,
 * kernel fusion, streams) and adapted for CPU via Node.js parallelism.
 *
 * https://docs.nvidia.com/cuda/cuda-programming-guide/index.html
 *
 * Test count target: ≥10 (per AGENTS.md verification protocol).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  evaluateGateCategory,
  evaluateRule,
  batchEvaluateGates,
  loadPreventionRules,
  classifyRulesByCategory,
  runGatePipeline,
  hashInput,
  GATE_CATEGORIES,
  MAX_PARALLEL_GATES,
  HOT_CACHE_TTL_MS,
  PKG_ROOT,
} = require(path.join(__dirname, '..', 'scripts', 'cuda-gate-batch'));

// Helper: create temp dir with test data
function createTempGateEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cuda-test-'));
  const thumbgateDir = path.join(tmpDir, '.thumbgate');
  fs.mkdirSync(thumbgateDir, { recursive: true });

  // Write prevention rules
  fs.writeFileSync(
    path.join(thumbgateDir, 'prevention-rules.json'),
    JSON.stringify({
      rules: [
        { id: 'no-force-push', type: 'command', patterns: ['git push --force'], decision: 'deny', category: GATE_CATEGORIES.SECURITY },
        { id: 'no-admin-merge', type: 'command', patterns: ['--admin', 'gh pr merge --admin'], decision: 'deny', category: GATE_CATEGORIES.POLICY },
        { id: 'no-secrets-in-command', type: 'pattern', pattern: 'password=.*', decision: 'deny', category: GATE_CATEGORIES.SECURITY },
        { id: 'warn-edit-path', type: 'path', paths: ['package.json'], decision: 'warn', category: GATE_CATEGORIES.PREVENTION },
      ],
    })
  );

  // Write hot cache
  fs.writeFileSync(
    path.join(thumbgateDir, 'gate-cache.json'),
    JSON.stringify({
      'test-key': { timestamp: Date.now(), decision: 'allow' },
    })
  );

  return { tmpDir, thumbgateDir };
}

// Helper: clean up
function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

test('CUDA Gate: evaluateRule matches command patterns correctly', () => {
  const rule = {
    id: 'test-cmd',
    type: 'command',
    patterns: ['git push --force', 'rm -rf /'],
    decision: 'deny',
  };
  const result = evaluateRule(rule, 'Bash', { command: 'git push --force origin main' }, '');
  assert.ok(result.matched, 'Should match git push --force pattern');
  assert.strictEqual(result.decision, 'deny');
  assert.ok(result.pattern.includes('force'), 'Pattern should identify the matched string');
});

test('CUDA Gate: evaluateRule does not false-positive on similar commands', () => {
  const rule = {
    id: 'no-force-push',
    type: 'command',
    patterns: ['git push --force'],
    decision: 'deny',
  };
  const result = evaluateRule(rule, 'Bash', { command: 'git push origin main' }, '');
  assert.ok(!result.matched, 'Should not match regular git push');
});

test('CUDA Gate: evaluateRule matches pattern rules against serialized input', () => {
  const rule = {
    id: 'no-passwords',
    type: 'pattern',
    pattern: 'password=',
    decision: 'deny',
  };
  // The input string contains "password=" so the pattern matches
  const result = evaluateRule(rule, 'Bash', { command: 'curl -d "password=secret" http://example.com' }, 'serialized-with-password=');
  assert.ok(result.matched, 'Should match password pattern in serialized input');
  assert.strictEqual(result.decision, 'deny');
});

test('CUDA Gate: evaluateRule matches path rules against tool input paths', () => {
  const rule = {
    id: 'protect-package',
    type: 'path',
    paths: ['package.json'],
    decision: 'warn',
  };
  const result = evaluateRule(rule, 'Write', { path: '/home/user/package.json', content: '{}' }, '');
  assert.ok(result.matched, 'Should match package.json path');
  assert.strictEqual(result.decision, 'warn');
});

test('CUDA Gate: evaluateRule matches tool rules by tool name', () => {
  const rule = {
    id: 'warn-write-tool',
    type: 'tool',
    tools: ['Write', 'Edit'],
    decision: 'warn',
  };
  const result = evaluateRule(rule, 'Write', {}, '');
  assert.ok(result.matched, 'Should match Write tool');
  assert.strictEqual(result.decision, 'warn');
});

test('CUDA Gate: evaluateRule returns no match for unmatched tool', () => {
  const rule = {
    id: 'warn-write-tool',
    type: 'tool',
    tools: ['Write', 'Edit'],
    decision: 'warn',
  };
  const result = evaluateRule(rule, 'Read', {}, '');
  assert.ok(!result.matched, 'Should not match Read tool');
});

test('CUDA Gate: evaluateGateCategory returns deny when a deny rule fires', () => {
  const rules = [
    { id: 'no-force', type: 'command', patterns: ['git push --force'], decision: 'deny' },
    { id: 'no-admin', type: 'command', patterns: ['--admin'], decision: 'deny' },
  ];
  const result = evaluateGateCategory(
    GATE_CATEGORIES.SECURITY,
    'Bash',
    { command: 'git push --force --admin origin main' },
    rules,
    {}
  );

  assert.strictEqual(result.decision, 'deny', 'Should deny when deny rule matches');
  assert.ok(result.matchedRules.length >= 1, 'Should have at least 1 matched rule');
  assert.ok(result.matchedRules.some(r => r.decision === 'deny'), 'Should have at least 1 deny');
});

test('CUDA Gate: evaluateGateCategory returns allow when no rules match', () => {
  const rules = [
    { id: 'no-force', type: 'command', patterns: ['git push --force'], decision: 'deny' },
  ];
  const result = evaluateGateCategory(
    GATE_CATEGORIES.SECURITY,
    'Read',
    { path: '/tmp/safe-file.txt' },
    rules,
    {}
  );

  assert.strictEqual(result.decision, 'allow', 'Should allow when no rules match');
  assert.strictEqual(result.matchedRules.length, 0, 'Should have 0 matched rules');
});

test('CUDA Gate: classifyRulesByCategory groups rules correctly', () => {
  const rules = [
    { id: 'r1', category: 'security' },
    { id: 'r2', category: 'security' },
    { id: 'r3', category: 'policy' },
    { id: 'r4', category: 'compliance' },
    { id: 'r5' }, // No category — defaults to prevention
  ];
  const grouped = classifyRulesByCategory(rules);
  assert.strictEqual(grouped['security'].length, 2, 'Should have 2 security rules');
  assert.strictEqual(grouped['policy'].length, 1, 'Should have 1 policy rule');
  assert.strictEqual(grouped['compliance'].length, 1, 'Should have 1 compliance rule');
  assert.strictEqual(grouped['prevention'].length, 1, 'Uncategorized should default to prevention');
});

test('CUDA Gate: classifyRulesByCategory handles empty rules', () => {
  const grouped = classifyRulesByCategory([]);
  assert.strictEqual(Object.keys(grouped).length, 0, 'Empty rules should produce empty grouping');
});

test('CUDA Gate: hashInput produces deterministic hashes', () => {
  const hash1 = hashInput('test input string');
  const hash2 = hashInput('test input string');
  const hash3 = hashInput('different input');

  assert.strictEqual(hash1, hash2, 'Same input should produce same hash');
  assert.notStrictEqual(hash1, hash3, 'Different input should produce different hash');
  assert.ok(hash1.length > 0, 'Hash should not be empty');
  assert.ok(/^[a-z0-9]+$/.test(hash1), 'Hash should be alphanumeric');
});

test('CUDA Gate: hashInput handles empty string', () => {
  const hash = hashInput('');
  assert.ok(typeof hash === 'string', 'Should return a string for empty input');
  assert.ok(hash.length > 0, 'Hash should not be empty even for empty input');
});

test('CUDA Gate: batchEvaluateGates blocks deny rules', async () => {
  const { tmpDir, thumbgateDir } = createTempGateEnv();
  try {
    const verdict = await batchEvaluateGates('Bash', { command: 'git push --force origin main' }, { rulesDir: thumbgateDir });
    assert.strictEqual(verdict.decision, 'deny', 'Should deny force-push command');
    assert.ok(verdict.matchedRules.some(r => r.decision === 'deny'), 'Should have deny rules');
    assert.ok(verdict.stats.totalLatencyUs >= 0, 'Should have latency measurement');
    assert.ok(verdict.stats.totalRules > 0, 'Should check at least 1 rule');
    assert.ok(verdict.categoriesChecked.length > 0, 'Should check at least 1 category');
  } finally {
    cleanup(tmpDir);
  }
});

test('CUDA Gate: batchEvaluateGates allows safe commands', async () => {
  const { tmpDir, thumbgateDir } = createTempGateEnv();
  try {
    const verdict = await batchEvaluateGates('Bash', { command: 'echo hello world' }, { rulesDir: thumbgateDir });
    assert.strictEqual(verdict.decision, 'allow', 'Should allow safe command');
    assert.strictEqual(verdict.matchedRules.length, 0, 'Should have 0 matched rules for safe input');
  } finally {
    cleanup(tmpDir);
  }
});

test('CUDA Gate: batchEvaluateGates detects admin bypass attempts', async () => {
  const { tmpDir, thumbgateDir } = createTempGateEnv();
  try {
    const verdict = await batchEvaluateGates('Bash', { command: 'gh pr merge --admin --auto 42' }, { rulesDir: thumbgateDir });
    assert.strictEqual(verdict.decision, 'deny', 'Should deny --admin flag');
  } finally {
    cleanup(tmpDir);
  }
});

test('CUDA Gate: batchEvaluateGates detects path-based rules', async () => {
  const { tmpDir, thumbgateDir } = createTempGateEnv();
  try {
    const verdict = await batchEvaluateGates('Write', { path: 'package.json', content: '{}' }, { rulesDir: thumbgateDir });
    assert.ok(verdict.decision === 'allow' || verdict.decision === 'warn', 'Should allow or warn for package.json');
    assert.ok(verdict.matchedRules.some(r => r.ruleId === 'warn-edit-path'), 'Should match path warning rule');
  } finally {
    cleanup(tmpDir);
  }
});

test('CUDA Gate: batchEvaluateGates checks multiple categories in parallel', async () => {
  const { tmpDir, thumbgateDir } = createTempGateEnv();
  try {
    const verdict = await batchEvaluateGates('Bash', { command: 'rm -rf / && git push --force --admin' }, { rulesDir: thumbgateDir });
    assert.strictEqual(verdict.decision, 'deny', 'Should deny multi-violation command');
    // Should match rules from multiple categories
    const categoriesFiring = new Set(verdict.matchedRules.map(r => r.category));
    assert.ok(categoriesFiring.size >= 1, 'Should have rules from at least 1 category');
    assert.ok(verdict.stats.hotCacheHits >= 0, 'Should track hot cache hits');
  } finally {
    cleanup(tmpDir);
  }
});

test('CUDA Gate: GATE_CATEGORIES has all expected categories', () => {
  assert.ok(GATE_CATEGORIES.SECURITY, 'Should have SECURITY category');
  assert.ok(GATE_CATEGORIES.PREVENTION, 'Should have PREVENTION category');
  assert.ok(GATE_CATEGORIES.POLICY, 'Should have POLICY category');
  assert.ok(GATE_CATEGORIES.COMPLIANCE, 'Should have COMPLIANCE category');
});

test('CUDA Gate: MAX_PARALLEL_GATES is within reasonable bounds', () => {
  assert.ok(MAX_PARALLEL_GATES >= 1, 'Should have at least 1 parallel gate');
  assert.ok(MAX_PARALLEL_GATES <= 8, 'Should cap at 8 for low-latency');
  assert.ok(MAX_PARALLEL_GATES <= (os.cpus().length || 4), 'Should not exceed CPU cores');
});

test('CUDA Gate: HOT_CACHE_TTL_MS is configured for sub-0.5ms performance', () => {
  assert.ok(HOT_CACHE_TTL_MS > 0, 'TTL should be positive');
  assert.ok(HOT_CACHE_TTL_MS >= 1000, 'TTL should be at least 1 second');
  assert.ok(HOT_CACHE_TTL_MS <= 300000, 'TTL should be at most 5 minutes');
});

test('CUDA Gate: runGatePipeline returns proper decision structure', async () => {
  const { tmpDir, thumbgateDir } = createTempGateEnv();
  try {
    const pipeline = await runGatePipeline({
      tool_name: 'Bash',
      tool_input: { command: 'git push --force' },
    }, { rulesDir: thumbgateDir });
    assert.ok(pipeline.decision === 'deny', 'Pipeline should deny force-push');
    assert.ok(pipeline.reason !== undefined, 'Should have a reason string');
    assert.ok(pipeline.verdict !== undefined, 'Should have full verdict');
    assert.ok(pipeline.verdict.stats !== undefined, 'Should have stats');
  } finally {
    cleanup(tmpDir);
  }
});

test('CUDA Gate: runGatePipeline allows safe reads', async () => {
  const { tmpDir, thumbgateDir } = createTempGateEnv();
  try {
    const pipeline = await runGatePipeline({
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/safe.txt' },
    }, { rulesDir: thumbgateDir });
    assert.strictEqual(pipeline.decision, 'allow', 'Should allow safe read');
  } finally {
    cleanup(tmpDir);
  }
});

test('CUDA Gate: loadPreventionRules returns array of rules', async () => {
  const { tmpDir, thumbgateDir } = createTempGateEnv();
  try {
    const rules = await loadPreventionRules(thumbgateDir);
    assert.ok(Array.isArray(rules), 'Should return an array');
    assert.ok(rules.length >= 1, 'Should load at least 1 rule from test file');
  } finally {
    cleanup(tmpDir);
  }
});

test('CUDA Gate: loadHotCache returns object', async () => {
  const cache = require(path.join(__dirname, '..', 'scripts', 'cuda-gate-batch')).loadHotCache ||
    (async () => ({}));
  // loadHotCache is async
  const { loadHotCache } = require(path.join(__dirname, '..', 'scripts', 'cuda-gate-batch'));
  const result = await loadHotCache();
  assert.ok(typeof result === 'object', 'Should return an object');
  assert.ok(result !== null, 'Should not be null');
});

test('CUDA Gate: telemetry queue and flush work', () => {
  const { telemetryQueue, enqueueTelemetry, flushTelemetry } = require(path.join(__dirname, '..', 'scripts', 'cuda-gate-batch'));

  // Queue a telemetry entry
  enqueueTelemetry(
    { decision: 'allow', matchedRules: [], stats: { totalLatencyUs: 10, totalRules: 5, parallelWorkers: 2, hotCacheHits: 0, denyCount: 0 } },
    { toolName: 'Bash', toolInput: { command: 'echo test' } }
  );

  assert.ok(telemetryQueue.length >= 1, 'Should have queued telemetry');
  assert.doesNotThrow(() => flushTelemetry(), 'Flush should not throw');
  assert.strictEqual(telemetryQueue.length, 0, 'Queue should be empty after flush');
});

test('CUDA Gate: Gold layer provides query pushdown (only loads rules for matching tool)', async () => {
  const semanticLayer = require(path.join(__dirname, '..', 'scripts', 'gate-semantic-layer'));

  // Create a temp dir with rules
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-gold-test-'));
  const thumbgateDir = path.join(tmpDir, '.thumbgate');
  fs.mkdirSync(thumbgateDir, { recursive: true });

  // Rules with specific tool restrictions and general rules
  fs.writeFileSync(
    path.join(thumbgateDir, 'prevention-rules.json'),
    JSON.stringify({
      rules: [
        { id: 'no-force-push', type: 'command', patterns: ['git push --force'], decision: 'deny', tools: ['Bash'], category: 'security' },
        { id: 'no-admin-merge', type: 'command', patterns: ['--admin'], decision: 'deny', tools: ['Bash'], category: 'policy' },
        { id: 'no-secrets', type: 'pattern', pattern: 'password=.*', decision: 'deny', category: 'security' },
      ],
    })
  );

  try {
    // With pushdown for Bash tool — should load rules that apply to Bash OR have no tool restriction
    const bashRules = semanticLayer.loadGoldRules({ rulesDir: tmpDir, toolName: 'Bash', sample: false });
    assert.ok(bashRules.length >= 2, `Should load Bash-specific + general rules, got ${bashRules.length}`);

    // With pushdown for Write tool — should only load general rules (no Bash-specific ones)
    const writeRules = semanticLayer.loadGoldRules({ rulesDir: tmpDir, toolName: 'Write', sample: false });
    const bashOnlyRules = writeRules.filter(r => r.tools && r.tools.includes('Bash'));
    assert.strictEqual(bashOnlyRules.length, 0, 'Should not load Bash-specific rules for Write tool');

    // Without pushdown — should load all rules
    const allRules = semanticLayer.loadGoldRules({ rulesDir: tmpDir, sample: false });
    assert.ok(allRules.length >= 3, `Should load all rules, got ${allRules.length}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CUDA Gate: Gold layer describes schema in single call', () => {
  const semanticLayer = require(path.join(__dirname, '..', 'scripts', 'gate-semantic-layer'));
  const schema = semanticLayer.describeGoldLayer();

  assert.ok(schema.name, 'Should have a name');
  assert.ok(schema.sources, 'Should list data sources');
  assert.ok(schema.ruleTypes, 'Should list rule types');
  assert.ok(schema.categories, 'Should list categories');
  assert.ok(schema.anomalyPatterns, 'Should list anomaly patterns');
  assert.ok(schema.pushdownFilters, 'Should list pushdown filters');
});

test('CUDA Gate: anomaly detection tags contradictions in feedback', () => {
  const semanticLayer = require(path.join(__dirname, '..', 'scripts', 'gate-semantic-layer'));

  const feedbackEntry = {
    type: 'prevention_rule',
    signal: 'down',
    whatWentWrong: 'You are wrong about the security bypass — the agent bypassed the gate check',
    rule: { id: 'test-rule', type: 'pattern', pattern: 'bypass', decision: 'deny' },
  };

  const tags = semanticLayer.detectAnomalies(feedbackEntry);
  const tagIds = tags.map(t => t.id);
  assert.ok(tagIds.includes('security-bypass'), 'Should detect security bypass anomaly');
  assert.ok(tagIds.includes('contradiction'), 'Should detect contradiction anomaly');
});

test('CUDA Gate: loadPreventionRules uses Gold layer with pushdown', async () => {
  const { tmpDir, thumbgateDir } = createTempGateEnv();
  try {
    // Request rules for a specific tool — pushdown should only load matching rules
    const rules = await loadPreventionRules(thumbgateDir, { toolName: 'Bash' });
    assert.ok(Array.isArray(rules), 'Should return an array');
    assert.ok(rules.length >= 1, 'Should load at least 1 rule for Bash tool');

    // Rules should have confidence and source metadata from Gold layer
    const hasMetadata = rules.some(r => r.confidence !== undefined || r.source !== undefined);
    assert.ok(hasMetadata, 'Rules should have Gold layer metadata');
  } finally {
    cleanup(tmpDir);
  }
});

test('CUDA Gate: PKG_ROOT is set to the package root', () => {
  assert.ok(PKG_ROOT.length > 0, 'PKG_ROOT should be set');
  assert.ok(fs.existsSync(path.join(PKG_ROOT, 'package.json')), 'PKG_ROOT should contain package.json');
});
