#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadDotEnv(filePath = path.join(process.cwd(), '.env')) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
  return true;
}

function parseArgs(argv = []) {
  const out = {
    json: argv.includes('--json'),
    requireLive: argv.includes('--require-live'),
    chat: argv.includes('--chat'),
    baseUrl: null,
    model: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base-url') out.baseUrl = argv[++i];
    if (argv[i] === '--model') out.model = argv[++i];
  }

  return out;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '')
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/models\/?$/i, '')
    .replace(/\/+$/, '');
}

function extractModels(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') return entry.id || entry.name || null;
      return null;
    })
    .filter(Boolean);
}

async function fetchModels(baseUrl, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: 'fetch_unavailable', models: [] };
  }

  const url = `${normalizeBaseUrl(baseUrl)}/models`;
  try {
    const response = await fetchImpl(url, { method: 'GET' });
    if (!response || !response.ok) {
      return {
        ok: false,
        status: 'models_endpoint_failed',
        httpStatus: response?.status || null,
        url,
        models: [],
      };
    }
    const payload = await response.json();
    return {
      ok: true,
      status: 'models_ready',
      httpStatus: response.status || 200,
      url,
      models: extractModels(payload),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'models_endpoint_error',
      url,
      message: error?.message || String(error),
      models: [],
    };
  }
}

async function run(options = {}) {
  loadDotEnv();
  const {
    callOmlx,
    getOmlxBaseUrl,
    getOmlxModel,
  } = require('./llm-client');

  const baseUrl = normalizeBaseUrl(options.baseUrl || getOmlxBaseUrl());
  const modelsResult = await fetchModels(baseUrl, options.fetchImpl || global.fetch);
  const configuredModel = options.model || getOmlxModel();
  const selectedModel = options.model || modelsResult.models[0] || configuredModel;
  const result = {
    ok: modelsResult.ok,
    status: modelsResult.status,
    provider: 'omlx',
    baseUrl,
    model: selectedModel,
    models: modelsResult.models,
    modelsUrl: modelsResult.url,
    httpStatus: modelsResult.httpStatus || null,
  };

  if (!modelsResult.ok) {
    result.message = modelsResult.message || 'oMLX /v1/models is not reachable';
    if (options.requireLive) process.exitCode = 1;
    return result;
  }

  if (!options.chat) {
    result.status = modelsResult.models.length > 0 ? 'models_ready' : 'models_empty';
    result.ok = !options.requireLive || modelsResult.models.length > 0;
    if (!result.ok) process.exitCode = 1;
    return result;
  }

  process.env.THUMBGATE_OMLX_ENABLED = '1';
  process.env.THUMBGATE_OMLX_BASE_URL = baseUrl;
  process.env.THUMBGATE_OMLX_MODEL = selectedModel;

  const chat = await callOmlx({
    systemPrompt: 'You are a local inference smoke test.',
    userPrompt: 'Say that ThumbGate local oMLX inference is reachable.',
    maxTokens: 64,
    temperature: 0,
    returnMetadata: true,
  });

  if (!chat || typeof chat.text !== 'string' || chat.text.trim().length < 1) {
    process.exitCode = 1;
    return {
      ...result,
      ok: false,
      status: 'chat_failed',
      message: 'oMLX /v1/chat/completions did not return assistant text',
    };
  }

  return {
    ...result,
    ok: true,
    status: 'ready',
    model: chat.model || selectedModel,
    textPreview: chat.text.slice(0, 200),
    usage: chat.usage || null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await run(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`oMLX smoke status: ${result.status}`);
  console.log(`Provider: ${result.provider}`);
  console.log(`Base URL: ${result.baseUrl}`);
  console.log(`Model: ${result.model}`);
  console.log(`Models: ${result.models.length}`);
  console.log(`Result: ${result.ok ? 'ready' : result.message || 'not ready'}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  loadDotEnv,
  parseArgs,
  normalizeBaseUrl,
  extractModels,
  fetchModels,
  run,
};
