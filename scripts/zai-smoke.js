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
  return {
    json: argv.includes('--json'),
    requireKey: argv.includes('--require-key'),
  };
}

async function run(options = {}) {
  loadDotEnv();
  const { callZaiJson, getZaiApiKey, getZaiBaseUrl, getZaiModel } = require('./llm-client');
  const apiKey = getZaiApiKey();
  const baseUrl = getZaiBaseUrl();
  const model = getZaiModel();

  if (!apiKey) {
    const result = {
      ok: false,
      status: 'missing_key',
      provider: 'zai',
      model,
      baseUrl,
      message: 'Set ZAI_API_KEY or THUMBGATE_ZAI_API_KEY in local .env or shell. Do not commit it.',
    };
    if (options.requireKey) process.exitCode = 1;
    return result;
  }

  const result = await callZaiJson({
    systemPrompt: 'Return only compact JSON.',
    userPrompt: 'Return {"ok":true,"provider":"zai","use":"thumbgate"}',
    maxTokens: 80,
    temperature: 0,
    returnMetadata: true,
  });

  if (!result || result.parsed?.ok !== true) {
    process.exitCode = 1;
    return {
      ok: false,
      status: 'request_failed',
      provider: 'zai',
      model,
      baseUrl,
    };
  }

  return {
    ok: true,
    status: 'ready',
    provider: 'zai',
    model: result.model || model,
    baseUrl,
    parsed: result.parsed,
    usage: result.usage || null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await run(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Z.ai smoke status: ${result.status}`);
  console.log(`Provider: ${result.provider}`);
  console.log(`Model: ${result.model}`);
  console.log(`Base URL: ${result.baseUrl}`);
  if (result.ok) {
    console.log('Result: ready');
  } else {
    console.log(`Result: ${result.message || 'not ready'}`);
  }
}

if (require.main?.filename === __filename) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  loadDotEnv,
  parseArgs,
  run,
};
