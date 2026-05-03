'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  buildEvidenceSurfaces,
  buildMeasurementPlan,
  buildOpenCodeRevenuePack,
  buildOperatorQueue,
  buildPackSummary,
  buildTrackedOpenCodeLink,
  findOpenCodeTargets,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderOpenCodeRevenuePackMarkdown,
  writeOpenCodeRevenuePack,
} = require('../scripts/opencode-revenue-pack');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-opencode-revenue-'));
}

test('tracked OpenCode links keep attribution machine-readable', () => {
  const trackedUrl = new URL(buildTrackedOpenCodeLink('https://thumbgate-production.up.railway.app/guide', {
    utmCampaign: 'opencode_setup_guide',
    utmContent: 'guide',
    campaignVariant: 'self_serve_proof',
    offerCode: 'OPENCODE-SETUP_GUIDE',
    ctaId: 'opencode_setup_guide',
    ctaPlacement: 'guide_surface',
  }));

  assert.equal(trackedUrl.searchParams.get('utm_source'), 'opencode');
  assert.equal(trackedUrl.searchParams.get('utm_medium'), 'integration_guide');
  assert.equal(trackedUrl.searchParams.get('utm_campaign'), 'opencode_setup_guide');
  assert.equal(trackedUrl.searchParams.get('surface'), 'opencode_profile');
});

test('OpenCode revenue pack keeps real shipped surfaces and proof links explicit', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'proof_backed_setup_guide',
    'integration_guide',
    'portable_profile_install',
    'portable_adapter_json',
    'repo_local_profile',
  ]);
  assert.match(surfaces[0].url, /\/guide\?/);
  assert.ok(surfaces.every((surface) => /VERIFICATION_EVIDENCE\.md/.test(surface.proofUrl)));
  assert.ok(surfaces.every((surface) => !/guaranteed installs|guaranteed revenue|approved marketplace/i.test(surface.operatorUse)));
});

test('OpenCode target extraction stays tied to the checked-in GTM report', () => {
  const report = readRevenueLoopReport();
  const targets = findOpenCodeTargets(report);

  assert.equal(targets.length >= 1, true);
  assert.equal(targets[0].repoName, 'opencode-swarm');
  assert.equal(targets[0].stars >= 1, true);
});

test('operator queue and summary stay evidence-backed', () => {
  const report = readRevenueLoopReport();
  const pack = buildOpenCodeRevenuePack(report, LINKS_FIXTURE, ABOUT_FIXTURE);
  const queue = buildOperatorQueue(report, LINKS_FIXTURE);

  assert.equal(pack.headline, CANONICAL_HEADLINE);
  assert.equal(pack.shortDescription, CANONICAL_SHORT_DESCRIPTION);
  assert.equal(queue.length, 3);
  assert.match(queue[0].evidence, /opencode-swarm/);
  assert.match(queue[0].recommendedMotion, /Guide -> prove one blocked repeat -> Pro\./);
  assert.match(buildPackSummary(report, findOpenCodeTargets(report)), /OpenCode-tagged target lane/);
});

test('measurement plan stays conservative about traction claims', () => {
  const plan = buildMeasurementPlan(1);

  assert.equal(plan.northStar, 'opencode_setup_to_paid_intent');
  assert.match(plan.policy, /tracked Pro checkout start|qualified sprint conversation/i);
  assert.ok(plan.metrics.includes('opencode_pro_checkout_starts'));
  assert.ok(plan.guardrails.some((entry) => /Do not claim installs, revenue, or marketplace approval/i.test(entry)));
});

test('rendered markdown and checked-in docs stay in sync', () => {
  const docsPath = path.join(__dirname, '..', 'docs', 'marketing', 'opencode-revenue-pack.md');
  const committed = fs.readFileSync(docsPath, 'utf8');
  const updatedMatch = committed.match(/^Updated: (.+)$/m);

  assert.ok(updatedMatch, 'expected checked-in pack to include an Updated line');

  const markdown = renderOpenCodeRevenuePackMarkdown({
    ...buildOpenCodeRevenuePack(readRevenueLoopReport(), LINKS_FIXTURE, ABOUT_FIXTURE),
    generatedAt: updatedMatch[1],
  });

  assert.equal(markdown, committed);
});

test('CLI writing emits markdown, json, and operator queue csv', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildOpenCodeRevenuePack(readRevenueLoopReport(), LINKS_FIXTURE, ABOUT_FIXTURE);
  const written = writeOpenCodeRevenuePack(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'opencode-revenue-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'opencode-revenue-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'opencode-operator-queue.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'opencode-revenue-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'opencode-revenue-pack.test.js')]), false);
});
