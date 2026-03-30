'use strict';

const https = require('https');

const NPM_PACKAGE = 'mcp-memory-gateway';
const GITHUB_REPO = 'IgorGanapolsky/ThumbGate';
const PLAUSIBLE_URL = 'https://plausible.io/rlhf-feedback-loop-production.up.railway.app';
const PRODUCTHUNT_URL = 'https://www.producthunt.com/products/mcp-memory-gateway';
const LANDING_PAGE = 'https://rlhf-feedback-loop-production.up.railway.app';

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

function formatReport(monthly, weekly, github, npmMeta) {
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

async function run() {
  try {
    const [monthly, weekly, github, npmMeta] = await Promise.all([
      fetchNpmMonthly(),
      fetchNpmWeekly(),
      fetchGitHub(),
      fetchNpmVersions().catch(() => null),
    ]);
    console.log(formatReport(monthly, weekly, github, npmMeta));
  } catch (err) {
    console.error('Analytics fetch failed:', err.message);
    process.exit(1);
  }
}

module.exports = { run, formatReport, fetchNpmMonthly, fetchNpmWeekly, fetchGitHub, estimateOrganicDownloads };

if (require.main === module) {
  run();
}
