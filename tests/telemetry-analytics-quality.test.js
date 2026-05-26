'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  TELEMETRY_FILE_NAME,
  appendTelemetryEvent,
  classifyTelemetryAudience,
  getTelemetryAnalytics,
  sanitizeTelemetryPayload,
} = require('../scripts/telemetry-analytics');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-telemetry-quality-'));
}

test('classifies audit, example, and automation events away from external demand', () => {
  const testIdentity = sanitizeTelemetryPayload({
    eventType: 'checkout_start',
    clientType: 'web',
    visitorId: 'codex-verification-visitor',
    customerEmail: 'buyer@example.com',
    source: 'codex_audit',
    page: '/pricing',
  }, { 'user-agent': 'curl/8.0' });

  assert.equal(testIdentity.audience, 'test');
  assert.equal(testIdentity.isExternal, false);
  assert.ok(testIdentity.audienceReasons.includes('test_identity'));

  const external = classifyTelemetryAudience({
    eventType: 'landing_page_view',
    clientType: 'web',
    visitorId: 'visitor_real_1',
    source: 'reddit',
    page: '/',
    userAgent: 'Mozilla/5.0',
  });

  assert.equal(external.audience, 'external');
  assert.equal(external.isExternal, true);
});

test('reports qualified external traffic separately from raw polluted telemetry', () => {
  const tmpDir = makeTmpDir();
  const now = new Date().toISOString();

  appendTelemetryEvent(tmpDir, {
    receivedAt: now,
    eventType: 'landing_page_view',
    clientType: 'web',
    visitorId: 'visitor_real',
    sessionId: 'session_real',
    source: 'reddit',
    utmSource: 'reddit',
    utmCampaign: 'launch',
    page: '/',
  }, { 'user-agent': 'Mozilla/5.0' });

  appendTelemetryEvent(tmpDir, {
    receivedAt: now,
    eventType: 'checkout_start',
    clientType: 'web',
    visitorId: 'visitor_real',
    sessionId: 'session_real',
    acquisitionId: 'acq_real',
    source: 'reddit',
    utmSource: 'reddit',
    utmCampaign: 'launch',
    page: '/',
    ctaId: 'pricing_pro',
  }, { 'user-agent': 'Mozilla/5.0' });

  appendTelemetryEvent(tmpDir, {
    receivedAt: now,
    eventType: 'landing_page_view',
    clientType: 'web',
    visitorId: 'codex-verification-visitor',
    sessionId: 'session_audit',
    source: 'codex_audit',
    page: '/pro',
  }, { 'user-agent': 'curl/8.0' });

  const analytics = getTelemetryAnalytics(tmpDir, { window: '30d' });

  assert.equal(fs.existsSync(path.join(tmpDir, TELEMETRY_FILE_NAME)), true);
  assert.equal(analytics.totalEvents, 3);
  assert.equal(analytics.visitors.uniqueVisitors, 2);
  assert.equal(analytics.trafficQuality.rawEvents, 3);
  assert.equal(analytics.trafficQuality.externalEvents, 2);
  assert.equal(analytics.trafficQuality.excludedEvents, 1);
  assert.equal(analytics.trafficQuality.external.uniqueVisitors, 1);
  assert.equal(analytics.trafficQuality.external.pageViews, 1);
  assert.equal(analytics.trafficQuality.external.checkoutStarts, 1);
  assert.equal(analytics.trafficQuality.external.visitorPaths.length, 1);
  assert.deepEqual(
    analytics.trafficQuality.external.visitorPaths[0].events.map((event) => event.eventType),
    ['landing_page_view', 'checkout_start']
  );
  assert.equal(analytics.trafficQuality.verdict, 'usable');
  assert.equal(analytics.qualified.uniqueVisitors, 1);
});
