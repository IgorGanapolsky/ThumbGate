'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  RETIRED_CATALOG_RECORDS,
  buildKits,
  buildOpenClawGovernancePack,
  buildOrganicDraftCalendar,
  isCliInvocation,
  renderJson,
  renderMarkdown,
  renderOrganicCsv,
  writeOpenClawGovernancePack,
} = require('../scripts/openclaw-agent-governance-kit');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-openclaw-kit-'));
}

test('OpenClaw governance kits retain research context without exposing retired checkouts', () => {
  const kits = buildKits();

  assert.deepEqual(kits.map((kit) => kit.key), [
    'prevention-rule-library',
    'reliable-governance-kit',
    'restaurant-ops-starter',
    'multi-agent-governance',
  ]);
  assert.deepEqual(kits.map((kit) => kit.priceCents), [4900, 9700, 14900, 14900]);
  assert.ok(kits.every((kit) => kit.catalog.status === 'retired_not_public'));
  assert.ok(kits.every((kit) => /^https:\/\/thumbgate\.ai\/diagnostic/.test(kit.catalog.buyerPath)));
  assert.ok(kits.every((kit) => kit.buyer.length > 40));
  assert.ok(kits.every((kit) => kit.codexPrompt.includes('ThumbGate')));
  assert.ok(kits.every((kit) => !/guaranteed safe|fully autonomous|gumroad sales/i.test(kit.promise)));
});

test('retired catalog IDs remain auditable but route buyers to current scope-first paths', () => {
  assert.ok(Object.values(RETIRED_CATALOG_RECORDS).every((offer) => offer.status === 'retired_not_public'));
  assert.ok(Object.values(RETIRED_CATALOG_RECORDS).every((offer) => /^prod_/.test(offer.stripeProductId)));
  assert.ok(Object.values(RETIRED_CATALOG_RECORDS).every((offer) => /^price_/.test(offer.stripePriceId)));
  assert.ok(Object.values(RETIRED_CATALOG_RECORDS).every((offer) => /^plink_/.test(offer.stripePaymentLinkId)));
  assert.ok(Object.values(RETIRED_CATALOG_RECORDS).every((offer) => /^https:\/\/thumbgate\.ai\/diagnostic/.test(offer.buyerPath)));
});

test('organic draft calendar creates two value-first drafts per concept', () => {
  const calendar = buildOrganicDraftCalendar(buildKits());

  assert.equal(calendar.length, 8);
  assert.ok(calendar.some((item) => item.platform === 'linkedin'));
  assert.ok(calendar.some((item) => item.platform === 'threads'));
  const currentBuyerPaths = new Set(Object.values(RETIRED_CATALOG_RECORDS).map((offer) => offer.buyerPath));
  for (const item of calendar) {
    const rawUrls = item.post.match(/\bhttps:\/\/\S+/g) || [];
    assert.equal(rawUrls.length, 1, 'calendar post must include exactly one checkout URL');
    const checkoutUrl = new URL(rawUrls[0]);
    assert.equal(checkoutUrl.protocol, 'https:');
    assert.equal(checkoutUrl.hostname, 'thumbgate.ai');
    assert.equal(checkoutUrl.pathname, '/diagnostic');
    assert.ok(currentBuyerPaths.has(checkoutUrl.href));
  }
});

test('rendered pack is explicitly archived without unsupported traction claims', () => {
  const pack = buildOpenClawGovernancePack({ generatedAt: '2026-05-06T18:40:00.000Z' });
  const markdown = renderMarkdown(pack);
  const json = JSON.parse(renderJson(pack));
  const csv = renderOrganicCsv(pack);

  assert.equal(pack.status, 'archived-not-for-sale');
  assert.equal(pack.moneyTruth.todayCharges, 0);
  assert.match(markdown, /ThumbGate \+ OpenClaw Agent Governance Kits/);
  assert.match(markdown, /Stripe balance before launch: \$0 available \/ \$0 pending/);
  assert.match(markdown, /ThumbGate Prevention Rule Library for OpenClaw/);
  assert.match(markdown, /OpenClaw \+ ThumbGate Restaurant Ops Starter Kit/);
  assert.match(markdown, /Hardened Multi-Agent Governance Workflow Kit/);
  assert.match(markdown, /https:\/\/thumbgate\.ai\/diagnostic/);
  assert.doesNotMatch(markdown, /buy\.stripe\.com/);
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
  assert.match(fs.readFileSync(written.reportPath, 'utf8'), /Archived Offer Concepts/);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'openclaw-agent-governance-kit.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'openclaw-agent-governance-kit.test.js')]), false);
});
