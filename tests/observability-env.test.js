'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadObservabilityEnv,
  observabilityConfigTemplate,
} = require('../scripts/observability-env');

test('loadObservabilityEnv fills missing env from observability.json without overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-obs-'));
  const obsPath = path.join(dir, 'observability.json');
  const opPath = path.join(dir, 'operator.json');
  fs.writeFileSync(obsPath, JSON.stringify({
    stripeSecretKey: 'sk_test_from_file',
    plausibleApiKey: 'plausible_key',
    plausibleSiteId: 'thumbgate.ai',
  }));
  fs.writeFileSync(opPath, JSON.stringify({ operatorKey: 'tg_op_test', baseUrl: 'https://thumbgate.ai' }));

  const env = { STRIPE_SECRET_KEY: 'sk_env_wins' };
  const result = loadObservabilityEnv({
    env,
    observabilityPath: obsPath,
    operatorPath: opPath,
    applyStripeManagedFiles: false,
  });

  assert.equal(env.STRIPE_SECRET_KEY, 'sk_env_wins');
  assert.equal(env.PLAUSIBLE_API_KEY, 'plausible_key');
  assert.equal(env.PLAUSIBLE_SITE_ID, 'thumbgate.ai');
  assert.equal(env.THUMBGATE_OPERATOR_KEY, 'tg_op_test');
  assert.equal(result.hasPlausible, true);
  assert.equal(result.hasOperator, true);
});

test('observabilityConfigTemplate includes primary Plausible site', () => {
  const t = observabilityConfigTemplate();
  assert.equal(t.plausibleSiteId, 'thumbgate.ai');
  assert.match(t.plausibleRegisteredDomains, /thumbgate\.ai/);
});


test('sets registered domains default when neither site id nor registered list is present', () => {
  const env = {};
  loadObservabilityEnv({
    env,
    observabilityPath: '/tmp/no-such-obs.json',
    operatorPath: '/tmp/no-such-op.json',
    applyStripeManagedFiles: false,
  });
  assert.match(env.THUMBGATE_PLAUSIBLE_REGISTERED_DOMAINS, /thumbgate\.ai/);
});
