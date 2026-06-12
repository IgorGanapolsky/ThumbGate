'use strict';

// LLM client: Portkey gateway (interview environment) first, Anthropic API fallback.
// Both are exercised through one chat(messages, opts) surface so the rest of the
// pipeline never knows which transport answered.

const PORTKEY_BASE_URL = process.env.PORTKEY_BASE_URL || 'https://portkeygateway.perficient.com/v1';
const PORTKEY_MODEL =
  process.env.PORTKEY_MODEL || '@aws-bedrock-use2/us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

function activeProvider() {
  if (process.env.PORTKEY_API_KEY) return 'portkey';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

async function chatViaPortkey(messages, { maxTokens, temperature }) {
  const res = await fetch(`${PORTKEY_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-portkey-api-key': process.env.PORTKEY_API_KEY,
    },
    body: JSON.stringify({
      model: PORTKEY_MODEL,
      max_tokens: maxTokens,
      temperature,
      messages,
    }),
  });
  if (!res.ok) {
    throw new Error(`Portkey gateway error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function chatViaAnthropic(messages, { maxTokens, temperature }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  const res = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    temperature,
    ...(system ? { system } : {}),
    messages: rest,
  });
  return res.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

async function chat(messages, opts = {}) {
  const options = { maxTokens: opts.maxTokens || 1024, temperature: opts.temperature ?? 0 };
  const provider = activeProvider();
  if (provider === 'portkey') return chatViaPortkey(messages, options);
  if (provider === 'anthropic') return chatViaAnthropic(messages, options);
  throw new Error('No LLM credentials: set PORTKEY_API_KEY or ANTHROPIC_API_KEY');
}

module.exports = { chat, activeProvider };
