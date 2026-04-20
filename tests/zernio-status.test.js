'use strict';

/**
 * tests/zernio-status.test.js
 *
 * Verifies the CEO-visible status report:
 *   - Reports non-healthy when engagement_metrics has no rows in the last 24h
 *   - Reports healthy when at least one row exists
 *   - Surfaces per-platform counts for the six focus channels
 *   - Rendered output names the likely Zernio failure modes when unhealthy
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { initDb, upsertMetric } = require('../scripts/social-analytics/store');
const {
  EXPECTED_PLATFORMS,
  buildStatus,
  renderStatus,
} = require('../scripts/social-analytics/zernio-status');

function freshDb() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zernio-status-'));
  const dbPath = path.join(tmp, 'social.db');
  const db = initDb(dbPath);
  return { db, tmp, dbPath };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

test('EXPECTED_PLATFORMS covers the six focus channels', () => {
  assert.deepEqual(
    Array.from(EXPECTED_PLATFORMS).sort(),
    ['bluesky', 'instagram', 'linkedin', 'reddit', 'threads', 'youtube']
  );
});

test('buildStatus reports unhealthy on empty DB', () => {
  const { db, tmp } = freshDb();
  try {
    const status = buildStatus(db);
    assert.equal(status.healthy, false);
    assert.equal(status.totalRows, 0);
    assert.equal(status.healthyPlatforms, 0);
    assert.equal(status.expectedPlatforms, 6);
    // Every expected platform is present in the per-platform report with NO_DATA
    assert.equal(status.perPlatform.length, 6);
    for (const row of status.perPlatform) {
      assert.equal(row.status, 'NO_DATA');
      assert.equal(row.rows_24h, 0);
      assert.equal(row.last_fetched_at, null);
    }
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildStatus reports healthy when a recent metric exists', () => {
  const { db, tmp } = freshDb();
  try {
    upsertMetric(db, {
      platform: 'reddit',
      content_type: 'post',
      post_id: 'r-1',
      metric_date: todayIso(),
      impressions: 10,
      likes: 2,
      fetched_at: new Date().toISOString(),
    });

    const status = buildStatus(db);
    assert.equal(status.healthy, true);
    assert.equal(status.totalRows, 1);
    assert.equal(status.healthyPlatforms, 1);

    const reddit = status.perPlatform.find((p) => p.platform === 'reddit');
    assert.equal(reddit.status, 'OK');
    assert.equal(reddit.rows_24h, 1);
    assert.ok(reddit.last_fetched_at, 'reddit row must have a fetched_at timestamp');

    // Other platforms still NO_DATA
    const linkedin = status.perPlatform.find((p) => p.platform === 'linkedin');
    assert.equal(linkedin.status, 'NO_DATA');
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('renderStatus output includes failure-mode hints when unhealthy', () => {
  const { db, tmp } = freshDb();
  try {
    const status = buildStatus(db);
    const rendered = renderStatus(status);
    assert.match(rendered, /NO DATA in the last 24h/);
    assert.match(rendered, /ZERNIO_API_KEY/);
    assert.match(rendered, /Analytics add-on required/);
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('renderStatus output celebrates when healthy', () => {
  const { db, tmp } = freshDb();
  try {
    upsertMetric(db, {
      platform: 'linkedin',
      content_type: 'post',
      post_id: 'li-1',
      metric_date: todayIso(),
      impressions: 5,
      fetched_at: new Date().toISOString(),
    });
    const rendered = renderStatus(buildStatus(db));
    assert.match(rendered, /Zernio analytics are flowing/);
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildStatus respects custom windowHours', () => {
  const { db, tmp } = freshDb();
  try {
    // Insert a row dated 5 days ago
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    upsertMetric(db, {
      platform: 'youtube',
      content_type: 'video',
      post_id: 'yt-1',
      metric_date: fiveDaysAgo,
      video_views: 100,
      fetched_at: new Date().toISOString(),
    });

    // 24h window → should be empty
    const narrow = buildStatus(db, { windowHours: 24 });
    assert.equal(narrow.totalRows, 0);

    // 10-day window → should find the row
    const wide = buildStatus(db, { windowHours: 10 * 24 });
    assert.equal(wide.totalRows, 1);
    assert.equal(wide.healthy, true);
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
