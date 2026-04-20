'use strict';

/**
 * Zernio status report — CEO-visible.
 *
 * Queries the local engagement_metrics SQLite table and reports per-platform
 * ingest freshness. Exits non-zero when zero rows have been ingested in the
 * last 24 hours — making silent Zernio 402 / auth / rate-limit failures LOUD
 * in CI and in the npm output.
 *
 * Usage:
 *   node scripts/social-analytics/zernio-status.js
 *   npm run social:status
 *
 * Environment:
 *   THUMBGATE_SOCIAL_DB  — override the SQLite path (default: scripts/social-analytics/db/social-analytics.db)
 *   THUMBGATE_STATUS_WINDOW_HOURS — override the freshness window (default: 24)
 */

const path = require('node:path');
const { loadLocalEnv } = require('./load-env');

loadLocalEnv({ envPath: path.resolve(__dirname, '..', '..', '.env') });

const { initDb } = require('./store');

const EXPECTED_PLATFORMS = Object.freeze([
  'reddit',
  'linkedin',
  'bluesky',
  'threads',
  'instagram',
  'youtube',
]);

function formatRowsForReport(rows) {
  const byPlatform = new Map();
  for (const row of rows) {
    byPlatform.set(row.platform, row);
  }

  return EXPECTED_PLATFORMS.map((platform) => {
    const row = byPlatform.get(platform);
    if (!row) {
      return { platform, rows_24h: 0, last_fetched_at: null, status: 'NO_DATA' };
    }
    return {
      platform,
      rows_24h: row.row_count,
      last_fetched_at: row.last_fetched_at,
      status: row.row_count > 0 ? 'OK' : 'NO_DATA',
    };
  });
}

/**
 * Build a status report.
 * @param {import('better-sqlite3').Database} db
 * @param {{ windowHours?: number, now?: Date }} [options]
 */
function buildStatus(db, options = {}) {
  const envWindow = Number(process.env.THUMBGATE_STATUS_WINDOW_HOURS);
  const windowHours = options.windowHours
    ?? (Number.isFinite(envWindow) && envWindow > 0 ? envWindow : 24);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Platform-grouped freshness. metric_date is a YYYY-MM-DD string; fetched_at is ISO.
  let rows;
  try {
    rows = db
      .prepare(
        `
        SELECT
          platform,
          COUNT(*)          AS row_count,
          MAX(fetched_at)   AS last_fetched_at
        FROM engagement_metrics
        WHERE metric_date >= @cutoff
        GROUP BY platform
        `
      )
      .all({ cutoff });
  } catch (err) {
    // MemoryDatabase path raises for unseen queries; treat as "no data".
    if (/MemoryDatabase does not support query/.test(err.message)) {
      rows = [];
    } else {
      throw err;
    }
  }

  const perPlatform = formatRowsForReport(rows);
  const totalRows = perPlatform.reduce((acc, p) => acc + p.rows_24h, 0);
  const healthyPlatforms = perPlatform.filter((p) => p.status === 'OK').length;

  return {
    generatedAt: now.toISOString(),
    windowHours,
    cutoffDate: cutoff,
    totalRows,
    healthyPlatforms,
    expectedPlatforms: EXPECTED_PLATFORMS.length,
    perPlatform,
    healthy: totalRows > 0,
  };
}

function renderStatus(status) {
  const lines = [];
  lines.push('=== Zernio Social Status ===');
  lines.push(`Generated: ${status.generatedAt}`);
  lines.push(`Window:    last ${status.windowHours}h (since ${status.cutoffDate})`);
  lines.push(`Healthy:   ${status.healthyPlatforms}/${status.expectedPlatforms} platforms`);
  lines.push(`Total rows: ${status.totalRows}`);
  lines.push('');
  lines.push('Platform      Rows(24h)  Last fetched at');
  lines.push('----------    ---------  ----------------------------');
  for (const row of status.perPlatform) {
    const platform = row.platform.padEnd(13);
    const count = String(row.rows_24h).padStart(9);
    const fetched = row.last_fetched_at || '(never)';
    const marker = row.status === 'OK' ? '✅' : '❌';
    lines.push(`${marker} ${platform} ${count}  ${fetched}`);
  }
  lines.push('');
  if (!status.healthy) {
    lines.push('❌ NO DATA in the last 24h.');
    lines.push('   Likely causes:');
    lines.push('     • ZERNIO_API_KEY missing or revoked');
    lines.push('     • Zernio 402 "Analytics add-on required" paywall');
    lines.push('     • No accounts connected in Zernio dashboard');
    lines.push('   Run: node scripts/social-analytics/pollers/zernio.js');
  } else {
    lines.push('✅ Zernio analytics are flowing.');
  }
  return lines.join('\n');
}

function main() {
  const db = initDb(process.env.THUMBGATE_SOCIAL_DB);
  try {
    const status = buildStatus(db);
    console.log(renderStatus(status));
    if (!status.healthy) {
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  EXPECTED_PLATFORMS,
  buildStatus,
  renderStatus,
};
