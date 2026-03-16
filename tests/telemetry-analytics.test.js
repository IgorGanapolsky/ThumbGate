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
