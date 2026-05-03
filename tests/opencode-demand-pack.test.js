'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  GUIDE_URL,
  MULTICA_GUIDE_URL,
  OPENCODE_INSTALL_URL,
  OPENCODE_INTEGRATION_URL,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOpencodeDemandPack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedOpencodeLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderOpencodeDemandPackMarkdown,
  renderOpencodeOperatorQueueCsv,
  writeOpencodeDemandPack,
} = require('../scripts/opencode-demand-pack');

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
  githubDescription: 'Agent governance for ThumbGate: 👍/👎 become Pre-Action Checks that block repeat mistakes before code, money, or customer systems change.',
};

const REPORT_FIXTURE = {
  directive: {
    state: 'post-first-dollar',
  },
  targets: [
    {
      repoName: 'opencode-swarm',
      description: 'Architect-centric agentic swarm plugin for OpenCode',
      evidence: ['workflow control surface', 'self-serve agent tooling'],
    },
    {
      repoName: 'engine_context',
      description: 'workflow control surface with production workflow',
      evidence: ['workflow control surface', 'production or platform workflow'],
    },
  ],
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-opencode-demand-'));
}

test('OpenCode demand surfaces stay tied to real repo and hosted proof surfaces', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'multica_autopilot_guide',
    'repo_native_integration_doc',
    'portable_profile_install',
    'proof_backed_setup_guide',
  ]);
  assert.match(surfaces[0].url, /guides\/multica-thumbgate-setup\?/);
  assert.equal(surfaces[1].url, OPENCODE_INTEGRATION_URL);
  assert.equal(surfaces[2].url, OPENCODE_INSTALL_URL);
  assert.match(surfaces[3].url, /guide\?/);
  assert.ok(surfaces.every((surface) => /VERIFICATION_EVIDENCE\.md/.test(surface.proofUrl)));
});

test('tracked OpenCode links keep attribution machine-readable', () => {
  const multicaUrl = new URL(buildTrackedOpencodeLink(MULTICA_GUIDE_URL, {
    utmCampaign: 'opencode_multica_guide',
    utmContent: 'autopilot',
    campaignVariant: 'scheduled_jobs',
    offerCode: 'OPENCODE-MULTICA_GUIDE',
    ctaId: 'opencode_multica_guide',
    ctaPlacement: 'guide_surface',
  }));
  const guideUrl = new URL(buildTrackedOpencodeLink(GUIDE_URL, {
    utmCampaign: 'opencode_setup_guide',
    utmContent: 'setup',
    campaignVariant: 'proof_backed_setup',
    offerCode: 'OPENCODE-SETUP_GUIDE',
    ctaId: 'opencode_setup_guide',
    ctaPlacement: 'guide_surface',
  }));

  assert.equal(multicaUrl.searchParams.get('utm_source'), 'opencode');
  assert.equal(multicaUrl.searchParams.get('utm_medium'), 'guide');
  assert.equal(multicaUrl.searchParams.get('surface'), 'opencode');
  assert.equal(guideUrl.searchParams.get('utm_campaign'), 'opencode_setup_guide');
});

test('follow-on offers and queue keep solo Pro and workflow hardening explicit', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);
  const queue = buildOperatorQueue(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'sprint']);
  assert.match(offers[0].cta, /utm_campaign=opencode_pro_follow_on/);
  assert.match(offers[1].cta, /utm_campaign=opencode_team_follow_on/);
  assert.equal(queue.length, 3);
  assert.match(queue[0].recommendedMotion, /Workflow Hardening Sprint/);
  assert.match(queue[1].recommendedMotion, /Pro after one blocked repeat/);
});

test('outreach drafts keep proof out of first touch and add it after pain is confirmed', () => {
  const drafts = buildOutreachDrafts(LINKS_FIXTURE);

  assert.equal(drafts.length, 3);
  assert.match(drafts[0].draft, /guide/);
  assert.doesNotMatch(drafts[0].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[1].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[2].draft, /Workflow Hardening Sprint/);
});

test('measurement plan stays honest about paid intent versus acquisition clicks', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'opencode_install_to_paid_intent');
  assert.ok(plan.metrics.includes('opencode_multica_guide_views'));
  assert.ok(plan.metrics.includes('paid_pro_conversions'));
  assert.ok(plan.doNotCountAsSuccess.some((entry) => /unverified install or revenue claims/i.test(entry)));
});

test('rendered pack is operator-ready and anchored to OpenCode proof surfaces', () => {
  const pack = buildOpencodeDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const markdown = renderOpencodeDemandPackMarkdown({
    ...pack,
    generatedAt: '2026-05-02T16:00:00.000Z',
  });

  assert.match(markdown, /OpenCode Demand Pack/);
  assert.match(markdown, new RegExp(CANONICAL_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /multica-thumbgate-setup/);
  assert.match(markdown, /opencode-integration\.md/);
  assert.match(markdown, /plugins\/opencode-profile\/INSTALL\.md/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(markdown, /guaranteed revenue|approved marketplace|top ranking/i);
});

test('CSV export keeps one operator queue file for OpenCode lanes', () => {
  const csv = renderOpencodeOperatorQueueCsv(buildOpencodeDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE));

  assert.match(csv, /^key,audience,evidence,proofTrigger,proofAsset,nextAsk,recommendedMotion/);
  assert.match(csv, /autopilot_workflow_owner/);
  assert.match(csv, /repo_native_builder/);
});

test('revenue-loop report reader falls back safely and parses live JSON when present', () => {
  const tempDir = makeTempDir();
  const reportPath = path.join(tempDir, 'gtm-revenue-loop.json');
  fs.writeFileSync(reportPath, JSON.stringify({ directive: { state: 'cold-start' } }), 'utf8');

  assert.deepEqual(readRevenueLoopReport(path.join(tempDir, 'missing.json')), {});
  assert.deepEqual(readRevenueLoopReport(reportPath), { directive: { state: 'cold-start' } });
});

test('CLI options and artifact writing emit markdown, JSON, and queue CSV', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildOpencodeDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const written = writeOpencodeDemandPack(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'opencode-demand-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'opencode-demand-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'opencode-operator-queue.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'opencode-demand-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'opencode-demand-pack.test.js')]), false);
});
