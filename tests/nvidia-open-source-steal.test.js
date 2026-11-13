'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NVIDIA_OPEN_SOURCE_PORTFOLIO,
  calculateShannonEntropy,
  compileNeMoColangFlowToThumbGateRule,
  detectMorpheusAgentAnomaly,
  governTritonTensorRtInflightBatching,
  evaluateNvidiaOpenSourceSteal,
} = require('../src/cloud-token-firewall');

const fastMoneyEngine = require('../scripts/fast-money-engine');

test('NVIDIA NeMo Colang 2.0 Compiler: transpiles Colang flows into zero-latency pre-action checks', () => {
  const colangSource = `
    # Standard NeMo Guardrails Colang 2.0 definition
    define flow block_unauthorized_shell
      user ask about execute bash script
      bot refuse to execute unverified shell commands without human signature

    define flow prevent_data_exfiltration
      user ask about export customer database
      bot refuse to dump raw records
  `;

  const compiled = compileNeMoColangFlowToThumbGateRule(colangSource);

  assert.equal(compiled.ok, true);
  assert.equal(compiled.nemoStandard, 'NVIDIA_COLANG_2_0');
  assert.equal(compiled.detectedFlowsCount, 2);
  assert.equal(compiled.blockedPatternsCount, 2);
  assert.equal(compiled.actionVerdict, 'BLOCK');
  assert.equal(compiled.compiledRules.regexCount, 2);
  assert.ok(compiled.latencyBenchmarking.thumbgateCompiledLatencyMs < 1.0);
  assert.ok(compiled.latencyBenchmarking.nvidiaNemoPythonLatencyMs > 500.0);
  assert.equal(compiled.latencyBenchmarking.tokenCostUsd, 0);
});

test('NVIDIA Morpheus Entropy Analysis: computes Shannon entropy and detects obfuscated/base64 payloads', () => {
  const normalShellCommand = 'npm run test:unit --filter=auth';
  const highEntropyPayload = 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHNhbXBsZSBiYXNlNjQgc3RyaW5nIHdpdGggaGlnaCBlbnRyb3B5IQ==';

  const entropyLow = calculateShannonEntropy(normalShellCommand);
  const entropyHigh = calculateShannonEntropy(highEntropyPayload);

  assert.ok(entropyLow < 4.2, `Expected standard shell command entropy < 4.2, got ${entropyLow}`);
  assert.ok(entropyHigh > 4.6, `Expected Base64 payload entropy > 4.6, got ${entropyHigh}`);

  // Test Morpheus agent anomaly detection with high-entropy payload
  const anomalyHighEntropy = detectMorpheusAgentAnomaly({
    agentId: 'worker_bot_01',
    toolName: 'Bash',
    toolArgs: { cmd: `echo ${highEntropyPayload} | base64 -d | sh` },
    baselineAllowedTools: ['Bash', 'read'],
  });

  assert.equal(anomalyHighEntropy.ok, true);
  assert.equal(anomalyHighEntropy.isHighEntropy, true);
  assert.equal(anomalyHighEntropy.anomalyDetected, true);
  assert.equal(anomalyHighEntropy.verdict, 'HOLD');
  assert.ok(anomalyHighEntropy.anomalyReasons.some((r) => r.includes('Shannon entropy')));
  assert.ok(anomalyHighEntropy.auditReceipt.startsWith('MORPHEUS_SIG_'));
});

test('NVIDIA Morpheus Digital Fingerprint & Velocity: blocks velocity bursts and unauthorized tool drift', () => {
  const now = Date.now();
  // 1. Tool velocity burst (10 calls in 2 seconds)
  const burstHistory = Array.from({ length: 10 }, (_, i) => now - i * 100);

  const burstAnomaly = detectMorpheusAgentAnomaly({
    agentId: 'scraping_bot',
    toolName: 'search',
    toolArgs: { query: 'test' },
    invocationHistory: burstHistory,
    baselineAllowedTools: ['search'],
  });

  assert.equal(burstAnomaly.ok, true);
  assert.equal(burstAnomaly.verdict, 'BLOCK');
  assert.ok(burstAnomaly.anomalyReasons.some((r) => r.includes('surge detected')));

  // 2. Digital Fingerprint Drift: read-only agent suddenly calling privileged bash tool
  const driftAnomaly = detectMorpheusAgentAnomaly({
    agentId: 'doc_summarizer_agent',
    toolName: 'bash',
    toolArgs: { cmd: 'rm -rf /' },
    invocationHistory: [],
    baselineAllowedTools: ['read', 'grep', 'summarize'],
  });

  assert.equal(driftAnomaly.ok, true);
  assert.equal(driftAnomaly.threatLevel, 'CRITICAL');
  assert.equal(driftAnomaly.verdict, 'BLOCK');
  assert.ok(driftAnomaly.anomalyReasons.some((r) => r.includes('deviates from authorized baseline')));
});

test('NVIDIA Triton & TensorRT-LLM Governor: arbitrates queue depth and triggers load shedding on KV-cache exhaustion', () => {
  // Healthy cluster state
  const healthyGov = governTritonTensorRtInflightBatching({
    queueDepth: 10,
    kvCacheUtilizationPct: 40.0,
    incomingBatchSize: 2,
    maxQueueCapacity: 64,
  });

  assert.equal(healthyGov.ok, true);
  assert.equal(healthyGov.shouldThrottle, false);
  assert.equal(healthyGov.sheddingTriggered, false);
  assert.equal(healthyGov.kvCacheStatus, 'HEALTHY');
  assert.equal(healthyGov.actionRecommended, 'DISPATCH_INFLIGHT_BATCH');

  // Exhausted KV cache (utilization > 85%) -> load shed HTTP 429
  const exhaustedGov = governTritonTensorRtInflightBatching({
    queueDepth: 20,
    kvCacheUtilizationPct: 92.0,
    incomingBatchSize: 4,
    maxQueueCapacity: 64,
  });

  assert.equal(exhaustedGov.ok, true);
  assert.equal(exhaustedGov.shouldThrottle, true);
  assert.equal(exhaustedGov.sheddingTriggered, true);
  assert.ok(exhaustedGov.recommendedBackoffMs > 0);
  assert.equal(exhaustedGov.kvCacheStatus, 'NEAR_CAPACITY');
  assert.equal(exhaustedGov.actionRecommended, 'LOAD_SHED_HTTP_429');
});

test('NVIDIA Open Source Steal Master Evaluator: integrates all 3 pillars and verifies fast-money-engine re-exports', () => {
  const result = evaluateNvidiaOpenSourceSteal();

  assert.equal(result.ok, true);
  assert.ok(result.stealSource.includes('developer.nvidia.com/open-source'));
  assert.ok(result.portfolio.nemoGuardrails);
  assert.ok(result.portfolio.morpheus);
  assert.ok(result.portfolio.tritonTensorRt);
  assert.equal(result.pillar1_NeMoColangCompiler.ok, true);
  assert.equal(result.pillar2_MorpheusCyberAnomaly.ok, true);
  assert.equal(result.pillar3_TritonTensorRtGovernor.ok, true);
  assert.ok(result.monetizationPath.proTier.includes('pro-direct'));
  assert.ok(result.monetizationPath.rulePack.includes('gumroad.com'));
  assert.ok(result.monetizationPath.diagnostic.includes('diagnostic'));

  // Verify fast-money-engine re-exports
  assert.equal(typeof fastMoneyEngine.evaluateNvidiaOpenSourceSteal, 'function');
  assert.equal(typeof fastMoneyEngine.compileNeMoColangFlowToThumbGateRule, 'function');
  assert.equal(typeof fastMoneyEngine.detectMorpheusAgentAnomaly, 'function');
  assert.equal(typeof fastMoneyEngine.governTritonTensorRtInflightBatching, 'function');

  const fmeResult = fastMoneyEngine.evaluateNvidiaOpenSourceSteal();
  assert.equal(fmeResult.ok, true);
});
