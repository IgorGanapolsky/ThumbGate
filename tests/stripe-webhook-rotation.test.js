'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
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
} = require('../scripts/rotate-stripe-webhook-secret');

function withEnv(name, value, fn) {
  const original = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
}

function createStripeRequestMock(responses) {
  const calls = [];
  const queue = [...responses];
  const request = (options, onResponse) => {
    const req = new EventEmitter();
    req.end = (payload) => {
      calls.push({ options, payload });
      const response = queue.shift();
      if (response.error) {
        req.emit('error', response.error);
        return;
      }
      const res = new EventEmitter();
      res.statusCode = response.statusCode || 200;
      res.setEncoding = () => {};
      onResponse(res);
      if (response.body !== undefined) {
        res.emit('data', response.body);
      }
      res.emit('end');
    };
    return req;
  };

  return { calls, request };
}

test('stripe webhook rotation form encoding keeps array fields compatible with Stripe', () => {
  const encoded = encodeForm({
    url: DEFAULT_ENDPOINT_URL,
    enabled_events: REQUIRED_EVENTS,
    description: 'ThumbGate billing webhook',
  });

  assert.match(encoded, /url=https%3A%2F%2Fthumbgate\.ai%2Fv1%2Fbilling%2Fwebhook/);
  assert.match(encoded, /enabled_events%5B%5D=checkout\.session\.completed/);
  assert.match(encoded, /enabled_events%5B%5D=customer\.subscription\.deleted/);
  assert.match(encoded, /description=ThumbGate%20billing%20webhook/);
});

test('stripe webhook rotation refuses non-live keys by default', () => {
  assert.doesNotThrow(() => assertLiveStripeKey('sk_live_example'));
  assert.doesNotThrow(() => assertLiveStripeKey('rk_live_example'));
  assert.throws(() => assertLiveStripeKey(''), /STRIPE_SECRET_KEY is required/);
  assert.throws(() => assertLiveStripeKey('sk_test_example'), /non-live Stripe key/);
  assert.doesNotThrow(() => assertLiveStripeKey('sk_test_example', false));
});

test('stripe webhook rotation finds enabled endpoints for the exact billing URL only', () => {
  const endpoints = [
    { id: 'we_keep', url: DEFAULT_ENDPOINT_URL, status: 'enabled' },
    { id: 'we_disabled', url: DEFAULT_ENDPOINT_URL, status: 'disabled' },
    { id: 'we_other', url: 'https://example.com/webhook', status: 'enabled' },
    { id: 'we_new', url: DEFAULT_ENDPOINT_URL, status: 'enabled' },
  ];

  assert.deepEqual(
    findSameUrlEndpoints(endpoints, DEFAULT_ENDPOINT_URL, 'we_new').map((endpoint) => endpoint.id),
    ['we_keep'],
  );
});

test('stripe webhook rotation redacts secret material from errors', () => {
  assert.equal(redact('failed with sk_live_abc123 and whsec_def456'), 'failed with [REDACTED] and [REDACTED]');
});

test('stripe webhook rotation resolves live-key policy from options before env', () => {
  assert.equal(withEnv('REQUIRE_LIVE_STRIPE_KEY', undefined, () => resolveRequireLiveStripeKey({})), true);
  assert.equal(withEnv('REQUIRE_LIVE_STRIPE_KEY', 'false', () => resolveRequireLiveStripeKey({})), false);
  assert.equal(withEnv('REQUIRE_LIVE_STRIPE_KEY', 'true', () => resolveRequireLiveStripeKey({})), true);
  assert.equal(withEnv('REQUIRE_LIVE_STRIPE_KEY', 'false', () => resolveRequireLiveStripeKey({ requireLive: true })), true);
});

test('stripe webhook rotation resolves gh from fixed executable paths only', () => {
  const visited = [];
  const accessSync = (candidate, mode) => {
    visited.push([candidate, mode]);
    if (candidate !== '/usr/local/bin/gh') {
      throw new Error('missing');
    }
  };

  assert.equal(resolveGhBinary({ accessSync }), '/usr/local/bin/gh');
  assert.deepEqual(visited.map(([candidate]) => candidate), ['/usr/bin/gh', '/usr/local/bin/gh']);
  assert.throws(
    () => resolveGhBinary({ accessSync: () => { throw new Error('missing'); }, candidates: ['/fixed/gh'] }),
    /Unable to locate GH CLI/
  );
});

test('stripe webhook rotation gh wrapper injects token and redacts failures', () => {
  const calls = [];
  const stdout = runGh(['api', 'repos/example/actions/secrets/STRIPE_SECRET_KEY'], {
    ghBinary: '/usr/bin/gh',
    token: 'ghs_example',
    spawnSyncImpl: (binary, args, options) => {
      calls.push({ binary, args, options });
      return { status: 0, stdout: 'ok\n', stderr: '' };
    },
  });

  assert.equal(stdout, 'ok');
  assert.equal(calls[0].binary, '/usr/bin/gh');
  assert.equal(calls[0].options.env.GH_TOKEN, 'ghs_example');

  assert.throws(
    () => runGh(['secret', 'set', 'STRIPE_WEBHOOK_SECRET'], {
      ghBinary: '/usr/bin/gh',
      spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: 'bad whsec_secret sk_live_secret' }),
    }),
    /bad \[REDACTED\] \[REDACTED\]/
  );
});

test('stripe webhook rotation GitHub helpers delegate to the gh runner', () => {
  const calls = [];
  const runner = (args, options) => {
    calls.push({ args, options });
    return '2026-03-30T19:16:21Z';
  };

  assert.equal(
    getSecretUpdatedAt({
      repo: 'IgorGanapolsky/ThumbGate',
      token: 'ghs_example',
      secretName: 'STRIPE_SECRET_KEY',
      runner,
    }),
    '2026-03-30T19:16:21Z'
  );
  setGithubSecret({
    repo: 'IgorGanapolsky/ThumbGate',
    token: 'ghs_example',
    name: 'STRIPE_WEBHOOK_SECRET',
    value: 'whsec_new',
    runner,
  });
  setGithubVariable({
    repo: 'IgorGanapolsky/ThumbGate',
    token: 'ghs_example',
    name: 'STRIPE_WEBHOOK_SECRET_ROTATED_AT',
    value: '2026-04-13T16:00:00.000Z',
    runner,
  });

  assert.deepEqual(calls.map((call) => call.args[0]), ['api', 'secret', 'variable']);
  assert.equal(calls[1].options.input, 'whsec_new');
});

test('stripe webhook rotation Stripe request handles success, API errors, non-JSON, and network errors', async () => {
  const success = createStripeRequestMock([
    { statusCode: 200, body: JSON.stringify({ ok: true }) },
  ]);
  assert.deepEqual(
    await stripeRequest({
      method: 'POST',
      path: '/v1/test',
      apiKey: 'sk_test_example',
      body: { enabled_events: REQUIRED_EVENTS },
      request: success.request,
    }),
    { ok: true }
  );
  assert.equal(success.calls[0].options.hostname, 'api.stripe.com');
  assert.match(success.calls[0].payload, /enabled_events%5B%5D=checkout\.session\.completed/);

  const apiError = createStripeRequestMock([
    { statusCode: 400, body: JSON.stringify({ error: { message: 'bad sk_live_secret' } }) },
  ]);
  await assert.rejects(
    () => stripeRequest({ path: '/v1/fail', apiKey: 'sk_test_example', request: apiError.request }),
    /bad \[REDACTED\]/
  );

  const nonJson = createStripeRequestMock([
    { statusCode: 200, body: 'not json whsec_secret' },
  ]);
  await assert.rejects(
    () => stripeRequest({ path: '/v1/non-json', apiKey: 'sk_test_example', request: nonJson.request }),
    /non-JSON response \(200\): not json \[REDACTED\]/
  );

  const network = createStripeRequestMock([{ error: new Error('socket closed') }]);
  await assert.rejects(
    () => stripeRequest({ path: '/v1/network', apiKey: 'sk_test_example', request: network.request }),
    /socket closed/
  );
});

test('stripe webhook rotation Stripe helpers paginate, create, and disable endpoints', async () => {
  const listCalls = [];
  const pages = [
    { data: [{ id: 'we_1' }], has_more: true },
    { data: [{ id: 'we_2' }], has_more: false },
  ];
  const listed = await listWebhookEndpoints('sk_test_example', {
    stripeRequest: async (request) => {
      listCalls.push(request.path);
      return pages.shift();
    },
  });
  assert.deepEqual(listed.map((endpoint) => endpoint.id), ['we_1', 'we_2']);
  assert.equal(listCalls[1], '/v1/webhook_endpoints?limit=100&starting_after=we_1');

  const created = await createWebhookEndpoint({
    apiKey: 'sk_test_example',
    endpointUrl: DEFAULT_ENDPOINT_URL,
    timestamp: '2026-04-13T16:00:00.000Z',
    stripeRequest: async (request) => {
      assert.equal(request.method, 'POST');
      assert.equal(request.path, '/v1/webhook_endpoints');
      assert.deepEqual(request.body.enabled_events, REQUIRED_EVENTS);
      return { id: 'we_new', secret: 'whsec_new' };
    },
  });
  assert.equal(created.id, 'we_new');

  await assert.rejects(
    () => createWebhookEndpoint({
      apiKey: 'sk_test_example',
      endpointUrl: DEFAULT_ENDPOINT_URL,
      timestamp: '2026-04-13T16:00:00.000Z',
      stripeRequest: async () => ({ id: 'we_new' }),
    }),
    /did not return both id and signing secret/
  );

  const disabled = await disableWebhookEndpoint({
    apiKey: 'sk_test_example',
    endpointId: 'we_old/unsafe',
    stripeRequest: async (request) => {
      assert.equal(request.path, '/v1/webhook_endpoints/we_old%2Funsafe');
      assert.deepEqual(request.body, { disabled: true });
      return { id: 'we_old/unsafe', status: 'disabled' };
    },
  });
  assert.equal(disabled.status, 'disabled');
});

test('stripe webhook rotation dry run reports matching endpoints without GitHub writes', async () => {
  const result = await rotateStripeWebhookSecret({
    repo: 'IgorGanapolsky/ThumbGate',
    stripeKey: 'sk_test_example',
    requireLive: false,
    dryRun: true,
    listWebhookEndpoints: async () => [
      { id: 'we_keep', url: DEFAULT_ENDPOINT_URL, status: 'enabled' },
      { id: 'we_disabled', url: DEFAULT_ENDPOINT_URL, status: 'disabled' },
      { id: 'we_other', url: 'https://example.com/webhook', status: 'enabled' },
    ],
  });

  assert.deepEqual(result, {
    dryRun: true,
    endpointUrl: DEFAULT_ENDPOINT_URL,
    matchingEnabledEndpoints: ['we_keep'],
    requiredEvents: REQUIRED_EVENTS,
  });
});

test('stripe webhook rotation creates a new endpoint, stores secret metadata, and disables old endpoints', async () => {
  const githubCalls = [];
  const disabled = [];

  const result = await rotateStripeWebhookSecret({
    repo: 'IgorGanapolsky/ThumbGate',
    stripeKey: 'sk_live_example',
    githubToken: 'ghs_example',
    timestamp: '2026-04-13T16:00:00.000Z',
    listWebhookEndpoints: async () => [
      { id: 'we_old', url: DEFAULT_ENDPOINT_URL, status: 'enabled' },
      { id: 'we_disabled', url: DEFAULT_ENDPOINT_URL, status: 'disabled' },
    ],
    createWebhookEndpoint: async ({ apiKey, endpointUrl, timestamp }) => {
      assert.equal(apiKey, 'sk_live_example');
      assert.equal(endpointUrl, DEFAULT_ENDPOINT_URL);
      assert.equal(timestamp, '2026-04-13T16:00:00.000Z');
      return { id: 'we_new', secret: 'whsec_new' };
    },
    disableWebhookEndpoint: async ({ endpointId }) => {
      disabled.push(endpointId);
      return { id: endpointId, status: 'disabled' };
    },
    setGithubSecret: (call) => githubCalls.push({ type: 'secret', ...call }),
    setGithubVariable: (call) => githubCalls.push({ type: 'variable', ...call }),
    getSecretUpdatedAt: (call) => {
      githubCalls.push({ type: 'getSecret', ...call });
      return '2026-03-30T19:16:21Z';
    },
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.newEndpointId, 'we_new');
  assert.deepEqual(result.disabledEndpointIds, ['we_old']);
  assert.equal(result.stripeSecretKeyRotatedAt, '2026-03-30T19:16:21Z');
  assert.deepEqual(disabled, ['we_old']);
  assert.deepEqual(githubCalls.map((call) => `${call.type}:${call.name || call.secretName}`), [
    'secret:STRIPE_WEBHOOK_SECRET',
    'variable:STRIPE_WEBHOOK_SECRET_ROTATED_AT',
    'getSecret:STRIPE_SECRET_KEY',
    'variable:STRIPE_SECRET_KEY_ROTATED_AT',
  ]);
});

test('stripe webhook rotation validates required repo and GitHub token before side effects', async () => {
  await assert.rejects(
    () => rotateStripeWebhookSecret({
      stripeKey: 'sk_live_example',
      repo: '',
      listWebhookEndpoints: async () => {
        throw new Error('should not list endpoints');
      },
    }),
    /GITHUB_REPOSITORY is required/
  );

  await assert.rejects(
    () => rotateStripeWebhookSecret({
      stripeKey: 'sk_live_example',
      repo: 'IgorGanapolsky/ThumbGate',
      listWebhookEndpoints: async () => {
        throw new Error('should not list endpoints');
      },
    }),
    /THUMBGATE_MAINTENANCE_GH_TOKEN is required/
  );
});
