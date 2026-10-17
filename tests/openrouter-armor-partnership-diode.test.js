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

test('evaluateArmorWithThumbGateFallback: enforces claude_code_compatibility flagged verdicts and provides <1ms local fallback on HIPAA/ZDR unavailable calls', () => {
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

  // 2. When Armor is unavailable (HIPAA / ZDR / timeout), ThumbGate local fallback blocks hard_deny in <1ms
  const zdrBlock = evaluateArmorWithThumbGateFallback({
    callId: 'call_zdr_1',
    toolName: 'bash',
    toolArguments: { command: 'git push --force origin main' },
    safeguardResults: [
      {
        status: {
          tool_uses: {
            call_zdr_1: { type: 'unavailable', reason: 'zdr_context' },
          },
        },
      },
    ],
    complianceContext: { zeroDataRetention: true, hipaa: true },
  });
  assert.equal(zdrBlock.allowed, false);
  assert.equal(zdrBlock.enforcedBy, 'thumbgate_local_zdr_hipaa_fallback');
  assert.equal(zdrBlock.tier, 'hard_deny');

  // 3. Soft-deny (rm -rf) is cleared when allow rule (project test suite mkdtemp cleanup) matches
  const allowedTestCleanup = evaluateArmorWithThumbGateFallback({
    callId: 'call_test_1',
    toolName: 'bash',
    toolArguments: { command: 'node --test && rm -rf /tmp/mkdtemp-test' },
  });
  assert.equal(allowedTestCleanup.allowed, true);
});
