'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  GPT_ACTIONS_INSTALL_URL,
  GPT_AUDIT_URL,
  GPT_SUBMISSION_PACKET_URL,
  GPT_TRUST_GUIDE_URL,
  PUBLISHED_GPT_URL,
  REVENUE_LOOP_REPORT_PATH,
  buildChatgptGptRevenuePack,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedChatgptLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderChatgptGptRevenuePackMarkdown,
  renderChatgptOperatorQueueCsv,
  writeChatgptGptRevenuePack,
} = require('../scripts/chatgpt-gpt-revenue-pack');

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
  source: 'hosted-via-railway-env',
  verification: {
    label: 'Live hosted billing summary verified for this run.',
  },
  directive: {
    state: 'cold-start',
    headline: 'No verified revenue and no active pipeline. Use the GPT lane to create proof-backed intent, not vanity opens.',
  },
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-chatgpt-pack-'));
}

test('ChatGPT pack surfaces stay tied to real GPT, install, audit, and trust docs', () => {
  const surfaces = buildEvidenceSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), [
    'published_gpt',
    'gpt_store_submission_packet',
    'live_gpt_audit',
    'chatgpt_actions_install',
    'ads_trust_guide',
  ]);
  assert.match(surfaces[0].url, /\/go\/gpt\?/);
  assert.equal(surfaces[0].publicUrl, PUBLISHED_GPT_URL);
  assert.equal(surfaces[1].url, GPT_SUBMISSION_PACKET_URL);
  assert.equal(surfaces[2].url, GPT_AUDIT_URL);
  assert.equal(surfaces[3].url, GPT_ACTIONS_INSTALL_URL);
  assert.match(surfaces[4].url, /guides\/chatgpt-ads-trust\?/);
  assert.ok(surfaces.every((surface) => /VERIFICATION_EVIDENCE\.md/.test(surface.proofUrl)));
});

test('tracked ChatGPT links keep attribution machine-readable', () => {
  const gptUrl = new URL(buildTrackedChatgptLink('https://thumbgate-production.up.railway.app/go/gpt', {
    utmCampaign: 'chatgpt_gpt_open',
    utmContent: 'open_gpt',
    campaignVariant: 'published_gpt',
    offerCode: 'CHATGPT-GPT_OPEN',
    ctaId: 'chatgpt_gpt_open',
    ctaPlacement: 'gpt_surface',
  }));
  const guideUrl = new URL(buildTrackedChatgptLink(GPT_TRUST_GUIDE_URL, {
    utmCampaign: 'chatgpt_ads_trust',
    utmContent: 'guide',
    campaignVariant: 'trust_boundary',
    offerCode: 'CHATGPT-ADS_TRUST',
    ctaId: 'chatgpt_ads_trust',
    ctaPlacement: 'guide_surface',
  }));

  assert.equal(gptUrl.searchParams.get('utm_source'), 'chatgpt');
  assert.equal(gptUrl.searchParams.get('utm_medium'), 'gpt_store');
  assert.equal(gptUrl.searchParams.get('surface'), 'chatgpt_gpt');
  assert.equal(guideUrl.searchParams.get('utm_campaign'), 'chatgpt_ads_trust');
});

test('follow-on offers and operator queue keep Pro and sprint motions explicit', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);
  const queue = buildOperatorQueue(LINKS_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'sprint']);
  assert.match(offers[0].cta, /utm_campaign=chatgpt_gpt_pro_follow_on/);
  assert.match(offers[1].cta, /utm_campaign=chatgpt_gpt_team_follow_on/);
  assert.equal(queue.length, 3);
  assert.match(queue[0].recommendedMotion, /Open the GPT/);
  assert.match(queue[1].recommendedMotion, /Repair GPT Builder copy and auth first/);
  assert.match(queue[2].recommendedMotion, /Workflow Hardening Sprint/);
});

test('outreach drafts avoid leading first-touch with proof links', () => {
  const drafts = buildOutreachDrafts(LINKS_FIXTURE);

  assert.equal(drafts.length, 3);
  assert.match(drafts[0].draft, /\/go\/gpt\?/);
  assert.doesNotMatch(drafts[0].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[1].draft, /VERIFICATION_EVIDENCE\.md/);
  assert.match(drafts[2].draft, /Workflow Hardening Sprint/i);
});

test('measurement plan stays honest about GPT opens versus paid intent', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'chatgpt_gpt_to_paid_intent');
  assert.match(plan.policy, /GPT opens as acquisition evidence only after a tracked proof click/i);
  assert.ok(plan.metrics.includes('chatgpt_gpt_opens'));
  assert.ok(plan.metrics.includes('chatgpt_pro_checkout_starts'));
  assert.ok(plan.doNotCountAsSuccess.some((entry) => /GPT opens without proof clicks/i.test(entry)));
});

test('rendered pack is operator-ready and anchored to GPT plus proof surfaces', () => {
  const pack = buildChatgptGptRevenuePack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const markdown = renderChatgptGptRevenuePackMarkdown({
    ...pack,
    generatedAt: '2026-04-26T12:00:00.000Z',
  });

  assert.match(markdown, /ChatGPT GPT Revenue Pack/);
  assert.match(markdown, new RegExp(CANONICAL_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(markdown, /chatgpt\.com\/g\/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate/);
  assert.match(markdown, /gpt-store-submission\.md/);
  assert.match(markdown, /chatgpt-live-audit-2026-04-24\.md/);
  assert.match(markdown, /Revenue Evidence/);
  assert.match(markdown, /Billing source: hosted-via-railway-env/);
  assert.match(markdown, /Billing verification: Live hosted billing summary verified for this run\./);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
});

test('pack summary stays tied to the live revenue-loop directive instead of invented wins', () => {
  const pack = buildChatgptGptRevenuePack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.equal(pack.state, 'cold-start');
  assert.match(pack.summary, /No verified revenue and no active pipeline/);
  assert.doesNotMatch(pack.summary, /Revenue is proven/i);
  assert.equal(pack.revenueEvidence.source, 'hosted-via-railway-env');
});

test('revenue-loop report reader falls back safely and parses live JSON when present', () => {
  const tempDir = makeTempDir();
  const reportPath = path.join(tempDir, 'gtm-revenue-loop.json');
  fs.writeFileSync(reportPath, JSON.stringify({ directive: { state: 'cold-start' } }), 'utf8');

  assert.equal(REVENUE_LOOP_REPORT_PATH.endsWith('docs/marketing/gtm-revenue-loop.json'), true);
  assert.deepEqual(readRevenueLoopReport(path.join(tempDir, 'missing.json')), {});
  assert.deepEqual(readRevenueLoopReport(reportPath), { directive: { state: 'cold-start' } });
});

test('CSV export keeps one operator queue file for ChatGPT lane', () => {
  const csv = renderChatgptOperatorQueueCsv(buildChatgptGptRevenuePack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE));

  assert.match(csv, /^key,audience,evidence,proofTrigger,proofAsset,nextAsk,recommendedMotion/);
  assert.match(csv, /gpt_first_operator/);
  assert.match(csv, /builder_repair_owner/);
});

test('CLI options and artifact writing emit markdown, JSON, and queue CSV', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildChatgptGptRevenuePack(REPORT_FIXTURE, LINKS_FIXTURE, ABOUT_FIXTURE);
  const written = writeChatgptGptRevenuePack(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'chatgpt-gpt-revenue-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'chatgpt-gpt-revenue-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'chatgpt-gpt-operator-queue.csv')), true);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'chatgpt-gpt-revenue-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
