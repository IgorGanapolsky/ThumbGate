'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-telemetry-test-'));
const legacyDir = path.join(tmpDir, 'legacy-feedback');
const rlhfDir = path.join(tmpDir, 'rlhf-feedback');
const savedLegacyFeedbackDir = process.env._TEST_LEGACY_FEEDBACK_DIR;
const savedHostedLegacyFeedbackDir = process.env.THUMBGATE_LEGACY_FEEDBACK_DIR;
const savedRlhfFeedbackDir = process.env._TEST_RLHF_FEEDBACK_DIR;
const savedHostedRlhfFeedbackDir = process.env.THUMBGATE_RLHF_FEEDBACK_DIR;

const {
  appendTelemetryEvent,
  getTelemetrySourceDiagnostics,
  getTelemetryAnalytics,
  inferTrafficChannel,
  loadTelemetryEvents,
  sanitizeTelemetryPayload,
} = require('../scripts/telemetry-analytics');

test.after(() => {
  if (savedLegacyFeedbackDir === undefined) delete process.env._TEST_LEGACY_FEEDBACK_DIR;
  else process.env._TEST_LEGACY_FEEDBACK_DIR = savedLegacyFeedbackDir;
  if (savedHostedLegacyFeedbackDir === undefined) delete process.env.THUMBGATE_LEGACY_FEEDBACK_DIR;
  else process.env.THUMBGATE_LEGACY_FEEDBACK_DIR = savedHostedLegacyFeedbackDir;
  if (savedRlhfFeedbackDir === undefined) delete process.env._TEST_RLHF_FEEDBACK_DIR;
  else process.env._TEST_RLHF_FEEDBACK_DIR = savedRlhfFeedbackDir;
  if (savedHostedRlhfFeedbackDir === undefined) delete process.env.THUMBGATE_RLHF_FEEDBACK_DIR;
  else process.env.THUMBGATE_RLHF_FEEDBACK_DIR = savedHostedRlhfFeedbackDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  delete process.env._TEST_LEGACY_FEEDBACK_DIR;
  delete process.env.THUMBGATE_LEGACY_FEEDBACK_DIR;
  delete process.env._TEST_RLHF_FEEDBACK_DIR;
  delete process.env.THUMBGATE_RLHF_FEEDBACK_DIR;
  fs.rmSync(path.join(tmpDir, 'telemetry-pings.jsonl'), { force: true });
  fs.rmSync(path.join(legacyDir, 'telemetry-pings.jsonl'), { force: true });
  fs.rmSync(path.join(rlhfDir, 'telemetry-pings.jsonl'), { force: true });
  fs.rmSync(legacyDir, { recursive: true, force: true });
  fs.rmSync(rlhfDir, { recursive: true, force: true });
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

test('sanitizeTelemetryPayload preserves SEO content classification fields', () => {
  const entry = sanitizeTelemetryPayload({
    eventType: 'landing_page_view',
    clientType: 'web',
    page: '/compare/speclock',
    pageType: 'comparison',
    contentPillar: 'comparison',
    primaryQuery: 'thumbgate vs speclock',
  });

  assert.equal(entry.page, '/compare/speclock');
  assert.equal(entry.pageType, 'comparison');
  assert.equal(entry.contentPillar, 'comparison');
  assert.equal(entry.primaryQuery, 'thumbgate vs speclock');
});

test('inferTrafficChannel prefers explicit source and deterministic referrer heuristics', () => {
  assert.equal(inferTrafficChannel({ source: 'producthunt' }, null), 'producthunt');
  assert.equal(inferTrafficChannel({ source: 'reddit' }, null), 'reddit');
  assert.equal(inferTrafficChannel({ utmMedium: 'creator_partnership' }, null), 'creator');
  assert.equal(inferTrafficChannel({ source: 'ai_search' }, null), 'ai_search');
  assert.equal(inferTrafficChannel({ source: 'organic_search' }, null), 'organic_search');
  assert.equal(inferTrafficChannel({ source: 'website' }, null), 'direct');
  assert.equal(inferTrafficChannel({ utmMedium: 'organic' }, 'docs.example.com'), 'organic_search');
  assert.equal(inferTrafficChannel({}, 'perplexity.ai'), 'ai_search');
  assert.equal(inferTrafficChannel({}, 'www.producthunt.com'), 'producthunt');
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
    creator: 'reach_vb',
    utmCampaign: 'reddit_launch',
    community: 'ClaudeCode',
    offerCode: 'REDDIT-EARLY',
    campaignVariant: 'comment_problem_solution',
    postId: '1rsudq0',
    commentId: 'oa9mqjf',
  });

  assert.equal(entry.trafficChannel, 'reddit');
  assert.equal(entry.creator, 'reach_vb');
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

test('loadTelemetryEvents falls back to explicit legacy telemetry when the active dir is empty', () => {
  process.env._TEST_LEGACY_FEEDBACK_DIR = legacyDir;
  process.env._TEST_RLHF_FEEDBACK_DIR = path.join(tmpDir, 'missing-rlhf-feedback');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'telemetry-pings.jsonl'), `${JSON.stringify({
    receivedAt: new Date().toISOString(),
    eventType: 'landing_page_view',
    clientType: 'web',
    visitorId: 'legacy_only_visitor',
    sessionId: 'legacy_only_session',
    source: 'website',
    utmCampaign: 'legacy_only_launch',
    page: '/',
  })}\n`);

  const events = loadTelemetryEvents(tmpDir);
  const diagnostics = getTelemetrySourceDiagnostics(tmpDir);

  assert.equal(events.length, 1);
  assert.equal(events[0].utmCampaign, 'legacy_only_launch');
  assert.equal(diagnostics.activeMode, 'legacy_fallback');
  assert.equal(diagnostics.warnings[0].code, 'telemetry_legacy_fallback');
});

test('loadTelemetryEvents falls back to explicit rlhf telemetry when the active dir is empty', () => {
  process.env._TEST_RLHF_FEEDBACK_DIR = rlhfDir;
  fs.mkdirSync(rlhfDir, { recursive: true });
  fs.writeFileSync(path.join(rlhfDir, 'telemetry-pings.jsonl'), `${JSON.stringify({
    receivedAt: new Date().toISOString(),
    eventType: 'landing_page_view',
    clientType: 'web',
    visitorId: 'rlhf_only_visitor',
    sessionId: 'rlhf_only_session',
    source: 'website',
    utmCampaign: 'rlhf_only_launch',
    page: '/',
  })}\n`);

  const events = loadTelemetryEvents(tmpDir);
  const diagnostics = getTelemetrySourceDiagnostics(tmpDir);

  assert.equal(events.length, 1);
  assert.equal(events[0].utmCampaign, 'rlhf_only_launch');
  assert.equal(diagnostics.activeMode, 'legacy_fallback');
  assert.equal(diagnostics.warnings[0].code, 'telemetry_legacy_fallback');
});

test('loadTelemetryEvents prefers primary telemetry when both primary and fallback files exist', () => {
  process.env._TEST_RLHF_FEEDBACK_DIR = rlhfDir;
  fs.mkdirSync(rlhfDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'telemetry-pings.jsonl'), `${JSON.stringify({
    receivedAt: new Date().toISOString(),
    eventType: 'landing_page_view',
    clientType: 'web',
    visitorId: 'primary_visitor',
    sessionId: 'primary_session',
    source: 'website',
    utmCampaign: 'primary_launch',
    page: '/',
  })}\n`);
  fs.writeFileSync(path.join(rlhfDir, 'telemetry-pings.jsonl'), `${JSON.stringify({
    receivedAt: new Date().toISOString(),
    eventType: 'landing_page_view',
    clientType: 'web',
    visitorId: 'fallback_visitor',
    sessionId: 'fallback_session',
    source: 'website',
    utmCampaign: 'fallback_launch',
    page: '/',
  })}\n`);

  const events = loadTelemetryEvents(tmpDir);
  const diagnostics = getTelemetrySourceDiagnostics(tmpDir);

  assert.equal(events.length, 1);
  assert.equal(events[0].utmCampaign, 'primary_launch');
  assert.equal(diagnostics.activeMode, 'primary');
  assert.deepEqual(diagnostics.warnings, []);
});

test('getTelemetryAnalytics summarizes visitors, CTAs, and CLI installs', () => {
  appendTelemetryEvent(tmpDir, {
    eventType: 'landing_page_view',
    clientType: 'web',
    acquisitionId: 'acq_1',
    visitorId: 'visitor_1',
    sessionId: 'session_1',
    creator: 'reach_vb',
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
    creator: 'reach_vb',
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
  assert.equal(analytics.visitors.byCreator.reach_vb, 1);
  assert.equal(analytics.ctas.totalClicks, 1);
  assert.equal(analytics.ctas.checkoutStarts, 1);
  assert.equal(analytics.ctas.byCreator.reach_vb, 1);
  assert.equal(analytics.ctas.checkoutStartsByCreator.reach_vb, 1);
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

test('getTelemetryAnalytics keeps generic CTA clicks separate from checkout starts and counts checkout bootstrap', () => {
  appendTelemetryEvent(tmpDir, {
    eventType: 'landing_page_view',
    clientType: 'web',
    acquisitionId: 'acq_cta_1',
    visitorId: 'visitor_cta_1',
    sessionId: 'session_cta_1',
    source: 'website',
    utmSource: 'website',
    utmCampaign: 'proof_launch',
    page: '/',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'cta_click',
    clientType: 'web',
    acquisitionId: 'acq_cta_1',
    visitorId: 'visitor_cta_1',
    sessionId: 'session_cta_1',
    source: 'website',
    utmSource: 'website',
    utmCampaign: 'proof_launch',
    ctaId: 'workflow_sprint_proof',
    ctaPlacement: 'workflow_sprint',
    planId: 'proof',
    page: '/',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'checkout_bootstrap',
    clientType: 'web',
    acquisitionId: 'acq_cta_1',
    visitorId: 'visitor_cta_1',
    sessionId: 'session_cta_1',
    source: 'website',
    utmSource: 'website',
    utmCampaign: 'proof_launch',
    ctaId: 'pricing_pro',
    ctaPlacement: 'pricing',
    planId: 'pro',
    page: '/checkout/pro',
  });

  const analytics = getTelemetryAnalytics(tmpDir);
  assert.equal(analytics.ctas.totalClicks, 2);
  assert.equal(analytics.ctas.checkoutStarts, 1);
  assert.equal(analytics.ctas.uniqueCheckoutStarters, 1);
  assert.equal(analytics.ctas.byId.workflow_sprint_proof, 1);
  assert.equal(analytics.ctas.byId.pricing_pro, 1);
  assert.equal(analytics.ctas.byCampaign.proof_launch, 2);
  assert.equal(analytics.ctas.checkoutStartsByCampaign.proof_launch, 1);
  assert.equal(analytics.ctas.clickToCheckoutRate, 0.5);
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

test('getTelemetryAnalytics breaks out product hunt as its own buyer channel', () => {
  appendTelemetryEvent(tmpDir, {
    eventType: 'landing_page_view',
    clientType: 'web',
    acquisitionId: 'acq_ph_1',
    visitorId: 'visitor_ph_1',
    sessionId: 'session_ph_1',
    source: 'producthunt',
    utmSource: 'producthunt',
    utmMedium: 'listing',
    utmCampaign: 'thumbgate_launch',
    page: '/',
  });
  appendTelemetryEvent(tmpDir, {
    eventType: 'checkout_bootstrap',
    clientType: 'web',
    acquisitionId: 'acq_ph_1',
    visitorId: 'visitor_ph_1',
    sessionId: 'session_ph_1',
    source: 'producthunt',
    utmSource: 'producthunt',
    utmMedium: 'listing',
    utmCampaign: 'thumbgate_launch',
    ctaId: 'pricing_pro',
    planId: 'pro',
    page: '/checkout/pro',
  });

  const analytics = getTelemetryAnalytics(tmpDir);
  assert.equal(analytics.visitors.byTrafficChannel.producthunt, 1);
  assert.equal(analytics.visitors.topTrafficChannel.key, 'producthunt');
  assert.equal(analytics.ctas.byTrafficChannel.producthunt, 1);
  assert.equal(analytics.ctas.checkoutStartsByTrafficChannel.producthunt, 1);
});

test('getTelemetryAnalytics applies daily windows and summarizes checkout success telemetry', () => {
  fs.writeFileSync(path.join(tmpDir, 'telemetry-pings.jsonl'), [
    JSON.stringify({
      receivedAt: '2026-03-18T23:55:00.000Z',
      eventType: 'landing_page_view',
      clientType: 'web',
      acquisitionId: 'acq_old',
      visitorId: 'visitor_old',
      sessionId: 'session_old',
      source: 'website',
      page: '/',
    }),
    JSON.stringify({
      receivedAt: '2026-03-19T10:00:00.000Z',
      eventType: 'checkout_start',
      clientType: 'web',
      acquisitionId: 'acq_today',
      visitorId: 'visitor_today',
      sessionId: 'session_today',
      ctaId: 'pricing_pro',
      source: 'website',
      utmCampaign: 'launch_today',
    }),
    JSON.stringify({
      receivedAt: '2026-03-19T10:01:00.000Z',
      eventType: 'checkout_success_page_view',
      clientType: 'web',
      acquisitionId: 'acq_today',
      visitorId: 'visitor_today',
      sessionId: 'session_today',
      traceId: 'trace_today',
    }),
    JSON.stringify({
      receivedAt: '2026-03-19T10:02:00.000Z',
      eventType: 'checkout_paid_confirmed',
      clientType: 'web',
      acquisitionId: 'acq_today',
      visitorId: 'visitor_today',
      sessionId: 'session_today',
      traceId: 'trace_today',
    }),
    JSON.stringify({
      receivedAt: '2026-03-19T10:03:00.000Z',
      eventType: 'checkout_session_lookup_failed',
      clientType: 'web',
      acquisitionId: 'acq_today',
      visitorId: 'visitor_today',
      sessionId: 'session_today',
      traceId: 'trace_today',
      failureCode: 'session_lookup_timeout',
      httpStatus: 504,
    }),
    JSON.stringify({
      receivedAt: '2026-03-19T10:04:00.000Z',
      eventType: 'checkout_cancel_page_view',
      clientType: 'web',
      acquisitionId: 'acq_today',
      visitorId: 'visitor_today',
      sessionId: 'session_today',
      traceId: 'trace_today',
    }),
    '',
  ].join('\n'));

  const analytics = getTelemetryAnalytics(tmpDir, {
    window: 'today',
    timeZone: 'UTC',
    now: '2026-03-19T18:00:00.000Z',
  });

  assert.equal(analytics.window.window, 'today');
  assert.equal(analytics.window.timeZone, 'UTC');
  assert.equal(analytics.window.startLocalDate, '2026-03-19');
  assert.equal(analytics.totalEvents, 5);
  assert.equal(analytics.visitors.pageViews, 0);
  assert.equal(analytics.ctas.checkoutStarts, 1);
  assert.equal(analytics.ctas.successPageViews, 1);
  assert.equal(analytics.ctas.cancelPageViews, 1);
  assert.equal(analytics.ctas.paidConfirmations, 1);
  assert.equal(analytics.ctas.lookupFailures, 1);
  assert.equal(analytics.ctas.lookupFailuresByCode.session_lookup_timeout, 1);
  assert.equal(analytics.ctas.lookupFailuresByStatus['504'], 1);
  assert.equal(analytics.ctas.paidConfirmationRate, 1);
  assert.equal(analytics.ctas.successPageViewRate, 1);
});
