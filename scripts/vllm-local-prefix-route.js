#!/usr/bin/env node
'use strict';

const http = require('node:http');
const path = require('node:path');

// Stable across questions. vllm-mlx only stores a system-role prefix, and only
// when that rendered prefix is identical on the next call.
const STABLE_SYSTEM_PREFIX = [
  'You are ThumbGate\'s "chat with your data" assistant. Answer the user\'s question',
  'using ONLY the captured lessons and the live numeric snapshot in the user message.',
  'For count questions, use the numeric snapshot. For pattern questions, cite lesson numbers.',
  'If the sources do not contain the answer, say so. Do not invent counts, customers, or revenue.',
].join(' ');

const BLOCKED_LOOPBACK_PORTS = new Set(['8765']);

function attachedProbe(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.prototype.hasOwnProperty.call(input, 'probe')) {
    if (input.probe == null || input.probe === '') return null;
    return input.probe;
  }
  if (input.engine_type || input.engineType) {
    return {
      engine_type: input.engine_type || input.engineType,
      model_name: input.model_name || input.modelName || null,
      owned_by: input.owned_by || input.ownedBy || null,
    };
  }
  return null;
}

function modelIdFromProbe(probe) {
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)) return null;
  if (typeof probe.model_name === 'string' && probe.model_name.trim()) return probe.model_name.trim();
  if (typeof probe.model === 'string' && probe.model.trim()) return probe.model.trim();
  if (typeof probe.id === 'string' && probe.id.trim()) return probe.id.trim();
  const first = probe.data && probe.data[0];
  if (first && typeof first.id === 'string' && first.id.trim()) return first.id.trim();
  return null;
}

function engineTypeFromProbe(probe) {
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)) return null;
  const value = probe.engine_type || probe.engineType;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function servingClassFor(engineType, ownedBy) {
  if (engineType === 'simple' || ownedBy === 'vllm-mlx') return 'short-local-classification';
  return 'attached-probe-unclassified';
}

function numericLeaves(value, prefix, out) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'number' && Number.isFinite(child)) out[next] = child;
    else numericLeaves(child, next, out);
  }
}

function diffCacheCounters(before, after) {
  const left = {};
  const right = {};
  numericLeaves(before, '', left);
  numericLeaves(after, '', right);
  const fields = {};
  for (const key of Object.keys(left)) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) continue;
    fields[key] = {
      before: left[key],
      after: right[key],
      delta: right[key] - left[key],
    };
  }
  return fields;
}

function systemKvClaim(fields) {
  const hits = fields['engine_cache.system_kv_cache.counters.hits'];
  const misses = fields['engine_cache.system_kv_cache.counters.misses'];
  const stores = fields['engine_cache.system_kv_cache.counters.stores'];
  if (!hits && !misses && !stores) {
    if (Object.keys(fields).length === 0) return 'unmeasured';
    if (Object.values(fields).every((row) => row.delta === 0)) return 'no_counter_movement';
    return 'counters_moved_without_system_kv';
  }
  if (hits && hits.delta > 0) return 'system_kv_hit';
  if ((stores && stores.delta > 0) || (misses && misses.delta > 0)) return 'system_kv_store';
  if (Object.values(fields).every((row) => row.delta === 0)) return 'no_counter_movement';
  return 'counters_moved_without_system_kv';
}

function cacheClaim(fields) {
  const scoped = systemKvClaim(fields);
  if (scoped === 'system_kv_hit' || scoped === 'system_kv_store') return scoped;
  const hits = fields['engine_cache.hits'];
  const misses = fields['engine_cache.misses'];
  const saved = fields['engine_cache.tokens_saved'];
  if (hits || misses || saved) {
    if ((hits && hits.delta > 0) || (saved && saved.delta > 0)) return 'cache_hit';
    if (misses && misses.delta > 0 && (!hits || hits.delta <= 0)) return 'cache_miss';
    if (Object.values(fields).every((row) => row.delta === 0)) return 'no_counter_movement';
  }
  return scoped;
}

function prefixTrieClaim(fields) {
  const hitKey = Object.keys(fields).find((key) => (
    key.toLowerCase().includes('prefix_trie') && key.endsWith('hits')
  ));
  if (!hitKey) return 'unmeasured';
  if (fields[hitKey].delta > 0) return 'prefix_trie_hit';
  return 'prefix_trie_present_no_hit';
}

function variableUserContent(prompt) {
  const full = String(prompt || '');
  if (full.startsWith(STABLE_SYSTEM_PREFIX)) {
    return full.slice(STABLE_SYSTEM_PREFIX.length).replace(/^\n+/, '');
  }
  return full;
}

function buildLocalOpenAiChatPayload(prompt, model, options = {}) {
  const maxTokens = Number.isFinite(options.maxTokens) ? options.maxTokens : 1024;
  const temperature = Number.isFinite(options.temperature) ? options.temperature : 0.2;
  return JSON.stringify({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: STABLE_SYSTEM_PREFIX },
      { role: 'user', content: variableUserContent(prompt) },
    ],
  });
}

function pairedChatBodies(modelId) {
  const first = JSON.parse(buildLocalOpenAiChatPayload(
    'Reply with the single word ready.',
    modelId,
    { maxTokens: 8, temperature: 0 },
  ));
  const second = JSON.parse(buildLocalOpenAiChatPayload(
    'Reply with the single word again.',
    modelId,
    { maxTokens: 8, temperature: 0 },
  ));
  first.stream = false;
  second.stream = false;
  return [first, second];
}

function classifyLocalServingProbe(input = {}) {
  const probe = attachedProbe(input);
  const probeObject = probe && typeof probe === 'object' && !Array.isArray(probe) ? probe : null;
  const engineType = engineTypeFromProbe(probeObject);
  const modelId = modelIdFromProbe(probeObject);
  const fields = diffCacheCounters(input.cacheBefore, input.cacheAfter);
  const hasSnapshots = input.cacheBefore != null && input.cacheAfter != null;
  return {
    ok: true,
    catalogOnly: false,
    measured: false,
    source: 'local-probe',
    servingClass: servingClassFor(engineType, probeObject && probeObject.owned_by),
    engineType,
    modelId,
    ownedBy: probeObject && typeof probeObject.owned_by === 'string' ? probeObject.owned_by : null,
    vendorThroughputRefused: true,
    refusedClaims: [
      'wide-ep',
      'dspark',
      'paged-attention',
      'tokens-per-second',
      'catalog-32b-role-names',
    ],
    stableSystemPrefix: STABLE_SYSTEM_PREFIX,
    reuseClaim: hasSnapshots ? prefixTrieClaim(fields) : 'unmeasured',
    cacheMeasurement: {
      measured: hasSnapshots && Object.keys(fields).length > 0,
      systemKvClaim: hasSnapshots ? systemKvClaim(fields) : 'unmeasured',
      cacheClaim: hasSnapshots ? cacheClaim(fields) : 'unmeasured',
      prefixTrieOnHttp: hasSnapshots && prefixTrieClaim(fields) !== 'unmeasured',
      counters: fields,
    },
  };
}

function isLoopbackBase(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return false;
  if (!url.port || BLOCKED_LOOPBACK_PORTS.has(url.port)) return false;
  if (url.pathname !== '/' && url.pathname !== '') return false;
  return true;
}

function defaultTransport() {
  return {
    async get(url) {
      return requestJson('GET', url, null, 5000);
    },
    async post(url, body) {
      return requestJson('POST', url, body, 60000);
    },
  };
}

function requestJson(method, url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(url, {
      method,
      headers: payload
        ? { 'content-type': 'application/json', 'content-length': payload.length }
        : {},
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = { unparsed: text.slice(0, 180) };
        }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function completionSummary(result) {
  if (!result) return { ok: false };
  const choice = result.json && result.json.choices && result.json.choices[0];
  const content = choice && choice.message && typeof choice.message.content === 'string'
    ? choice.message.content.slice(0, 80)
    : '';
  return {
    ok: Boolean(result.ok),
    status: result.status,
    model: result.json && result.json.model ? result.json.model : null,
    finishReason: choice && choice.finish_reason ? choice.finish_reason : null,
    content,
    usage: result.json && result.json.usage ? result.json.usage : null,
    error: result.json && result.json.error ? result.json.error : null,
  };
}

async function measureLocalPrefix(base, transport) {
  if (!isLoopbackBase(base)) {
    return { ok: false, error: 'refusing non-loopback base' };
  }
  const client = transport || defaultTransport();
  const root = String(base).replace(/\/$/, '');
  const health = await client.get(`${root}/health`);
  const models = await client.get(`${root}/v1/models`);
  const before = await client.get(`${root}/v1/cache/stats`);
  const probe = {
    ...(health && health.json && typeof health.json === 'object' ? health.json : {}),
    owned_by: models && models.json && models.json.data && models.json.data[0]
      ? models.json.data[0].owned_by
      : null,
  };
  const modelId = modelIdFromProbe(probe) || modelIdFromProbe(models && models.json);
  if (!modelId) {
    return { ok: false, error: 'probe had no model id', health: health && health.status, models: models && models.status };
  }
  const bodies = pairedChatBodies(modelId);
  const completions = [];
  for (const body of bodies) {
    completions.push(completionSummary(await client.post(`${root}/v1/chat/completions`, body)));
  }
  const after = await client.get(`${root}/v1/cache/stats`);
  const plan = classifyLocalServingProbe({
    probe,
    cacheBefore: before && before.json,
    cacheAfter: after && after.json,
  });
  return {
    ok: completions.every((row) => row.ok) && Boolean(health && health.ok),
    plan,
    completions,
    cacheBefore: before && before.json,
    cacheAfter: after && after.json,
  };
}

async function main() {
  const measureFlag = process.argv.indexOf('--measure');
  const base = measureFlag >= 0 ? process.argv[measureFlag + 1] : '';
  if (!base) {
    process.stderr.write('usage: node scripts/vllm-local-prefix-route.js --measure http://127.0.0.1:8000\n');
    process.exitCode = 2;
    return;
  }
  try {
    const result = await measureLocalPrefix(base);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: err.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

module.exports = {
  STABLE_SYSTEM_PREFIX,
  attachedProbe,
  classifyLocalServingProbe,
  diffCacheCounters,
  buildLocalOpenAiChatPayload,
  pairedChatBodies,
  isLoopbackBase,
  measureLocalPrefix,
};
