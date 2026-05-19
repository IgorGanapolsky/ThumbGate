'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TARGETS,
  applyAll,
  updateLink,
  resolvePlinkId,
  parseArgs,
  renderHuman,
} = require('../scripts/stripe-payment-link-update');

function makeStripeMock(initialLinks) {
  const state = { links: JSON.parse(JSON.stringify(initialLinks)), updates: [] };
  return {
    state,
    stripe: {
      paymentLinks: {
        list: async ({ limit = 100, starting_after } = {}) => {
          const start = starting_after ? state.links.findIndex((l) => l.id === starting_after) + 1 : 0;
          const page = state.links.slice(start, start + limit);
          return { data: page, has_more: start + page.length < state.links.length };
        },
        retrieve: async (id) => {
          const link = state.links.find((l) => l.id === id);
          if (!link) throw new Error(`no such link ${id}`);
          return JSON.parse(JSON.stringify(link));
        },
        update: async (id, patch) => {
          const link = state.links.find((l) => l.id === id);
          if (!link) throw new Error(`no such link ${id}`);
          state.updates.push({ id, patch });
          if (patch.custom_text) link.custom_text = patch.custom_text;
          if (patch.metadata) link.metadata = { ...(link.metadata || {}), ...patch.metadata };
          if (patch.automatic_tax) link.automatic_tax = patch.automatic_tax;
          return JSON.parse(JSON.stringify(link));
        },
      },
    },
  };
}

function makeEmptyLink(urlSlug, plinkId) {
  return {
    id: plinkId,
    url: `https://buy.stripe.com/${urlSlug}`,
    active: true,
    metadata: {},
    automatic_tax: { enabled: false },
    custom_text: null,
  };
}

function makeFullLink(urlSlug, plinkId, target) {
  return {
    id: plinkId,
    url: `https://buy.stripe.com/${urlSlug}`,
    active: true,
    metadata: { ...target.metadata },
    automatic_tax: { enabled: true },
    custom_text: { submit: { message: target.customText } },
  };
}

test('parseArgs: --dry-run and --json flags work', () => {
  assert.deepStrictEqual(parseArgs([]), { dryRun: false, json: false });
  assert.deepStrictEqual(parseArgs(['--dry-run']), { dryRun: true, json: false });
  assert.deepStrictEqual(parseArgs(['--json', '--dry-run']), { dryRun: true, json: true });
});

test('TARGETS: 3 customer-facing payment links with required fields', () => {
  assert.strictEqual(TARGETS.length, 3);
  const labels = TARGETS.map((t) => t.label);
  assert.ok(labels.some((l) => /diagnostic/i.test(l)));
  assert.ok(labels.some((l) => /sprint/i.test(l)));
  assert.ok(labels.some((l) => /kit/i.test(l)));
  for (const t of TARGETS) {
    assert.ok(t.urlSlug, `${t.label} missing urlSlug`);
    assert.ok(t.customText, `${t.label} missing customText`);
    assert.ok(t.customText.length >= 80, `${t.label} customText too short`);
    assert.ok(t.metadata.utm_source, `${t.label} missing utm_source`);
    assert.ok(t.metadata.cta_id, `${t.label} missing cta_id`);
    assert.ok(t.metadata.attribution_version, `${t.label} missing attribution_version`);
  }
});

test('resolvePlinkId: finds link by URL slug across pages', async () => {
  const links = [
    makeEmptyLink('aaa', 'plink_a'),
    makeEmptyLink(TARGETS[0].urlSlug, 'plink_target_0'),
    makeEmptyLink('zzz', 'plink_z'),
  ];
  const { stripe } = makeStripeMock(links);
  const found = await resolvePlinkId(stripe, TARGETS[0].urlSlug);
  assert.strictEqual(found, 'plink_target_0');
});

test('resolvePlinkId: returns null when slug not found', async () => {
  const { stripe } = makeStripeMock([makeEmptyLink('aaa', 'plink_a')]);
  const found = await resolvePlinkId(stripe, 'nonexistent_slug');
  assert.strictEqual(found, null);
});

test('updateLink: empty link gets all 3 patches', async () => {
  const target = TARGETS[0];
  const { stripe, state } = makeStripeMock([makeEmptyLink(target.urlSlug, 'plink_x')]);
  const result = await updateLink({ stripe, target, options: { dryRun: false } });
  assert.strictEqual(result.changed, true);
  const fields = result.actions.map((a) => a.field).sort();
  assert.deepStrictEqual(fields, ['automatic_tax.enabled', 'custom_text.submit.message', 'metadata']);
  assert.strictEqual(state.updates.length, 1);
  assert.strictEqual(state.updates[0].patch.custom_text.submit.message, target.customText);
  assert.strictEqual(state.updates[0].patch.automatic_tax.enabled, true);
  assert.strictEqual(state.updates[0].patch.metadata.cta_id, target.metadata.cta_id);
});

test('updateLink: fully-populated link is a no-op', async () => {
  const target = TARGETS[1];
  const { stripe, state } = makeStripeMock([makeFullLink(target.urlSlug, 'plink_y', target)]);
  const result = await updateLink({ stripe, target, options: { dryRun: false } });
  assert.strictEqual(result.changed, false);
  assert.deepStrictEqual(result.actions, []);
  assert.strictEqual(state.updates.length, 0);
});

test('updateLink: --dry-run plans actions but does not write', async () => {
  const target = TARGETS[0];
  const { stripe, state } = makeStripeMock([makeEmptyLink(target.urlSlug, 'plink_z')]);
  const result = await updateLink({ stripe, target, options: { dryRun: true } });
  assert.strictEqual(result.dryRun, true);
  assert.strictEqual(result.changed, false);
  assert.ok(result.actions.length >= 3);
  assert.strictEqual(state.updates.length, 0);
});

test('updateLink: returns error when slug cannot be resolved', async () => {
  const { stripe } = makeStripeMock([makeEmptyLink('other_slug', 'plink_other')]);
  const result = await updateLink({ stripe, target: TARGETS[0], options: { dryRun: false } });
  assert.match(result.error, /could not resolve plink ID/);
});

test('applyAll: processes every TARGETS entry', async () => {
  const links = TARGETS.map((t, i) => makeEmptyLink(t.urlSlug, `plink_${i}`));
  const { stripe } = makeStripeMock(links);
  const results = await applyAll({ stripe, options: { dryRun: false } });
  assert.strictEqual(results.length, 3);
  for (const r of results) {
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.changed, true);
  }
});

test('renderHuman: lists actions when changed, says no-op when not', () => {
  const out = renderHuman([
    { target: 'A', plinkId: 'plink_a', changed: true, actions: [{ field: 'custom_text.submit.message', to: 'hi' }] },
    { target: 'B', plinkId: 'plink_b', changed: false, actions: [] },
    { target: 'C', error: 'something broke' },
  ]);
  assert.match(out, /Updated A/);
  assert.match(out, /no-op/);
  assert.match(out, /✗ C/);
});
