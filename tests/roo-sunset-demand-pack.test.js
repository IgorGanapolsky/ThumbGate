'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  CLINE_INSTALL_URL,
  GUIDE_URL,
  ROO_SUNSET_BLOG_URL,
  ROO_SUNSET_DOC_URL,
  buildChannelDrafts,
  buildEvidenceBackstop,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildRooSunsetDemandPack,
  buildTrackedRooLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderChannelDraftsCsv,
  renderRooSunsetDemandPackMarkdown,
  writeRooSunsetDemandPack,
} = require('../scripts/roo-sunset-demand-pack');

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

const REPORT_FIXTURE = {
  generatedAt: '2026-05-03T20:30:00.000Z',
  directive: {
    state: 'post-first-dollar',
    headline: 'Verified booked revenue exists. Use the Roo shutdown window to create more paid intent without overstating traction.',
  },
  targets: [
    {
      temperature: 'warm',
      offer: 'workflow_hardening_sprint',
      evidence: ['workflow control surface', 'business-system integration'],
    },
    {
      temperature: 'cold',
      offer: 'pro_self_serve',
      evidence: ['workflow control surface'],
    },
    {
      temperature: 'cold',
      offer: 'workflow_hardening_sprint',
      evidence: ['workflow control surface'],
    },
  ],
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-roo-demand-'));
}

test('tracked Roo links keep migration attribution machine-readable', () => {
  const link = new URL(buildTrackedRooLink(CLINE_INSTALL_URL, {
    utmCampaign: 'roo_cline_install',
    utmContent: 'install_doc',
    campaignVariant: 'migration_path',
    offerCode: 'ROO-CLINE_INSTALL',
    ctaId: 'roo_cline_install',
    ctaPlacement: 'pack_surface',
  }));

  assert.equal(link.searchParams.get('utm_source'), 'roo_sunset');
  assert.equal(link.searchParams.get('utm_campaign'), 'roo_cline_install');
  assert.equal(link.searchParams.get('surface'), 'roo_migration');
});

test('evidence backstop counts warm, self-serve, sprint, and workflow targets', () => {
  const backstop = buildEvidenceBackstop(REPORT_FIXTURE);

  assert.equal(backstop.warmTargetCount, 1);
  assert.equal(backstop.selfServeTargetCount, 1);
  assert.equal(backstop.sprintTargetCount, 2);
  assert.equal(backstop.workflowControlSurfaceCount, 3);
  assert.equal(backstop.businessSystemTargetCount, 1);
});

test('Roo demand surfaces stay tied to real shutdown, install, guide, and proof sources', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'roo_shutdown_notice',
    'cline_install_guide',
    'proof_backed_setup_guide',
    'verification_evidence',
  ]);
  assert.equal(surfaces[0].url, ROO_SUNSET_DOC_URL);
  assert.equal(surfaces[0].supportUrl, ROO_SUNSET_BLOG_URL);
  assert.match(surfaces[1].url, /adapters\/cline\/INSTALL\.md/);
  assert.match(surfaces[2].url, /\/guide\?/);
  assert.match(surfaces[3].url, /VERIFICATION_EVIDENCE\.md/);
});

test('follow-on offers and operator queue keep Pro and sprint motions explicit', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);
  const queue = buildOperatorQueue(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'sprint']);
  assert.equal(queue.length, 3);
  assert.match(queue[0].proofAsset, /\/guides\/roo-code-alternative-cline/);
  assert.match(queue[0].nextAsk, /\/guides\/roo-code-alternative-cline/);
  assert.match(queue[0].recommendedMotion, /Hosted migration guide -> exact Cline install doc -> Pro/);
  assert.match(queue[1].recommendedMotion, /Workflow Hardening Sprint first/);
  assert.match(queue[2].recommendedMotion, /Setup guide -> commercial truth -> Pro/);
});

test('outreach drafts keep first touch migration-first and reserve proof for pain-confirmed follow-up', () => {
  const drafts = buildOutreachDrafts(LINKS_FIXTURE);

  assert.equal(drafts.length, 3);
  assert.match(drafts[0].draft, /\/guides\/roo-code-alternative-cline/);
  assert.match(drafts[0].draft, /adapters\/cline\/INSTALL\.md/);
  assert.doesNotMatch(drafts[0].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[1].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[2].draft, /Workflow Hardening Sprint/i);
});

test('channel drafts stay tied to migration urgency and guide-first guardrails', () => {
  const drafts = buildChannelDrafts(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.equal(drafts.length, 4);
  assert.deepEqual(drafts.map((draft) => draft.channel), [
    'Reddit',
    'LinkedIn',
    'Threads',
    'Bluesky',
  ]);
  assert.match(drafts[0].cta, /\/guides\/roo-code-alternative-cline/);
  assert.match(drafts[1].cta, /workflow-sprint-intake/);
  assert.match(drafts[2].cta, /\/guide\?/);
  assert.match(drafts[3].cta, /\/guide\?/);
  assert.ok(drafts.every((draft) => !draft.draft.includes('VERIFICATION_EVIDENCE.md')));
});

test('measurement plan stays honest about migration clicks versus paid intent', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'roo_migration_to_paid_intent');
  assert.ok(plan.metrics.includes('roo_install_doc_clicks'));
  assert.ok(plan.metrics.includes('roo_pro_checkout_starts'));
  assert.ok(plan.doNotCountAsSuccess.some((entry) => /install-doc clicks without paid-intent evidence/i.test(entry)));
});

test('revenue-loop report reader falls back safely', () => {
  const tempDir = makeTempDir();
  const reportPath = path.join(tempDir, 'gtm-revenue-loop.json');
  fs.writeFileSync(reportPath, JSON.stringify({ directive: { state: 'cold-start' } }), 'utf8');

  assert.deepEqual(readRevenueLoopReport(path.join(tempDir, 'missing.json')), {});
  assert.deepEqual(readRevenueLoopReport(reportPath), { directive: { state: 'cold-start' } });
});

test('rendered pack is operator-ready and anchored to real migration and proof sources', () => {
  const pack = buildRooSunsetDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const markdown = renderRooSunsetDemandPackMarkdown(pack);

  assert.match(markdown, /Roo Sunset Demand Pack/);
  assert.match(markdown, new RegExp(CANONICAL_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /docs\.roocode\.com/);
  assert.match(markdown, /sunsetting-roo-code-extension-cloud-and-router/);
  assert.match(markdown, /Active Channel Drafts/);
  assert.match(markdown, /Evidence Backstop/);
  assert.doesNotMatch(markdown, /guaranteed revenue|approved marketplace|guaranteed installs/i);
});

test('channel draft CSV keeps active Roo outbound surfaces in one operator file', () => {
  const csv = renderChannelDraftsCsv(buildRooSunsetDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE));

  assert.match(csv, /^key,channel,format,audience,evidenceSummary,cta,proofTiming,draft/);
  assert.match(csv, /Reddit/);
  assert.match(csv, /LinkedIn/);
  assert.match(csv, /Bluesky/);
});

test('writer exports markdown, JSON, and CSV artifacts for Roo demand pack', () => {
  const reportDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', reportDir]);
  const pack = buildRooSunsetDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const written = writeRooSunsetDemandPack(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, reportDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(reportDir, 'roo-sunset-demand-pack.md')), true);
  assert.equal(fs.existsSync(path.join(reportDir, 'roo-sunset-demand-pack.json')), true);
  assert.equal(fs.existsSync(path.join(reportDir, 'roo-sunset-operator-queue.csv')), true);
  assert.equal(fs.existsSync(path.join(reportDir, 'roo-sunset-channel-drafts.csv')), true);
});

test('CLI invocation helper matches the script path only', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'roo-sunset-demand-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
