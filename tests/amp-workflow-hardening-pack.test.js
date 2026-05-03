'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  AMP_INSTALL_DOC_URL,
  AMP_INVOKABLE_SKILLS_URL,
  AMP_MANUAL_URL,
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  GUIDE_URL,
  README_URL,
  buildAmpWorkflowHardeningPack,
  buildChannelDrafts,
  buildEvidenceSurfaces,
  buildExternalEvidence,
  buildFollowOnOffers,
  buildListingCopy,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedAmpLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderAmpChannelDraftsCsv,
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
      evidence: ['workflow control surface'],
    },
    {
      temperature: 'warm',
      evidence: ['self-serve agent tooling'],
    },
    {
      temperature: 'cold',
      evidence: ['workflow control surface', 'self-serve agent tooling'],
    },
  ],
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-amp-pack-'));
}

test('Amp evidence surfaces stay tied to real repo and proof surfaces', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'amp_repo_skill_install',
    'amp_supported_agent_path',
    'proof_backed_setup_guide',
  ]);
  assert.match(surfaces[0].url, /plugins\/amp-skill\/INSTALL\.md/);
  assert.match(surfaces[1].url, /README\.md/);
  assert.match(surfaces[2].url, /thumbgate-production\.up\.railway\.app\/guide/);
  assert.ok(surfaces.every((surface) => /VERIFICATION_EVIDENCE\.md/.test(surface.proofUrl)));
  assert.ok(surfaces.every((surface) => !/marketplace approval|guaranteed installs|guaranteed revenue/i.test(surface.operatorUse)));
});

test('tracked Amp links keep attribution machine-readable', () => {
  const installUrl = new URL(buildTrackedAmpLink(AMP_INSTALL_DOC_URL, {
    utmCampaign: 'amp_repo_skill_install',
    utmContent: 'install_doc',
    campaignVariant: 'repo_backed_skill',
    offerCode: 'AMP-REPO_INSTALL',
    ctaId: 'amp_repo_install',
    ctaPlacement: 'guide_surface',
  }));
  const readmeUrl = new URL(buildTrackedAmpLink(README_URL, {
    utmCampaign: 'amp_supported_agent_path',
    utmContent: 'supported_agents',
    campaignVariant: 'agent_matrix',
    offerCode: 'AMP-AGENT_MATRIX',
    ctaId: 'amp_agent_matrix',
    ctaPlacement: 'guide_surface',
  }));
  const guideUrl = new URL(buildTrackedAmpLink(GUIDE_URL, {
    utmMedium: 'setup_guide',
    utmCampaign: 'amp_setup_guide',
    utmContent: 'setup',
    campaignVariant: 'proof_backed_setup',
    offerCode: 'AMP-SETUP_GUIDE',
    ctaId: 'amp_setup_guide',
    ctaPlacement: 'guide_surface',
  }));

  assert.equal(installUrl.searchParams.get('utm_source'), 'amp');
  assert.equal(installUrl.searchParams.get('utm_medium'), 'repo_install');
  assert.equal(readmeUrl.searchParams.get('utm_campaign'), 'amp_supported_agent_path');
  assert.equal(guideUrl.searchParams.get('utm_medium'), 'setup_guide');
  assert.equal(guideUrl.searchParams.get('surface'), 'amp_cli');
});

test('external evidence and listing copy stay anchored to current Amp docs and repo truth', () => {
  const externalEvidence = buildExternalEvidence();
  const listingCopy = buildListingCopy(LINKS_FIXTURE);

  assert.equal(externalEvidence.length, 2);
  assert.equal(externalEvidence[0].url, AMP_MANUAL_URL);
  assert.equal(externalEvidence[1].url, AMP_INVOKABLE_SKILLS_URL);
  assert.match(listingCopy.primaryCta.url, /plugins\/amp-skill\/INSTALL\.md/);
  assert.match(listingCopy.secondaryCta.url, /thumbgate-production\.up\.railway\.app\/guide/);
  assert.match(listingCopy.marketplaceNote, /Do not imply a dedicated Amp marketplace/i);
});

test('follow-on offers and operator queue keep Pro and sprint motions explicit', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);
  const queue = buildOperatorQueue(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'sprint']);
  assert.match(offers[0].cta, /utm_campaign=amp_pro_follow_on/);
  assert.match(offers[1].cta, /utm_campaign=amp_team_follow_on/);
  assert.equal(queue.length, 3);
  assert.match(queue[0].recommendedMotion, /Repo install -> prove one blocked repeat -> Pro/i);
  assert.match(queue[1].proofAsset, /ampcode\.com\/manual/);
  assert.match(queue[2].proofAsset, /ampcode\.com\/news\/user-invokable-skills/);
});

test('outreach drafts avoid leading with proof before pain is confirmed', () => {
  const drafts = buildOutreachDrafts(LINKS_FIXTURE);

  assert.equal(drafts.length, 3);
  assert.match(drafts[0].draft, /plugins\/amp-skill\/INSTALL\.md/);
  assert.doesNotMatch(drafts[0].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[1].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[2].draft, /checkout\/pro/);
});

test('active channel drafts stay tied to install-first Amp outreach and first-touch guardrails', () => {
  const drafts = buildChannelDrafts(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.equal(drafts.length, 4);
  assert.deepEqual(drafts.map((draft) => draft.channel), [
    'Reddit',
    'LinkedIn',
    'Threads',
    'Bluesky',
  ]);
  assert.match(drafts[0].cta, /plugins\/amp-skill\/INSTALL\.md/);
  assert.match(drafts[1].cta, /thumbgate-production\.up\.railway\.app\/guide/);
  assert.match(drafts[3].draft, /user-invokable skills/i);
  assert.ok(drafts.every((draft) => !draft.draft.includes('VERIFICATION_EVIDENCE.md')));
  assert.ok(drafts.every((draft) => !draft.draft.includes('COMMERCIAL_TRUTH.md')));
});

test('revenue-loop report reader falls back safely and parses live JSON when present', () => {
  const tempDir = makeTempDir();
  const reportPath = path.join(tempDir, 'gtm-revenue-loop.json');
  fs.writeFileSync(reportPath, JSON.stringify({ directive: { state: 'cold-start' } }), 'utf8');

  assert.deepEqual(readRevenueLoopReport(path.join(tempDir, 'missing.json')), {});
  assert.deepEqual(readRevenueLoopReport(reportPath), { directive: { state: 'cold-start' } });
});

test('measurement plan stays honest about install-path clicks versus paid intent', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'amp_install_to_paid_intent');
  assert.match(plan.policy, /install-doc clicks and setup-guide clicks/i);
  assert.ok(plan.metrics.includes('amp_install_doc_clicks'));
  assert.ok(plan.metrics.includes('paid_conversions'));
  assert.ok(plan.doNotCountAsSuccess.some((entry) => /install-doc clicks without a paid-intent event/i.test(entry)));
});

test('rendered pack is operator-ready and anchored to Amp repo proof plus official docs', () => {
  const pack = buildAmpWorkflowHardeningPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const markdown = renderAmpWorkflowHardeningPackMarkdown({
    ...pack,
    generatedAt: '2026-05-01T12:00:00.000Z',
  });

  assert.match(markdown, /Amp Workflow Hardening Pack/);
  assert.match(markdown, new RegExp(CANONICAL_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /plugins\/amp-skill\/INSTALL\.md/);
  assert.match(markdown, /ampcode\.com\/manual/);
  assert.match(markdown, /Active Channel Drafts/);
  assert.match(markdown, /LinkedIn — Founder post/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(markdown, /guaranteed revenue|approved marketplace|guaranteed installs/i);
});

test('CSV export keeps one operator queue and one channel-drafts file for Amp lanes', () => {
  const pack = buildAmpWorkflowHardeningPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const queueCsv = renderAmpOperatorQueueCsv(pack);
  const channelCsv = renderAmpChannelDraftsCsv(pack);

  assert.match(queueCsv, /^key,audience,evidence,proofTrigger,proofAsset,nextAsk,recommendedMotion/);
  assert.match(queueCsv, /repo_skill_operator/);
  assert.match(queueCsv, /committed_skill_rollout/);
  assert.match(channelCsv, /^key,channel,format,audience,evidenceSummary,cta,proofTiming,draft/);
  assert.match(channelCsv, /Reddit/);
  assert.match(channelCsv, /Bluesky/);
});

test('CLI options and artifact writing emit markdown, JSON, and Amp CSV files', () => {
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
  assert.equal(fs.existsSync(path.join(tempDir, 'amp-channel-drafts.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'amp-workflow-hardening-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'amp-workflow-hardening-pack.test.js')]), false);
});
