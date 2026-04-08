'use strict';

/**
 * Zernio analytics poller.
 *
 * Fetches daily metrics and per-post analytics from the Zernio API,
 * normalizes them, and upserts into the local SQLite database.
 *
 * Required environment variables:
 *   ZERNIO_API_KEY — Bearer token for https://zernio.com/api/v1
 */

const { normalizeZernioMetric } = require('../normalizer');
const { loadLocalEnv } = require('../load-env');
const { upsertMetric, initDb } = require('../store');
const { getConnectedAccounts } = require('../publishers/zernio');

const ZERNIO_BASE = 'https://zernio.com/api/v1';

loadLocalEnv();

function requireApiKey() {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) {
    throw new Error('ZERNIO_API_KEY environment variable is required');
  }
  return key;
}

async function zernioGet(endpoint) {
  const apiKey = requireApiKey();
  const url = `${ZERNIO_BASE}${endpoint}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Zernio API ${res.status} for GET ${endpoint}: ${errorText}`);
  }

  return res.json();
}

/**
 * Fetches daily engagement metrics for a specific account.
 * @param {string} accountId
 * @returns {Promise<object>}
 */
async function fetchDailyMetrics(accountId) {
  if (!accountId) throw new Error('fetchDailyMetrics: accountId is required');
  console.log(`[zernio:poller] Fetching daily metrics for account ${accountId}`);
  return zernioGet(`/analytics/daily-metrics?accountId=${encodeURIComponent(accountId)}`);
}

/**
 * Fetches per-post analytics for a specific post.
 * @param {string} postId
 * @returns {Promise<object>}
 */
async function fetchPostAnalytics(postId) {
  if (!postId) throw new Error('fetchPostAnalytics: postId is required');
  console.log(`[zernio:poller] Fetching post analytics for post ${postId}`);
  return zernioGet(`/analytics?postId=${encodeURIComponent(postId)}`);
}

/**
 * Main entry point. Polls Zernio for daily metrics and per-post analytics,
 * normalizes the data, and upserts into the local SQLite database.
 * @param {import('better-sqlite3').Database} db
 */
async function pollZernio(db) {
  requireApiKey();

  console.log('[zernio:poller] Starting Zernio analytics poll');

  let accounts;
  try {
    accounts = await getConnectedAccounts();
  } catch (err) {
    throw new Error(`[zernio:poller] Failed to fetch connected accounts: ${err.message}`);
  }

  if (!accounts || accounts.length === 0) {
    console.warn('[zernio:poller] No connected accounts found — skipping poll');
    return;
  }

  console.log(`[zernio:poller] Polling ${accounts.length} account(s)`);

  for (const account of accounts) {
    const accountId = account.accountId || account._id || account.id;
    const platform = account.platform;

    if (!accountId) {
      console.warn('[zernio:poller] Account missing accountId — skipping');
      continue;
    }

    try {
      const dailyResponse = await fetchDailyMetrics(accountId);
      const metrics = Array.isArray(dailyResponse)
        ? dailyResponse
        : (dailyResponse.data ?? dailyResponse.metrics ?? []);

      console.log(`[zernio:poller] Got ${metrics.length} daily metric(s) for account ${accountId}`);

      for (const rawMetric of metrics) {
        const enriched = {
          accountId,
          platform: rawMetric.platform || platform,
          ...rawMetric,
        };

        try {
          const normalized = normalizeZernioMetric(enriched);
          upsertMetric(db, normalized);
          console.log(`[zernio:poller] Upserted daily metric for post ${normalized.post_id} (${normalized.platform})`);
        } catch (normErr) {
          console.warn(`[zernio:poller] Normalization error for account ${accountId}: ${normErr.message}`);
        }
      }

      const postIds = metrics
        .map((m) => m.postId || m.id || m.platformPostId)
        .filter(Boolean);

      for (const postId of postIds) {
        try {
          const postResponse = await fetchPostAnalytics(postId);
          const postData = postResponse.data ?? postResponse;

          if (!postData || typeof postData !== 'object') continue;

          const enrichedPost = {
            accountId,
            platform: postData.platform || platform,
            ...postData,
          };

          try {
            const normalized = normalizeZernioMetric(enrichedPost);
            upsertMetric(db, normalized);
            console.log(`[zernio:poller] Upserted post analytics for post ${normalized.post_id}`);
          } catch (normErr) {
            console.warn(`[zernio:poller] Post analytics normalization error for post ${postId}: ${normErr.message}`);
          }
        } catch (postErr) {
          console.warn(`[zernio:poller] Post analytics fetch error for post ${postId}: ${postErr.message}`);
        }
      }
    } catch (err) {
      console.error(`[zernio:poller] Failed to poll account ${accountId}: ${err.message}`);
    }
  }

  console.log('[zernio:poller] Poll complete.');
}

module.exports = {
  pollZernio,
  fetchDailyMetrics,
  fetchPostAnalytics,
};

if (require.main === module) {
  (async () => {
    const db = initDb();
    try {
      await pollZernio(db);
    } catch (err) {
      console.error('[zernio:poller] Fatal error:', err.message);
      process.exit(1);
    } finally {
      db.close();
    }
  })();
}
