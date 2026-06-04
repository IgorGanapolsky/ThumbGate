const test = require('node:test');
const assert = require('node:assert/strict');
const child_process = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

test('tokenomics cost guard allows tool use under budget', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-tokenomics-test-'));
  
  const env = {
    ...process.env,
    THUMBGATE_FEEDBACK_DIR: tmpDir,
    THUMBGATE_MONTHLY_BUDGET_USD: '10.00',
  };

  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'echo "hello world"' }
  };

  const result = child_process.execFileSync(
    process.execPath,
    [path.join(__dirname, '../scripts/gates/tokenomics-cost-guard.js')],
    { input: JSON.stringify(payload), env, encoding: 'utf8' }
  );

  const parsed = JSON.parse(result.trim());
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  
  // Verify it wrote to the ledger
  const ledgerPath = path.join(tmpDir, 'budget-ledger.json');
  assert.ok(fs.existsSync(ledgerPath), 'budget-ledger.json should be created');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const month = Object.keys(ledger.months)[0];
  assert.ok(ledger.months[month].totalUsd > 0, 'totalUsd spent should be > 0');
  
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('tokenomics cost guard blocks tool use when budget is exceeded', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-tokenomics-test-'));
  
  const env = {
    ...process.env,
    THUMBGATE_FEEDBACK_DIR: tmpDir,
    THUMBGATE_MONTHLY_BUDGET_USD: '0.000001', // Extremely low budget
  };

  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'echo "hello world"' }
  };

  const result = child_process.execFileSync(
    process.execPath,
    [path.join(__dirname, '../scripts/gates/tokenomics-cost-guard.js')],
    { input: JSON.stringify(payload), env, encoding: 'utf8' }
  );

  const parsed = JSON.parse(result.trim());
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /would exceed monthly tokenomics budget/);
  
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
