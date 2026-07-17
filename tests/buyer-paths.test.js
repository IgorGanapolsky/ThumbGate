'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildBuyerUrl,
  buildDiagnosticBuyerUrl,
  buildEnterpriseBuyerUrl,
  buildProBuyerUrl,
  buildSprintBuyerUrl,
  isFirstPartyBuyerUrl,
} = require('../scripts/buyer-paths');

const ROOT = path.resolve(__dirname, '..');
const BUYER_FACING_SOURCES = [
  'scripts/commercial-offer.js',
  'scripts/openclaw-agent-governance-kit.js',
  'scripts/rate-limiter.js',
  'scripts/revenue-email-dispatch.js',
  'scripts/seo-gsd.js',
  'scripts/social-analytics/publish-thumbgate-launch.js',
];

test('buyer-path builders route every active offer through ThumbGate first', () => {
  const monthly = new URL(buildProBuyerUrl({ billingCycle: 'monthly', source: 'test' }));
  const annual = new URL(buildProBuyerUrl({ billingCycle: 'annual', source: 'test' }));
  const diagnostic = new URL(buildDiagnosticBuyerUrl({ source: 'test' }));
  const sprint = new URL(buildSprintBuyerUrl({ source: 'test' }));
  const enterprise = new URL(buildEnterpriseBuyerUrl());

  for (const url of [monthly, annual, diagnostic, sprint, enterprise]) {
    assert.equal(url.origin, 'https://thumbgate.ai');
    assert.equal(isFirstPartyBuyerUrl(url.toString()), true);
  }
  assert.equal(monthly.pathname, '/go/pro');
  assert.equal(monthly.searchParams.get('billing_cycle'), 'monthly');
  assert.equal(annual.pathname, '/go/pro');
  assert.equal(annual.searchParams.get('billing_cycle'), 'annual');
  assert.equal(diagnostic.pathname, '/diagnostic');
  assert.equal(sprint.pathname, '/go/sprint');
  assert.equal(enterprise.hash, '#workflow-sprint-intake');
  assert.throws(
    () => buildBuyerUrl('https://buy.stripe.com/unsafe'),
    /must remain on the configured first-party origin/,
  );
});

test('active buyer-facing generators cannot expose provider payment links or forbidden publishers', () => {
  const violations = [];
  for (const relativePath of BUYER_FACING_SOURCES) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    if (/https:\/\/(?:buy\.stripe\.com|paypal\.com\/ncp\/payment)\//i.test(source)) {
      violations.push(`${relativePath}: raw payment provider URL`);
    }
    if (/zernio/i.test(source)) {
      violations.push(`${relativePath}: forbidden publisher reference`);
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('unverified-cost Aiventyx campaign cannot be confirmed into a send', async () => {
  const { main } = require('../scripts/revenue-email-dispatch');
  let sendAttempted = false;
  await assert.rejects(
    () => main(['--campaign=aiventyx_marketplace_followup', '--confirm-send'], {
      sendEmail: async () => {
        sendAttempted = true;
        return { sent: true };
      },
    }),
    /hold_unverified_cost/,
  );
  assert.equal(sendAttempted, false);
});

test('social publisher requires an injected direct-platform adapter outside dry-run mode', async () => {
  const { publishLaunchCampaign } = require('../scripts/social-analytics/publish-thumbgate-launch');
  await assert.rejects(
    () => publishLaunchCampaign({ platforms: ['linkedin'] }),
    /direct_platform_publisher_required/,
  );
});
