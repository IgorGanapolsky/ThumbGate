'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyEndpoint,
  planCleanup,
  applyCleanup,
  parseArgs,
  renderHuman,
  KEEP_URL,
} = require('../scripts/stripe-webhook-cleanup');

function makeStripeMock(endpoints) {
  const state = { endpoints: JSON.parse(JSON.stringify(endpoints)), deleted: [] };
  return {
    state,
    stripe: {
      webhookEndpoints: {
        list: async ({ limit = 100, starting_after } = {}) => {
          const start = starting_after ? state.endpoints.findIndex((e) => e.id === starting_after) + 1 : 0;
          const page = state.endpoints.slice(start, start + limit);
          return { data: page, has_more: start + page.length < state.endpoints.length };
        },
        del: async (id) => {
          state.deleted.push(id);
          state.endpoints = state.endpoints.filter((e) => e.id !== id);
          return { id, deleted: true };
        },
      },
    },
  };
}

test('parseArgs: --apply and --json flags', () => {
  assert.deepStrictEqual(parseArgs([]), { apply: false, json: false });
  assert.strictEqual(parseArgs(['--apply']).apply, true);
  assert.strictEqual(parseArgs(['--json']).json, true);
});

test('classifyEndpoint: enabled canonical URL → keep (first only)', () => {
  const keptOnce = { flag: false };
  const r = classifyEndpoint({ status: 'enabled', url: KEEP_URL }, keptOnce);
  assert.strictEqual(r.action, 'keep');
  assert.strictEqual(keptOnce.flag, true);
});

test('classifyEndpoint: enabled-but-duplicate canonical URL → delete', () => {
  const keptOnce = { flag: true };
  const r = classifyEndpoint({ status: 'enabled', url: KEEP_URL }, keptOnce);
  assert.strictEqual(r.action, 'delete');
  assert.match(r.reason, /duplicate/);
});

test('classifyEndpoint: disabled canonical URL → delete', () => {
  const r = classifyEndpoint({ status: 'disabled', url: KEEP_URL }, { flag: true });
  assert.strictEqual(r.action, 'delete');
  assert.match(r.reason, /disabled duplicate/);
});

test('classifyEndpoint: disabled orphan rlhf-feedback-loop URL → delete', () => {
  const r = classifyEndpoint({ status: 'disabled', url: 'https://rlhf-feedback-loop-production.up.railway.app/v1/billing/webhook' }, { flag: true });
  assert.strictEqual(r.action, 'delete');
  assert.match(r.reason, /orphan rlhf/);
});

test('classifyEndpoint: disabled unknown URL → keep (defense in depth, leave for review)', () => {
  const r = classifyEndpoint({ status: 'disabled', url: 'https://some-unknown-service.example.com/webhook' }, { flag: true });
  assert.strictEqual(r.action, 'keep');
  assert.match(r.reason, /unknown URL/);
});

test('classifyEndpoint: enabled non-canonical URL → keep (defense in depth)', () => {
  const r = classifyEndpoint({ status: 'enabled', url: 'https://some-other-service.com/webhook' }, { flag: false });
  assert.strictEqual(r.action, 'keep');
});

test('planCleanup: realistic scenario from 2026-05-19 audit', async () => {
  const endpoints = [
    { id: 'we_keep', status: 'enabled', url: KEEP_URL, enabled_events: ['checkout.session.completed', 'invoice.paid', 'customer.subscription.created', 'customer.subscription.updated'] },
    { id: 'we_dup', status: 'disabled', url: KEEP_URL, enabled_events: ['e1', 'e2', 'e3', 'e4'] },
    { id: 'we_rlhf_prod', status: 'disabled', url: 'https://rlhf-feedback-loop-production.up.railway.app/v1/billing/webhook', enabled_events: ['e1'] },
    { id: 'we_rlhf_gcp', status: 'disabled', url: 'https://rlhf-feedback-loop-710216278770.us-central1.run.app/v1/billing/webhook', enabled_events: Array(231).fill('e') },
    { id: 'we_rlhf_other', status: 'disabled', url: 'https://rlhf-feedback-loop-production.up.railway.app/v1/billing/webhook', enabled_events: ['e1', 'e2', 'e3', 'e4'] },
  ];
  const { stripe } = makeStripeMock(endpoints);
  const plan = await planCleanup(stripe);
  assert.strictEqual(plan.length, 5);
  const keeps = plan.filter((p) => p.action === 'keep');
  const deletes = plan.filter((p) => p.action === 'delete');
  assert.strictEqual(keeps.length, 1, 'exactly one kept');
  assert.strictEqual(deletes.length, 4, 'four to delete');
  assert.strictEqual(keeps[0].id, 'we_keep');
});

test('applyCleanup: only deletes items marked action=delete', async () => {
  const endpoints = [
    { id: 'we_keep', status: 'enabled', url: KEEP_URL, enabled_events: [] },
    { id: 'we_dup', status: 'disabled', url: KEEP_URL, enabled_events: [] },
    { id: 'we_orphan', status: 'disabled', url: 'https://rlhf-feedback-loop-x.run.app/v1/billing/webhook', enabled_events: [] },
  ];
  const { stripe, state } = makeStripeMock(endpoints);
  const plan = await planCleanup(stripe);
  const results = await applyCleanup(stripe, plan);
  assert.strictEqual(results.filter((r) => r.deleted).length, 2);
  assert.deepStrictEqual(state.deleted.sort(), ['we_dup', 'we_orphan']);
  // Kept endpoint still present
  assert.ok(state.endpoints.some((e) => e.id === 'we_keep'));
});

test('renderHuman: shows WOULD DELETE in dry-run, DELETED after apply, keep for kept', () => {
  const dryRun = [
    { id: 'we_a', url: KEEP_URL, status: 'enabled', eventCount: 4, action: 'keep', reason: 'canonical' },
    { id: 'we_b', url: KEEP_URL, status: 'disabled', eventCount: 4, action: 'delete', reason: 'dup' },
  ];
  const out = renderHuman(dryRun);
  assert.match(out, /WOULD DELETE.*we_b/);
  assert.match(out, /keep.*we_a/);

  const applied = [
    { id: 'we_b', url: KEEP_URL, status: 'disabled', eventCount: 4, action: 'delete', reason: 'dup', deleted: true },
  ];
  const out2 = renderHuman(applied);
  assert.match(out2, /DELETED.*we_b/);
});
