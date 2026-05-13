'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SOURCE,
  buildChatgptProductFeedReadinessPack,
  buildOfferCatalog,
  renderConversionCsv,
  renderFeedCsv,
  renderMarkdown,
  renderOperatorQueueCsv,
  trackedLink,
  writeChatgptProductFeedReadinessPack,
} = require('../scripts/chatgpt-product-feed-readiness-pack');

const LINKS_FIXTURE = {
  appOrigin: 'https://thumbgate-production.up.railway.app',
  guideLink: 'https://thumbgate-production.up.railway.app/guide',
  proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
  sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  proPriceLabel: '$19/mo or $149/yr',
};

test('offer catalog turns ThumbGate motions into feed-like rows with tracked URLs', () => {
  const offers = buildOfferCatalog(LINKS_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.id), [
    'thumbgate_free_cli',
    'thumbgate_pro_monthly',
    'thumbgate_pro_annual',
    'thumbgate_team_seats',
    'thumbgate_workflow_hardening_sprint',
    'thumbgate_codex_plugin',
    'thumbgate_chatgpt_gpt',
    'thumbgate_chatgpt_ads_trust_guide',
  ]);
  assert.ok(offers.every((offer) => offer.brand === 'ThumbGate'));
  assert.ok(offers.every((offer) => offer.landingPage.includes('utm_source=chatgpt')));
  assert.ok(offers.every((offer) => offer.proofUrl.includes('github.com/IgorGanapolsky/ThumbGate')));
  assert.ok(offers.every((offer) => /Do not claim ChatGPT ad access/.test(offer.claimGuardrail)));
});

test('tracked links preserve product-feed attribution and CTA metadata', () => {
  const url = new URL(trackedLink('https://thumbgate-production.up.railway.app/guide', {
    utmCampaign: 'chatgpt_feed_free_cli',
    utmContent: 'free_cli',
    campaignVariant: 'self_serve_install',
    offerCode: 'CHATGPT-FEED_FREE_CLI',
    ctaId: 'chatgpt_feed_free_cli',
    ctaPlacement: 'product_feed',
  }));

  assert.equal(url.searchParams.get('utm_source'), 'chatgpt');
  assert.equal(url.searchParams.get('utm_medium'), 'product_feed_ads');
  assert.equal(url.searchParams.get('utm_campaign'), 'chatgpt_feed_free_cli');
  assert.equal(url.searchParams.get('surface'), 'chatgpt_product_feed');
  assert.equal(url.searchParams.get('cta_id'), 'chatgpt_feed_free_cli');
});

test('pack is honest about ad access and measures paid intent rather than impressions', () => {
  const pack = buildChatgptProductFeedReadinessPack(LINKS_FIXTURE);

  assert.equal(pack.status, 'feed-ready-ad-access-unverified');
  assert.equal(pack.source.searchEngineLandUrl, SOURCE.searchEngineLandUrl);
  assert.equal(pack.productFeedSpec.currentRows, 8);
  assert.equal(pack.measurementPlan.northStar, 'chatgpt_feed_to_verified_paid_intent');
  assert.ok(pack.measurementPlan.doNotCountAsSuccess.includes('operator/test Stripe payments'));
  assert.ok(pack.measurementPlan.guardrails.some((guardrail) => /Do not imply ads influence ChatGPT answers/.test(guardrail)));
});

test('CSV exports include feed rows, conversion events, and operator blockers', () => {
  const pack = buildChatgptProductFeedReadinessPack(LINKS_FIXTURE);
  const feedCsv = renderFeedCsv(pack.offers);
  const conversionCsv = renderConversionCsv(pack.conversionEvents);
  const queueCsv = renderOperatorQueueCsv(pack.operatorQueue);

  assert.match(feedCsv, /^id,title,offerType,price,currency,billingPeriod/);
  assert.match(feedCsv, /thumbgate_workflow_hardening_sprint/);
  assert.match(feedCsv, /verified customer revenue/i);
  assert.match(conversionCsv, /^event,source,successDefinition/);
  assert.match(conversionCsv, /verified_customer_revenue/);
  assert.match(queueCsv, /^key,audience,evidence,nextAsk,blocker/);
  assert.match(queueCsv, /Do not claim access until OpenAI approves/);
});

test('rendered markdown avoids unsupported traction and access claims', () => {
  const markdown = renderMarkdown(buildChatgptProductFeedReadinessPack(LINKS_FIXTURE));

  assert.match(markdown, /ChatGPT Product Feed Readiness Pack/);
  assert.match(markdown, /feed-ready-ad-access-unverified/);
  assert.match(markdown, /Search Engine Land/);
  assert.match(markdown, /OpenAI ads principles/);
  assert.doesNotMatch(markdown, /OpenAI approved ThumbGate|guaranteed revenue|verified customers|ad access approved/i);
});

test('artifact writer emits markdown, JSON, feed CSV, conversion CSV, and queue CSV', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-chatgpt-feed-'));
  const pack = buildChatgptProductFeedReadinessPack(LINKS_FIXTURE);
  writeChatgptProductFeedReadinessPack(pack, {
    reportDir: dir,
    writeDocs: false,
  });

  assert.equal(fs.existsSync(path.join(dir, 'chatgpt-product-feed-readiness-pack.md')), true);
  assert.equal(fs.existsSync(path.join(dir, 'chatgpt-product-feed-readiness-pack.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'chatgpt-product-feed.csv')), true);
  assert.equal(fs.existsSync(path.join(dir, 'chatgpt-product-feed-conversions.csv')), true);
  assert.equal(fs.existsSync(path.join(dir, 'chatgpt-product-feed-operator-queue.csv')), true);
});
