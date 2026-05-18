'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs,
  extractAccountIdentity,
  diagnoseIdentityGaps,
  summarizePaymentLinks,
  diagnosePaymentLinks,
  runProbe,
  renderMarkdown,
} = require('../scripts/stripe-business-identity-probe');

test('parseArgs reads --json flag', () => {
  assert.equal(parseArgs(['--json']).json, true);
  assert.equal(parseArgs([]).json, false);
});

test('extractAccountIdentity flattens business_profile + branding + statement_descriptor', () => {
  const account = {
    id: 'acct_1234',
    business_profile: {
      name: 'ThumbGate Ops',
      support_email: 'igor@thumbgate.ai',
      url: 'https://thumbgate.ai',
      product_description: 'Pre-action checks for AI coding agents',
      mcc: '5734',
    },
    settings: {
      payments: { statement_descriptor: 'THUMBGATE' },
      card_payments: { statement_descriptor_prefix: 'TG' },
      branding: {
        logo: 'file_logo_abc',
        icon: 'file_icon_abc',
        primary_color: '#0066cc',
        secondary_color: '#000000',
      },
    },
  };
  const identity = extractAccountIdentity(account);
  assert.equal(identity.accountId, 'acct_1234');
  assert.equal(identity.businessName, 'ThumbGate Ops');
  assert.equal(identity.statementDescriptor, 'THUMBGATE');
  assert.equal(identity.brandingLogo, 'file_logo_abc');
  assert.equal(identity.websiteUrl, 'https://thumbgate.ai');
});

test('extractAccountIdentity tolerates missing business_profile and settings', () => {
  const identity = extractAccountIdentity({ id: 'acct_bare' });
  assert.equal(identity.accountId, 'acct_bare');
  assert.equal(identity.businessName, null);
  assert.equal(identity.statementDescriptor, null);
  assert.equal(identity.brandingLogo, null);
});

test('diagnoseIdentityGaps fires critical on missing business name and logo', () => {
  const gaps = diagnoseIdentityGaps({
    businessName: null,
    brandingLogo: null,
    brandingIcon: null,
    statementDescriptor: 'THUMBGATE',
    websiteUrl: 'https://thumbgate.ai',
    supportEmail: 'support@thumbgate.ai',
    productDescription: 'AI agent governance',
  });
  const nameGap = gaps.find((g) => g.field === 'business_profile.name');
  const brandGap = gaps.find((g) => g.field === 'settings.branding.logo|icon');
  assert.equal(nameGap.severity, 'critical');
  assert.equal(brandGap.severity, 'critical');
});

test('diagnoseIdentityGaps warns when business name does not contain "ThumbGate"', () => {
  const gaps = diagnoseIdentityGaps({
    businessName: 'RLHF Feedback Loop LLC',
    brandingLogo: 'file_x',
    brandingIcon: null,
    statementDescriptor: 'THUMBGATE',
    websiteUrl: 'https://thumbgate.ai',
    supportEmail: 'x@y.com',
    productDescription: 'x',
  });
  const nameGap = gaps.find((g) => g.field === 'business_profile.name');
  assert.equal(nameGap.severity, 'warning');
  assert.match(nameGap.message, /not "ThumbGate"/);
});

test('diagnoseIdentityGaps returns empty array when identity is fully branded', () => {
  const gaps = diagnoseIdentityGaps({
    businessName: 'ThumbGate Ops',
    brandingLogo: 'file_x',
    brandingIcon: 'file_y',
    statementDescriptor: 'THUMBGATE',
    websiteUrl: 'https://thumbgate.ai',
    supportEmail: 'support@thumbgate.ai',
    productDescription: 'Pre-action checks for AI coding agents',
  });
  assert.deepEqual(gaps, []);
});

test('summarizePaymentLinks extracts UX-relevant config per link', () => {
  const links = [
    {
      id: 'plink_1',
      url: 'https://buy.stripe.com/abc',
      active: true,
      submit_type: 'pay',
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: true },
      custom_text: { submit: { message: 'Buy now' } },
      metadata: { thumbgate_tier: 'pro' },
    },
  ];
  const summary = summarizePaymentLinks(links);
  assert.equal(summary[0].id, 'plink_1');
  assert.equal(summary[0].active, true);
  assert.equal(summary[0].phoneNumberCollection, true);
  assert.equal(summary[0].hasCustomText, true);
  assert.deepEqual(summary[0].metadataKeys, ['thumbgate_tier']);
});

test('diagnosePaymentLinks fires critical on inactive Payment Link still on file', () => {
  const summary = [{ id: 'plink_dead', url: 'x', active: false, billingAddressCollection: 'auto', phoneNumberCollection: false }];
  const gaps = diagnosePaymentLinks(summary);
  const dead = gaps.find((g) => g.linkId === 'plink_dead');
  assert.equal(dead.severity, 'critical');
  assert.match(dead.message, /INACTIVE/);
});

test('diagnosePaymentLinks warns on phone collection (friction)', () => {
  const summary = [{ id: 'plink_pf', url: 'x', active: true, billingAddressCollection: 'auto', phoneNumberCollection: true }];
  const gaps = diagnosePaymentLinks(summary);
  const phone = gaps.find((g) => g.linkId === 'plink_pf' && /phone/i.test(g.message));
  assert.equal(phone.severity, 'warning');
});

// runProbe with injected fake Stripe -------------------------------------

function fakeStripe({ account, paymentLinks = [] } = {}) {
  return {
    accounts: { retrieve: async () => account },
    paymentLinks: { list: async () => ({ data: paymentLinks, has_more: false }) },
  };
}

test('runProbe returns a gap object when STRIPE_SECRET_KEY is missing', async () => {
  const report = await runProbe({ secretKey: '' });
  assert.equal(report.configured, false);
  assert.match(report.gap, /STRIPE_SECRET_KEY/);
});

test('runProbe surfaces identity gaps and Payment Link gaps in one report', async () => {
  const stripeClient = fakeStripe({
    account: {
      id: 'acct_x',
      business_profile: { name: null, url: null }, // unset → critical gap
      settings: { branding: {}, payments: {}, card_payments: {} },
    },
    paymentLinks: [
      { id: 'plink_dead', url: 'https://buy.stripe.com/dead', active: false, submit_type: 'pay', billing_address_collection: 'auto', phone_number_collection: { enabled: false } },
    ],
  });
  const report = await runProbe({ stripeClient });
  assert.equal(report.configured, true);
  const md = renderMarkdown(report);
  assert.match(md, /\[critical\] `business_profile\.name`/);
  assert.match(md, /\[critical\] `settings\.branding\.logo\|icon`/);
  assert.match(md, /\[critical\] `plink_dead`/);
  assert.match(md, /INACTIVE/);
});

test('renderMarkdown describes unconfigured Stripe without crashing', () => {
  const md = renderMarkdown({ configured: false, gap: 'STRIPE_SECRET_KEY is not set' });
  assert.match(md, /NOT CONFIGURED.*STRIPE_SECRET_KEY/);
});
