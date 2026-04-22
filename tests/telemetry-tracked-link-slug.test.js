'use strict';

/**
 * tests/telemetry-tracked-link-slug.test.js
 *
 * Pins the /go/:slug read-side aggregation. Attribution was instrumented in
 * #1118 (every /go/:slug hit appends telemetry with linkSlug, utm*, and — if
 * the visitor continues — a downstream checkout_start event sharing the same
 * visitor/session ids). This test asserts that getTelemetryAnalytics rolls
 * those events up into per-slug click + checkout counts + conversion rate so
 * a dashboard panel can read them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendTelemetryEvent,
  getTelemetryAnalytics,
  TELEMETRY_FILE_NAME,
} = require('../scripts/telemetry-analytics');

function withTempFeedbackDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tracked-link-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('trackedLinks panel is empty when no linkSlug events are present', () => {
  withTempFeedbackDir((dir) => {
    appendTelemetryEvent(dir, {
      clientType: 'web',
      eventType: 'landing_page_view',
      page: '/',
      visitorId: 'v_1',
    });
    const analytics = getTelemetryAnalytics(dir);
    assert.equal(analytics.trackedLinks.totalHits, 0);
    assert.equal(analytics.trackedLinks.totalCheckoutStarts, 0);
    assert.deepEqual(analytics.trackedLinks.bySlug, {});
    assert.equal(analytics.trackedLinks.topSlug, null);
  });
});

test('trackedLinks aggregates hits per slug from cta_click events', () => {
  withTempFeedbackDir((dir) => {
    const hits = [
      { slug: 'pro', visitor: 'v_1' },
      { slug: 'pro', visitor: 'v_2' },
      { slug: 'team', visitor: 'v_3' },
    ];
    for (const h of hits) {
      appendTelemetryEvent(dir, {
        clientType: 'web',
        eventType: 'cta_click',
        ctaId: 'go_' + h.slug,
        linkSlug: h.slug,
        visitorId: h.visitor,
        sessionId: 's_' + h.visitor,
      });
    }

    const analytics = getTelemetryAnalytics(dir);
    assert.equal(analytics.trackedLinks.totalHits, 3);
    assert.equal(analytics.trackedLinks.bySlug.pro.hits, 2);
    assert.equal(analytics.trackedLinks.bySlug.team.hits, 1);
    assert.equal(analytics.trackedLinks.topSlug.key, 'pro');
    assert.equal(analytics.trackedLinks.topSlug.count, 2);
  });
});

test('trackedLinks rolls up checkoutStarts per slug and computes conversion rate', () => {
  withTempFeedbackDir((dir) => {
    for (let i = 0; i < 4; i++) {
      appendTelemetryEvent(dir, {
        clientType: 'web',
        eventType: 'cta_click',
        ctaId: 'go_pro',
        linkSlug: 'pro',
        visitorId: 'v_pro_' + i,
        sessionId: 's_pro_' + i,
      });
    }
    for (let i = 0; i < 2; i++) {
      appendTelemetryEvent(dir, {
        clientType: 'web',
        eventType: 'checkout_start',
        linkSlug: 'pro',
        visitorId: 'v_pro_' + i,
        sessionId: 's_pro_' + i,
      });
    }
    appendTelemetryEvent(dir, {
      clientType: 'web',
      eventType: 'cta_click',
      ctaId: 'go_team',
      linkSlug: 'team',
      visitorId: 'v_team_1',
      sessionId: 's_team_1',
    });

    const analytics = getTelemetryAnalytics(dir);
    assert.equal(analytics.trackedLinks.bySlug.pro.hits, 4);
    assert.equal(analytics.trackedLinks.bySlug.pro.checkoutStarts, 2);
    assert.equal(analytics.trackedLinks.bySlug.pro.conversionRate, 0.5);
    assert.equal(analytics.trackedLinks.bySlug.team.hits, 1);
    assert.equal(analytics.trackedLinks.bySlug.team.checkoutStarts, 0);
    assert.equal(analytics.trackedLinks.bySlug.team.conversionRate, 0);
    assert.equal(analytics.trackedLinks.overallConversionRate, 0.4);
    assert.equal(analytics.trackedLinks.totalHits, 5);
    assert.equal(analytics.trackedLinks.totalCheckoutStarts, 2);
  });
});

test('trackedLinks ignores CLI events (web-only aggregation)', () => {
  withTempFeedbackDir((dir) => {
    appendTelemetryEvent(dir, {
      clientType: 'cli',
      eventType: 'cta_click',
      linkSlug: 'pro',
    });
    const analytics = getTelemetryAnalytics(dir);
    assert.equal(analytics.trackedLinks.totalHits, 0);
  });
});

test('telemetry payload file exists and contains linkSlug', () => {
  withTempFeedbackDir((dir) => {
    appendTelemetryEvent(dir, {
      clientType: 'web',
      eventType: 'cta_click',
      linkSlug: 'pro',
      visitorId: 'v_1',
    });
    const filePath = path.join(dir, TELEMETRY_FILE_NAME);
    assert.equal(fs.existsSync(filePath), true);
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.linkSlug, 'pro');
  });
});
