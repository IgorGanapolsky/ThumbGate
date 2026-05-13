'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SOURCE,
  buildLocalFirstAiReliabilityPack,
  buildTrackedCtas,
  renderChannelDraftsCsv,
  renderMarkdown,
  renderOperatorQueueCsv,
  renderPublicGuideHtml,
  trackedLink,
  writeLocalFirstAiReliabilityPack,
} = require('../scripts/local-first-ai-reliability-pack');

const LINKS_FIXTURE = {
  appOrigin: 'https://thumbgate-production.up.railway.app',
  guideLink: 'https://thumbgate-production.up.railway.app/guide',
  proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
  sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  proPriceLabel: '$19/mo or $149/yr',
};

test('local-first pack maps the InfoQ pattern to ThumbGate acquisition surfaces', () => {
  const pack = buildLocalFirstAiReliabilityPack(LINKS_FIXTURE);

  assert.equal(pack.name, 'thumbgate-local-first-ai-reliability-pack');
  assert.equal(pack.status, 'guide-ready-no-revenue-claim');
  assert.equal(pack.source.url, SOURCE.url);
  assert.equal(pack.architectureTiers.length, 3);
  assert.deepEqual(pack.architectureTiers.map((tier) => tier.name), [
    'Local deterministic gates',
    'Model-assisted review path',
    'Human approval queue',
  ]);
  assert.ok(pack.gateChecklist.some((gate) => gate.id === 'model_call_necessity_gate'));
  assert.ok(pack.buyerSegments.some((segment) => segment.segment === 'Platform and security teams'));
});

test('tracked CTAs preserve local-first attribution metadata', () => {
  const ctas = buildTrackedCtas(LINKS_FIXTURE);
  const url = new URL(ctas.sprint);

  assert.equal(url.searchParams.get('utm_source'), 'infoq');
  assert.equal(url.searchParams.get('utm_medium'), 'organic_ai_architecture');
  assert.equal(url.searchParams.get('utm_campaign'), 'local_first_ai_reliability');
  assert.equal(url.searchParams.get('surface'), 'local_first_ai_reliability');
  assert.equal(url.searchParams.get('cta_id'), 'local_first_sprint');
  assert.equal(new URL(trackedLink('https://thumbgate.ai/guide')).searchParams.get('surface'), 'local_first_ai_reliability');
});

test('measurement plan is honest about revenue, model cost, and human review', () => {
  const pack = buildLocalFirstAiReliabilityPack(LINKS_FIXTURE);

  assert.equal(pack.measurementPlan.northStar, 'local_first_guide_to_verified_paid_intent');
  assert.ok(pack.measurementPlan.doNotCountAsSuccess.includes('operator/test Stripe payments'));
  assert.ok(pack.measurementPlan.guardrails.some((guardrail) => /Do not claim ThumbGate reduced cloud AI spend/.test(guardrail)));
  assert.ok(pack.measurementPlan.guardrails.some((guardrail) => /Do not claim local gates replace human review/.test(guardrail)));
  assert.ok(pack.measurementPlan.policy.includes('verified non-operator customer revenue'));
});

test('markdown, queue CSV, and channel CSV expose operator-ready actions', () => {
  const pack = buildLocalFirstAiReliabilityPack(LINKS_FIXTURE);
  const markdown = renderMarkdown(pack);
  const queueCsv = renderOperatorQueueCsv(pack.operatorQueue);
  const draftsCsv = renderChannelDraftsCsv(pack.channelDrafts);

  assert.match(markdown, /Local-First AI Reliability Pack/);
  assert.match(markdown, /Model-call necessity gate/);
  assert.match(markdown, /Workflow Hardening Sprint/);
  assert.doesNotMatch(markdown, /guaranteed savings|verified customers|made money|replaces human review/i);
  assert.match(queueCsv, /^key,audience,evidence,proofAsset,nextAsk,recommendedMotion/);
  assert.match(queueCsv, /publish_local_first_guide/);
  assert.match(draftsCsv, /^id,channel,audience,cta,draft,guardrail/);
  assert.match(draftsCsv, /linkedin_local_first_architecture/);
});

test('public guide has schema, pricing, proof boundaries, and conversion CTAs', () => {
  const html = renderPublicGuideHtml(buildLocalFirstAiReliabilityPack(LINKS_FIXTURE));

  assert.match(html, /"@type": "TechArticle"/);
  assert.match(html, /"@type": "FAQPage"/);
  assert.match(html, /rel="llm-context"/);
  assert.match(html, /local-first AI reliability/i);
  assert.match(html, /Pre-Action Gates/);
  assert.match(html, /\$19\/mo or \$149\/yr/);
  assert.match(html, /\$49\/seat\/mo/);
  assert.match(html, /workflow-sprint-intake/);
  assert.match(html, /npx thumbgate init/);
  assert.doesNotMatch(html, /guaranteed savings|verified customers|made money|replaces human review/i);
});

test('writer emits marketing artifacts and report-dir guide files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-local-first-ai-'));
  const pack = buildLocalFirstAiReliabilityPack(LINKS_FIXTURE);
  writeLocalFirstAiReliabilityPack(pack, {
    reportDir: dir,
    writeDocs: false,
  });

  assert.equal(fs.existsSync(path.join(dir, 'local-first-ai-reliability-pack.md')), true);
  assert.equal(fs.existsSync(path.join(dir, 'local-first-ai-reliability-pack.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'local-first-ai-reliability-operator-queue.csv')), true);
  assert.equal(fs.existsSync(path.join(dir, 'local-first-ai-reliability-channel-drafts.csv')), true);
  assert.equal(fs.existsSync(path.join(dir, 'local-first-ai-agent-reliability.html')), true);
  assert.equal(fs.existsSync(path.join(dir, 'local-first-ai-agent-reliability.md')), true);
});
