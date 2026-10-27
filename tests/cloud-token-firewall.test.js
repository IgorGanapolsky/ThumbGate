const assert = require('node:assert');
const test = require('node:test');
const { auditZeroClickFailureCaptureAndAutoRulePromotion } = require('../src/cloud-token-firewall.js');

test('auditZeroClickFailureCaptureAndAutoRulePromotion denies repeated tool failures', () => {
  const inputs = [
    { toolName: 'test', command: 'test', exitCode: 1, repeatCount: 2 },
    { toolName: 'test', command: 'test', exitCode: -1, repeatCount: 5 }
  ];

  const results = inputs.map((x) => auditZeroClickFailureCaptureAndAutoRulePromotion(x));

  results.forEach(res => {
    assert.deepStrictEqual(res, {
      decision: 'deny',
      ruleId: 'cloud_token_zero_click_failure',
      reason: 'Repeated tool failure detected'
    });
  });
});

test('auditZeroClickFailureCaptureAndAutoRulePromotion returns null on success or <2 failures', () => {
  const inputs = [
    { toolName: 'test', command: 'test', exitCode: 0, repeatCount: 0 },
    { toolName: 'test', command: 'test', exitCode: 0, repeatCount: 10 },
    { toolName: 'test', command: 'test', exitCode: 1, repeatCount: 1 }
  ];

  const results = inputs.map((x) => auditZeroClickFailureCaptureAndAutoRulePromotion(x));

  results.forEach(res => {
    assert.strictEqual(res, null);
  });
});
