#!/usr/bin/env node
'use strict';

/**
 * Privacy-safe GitHub star history for ThumbGate discoverability.
 *
 * Source: GET /repos/{owner}/{repo}/stargazers/history
 *   https://docs.github.com/en/rest/activity/starring#get-repository-star-history
 *   Changelog: https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/
 *
 * Steal the FORMAT (weekly counts, no identities). Do not clone star-history.com
 * or emanuelef/daily-stars-explorer. Never call GET /stargazers (listing).
 *
 * Stars are not npm installs and not revenue.
 *
 * Usage:
 *   node scripts/star-history.js --fixture tests/fixtures/github-star-history.json --json
 *   node scripts/star-history.js --fetch --json
 *   node scripts/star-history.js --fetch --repo IgorGanapolsky/ThumbGate
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPO = 'IgorGanapolsky/ThumbGate';
const API_VERSION = '2026-03-10';
const HISTORY_PATH = '/stargazers/history';
const COUNT_PATH = '/stargazers/count';
const LISTING_PATH = '/stargazers';
const MAX_PER_PAGE = 30;
const MAX_PAGES = 100;
const DAY_NAMES = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

function parseArgs(argv) {
  const out = {
    fixture: null,
    fetch: false,
    repo: DEFAULT_REPO,
    json: false,
    help: false,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--fetch') out.fetch = true;
    else if (arg === '--fixture' && next) {
      out.fixture = next;
      i += 1;
    } else if (arg === '--repo' && next) {
      out.repo = next;
      i += 1;
    } else if (arg === '--token' && next) {
      out.token = next;
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (out.repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(out.repo)) {
    throw new Error(`Invalid --repo slug: ${out.repo}`);
  }
  return out;
}

function assertNoIdentities(value, trail = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoIdentities(item, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (/^(login|user|stargazer|actor|email|node_id)$/i.test(key)) {
        throw new Error(`Identity field ${key} at ${trail} — refuse listing payloads`);
      }
      assertNoIdentities(value[key], `${trail}.${key}`);
    }
  }
}

function validateWeek(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`week[${index}] is not an object`);
  }
  const week = Number(row.week);
  const total = Number(row.total);
  const days = row.days;
  if (!Number.isFinite(week) || week <= 0) {
    throw new Error(`week[${index}].week must be a positive unix timestamp`);
  }
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`week[${index}].total must be a non-negative integer`);
  }
  if (!Array.isArray(days) || days.length !== 7) {
    throw new Error(`week[${index}].days must be length 7 (Sun–Sat)`);
  }
  const dayInts = days.map((day, dayIndex) => {
    const n = Number(day);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`week[${index}].days[${dayIndex}] must be a non-negative integer`);
    }
    return n;
  });
  const daySum = dayInts.reduce((sum, n) => sum + n, 0);
  if (daySum !== total) {
    throw new Error(`week[${index}] days sum ${daySum} !== total ${total}`);
  }
  return { week, total, days: dayInts, weekIso: new Date(week * 1000).toISOString().slice(0, 10) };
}

function validateHistory(payload) {
  if (!Array.isArray(payload)) {
    throw new Error('star history payload must be an array of weeks');
  }
  assertNoIdentities(payload);
  return payload.map(validateWeek);
}

function lastNWeeks(weeks, n) {
  const newestFirst = [...weeks].sort((a, b) => b.week - a.week);
  return newestFirst.slice(0, n);
}

function buildReport({ weeks, count, repo, source }) {
  const addedStars = weeks.reduce((sum, row) => sum + row.total, 0);
  const nonzero = weeks.filter((row) => row.total > 0);
  const recent = lastNWeeks(weeks, 4);
  const recentAdded = recent.reduce((sum, row) => sum + row.total, 0);
  const current = Number.isInteger(count) ? count : null;
  return {
    ok: weeks.length > 0,
    status: weeks.length > 0 ? 'OK' : 'UNAVAILABLE',
    source,
    repo,
    endpoint: `GET /repos/{owner}/{repo}${HISTORY_PATH}`,
    listingEndpointUsed: false,
    weekCount: weeks.length,
    addedStars,
    currentStars: current,
    recentFourWeeksAdded: recentAdded,
    lastNonzeroWeek: nonzero.length ? lastNWeeks(nonzero, 1)[0].weekIso : null,
    recentWeeks: recent.map((row) => ({
      week: row.weekIso,
      total: row.total,
      days: Object.fromEntries(row.days.map((n, i) => [DAY_NAMES[i], n])),
    })),
    disclaimer:
      'Privacy-safe weekly star *creates* (no stargazer identities). Stars are not npm installs and not revenue. Unstars can make currentStars < addedStars.',
  };
}

function formatText(report) {
  const lines = [
    `star-history  status=${report.status}  repo=${report.repo}`,
    `source=${report.source}  listingUsed=${report.listingEndpointUsed}`,
    `weeks=${report.weekCount} addedStars=${report.addedStars} currentStars=${report.currentStars}`,
    `recentFourWeeksAdded=${report.recentFourWeeksAdded} lastNonzeroWeek=${report.lastNonzeroWeek}`,
    report.disclaimer,
  ];
  for (const week of report.recentWeeks) {
    lines.push(`  ${week.week}  +${week.total}`);
  }
  return `${lines.join('\n')}\n`;
}

function githubGet(pathname, { token } = {}) {
  if (pathname.includes(LISTING_PATH) && !pathname.includes(HISTORY_PATH) && !pathname.includes(COUNT_PATH)) {
    return Promise.reject(new Error('Refusing stargazer listing endpoint'));
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'thumbgate-star-history/1.0',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com${pathname}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API ${res.statusCode} for ${pathname}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${pathname}: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error(`timeout fetching ${pathname}`)));
  });
}

async function fetchHistory(repo, { token, get = githubGet } = {}) {
  const weeks = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await get(
      `/repos/${repo}${HISTORY_PATH}?per_page=${MAX_PER_PAGE}&page=${page}`,
      { token },
    );
    const batch = validateHistory(payload);
    if (batch.length === 0) break;
    weeks.push(...batch);
    if (batch.length < MAX_PER_PAGE) break;
  }
  return weeks;
}

async function fetchCount(repo, { token, get = githubGet } = {}) {
  const payload = await get(`/repos/${repo}${COUNT_PATH}`, { token });
  assertNoIdentities(payload);
  const count = Number(payload && payload.count);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('stargazers/count.count must be a non-negative integer');
  }
  return count;
}

async function run(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/star-history.js [--fixture PATH | --fetch] [--repo owner/repo] [--json]\n',
    );
    return { ok: true, status: 'HELP' };
  }

  let weeks;
  let count = null;
  let source;
  if (args.fixture) {
    const fixturePath = path.isAbsolute(args.fixture)
      ? args.fixture
      : path.join(REPO_ROOT, args.fixture);
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    weeks = validateHistory(raw);
    source = `fixture:${path.relative(REPO_ROOT, fixturePath)}`;
  } else if (args.fetch) {
    const get = deps.get || githubGet;
    weeks = await fetchHistory(args.repo, { token: args.token, get });
    try {
      count = await fetchCount(args.repo, { token: args.token, get });
    } catch (err) {
      count = null;
      source = `fetch:${args.repo} (count unavailable: ${err.message})`;
    }
    source = source || `fetch:${args.repo}`;
  } else {
    throw new Error('Provide --fixture PATH or --fetch');
  }

  if (weeks.length === 0) {
    const unavailable = {
      ok: false,
      status: 'UNAVAILABLE',
      source,
      repo: args.repo,
      reason: 'zero weeks in star history payload — refuse invented growth',
      listingEndpointUsed: false,
      weekCount: 0,
      addedStars: 0,
      currentStars: count,
      recentFourWeeksAdded: 0,
      lastNonzeroWeek: null,
      recentWeeks: [],
      disclaimer:
        'Privacy-safe weekly star *creates* (no stargazer identities). Stars are not npm installs and not revenue.',
    };
    if (args.json) process.stdout.write(`${JSON.stringify(unavailable, null, 2)}\n`);
    else process.stdout.write(formatText(unavailable));
    process.exitCode = 2;
    return unavailable;
  }

  const report = buildReport({ weeks, count, repo: args.repo, source });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatText(report));
  process.exitCode = report.ok ? 0 : 2;
  return report;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  run().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exitCode = 1;
  });
}

module.exports = {
  API_VERSION,
  COUNT_PATH,
  DEFAULT_REPO,
  HISTORY_PATH,
  LISTING_PATH,
  assertNoIdentities,
  buildReport,
  fetchCount,
  fetchHistory,
  formatText,
  parseArgs,
  run,
  validateHistory,
  validateWeek,
};
