'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classifyObservedServingProbe } = require('../scripts/local-model-profile');
const { evaluateVllmWideEpAndAgentxEconomics } = require('../scripts/rrsi-doctor');

const MLX_PROBE = {
  versionStatus: 404,
  stockVersion: '0.32.0',
  claimedTokensPerSecPerGpu: 954000,
  health: {
    status: 'healthy',
    model_loaded: true,
    model_name: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
    engine_type: 'simple',
  },
  models: {
    data: [{ id: 'mlx-community/Llama-3.2-1B-Instruct-4bit', owned_by: 'vllm-mlx' }],
  },
  argv: [
    'vllm-mlx',
    'serve',
    'mlx-community/Llama-3.2-1B-Instruct-4bit',
    '--prefix-trie-cache',
    '--prefix-trie-cache-size',
    '128',
  ],
  cacheStats: {
    engine_cache: {
      system_kv_cache: {
        capacity: 4,
        counters: { hits: 3, misses: 1, hit_ratio: 0.99 },
      },
    },
    error: 'Cache stats not available (mlx_vlm not loaded)',
  },
};

test('a vllm-mlx probe reports the local server and refuses the vendor catalog', () => {
  const observed = classifyObservedServingProbe(MLX_PROBE);

  assert.equal(observed.engineFamily, 'vllm-mlx');
  assert.equal(observed.stockVllm, false);
  assert.equal(observed.vllmRelease, null);
  assert.equal(observed.modelId, 'mlx-community/Llama-3.2-1B-Instruct-4bit');
  assert.equal(observed.modelLoaded, true);
  assert.equal(observed.continuousBatching, false);
  assert.equal(observed.prefixCache.enabled, true);
  assert.equal(observed.prefixCache.size, 128);
  assert.equal(observed.prefixCache.hitRate, null);
  assert.equal(observed.prefixCache.hitRateMeasured, false);
  assert.equal(observed.systemKvCache.capacity, 4);
  assert.equal(observed.systemKvCache.hits, 3);
  assert.equal(observed.systemKvCache.misses, 1);
  assert.equal(observed.systemKvCache.hitRate, 0.75);
  assert.equal(observed.cacheStatsError, 'Cache stats not available (mlx_vlm not loaded)');
  assert.equal(observed.catalogNumbersAreMeasurements, false);
  assert.equal(observed.peakTokensPerSecPerGpu, undefined);
  assert.ok(observed.refusedClaims.includes('stock-vllm-release'));
  assert.ok(observed.refusedClaims.includes('nixl-prefill-decode'));
  assert.ok(observed.refusedClaims.includes('vendor-throughput'));
  assert.ok(observed.refusedClaims.includes('prefix-cache-hit-rate'));
  assert.ok(observed.refusedClaims.includes('continuous-batching'));
});

test('a prefix-trie hit rate is reported only from its own counters', () => {
  const observed = classifyObservedServingProbe({
    ...MLX_PROBE,
    cacheStats: {
      prefix_trie: { counters: { hits: 8, misses: 2 } },
    },
  });

  assert.equal(observed.prefixCache.hitRate, 0.8);
  assert.equal(observed.prefixCache.hitRateMeasured, true);
  assert.equal(observed.systemKvCache.hitRate, null);
  assert.ok(!observed.refusedClaims.includes('prefix-cache-hit-rate'));
});

test('an advertised hit ratio without counters is not a measurement', () => {
  const observed = classifyObservedServingProbe({
    cacheStats: { engine_cache: { system_kv_cache: { counters: { hit_ratio: 0.91 } } } },
  });

  assert.equal(observed.systemKvCache.hitRate, null);
  assert.equal(observed.systemKvCache.hitRateMeasured, false);
  assert.equal(observed.engineFamily, 'unknown');
  assert.equal(observed.prefixCache.enabled, null);
});

test('a stock vLLM version is recorded only from a 200 version response', () => {
  const observed = classifyObservedServingProbe({
    versionStatus: 200,
    stockVersion: '0.11.0',
    health: { model_loaded: true, continuous_batching: true, kv_cache_dtype: 'fp8' },
    models: [{ id: 'qwen2.5-0.5b', owned_by: 'vllm' }],
  });

  assert.equal(observed.engineFamily, 'vllm');
  assert.equal(observed.stockVllm, true);
  assert.equal(observed.vllmRelease, '0.11.0');
  assert.equal(observed.continuousBatching, true);
  assert.equal(observed.kvCacheDtype, 'fp8');
  assert.ok(!observed.refusedClaims.includes('stock-vllm-release'));
  assert.ok(!observed.refusedClaims.includes('continuous-batching'));
  assert.ok(!observed.refusedClaims.includes('nvfp4-kv'));
  assert.ok(observed.refusedClaims.includes('vendor-throughput'));
  assert.ok(observed.refusedClaims.includes('nixl-prefill-decode'));
});

test('a local server probe blocks the wide-EP vendor revenue figure', () => {
  const priced = evaluateVllmWideEpAndAgentxEconomics({
    tokensPerSecPerGpu: 954000,
    p90TpsPerUser: 196,
    lowLatencyB300Path: true,
    probe: MLX_PROBE,
  });

  assert.equal(priced.allowed, false);
  assert.equal(priced.estimatedRevenuePerGpuHrUsd, null);
  assert.equal(priced.effectiveUserTps, null);
  assert.equal(priced.catalogNumbersAreMeasurements, false);
  assert.equal(priced.observed.engineFamily, 'vllm-mlx');
  assert.equal(priced.observed.vllmRelease, null);
  assert.ok(priced.blockers.includes('vendor_throughput_not_measured_on_this_server'));

  const catalog = evaluateVllmWideEpAndAgentxEconomics({
    tokensPerSecPerGpu: 954000,
    p90TpsPerUser: 196,
    lowLatencyB300Path: true,
  });
  assert.equal(catalog.allowed, true);
  assert.equal(catalog.catalogOnly, true);
  assert.equal(catalog.catalogNumbersAreMeasurements, false);
  assert.equal(catalog.observed, null);
  assert.equal(catalog.estimatedRevenuePerGpuHrUsd, 38.96);
});
