#!/usr/bin/env node
'use strict';

const { runStep } = require('./durability/step');
const { redactSecrets } = require('./secret-redaction');

const MODELS = {
  FAST: 'claude-haiku-4-5-20251001',
  SMART: 'claude-sonnet-4-6',
};

const DEFAULT_MODEL = MODELS.FAST;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_CACHE_TTL = '5m';
const DEFAULT_ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
const DEFAULT_ZAI_MODEL = 'glm-5.2-flash';
const DEFAULT_GATEWAY_MODEL = 'glm-5.2';
const GATEWAY_TIMEOUT_MS = 30000;

let _anthropicClient = null;
let _geminiClient = null;

function getGatewayConfig(env = process.env) {
  const baseUrl = String(env.THUMBGATE_LLM_GATEWAY_URL || '').trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model: String(env.THUMBGATE_LLM_GATEWAY_MODEL || DEFAULT_GATEWAY_MODEL).trim(),
    credentialEnvVar: 'THUMBGATE_LLM_GATEWAY_TOKEN',
  };
}

function isGatewayConfigured(env = process.env) {
  return Boolean(getGatewayConfig(env));
}

function describeInferenceAvailability(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return { available: true, provider: 'anthropic' };
  const gateway = getGatewayConfig(env);
  if (gateway) {
    return {
      available: true,
      provider: 'gateway',
      model: gateway.model,
    };
  }
  return {
    available: false,
    provider: 'none',
    reason: 'no ANTHROPIC_API_KEY and no THUMBGATE_LLM_GATEWAY_URL',
  };
}

function isAvailable(env = process.env) {
  return describeInferenceAvailability(env).available;
}

function getClient() {
  if (_anthropicClient) return _anthropicClient;
  if (!isAvailable()) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropicClient = new Anthropic();
    return _anthropicClient;
  } catch {
    return null;
  }
}

function stripCodeFences(text) {
  if (!text) return text;
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
  return fenced ? fenced[1].trim() : text.trim();
}

function normalizeCacheOptions(cache) {
  if (!cache) return null;

  if (cache === true) {
    return {
      mode: 'system',
      control: { type: 'ephemeral', ttl: DEFAULT_CACHE_TTL },
    };
  }

  if (typeof cache === 'string') {
    return {
      mode: 'system',
      control: { type: 'ephemeral', ttl: cache },
    };
  }

  if (typeof cache !== 'object') return null;

  const ttl = typeof cache.ttl === 'string' && cache.ttl ? cache.ttl : DEFAULT_CACHE_TTL;
  const type = typeof cache.type === 'string' && cache.type ? cache.type : 'ephemeral';
  const mode = typeof cache.mode === 'string' && cache.mode ? cache.mode : 'system';

  return {
    mode,
    control: { type, ttl },
  };
}

function applyCacheToSystem(systemPrompt, cacheOptions) {
  if (!systemPrompt) return undefined;
  if (!cacheOptions || (cacheOptions.mode !== 'system' && cacheOptions.mode !== 'tools+system')) {
    return systemPrompt;
  }
  return [{ type: 'text', text: systemPrompt, cache_control: cacheOptions.control }];
}

function applyCacheToTools(tools, cacheOptions) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  if (!cacheOptions || (cacheOptions.mode !== 'tools' && cacheOptions.mode !== 'tools+system')) {
    return tools;
  }
  return tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || tool.cache_control) return tool;
    return { ...tool, cache_control: cacheOptions.control };
  });
}

function buildClaudeRequest({
  systemPrompt,
  userPrompt,
  messages,
  model,
  maxTokens,
  cache,
  tools,
  toolChoice,
  metadata,
  temperature,
} = {}) {
  const cacheOptions = normalizeCacheOptions(cache);
  const request = {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
    messages: Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: 'user', content: userPrompt }],
  };

  const normalizedSystem = applyCacheToSystem(systemPrompt, cacheOptions);
  if (normalizedSystem) request.system = normalizedSystem;

  const normalizedTools = applyCacheToTools(tools, cacheOptions);
  if (normalizedTools) request.tools = normalizedTools;

  if (toolChoice) request.tool_choice = toolChoice;
  if (metadata && typeof metadata === 'object') request.metadata = metadata;
  if (Number.isFinite(temperature)) request.temperature = temperature;

  if (cacheOptions && cacheOptions.mode === 'request') {
    request.cache_control = cacheOptions.control;
  }

  return request;
}

function extractTextContent(response) {
  return (response?.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function parseClaudeJson(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(stripCodeFences(text));
  } catch {
    return null;
  }
}

function buildSafeProviderError(error) {
  const rawMessage = error && error.message ? String(error.message) : 'provider request failed';
  const summary = {
    name: String(error && error.name || 'Error').slice(0, 80),
    message: redactSecrets(rawMessage).split('\n')[0].slice(0, 500),
  };
  const status = Number(error && (error.status || (error.response && error.response.status)));
  if (Number.isFinite(status)) summary.status = status;
  const code = error && error.code;
  if (typeof code === 'string' || typeof code === 'number') summary.code = code;
  return summary;
}

function normalizeUsageTelemetry(usage = null) {
  if (!usage || typeof usage !== 'object') {
    return {
      inputTokens: null,
      outputTokens: null,
      cacheReadInputTokens: null,
      cacheWriteInputTokens: null,
    };
  }
  const finiteOrNull = (...values) => {
    const value = values.map(Number).find(Number.isFinite);
    return value === undefined ? null : value;
  };
  return {
    inputTokens: finiteOrNull(usage.input_tokens, usage.prompt_tokens, usage.promptTokenCount),
    outputTokens: finiteOrNull(usage.output_tokens, usage.completion_tokens, usage.candidatesTokenCount),
    cacheReadInputTokens: finiteOrNull(usage.cache_read_input_tokens),
    cacheWriteInputTokens: finiteOrNull(usage.cache_creation_input_tokens),
  };
}

function buildLlmTrace(options = {}, event = {}) {
  const usage = normalizeUsageTelemetry(event.usage);
  return {
    timestamp: new Date().toISOString(),
    traceId: String(options.traceId || options.metadata?.traceId || '').trim() || null,
    provider: event.provider || 'unknown',
    model: event.model || options.model || null,
    outcome: event.outcome || 'unknown',
    latencyMs: Number.isFinite(event.latencyMs) ? Math.max(0, event.latencyMs) : null,
    ...usage,
    stopReason: event.stopReason || null,
    requestId: event.requestId || null,
    httpStatus: Number.isFinite(event.httpStatus) ? event.httpStatus : null,
    errorCode: event.errorCode == null ? null : String(event.errorCode).slice(0, 80),
  };
}

async function emitLlmTrace(options = {}, event = {}) {
  if (typeof options.onTrace !== 'function') return;
  try {
    await options.onTrace(buildLlmTrace(options, event));
  } catch {
    // Observability must never break the generation path.
  }
}

function gatewayRequestHeaders(config, env = process.env) {
  const headers = { 'Content-Type': 'application/json' };
  const token = env[config.credentialEnvVar];
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function buildGatewayMessages(options = {}) {
  const supplied = Array.isArray(options.messages)
    ? options.messages.filter(Boolean)
    : [];
  const messages = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  if (supplied.length > 0) messages.push(...supplied);
  else messages.push({ role: 'user', content: options.userPrompt || '' });
  return messages;
}

async function callGatewayInternal(options = {}, env = process.env) {
  const config = getGatewayConfig(env);
  if (!config || typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: gatewayRequestHeaders(config, env),
      body: JSON.stringify({
        model: options.model || config.model,
        messages: buildGatewayMessages(options),
        max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: Number.isFinite(options.temperature) ? options.temperature : 0,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      await emitLlmTrace(options, {
        provider: 'gateway',
        model: options.model || config.model,
        outcome: 'error',
        latencyMs: Date.now() - startedAt,
        httpStatus: response.status,
        errorCode: 'http_error',
      });
      return null;
    }
    const payload = await response.json();
    const choice = payload?.choices?.[0] || {};
    const message = choice.message || {};
    const truncated = choice.finish_reason === 'length';
    const raw = message.content || (truncated ? '' : message.reasoning_content) || '';
    const text = stripCodeFences(raw);
    if (!text) return null;
    const result = {
      text,
      usage: payload?.usage || null,
      stopReason: choice.finish_reason || null,
      id: payload?.id || null,
      model: payload?.model || options.model || config.model,
      provider: 'gateway',
    };
    await emitLlmTrace(options, {
      provider: 'gateway',
      model: result.model,
      outcome: 'success',
      latencyMs: Date.now() - startedAt,
      usage: result.usage,
      stopReason: result.stopReason,
      requestId: result.id,
    });
    return result;
  } catch (error) {
    const safe = buildSafeProviderError(error);
    await emitLlmTrace(options, {
      provider: 'gateway',
      model: options.model || config.model,
      outcome: 'error',
      latencyMs: Date.now() - startedAt,
      httpStatus: safe.status,
      errorCode: safe.code || safe.name,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function getZaiApiKey(env = process.env) {
  return env.ZAI_API_KEY || env.THUMBGATE_ZAI_API_KEY || '';
}

function getZaiBaseUrl(env = process.env) {
  return env.ZAI_BASE_URL || env.THUMBGATE_ZAI_BASE_URL || DEFAULT_ZAI_BASE_URL;
}

function getZaiModel(env = process.env) {
  return env.ZAI_API_MODEL || env.THUMBGATE_ZAI_MODEL || DEFAULT_ZAI_MODEL;
}

async function callZaiInternal(options = {}, env = process.env) {
  const apiKey = getZaiApiKey(env);
  const model = options.model || getZaiModel(env);
  const startedAt = Date.now();
  if (!apiKey || typeof fetch !== 'function') {
    await emitLlmTrace(options, {
      provider: 'zai',
      model,
      outcome: 'unavailable',
      latencyMs: Date.now() - startedAt,
      errorCode: !apiKey ? 'missing_api_key' : 'fetch_unavailable',
    });
    return null;
  }

  const messages = Array.isArray(options.messages) && options.messages.length > 0
    ? options.messages
    : [
      ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
      { role: 'user', content: options.userPrompt || '' },
    ];

  try {
    const response = await fetch(`${getZaiBaseUrl(env).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: Number.isFinite(options.temperature) ? options.temperature : 0,
      }),
    });

    if (!response.ok) {
      await emitLlmTrace(options, {
        provider: 'zai',
        model,
        outcome: 'error',
        latencyMs: Date.now() - startedAt,
        httpStatus: response.status,
        errorCode: 'http_error',
      });
      return null;
    }
    const json = await response.json();
    const result = {
      text: stripCodeFences(json?.choices?.[0]?.message?.content || ''),
      usage: json?.usage || null,
      stopReason: json?.choices?.[0]?.finish_reason || null,
      id: json?.id || null,
      model: json?.model || model,
    };
    await emitLlmTrace(options, {
      provider: 'zai',
      model: result.model,
      outcome: 'success',
      latencyMs: Date.now() - startedAt,
      usage: result.usage,
      stopReason: result.stopReason,
      requestId: result.id,
    });
    return result;
  } catch (error) {
    const safe = buildSafeProviderError(error);
    await emitLlmTrace(options, {
      provider: 'zai',
      model,
      outcome: 'error',
      latencyMs: Date.now() - startedAt,
      httpStatus: safe.status,
      errorCode: safe.code || safe.name,
    });
    return null;
  }
}

async function callGeminiInternal(options = {}) {
  const env = process.env;
  const { detectInferenceBackend } = require('./local-model-profile');
  const providerMode = detectInferenceBackend(env).providerMode;
  const provider = providerMode === 'vertex' ? 'vertex' : 'gemini';
  const startedAt = Date.now();

  if (providerMode !== 'vertex' && !env.GEMINI_API_KEY) {
    await emitLlmTrace(options, {
      provider,
      model: options.model,
      outcome: 'unavailable',
      latencyMs: Date.now() - startedAt,
      errorCode: 'missing_api_key',
    });
    return null;
  }

  try {
    const { GoogleGenAI } = require('@google/genai');
    if (!_geminiClient) {
      if (providerMode === 'vertex') {
        _geminiClient = new GoogleGenAI({
          enterprise: true,
          project: env.VERTEX_PROJECT_ID || 'ai-revenue28-webhook',
          location: env.VERTEX_LOCATION || 'us-central1',
        });
      } else {
        _geminiClient = new GoogleGenAI({
          apiKey: env.GEMINI_API_KEY,
        });
      }
    }

    const contents = convertMessagesToGemini(options.messages, options.userPrompt);
    const config = {};
    if (options.systemPrompt) {
      config.systemInstruction = options.systemPrompt;
    }
    if (Number.isFinite(options.temperature)) {
      config.temperature = options.temperature;
    }
    if (options.maxTokens) {
      config.maxOutputTokens = options.maxTokens;
    }

    const response = await runStep('llm.callGemini', {
      retries: 2,
      logger: (msg) => console.warn(msg),
    }, async () => _geminiClient.models.generateContent({
      model: options.model,
      contents,
      config,
    }));

    const result = {
      text: response.text || '',
      usage: response.usageMetadata ? {
        input_tokens: response.usageMetadata.promptTokenCount,
        output_tokens: response.usageMetadata.candidatesTokenCount,
      } : null,
      stopReason: response.candidates?.[0]?.finishReason || null,
      id: null,
      model: options.model,
    };
    await emitLlmTrace(options, {
      provider,
      model: result.model,
      outcome: 'success',
      latencyMs: Date.now() - startedAt,
      usage: result.usage,
      stopReason: result.stopReason,
      requestId: result.id,
    });
    return result;
  } catch (err) {
    const safe = buildSafeProviderError(err);
    console.error('Gemini/Vertex AI execution error:', JSON.stringify(safe));
    await emitLlmTrace(options, {
      provider,
      model: options.model,
      outcome: 'error',
      latencyMs: Date.now() - startedAt,
      httpStatus: safe.status,
      errorCode: safe.code || safe.name,
    });
    return null;
  }
}

function convertMessagesToGemini(messages, userPrompt) {
  const list = Array.isArray(messages) && messages.length > 0
    ? messages
    : [{ role: 'user', content: userPrompt }];

  return list.map((msg) => {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content.map((c) => c.text || '').join('');
    } else if (msg.content && typeof msg.content === 'object') {
      text = msg.content.text || JSON.stringify(msg.content);
    }
    return {
      role,
      parts: [{ text }],
    };
  });
}

async function callClaudeInternal(options = {}) {
  const modelName = options.model || '';
  if (modelName.startsWith('gemini') || modelName.startsWith('vertex')) {
    return callGeminiInternal(options);
  }

  const client = getClient();
  const model = options.model || DEFAULT_MODEL;
  const startedAt = Date.now();
  if (!client) {
    if (isGatewayConfigured()) {
      return callGatewayInternal(options);
    }
    await emitLlmTrace(options, {
      provider: 'anthropic',
      model,
      outcome: 'unavailable',
      latencyMs: Date.now() - startedAt,
      errorCode: 'missing_client_or_api_key',
    });
    return null;
  }

  try {
    const response = await runStep('llm.callClaude', {
      retries: 2,
      logger: (msg) => console.warn(msg),
    }, async () => client.messages.create(buildClaudeRequest(options)));

    const text = stripCodeFences(extractTextContent(response));
    const result = {
      text,
      usage: response?.usage || null,
      stopReason: response?.stop_reason || null,
      id: response?.id || null,
      model: response?.model || model,
    };
    await emitLlmTrace(options, {
      provider: 'anthropic',
      model: result.model,
      outcome: 'success',
      latencyMs: Date.now() - startedAt,
      usage: result.usage,
      stopReason: result.stopReason,
      requestId: result.id,
    });
    return result;
  } catch (error) {
    const safe = buildSafeProviderError(error);
    await emitLlmTrace(options, {
      provider: 'anthropic',
      model,
      outcome: 'error',
      latencyMs: Date.now() - startedAt,
      httpStatus: safe.status,
      errorCode: safe.code || safe.name,
    });
    return null;
  }
}

// Anthropic SDK throws errors with a `.status` field for HTTP failures.
// Our defaultClassify already reads `.status`, so 429/5xx retry and 4xx
// (bad request / unauthorized / not-found) bail immediately — which is
// what we want: there is no point retrying a malformed prompt or a
// revoked API key.
async function callClaude(options = {}) {
  const result = await callClaudeInternal(options);
  if (!result) return null;
  return options.returnMetadata ? result : result.text;
}

async function callClaudeJson(options = {}) {
  const result = await callClaudeInternal(options);
  if (!result) return null;

  const parsed = parseClaudeJson(result.text);
  if (parsed === null) return null;

  if (options.returnMetadata) {
    return {
      parsed,
      text: result.text,
      usage: result.usage,
      stopReason: result.stopReason,
      id: result.id,
      model: result.model,
    };
  }

  return parsed;
}

async function callZaiJson(options = {}) {
  const result = await callZaiInternal(options);
  if (!result) return null;

  const parsed = parseClaudeJson(result.text);
  if (parsed === null) return null;

  if (options.returnMetadata) {
    return {
      parsed,
      text: result.text,
      usage: result.usage,
      stopReason: result.stopReason,
      id: result.id,
      model: result.model,
    };
  }

  return parsed;
}

module.exports = {
  isAvailable,
  getGatewayConfig,
  isGatewayConfigured,
  describeInferenceAvailability,
  callGatewayInternal,
  buildGatewayMessages,
  callClaude,
  callClaudeJson,
  callZaiJson,
  getZaiApiKey,
  getZaiBaseUrl,
  getZaiModel,
  stripCodeFences,
  parseClaudeJson,
  normalizeCacheOptions,
  buildClaudeRequest,
  buildSafeProviderError,
  normalizeUsageTelemetry,
  buildLlmTrace,
  emitLlmTrace,
  MODELS,
};
