'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LIVE_OFFERS,
  buildKits,
  buildOpenClawGovernancePack,
  buildZernioCalendar,
  isCliInvocation,
  renderJson,
  renderMarkdown,
  renderZernioCsv,
  writeOpenClawGovernancePack,
} = require('../scripts/openclaw-agent-governance-kit');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-openclaw-kit-'));
}

test('OpenClaw governance kits expose live Stripe checkout links and narrow buyers', () => {
  const kits = buildKits();

  assert.deepEqual(kits.map((kit) => kit.key), [
    'prevention-rule-library',
    'reliable-governance-kit',
    'restaurant-ops-starter',
    'multi-agent-governance',
  ]);
  assert.deepEqual(kits.map((kit) => kit.priceCents), [4900, 9700, 14900, 14900]);
  assert.ok(kits.every((kit) => /^https:\/\/buy\.stripe\.com\//.test(kit.checkout.checkoutUrl)));
  assert.ok(kits.every((kit) => kit.buyer.length > 40));
  assert.ok(kits.every((kit) => kit.codexPrompt.includes('ThumbGate')));
  assert.ok(kits.every((kit) => !/guaranteed safe|fully autonomous|gumroad sales/i.test(kit.promise)));
});

test('live offer IDs stay attached to the correct checkout URLs', () => {
  assert.equal(LIVE_OFFERS.preventionRuleLibrary.checkoutUrl, 'https://buy.stripe.com/eVq5kDfCY7Dg4lH49Z3sI13');
  assert.equal(LIVE_OFFERS.reliableGovernanceKit.checkoutUrl, 'https://buy.stripe.com/bJe14naiE9Lo7xT49Z3sI12');
  assert.equal(LIVE_OFFERS.restaurantOpsStarter.checkoutUrl, 'https://buy.stripe.com/fZufZhaiE5v819vdKz3sI14');
  assert.equal(LIVE_OFFERS.multiAgentGovernance.checkoutUrl, 'https://buy.stripe.com/7sY8wP4Yk7Dg9G10XN3sI15');
  assert.ok(Object.values(LIVE_OFFERS).every((offer) => /^prod_/.test(offer.stripeProductId)));
  assert.ok(Object.values(LIVE_OFFERS).every((offer) => /^price_/.test(offer.stripePriceId)));
  assert.ok(Object.values(LIVE_OFFERS).every((offer) => /^plink_/.test(offer.stripePaymentLinkId)));
});

test('Zernio calendar creates two promotion posts per kit', () => {
  const calendar = buildZernioCalendar(buildKits());

  assert.equal(calendar.length, 8);
  assert.ok(calendar.some((item) => item.platform === 'linkedin'));
  assert.ok(calendar.some((item) => item.platform === 'threads'));
  assert.ok(calendar.every((item) => item.post.includes('https://buy.stripe.com/')));
});

test('rendered pack is checkout-ready without unsupported traction claims', () => {
  const pack = buildOpenClawGovernancePack({ generatedAt: '2026-05-06T18:40:00.000Z' });
  const markdown = renderMarkdown(pack);
  const json = JSON.parse(renderJson(pack));
  const csv = renderZernioCsv(pack);

  assert.equal(pack.status, 'checkout-ready');
  assert.equal(pack.moneyTruth.todayCharges, 0);
  assert.match(markdown, /ThumbGate \+ OpenClaw Agent Governance Kits/);
  assert.match(markdown, /Stripe balance before launch: \$0 available \/ \$0 pending/);
  assert.match(markdown, /ThumbGate Prevention Rule Library for OpenClaw/);
  assert.match(markdown, /OpenClaw \+ ThumbGate Restaurant Ops Starter Kit/);
  assert.match(markdown, /Hardened Multi-Agent Governance Workflow Kit/);
  assert.match(markdown, /https:\/\/buy\.stripe\.com\/bJe14naiE9Lo7xT49Z3sI12/);
  assert.doesNotMatch(markdown, /guaranteed safe|fully autonomous|proven Gumroad sales/i);
  assert.equal(json.kits.length, 4);
  assert.match(csv, /^day,platform,kit,post/);
});

test('artifact writer emits docs and money-today report when requested', () => {
  const repoRoot = makeTempDir();
  const reportDir = path.join(repoRoot, 'reports', 'gtm', '2026-05-06-money-today');
  const pack = buildOpenClawGovernancePack({ generatedAt: '2026-05-06T18:40:00.000Z' });
  const written = writeOpenClawGovernancePack(pack, {
    repoRoot,
    reportDir,
    writeDocs: true,
  });

  assert.equal(fs.existsSync(written.docsMdPath), true);
  assert.equal(fs.existsSync(written.docsJsonPath), true);
  assert.equal(fs.existsSync(written.docsCsvPath), true);
  assert.equal(fs.existsSync(written.reportPath), true);
  assert.match(fs.readFileSync(written.reportPath, 'utf8'), /Checkout-Ready Offers/);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'openclaw-agent-governance-kit.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'openclaw-agent-governance-kit.test.js')]), false);
});
