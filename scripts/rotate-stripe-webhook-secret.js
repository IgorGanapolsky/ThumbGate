#!/usr/bin/env node
'use strict';

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_ENDPOINT_URL = 'https://thumbgate-production.up.railway.app/v1/billing/webhook';
const REQUIRED_EVENTS = ['checkout.session.completed', 'customer.subscription.deleted'];
const FIXED_GH_BINARIES = ['/usr/bin/gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh'];
const SECRET_PATTERN = /\b(?:sk|rk)_(?:live|test)_\w+|\bwhsec_\w+/g;

function redact(value) {
  return String(value || '').replaceAll(SECRET_PATTERN, '[REDACTED]');
}

function encodeForm(params) {
  const pairs = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const arrayKey = `${key}[]`;
        pairs.push(`${encodeURIComponent(arrayKey)}=${encodeURIComponent(String(item))}`);
      }
      continue;
    }
    if (value !== undefined && value !== null) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs.join('&');
}

function assertLiveStripeKey(apiKey, requireLive = true) {
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is required.');
  }
  if (requireLive && !/^(sk|rk)_live_/.test(apiKey)) {
    throw new Error('Refusing to rotate production webhook with a non-live Stripe key.');
  }
}

function stripeRequest({ method = 'GET', path, apiKey, body, request = https.request }) {
  return new Promise((resolve, reject) => {
    const payload = body ? encodeForm(body) : '';
    const req = request({
      hostname: 'api.stripe.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          reject(new Error(`Stripe returned non-JSON response (${res.statusCode}): ${redact(raw)}`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = parsed.error?.message ? parsed.error.message : raw;
          reject(new Error(`Stripe API ${method} ${path} failed (${res.statusCode}): ${redact(message)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function listWebhookEndpoints(apiKey, options = {}) {
  const requestStripe = options.stripeRequest || stripeRequest;
  const endpoints = [];
  let startingAfter = '';
  for (;;) {
    const suffix = startingAfter
      ? `&starting_after=${encodeURIComponent(startingAfter)}`
      : '';
    const response = await requestStripe({
      apiKey,
      path: `/v1/webhook_endpoints?limit=100${suffix}`,
    });
    endpoints.push(...(Array.isArray(response.data) ? response.data : []));
    if (!response.has_more || endpoints.length === 0) {
      return endpoints;
    }
    startingAfter = endpoints.at(-1).id;
  }
}

async function createWebhookEndpoint({ apiKey, endpointUrl, timestamp, stripeRequest: requestStripe = stripeRequest }) {
  const endpoint = await requestStripe({
    method: 'POST',
    path: '/v1/webhook_endpoints',
    apiKey,
    body: {
      url: endpointUrl,
      enabled_events: REQUIRED_EVENTS,
      description: `ThumbGate billing webhook rotated ${timestamp}`,
    },
  });
  if (!endpoint.id || !endpoint.secret) {
    throw new Error('Stripe webhook endpoint creation did not return both id and signing secret.');
  }
  return endpoint;
}

async function disableWebhookEndpoint({ apiKey, endpointId, stripeRequest: requestStripe = stripeRequest }) {
  return requestStripe({
    method: 'POST',
    path: `/v1/webhook_endpoints/${encodeURIComponent(endpointId)}`,
    apiKey,
    body: { disabled: true },
  });
}

function resolveGhBinary(options = {}) {
  const accessSync = options.accessSync || fs.accessSync;
  const candidates = options.candidates || FIXED_GH_BINARIES;

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next fixed, system-owned path.
    }
  }

  throw new Error(`Unable to locate GH CLI in fixed paths: ${candidates.join(', ')}`);
}

function runGh(args, { token, input, ghBinary, accessSync, spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl(ghBinary || resolveGhBinary({ accessSync }), args, {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_TOKEN: token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
    },
  });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${redact(result.stderr || result.stdout)}`);
  }
  return result.stdout.trim();
}

function getSecretUpdatedAt({ repo, token, secretName, runner = runGh }) {
  return runner([
    'api',
    `repos/${repo}/actions/secrets/${secretName}`,
    '--jq',
    '.updated_at',
  ], { token });
}

function setGithubSecret({ repo, token, name, value, runner = runGh }) {
  runner(['secret', 'set', name, '--repo', repo], { token, input: value });
}

function setGithubVariable({ repo, token, name, value, runner = runGh }) {
  runner(['variable', 'set', name, '--repo', repo, '--body', value], { token });
}

function findSameUrlEndpoints(endpoints, endpointUrl, excludeId) {
  return endpoints.filter((endpoint) => endpoint?.id
    && endpoint.id !== excludeId
    && endpoint?.url === endpointUrl
    && endpoint?.status !== 'disabled');
}

function resolveRequireLiveStripeKey(options) {
  if (Object.hasOwn(options, 'requireLive')) {
    return options.requireLive;
  }
  const envModes = {
    false: false,
    true: true,
  };
  return envModes[process.env.REQUIRE_LIVE_STRIPE_KEY] ?? true;
}

async function rotateStripeWebhookSecret(options = {}) {
  const endpointUrl = options.endpointUrl || process.env.STRIPE_WEBHOOK_ENDPOINT_URL || DEFAULT_ENDPOINT_URL;
  const repo = options.repo || process.env.GITHUB_REPOSITORY;
  const stripeKey = options.stripeKey || process.env.STRIPE_SECRET_KEY;
  const githubToken = options.githubToken || process.env.GH_ADMIN_TOKEN || process.env.THUMBGATE_MAINTENANCE_GH_TOKEN;
  const timestamp = options.timestamp || new Date().toISOString();
  const requireLive = resolveRequireLiveStripeKey(options);
  const dryRun = options.dryRun === true || process.env.DRY_RUN === 'true';
  const stripe = {
    listWebhookEndpoints: options.listWebhookEndpoints || listWebhookEndpoints,
    createWebhookEndpoint: options.createWebhookEndpoint || createWebhookEndpoint,
    disableWebhookEndpoint: options.disableWebhookEndpoint || disableWebhookEndpoint,
  };
  const github = {
    getSecretUpdatedAt: options.getSecretUpdatedAt || getSecretUpdatedAt,
    setGithubSecret: options.setGithubSecret || setGithubSecret,
    setGithubVariable: options.setGithubVariable || setGithubVariable,
  };

  assertLiveStripeKey(stripeKey, requireLive);
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is required.');
  }
  if (dryRun || githubToken) {
    // Dry runs only need Stripe read access; real rotations also need GitHub secret write access.
  } else {
    throw new Error('THUMBGATE_MAINTENANCE_GH_TOKEN is required to update GitHub Secrets and Variables.');
  }

  const before = await stripe.listWebhookEndpoints(stripeKey);
  const replacementCandidates = findSameUrlEndpoints(before, endpointUrl);
  if (dryRun) {
    return {
      dryRun: true,
      endpointUrl,
      matchingEnabledEndpoints: replacementCandidates.map((endpoint) => endpoint.id),
      requiredEvents: REQUIRED_EVENTS,
    };
  }

  const endpoint = await stripe.createWebhookEndpoint({ apiKey: stripeKey, endpointUrl, timestamp });
  github.setGithubSecret({
    repo,
    token: githubToken,
    name: 'STRIPE_WEBHOOK_SECRET',
    value: endpoint.secret,
  });
  github.setGithubVariable({
    repo,
    token: githubToken,
    name: 'STRIPE_WEBHOOK_SECRET_ROTATED_AT',
    value: timestamp,
  });

  const stripeSecretUpdatedAt = github.getSecretUpdatedAt({
    repo,
    token: githubToken,
    secretName: 'STRIPE_SECRET_KEY',
  });
  if (stripeSecretUpdatedAt) {
    github.setGithubVariable({
      repo,
      token: githubToken,
      name: 'STRIPE_SECRET_KEY_ROTATED_AT',
      value: stripeSecretUpdatedAt,
    });
  }

  const disabledEndpointIds = [];
  for (const oldEndpoint of findSameUrlEndpoints(before, endpointUrl, endpoint.id)) {
    await stripe.disableWebhookEndpoint({ apiKey: stripeKey, endpointId: oldEndpoint.id });
    disabledEndpointIds.push(oldEndpoint.id);
  }

  return {
    dryRun: false,
    endpointUrl,
    newEndpointId: endpoint.id,
    disabledEndpointIds,
    requiredEvents: REQUIRED_EVENTS,
    rotatedAt: timestamp,
    stripeSecretKeyRotatedAt: stripeSecretUpdatedAt || null,
  };
}

async function main() {
  try {
    const result = await rotateStripeWebhookSecret();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${redact(err?.message ? err.message : err)}\n`);
    process.exit(1);
  }
}

function isCliInvocation(argv = process.argv) {
  return path.resolve(argv[1] || '') === __filename;
}

if (isCliInvocation()) {
  main();
}

module.exports = {
  DEFAULT_ENDPOINT_URL,
  REQUIRED_EVENTS,
  assertLiveStripeKey,
  createWebhookEndpoint,
  disableWebhookEndpoint,
  encodeForm,
  findSameUrlEndpoints,
  getSecretUpdatedAt,
  listWebhookEndpoints,
  redact,
  resolveGhBinary,
  resolveRequireLiveStripeKey,
  rotateStripeWebhookSecret,
  runGh,
  setGithubSecret,
  setGithubVariable,
  stripeRequest,
};
