'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { applyBranding, DEFAULTS, renderHuman, parseArgs } = require('../scripts/stripe-branding-apply');

function makeStripeMock(initialAccount) {
  const state = { account: JSON.parse(JSON.stringify(initialAccount)), uploads: [], updates: [] };
  return {
    state,
    stripe: {
      accounts: {
        retrieve: async () => JSON.parse(JSON.stringify(state.account)),
        update: async (id, patch) => {
          state.updates.push({ id, patch });
          if (patch.business_profile) {
            state.account.business_profile = { ...(state.account.business_profile || {}), ...patch.business_profile };
          }
          if (patch.settings?.branding) {
            state.account.settings = state.account.settings || {};
            state.account.settings.branding = { ...(state.account.settings.branding || {}), ...patch.settings.branding };
          }
          return JSON.parse(JSON.stringify(state.account));
        },
      },
      files: {
        create: async ({ purpose }) => {
          const id = `file_${purpose}_mock_${state.uploads.length + 1}`;
          state.uploads.push({ purpose, id });
          return { id };
        },
      },
    },
  };
}

const ACCOUNT_EMPTY = {
  id: 'acct_mock',
  business_profile: {
    name: 'Thumbgate Ops',
    url: 'https://thumbgate.ai',
    support_email: null,
    product_description: null,
  },
  settings: {
    branding: { logo: null, icon: null },
    payments: { statement_descriptor: 'THUMBGATE' },
  },
};

const ACCOUNT_FULL = {
  id: 'acct_mock',
  business_profile: {
    name: 'Thumbgate Ops',
    url: 'https://thumbgate.ai',
    support_email: DEFAULTS.supportEmail,
    product_description: DEFAULTS.productDescription,
  },
  settings: {
    branding: { logo: 'file_logo_existing', icon: 'file_icon_existing' },
    payments: { statement_descriptor: 'THUMBGATE' },
  },
};

test('parseArgs: --dry-run and --json toggle flags', () => {
  assert.deepStrictEqual(parseArgs([]), { dryRun: false, json: false });
  assert.deepStrictEqual(parseArgs(['--dry-run']), { dryRun: true, json: false });
  assert.deepStrictEqual(parseArgs(['--json', '--dry-run']), { dryRun: true, json: true });
});

test('applyBranding: empty account patches text fields (file uploads opt-in by default)', async () => {
  const { stripe, state } = makeStripeMock(ACCOUNT_EMPTY);
  const result = await applyBranding({
    stripe,
    options: {
      logoPath: path.resolve(__dirname, '..', 'public/assets/brand/thumbgate-logo-1200x360.png'),
      iconPath: path.resolve(__dirname, '..', 'public/assets/brand/thumbgate-icon-512.png'),
      supportEmail: DEFAULTS.supportEmail,
      productDescription: DEFAULTS.productDescription,
      dryRun: false,
    },
  });

  assert.equal(result.changed, true);
  const fields = result.actions.map((a) => a.field).sort();
  // File-upload fields are gated behind THUMBGATE_STRIPE_UPLOAD_FILES=1
  assert.deepStrictEqual(fields, [
    'business_profile.product_description',
    'business_profile.support_email',
  ]);

  // One update call with text fields bundled, no file uploads
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].patch.business_profile.support_email, DEFAULTS.supportEmail);
  assert.ok(state.updates[0].patch.business_profile.product_description.length > 50);
  assert.equal(state.uploads.length, 0);
});

test('applyBranding: with THUMBGATE_STRIPE_UPLOAD_FILES=1, also uploads logo + icon', async () => {
  process.env.THUMBGATE_STRIPE_UPLOAD_FILES = '1';
  try {
    const { stripe, state } = makeStripeMock(ACCOUNT_EMPTY);
    const result = await applyBranding({
      stripe,
      options: {
        logoPath: path.resolve(__dirname, '..', 'public/assets/brand/thumbgate-logo-1200x360.png'),
        iconPath: path.resolve(__dirname, '..', 'public/assets/brand/thumbgate-icon-512.png'),
        supportEmail: DEFAULTS.supportEmail,
        productDescription: DEFAULTS.productDescription,
        dryRun: false,
      },
    });
    assert.equal(result.changed, true);
    const purposes = state.uploads.map((u) => u.purpose).sort();
    assert.deepStrictEqual(purposes, ['business_icon', 'business_logo']);
  } finally {
    delete process.env.THUMBGATE_STRIPE_UPLOAD_FILES;
  }
});

test('applyBranding: fully populated account is a no-op', async () => {
  const { stripe, state } = makeStripeMock(ACCOUNT_FULL);
  const result = await applyBranding({
    stripe,
    options: {
      logoPath: path.resolve(__dirname, '..', 'public/assets/brand/thumbgate-logo-1200x360.png'),
      iconPath: path.resolve(__dirname, '..', 'public/assets/brand/thumbgate-icon-512.png'),
      supportEmail: DEFAULTS.supportEmail,
      productDescription: DEFAULTS.productDescription,
      dryRun: false,
    },
  });
  assert.equal(result.changed, false);
  assert.deepStrictEqual(result.actions, []);
  assert.equal(state.updates.length, 0);
  assert.equal(state.uploads.length, 0);
});

test('applyBranding: --dry-run plans actions but writes nothing', async () => {
  const { stripe, state } = makeStripeMock(ACCOUNT_EMPTY);
  const result = await applyBranding({
    stripe,
    options: {
      logoPath: path.resolve(__dirname, '..', 'public/assets/brand/thumbgate-logo-1200x360.png'),
      iconPath: path.resolve(__dirname, '..', 'public/assets/brand/thumbgate-icon-512.png'),
      supportEmail: DEFAULTS.supportEmail,
      productDescription: DEFAULTS.productDescription,
      dryRun: true,
    },
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.changed, false);
  assert.ok(result.actions.length >= 2);
  assert.equal(state.updates.length, 0);
  assert.equal(state.uploads.length, 0);
});

test('renderHuman: no-op message when nothing changed', () => {
  const out = renderHuman({ changed: false, actions: [], current: {} });
  assert.match(out, /already matches/);
});

test('renderHuman: lists every action when changed', () => {
  const out = renderHuman({
    changed: true,
    actions: [
      { field: 'business_profile.support_email', from: null, to: 'support@x.io' },
      { field: 'settings.branding.logo', from: null, to: 'file_business_logo_mock_1' },
    ],
    accountId: 'acct_mock',
  });
  assert.match(out, /business_profile\.support_email/);
  assert.match(out, /settings\.branding\.logo/);
  assert.match(out, /Updated account acct_mock/);
});

test('brand assets exist on disk so the workflow can find them', () => {
  const fs = require('node:fs');
  assert.ok(fs.existsSync(DEFAULTS.logoPath), `missing logo: ${DEFAULTS.logoPath}`);
  assert.ok(fs.existsSync(DEFAULTS.iconPath), `missing icon: ${DEFAULTS.iconPath}`);
});
