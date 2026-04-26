'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  buildCodexMarketplaceRevenuePack,
  buildEvidenceSurfaces,
  buildListingCopy,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedCodexLink,
  isCliInvocation,
  parseArgs,
  renderCodexMarketplaceRevenuePackMarkdown,
  renderCodexOperatorQueueCsv,
  writeCodexMarketplaceRevenuePack,
} = require('../scripts/codex-marketplace-revenue-pack');

const LINKS_FIXTURE = {
  appOrigin: 'https://thumbgate-production.up.railway.app',
  guideLink: 'https://thumbgate-production.up.railway.app/guide',
  proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
  sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  proPriceLabel: '$19/mo or $149/yr',
};

const ABOUT_FIXTURE = {
  repositoryUrl: 'https://github.com/IgorGanapolsky/ThumbGate',
  homepageUrl: 'https://thumbgate-production.up.railway.app',
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-codex-marketplace-'));
}

test('Codex evidence surfaces stay tied to real install, release, and proof surfaces', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE, path.join(__dirname, '..'));

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'install_page',
    'standalone_bundle',
    'repo_profile',
    'codex_bridge',
  ]);
  assert.match(surfaces[0].url, /\/codex-plugin\?/);
  assert.match(surfaces[1].url, /thumbgate-codex-plugin\.zip/);
  assert.ok(surfaces.every((surface) => /VERIFICATION_EVIDENCE\.md/.test(surface.proofUrl)));
  assert.ok(surfaces.every((surface) => !/guaranteed revenue|approved marketplace|partnered/i.test(surface.operatorUse)));
});

test('tracked Codex links keep attribution machine-readable', () => {
  const installUrl = new URL(buildTrackedCodexLink('https://thumbgate-production.up.railway.app/codex-plugin', {
    utmCampaign: 'codex_plugin_page',
    utmContent: 'install_page',
    campaignVariant: 'install_page',
    offerCode: 'CODEX-INSTALL_PAGE',
    ctaId: 'codex_install_page',
    ctaPlacement: 'install_surface',
  }));

  assert.equal(installUrl.searchParams.get('utm_source'), 'codex');
  assert.equal(installUrl.searchParams.get('utm_medium'), 'plugin_page');
  assert.equal(installUrl.searchParams.get('utm_campaign'), 'codex_plugin_page');
  assert.equal(installUrl.searchParams.get('surface'), 'codex_plugin');
});

test('listing copy keeps proof and follow-on motions explicit', () => {
  const listingCopy = buildListingCopy(LINKS_FIXTURE);

  assert.equal(listingCopy.headline, CANONICAL_HEADLINE);
  assert.equal(listingCopy.shortDescription, CANONICAL_SHORT_DESCRIPTION);
  assert.match(listingCopy.primaryCta.url, /thumbgate-codex-plugin\.zip/);
  assert.match(listingCopy.proofCta.url, /VERIFICATION_EVIDENCE\.md/);
  assert.match(listingCopy.followOnOffers[0].cta, /utm_campaign=codex_plugin_follow_on/);
  assert.match(listingCopy.followOnOffers[1].cta, /utm_campaign=codex_team_follow_on/);
});

test('operator queue and outreach drafts stay proof-first and avoid fake traction', () => {
  const queue = buildOperatorQueue(LINKS_FIXTURE);
  const drafts = buildOutreachDrafts(LINKS_FIXTURE);

  assert.equal(queue.length, 3);
  assert.equal(drafts.length, 3);
  assert.ok(queue.every((entry) => /VERIFICATION_EVIDENCE\.md|INSTALL\.md|claude-codex-bridge\/README\.md/.test(entry.proofAsset)));
  assert.ok(drafts.every((entry) => !/guaranteed installs|guaranteed revenue|approved marketplace/i.test(entry.draft)));
});

test('measurement plan treats installs as acquisition only until paid intent exists', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'codex_install_to_paid_intent');
  assert.match(plan.policy, /tracked Pro checkout start|qualified sprint conversation/i);
  assert.ok(plan.metrics.includes('codex_bundle_downloads'));
  assert.ok(plan.guardrails.some((entry) => /Do not claim installs, revenue, or marketplace approval/i.test(entry)));
});

test('rendered markdown and CSV stay operator-ready', () => {
  const pack = buildCodexMarketplaceRevenuePack(LINKS_FIXTURE, ABOUT_FIXTURE, path.join(__dirname, '..'));
  const markdown = renderCodexMarketplaceRevenuePackMarkdown({
    ...pack,
    generatedAt: '2026-04-26T12:00:00.000Z',
  });
  const csv = renderCodexOperatorQueueCsv(pack);

  assert.match(markdown, /Codex Operator Revenue Pack/);
  assert.match(markdown, /Stop Codex from repeating the same tool mistake/);
  assert.match(markdown, /thumbgate-production\.up\.railway\.app\/codex-plugin/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.match(markdown, /Workflow Hardening Sprint/);
  assert.doesNotMatch(markdown, /approved marketplace|guaranteed installs|guaranteed revenue/i);
  assert.match(csv, /^key,persona,evidence,proofTrigger,proofAsset,nextAsk,recommendedMotion/);
  assert.match(csv, /solo_repeat_mistake/);
});

test('checked-in Codex marketplace pack stays in sync with the generator output', () => {
  const docsPath = path.join(__dirname, '..', 'docs', 'marketing', 'codex-marketplace-revenue-pack.md');
  const committed = fs.readFileSync(docsPath, 'utf8');
  const updatedMatch = committed.match(/^Updated: (.+)$/m);

  assert.ok(updatedMatch, 'expected checked-in pack to include an Updated line');

  const markdown = renderCodexMarketplaceRevenuePackMarkdown({
    ...buildCodexMarketplaceRevenuePack(LINKS_FIXTURE, ABOUT_FIXTURE, path.join(__dirname, '..')),
    generatedAt: updatedMatch[1],
  });

  assert.equal(markdown, committed);
});

test('CLI options and artifact writing emit markdown, JSON, and queue CSV', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildCodexMarketplaceRevenuePack(LINKS_FIXTURE, ABOUT_FIXTURE, path.join(__dirname, '..'));
  const written = writeCodexMarketplaceRevenuePack(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'codex-marketplace-revenue-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'codex-marketplace-revenue-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'codex-operator-queue.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'codex-marketplace-revenue-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'codex-marketplace-revenue-pack.test.js')]), false);
});
