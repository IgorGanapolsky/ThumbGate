#!/usr/bin/env node
'use strict';

const DEFAULT_ENDPOINT = 'https://api.oraclestechnologies.com/v1/guardian/analyze';

function requireApiKey(env = process.env) {
  const key = env.ETHICORE_API_KEY || env.GUARDIAN_API_KEY || env.ORACLES_GUARDIAN_API_KEY;
  if (!key) {
    throw new Error('ETHICORE_API_KEY env var is required');
  }
  return key;
}

async function analyzeText(text, options = {}) {
  if (!String(text || '').trim()) {
    throw new Error('analyzeText requires text');
  }

  const env = options.env || process.env;
  const endpoint = options.endpoint || env.ETHICORE_GUARDIAN_ENDPOINT || DEFAULT_ENDPOINT;
  const apiKey = options.apiKey || requireApiKey(env);
  const fetchImpl = options.fetch || fetch;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  const bodyText = await response.text();
  let body = bodyText;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    // Keep non-JSON body for diagnostics.
  }

  if (!response.ok) {
    throw new Error(`Ethicore Guardian API ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return body;
}

function createEthicorePolicyCheck(options = {}) {
  return async function ethicorePolicyCheck(action = {}) {
    const toolText = [
      action.toolName,
      action.actionType,
      action.command,
      action.path,
      action.url,
      action.input ? JSON.stringify(action.input) : '',
    ].filter(Boolean).join('\n');

    return analyzeText(toolText || JSON.stringify(action), options);
  };
}

module.exports = {
  DEFAULT_ENDPOINT,
  analyzeText,
  createEthicorePolicyCheck,
  requireApiKey,
};
