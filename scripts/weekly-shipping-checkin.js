'use strict';

const https = require('node:https');
const { runAsyncCli } = require('./social-analytics/cli-entrypoint');

const PACKAGE_NAME = 'thumbgate';
const RELEASE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function parseArgs(argv = []) {
  const options = { nextStep: '' };
  for (const arg of argv) {
    if (arg.startsWith('--next=')) {
      options.nextStep = arg.slice('--next='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'thumbgate-weekly-checkin' } }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} fetching ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
        }
      });
    }).on('error', reject);
  });
}

function fetchNpmMetadata() {
  return fetchJson(`https://registry.npmjs.org/${PACKAGE_NAME}`);
}

function fetchNpmWeeklyDownloads() {
  return fetchJson(`https://api.npmjs.org/downloads/point/last-week/${PACKAGE_NAME}`);
}

function findRecentRelease(metadata, now = new Date()) {
  const time = metadata && metadata.time;
  if (!time || typeof time !== 'object' || Array.isArray(time)) {
    return { status: 'unavailable' };
  }

  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Invalid check-in date');
  const cutoffMs = nowMs - RELEASE_WINDOW_MS;
  const releases = Object.entries(time)
    .filter(([version]) => version !== 'created' && version !== 'modified')
    .map(([version, timestamp]) => ({ version, timestamp, publishedMs: Date.parse(timestamp) }))
    .filter(({ publishedMs }) => (
      Number.isFinite(publishedMs) && publishedMs >= cutoffMs && publishedMs <= nowMs
    ))
    .sort((left, right) => right.publishedMs - left.publishedMs);

  if (releases.length === 0) return { status: 'none' };
  return {
    status: 'published',
    version: releases[0].version,
    publishedAt: new Date(releases[0].publishedMs).toISOString(),
  };
}

function readWeeklyDownloads(response) {
  const downloads = response && response.downloads;
  return Number.isInteger(downloads) && downloads >= 0 ? downloads : null;
}

function formatCheckin({ npmMetadata, weeklyDownloads, nextStep = '', now = new Date() }) {
  const release = findRecentRelease(npmMetadata, now);
  const shipped = release.status === 'published'
    ? `ThumbGate npm v${release.version} (published ${release.publishedAt})`
    : release.status === 'none'
      ? 'no verified ThumbGate npm release in the past 7 days'
      : 'unavailable (npm registry release metadata missing)';
  const number = weeklyDownloads === null
    ? 'weekly npm downloads unavailable'
    : `${weeklyDownloads.toLocaleString()} npm downloads (npm last-week window)`;
  const next = String(nextStep || '').replace(/\s+/g, ' ').trim() || 'Not recorded';

  return [
    `What shipped: ${shipped}`,
    `The number: ${number}; users/subscribers unavailable from this source`,
    `What's next: ${next}`,
  ].join('\n');
}

async function collectCheckin(fetchers = {}) {
  const getMetadata = fetchers.fetchNpmMetadata || fetchNpmMetadata;
  const getDownloads = fetchers.fetchNpmWeeklyDownloads || fetchNpmWeeklyDownloads;
  const [npmMetadata, weeklyResponse] = await Promise.all([getMetadata(), getDownloads()]);
  return {
    npmMetadata,
    weeklyDownloads: readWeeklyDownloads(weeklyResponse),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const data = await collectCheckin();
  process.stdout.write(`${formatCheckin({ ...data, nextStep: options.nextStep })}\n`);
}

runAsyncCli(main, __filename);

module.exports = {
  PACKAGE_NAME,
  RELEASE_WINDOW_MS,
  parseArgs,
  fetchNpmMetadata,
  fetchNpmWeeklyDownloads,
  findRecentRelease,
  readWeeklyDownloads,
  formatCheckin,
  collectCheckin,
};
