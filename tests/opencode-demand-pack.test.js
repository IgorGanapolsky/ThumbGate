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
  OPENCODE_GUIDE_URL,
  OPENCODE_INSTALL_DOC_URL,
  OPENCODE_INTEGRATION_DOC_URL,
  buildChannelDrafts,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOpencodeDemandPack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedOpenCodeLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderOpencodeChannelDraftsCsv,
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
};

const REPORT_FIXTURE = {
  directive: {
    state: 'post-first-dollar',
    headline: 'Verified booked revenue exists. Keep the GTM loop honest and focused on proof-backed paid intent.',
  },
  targets: [
    {
      evidence: ['workflow control surface', 'self-serve agent tooling'],
      repoName: 'opencode-swarm',
      description: 'OpenCode swarm orchestration',
      firstTouchDraft: 'OpenCode path first',
    },
    {
      evidence: ['workflow control surface'],
      repoName: 'engine_context',
      description: 'production workflow',
    },
  ],
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-opencode-demand-'));
}

test('OpenCode demand surfaces stay tied to shipped install and proof surfaces', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'opencode_guardrails_guide',
    'repo_local_integration',
    'portable_profile_install',
    'proof_backed_setup_guide',
  ]);
  assert.match(surfaces[0].url, /guides\/opencode-guardrails\?/);
  assert.equal(surfaces[1].url, OPENCODE_INTEGRATION_DOC_URL);
  assert.equal(surfaces[2].url, OPENCODE_INSTALL_DOC_URL);
  assert.match(surfaces[3].url, /\/guide\?/);
  assert.ok(surfaces.every((surface) => /VERIFICATION_EVIDENCE\.md/.test(surface.proofUrl)));
});

test('tracked OpenCode links keep attribution machine-readable', () => {
  const url = new URL(buildTrackedOpenCodeLink(OPENCODE_GUIDE_URL, {
    utmCampaign: 'opencode_guardrails_guide',
    utmContent: 'seo_page',
    campaignVariant: 'guardrails_guide',
    offerCode: 'OPENCODE-GUIDE',
    ctaId: 'opencode_guide',
    ctaPlacement: 'guide_surface',
  }));

  assert.equal(url.searchParams.get('utm_source'), 'opencode');
  assert.equal(url.searchParams.get('utm_medium'), 'seo_guide');
  assert.equal(url.searchParams.get('utm_campaign'), 'opencode_guardrails_guide');
  assert.equal(url.searchParams.get('surface'), 'opencode');
});

test('follow-on offers and operator queue keep Pro and sprint motions explicit', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);
  const queue = buildOperatorQueue(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'sprint']);
  assert.match(offers[0].cta, /utm_campaign=opencode_pro_follow_on/);
  assert.match(offers[1].cta, /utm_campaign=opencode_sprint_follow_on/);
  assert.equal(queue.length, 3);
  assert.match(queue[0].recommendedMotion, /Guide -> setup guide -> Pro/);
  assert.match(queue[1].recommendedMotion, /Workflow Hardening Sprint/);
});

test('outreach drafts stay tool-first until pain is confirmed', () => {
  const drafts = buildOutreachDrafts(LINKS_FIXTURE);

  assert.equal(drafts.length, 3);
  assert.match(drafts[0].draft, /guides\/opencode-guardrails/);
  assert.doesNotMatch(drafts[0].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[1].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[2].draft, /workflow hardening sprint/i);
});

test('channel drafts stay anchored to shipped OpenCode surfaces', () => {
  const drafts = buildChannelDrafts(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.equal(drafts.length, 3);
  assert.deepEqual(drafts.map((draft) => draft.channel), ['GitHub', 'LinkedIn', 'Reddit']);
  assert.match(drafts[0].cta, /guides\/opencode-guardrails/);
  assert.match(drafts[1].cta, /\/guide\?/);
  assert.match(drafts[2].cta, /guides\/opencode-guardrails/);
  assert.ok(drafts.every((draft) => !draft.draft.includes('COMMERCIAL_TRUTH.md')));
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

  assert.equal(plan.northStar, 'opencode_guide_to_paid_intent');
  assert.match(plan.policy, /setup-guide click, Pro checkout start, or qualified workflow-hardening conversation/i);
  assert.ok(plan.metrics.includes('opencode_guide_views'));
  assert.ok(plan.metrics.includes('pro_checkout_starts'));
  assert.ok(plan.doNotCountAsSuccess.some((entry) => /guide views without a tracked follow-on click/i.test(entry)));
});

test('rendered pack is operator-ready and anchored to OpenCode surfaces plus proof', () => {
  const pack = buildOpencodeDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const markdown = renderOpencodeDemandPackMarkdown({
    ...pack,
    generatedAt: '2026-04-30T12:00:00.000Z',
  });

  assert.match(markdown, /OpenCode Demand Pack/);
  assert.match(markdown, new RegExp(CANONICAL_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /guides\/opencode-guardrails/);
  assert.match(markdown, new RegExp(GUIDE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /Active Channel Drafts/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
});

test('CSV exports keep operator queues and channel drafts machine-readable', () => {
  const pack = buildOpencodeDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const queueCsv = renderOpencodeOperatorQueueCsv(pack);
  const draftsCsv = renderOpencodeChannelDraftsCsv(pack);

  assert.match(queueCsv, /^key,audience,evidence,proofTrigger,proofAsset,nextAsk,recommendedMotion/);
  assert.match(queueCsv, /opencode_self_serve_builder/);
  assert.match(draftsCsv, /^key,channel,format,audience,evidenceSummary,cta,proofTiming,draft/);
  assert.match(draftsCsv, /GitHub/);
});

test('CLI options and artifact writing emit markdown, JSON, and CSV exports', () => {
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
  assert.equal(fs.existsSync(path.join(tempDir, 'opencode-channel-drafts.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'opencode-demand-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'opencode-demand-pack.test.js')]), false);
});
