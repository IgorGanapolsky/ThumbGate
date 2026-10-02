'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  evaluateOutputShunt,
  evaluateCompactionThreshold,
  simulateOverflowRecovery,
  auditProviderDecoupling,
  evaluatePreActionDiode,
  runDoctor,
} = require('../scripts/strands-harness-doctor');
const { createStrandsGateMiddleware } = require('../adapters/strands/strands-middleware');

test('AWS Strands Harness: evaluateOutputShunt bounds oversized tool output', () => {
  // 1. Small output remains intact
  const smallOutput = 'Line 1: all good\nLine 2: finished';
  const smallResult = evaluateOutputShunt(smallOutput, { maxLines: 350, maxBytes: 16384 });
  assert.equal(smallResult.shunted, false);
  assert.equal(smallResult.shuntedContent, smallOutput);
  assert.equal(smallResult.reductionPct, 0);

  // 2. Large output (> 350 lines) is shunted with offset marker
  const largeLines = Array.from({ length: 500 }, (_, i) => `Log entry #${i + 1}: detailed operational trace data`).join('\n');
  const largeResult = evaluateOutputShunt(largeLines, { maxLines: 100, maxBytes: 16384 });
  assert.equal(largeResult.shunted, true);
  assert.equal(largeResult.originalLineCount, 500);
  assert.ok(largeResult.reductionPct > 50);
  assert.match(largeResult.shuntedContent, /\[ThumbGate Token-Shunt: \d+ lines \(\d+ bytes\) omitted/);
});

test('AWS Strands Harness: evaluateCompactionThreshold signals 75% trigger while pinning rules', () => {
  // Below threshold
  const healthy = evaluateCompactionThreshold({
    currentTokens: 50000,
    maxWindowTokens: 128000,
    thresholdPct: 0.75,
    pinnedRules: ['Never force-push main'],
  });
  assert.equal(healthy.shouldCompact, false);
  assert.equal(healthy.status, 'window_healthy');

  // At or above threshold
  const needsCompaction = evaluateCompactionThreshold({
    currentTokens: 100000,
    maxWindowTokens: 128000,
    thresholdPct: 0.75,
    pinnedRules: ['Never force-push main', 'Evidence before done'],
  });
  assert.equal(needsCompaction.shouldCompact, true);
  assert.equal(needsCompaction.pinnedRulesPreserved, true);
  assert.equal(needsCompaction.pinnedRuleCount, 2);
  assert.equal(needsCompaction.status, 'compaction_recommended');
});

test('AWS Strands Harness: simulateOverflowRecovery recovers in-loop without unhandled throw', () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({
    turn: i,
    tokens: 500,
    isPinned: i === 0,
    isLastTurn: i === 19,
  }));

  const recovery = simulateOverflowRecovery({
    turns,
    maxTokens: 5000,
    pinnedSystemPrompt: 'System prompt',
  });

  assert.equal(recovery.recovered, true);
  assert.equal(recovery.action, 'pruned_history_in_loop');
  assert.equal(recovery.systemPromptPreserved, true);
  assert.equal(recovery.survivingTurns, 2); // 1 pinned + 1 last turn
  assert.equal(recovery.status, 'recovered_without_throw');
});

test('AWS Strands Harness: auditProviderDecoupling supports multi-cloud & local Ollama', () => {
  const bedrockDecoupled = auditProviderDecoupling({ provider: 'bedrock' });
  assert.equal(bedrockDecoupled.isDecoupled, true);
  assert.equal(bedrockDecoupled.supportsLocalFallback, true);
  assert.equal(bedrockDecoupled.requiresProprietaryLockIn, false);

  const ollamaDecoupled = auditProviderDecoupling({ provider: 'ollama' });
  assert.equal(ollamaDecoupled.configuredProvider, 'ollama');
  assert.equal(ollamaDecoupled.isDecoupled, true);
});

test('AWS Strands Harness: evaluatePreActionDiode blocks dangerous mutations and allows safe tools', () => {
  const safeCheck = evaluatePreActionDiode({ name: 'shell_execute', input: { command: 'git status' } });
  assert.equal(safeCheck.decision, 'ALLOW');
  assert.equal(safeCheck.diodeStatus, 'CLEAN');

  const dangerousPush = evaluatePreActionDiode({ name: 'shell_execute', input: { command: 'git push --force origin main' } });
  assert.equal(dangerousPush.decision, 'BLOCK');
  assert.equal(dangerousPush.diodeStatus, 'INTERDICTED');

  const dangerousRm = evaluatePreActionDiode({ name: 'shell_execute', input: { command: 'rm -rf /var/data' } });
  assert.equal(dangerousRm.decision, 'BLOCK');
  assert.match(dangerousRm.violation, /rm.*-rf/);
});

test('AWS Strands Harness: createStrandsGateMiddleware hooks execute cleanly in agent loop', async () => {
  const middleware = createStrandsGateMiddleware({
    tokenShunt: { maxOutputLines: 10, maxOutputBytes: 1024 },
    preActionDiode: { enabled: true },
  });

  // beforeToolCall allows safe
  const allowResult = await middleware.beforeToolCall({
    toolName: 'shell_execute',
    input: { command: 'npm test' },
  });
  assert.equal(allowResult.allow, true);
  assert.equal(allowResult.decision, 'ALLOW');

  // beforeToolCall blocks dangerous
  const blockResult = await middleware.beforeToolCall({
    toolName: 'shell_execute',
    input: { command: 'rm -rf node_modules' },
  });
  assert.equal(blockResult.allow, false);
  assert.equal(blockResult.decision, 'BLOCK');

  // afterToolCall shunts oversized output
  const longOutput = Array.from({ length: 30 }, (_, i) => `row ${i}`).join('\n');
  const shuntResult = await middleware.afterToolCall({
    toolName: 'shell_execute',
    result: longOutput,
  });
  assert.equal(shuntResult.shunted, true);
  assert.ok(shuntResult.reductionPct > 0);

  // onContextCompaction pins rules
  const compactResult = await middleware.onContextCompaction({
    history: [],
    pinnedRules: ['No force pushes'],
  });
  assert.equal(compactResult.compacted, true);
  assert.match(compactResult.injectedPrefix, /\[PINNED RULE\]: No force pushes/);

  // Native Strands event contract (event.toolUse, event.cancel, event.result)
  const nativeBlockEvent = {
    toolUse: { name: 'shell_execute', input: { command: 'git push --force origin main' } },
  };
  await middleware.beforeToolCall(nativeBlockEvent);
  assert.equal(nativeBlockEvent.cancel, true);
  assert.match(nativeBlockEvent.reason, /--force/);

  const nativeShuntEvent = {
    toolUse: { name: 'shell_execute', input: { command: 'cat huge.log' } },
    result: longOutput,
  };
  await middleware.afterToolCall(nativeShuntEvent);
  assert.match(nativeShuntEvent.result, /\[ThumbGate Token-Shunt/);
});

test('AWS Strands Harness Doctor: runDoctor executes all 5 pillars with healthy status', () => {
  const report = runDoctor({ rootDir: path.resolve(__dirname, '..') });
  assert.equal(report.status, 'healthy');
  assert.equal(report.checks.length, 5);
  assert.ok(report.checks.every((c) => c.pass === true));
  assert.match(report.benchmarks.terminalBench2_1CostSavingsClaim, /77% cheaper/);
  assert.match(report.benchmarks.sixBenchmarkAverageSavingsClaim, /45% cheaper/);
});
