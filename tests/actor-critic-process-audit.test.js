const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { selectHarness, selectHarnessName, listHarnesses } = require('../scripts/harness-selector.js');

test('config/gates/actor-critic-audit.json conforms to gate schema', () => {
  const gatePath = path.resolve(__dirname, '..', 'config', 'gates', 'actor-critic-audit.json');
  assert.ok(fs.existsSync(gatePath), 'actor-critic-audit.json must exist');

  const content = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.equal(content.version, 1);
  assert.equal(content.harness, 'actor-critic-audit');
  assert.ok(Array.isArray(content.gates));
  assert.ok(content.gates.length >= 3);

  const missingAuditGate = content.gates.find((g) => g.id === 'actor-critic-missing-process-audit');
  assert.ok(missingAuditGate);
  assert.equal(missingAuditGate.action, 'block');
  assert.equal(missingAuditGate.severity, 'critical');

  const placeboGate = content.gates.find((g) => g.id === 'actor-critic-placebo-test-failure');
  assert.ok(placeboGate);
  assert.equal(placeboGate.action, 'block');

  const biasGate = content.gates.find((g) => g.id === 'actor-critic-early-adopter-bias-warning');
  assert.ok(biasGate);
  assert.equal(biasGate.action, 'warn');
});

test('actor-critic gate regex patterns accurately detect risky payloads and allow valid receipts', () => {
  const gatePath = path.resolve(__dirname, '..', 'config', 'gates', 'actor-critic-audit.json');
  const content = JSON.parse(fs.readFileSync(gatePath, 'utf8'));

  const missingAuditGate = content.gates.find((g) => g.id === 'actor-critic-missing-process-audit');
  const missingAuditRegex = new RegExp(missingAuditGate.pattern);
  // Blocks actions without approved receipt
  assert.ok(missingAuditRegex.test('publish_causal_report --target=q3_retention'));
  assert.ok(missingAuditRegex.test('deploy_treatment_policy --env=prod'));
  assert.ok(!missingAuditRegex.test('read_local_data --file=sample.csv'));

  // Allows actions with valid critic review receipts
  assert.ok(!missingAuditRegex.test('publish_causal_report critic_rating=fully_satisfactory'));
  assert.ok(!missingAuditRegex.test('deploy_treatment_policy criticReceipt=satisfactory_with_caveats'));

  const placeboGate = content.gates.find((g) => g.id === 'actor-critic-placebo-test-failure');
  const placeboRegex = new RegExp(placeboGate.pattern);
  assert.ok(placeboRegex.test('evaluation_result: placebo_test_failed in cohort B'));
  assert.ok(!placeboRegex.test('evaluation_result: placebo_test_passed'));
});

test('harness-selector recognizes actor-critic-audit harness', () => {
  assert.ok(listHarnesses().includes('actor-critic-audit'));
  const selected = selectHarness('Bash', { command: 'node scripts/run-analysis.js publish_causal_report' });
  assert.ok(selected && selected.endsWith('actor-critic-audit.json'));
  assert.equal(selectHarnessName('Bash', { command: 'target_trial estimation' }), 'actor-critic-audit');
});
