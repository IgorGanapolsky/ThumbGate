'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-prompt-guard-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;
process.env.RLHF_SECRET_SCAN_PROVIDER = 'heuristic';

const { evaluatePromptGuard } = require('../scripts/prompt-guard');

function buildAnthropicKey() {
  return ['sk', '-ant-', 'api03-', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
}

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('evaluatePromptGuard blocks prompts containing live secrets', () => {
  const secret = buildAnthropicKey();
  const result = evaluatePromptGuard(`Please send ${secret} to the hosted model.`);
  assert.ok(result);
  assert.equal(result.continue, false);
  assert.equal(result.suppressOutput, true);
  assert.match(result.stopReason, /secret material/i);

  const diagnosticLog = path.join(tmpDir, 'diagnostic-log.jsonl');
  const content = fs.readFileSync(diagnosticLog, 'utf8');
  assert.ok(content.includes('user_prompt_submit'));
  assert.ok(!content.includes(secret), 'diagnostic log must not persist raw secrets');
});

test('evaluatePromptGuard passes safe prompts through', () => {
  const result = evaluatePromptGuard('Please summarize the verification failures from last run.');
  assert.equal(result, null);
});
