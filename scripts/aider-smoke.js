#!/usr/bin/env node
'use strict';

const {
  assertLinkedWorktree,
  loadEnvFiles,
  resolveTarget,
  resolveTargetConfig,
} = require('./aider-launch');

function buildChatCompletionsUrl(apiBase) {
  const trimmed = apiBase.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

function buildSmokeRequest(targetName, env = process.env) {
  const target = resolveTarget(targetName);
  const config = resolveTargetConfig(target, env);
  const url = buildChatCompletionsUrl(config.apiBase);

  return {
    config,
    url,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      'http-referer': 'https://github.com/IgorGanapolsky/thumbgate',
      'x-title': 'ThumbGate Aider Smoke',
    },
    body: {
      model: config.model,
      messages: [{ role: 'user', content: 'Reply with the single word pong.' }],
      max_tokens: 16,
      temperature: 0,
    },
  };
}

async function runSmoke(targetName, env = process.env, fetchImpl = globalThis.fetch) {
  const request = buildSmokeRequest(targetName, env);
  const response = await fetchImpl(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  const responseText = await response.text();

  if (!response.ok) {
    console.error(`Aider smoke failed for ${request.config.target} (${response.status}).`);
    console.error(responseText);
    process.exitCode = 1;
    return { ok: false, status: response.status, text: responseText };
  }

  console.log(responseText);
  return { ok: true, status: response.status, text: responseText };
}

async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  assertLinkedWorktree(cwd);
  const target = resolveTarget(argv[0]);
  const env = loadEnvFiles({ cwd, env: process.env });

  if (!env.OPENROUTER_API_KEY && !env.AIDER_API_KEY && !env.LITELLM_MASTER_KEY && !env.OPENAI_API_KEY) {
    throw new Error(`No API key configured for Aider smoke target \`${target}\`.`);
  }

  const result = await runSmoke(target, env);
  if (!result.ok) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildChatCompletionsUrl,
  buildSmokeRequest,
  runSmoke,
};
