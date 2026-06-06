#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { getStatuslineCacheCandidates } = require('./statusline-cache-path');
const { getHomeDir } = require('./feedback-paths');

const ARCHIVE_MARKER = /\.tg-archive(-\d+)?(\/|$)/;

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueResolved(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p) continue;
    const resolved = path.resolve(p);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function listGlobalProjectCaches(options = {}) {
  const home = getHomeDir(options);
  if (!home) return [];
  const projectsRoot = path.join(home, '.thumbgate', 'projects');
  let entries = [];
  try {
    entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    out.push(path.join(projectsRoot, entry.name, 'statusline_cache.json'));
  }
  return out;
}

function getAggregationCandidates(options = {}) {
  const home = getHomeDir(options);
  const candidates = [
    ...getStatuslineCacheCandidates(options),
    home && path.join(home, '.thumbgate', 'statusline_cache.json'),
    ...listGlobalProjectCaches(options),
  ];
  return uniqueResolved(candidates).filter(
    (candidate) => !ARCHIVE_MARKER.test(candidate)
  );
}

function readCacheFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* unreadable / unparseable caches are silently skipped */
  }
  return null;
}

function aggregateStatuslineCaches(options = {}) {
  const candidatePaths = getAggregationCandidates(options);
  const sources = [];
  let up = 0;
  let down = 0;
  let lessons = 0;
  let total = 0;
  let latestTs = 0;
  let latestRecord = null;
  let latestRecordSource = null;

  for (const candidate of candidatePaths) {
    if (!fs.existsSync(candidate)) continue;
    const data = readCacheFile(candidate);
    if (!data) continue;
    sources.push(candidate);
    up += toNumber(data.thumbs_up);
    down += toNumber(data.thumbs_down);
    lessons += toNumber(data.lessons);
    total += toNumber(data.total_feedback);
    const ts = toNumber(data.updated_at);
    if (ts > latestTs) {
      latestTs = ts;
      latestRecord = data;
      latestRecordSource = candidate;
    }
  }

  if (sources.length === 0) {
    return null;
  }

  const denom = up + down;
  const approvalRate = denom > 0 ? Math.round((up / denom) * 1000) / 10 : 0;
  const totalFeedback = total > 0 ? total : up + down;

  const aggregated = {
    thumbs_up: String(up),
    thumbs_down: String(down),
    lessons: String(lessons),
    approval_rate: String(approvalRate),
    trend: (latestRecord && latestRecord.trend) || '?',
    total_feedback: String(totalFeedback),
    updated_at: String(latestTs || Math.floor(Date.now() / 1000)),
    aggregated: true,
    sources_count: sources.length,
    sources,
  };

  if (latestRecord && latestRecord.last_lesson) {
    aggregated.last_lesson = latestRecord.last_lesson;
  }
  if (latestRecordSource) {
    aggregated.latest_source = latestRecordSource;
  }

  return aggregated;
}

function readResolvedStatuslineCache(options = {}) {
  const env = options.env || process.env;
  const aggregateFlag = env.THUMBGATE_STATUSLINE_AGGREGATE;
  const aggregationEnabled = aggregateFlag !== '0' && aggregateFlag !== 'false';

  if (aggregationEnabled) {
    const aggregated = aggregateStatuslineCaches(options);
    if (aggregated) return aggregated;
  }

  const candidates = getStatuslineCacheCandidates(options);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const data = readCacheFile(candidate);
    if (data) {
      return { ...data, aggregated: false, sources_count: 1, sources: [path.resolve(candidate)] };
    }
  }
  return null;
}

const _invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (_invokedDirectly) {
  const resolved = readResolvedStatuslineCache();
  if (resolved) {
    process.stdout.write(JSON.stringify(resolved));
  }
}

module.exports = {
  aggregateStatuslineCaches,
  getAggregationCandidates,
  readResolvedStatuslineCache,
};
