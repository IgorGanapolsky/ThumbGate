'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compileThumbGateToArmorPlugin,
  evaluateArmorWithThumbGateFallback,
} = require('../scripts/openrouter-armor-partnership-diode');

test('compileThumbGateToArmorPlugin: emits OpenRouter Armor v1 classifier_context with 0.6 deny and 0.7 allow thresholds', () => {
  const plugin = compileThumbGateToArmorPlugin({
    trustedRepo: 'github.com/IgorGanapolsky/ThumbGate',
    currentBranch: 'main',
    isProtectedBranch: true,
  });

  assert.equal(plugin.id, 'armor');
  assert.equal(plugin.output_mode, 'custom_item');
  assert.equal(plugin.classifier_context.v, 1);
  assert.equal(plugin.classifier_context.auto_mode.hard_deny[0].threshold, 0.6);
  assert.equal(plugin.classifier_context.auto_mode.allow[0].threshold, 0.7);
});

test('evaluateArmorWithThumbGateFallback: blocks force-push variants, HTTP 403 ZDR/HIPAA rejections, and unscoped rm -rf', () => {
  // 1. Enforces OpenRouter Armor flagged verdict under claude_code_compatibility
  const flagged = evaluateArmorWithThumbGateFallback({
    callId: 'call_bPQO3',
    toolName: 'bash',
    toolArguments: { command: 'git push origin main' },
    safeguardResults: [
      {
        type: 'dangerous_tool_use',
        status: {
          type: 'available',
          tool_uses: {
            call_bPQO3: { type: 'evaluated', outcome: 'flagged', explanation: '[Git Push]' },
          },
        },
      },
    ],
  });
  assert.equal(flagged.allowed, false);
  assert.equal(flagged.customItem.type, 'openrouter:armor_blocked');

  // 2. Blocks git push -f and +main under HTTP 403 / ZDR fallback
  for (const cmd of ['git push -f origin main', 'git push --force-with-lease origin main', 'git push origin +main']) {
    const res = evaluateArmorWithThumbGateFallback({
      callId: 'call_zdr',
      toolName: 'bash',
      toolArguments: { command: cmd },
      armorHttpStatus: 403,
      complianceContext: { zeroDataRetention: true, hipaa: true },
    });
    assert.equal(res.allowed, false, `Expected ${cmd} to be blocked`);
    assert.equal(res.tier, 'hard_deny');
  }

  // 3. Scoped temp cleanup is allowed, but compound destructive commands with npm test are blocked
  const allowedTestCleanup = evaluateArmorWithThumbGateFallback({
    callId: 'call_test_1',
    toolName: 'bash',
    toolArguments: { command: 'node --test && rm -rf /tmp/mkdtemp-test-123' },
  });
  assert.equal(allowedTestCleanup.allowed, true);

  const blockedCompound = evaluateArmorWithThumbGateFallback({
    callId: 'call_test_2',
    toolName: 'bash',
    toolArguments: { command: 'npm test && rm -rf ~/project' },
  });
  assert.equal(blockedCompound.allowed, false);
  assert.equal(blockedCompound.tier, 'soft_deny');
});
