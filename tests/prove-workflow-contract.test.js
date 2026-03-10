const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runWorkflowContractProof } = require('../scripts/prove-workflow-contract');

let proofDir;
let report;

test('workflow contract proof harness setup', () => {
  proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-workflow-contract-proof-'));
  report = runWorkflowContractProof({ proofDir });
});

test('workflow contract proof: zero failures', () => {
  assert.equal(report.summary.failed, 0);
});

test('workflow contract proof: writes report.json', () => {
  assert.ok(fs.existsSync(path.join(proofDir, 'report.json')));
});

test('workflow contract proof: writes report.md', () => {
  assert.ok(fs.existsSync(path.join(proofDir, 'report.md')));
});

test('workflow contract proof: required checks pass', () => {
  const requiredChecks = [
    'workflow.contract.complete',
    'issue.template.complete',
    'pull_request.template.complete',
    'readme.links.contracts',
  ];

  requiredChecks.forEach((name) => {
    const found = report.checks.find((check) => check.name === name);
    assert.ok(found, `missing proof check "${name}"`);
    assert.equal(found.passed, true, `${name} should pass`);
  });
});

test('workflow contract proof: cleanup', () => {
  fs.rmSync(proofDir, { recursive: true, force: true });
});
