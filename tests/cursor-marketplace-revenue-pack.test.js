const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_SHORT_DESCRIPTION,
  CURSOR_DIRECTORY_URL,
  CURSOR_PUBLISH_URL,
  DIRECTORY_MEDIUM,
  MARKETPLACE_MEDIUM,
  TEAM_MARKETPLACE_MEDIUM,
  buildCursorMarketplaceRevenuePack,
  buildCursorMarketplaceSurfaces,
  buildCursorTrackingMetadata,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildTrackedCursorLink,
  isCliInvocation,
  parseArgs,
  renderCursorMarketplaceRevenuePackCsv,
  renderCursorMarketplaceRevenuePackMarkdown,
  writeCursorMarketplaceRevenuePack,
} = require('../scripts/cursor-marketplace-revenue-pack');

const LINKS_FIXTURE = {
  appOrigin: 'https://thumbgate-production.up.railway.app',
  proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
  sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  proPriceLabel: '$19/mo or $149/yr',
};

const ABOUT_FIXTURE = {
  repositoryUrl: 'https://github.com/IgorGanapolsky/ThumbGate',
  homepageUrl: 'https://thumbgate-production.up.railway.app',
  githubDescription: 'Agent governance for ThumbGate.',
  topics: ['thumbgate', 'pre-action-checks', 'cursor', 'agent-reliability', 'guardrails', 'developer-tools'],
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-cursor-marketplace-'));
}

function buildPack() {
  return buildCursorMarketplaceRevenuePack(LINKS_FIXTURE, ABOUT_FIXTURE);
}

test('Cursor surfaces cover marketplace, directory, and team rollout lanes without fake approval claims', () => {
  const surfaces = buildCursorMarketplaceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), ['marketplace', 'directory', 'team_marketplace']);
  assert.equal(surfaces[0].submissionUrl, CURSOR_PUBLISH_URL);
  assert.equal(surfaces[1].submissionUrl, CURSOR_DIRECTORY_URL);
  assert.match(surfaces[0].shortDescription, /Thumbs down a mistake/i);
  assert.ok(surfaces.every((surface) => surface.proofLinks.some((link) => /COMMERCIAL_TRUTH\.md/.test(link))));
  assert.ok(surfaces.every((surface) => !/approved|partnered|guaranteed revenue/i.test(surface.longDescription)));
});

test('tracked Cursor links keep source, medium, and campaign machine-readable', () => {
  const marketplaceTracking = buildCursorTrackingMetadata('plugin_homepage', {
    utmMedium: MARKETPLACE_MEDIUM,
    utmCampaign: 'cursor_plugin_listing',
    utmContent: 'homepage',
  });
  const directoryTracking = buildCursorTrackingMetadata('directory_homepage', {
    utmMedium: DIRECTORY_MEDIUM,
    utmCampaign: 'cursor_directory_profile',
    utmContent: 'homepage',
  });
  const teamTracking = buildCursorTrackingMetadata('team_marketplace_homepage', {
    utmMedium: TEAM_MARKETPLACE_MEDIUM,
    utmCampaign: 'cursor_team_marketplace',
    utmContent: 'homepage',
  });
  const marketplaceUrl = new URL(buildTrackedCursorLink('https://thumbgate-production.up.railway.app', marketplaceTracking));
  const directoryUrl = new URL(buildTrackedCursorLink('https://thumbgate-production.up.railway.app', directoryTracking));
  const teamUrl = new URL(buildTrackedCursorLink('https://thumbgate-production.up.railway.app/#workflow-sprint-intake', teamTracking));

  assert.equal(marketplaceUrl.searchParams.get('utm_source'), 'cursor');
  assert.equal(marketplaceUrl.searchParams.get('utm_medium'), MARKETPLACE_MEDIUM);
  assert.equal(marketplaceUrl.searchParams.get('utm_campaign'), 'cursor_plugin_listing');
  assert.equal(directoryUrl.searchParams.get('utm_medium'), DIRECTORY_MEDIUM);
  assert.equal(teamUrl.searchParams.get('utm_medium'), TEAM_MARKETPLACE_MEDIUM);
  assert.equal(teamUrl.searchParams.get('surface'), 'team_marketplace_homepage');
});

test('follow-on offers keep Pro and team motions explicit after install', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'teams']);
  assert.equal(offers[0].pricingModel, '$19/mo or $149/yr');
  assert.match(offers[0].cta, /utm_campaign=cursor_plugin_follow_on/);
  assert.match(offers[1].cta, /utm_campaign=cursor_team_follow_on/);
});

test('measurement plan stays honest about paid intent versus bare installs', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'plugin_install_to_paid_intent');
  assert.match(plan.policy, /tracked follow-on event/);
  assert.ok(plan.metrics.includes('plugin_installs'));
  assert.ok(plan.metrics.includes('paid_pro_conversions'));
  assert.ok(plan.successThresholds.doNotCountAsSuccess.some((item) => /installs without a tracked follow-on event/i.test(item)));
});

test('rendered pack is operator-ready and anchored to proof plus screenshots', () => {
  const rendered = renderCursorMarketplaceRevenuePackMarkdown({
    ...buildPack(),
    generatedAt: '2026-04-25T00:00:00.000Z',
  });

  assert.match(rendered, /Cursor Marketplace Revenue Pack/);
  assert.match(rendered, /ThumbGate/);
  assert.match(rendered, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(rendered, /Cursor Marketplace/);
  assert.match(rendered, /Cursor Directory/);
  assert.match(rendered, /Cursor Team Marketplace/);
  assert.match(rendered, /VERIFICATION_EVIDENCE\.md/);
  assert.match(rendered, /docs\/marketing\/gallery\/05-hero\.png/);
  assert.doesNotMatch(rendered, /approved partner|guaranteed installs|guaranteed revenue/i);
});

test('CSV export keeps submission fields in one operator file', () => {
  const csv = renderCursorMarketplaceRevenuePackCsv(buildPack());

  assert.match(csv, /^key,name,role,operatorStatus,conversionGoal,/);
  assert.match(csv, /Cursor Marketplace/);
  assert.match(csv, /Cursor Directory/);
  assert.match(csv, /Cursor Team Marketplace/);
  assert.match(csv, /cursor_plugin_listing/);
});

test('CLI options and report writing produce markdown, JSON, and CSV artifacts', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const plan = buildPack();
  const written = writeCursorMarketplaceRevenuePack(plan, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'cursor-marketplace-revenue-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'cursor-marketplace-revenue-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'cursor-marketplace-surfaces.csv')), true);

  const json = JSON.parse(fs.readFileSync(path.join(tempDir, 'cursor-marketplace-revenue-pack.json'), 'utf8'));
  assert.equal(json.surfaces.length, 3);
  assert.equal(json.measurementPlan.northStar, 'plugin_install_to_paid_intent');
  assert.match(fs.readFileSync(path.join(tempDir, 'cursor-marketplace-surfaces.csv'), 'utf8'), /utm_source/);
});

test('CLI entrypoint detection is path based for importer safety', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'cursor-marketplace-revenue-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'cursor-marketplace-revenue-pack.test.js')]), false);
});
