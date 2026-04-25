const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  AI_CODING_CATEGORY,
  DASHBOARD_URL,
  STANDARD_MARKETPLACE_FEE,
  buildAiventyxFollowUp,
  buildAiventyxListings,
  buildAiventyxMarketplacePlan,
  buildAiventyxNinetyDayPlan,
  isCliInvocation,
  parseArgs,
  renderAiventyxMarketplaceMarkdown,
  writeAiventyxMarketplaceOutputs,
} = require('../scripts/aiventyx-marketplace-plan');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-aiventyx-'));
}

test('Aiventyx listings cover free, Pro, and Teams without inventing traction', () => {
  const listings = buildAiventyxListings({
    appOrigin: 'https://thumbgate-production.up.railway.app',
    proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
    sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  });

  assert.deepEqual(listings.map((listing) => listing.key), ['free', 'pro', 'teams']);
  assert.ok(listings.every((listing) => listing.category === AI_CODING_CATEGORY));
  assert.equal(listings.find((listing) => listing.key === 'pro').pricingModel, '$19/mo or $149/yr');
  assert.match(listings.find((listing) => listing.key === 'pro').primaryCTA, /\/checkout\/pro$/);
  assert.match(listings.find((listing) => listing.key === 'teams').primaryCTA, /#workflow-sprint-intake$/);
  assert.ok(listings.every((listing) => listing.proofLinks.some((link) => /COMMERCIAL_TRUTH\.md/.test(link))));
  assert.ok(listings.every((listing) => !/guaranteed|partnered with|approved by/i.test(listing.description)));
});

test('90-day plan keeps paid conversion as the north star and defers deeper integration', () => {
  const plan = buildAiventyxNinetyDayPlan();

  assert.equal(plan.northStar, 'paid_conversion');
  assert.equal(plan.standardFeePosition, STANDARD_MARKETPLACE_FEE);
  assert.match(plan.integrationPosition, /60-90 days/);
  assert.ok(plan.metrics.includes('pro_paid_conversions'));
  assert.ok(plan.metrics.includes('qualified_team_conversations'));
  assert.match(plan.successThresholds.minimumUsefulSignal, /paid Pro conversion|qualified team conversation/);
  assert.ok(plan.successThresholds.doNotCountAsSuccess.some((item) => /views without CTA clicks/.test(item)));
});

test('follow-up draft accepts the marketplace phase without overcommitting', () => {
  const draft = buildAiventyxFollowUp(buildAiventyxNinetyDayPlan());

  assert.match(draft, /distribution-first lane/);
  assert.match(draft, /standard marketplace fee/);
  assert.match(draft, /listing views, CTA clicks, and conversion source fields/);
  assert.match(draft, /day 60-90/);
});

test('rendered pack is dashboard-ready and anchored to proof links', () => {
  const rendered = renderAiventyxMarketplaceMarkdown({
    ...buildAiventyxMarketplacePlan({
      appOrigin: 'https://thumbgate-production.up.railway.app',
      proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
      sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
    }),
    generatedAt: '2026-04-25T00:00:00.000Z',
  });

  assert.match(rendered, /Aiventyx Marketplace Revenue Pack/);
  assert.match(rendered, new RegExp(DASHBOARD_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(rendered, /ThumbGate Pro/);
  assert.match(rendered, /ThumbGate Teams/);
  assert.match(rendered, /paid_conversion/);
  assert.match(rendered, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(rendered, /guaranteed revenue|approved partner/i);
});

test('CLI options and report writing produce markdown and JSON artifacts', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const plan = buildAiventyxMarketplacePlan({
    appOrigin: 'https://thumbgate-production.up.railway.app',
    proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
    sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  });
  const written = writeAiventyxMarketplaceOutputs(plan, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'aiventyx-marketplace-plan.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'aiventyx-marketplace-plan.json')), true);

  const json = JSON.parse(fs.readFileSync(path.join(tempDir, 'aiventyx-marketplace-plan.json'), 'utf8'));
  assert.equal(json.listings.length, 3);
  assert.equal(json.ninetyDayPlan.northStar, 'paid_conversion');
});

test('CLI entrypoint detection is path based for importer safety', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'aiventyx-marketplace-plan.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'aiventyx-marketplace-plan.test.js')]), false);
});
