'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STABLE_SYSTEM_PREFIX,
  classifyLocalServingProbe,
  diffCacheCounters,
  buildLocalOpenAiChatPayload,
  pairedChatBodies,
  isLoopbackBase,
  measureLocalPrefix,
} = require('../scripts/vllm-local-prefix-route');

const LIVE_SHAPE = {
  engine_cache: {
    system_kv_cache: {
      capacity: 4,
      in_use: 1,
      counters: { hits: 1, misses: 1, stores: 1, evictions: 0, hit_ratio: 0.5 },
    },
  },
  error: 'Cache stats not available (mlx_vlm not loaded)',
};

test('a simple-engine probe refuses vendor throughput and pins the loaded model', () => {
  const plan = classifyLocalServingProbe({
    probe: {
      engine_type: 'simple',
      model_name: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
      owned_by: 'vllm-mlx',
      tokens_per_second: 954000,
    },
  });
  const encoded = JSON.stringify(plan);
  assert.equal(plan.ok, true);
  assert.equal(plan.catalogOnly, false);
  assert.equal(plan.measured, false);
  assert.equal(plan.servingClass, 'short-local-classification');
  assert.equal(plan.modelId, 'mlx-community/Llama-3.2-1B-Instruct-4bit');
  assert.equal(plan.vendorThroughputRefused, true);
  assert.equal(plan.reuseClaim, 'unmeasured');
  assert.equal(encoded.includes('954000'), false);
  assert.equal(encoded.includes('WideEP'), false);
  assert.equal(encoded.includes('DSpark'), false);
  assert.equal(encoded.includes('PagedAttention'), false);
  assert.equal(encoded.includes('v0.32.0'), false);
  assert.equal(Object.hasOwn(plan, 'recommendedRole'), false);
});

test('a 32B name on the probe is not adopted as a serving role', () => {
  const plan = classifyLocalServingProbe({
    probe: {
      engine_type: 'vllm',
      model_name: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      tokens_per_second: 954000,
    },
  });
  assert.equal(plan.servingClass, 'attached-probe-unclassified');
  assert.equal(plan.modelId, 'Qwen/Qwen2.5-Coder-32B-Instruct');
  assert.equal(plan.vendorThroughputRefused, true);
  assert.equal(JSON.stringify(plan).includes('954000'), false);
});

test('local chat bodies share one system prefix and keep the question in the user turn', () => {
  const prompt = `${STABLE_SYSTEM_PREFIX}\n=== Captured lessons (your data) ===\n(none)\n=== Question ===\nhow to configure gates?`;
  const first = JSON.parse(buildLocalOpenAiChatPayload(prompt, 'llama-local'));
  const second = JSON.parse(buildLocalOpenAiChatPayload(
    `${STABLE_SYSTEM_PREFIX}\n=== Question ===\nwhat changed?`,
    'llama-local',
  ));
  assert.equal(first.messages[0].role, 'system');
  assert.equal(first.messages[0].content, STABLE_SYSTEM_PREFIX);
  assert.equal(second.messages[0].content, first.messages[0].content);
  assert.match(first.messages[1].content, /how to configure gates\?/);
  assert.equal(first.messages[0].content.includes('how to configure gates'), false);
  assert.equal(first.model, 'llama-local');
  assert.equal(Object.hasOwn(first, 'top_k'), false);
  assert.equal(Object.hasOwn(first, 'stop'), false);

  const [probeA, probeB] = pairedChatBodies('mlx-community/Llama-3.2-1B-Instruct-4bit');
  assert.equal(probeA.messages[0].content, probeB.messages[0].content);
  assert.notEqual(probeA.messages[1].content, probeB.messages[1].content);
  assert.equal(probeA.max_tokens, 8);
  assert.equal(probeA.temperature, 0);
  assert.equal(probeA.model, 'mlx-community/Llama-3.2-1B-Instruct-4bit');
});

test('cache diffs count only shared numeric fields and leave the prefix trie unmeasured', () => {
  const after = JSON.parse(JSON.stringify(LIVE_SHAPE));
  after.engine_cache.system_kv_cache.counters.hits = 2;
  after.engine_cache.system_kv_cache.counters.hit_ratio = 0.66;
  after.engine_cache.system_kv_cache.extra_only_after = 9;
  const before = JSON.parse(JSON.stringify(LIVE_SHAPE));
  before.engine_cache.system_kv_cache.only_before = 3;
  const fields = diffCacheCounters(before, after);
  assert.equal(Object.hasOwn(fields, 'engine_cache.system_kv_cache.extra_only_after'), false);
  assert.equal(Object.hasOwn(fields, 'engine_cache.system_kv_cache.only_before'), false);
  assert.equal(fields['engine_cache.system_kv_cache.counters.hits'].delta, 1);

  const plan = classifyLocalServingProbe({
    probe: { engine_type: 'simple', model_name: 'mlx-community/Llama-3.2-1B-Instruct-4bit' },
    cacheBefore: before,
    cacheAfter: after,
  });
  assert.equal(plan.reuseClaim, 'unmeasured');
  assert.equal(plan.cacheMeasurement.prefixTrieOnHttp, false);
  assert.equal(plan.cacheMeasurement.systemKvClaim, 'system_kv_hit');
  assert.equal(plan.cacheMeasurement.measured, true);
  assert.equal(plan.measured, false);
});

test('batched engine counters with no hit are a cache miss', () => {
  const plan = classifyLocalServingProbe({
    probe: {
      engine_type: 'batched',
      model_name: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
      owned_by: 'vllm-mlx',
    },
    cacheBefore: {
      engine_cache: { hits: 0, misses: 2, tokens_saved: 0, entry_count: 3 },
    },
    cacheAfter: {
      engine_cache: { hits: 0, misses: 4, tokens_saved: 0, entry_count: 3 },
    },
  });
  assert.equal(plan.servingClass, 'short-local-classification');
  assert.equal(plan.cacheMeasurement.cacheClaim, 'cache_miss');
  assert.equal(plan.cacheMeasurement.systemKvClaim, 'counters_moved_without_system_kv');
  assert.equal(plan.reuseClaim, 'unmeasured');
  assert.equal(plan.measured, false);
});

test('identical cache snapshots are no movement, not a hit rate', () => {
  const plan = classifyLocalServingProbe({
    probe: { engine_type: 'simple', model_name: 'local' },
    cacheBefore: LIVE_SHAPE,
    cacheAfter: JSON.parse(JSON.stringify(LIVE_SHAPE)),
  });
  assert.equal(plan.cacheMeasurement.systemKvClaim, 'no_counter_movement');
  assert.equal(plan.reuseClaim, 'unmeasured');
});

test('the measure client stays on loopback and posts the same system prefix twice', async () => {
  assert.equal(isLoopbackBase('http://127.0.0.1:8000'), true);
  assert.equal(isLoopbackBase('https://vllm.ai'), false);
  assert.equal(isLoopbackBase('http://127.0.0.1:8765'), false);
  assert.equal(isLoopbackBase('http://10.0.0.8:8000'), false);

  const calls = [];
  let statsReads = 0;
  const transport = {
    async get(url) {
      calls.push(['GET', url]);
      if (url.endsWith('/health')) {
        return {
          ok: true,
          status: 200,
          json: {
            status: 'healthy',
            engine_type: 'simple',
            model_name: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
          },
        };
      }
      if (url.endsWith('/v1/models')) {
        return { ok: true, status: 200, json: { data: [{ id: 'mlx-community/Llama-3.2-1B-Instruct-4bit', owned_by: 'vllm-mlx' }] } };
      }
      statsReads += 1;
      const counters = statsReads === 1
        ? { hits: 1, misses: 1, stores: 1, evictions: 0, hit_ratio: 0.5 }
        : { hits: 2, misses: 2, stores: 2, evictions: 0, hit_ratio: 0.5 };
      return {
        ok: true,
        status: 200,
        json: { engine_cache: { system_kv_cache: { capacity: 4, in_use: 1, counters } } },
      };
    },
    async post(url, body) {
      calls.push(['POST', url, body]);
      return { ok: true, status: 200, json: { model: body.model, choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 1 } } };
    },
  };

  const refused = await measureLocalPrefix('https://vllm.ai', transport);
  assert.equal(refused.ok, false);
  assert.equal(calls.length, 0);

  const result = await measureLocalPrefix('http://127.0.0.1:8000', transport);
  const posts = calls.filter((row) => row[0] === 'POST');
  assert.equal(result.ok, true);
  assert.equal(posts.length, 2);
  assert.equal(posts[0][2].messages[0].content, posts[1][2].messages[0].content);
  assert.equal(posts[0][2].model, 'mlx-community/Llama-3.2-1B-Instruct-4bit');
  assert.equal(result.plan.cacheMeasurement.systemKvClaim, 'system_kv_hit');
  assert.equal(result.plan.reuseClaim, 'unmeasured');
  assert.equal(result.plan.measured, false);
});
