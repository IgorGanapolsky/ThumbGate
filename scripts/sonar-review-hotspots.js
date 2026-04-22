#!/usr/bin/env node
'use strict';

/**
 * sonar-review-hotspots.js
 *
 * Walks .sonar-hotspot-reviews.json and marks each declared (filePath,
 * ruleKey, lineSubstring) triple as REVIEWED / <resolution> via the
 * SonarCloud API. Runs in CI between the Sonar scan and the Quality Gate
 * check so `new_security_hotspots_reviewed` passes without forcing a
 * manual UI click for every PR that touches a pre-approved pattern.
 *
 * Usage (CI):
 *   SONAR_TOKEN=... \
 *   SONAR_PROJECT_KEY=IgorGanapolsky_ThumbGate \
 *   SONAR_PULL_REQUEST=${PR_NUMBER} \
 *   node scripts/sonar-review-hotspots.js
 *
 * Locally (dry-run, prints planned actions without changing state):
 *   node scripts/sonar-review-hotspots.js --dry-run
 */

const fs = require('node:fs');
const path = require('node:path');

const SONAR_HOST = process.env.SONAR_HOST_URL || 'https://sonarcloud.io';
const ALLOWLIST_PATH = path.join(__dirname, '..', '.sonar-hotspot-reviews.json');

function log(msg) {
  process.stdout.write(`[sonar-review-hotspots] ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`[sonar-review-hotspots] ${msg}\n`);
}

async function sonarGet(route, params) {
  const url = new URL(`${SONAR_HOST}${route}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }
  const token = process.env.SONAR_TOKEN;
  if (!token) {
    throw new Error('SONAR_TOKEN is required');
  }
  const headers = { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` };
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`GET ${route} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function sonarPost(route, params) {
  const token = process.env.SONAR_TOKEN;
  if (!token) {
    throw new Error('SONAR_TOKEN is required');
  }
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      body.set(k, String(v));
    }
  }
  const res = await fetch(`${SONAR_HOST}${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${route} → ${res.status} ${res.statusText} ${text}`);
  }
  return res.status === 204 ? {} : res.json().catch(() => ({}));
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return { reviews: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${ALLOWLIST_PATH}: ${err.message}`);
  }
}

async function fetchSourceLine(componentKey, line, pullRequest) {
  try {
    const data = await sonarGet('/api/sources/lines', {
      key: componentKey,
      from: line,
      to: line,
      pullRequest,
    });
    const src = (data.sources && data.sources[0] && data.sources[0].code) || '';
    return stripHtmlTags(src);
  } catch {
    return '';
  }
}

// Strip HTML tags without a regex to avoid catastrophic backtracking on
// pathological input (SonarCloud S5852). SonarCloud returns source lines
// wrapped in <span class="..."> markers; we only need the plain text.
// Linear-time state machine: either "inside a tag" or "outside". A '<'
// while already inside stays inside (real HTML never does that, but the
// loop must stay O(n) either way).
function stripHtmlTags(input) {
  if (!input) return '';
  let out = '';
  let inTag = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inTag) {
      if (ch === '>') inTag = false;
      continue;
    }
    if (ch === '<') {
      inTag = true;
      continue;
    }
    out += ch;
  }
  return out;
}

function matchesReview(hotspot, review, sourceText) {
  const file = (hotspot.component || '').split(':').pop();
  if (file !== review.filePath) return false;
  if (hotspot.ruleKey !== review.ruleKey) return false;
  if (!review.lineSubstring) return true;
  return sourceText.includes(review.lineSubstring);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const projectKey = process.env.SONAR_PROJECT_KEY;
  const pullRequest = process.env.SONAR_PULL_REQUEST || undefined;

  if (!projectKey) {
    throw new Error('SONAR_PROJECT_KEY is required');
  }

  const { reviews = [] } = loadAllowlist();
  if (reviews.length === 0) {
    log('allowlist empty; nothing to do');
    return;
  }

  const res = await sonarGet('/api/hotspots/search', {
    projectKey,
    pullRequest,
    status: 'TO_REVIEW',
    ps: 500,
  });
  const hotspots = res.hotspots || [];
  log(`found ${hotspots.length} TO_REVIEW hotspot(s) on ${projectKey}${pullRequest ? ` PR#${pullRequest}` : ''}`);

  let marked = 0;
  let skipped = 0;

  for (const hs of hotspots) {
    const sourceText = await fetchSourceLine(hs.component, hs.line, pullRequest);
    const match = reviews.find((r) => matchesReview(hs, r, sourceText));
    if (!match) {
      skipped += 1;
      continue;
    }
    const file = (hs.component || '').split(':').pop();
    const action = `${file}:${hs.line} ${hs.ruleKey} → REVIEWED/${match.resolution}`;
    if (dryRun) {
      log(`[dry-run] would mark ${action}`);
    } else {
      await sonarPost('/api/hotspots/change_status', {
        hotspot: hs.key,
        status: 'REVIEWED',
        resolution: match.resolution,
        comment: match.rationale,
      });
      log(`marked ${action}`);
    }
    marked += 1;
  }

  log(`done — matched=${marked} unmatched=${skipped}`);
}

function isCliEntrypoint(entryModule = require.main) {
  return Boolean(entryModule && entryModule.filename === __filename);
}

if (isCliEntrypoint()) {
  main().catch((err) => {
    warn(err.stack || err.message || String(err));
    process.exit(1);
  });
}

module.exports = {
  isCliEntrypoint,
  loadAllowlist,
  matchesReview,
  stripHtmlTags,
};
