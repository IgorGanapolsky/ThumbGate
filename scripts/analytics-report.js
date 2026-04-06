'use strict';

const https = require('https');
const { PRODUCTHUNT_URL } = require('./distribution-surfaces');
const { getOperationalBillingSummary } = require('./operational-summary');
const { summarizeCreatorPerformance } = require('./creator-campaigns');
const { getFeedbackPaths } = require('./feedback-loop');
const { buildPredictiveInsights } = require('./predictive-insights');
const { getTelemetryAnalytics } = require('./telemetry-analytics');

const NPM_PACKAGE = 'mcp-memory-gateway';
const GITHUB_REPO = 'IgorGanapolsky/ThumbGate';
const PLAUSIBLE_URL = 'https://plausible.io/thumbgate-production.up.railway.app';
const LANDING_PAGE = 'https://thumbgate-production.up.railway.app';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mcp-memory-gateway-analytics' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sparkline(values) {
  const chars = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values, 1);
  return values.map((v) => chars[Math.min(Math.floor((v / max) * (chars.length - 1)), chars.length - 1)]).join('');
}

async function fetchNpmMonthly() {
  return httpsGet(`https://api.npmjs.org/downloads/range/last-month/${NPM_PACKAGE}`);
}

async function fetchNpmWeekly() {
  return httpsGet(`https://api.npmjs.org/downloads/point/last-week/${NPM_PACKAGE}`);
}

async function fetchGitHub() {
  return httpsGet(`https://api.github.com/repos/${GITHUB_REPO}`);
}

async function fetchNpmVersions() {
  return httpsGet(`https://registry.npmjs.org/${NPM_PACKAGE}`);
}

function loadTelemetrySnapshot() {
  const { FEEDBACK_DIR } = getFeedbackPaths();
  return getTelemetryAnalytics(FEEDBACK_DIR);
}

function getCounterValue(counter = {}, key) {
  return Number(counter && counter[key]) || 0;
}

function mergeDimensionCounters(metricCounters = {}) {
  const metrics = Object.keys(metricCounters);
  const rows = new Map();

  for (const metric of metrics) {
    const counter = metricCounters[metric] || {};
    for (const [rawKey, rawValue] of Object.entries(counter)) {
      const key = String(rawKey || '').trim() || 'unknown';
      const row = rows.get(key) || { key };
      row[metric] = Number(rawValue || 0);
      rows.set(key, row);
    }
  }

  return Array.from(rows.values());
}

function buildPredictiveStagingModel(telemetry = {}, billingSummary = {}) {
  return {
    dims: {
      sources: mergeDimensionCounters({
        pageViews: telemetry.visitors && telemetry.visitors.bySource,
        checkoutStarts: telemetry.ctas && telemetry.ctas.checkoutStartsBySource,
        acquisitionLeads: billingSummary.attribution && billingSummary.attribution.acquisitionBySource,
        paidCustomers: billingSummary.attribution && billingSummary.attribution.paidBySource,
        bookedRevenueCents: billingSummary.attribution && billingSummary.attribution.bookedRevenueBySourceCents,
      }),
      creators: mergeDimensionCounters({
        pageViews: telemetry.visitors && telemetry.visitors.byCreator,
        checkoutStarts: telemetry.ctas && telemetry.ctas.checkoutStartsByCreator,
        acquisitionLeads: billingSummary.attribution && billingSummary.attribution.acquisitionByCreator,
        paidCustomers: billingSummary.attribution && billingSummary.attribution.paidByCreator,
        bookedRevenueCents: billingSummary.attribution && billingSummary.attribution.bookedRevenueByCreatorCents,
        workflowSprintLeads: billingSummary.pipeline && billingSummary.pipeline.workflowSprintLeads && billingSummary.pipeline.workflowSprintLeads.byCreator,
        qualifiedWorkflowSprintLeads: billingSummary.pipeline && billingSummary.pipeline.qualifiedWorkflowSprintLeads && billingSummary.pipeline.qualifiedWorkflowSprintLeads.byCreator,
      }),
    },
  };
}

function resolveProductHuntCount(primaryCounter = {}, secondaryCounter = {}) {
  const primary = getCounterValue(primaryCounter, 'producthunt');
  if (primary > 0) return primary;
  return getCounterValue(secondaryCounter, 'producthunt');
}

async function collectAnalytics(fetchers = {}) {
  const fetchMonthly = fetchers.fetchNpmMonthly || fetchNpmMonthly;
  const fetchWeekly = fetchers.fetchNpmWeekly || fetchNpmWeekly;
  const fetchRepo = fetchers.fetchGitHub || fetchGitHub;
  const fetchVersions = fetchers.fetchNpmVersions || fetchNpmVersions;
  const fetchTelemetry = fetchers.fetchTelemetry || loadTelemetrySnapshot;
  const fetchBillingSummary = fetchers.fetchBillingSummary || (async () => {
    const result = await getOperationalBillingSummary();
    return result.summary;
  });

  const [monthly, weekly, github, npmMeta, telemetry, billingSummary] = await Promise.all([
    fetchMonthly(),
    fetchWeekly(),
    fetchRepo(),
    fetchVersions().catch(() => null),
    Promise.resolve().then(() => fetchTelemetry()).catch(() => null),
    Promise.resolve().then(() => fetchBillingSummary()).catch(() => null),
  ]);

  return { monthly, weekly, github, npmMeta, telemetry, billingSummary };
}

/**
 * Estimate organic downloads by filtering out publish-day inflation.
 * npm registry mirrors, bot crawlers (socket.dev, snyk, bundlephobia),
 * and npm-stat bots all re-download on publish events.
 * Weekend days with no publishes give the organic baseline.
 */
function estimateOrganicDownloads(dailyDownloads, publishDates) {
  const publishSet = new Set(publishDates);

  let weekendNoPublishTotal = 0;
  let weekendNoPublishCount = 0;
  let publishDayTotal = 0;
  let publishDayCount = 0;
  let noPublishDayTotal = 0;
  let noPublishDayCount = 0;

  for (const day of dailyDownloads) {
    const dt = new Date(day.day + 'T00:00:00Z');
    const isWeekend = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
    const isPublishDay = publishSet.has(day.day);

    if (isPublishDay) {
      publishDayTotal += day.downloads;
      publishDayCount++;
    } else {
      noPublishDayTotal += day.downloads;
      noPublishDayCount++;
      if (isWeekend) {
        weekendNoPublishTotal += day.downloads;
        weekendNoPublishCount++;
      }
    }
  }

  const organicDailyBaseline = weekendNoPublishCount > 0
    ? Math.round(weekendNoPublishTotal / weekendNoPublishCount)
    : (noPublishDayCount > 0 ? Math.round(noPublishDayTotal / noPublishDayCount) : 0);

  const totalDownloads = dailyDownloads.reduce((s, d) => s + d.downloads, 0);
  const estimatedOrganic30d = organicDailyBaseline * 30;
  const estimatedInflated = totalDownloads - estimatedOrganic30d;
  const organicRate = totalDownloads > 0 ? (estimatedOrganic30d / totalDownloads * 100) : 0;

  return {
    organicDailyBaseline,
    estimatedOrganic30d,
    estimatedInflated: Math.max(0, estimatedInflated),
    organicRate: Math.min(100, organicRate),
    organicWeekly: organicDailyBaseline * 7,
    publishDayAvg: publishDayCount > 0 ? Math.round(publishDayTotal / publishDayCount) : 0,
    noPublishDayAvg: noPublishDayCount > 0 ? Math.round(noPublishDayTotal / noPublishDayCount) : 0,
    publishDayCount,
    totalDownloads,
  };
}

function formatCreatorRows(telemetry = null, billingSummary = null) {
  return summarizeCreatorPerformance(telemetry, billingSummary).map((entry, index) => {
    const revenueDollars = (entry.bookedRevenueCents / 100).toFixed(2);
    return `   ${index + 1}. ${entry.creator} — rev $${revenueDollars}, paid ${entry.paidOrders}, sprint ${entry.qualifiedSprintLeads}/${entry.sprintLeads}, checkouts ${entry.checkoutStarts}, visitors ${entry.visitors}`;
  });
}

function formatReport(monthly, weekly, github, npmMeta, telemetry = null, billingSummary = null) {
  const weeklyDownloads = weekly.downloads || 0;
  const allDays = monthly.downloads || [];
  const monthlyDownloads = allDays.reduce((sum, d) => sum + d.downloads, 0);
  const dailyValues = allDays.slice(-7).map((d) => d.downloads);
  const trend = sparkline(dailyValues);

  // Extract publish dates from npm registry metadata
  const publishDates = [];
  if (npmMeta && npmMeta.time) {
    for (const [version, timestamp] of Object.entries(npmMeta.time)) {
      if (version !== 'created' && version !== 'modified') {
        publishDates.push(timestamp.slice(0, 10));
      }
    }
  }

  const organic = estimateOrganicDownloads(allDays, publishDates);
  const productHuntVisitors = telemetry
    ? resolveProductHuntCount(telemetry.visitors.byTrafficChannel, telemetry.visitors.bySource)
    : 0;
  const productHuntCtas = telemetry
    ? resolveProductHuntCount(telemetry.ctas.byTrafficChannel, telemetry.ctas.bySource)
    : 0;
  const productHuntCheckouts = telemetry
    ? resolveProductHuntCount(telemetry.ctas.checkoutStartsByTrafficChannel, telemetry.ctas.checkoutStartsBySource)
    : 0;
  const telemetryWindow = telemetry && telemetry.window ? telemetry.window : 'all';
  const telemetryLastSeen = telemetry && telemetry.latestSeenAt ? telemetry.latestSeenAt : 'none';
  const creatorRows = formatCreatorRows(telemetry, billingSummary);
  const predictive = buildPredictiveInsights({
    telemetryAnalytics: telemetry || {},
    billingSummary: billingSummary || {},
    stagingModel: buildPredictiveStagingModel(telemetry || {}, billingSummary || {}),
  });

  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════════════╗',
    '║          ThumbGate — Unified Analytics Snapshot                  ║',
    '╚══════════════════════════════════════════════════════════════════╝',
    '',
    '📦 npm — mcp-memory-gateway (REPORTED)',
    `   Weekly downloads:  ${weeklyDownloads.toLocaleString()}`,
    `   Monthly downloads: ${monthlyDownloads.toLocaleString()}`,
    `   Daily trend (7d):  ${trend}  [${dailyValues.join(', ')}]`,
    '',
    '🔬 npm — ORGANIC ESTIMATE (excluding publish-day + bot inflation)',
    `   Organic baseline:  ~${organic.organicDailyBaseline}/day → ~${organic.organicWeekly}/week → ~${organic.estimatedOrganic30d.toLocaleString()}/month`,
    `   Publish-day avg:   ${organic.publishDayAvg}/day (${organic.publishDayCount} publish days this period)`,
    `   No-publish avg:    ${organic.noPublishDayAvg}/day`,
    `   Organic rate:      ${organic.organicRate.toFixed(1)}% of reported downloads`,
    `   Inflated by:       ~${organic.estimatedInflated.toLocaleString()} downloads (registry mirrors, bots, self-installs)`,
    '',
    '⭐ GitHub — IgorGanapolsky/ThumbGate',
    `   Stars:       ${(github.stargazers_count || 0).toLocaleString()}`,
    `   Forks:       ${(github.forks_count || 0).toLocaleString()}`,
    `   Open issues: ${(github.open_issues_count || 0).toLocaleString()}`,
    `   Watchers:    ${(github.subscribers_count || 0).toLocaleString()}`,
    '',
    '🌐 Landing Page',
    `   Plausible:  ${PLAUSIBLE_URL}`,
    `   ⚠️  Check Plausible to exclude your own IP (Settings → filter)`,
    '',
    '🚀 ProductHunt',
    `   Listing:    ${PRODUCTHUNT_URL}`,
    `   Tracked:    utm_source=producthunt → traffic_channel=producthunt`,
    `   Visitors:   ${productHuntVisitors}`,
    `   CTA clicks: ${productHuntCtas}`,
    `   Checkouts:  ${productHuntCheckouts}`,
    `   Window:     ${telemetryWindow}`,
    `   Last seen:  ${telemetryLastSeen}`,
    '',
    '🎥 Creator Partnerships',
    '   Ranked: booked revenue → paid orders → qualified sprint leads → checkouts',
    ...(creatorRows.length > 0 ? creatorRows : ['   No attributed creator campaigns yet.']),
    '',
    '🔮 Predictive Insights',
    `   Pro propensity:   ${predictive.upgradePropensity.pro.band} (${predictive.upgradePropensity.pro.score})`,
    `   Team propensity:  ${predictive.upgradePropensity.team.band} (${predictive.upgradePropensity.team.score})`,
    `   Revenue forecast: $${(predictive.revenueForecast.predictedBookedRevenueCents / 100).toFixed(2)} (+$${(predictive.revenueForecast.incrementalOpportunityCents / 100).toFixed(2)} opportunity)`,
    `   Predictive alerts:${predictive.anomalySummary.count} (${predictive.anomalySummary.severity})`,
    ...(predictive.topCreators[0]
      ? [`   Top creator opp: ${predictive.topCreators[0].key} → +$${(predictive.topCreators[0].opportunityRevenueCents / 100).toFixed(2)}`]
      : ['   Top creator opp: none yet']),
    ...(predictive.topSources[0]
      ? [`   Top channel opp: ${predictive.topSources[0].key} → +$${(predictive.topSources[0].opportunityRevenueCents / 100).toFixed(2)}`]
      : ['   Top channel opp: none yet']),
    '',
    '🔗 UTM links for sharing (tracks referral source in Plausible)',
    `   Twitter:     ${LANDING_PAGE}?utm_source=twitter&utm_medium=social&utm_campaign=launch`,
    `   LinkedIn:    ${LANDING_PAGE}?utm_source=linkedin&utm_medium=social&utm_campaign=launch`,
    `   Reddit:      ${LANDING_PAGE}?utm_source=reddit&utm_medium=social&utm_campaign=launch`,
    `   HackerNews:  ${LANDING_PAGE}?utm_source=hackernews&utm_medium=social&utm_campaign=launch`,
    '',
    '📏 HONEST METRICS (use these, not the inflated ones)',
    `   Real npm traction:  ~${organic.organicWeekly} downloads/week`,
    `   GitHub stars:       ${(github.stargazers_count || 0)}`,
    `   ProductHunt:        check listing for upvotes/followers`,
    `   Landing page:       check Plausible (exclude your IP!)`,
    '',
  ];

  return lines.join('\n');
}

async function run(options = {}) {
  const log = options.log || console.log;
  const error = options.error || console.error;
  const exit = options.exit || process.exit;

  try {
    const { monthly, weekly, github, npmMeta, telemetry, billingSummary } = await collectAnalytics(options.fetchers);
    log(formatReport(monthly, weekly, github, npmMeta, telemetry, billingSummary));
  } catch (err) {
    error('Analytics fetch failed:', err.message);
    exit(1);
  }
}

module.exports = {
  run,
  collectAnalytics,
  formatReport,
  fetchNpmMonthly,
  fetchNpmWeekly,
  fetchGitHub,
  fetchNpmVersions,
  estimateOrganicDownloads,
};

if (require.main === module) {
  run();
}
