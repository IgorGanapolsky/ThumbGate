const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CHANNELS,
  VISUAL_ASSETS,
  buildChannelMeasurementPlan,
  buildPartnerListings,
  buildPartnerMarketplaceRevenuePack,
  buildPartnerTrackingMetadata,
  buildTrackedPartnerLink,
  isCliInvocation,
  parseArgs,
  renderPartnerMarketplaceCsv,
  renderPartnerMarketplaceMarkdown,
  writePartnerMarketplaceOutputs,
} = require('../scripts/partner-marketplace-revenue-pack');

const LINKS_FIXTURE = {
  appOrigin: 'https://thumbgate-production.up.railway.app',
  guideLink: 'https://thumbgate-production.up.railway.app/guide',
  proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
  sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  proPriceLabel: '$19/mo or $149/yr',
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-partner-marketplaces-'));
}

test('partner marketplace channels include Lindy, Gumroad, and GoHighLevel without fake approval claims', () => {
  const pack = buildPartnerMarketplaceRevenuePack(LINKS_FIXTURE);

  assert.deepEqual(pack.channels, ['Lindy.ai', 'Gumroad', 'GoHighLevel']);
  assert.deepEqual(pack.listings.map((listing) => listing.key), ['lindy', 'gumroad', 'gohighlevel']);
  assert.ok(pack.listings.every((listing) => /not claim|do not claim|prepare|create|start private/i.test(listing.listingStatus)));
  assert.ok(pack.listings.every((listing) => !/approved|guaranteed revenue|guaranteed installs|partnered with/i.test(listing.longDescription)));
  assert.ok(pack.listings.every((listing) => listing.proofLinks.some((link) => /VERIFICATION_EVIDENCE\.md/.test(link))));
});

test('tracked partner links keep attribution and plan metadata machine-readable', () => {
  const gumroad = CHANNELS.find((channel) => channel.key === 'gumroad');
  const metadata = buildPartnerTrackingMetadata(gumroad, 'pro');
  const tracked = new URL(buildTrackedPartnerLink('https://thumbgate-production.up.railway.app/go/pro', metadata));

  assert.equal(metadata.utmSource, 'gumroad');
  assert.equal(metadata.utmMedium, 'digital_product');
  assert.equal(metadata.offerCode, 'GUMROAD-PRO');
  assert.equal(tracked.searchParams.get('utm_source'), 'gumroad');
  assert.equal(tracked.searchParams.get('utm_medium'), 'digital_product');
  assert.equal(tracked.searchParams.get('utm_campaign'), 'gumroad_pro_listing');
  assert.equal(tracked.searchParams.get('plan_id'), 'pro');
  assert.equal(tracked.searchParams.get('surface'), 'gumroad_digital_product');
});

test('channel postures match current platform fit from official documentation', () => {
  const listings = buildPartnerListings(LINKS_FIXTURE);
  const lindy = listings.find((listing) => listing.key === 'lindy');
  const gumroad = listings.find((listing) => listing.key === 'gumroad');
  const ghl = listings.find((listing) => listing.key === 'gohighlevel');

  assert.match(lindy.productMotion, /Webhook and HTTP Request/i);
  assert.ok(lindy.officialSources.some((source) => /webhooks/.test(source)));
  assert.ok(lindy.officialSources.some((source) => /http-request/.test(source)));
  assert.match(lindy.longDescription, /Webhook trigger/i);
  assert.match(lindy.longDescription, /HTTP Request/i);
  assert.ok(lindy.submissionChecklist.some((item) => /webhook workflow/i.test(item)));
  assert.ok(lindy.submissionChecklist.some((item) => /allow, block, and checkpoint/i.test(item)));

  assert.match(gumroad.productMotion, /Digital product/i);
  assert.ok(gumroad.officialSources.some((source) => /gumroad\.com\/features/.test(source)));
  assert.match(gumroad.shortDescription, /setup kit/i);
  assert.match(gumroad.listingStatus, /digital product listing/i);
  assert.ok(gumroad.submissionChecklist.some((item) => /digital product/i.test(item)));
  assert.ok(gumroad.submissionChecklist.some((item) => /tracked Gumroad Pro CTA/i.test(item)));

  assert.match(ghl.productMotion, /Marketplace app/i);
  assert.ok(ghl.officialSources.some((source) => /CreateMarketplaceApp/.test(source)));
  assert.ok(ghl.officialSources.some((source) => /gohighlevel\.com\/landing-marketplace/.test(source)));
  assert.match(ghl.longDescription, /private marketplace app/i);
  assert.match(ghl.listingStatus, /private/i);
  assert.ok(ghl.submissionChecklist.some((item) => /private marketplace app/i.test(item)));
  assert.ok(ghl.submissionChecklist.some((item) => /qualified agency workflow conversation/i.test(item)));
});

test('visual asset audit covers square icons, OG graphics, and listing screenshots', () => {
  const pack = buildPartnerMarketplaceRevenuePack(LINKS_FIXTURE);
  const assetFiles = pack.visualAssets.map((asset) => asset.file);

  assert.equal(VISUAL_ASSETS.length >= 8, true);
  assert.ok(assetFiles.includes('public/assets/brand/thumbgate-icon-512.png'));
  assert.ok(assetFiles.includes('public/og.png'));
  assert.ok(assetFiles.includes('plugins/cursor-marketplace/assets/logo-400x400.png'));
  assert.ok(assetFiles.includes('docs/marketing/gallery/05-hero.png'));
  assert.ok(assetFiles.includes('docs/marketing/gallery/01-dashboard.png'));
  assert.ok(pack.visualAssets.some((asset) => asset.dimensions === '1200x630'));
  assert.ok(pack.visualAssets.some((asset) => asset.dimensions === '512x512'));
  assert.ok(pack.listings.every((listing) => listing.assetManifest.length >= 3));
  assert.ok(pack.visualAssetReview.some((item) => /marketplace-ready/i.test(item)));
  assert.ok(pack.visualAssetReview.some((item) => /not be the primary conversion graphic/i.test(item)));
  assert.ok(pack.visualAssetReview.some((item) => /proof-forward gallery assets/i.test(item)));
  assert.ok(pack.visualAssets.some((asset) => asset.key === 'og_image' && asset.status === 'ready_supporting_asset'));
  assert.ok(pack.visualAssets.some((asset) => asset.key === 'github_social_preview' && asset.status === 'ready_supporting_asset'));
  assert.ok(
    pack.listings
      .filter((listing) => listing.key === 'lindy' || listing.key === 'gohighlevel')
      .every((listing) => !listing.assetManifest.some((asset) => asset.key === 'og_image')),
  );
});

test('measurement plan treats marketplace activity as acquisition until paid intent exists', () => {
  const plan = buildChannelMeasurementPlan();

  assert.equal(plan.northStar, 'paid_conversion_or_qualified_team_conversation');
  assert.match(plan.policy, /tracked Pro checkout start/i);
  assert.ok(plan.metrics.includes('paid_pro_conversions'));
  assert.ok(plan.metrics.includes('qualified_team_conversations'));
  assert.ok(plan.successThresholds.doNotCountAsSuccess.some((item) => /listing creation without tracked clicks/i.test(item)));
});

test('rendered partner marketplace artifacts are operator-ready and source-backed', () => {
  const pack = {
    ...buildPartnerMarketplaceRevenuePack(LINKS_FIXTURE),
    generatedAt: '2026-05-05T12:00:00.000Z',
  };
  const markdown = renderPartnerMarketplaceMarkdown(pack);
  const csv = renderPartnerMarketplaceCsv(pack);

  assert.match(markdown, /Partner Marketplace Revenue Pack/);
  assert.match(markdown, /Lindy\.ai/);
  assert.match(markdown, /Gumroad/);
  assert.match(markdown, /GoHighLevel/);
  assert.match(markdown, /Visual Asset Audit/);
  assert.match(markdown, /Logo-only OG and GitHub preview images are brand-safe supporting assets/);
  assert.match(markdown, /Submission checklist/);
  assert.match(markdown, /Create a Gumroad digital product for the AI Agent Mistake Prevention Kit/);
  assert.match(markdown, /Create or update a GoHighLevel private marketplace app or agency snapshot first/);
  assert.match(markdown, /docs\.lindy\.ai\/skills\/by-lindy\/webhooks/);
  assert.match(markdown, /gumroad\.com\/features/);
  assert.match(markdown, /marketplace\.gohighlevel\.com\/docs\/oauth\/CreateMarketplaceApp/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.doesNotMatch(markdown, /guaranteed revenue|approved partner/i);

  assert.match(csv, /^key,name,productMotion,listingStatus,/);
  assert.match(csv.split('\n')[0], /submission_checklist/);
  assert.match(csv, /lindy_sprint_listing/);
  assert.match(csv, /gumroad_pro_listing/);
  assert.match(csv, /gohighlevel_sprint_listing/);
});

test('checked-in partner marketplace pack stays in sync with the generator output', () => {
  const docsPath = path.join(__dirname, '..', 'docs', 'marketing', 'partner-marketplace-revenue-pack.md');
  const committed = fs.readFileSync(docsPath, 'utf8');
  const updatedMatch = committed.match(/^Updated: (.+)$/m);

  assert.ok(updatedMatch, 'expected checked-in pack to include an Updated line');

  const markdown = renderPartnerMarketplaceMarkdown({
    ...buildPartnerMarketplaceRevenuePack(LINKS_FIXTURE),
    generatedAt: updatedMatch[1],
  });

  assert.equal(markdown, committed);
});

test('CLI options and report writing produce markdown, JSON, and CSV artifacts', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildPartnerMarketplaceRevenuePack(LINKS_FIXTURE);
  const written = writePartnerMarketplaceOutputs(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'partner-marketplace-revenue-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'partner-marketplace-revenue-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'partner-marketplace-listings.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'partner-marketplace-revenue-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'partner-marketplace-revenue-pack.test.js')]), false);
});
