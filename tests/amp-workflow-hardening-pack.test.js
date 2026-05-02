'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  AMP_GUIDE_URL,
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  HARNESS_GUIDE_URL,
  buildAmpWorkflowHardeningPack,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedAmpLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderAmpOperatorQueueCsv,
  renderAmpWorkflowHardeningPackMarkdown,
  writeAmpWorkflowHardeningPack,
} = require('../scripts/amp-workflow-hardening-pack');

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
  directive: {
    state: 'post-first-dollar',
    headline: 'Verified booked revenue exists. Keep selling one concrete Workflow Hardening Sprint first, then route self-serve buyers to Pro.',
  },
  targets: [
    {
      temperature: 'warm',
      evidence: ['production or platform workflow'],
    },
    {
      temperature: 'warm',
      evidence: ['self-serve agent tooling'],
    },
    {
      temperature: 'cold',
      evidence: ['production or platform workflow'],
    },
  ],
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-amp-pack-'));
}

test('Amp demand surfaces stay tied to real guides and proof surfaces', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'amp_guardrails_guide',
    'agent_harness_guide',
    'proof_backed_setup_guide',
  ]);
  assert.match(surfaces[0].url, /guides\/amp-agent-guardrails\?/);
  assert.match(surfaces[1].url, /guides\/agent-harness-optimization\?/);
  assert.match(surfaces[2].url, /\/guide\?/);
  assert.ok(surfaces.every((surface) => !/guaranteed revenue|approved marketplace|top ranking/i.test(surface.operatorUse)));
});

test('tracked Amp links keep attribution machine-readable', () => {
  const ampGuideUrl = new URL(buildTrackedAmpLink(AMP_GUIDE_URL, {
    utmCampaign: 'amp_guardrails_guide',
    utmContent: 'seo_page',
    campaignVariant: 'workflow_guardrails',
    offerCode: 'AMP-GUARDRAILS_GUIDE',
    ctaId: 'amp_guardrails_guide',
    ctaPlacement: 'guide_surface',
  }));
  const harnessGuideUrl = new URL(buildTrackedAmpLink(HARNESS_GUIDE_URL, {
    utmCampaign: 'amp_harness_guide',
    utmContent: 'guide',
    campaignVariant: 'harness_proof',
    offerCode: 'AMP-HARNESS_GUIDE',
    ctaId: 'amp_harness_guide',
    ctaPlacement: 'guide_surface',
  }));

  assert.equal(ampGuideUrl.searchParams.get('utm_source'), 'amp');
  assert.equal(ampGuideUrl.searchParams.get('utm_medium'), 'guide_surface');
  assert.equal(ampGuideUrl.searchParams.get('utm_campaign'), 'amp_guardrails_guide');
  assert.equal(harnessGuideUrl.searchParams.get('utm_content'), 'guide');
  assert.equal(harnessGuideUrl.searchParams.get('surface'), 'amp');
});

test('follow-on offers and operator queue keep Pro and sprint motions explicit', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);
  const queue = buildOperatorQueue(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'sprint']);
  assert.match(offers[0].cta, /utm_campaign=amp_pro_follow_on/);
  assert.match(offers[1].cta, /utm_campaign=amp_team_follow_on/);
  assert.equal(queue.length, 3);
  assert.match(queue[0].recommendedMotion, /Guide -> proof -> Workflow Hardening Sprint/);
  assert.match(queue[2].recommendedMotion, /Setup guide -> proof -> Pro/);
});

test('outreach drafts avoid leading with proof before pain is confirmed', () => {
  const drafts = buildOutreachDrafts(LINKS_FIXTURE);

  assert.equal(drafts.length, 3);
  assert.match(drafts[0].draft, /guides\/amp-agent-guardrails/);
  assert.doesNotMatch(drafts[0].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[1].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[2].draft, /workflow hardening lane/i);
});

test('revenue-loop report reader falls back safely and parses live JSON when present', () => {
  const tempDir = makeTempDir();
  const reportPath = path.join(tempDir, 'gtm-revenue-loop.json');
  fs.writeFileSync(reportPath, JSON.stringify({ directive: { state: 'cold-start' } }), 'utf8');

  assert.deepEqual(readRevenueLoopReport(path.join(tempDir, 'missing.json')), {});
  assert.deepEqual(readRevenueLoopReport(reportPath), { directive: { state: 'cold-start' } });
});

test('measurement plan stays honest about guide traffic versus paid intent', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'amp_guide_to_paid_intent');
  assert.match(plan.policy, /tracked proof click, Pro checkout start, or qualified workflow-sprint conversation/i);
  assert.ok(plan.metrics.includes('amp_guardrails_guide_views'));
  assert.ok(plan.metrics.includes('paid_pro_conversions'));
  assert.ok(plan.doNotCountAsSuccess.some((entry) => /guide views without proof clicks/i.test(entry)));
});

test('rendered pack is operator-ready and anchored to guides plus proof', () => {
  const pack = buildAmpWorkflowHardeningPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const markdown = renderAmpWorkflowHardeningPackMarkdown({
    ...pack,
    generatedAt: '2026-05-02T12:00:00.000Z',
  });

  assert.match(markdown, /Amp Workflow Hardening Pack/);
  assert.match(markdown, new RegExp(CANONICAL_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /guides\/amp-agent-guardrails/);
  assert.match(markdown, /guides\/agent-harness-optimization/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(markdown, /guaranteed revenue|approved marketplace|top ranking/i);
});

test('CSV export keeps one operator queue file for Amp lanes', () => {
  const csv = renderAmpOperatorQueueCsv(buildAmpWorkflowHardeningPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE));

  assert.match(csv, /^key,audience,evidence,proofTrigger,proofAsset,nextAsk,recommendedMotion/);
  assert.match(csv, /amp_workflow_owner/);
  assert.match(csv, /amp_team_rollout_owner/);
  assert.match(csv, /amp_solo_operator/);
});

test('CLI options and artifact writing emit markdown, JSON, and queue CSV', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildAmpWorkflowHardeningPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const written = writeAmpWorkflowHardeningPack(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'amp-workflow-hardening-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'amp-workflow-hardening-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'amp-operator-queue.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'amp-workflow-hardening-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'amp-workflow-hardening-pack.test.js')]), false);
});

test('Amp guide uses the real CLI agent flag', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'guides', 'amp-agent-guardrails.html'), 'utf8');

  assert.match(html, /npx thumbgate init --agent amp/);
  assert.doesNotMatch(html, /--agent amp-cli/);
  assert.match(html, /Go Pro — \$19\/mo/);
});
