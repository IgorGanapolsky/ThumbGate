'use strict';

/**
 * Plausible Analytics poller — reads web traffic metrics via the Plausible API.
 *
 * Required environment variables:
 *   PLAUSIBLE_API_KEY  — Plausible API token
 *   PLAUSIBLE_SITE_ID  — Site domain registered in Plausible (e.g. example.com)
 */

const { upsertMetric, initDb } = require('../store');

const PLAUSIBLE_BASE = 'https://plausible.io/api/v1';

/**
 * Builds a Plausible API request URL and executes it.
 * Adds site_id and all extra params to the query string.
 * Throws on non-2xx responses or API-level error bodies.
 *
 * @param {string} endpoint - Path under /api/v1 (e.g. '/stats/aggregate')
 * @param {Record<string, string|number>} params - Additional query parameters.
 * @returns {Promise<object>} Parsed JSON response body.
 */
async function plausibleQuery(endpoint, params = {}) {
  const apiKey = process.env.PLAUSIBLE_API_KEY;
  const siteId = process.env.PLAUSIBLE_SITE_ID || 'thumbgate.ai';

  if (!apiKey) throw new Error('PLAUSIBLE_API_KEY is not set');

  const qs = new URLSearchParams({ site_id: siteId, ...params });
  const url = `${PLAUSIBLE_BASE}${endpoint}?${qs.toString()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Plausible API ${res.status} for ${endpoint}: ${body}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`Plausible API error for ${endpoint}: ${json.error}`);
  }

  return json;
}

/**
 * Fetches aggregate site metrics: visitors, pageviews, bounce_rate, visit_duration.
 *
 * @param {string} [period='7d'] - Plausible period string (e.g. '7d', '30d', 'month').
 * @returns {Promise<object>} Aggregate results object from Plausible.
 */
async function getVisitors(period = '7d') {
  return plausibleQuery('/stats/aggregate', {
    metrics: 'visitors,pageviews,bounce_rate,visit_duration',
    period,
  });
}

/**
 * Fetches traffic source breakdown.
 *
 * @param {string} [period='7d'] - Plausible period string.
 * @returns {Promise<object>} Breakdown results by visit:source.
 */
async function getSourceAttribution(period = '7d') {
  return plausibleQuery('/stats/breakdown', {
    property: 'visit:source',
    metrics: 'visitors,events',
    period,
    limit: 20,
  });
}

/**
 * Fetches breakdown by a specific UTM parameter.
 *
 * @param {string} utmParam - UTM dimension (e.g. 'utm_source', 'utm_medium', 'utm_campaign').
 * @param {string} [period='7d'] - Plausible period string.
 * @returns {Promise<object>} Breakdown results for the given UTM property.
 */
async function getUTMBreakdown(utmParam, period = '7d') {
  return plausibleQuery('/stats/breakdown', {
    property: `visit:${utmParam}`,
    metrics: 'visitors,events',
    period,
  });
}

/**
 * Fetches aggregate event count for a named custom event.
 *
 * @param {string} eventName - Plausible custom event name (e.g. 'CTA Click').
 * @param {string} [period='7d'] - Plausible period string.
 * @returns {Promise<object>} Aggregate results with events count.
 */
async function getCustomEventCount(eventName, period = '7d') {
  return plausibleQuery('/stats/aggregate', {
    metrics: 'events',
    period,
    filters: `event:name==${eventName}`,
  });
}

/**
 * Builds a funnel object from visitors, CTA Click, Checkout Start, and Purchase events.
 * Computes conversion rates between each stage.
 *
 * @param {string} [period='7d'] - Plausible period string.
 * @returns {Promise<object>} Funnel metrics with conversion rates.
 */
async function getFunnelMetrics(period = '7d') {
  const [visitorsRes, ctaRes, checkoutRes, purchaseRes] = await Promise.all([
    getVisitors(period),
    getCustomEventCount('CTA Click', period),
    getCustomEventCount('Checkout Start', period),
    getCustomEventCount('Purchase', period),
  ]);

  const visitors = visitorsRes.results?.visitors?.value ?? 0;
  const ctaClicks = ctaRes.results?.events?.value ?? 0;
  const checkoutStarts = checkoutRes.results?.events?.value ?? 0;
  const purchases = purchaseRes.results?.events?.value ?? 0;

  const rate = (numerator, denominator) =>
    denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;

  return {
    period,
    visitors,
    cta_clicks: ctaClicks,
    checkout_starts: checkoutStarts,
    purchases,
    visitor_to_cta_pct: rate(ctaClicks, visitors),
    cta_to_checkout_pct: rate(checkoutStarts, ctaClicks),
    checkout_to_purchase_pct: rate(purchases, checkoutStarts),
    visitor_to_purchase_pct: rate(purchases, visitors),
  };
}

/**
 * Main polling entry point. Fetches visitors, source attribution, and funnel
 * metrics for the last 7 days and upserts results into the engagement_metrics
 * table as platform='web', content_type='page'.
 *
 * @param {import('better-sqlite3').Database} db - Initialised db instance.
 * @returns {Promise<object>} Summary of stored results.
 */
async function pollPlausible(db) {
  const siteId = process.env.PLAUSIBLE_SITE_ID || 'thumbgate.ai';
  if (!process.env.PLAUSIBLE_API_KEY) throw new Error('PLAUSIBLE_API_KEY is not set');

  const period = '7d';
  const fetchedAt = new Date().toISOString();
  const metricDate = fetchedAt.slice(0, 10);

  console.log(`[plausible] Fetching web metrics for site ${siteId} (${period})…`);

  const [visitorsRes, sourceRes, funnelRes] = await Promise.all([
    getVisitors(period),
    getSourceAttribution(period),
    getFunnelMetrics(period),
  ]);

  const aggregateResults = visitorsRes.results ?? {};
  const visitors = aggregateResults.visitors?.value ?? 0;
  const pageviews = aggregateResults.pageviews?.value ?? 0;
  const bounceRate = aggregateResults.bounce_rate?.value ?? 0;
  const visitDuration = aggregateResults.visit_duration?.value ?? 0;

  console.log(
    `[plausible] visitors=${visitors} pageviews=${pageviews} ` +
      `bounce_rate=${bounceRate}% avg_duration=${visitDuration}s`
  );

  // Store aggregate web traffic as a single canonical record for the period.
  const record = {
    platform: 'web',
    content_type: 'page',
    post_id: `${siteId}:${period}:${metricDate}`,
    post_url: `https://${siteId}`,
    published_at: null,
    metric_date: metricDate,
    impressions: pageviews,
    reach: visitors,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    clicks: funnelRes.cta_clicks,
    video_views: 0,
    followers_delta: 0,
    extra_json: JSON.stringify({
      period,
      bounce_rate: bounceRate,
      visit_duration_seconds: visitDuration,
      sources: sourceRes.results ?? [],
      funnel: funnelRes,
    }),
    fetched_at: fetchedAt,
  };

  upsertMetric(db, record);
  console.log(`[plausible] Upserted web metric record for ${metricDate}`);
  console.log(
    `[plausible] Funnel: ${funnelRes.visitors} visitors → ` +
      `${funnelRes.cta_clicks} CTA clicks → ` +
      `${funnelRes.checkout_starts} checkouts → ` +
      `${funnelRes.purchases} purchases (${funnelRes.visitor_to_purchase_pct}%)`
  );

  console.log('[plausible] Poll complete.');
  return { record, funnel: funnelRes };
}

module.exports = {
  plausibleQuery,
  getVisitors,
  getSourceAttribution,
  getUTMBreakdown,
  getCustomEventCount,
  getFunnelMetrics,
  pollPlausible,
};

// Allow running directly: node scripts/social-analytics/pollers/plausible.js
if (require.main === module) {
  (async () => {
    const db = initDb();
    try {
      const results = await pollPlausible(db);
      console.log('[plausible] Results:', JSON.stringify(results, null, 2));
    } catch (err) {
      console.error('[plausible] Fatal error:', err.message);
      process.exit(1);
    } finally {
      db.close();
    }
  })();
}
