'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  MULTICA_GUIDE_URL,
  OPENCODE_GUIDE_URL,
  OPENCODE_INSTALL_URL,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildListingCopy,
  buildMeasurementPlan,
  buildOpenCodeRevenuePack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildProspectQueue,
  buildTrackedOpenCodeLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderOpenCodeProspectQueueCsv,
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

const REPORT_FIXTURE = {
  directive: {
    state: 'post-first-dollar',
    headline: 'Verified booked revenue exists. Keep selling one concrete Workflow Hardening Sprint first, then route self-serve buyers to Pro.',
  },
  targets: [
    {
      temperature: 'cold',
      source: 'github',
      channel: 'github',
      username: 'zaxbysauce',
      repoName: 'opencode-swarm',
      repoUrl: 'https://github.com/zaxbysauce/opencode-swarm',
      description: 'Architect-centric agentic swarm plugin for OpenCode.',
      evidenceScore: 12,
      evidence: ['workflow control surface', 'self-serve agent tooling'],
      motionLabel: 'Pro at $19/mo or $149/yr',
      motionReason: 'Target looks like a local hook, plugin, or config surface, so start with the setup guide and Pro follow-on before pitching a sprint.',
      cta: 'https://thumbgate-production.up.railway.app/guide',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      firstTouchDraft: 'Hey @zaxbysauce, saw you are building around opencode-swarm.',
      pipelineLeadId: 'github_zaxbysauce_opencode_swarm',
      salesCommands: {
        markContacted: 'npm run sales:pipeline -- advance --lead github_zaxbysauce_opencode_swarm --stage contacted',
      },
    },
    {
      evidence: ['production or platform workflow'],
    },
  ],
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-opencode-revenue-pack-'));
}

test('OpenCode evidence surfaces stay tied to real install, config, and self-hosted guides', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE, REPORT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'repo_integration_guide',
    'portable_install_profile',
    'repo_config_surface',
    'self_hosted_orchestrator_guide',
    'proof_backed_setup_guide',
  ]);
  assert.equal(surfaces[0].url, OPENCODE_GUIDE_URL);
  assert.match(surfaces[1].url, /utm_campaign=opencode_install_profile/);
  assert.equal(surfaces[3].supportUrl, 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/multica-thumbgate-setup.html');
  assert.ok(surfaces.every((surface) => /VERIFICATION_EVIDENCE\.md/.test(surface.proofUrl)));
  assert.ok(surfaces.every((surface) => !/guaranteed revenue|approved marketplace|top ranking/i.test(surface.operatorUse)));
});

test('tracked OpenCode links keep attribution machine-readable', () => {
  const installUrl = new URL(buildTrackedOpenCodeLink(OPENCODE_INSTALL_URL, {
    utmCampaign: 'opencode_install_profile',
    utmContent: 'install_doc',
    campaignVariant: 'portable_install',
    offerCode: 'OPENCODE-INSTALL_PROFILE',
    ctaId: 'opencode_install_profile',
    ctaPlacement: 'install_surface',
  }));

  assert.equal(installUrl.searchParams.get('utm_source'), 'opencode');
  assert.equal(installUrl.searchParams.get('utm_medium'), 'integration_guide');
  assert.equal(installUrl.searchParams.get('surface'), 'opencode');
});

test('follow-on offers, listing copy, and operator queue keep self-serve and sprint motions explicit', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);
  const listing = buildListingCopy(LINKS_FIXTURE);
  const queue = buildOperatorQueue(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'sprint']);
  assert.match(offers[0].cta, /utm_campaign=opencode_pro_follow_on/);
  assert.equal(listing.headline, CANONICAL_HEADLINE);
  assert.equal(listing.shortDescription, 'Local-first guardrails for OpenCode. Capture feedback, promote repeated failures into Pre-Action Checks, and keep proof close to the install path.');
  assert.equal(queue.length, 3);
  assert.match(queue[0].recommendedMotion, /Portable install -> one blocked repeat -> Pro/);
  assert.match(queue[2].recommendedMotion, /Workflow Hardening Sprint/);
});

test('prospect queue and outreach drafts stay tied to current OpenCode report targets', () => {
  const prospects = buildProspectQueue(REPORT_FIXTURE);
  const drafts = buildOutreachDrafts(LINKS_FIXTURE);

  assert.equal(prospects.length, 1);
  assert.equal(prospects[0].pipelineLeadId, 'github_zaxbysauce_opencode_swarm');
  assert.equal(drafts.length, 3);
  assert.match(drafts[0].draft, /plugins\/opencode-profile\/INSTALL\.md/);
  assert.match(drafts[1].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[2].draft, /workflow-sprint-intake/);
});

test('revenue-loop report reader falls back safely and parses live JSON when present', () => {
  const tempDir = makeTempDir();
  const reportPath = path.join(tempDir, 'gtm-revenue-loop.json');
  fs.writeFileSync(reportPath, JSON.stringify({ directive: { state: 'cold-start' } }), 'utf8');

  assert.deepEqual(readRevenueLoopReport(path.join(tempDir, 'missing.json')), {});
  assert.deepEqual(readRevenueLoopReport(reportPath), { directive: { state: 'cold-start' } });
});

test('measurement plan stays honest about paid intent versus install interest', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'opencode_install_to_paid_intent');
  assert.match(plan.policy, /tracked proof click, Pro checkout start, or qualified sprint conversation/i);
  assert.ok(plan.metrics.includes('opencode_install_doc_clicks'));
  assert.ok(plan.guardrails.some((entry) => /Do not claim installs, revenue, or marketplace approval/i.test(entry)));
});

test('rendered pack is operator-ready and anchored to OpenCode guides plus proof', () => {
  const pack = buildOpenCodeRevenuePack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const markdown = renderOpenCodeRevenuePackMarkdown({
    ...pack,
    generatedAt: '2026-04-30T12:00:00.000Z',
  });

  assert.match(markdown, /OpenCode Revenue Pack/);
  assert.match(markdown, new RegExp(CANONICAL_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /Verified OpenCode Surfaces/);
  assert.match(markdown, /Prospect Queue/);
  assert.match(markdown, /opencode-swarm/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(markdown, /guaranteed revenue|approved marketplace|top ranking/i);
});

test('prospect queue CSV keeps concrete OpenCode targets in one operator file', () => {
  const csv = renderOpenCodeProspectQueueCsv(buildOpenCodeRevenuePack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE));

  assert.match(csv, /^key,label,pipelineLeadId,source,temperature,repoName,repoUrl,evidenceScore,evidence,motionLabel,cta,proofPackTrigger,firstTouchDraft,markContactedCommand/);
  assert.match(csv, /github_zaxbysauce_opencode_swarm/);
  assert.match(csv, /opencode-swarm/);
});

test('CLI options and artifact writing emit markdown, JSON, and queue CSVs', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildOpenCodeRevenuePack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
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
  assert.equal(fs.existsSync(path.join(tempDir, 'opencode-prospect-queue.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'opencode-revenue-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'opencode-revenue-pack.test.js')]), false);
});
