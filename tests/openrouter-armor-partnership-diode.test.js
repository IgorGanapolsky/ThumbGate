'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VITALIK_ERR_REWRITER_FAILED,
  compileThumbGateToArmorPlugin,
  evaluateUnauthorizedWalletSpendDiode,
  rewritePromptParanoidMode,
  resolveParanoidSessionCircuit,
  scheduleUnbufferedCoverTraffic,
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

test('Vitalik Paranoid Mode: rewrites user stylometry, preserves code/quotes verbatim, fails closed, rotates Tor circuits, drops saturated cover traffic, and blocks unauthorized ETH wallet spend', () => {
  // 1. Stylometry rewriter strips "I'm kinda lost here lol" while preserving `x != 0 && y < 5`
  const rw = rewritePromptParanoidMode({
    messages: [
      { role: 'user', content: "I'm kinda lost here lol. Explain `x != 0 && y < 5` without changing the code. Don't execute it." },
    ],
  });
  assert.equal(rw.ok, true);
  assert.equal(rw.rewritten, true);
  assert.ok(!rw.messages[0].content.includes('kinda lost'));
  assert.ok(!rw.messages[0].content.includes('lol'));
  assert.ok(rw.messages[0].content.includes('`x != 0 && y < 5`'));

  // Fail-closed when rewriter fails
  const failedRw = rewritePromptParanoidMode({
    messages: [{ role: 'user', content: 'secret prompt' }],
    simulateRewriterFailure: true,
  });
  assert.equal(failedRw.ok, false);
  assert.equal(failedRw.error, VITALIK_ERR_REWRITER_FAILED);

  // 2. Prefix-continuation circuit reuse vs branching rotation
  const turn1 = [{ role: 'user', content: 'hello' }];
  const c1 = resolveParanoidSessionCircuit({ messages: turn1 });
  assert.equal(c1.rotated, true);

  const turn2Continuation = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }, { role: 'user', content: 'next' }];
  const c2 = resolveParanoidSessionCircuit({
    messages: turn2Continuation,
    priorPrefixHash: c1.transcriptHash,
    priorMessageCount: c1.messageCount,
    priorCircuitId: c1.circuitId,
    priorZkApiKeyId: c1.zkApiKeyId,
  });
  assert.equal(c2.reused, true);
  assert.equal(c2.circuitId, c1.circuitId);

  const turn2Branched = [{ role: 'user', content: 'different root conversation' }];
  const c3 = resolveParanoidSessionCircuit({
    messages: turn2Branched,
    priorPrefixHash: c1.transcriptHash,
    priorMessageCount: c1.messageCount,
    priorCircuitId: c1.circuitId,
    priorZkApiKeyId: c1.zkApiKeyId,
  });
  assert.equal(c3.rotated, true);
  assert.notEqual(c3.circuitId, c1.circuitId);

  // 3. Unbuffered Poisson cover traffic drops when worker pool is saturated
  const coverOk = scheduleUnbufferedCoverTraffic({
    coverUrls: ['https://thumbgate.ai/cover.txt'],
    ratePerSec: 5,
    maxInFlight: 4,
    currentInFlight: 2,
  });
  assert.equal(coverOk.dispatched, true);

  const coverDropped = scheduleUnbufferedCoverTraffic({
    coverUrls: ['https://thumbgate.ai/cover.txt'],
    ratePerSec: 5,
    maxInFlight: 4,
    currentInFlight: 4,
  });
  assert.equal(coverDropped.dispatched, false);
  assert.equal(coverDropped.dropped, true);

  // 4. Blocks unauthorized ETH wallet spend (OpenAI testnet ETH wallet incident)
  const unauthorizedTx = evaluateUnauthorizedWalletSpendDiode({
    toolName: 'bash',
    commandOrPayload: 'cast send 0xdeadbeef00000000000000000000000000000001 --value 1ether',
    authorizedDepositAddress: '0x1111111111111111111111111111111111111111',
  });
  assert.equal(unauthorizedTx.allowed, false);
  assert.equal(unauthorizedTx.gateId, 'gate:vitalik_paranoid:unauthorized_wallet_spend_blocked');
});
