#!/usr/bin/env node
'use strict';

/**
 * remote-feedback-capture.js
 *
 * Hosted capture path for unattended/cloud agents when the Mac-local
 * lessons store is missing. POSTs to THUMBGATE_API_BASE_URL/v1/feedback/capture
 * with Bearer THUMBGATE_API_KEY.
 */

const path = require('node:path');

const DEFAULT_PATH = '/v1/feedback/capture';

function resolveBaseUrl(env = process.env) {
  return String(env.THUMBGATE_API_BASE_URL || env.THUMBGATE_API_URL || '').trim().replace(/\/$/, '');
}

function resolveApiKey(env = process.env) {
  return String(env.THUMBGATE_API_KEY || '').trim();
}

function isRemoteCaptureConfigured(env = process.env) {
  return Boolean(resolveBaseUrl(env) && resolveApiKey(env));
}

/**
 * @param {object} params
 * @param {string} params.signal - up|down|positive|negative
 * @param {string} params.context
 * @param {string} [params.whatWentWrong]
 * @param {string} [params.whatToChange]
 * @param {string} [params.whatWorked]
 * @param {string[]|string} [params.tags]
 * @param {typeof fetch} [params.fetchImpl]
 * @param {object} [params.env]
 */
async function captureFeedbackRemote(params = {}) {
  const env = params.env || process.env;
  const base = resolveBaseUrl(env);
  const key = resolveApiKey(env);
  if (!base || !key) {
    return {
      ok: false,
      error: 'remote_capture_not_configured',
      message: 'Set THUMBGATE_API_BASE_URL and THUMBGATE_API_KEY for hosted capture.',
    };
  }

  const tags = Array.isArray(params.tags)
    ? params.tags
    : String(params.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  const body = {
    signal: params.signal || params.feedback || 'down',
    context: params.context || '',
    whatWentWrong: params.whatWentWrong || null,
    whatToChange: params.whatToChange || null,
    whatWorked: params.whatWorked || null,
    tags,
    source: params.source || 'remote-feedback-capture',
  };

  const fetchImpl = params.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch_unavailable', message: 'global fetch is not available' };
  }

  const url = `${base}${DEFAULT_PATH}`;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(params.timeoutMs || 20000),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: 'remote_capture_http_error',
        status: response.status,
        body: json,
      };
    }
    return { ok: true, status: response.status, body: json };
  } catch (err) {
    return {
      ok: false,
      error: 'remote_capture_network_error',
      message: err && err.message ? err.message : String(err),
    };
  }
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.length ? rest.join('=') : true;
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node scripts/remote-feedback-capture.js --feedback=down --context="..." [--what-went-wrong=...] [--tags=a,b]');
    process.exit(0);
  }
  const result = await captureFeedbackRemote({
    signal: args.feedback || args.signal || 'down',
    context: args.context || '',
    whatWentWrong: args['what-went-wrong'],
    whatToChange: args['what-to-change'],
    whatWorked: args['what-worked'],
    tags: args.tags,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

if (pathResolveMain()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

function pathResolveMain() {
  try {
    return require('node:path').resolve(process.argv[1] || '') === require('node:path').resolve(__filename);
  } catch {
    return false;
  }
}

module.exports = {
  captureFeedbackRemote,
  isRemoteCaptureConfigured,
  parseArgs,
  resolveBaseUrl,
  resolveApiKey,
};
