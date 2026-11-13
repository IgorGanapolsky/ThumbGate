/**
 * Tests for HardwareAwareHybridRouter
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HardwareAwareHybridRouter } = require('../src/hardware-aware-hybrid-router');

test('HardwareAwareHybridRouter - accurate memory footprint calculation for weights and KV cache', () => {
  const router = new HardwareAwareHybridRouter({ localVramGb: 16.0 });

  // 14B model, 4-bit weights, 2048 context tokens
  const footprint = router.calculateMemoryFootprint({
    modelParamB: 14,
    quantizationBits: 4,
    contextTokens: 2048,
    numLayers: 40,
    hiddenSize: 5120,
    numAttentionHeads: 40,
    numKeyValueHeads: 8,
    kvCacheQuantBits: 16
  });

  assert.ok(footprint.weightGb > 6.0 && footprint.weightGb < 8.0, `Weight GB ${footprint.weightGb} should be ~6.5GB`);
  assert.ok(footprint.kvCacheGb > 0, 'KV cache footprint should be positive');
  assert.ok(footprint.totalRequiredVramGb > footprint.weightGb, 'Total VRAM includes weights + KV cache');
});

test('HardwareAwareHybridRouter - routes compact workloads locally when within VRAM', () => {
  const router = new HardwareAwareHybridRouter({ localVramGb: 16.0, vramSafetyMargin: 0.15 });

  // 7B model, 4-bit, 2k tokens fits easily into 16GB VRAM (usable: 13.6GB)
  const route = router.routeInferenceWorkload({
    taskType: 'code_generation',
    modelParamB: 7,
    quantizationBits: 4,
    contextTokens: 2048,
    numLayers: 32,
    hiddenSize: 4096,
    numAttentionHeads: 32,
    numKeyValueHeads: 8
  });

  assert.equal(route.dispatchTier, 'LOCAL_FAST_TIER');
  assert.equal(route.targetProvider, 'local_gpu');
  assert.equal(route.offloadAvoided, false);
});

test('HardwareAwareHybridRouter - escalates to Cloud/Crusoe when KV cache exceeds local VRAM to prevent CPU offload', () => {
  const router = new HardwareAwareHybridRouter({ localVramGb: 16.0, vramSafetyMargin: 0.15 });

  // 70B model, 4-bit weights (~32.6GB) will never fit on a 16GB GPU
  const route = router.routeInferenceWorkload({
    taskType: 'code_generation',
    modelParamB: 70,
    quantizationBits: 4,
    contextTokens: 4096,
    numLayers: 80,
    hiddenSize: 8192,
    numAttentionHeads: 64,
    numKeyValueHeads: 8
  });

  assert.equal(route.dispatchTier, 'CLOUD_ESCALATION');
  assert.equal(route.targetProvider, 'crusoe_inception');
  assert.equal(route.offloadAvoided, true);
  assert.match(route.reason, /VRAM limit exceeded/);
});

test('HardwareAwareHybridRouter - blocks aggressive sub-4-bit quantization on code generation tasks', () => {
  const router = new HardwareAwareHybridRouter({ localVramGb: 24.0 });

  // 2-bit quantization on code generation
  const route = router.routeInferenceWorkload({
    taskType: 'code_generation',
    modelParamB: 14,
    quantizationBits: 2,
    contextTokens: 2048
  });

  assert.equal(route.dispatchTier, 'CLOUD_ESCALATION');
  assert.match(route.reason, /requires >= 4-bit quantization/);
});
