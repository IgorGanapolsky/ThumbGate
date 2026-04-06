'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateDeployPolicy,
  parseTimestamp,
  getAgeDays,
} = require('../scripts/deploy-policy');

function isoDaysAgo(days) {
  return new Date(Date.now() - (days * 86_400_000)).toISOString();
}

test('parseTimestamp returns null for invalid input', () => {
  assert.equal(parseTimestamp('not-a-date'), null);
  assert.equal(parseTimestamp(''), null);
});

test('getAgeDays returns rounded day age', () => {
  const now = new Date('2026-03-12T00:00:00.000Z');
  const then = new Date('2026-03-10T00:00:00.000Z');
  assert.equal(getAgeDays(then, now), 2);
});

test('deploy policy passes when required vars and fresh secrets are present', () => {
  const report = evaluateDeployPolicy({
    THUMBGATE_API_KEY: 'rlhf_live_key',
    THUMBGATE_API_KEY_ROTATED_AT: isoDaysAgo(5),
    STRIPE_SECRET_KEY: 'sk_live_example',
    STRIPE_SECRET_KEY_ROTATED_AT: isoDaysAgo(5),
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    STRIPE_WEBHOOK_SECRET_ROTATED_AT: isoDaysAgo(5),
    RAILWAY_TOKEN: 'railway_token',
    RAILWAY_TOKEN_ROTATED_AT: isoDaysAgo(10),
    RAILWAY_PROJECT_ID: 'proj_123',
    RAILWAY_ENVIRONMENT_ID: 'env_123',
    RAILWAY_HEALTHCHECK_URL: 'https://thumbgate-production.up.railway.app/health',
    THUMBGATE_PUBLIC_APP_ORIGIN: 'https://thumbgate-production.up.railway.app',
    THUMBGATE_BILLING_API_BASE_URL: 'https://billing.example.com',
  }, {
    profiles: ['runtime', 'billing', 'deploy'],
  });

  assert.equal(report.ok, true);
  assert.equal(report.errors.length, 0);
});

test('deploy policy fails when canonical billing config is missing', () => {
  const report = evaluateDeployPolicy({
    RAILWAY_TOKEN: 'railway_token',
    RAILWAY_TOKEN_ROTATED_AT: isoDaysAgo(1),
    RAILWAY_PROJECT_ID: 'proj_123',
    RAILWAY_ENVIRONMENT_ID: 'env_123',
    RAILWAY_HEALTHCHECK_URL: 'https://thumbgate-production.up.railway.app/health',
  }, {
    profiles: ['deploy'],
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((entry) => entry.name === 'THUMBGATE_PUBLIC_APP_ORIGIN'));
  assert.ok(report.errors.some((entry) => entry.name === 'THUMBGATE_BILLING_API_BASE_URL'));
});

test('deploy policy fails stale Stripe secret timestamps', () => {
  const report = evaluateDeployPolicy({
    STRIPE_SECRET_KEY: 'sk_live_example',
    STRIPE_SECRET_KEY_ROTATED_AT: isoDaysAgo(120),
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    STRIPE_WEBHOOK_SECRET_ROTATED_AT: isoDaysAgo(3),
    THUMBGATE_PUBLIC_APP_ORIGIN: 'https://thumbgate-production.up.railway.app',
    THUMBGATE_BILLING_API_BASE_URL: 'https://billing.example.com',
  }, {
    profiles: ['billing'],
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((entry) => entry.type === 'stale_secret' && entry.name === 'STRIPE_SECRET_KEY'));
});
