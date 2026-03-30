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

function formatReport(monthly, weekly, github) {
  const weeklyDownloads = weekly.downloads || 0;
  const monthlyDownloads = (monthly.downloads || []).reduce((sum, d) => sum + d.downloads, 0);
  const dailyValues = (monthly.downloads || []).slice(-7).map((d) => d.downloads);
  const trend = sparkline(dailyValues);

  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════╗',
    '║          ThumbGate — Unified Analytics Snapshot          ║',
    '╚══════════════════════════════════════════════════════════╝',
    '',
    '📦 npm — mcp-memory-gateway',
    `   Weekly downloads:  ${weeklyDownloads.toLocaleString()}`,
    `   Monthly downloads: ${monthlyDownloads.toLocaleString()}`,
    `   Daily trend (7d):  ${trend}  [${dailyValues.join(', ')}]`,
    '',
    '⭐ GitHub — IgorGanapolsky/ThumbGate',
    `   Stars:       ${(github.stargazers_count || 0).toLocaleString()}`,
    `   Forks:       ${(github.forks_count || 0).toLocaleString()}`,
    `   Open issues: ${(github.open_issues_count || 0).toLocaleString()}`,
    `   Watchers:    ${(github.subscribers_count || 0).toLocaleString()}`,
    '',
    '🌐 Landing Page',
    `   Plausible dashboard: ${PLAUSIBLE_URL}`,
    '',
    '🚀 ProductHunt',
    `   Listing: ${PRODUCTHUNT_URL}`,
    '',
    '🔗 Suggested UTM links for sharing',
    `   Twitter:     ${LANDING_PAGE}?utm_source=twitter&utm_medium=social&utm_campaign=launch`,
    `   LinkedIn:    ${LANDING_PAGE}?utm_source=linkedin&utm_medium=social&utm_campaign=launch`,
    `   Reddit:      ${LANDING_PAGE}?utm_source=reddit&utm_medium=social&utm_campaign=launch`,
    `   Newsletter:  ${LANDING_PAGE}?utm_source=newsletter&utm_medium=email&utm_campaign=launch`,
    `   HackerNews:  ${LANDING_PAGE}?utm_source=hackernews&utm_medium=social&utm_campaign=launch`,
    '',
  ];

  return lines.join('\n');
}

async function run() {
  try {
    const [monthly, weekly, github] = await Promise.all([
      fetchNpmMonthly(),
      fetchNpmWeekly(),
      fetchGitHub(),
    ]);
    console.log(formatReport(monthly, weekly, github));
  } catch (err) {
    console.error('Analytics fetch failed:', err.message);
    process.exit(1);
  }
}

module.exports = { run, formatReport, fetchNpmMonthly, fetchNpmWeekly, fetchGitHub };

if (require.main === module) {
  run();
}
