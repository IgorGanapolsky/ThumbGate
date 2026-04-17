#!/usr/bin/env node
'use strict';

const { runStep } = require('./durability/step');

const MODELS = {
  FAST: 'claude-haiku-4-5-20251001',
  SMART: 'claude-sonnet-4-6',
};

const DEFAULT_MODEL = MODELS.FAST;
const DEFAULT_MAX_TOKENS = 1024;

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

// Anthropic SDK throws errors with a `.status` field for HTTP failures.
// Our defaultClassify already reads `.status`, so 429/5xx retry and 4xx
// (bad request / unauthorized / not-found) bail immediately — which is
// what we want: there is no point retrying a malformed prompt or a
// revoked API key.
async function callClaude({ systemPrompt, userPrompt, model, maxTokens } = {}) {
  const client = getClient();
  if (!client) return null;

  try {
    const text = await runStep('llm.callClaude', {
      retries: 2,
      logger: (msg) => console.warn(msg),
    }, async () => {
      const response = await client.messages.create({
        model: model || DEFAULT_MODEL,
        max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
        system: systemPrompt || undefined,
        messages: [{ role: 'user', content: userPrompt }],
      });

      return response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
    });

    return stripCodeFences(text);
  } catch {
    // Preserve the original callClaude contract — callers expect `null` on
    // failure, not an exception. runStep already logged retry attempts,
    // so the permanent failure is visible in logs.
    return null;
  }
}

module.exports = { isAvailable, callClaude, stripCodeFences, MODELS };
