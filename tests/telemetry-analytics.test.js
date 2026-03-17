'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-telemetry-test-'));

const {
  appendTelemetryEvent,
  getTelemetryAnalytics,
  inferTrafficChannel,
  loadTelemetryEvents,
  sanitizeTelemetryPayload,
} = require('../scripts/telemetry-analytics');

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  fs.rmSync(path.join(tmpDir, 'telemetry-pings.jsonl'), { force: true });
});

test('sanitizeTelemetryPayload normalizes modern web payloads', () => {
  const entry = sanitizeTelemetryPayload({
    eventType: 'checkout_start',
    clientType: 'web',
    acquisitionId: 'acq_1',
    visitorId: 'visitor_1',
    sessionId: 'session_1',
    source: 'website',
    utmCampaign: 'launch',
    ctaId: 'pricing_pro',
    ctaPlacement: 'pricing',
    planId: 'pro',
    page: '/',
  }, {
    referer: 'https://search.example',
    'user-agent': 'browser-test',
  });

  assert.equal(entry.clientType, 'web');
  assert.equal(entry.client, 'web');
  assert.equal(entry.eventType, 'checkout_start');
  assert.equal(entry.event, 'checkout_start');
  assert.equal(entry.acquisitionId, 'acq_1');
  assert.equal(entry.visitorId, 'visitor_1');
  assert.equal(entry.referrer, 'https://search.example');
  assert.equal(entry.referrerHost, 'search.example');
  assert.equal(entry.ctaPlacement, 'pricing');
  assert.equal(entry.userAgent, 'browser-test');
  assert.equal(entry.attributionTagged, true);
});

test('sanitizeTelemetryPayload normalizes buyer-loss and SEO fields', () => {
  const entry = sanitizeTelemetryPayload({
    eventType: 'reason_not_buying',
    clientType: 'web',
    reason: 'too_expensive',
    otherReason: 'Need a team budget owner',
    pricingInterest: 'high',
    seoQuery: 'ai agent guardrails',
    seoSurface: 'google_search',
  });

  assert.equal(entry.eventType, 'reason_not_buying');
  assert.equal(entry.reasonCode, 'too_expensive');
  assert.equal(entry.reasonDetail, 'Need a team budget owner');
  assert.equal(entry.pricingInterest, 'high');
  assert.equal(entry.seoQuery, 'ai agent guardrails');
  assert.equal(entry.seoSurface, 'google_search');
  assert.equal(entry.trafficChannel, 'direct');
});

test('inferTrafficChannel prefers explicit source and deterministic referrer heuristics', () => {
  assert.equal(inferTrafficChannel({ source: 'reddit' }, null), 'reddit');
  assert.equal(inferTrafficChannel({ source: 'ai_search' }, null), 'ai_search');
  assert.equal(inferTrafficChannel({ source: 'organic_search' }, null), 'organic_search');
  assert.equal(inferTrafficChannel({ source: 'website' }, null), 'direct');
  assert.equal(inferTrafficChannel({ utmMedium: 'organic' }, 'docs.example.com'), 'organic_search');
  assert.equal(inferTrafficChannel({}, 'perplexity.ai'), 'ai_search');
  assert.equal(inferTrafficChannel({}, 'www.reddit.com'), 'reddit');
  assert.equal(inferTrafficChannel({}, 'www.google.com'), 'organic_search');
  assert.equal(inferTrafficChannel({}, null), 'direct');
  assert.equal(inferTrafficChannel({}, 'news.ycombinator.com'), 'referral');
});

test('sanitizeTelemetryPayload preserves reddit campaign metadata', () => {
  const entry = sanitizeTelemetryPayload({
    eventType: 'landing_page_view',
    clientType: 'web',
    source: 'reddit',
    utmCampaign: 'reddit_launch',
    community: 'ClaudeCode',
    offerCode: 'REDDIT-EARLY',
    campaignVariant: 'comment_problem_solution',
    postId: '1rsudq0',
    commentId: 'oa9mqjf',
  });

  assert.equal(entry.trafficChannel, 'reddit');
  assert.equal(entry.community, 'ClaudeCode');
  assert.equal(entry.offerCode, 'REDDIT-EARLY');
  assert.equal(entry.campaignVariant, 'comment_problem_solution');
  assert.equal(entry.postId, '1rsudq0');
  assert.equal(entry.commentId, 'oa9mqjf');
});

test('loadTelemetryEvents upgrades legacy event/client fields', () => {
  fs.writeFileSync(path.join(tmpDir, 'telemetry-pings.jsonl'), `${JSON.stringify({
    receivedAt: new Date().toISOString(),
    event: 'checkout_cta_clicked',
    client: 'web',
    installId: 'legacy_visitor',
    source: 'website',
    utmCampaign: 'legacy_launch',
    ctaId: 'pricing_pro',
  })}\n`);

  const events = loadTelemetryEvents(tmpDir);
  assert.equal(events.length, 1);
  assert.equal(events[0].clientType, 'web');
  assert.equal(events[0].eventType, 'checkout_start');
  assert.equal(events[0].utmCampaign, 'legacy_launch');
});

test('getTelemetryAnalytics summarizes visitors, CTAs, and CLI installs', () => {
  appendTelemetryEvent(tmpDir, {
    eventType: 'landing_page_view',
    clientType: 'web',
    acquisitionId: 'acq_1',
    visitorId: 'visitor_1',
    sessionId: 'session_1',
    source: 'website',
    utmSource: 'website',
    utmCampaign: 'launch',
    page: '/',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'checkout_start',
    clientType: 'web',
    acquisitionId: 'acq_1',
    visitorId: 'visitor_1',
    sessionId: 'session_1',
    installId: 'inst_1',
    source: 'website',
    utmSource: 'website',
    utmCampaign: 'launch',
    ctaId: 'pricing_pro',
    ctaPlacement: 'pricing',
    planId: 'pro',
    page: '/',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'checkout_api_failed',
    clientType: 'web',
    acquisitionId: 'acq_1',
    visitorId: 'visitor_1',
    sessionId: 'session_1',
    ctaId: 'pricing_pro',
    failureCode: 'checkout_request_failed',
    httpStatus: 500,
    page: '/',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'cli_init',
    clientType: 'cli',
    installId: 'inst_cli_1',
    platform: 'darwin',
    version: '1.2.3',
  });

  const analytics = getTelemetryAnalytics(tmpDir);
  assert.equal(analytics.visitors.uniqueVisitors, 1);
  assert.equal(analytics.visitors.totalEvents, 3);
  assert.equal(analytics.visitors.pageViews, 1);
  assert.equal(analytics.ctas.totalClicks, 1);
  assert.equal(analytics.ctas.uniqueCheckoutStarters, 1);
  assert.equal(analytics.ctas.checkoutFailures, 1);
  assert.equal(analytics.ctas.failuresByCode.checkout_request_failed, 1);
  assert.equal(analytics.ctas.topCta.key, 'pricing_pro');
  assert.equal(analytics.visitors.topCampaign.key, 'launch');
  assert.equal(analytics.visitors.acquisitionIdCoverageRate, 1);
  assert.equal(analytics.cli.uniqueInstalls, 1);
  assert.equal(analytics.cli.byPlatform.darwin, 1);
});

test('getTelemetryAnalytics summarizes buyer-loss, abandonment, and SEO telemetry', () => {
  appendTelemetryEvent(tmpDir, {
    eventType: 'landing_page_view',
    clientType: 'web',
    acquisitionId: 'acq_loss_1',
    visitorId: 'visitor_loss_1',
    sessionId: 'session_loss_1',
    source: 'organic_search',
    utmSource: 'google',
    utmMedium: 'organic',
    utmCampaign: 'seo_launch',
    page: '/',
    referrer: 'https://www.google.com/search?q=ai+agent+guardrails',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'checkout_start',
    clientType: 'web',
    acquisitionId: 'acq_loss_1',
    visitorId: 'visitor_loss_1',
    sessionId: 'session_loss_1',
    ctaId: 'pricing_pro',
    source: 'organic_search',
    utmCampaign: 'seo_launch',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'checkout_cancelled',
    clientType: 'web',
    acquisitionId: 'acq_loss_1',
    visitorId: 'visitor_loss_1',
    sessionId: 'session_loss_1',
    reasonCode: 'not_ready',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'checkout_abandoned',
    clientType: 'web',
    acquisitionId: 'acq_loss_2',
    visitorId: 'visitor_loss_2',
    sessionId: 'session_loss_2',
    reasonCode: 'price_shock',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'reason_not_buying',
    clientType: 'web',
    acquisitionId: 'acq_loss_2',
    visitorId: 'visitor_loss_2',
    sessionId: 'session_loss_2',
    reasonCode: 'need_team_approval',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'pricing_interest',
    clientType: 'web',
    acquisitionId: 'acq_loss_2',
    visitorId: 'visitor_loss_2',
    sessionId: 'session_loss_2',
    pricingInterest: 'high',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'seo_landing_view',
    clientType: 'web',
    acquisitionId: 'acq_loss_1',
    visitorId: 'visitor_loss_1',
    sessionId: 'session_loss_1',
    seoSurface: 'google_search',
    seoQuery: 'ai agent guardrails',
  });

  const analytics = getTelemetryAnalytics(tmpDir);
  assert.equal(analytics.visitors.byTrafficChannel.organic_search, 1);
  assert.equal(analytics.visitors.topTrafficChannel.key, 'organic_search');
  assert.equal(analytics.ctas.byTrafficChannel.organic_search, 1);
  assert.equal(analytics.ctas.conversionByTrafficChannel.organic_search, 1);
  assert.equal(analytics.ctas.checkoutCancelled, 1);
  assert.equal(analytics.ctas.checkoutAbandoned, 1);
  assert.equal(analytics.ctas.cancellationReasons.not_ready, 1);
  assert.equal(analytics.ctas.abandonmentReasons.price_shock, 1);
  assert.equal(analytics.ctas.cancellationRate, 1);
  assert.equal(analytics.ctas.abandonmentRate, 1);
  assert.equal(analytics.buyerLoss.totalSignals, 3);
  assert.equal(analytics.buyerLoss.reasonsByCode.not_ready, 1);
  assert.equal(analytics.buyerLoss.reasonsByCode.price_shock, 1);
  assert.equal(analytics.buyerLoss.reasonsByCode.need_team_approval, 1);
  assert.ok(analytics.buyerLoss.topReason);
  assert.equal(analytics.pricing.pricingInterestEvents, 1);
  assert.equal(analytics.pricing.interestByLevel.high, 1);
  assert.equal(analytics.seo.landingViews, 1);
  assert.equal(analytics.seo.bySurface.google_search, 1);
  assert.equal(analytics.seo.byQuery['ai agent guardrails'], 1);
  assert.equal(analytics.seo.topSurface.key, 'google_search');
  assert.equal(analytics.seo.topQuery.key, 'ai agent guardrails');
});

test('getTelemetryAnalytics summarizes reddit community and offer performance', () => {
  appendTelemetryEvent(tmpDir, {
    eventType: 'landing_page_view',
    clientType: 'web',
    acquisitionId: 'acq_reddit_1',
    visitorId: 'visitor_reddit_1',
    sessionId: 'session_reddit_1',
    source: 'reddit',
    utmSource: 'reddit',
    utmMedium: 'organic_social',
    utmCampaign: 'reddit_launch',
    community: 'ClaudeCode',
    offerCode: 'REDDIT-EARLY',
    campaignVariant: 'comment_problem_solution',
    page: '/',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'checkout_start',
    clientType: 'web',
    acquisitionId: 'acq_reddit_1',
    visitorId: 'visitor_reddit_1',
    sessionId: 'session_reddit_1',
    source: 'reddit',
    utmSource: 'reddit',
    utmCampaign: 'reddit_launch',
    community: 'ClaudeCode',
    offerCode: 'REDDIT-EARLY',
    campaignVariant: 'comment_problem_solution',
    ctaId: 'pricing_pro',
  });

  const analytics = getTelemetryAnalytics(tmpDir);
  assert.equal(analytics.visitors.byTrafficChannel.reddit, 1);
  assert.equal(analytics.visitors.byCommunity.ClaudeCode, 1);
  assert.equal(analytics.visitors.byOfferCode['REDDIT-EARLY'], 1);
  assert.equal(analytics.visitors.byCampaignVariant.comment_problem_solution, 1);
  assert.equal(analytics.visitors.topTrafficChannel.key, 'reddit');
  assert.equal(analytics.visitors.topCommunity.key, 'ClaudeCode');
  assert.equal(analytics.visitors.topOfferCode.key, 'REDDIT-EARLY');
  assert.equal(analytics.ctas.byCommunity.ClaudeCode, 1);
  assert.equal(analytics.ctas.byOfferCode['REDDIT-EARLY'], 1);
});
