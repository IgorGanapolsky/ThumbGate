'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  GCP_GUIDE_URL,
  GEMINI_GUIDE_URL,
  MEM0_COMPARE_URL,
  buildChannelDrafts,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildGeminiCliDemandPack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedGeminiLink,
  buildMeasurementPlan,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderGeminiCliChannelDraftsCsv,
  renderGeminiCliDemandPackMarkdown,
  renderGeminiCliOperatorQueueCsv,
  writeGeminiCliDemandPack,
} = require('../scripts/gemini-cli-demand-pack');

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
    state: 'cold-start',
    headline: 'No verified revenue and no active pipeline. Use proof-backed demand surfaces to create paid intent.',
  },
  targets: [
    {
      evidence: ['production or platform workflow'],
    },
    {
      evidence: ['production or platform workflow', 'business-system integration'],
    },
  ],
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gemini-demand-'));
}

test('Gemini demand surfaces stay tied to real guides and proof surfaces', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'memory_enforcement_guide',
    'gcp_guardrails_guide',
    'local_first_comparison',
    'proof_backed_setup_guide',
  ]);
  assert.match(surfaces[0].url, /guides\/gemini-cli-feedback-memory\?/);
  assert.match(surfaces[1].url, /guides\/gcp-mcp-guardrails\?/);
  assert.match(surfaces[2].url, /compare\/mem0\?/);
  assert.ok(surfaces.every((surface) => /VERIFICATION_EVIDENCE\.md/.test(surface.proofUrl)));
  assert.ok(surfaces.every((surface) => !/guaranteed revenue|approved marketplace|top ranking/i.test(surface.operatorUse)));
});

test('tracked Gemini links keep attribution machine-readable', () => {
  const memoryUrl = new URL(buildTrackedGeminiLink(GEMINI_GUIDE_URL, {
    utmCampaign: 'gemini_cli_memory_guide',
    utmContent: 'seo_page',
    campaignVariant: 'memory_enforcement',
    offerCode: 'GEMINI-MEMORY_GUIDE',
    ctaId: 'gemini_memory_guide',
    ctaPlacement: 'guide_surface',
  }));
  const gcpUrl = new URL(buildTrackedGeminiLink(GCP_GUIDE_URL, {
    utmCampaign: 'gemini_gcp_guardrails',
    utmContent: 'cloud_next',
    campaignVariant: 'gcp_guardrails',
    offerCode: 'GEMINI-GCP_GUARDRAILS',
    ctaId: 'gemini_gcp_guardrails',
    ctaPlacement: 'guide_surface',
  }));
  const compareUrl = new URL(buildTrackedGeminiLink(MEM0_COMPARE_URL, {
    utmCampaign: 'gemini_local_first_compare',
    utmContent: 'comparison',
    campaignVariant: 'local_first',
    offerCode: 'GEMINI-LOCAL_FIRST',
    ctaId: 'gemini_local_first_compare',
    ctaPlacement: 'comparison_surface',
  }));

  assert.equal(memoryUrl.searchParams.get('utm_source'), 'gemini');
  assert.equal(memoryUrl.searchParams.get('utm_medium'), 'seo_guide');
  assert.equal(memoryUrl.searchParams.get('utm_campaign'), 'gemini_cli_memory_guide');
  assert.equal(gcpUrl.searchParams.get('utm_content'), 'cloud_next');
  assert.equal(compareUrl.searchParams.get('surface'), 'gemini_cli');
});

test('follow-on offers and operator queue keep Pro and sprint motions explicit', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);
  const queue = buildOperatorQueue(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'sprint']);
  assert.match(offers[0].cta, /utm_campaign=gemini_cli_pro_follow_on/);
  assert.match(offers[1].cta, /utm_campaign=gemini_cli_team_follow_on/);
  assert.equal(queue.length, 3);
  assert.match(queue[0].recommendedMotion, /Guide -> proof -> Pro/);
  assert.match(queue[1].recommendedMotion, /Workflow Hardening Sprint/);
});

test('outreach drafts avoid leading with proof before pain is confirmed', () => {
  const drafts = buildOutreachDrafts(LINKS_FIXTURE);

  assert.equal(drafts.length, 3);
  assert.match(drafts[0].draft, /guides\/gemini-cli-feedback-memory/);
  assert.doesNotMatch(drafts[0].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[1].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[2].draft, /workflow hardening sprint/i);
});

test('active channel drafts stay tied to Gemini guides, comparison, and first-touch guardrails', () => {
  const drafts = buildChannelDrafts(LINKS_FIXTURE, REPORT_FIXTURE);

  assert.equal(drafts.length, 4);
  assert.deepEqual(drafts.map((draft) => draft.channel), [
    'Reddit',
    'LinkedIn',
    'Threads',
    'Bluesky',
  ]);
  assert.match(drafts[0].cta, /guides\/gemini-cli-feedback-memory/);
  assert.match(drafts[1].cta, /guides\/gcp-mcp-guardrails/);
  assert.match(drafts[2].cta, /guides\/gemini-cli-feedback-memory/);
  assert.match(drafts[3].cta, /compare\/mem0/);
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

test('measurement plan stays honest about paid intent versus guide traffic', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'gemini_guide_to_paid_intent');
  assert.match(plan.policy, /tracked proof click, Pro checkout start, or qualified sprint conversation/i);
  assert.ok(plan.metrics.includes('proof_clicks'));
  assert.ok(plan.metrics.includes('paid_pro_conversions'));
  assert.ok(plan.doNotCountAsSuccess.some((entry) => /guide views without proof clicks/i.test(entry)));
});

test('rendered pack is operator-ready and anchored to guides plus proof', () => {
  const pack = buildGeminiCliDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const markdown = renderGeminiCliDemandPackMarkdown({
    ...pack,
    generatedAt: '2026-04-26T12:00:00.000Z',
  });

  assert.match(markdown, /Gemini CLI Demand Pack/);
  assert.match(markdown, new RegExp(CANONICAL_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /guides\/gemini-cli-feedback-memory/);
  assert.match(markdown, /guides\/gcp-mcp-guardrails/);
  assert.match(markdown, /Active Channel Drafts/);
  assert.match(markdown, /LinkedIn — Founder post/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(markdown, /guaranteed revenue|approved marketplace|top ranking/i);
});

test('CSV export keeps one operator queue file for Gemini lanes', () => {
  const csv = renderGeminiCliOperatorQueueCsv(buildGeminiCliDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE));

  assert.match(csv, /^key,audience,evidence,proofTrigger,proofAsset,nextAsk,recommendedMotion/);
  assert.match(csv, /memory_first_builder/);
  assert.match(csv, /gcp_workflow_owner/);
});

test('channel draft CSV keeps active Gemini outbound surfaces in one operator file', () => {
  const csv = renderGeminiCliChannelDraftsCsv(buildGeminiCliDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE));

  assert.match(csv, /^key,channel,format,audience,evidenceSummary,cta,proofTiming,draft/);
  assert.match(csv, /Reddit/);
  assert.match(csv, /LinkedIn/);
  assert.match(csv, /compare\/mem0/);
});

test('CLI options and artifact writing emit markdown, JSON, and queue CSV', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildGeminiCliDemandPack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const written = writeGeminiCliDemandPack(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'gemini-cli-demand-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'gemini-cli-demand-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'gemini-cli-operator-queue.csv')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'gemini-cli-channel-drafts.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'gemini-cli-demand-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'gemini-cli-demand-pack.test.js')]), false);
});

test('Google Cloud Gemini guide uses the real CLI agent flag', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'guides', 'gcp-mcp-guardrails.html'), 'utf8');

  assert.match(html, /npx thumbgate init --agent gemini/);
  assert.doesNotMatch(html, /--agent gemini-cli/);
});
