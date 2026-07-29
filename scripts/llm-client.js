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
const DEFAULT_LLM_TIMEOUT_MS = 30000;
const MAX_LLM_RETRIES = 2;

let _anthropicClient = null;
let _geminiClient = null;

function normalizeLlmTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LLM_TIMEOUT_MS;
  return Math.max(1000, Math.min(120000, Math.floor(parsed)));
}

function normalizeLlmRetries(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(MAX_LLM_RETRIES, Math.floor(parsed)));
}

async function withTimeout(promise, timeoutMs, label = 'LLM request') {
  const bounded = normalizeLlmTimeout(timeoutMs);
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label} timed out after ${bounded}ms`);
          error.code = 'ETIMEDOUT';
          error.retryable = true;
          reject(error);
        }, bounded);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
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
  if (!apiKey || typeof fetch !== 'function') return null;

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
        model: options.model || getZaiModel(env),
        messages,
        max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: Number.isFinite(options.temperature) ? options.temperature : 0,
      }),
    });

    if (!response.ok) return null;
    const json = await response.json();
    return {
      text: stripCodeFences(json?.choices?.[0]?.message?.content || ''),
      usage: json?.usage || null,
      stopReason: json?.choices?.[0]?.finish_reason || null,
      id: json?.id || null,
      model: json?.model || options.model || getZaiModel(env),
    };
  } catch {
    return null;
  }
}

async function callGeminiInternal(options = {}) {
  const env = process.env;
  const { detectInferenceBackend } = require('./local-model-profile');
  const providerMode = detectInferenceBackend(env).providerMode;

  if (providerMode !== 'vertex' && !env.GEMINI_API_KEY) return null;

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
      retries: normalizeLlmRetries(options.retries),
      logger: (msg) => console.warn(msg),
    }, async () => withTimeout(
      _geminiClient.models.generateContent({
        model: options.model,
        contents,
        config,
      }),
      options.timeoutMs,
      'Gemini request',
    ));

    return {
      text: response.text || '',
      usage: response.usageMetadata ? {
        input_tokens: response.usageMetadata.promptTokenCount,
        output_tokens: response.usageMetadata.candidatesTokenCount,
      } : null,
      stopReason: response.candidates?.[0]?.finishReason || null,
      id: null,
      model: options.model,
    };
  } catch (err) {
    console.error('Gemini/Vertex AI execution error:', JSON.stringify(buildSafeProviderError(err)));
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
  if (!client) return null;

  try {
    const response = await runStep('llm.callClaude', {
      retries: normalizeLlmRetries(options.retries),
      logger: (msg) => console.warn(msg),
    }, async () => withTimeout(
      client.messages.create(buildClaudeRequest(options)),
      options.timeoutMs,
      'Anthropic request',
    ));

    const text = stripCodeFences(extractTextContent(response));
    return {
      text,
      usage: response?.usage || null,
      stopReason: response?.stop_reason || null,
      id: response?.id || null,
      model: response?.model || options.model || DEFAULT_MODEL,
    };
  } catch {
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

  let parsed = parseClaudeJson(result.text);
  let validation = validateParsedJson(parsed, options.outputSchema);
  let repaired = false;
  let repairAttempted = false;
  let finalResult = result;

  if (!validation.valid && options.outputSchema && options.repair !== false) {
    repairAttempted = true;
    const repair = await callClaudeInternal({
      ...options,
      messages: undefined,
      retries: 0,
      userPrompt: buildJsonRepairPrompt(
        result.text,
        options.outputSchema,
        validation.errors,
      ),
    });
    if (repair) {
      const repairedParsed = parseClaudeJson(repair.text);
      const repairedValidation = validateParsedJson(repairedParsed, options.outputSchema);
      if (repairedValidation.valid) {
        parsed = repairedParsed;
        validation = repairedValidation;
        repaired = true;
        finalResult = repair;
      } else {
        validation = repairedValidation;
      }
    }
  }

  if (!validation.valid) return null;

  if (options.returnMetadata) {
    return {
      parsed,
      text: finalResult.text,
      usage: finalResult.usage,
      stopReason: finalResult.stopReason,
      id: finalResult.id,
      model: finalResult.model,
      structuredValidation: validation,
      structuredRepairAttempted: repairAttempted,
      structuredRepairSucceeded: repaired,
    };
  }

  return parsed;
}

function validateParsedJson(parsed, schema) {
  if (parsed === null) return { valid: false, errors: ['invalid_json'], value: null };
  if (!schema) return { valid: true, errors: [], value: parsed };
  const { validateStructuredOutput } = require('./tool-contract-validator');
  return validateStructuredOutput(parsed, schema);
}

function buildJsonRepairPrompt(text, schema, errors = []) {
  return [
    'Repair the response into JSON that satisfies the schema.',
    'Do not add facts. Return only the repaired JSON.',
    `Schema: ${JSON.stringify(schema).slice(0, 8000)}`,
    `Validation errors: ${JSON.stringify(errors).slice(0, 2000)}`,
    `Response: ${String(text || '').slice(0, 6000)}`,
  ].join('\n');
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
  buildJsonRepairPrompt,
  validateParsedJson,
  withTimeout,
  normalizeLlmRetries,
  normalizeLlmTimeout,
  MODELS,
};
