#!/usr/bin/env node
'use strict';

const { runStep } = require('./durability/step');

const MODELS = {
  FAST: 'claude-haiku-4-5-20251001',
  SMART: 'claude-sonnet-4-6',
};

const DEFAULT_MODEL = MODELS.FAST;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_CACHE_TTL = '5m';

let _client = null;

function isAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (_client) return _client;
  if (!isAvailable()) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic();
    return _client;
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

async function callClaudeInternal(options = {}) {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await runStep('llm.callClaude', {
      retries: 2,
      logger: (msg) => console.warn(msg),
    }, async () => client.messages.create(buildClaudeRequest(options)));

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
  stripCodeFences,
  parseClaudeJson,
  normalizeCacheOptions,
  buildClaudeRequest,
  MODELS,
};
