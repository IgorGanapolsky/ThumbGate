const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  evaluateAction,
  evaluateConstraints,
  evaluateInvariants,
  loadSpec,
  loadSpecDir,
  recordSpecAudit,
  loadSpecAudit,
  specToGateConfigs,
  allSpecsToGateConfigs,
  summarizeSpecAudit,
  validateSpec,
} = require('../scripts/spec-gate');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-spec-gate-'));
}

function writeSpec(dir, filename, spec) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(spec, null, 2), 'utf8');
}

const MINIMAL_SPEC = {
  name: 'test-spec',
  constraints: [
    { id: 'no-force-push', scope: 'bash', deny: 'git\\s+push.*--force', reason: 'No force push.' },
  ],
  invariants: [],
};

const FULL_SPEC = {
  name: 'full-spec',
  description: 'Full test spec.',
  version: '2',
  constraints: [
    { id: 'no-force-push', scope: 'bash', deny: 'git\\s+push.*--force', reason: 'No force push.' },
    { id: 'no-secrets', scope: 'content', deny: 'AKIA[A-Z0-9]{16}', reason: 'No AWS keys in code.' },
    { id: 'no-drop', scope: 'any', deny: 'DROP\\s+TABLE', reason: 'No dropping tables.' },
  ],
  invariants: [
    { id: 'tests-before-commit', require: 'npm test', before: 'git commit', reason: 'Run tests first.' },
  ],
};

test('validateSpec rejects empty or nameless specs', () => {
  assert.throws(() => validateSpec(null), /must be a JSON object/);
  assert.throws(() => validateSpec({}), /requires a "name"/);
  assert.throws(() => validateSpec({ name: 'empty' }), /at least one constraint/);
});

test('validateSpec accepts minimal and full specs', () => {
  const minimal = validateSpec(MINIMAL_SPEC);
  assert.equal(minimal.name, 'test-spec');
  assert.equal(minimal.constraints.length, 1);

  const full = validateSpec(FULL_SPEC);
  assert.equal(full.name, 'full-spec');
  assert.equal(full.version, '2');
  assert.equal(full.constraints.length, 3);
  assert.equal(full.invariants.length, 1);
});

test('loadSpec reads and validates a spec file', () => {
  const tempDir = makeTempDir();
  const specPath = path.join(tempDir, 'test.json');
  fs.writeFileSync(specPath, JSON.stringify(MINIMAL_SPEC), 'utf8');

  const spec = loadSpec(specPath);
  assert.equal(spec.name, 'test-spec');
  assert.equal(spec.sourcePath, specPath);
});

test('loadSpecDir loads all JSON specs from a directory', () => {
  const tempDir = makeTempDir();
  writeSpec(tempDir, 'a.json', MINIMAL_SPEC);
  writeSpec(tempDir, 'b.json', FULL_SPEC);
  writeSpec(tempDir, 'not-json.txt', { name: 'ignored' });

  const specs = loadSpecDir(tempDir);
  assert.equal(specs.length, 2);
});

test('loadSpecDir returns empty array for missing directory', () => {
  const specs = loadSpecDir('/nonexistent/path');
  assert.equal(specs.length, 0);
});

test('evaluateConstraints blocks force push in bash scope', () => {
  const spec = validateSpec(FULL_SPEC);
  const results = evaluateConstraints(spec, { command: 'git push origin main --force' });

  const forcePush = results.find((r) => r.constraintId === 'no-force-push');
  assert.equal(forcePush.passed, false);
  assert.match(forcePush.reason, /No force push/);
});

test('evaluateConstraints allows safe commands', () => {
  const spec = validateSpec(FULL_SPEC);
  const results = evaluateConstraints(spec, { command: 'git push origin main' });

  assert.ok(results.every((r) => r.passed || r.constraintId !== 'no-force-push'));
});

test('evaluateConstraints blocks secrets in content scope', () => {
  const spec = validateSpec(FULL_SPEC);
  const results = evaluateConstraints(spec, { content: 'const key = "AKIAIOSFODNN7EXAMPLE"' });

  const secrets = results.find((r) => r.constraintId === 'no-secrets');
  assert.equal(secrets.passed, false);
});

test('evaluateConstraints blocks DROP TABLE in any scope', () => {
  const spec = validateSpec(FULL_SPEC);
  const results = evaluateConstraints(spec, { command: 'DROP TABLE users' });

  const drop = results.find((r) => r.constraintId === 'no-drop');
  assert.equal(drop.passed, false);
});

test('evaluateInvariants blocks commit without prior test run', () => {
  const spec = validateSpec(FULL_SPEC);
  const results = evaluateInvariants(spec, {
    action: 'git commit -m "untested"',
    sessionActions: ['git add .'],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].passed, false);
  assert.match(results[0].reason, /Run tests first/);
});

test('evaluateInvariants passes when tests ran before commit', () => {
  const spec = validateSpec(FULL_SPEC);
  const results = evaluateInvariants(spec, {
    action: 'git commit -m "tested"',
    sessionActions: ['npm test', 'git add .'],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].passed, true);
});

test('evaluateInvariants skips irrelevant actions', () => {
  const spec = validateSpec(FULL_SPEC);
  const results = evaluateInvariants(spec, {
    action: 'git add .',
    sessionActions: [],
  });

  assert.equal(results.length, 0);
});

test('evaluateAction combines constraints and invariants across multiple specs', () => {
  const specs = [validateSpec(MINIMAL_SPEC), validateSpec(FULL_SPEC)];
  const result = evaluateAction(specs, {
    command: 'git push origin main --force',
    action: 'git push origin main --force',
    sessionActions: ['npm test'],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockedCount >= 2);
  assert.ok(result.totalChecked > 0);
  assert.ok(result.evaluatedAt);
});

test('evaluateAction allows clean actions', () => {
  const specs = [validateSpec(FULL_SPEC)];
  const result = evaluateAction(specs, {
    command: 'npm run lint',
    content: 'const x = 1;',
    action: 'npm run lint',
    sessionActions: [],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blockedCount, 0);
});

test('specToGateConfigs converts constraints to gates-engine format', () => {
  const spec = validateSpec(FULL_SPEC);
  const gates = specToGateConfigs(spec);

  assert.equal(gates.length, 3);
  assert.ok(gates[0].id.startsWith('spec:full-spec:'));
  assert.equal(gates[0].layer, 'Spec');
  assert.equal(gates[0].action, 'block');
  assert.equal(gates[0].source, 'spec');
  assert.equal(gates[0].specName, 'full-spec');
});

test('allSpecsToGateConfigs merges multiple specs', () => {
  const specs = [validateSpec(MINIMAL_SPEC), validateSpec(FULL_SPEC)];
  const gates = allSpecsToGateConfigs(specs);

  assert.equal(gates.length, 4);
});

test('recordSpecAudit persists and loadSpecAudit retrieves entries', () => {
  const tempDir = makeTempDir();
  const evaluation = { allowed: false, blockedCount: 1, totalChecked: 3, blocked: [{ specName: 'test', constraintId: 'c1' }] };

  recordSpecAudit(evaluation, { tool: 'Bash', command: 'git push --force' }, { feedbackDir: tempDir });
  const entries = loadSpecAudit({ feedbackDir: tempDir });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].allowed, false);
  assert.equal(entries[0].blockedCount, 1);
});

test('summarizeSpecAudit computes block rates and top offenders', () => {
  const entries = [
    { totalChecked: 5, blockedCount: 2, blocked: [{ specName: 'safety', constraintId: 'no-force' }, { specName: 'safety', constraintId: 'no-secrets' }] },
    { totalChecked: 3, blockedCount: 1, blocked: [{ specName: 'safety', constraintId: 'no-force' }] },
    { totalChecked: 4, blockedCount: 0, blocked: [] },
  ];

  const summary = summarizeSpecAudit(entries);
  assert.equal(summary.totalEvaluations, 3);
  assert.equal(summary.totalBlocked, 3);
  assert.equal(summary.topBlockedSpecs[0].name, 'safety');
  assert.equal(summary.topBlockedConstraints[0].id, 'no-force');
  assert.equal(summary.topBlockedConstraints[0].count, 2);
});

test('built-in agent-safety spec loads and validates from config/specs', () => {
  const specs = loadSpecDir(path.join(__dirname, '..', 'config', 'specs'));
  assert.ok(specs.length >= 1, 'expected at least one spec in config/specs');

  const safety = specs.find((s) => s.name === 'agent-safety');
  assert.ok(safety, 'agent-safety spec must exist');
  assert.ok(safety.constraints.length >= 5);
  assert.ok(safety.invariants.length >= 1);

  const result = evaluateAction([safety], { command: 'git push --force origin main' });
  assert.equal(result.allowed, false);
  assert.ok(result.blocked.some((b) => b.constraintId === 'no-force-push'));
});
