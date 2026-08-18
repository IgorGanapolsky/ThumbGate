#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  getFallbackFeedbackDir,
  getGlobalFeedbackDir,
  getHomeDir,
  getLegacyFeedbackDir,
  getThumbgateFeedbackDir,
  resolveFeedbackDir,
  resolveProjectDir,
} = require('./feedback-paths');
const { readJsonl } = require('./fs-utils');

const FEEDBACK_LOG = 'feedback-log.jsonl';
const MEMORY_LOG = 'memory-log.jsonl';
const STATUSLINE_CACHE = 'statusline_cache.json';

function truthyDisabled(value) {
  return value === '0' || value === 'false' || value === 'local';
}

function shouldAggregateFeedback(options = {}) {
  const env = options.env || process.env;
  return !truthyDisabled(String(env.THUMBGATE_STATUSLINE_AGGREGATE || env.THUMBGATE_AGGREGATE_FEEDBACK || '1').toLowerCase());
}

function normalizePath(candidate) {
  if (!candidate) return null;
  try {
    return path.resolve(String(candidate));
  } catch {
    return null;
  }
}

function uniquePaths(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const resolved = normalizePath(value);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function safeExists(candidate) {
  try {
    return Boolean(candidate && fs.existsSync(candidate));
  } catch {
    return false;
  }
}

function immediateChildDirs(parentDir) {
  try {
    return fs.readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parentDir, entry.name));
  } catch {
    return [];
  }
}

function ancestorProjectFeedbackDirs(projectDir, options = {}) {
  const home = normalizePath(getHomeDir(options));
  const start = normalizePath(projectDir);
  const tempRoot = normalizePath(os.tmpdir());
  if (!start) return [];

  const dirs = [];
  let cursor = start;
  while (cursor && cursor !== path.dirname(cursor)) {
    // Temp projects share one OS-level parent. Reading that parent's store leaks
    // feedback across unrelated test runs, npx sessions, and sandboxed agents.
    if (tempRoot && cursor === tempRoot) break;
    dirs.push(
      path.join(cursor, '.thumbgate'),
      path.join(cursor, '.thumbgate-compat'),
      path.join(cursor, '.claude', 'memory', 'feedback')
    );
    if (home && cursor === home) break;
    const next = path.dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  return dirs;
}

function listFeedbackStoreDirs(options = {}) {
  const env = options.env || process.env;
  const projectDir = resolveProjectDir({ cwd: options.cwd, env, projectDir: options.projectDir });
  const home = getHomeDir({ env });
  const homeThumbgate = path.join(home, '.thumbgate');
  const projectsDir = path.join(homeThumbgate, 'projects');
  const explicitRoots = String(env.THUMBGATE_AGGREGATE_ROOTS || '')
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const explicitFeedbackDir = options.feedbackDir || env.THUMBGATE_FEEDBACK_DIR;
  const normalizedExplicitFeedbackDir = normalizePath(explicitFeedbackDir);

  if (
    normalizedExplicitFeedbackDir &&
    normalizedExplicitFeedbackDir.startsWith(normalizePath(os.tmpdir()) + path.sep) &&
    explicitRoots.length === 0
  ) {
    return uniquePaths([explicitFeedbackDir])
      .filter((dir) => safeExists(path.join(dir, FEEDBACK_LOG)) || safeExists(path.join(dir, MEMORY_LOG)) || safeExists(path.join(dir, STATUSLINE_CACHE)));
  }

  return uniquePaths([
    explicitFeedbackDir,
    resolveFeedbackDir({ projectDir, env }),
    getThumbgateFeedbackDir({ projectDir, env }),
    getFallbackFeedbackDir({ projectDir, env }),
    getLegacyFeedbackDir({ projectDir, env }),
    getGlobalFeedbackDir({ projectDir, env }),
    homeThumbgate,
    ...immediateChildDirs(projectsDir),
    ...ancestorProjectFeedbackDirs(projectDir, { env }),
    ...explicitRoots,
  ]).filter((dir) => safeExists(path.join(dir, FEEDBACK_LOG)) || safeExists(path.join(dir, MEMORY_LOG)) || safeExists(path.join(dir, STATUSLINE_CACHE)));
}

function normalizeSignal(signal) {
  const raw = String(signal || '').toLowerCase();
  if (raw === 'positive' || raw === 'up' || raw === 'thumbs_up') return 'positive';
  if (raw === 'negative' || raw === 'down' || raw === 'thumbs_down') return 'negative';
  return raw || null;
}

function stableEntryKey(entry = {}, source = {}) {
  const id = entry.id || entry.feedbackId || entry.sourceFeedbackId;
  if (id) return `id:${id}`;
  const material = JSON.stringify({
    sourcePath: source.logPath || '',
    sourceIndex: Number.isFinite(source.index) ? source.index : -1,
    entry,
  });
  return `sha:${crypto.createHash('sha256').update(material).digest('hex')}`;
}

function sortByTimestamp(entries) {
  return entries.sort((a, b) => {
    const at = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bt = b.timestamp ? Date.parse(b.timestamp) : 0;
    return (Number.isFinite(at) ? at : 0) - (Number.isFinite(bt) ? bt : 0);
  });
}

function collectAggregateLogEntries(fileName, options = {}) {
  const stores = listFeedbackStoreDirs(options);
  const seen = new Set();
  const entries = [];

  for (const dir of stores) {
    const logPath = path.join(dir, fileName);
    if (!safeExists(logPath)) continue;
    // Never full-scan multi-hundred-MB feedback logs (prod dashboard_data 503).
    // Callers that truly need lifetime history must pass { full: true }.
    const wantFull = options.full === true;
    const maxLines = wantFull
      ? Math.max(0, Number(options.maxLines) || 0)
      : (Number(options.maxLines) > 0 ? Number(options.maxLines) : 20_000);
    const maxBytes = wantFull
      ? Math.max(0, Number(options.maxBytes) || 0)
      : (Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 4 * 1024 * 1024);
    const rows = readJsonl(logPath, {
      maxLines,
      maxBytes,
      tail: !wantFull,
      full: wantFull,
    }) || [];
    for (let index = 0; index < rows.length; index += 1) {
      const rawEntry = rows[index];
      const entry = { ...rawEntry };
      if (entry.signal || entry.feedback) entry.signal = normalizeSignal(entry.signal || entry.feedback);
      const key = stableEntryKey(entry, { logPath, index });
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ ...entry, sourceFeedbackDir: dir });
    }
  }

  return {
    entries: sortByTimestamp(entries),
    stores,
  };
}

function summarizeFeedbackEntries(entries) {
  let totalPositive = 0;
  let totalNegative = 0;
  let rubricSamples = 0;

  for (const entry of entries) {
    if (entry.signal === 'positive') totalPositive += 1;
    if (entry.signal === 'negative') totalNegative += 1;
    if (entry.rubric?.weightedScore != null) rubricSamples += 1;
  }

  return { totalPositive, totalNegative, rubricSamples };
}

function createRateWindows(total, totalPositive, approvalRate) {
  return {
    '7d': { total: 0, positive: 0, rate: 0 },
    '30d': { total: 0, positive: 0, rate: 0 },
    lifetime: { total, positive: totalPositive, rate: approvalRate },
  };
}

function applyEntryToRateWindow(window, entry) {
  window.total += 1;
  if (entry.signal === 'positive') window.positive += 1;
}

function updateRateWindows(windows, entries, now = Date.now()) {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
    if (!Number.isFinite(ts)) continue;
    const age = now - ts;
    if (age <= sevenDays) applyEntryToRateWindow(windows['7d'], entry);
    if (age <= thirtyDays) applyEntryToRateWindow(windows['30d'], entry);
  }
}

function finalizeRateWindows(windows) {
  for (const key of ['7d', '30d']) {
    const window = windows[key];
    window.rate = 0;
    if (window.total > 0) {
      window.rate = Math.round((window.positive / window.total) * 1000) / 1000;
    }
  }
}

function trendFromRateWindows(windows) {
  const hasTrendData = windows['7d'].total > 0 && windows['30d'].total > 0;
  if (hasTrendData) {
    if (windows['7d'].rate > windows['30d'].rate + 0.05) return 'improving';
    if (windows['7d'].rate < windows['30d'].rate - 0.05) return 'degrading';
  }
  return 'stable';
}

function computeAggregateFeedbackStats(options = {}) {
  const { entries, stores } = collectAggregateLogEntries(FEEDBACK_LOG, options);
  const memory = collectAggregateLogEntries(MEMORY_LOG, options);
  const humanReviewedEntries = entries.filter((entry) => entry.reviewOrigin === 'human');
  const { totalPositive, totalNegative, rubricSamples } = summarizeFeedbackEntries(humanReviewedEntries);
  const total = totalPositive + totalNegative;
  const approvalRate = total > 0 ? Math.round((totalPositive / total) * 1000) / 1000 : 0;
  const windows = createRateWindows(total, totalPositive, approvalRate);
  updateRateWindows(windows, humanReviewedEntries);
  finalizeRateWindows(windows);
  const trend = trendFromRateWindows(windows);

  return {
    total,
    totalPositive,
    totalNegative,
    approvalRate,
    recentRate: windows['7d'].rate || approvalRate,
    trend,
    windows,
    rawTotal: entries.length,
    excludedTotal: entries.length - humanReviewedEntries.length,
    rubric: { samples: rubricSamples || memory.entries.length, blockedPromotions: 0, failingCriteria: {} },
    aggregate: {
      enabled: true,
      stores: stores.length,
      feedbackLogPaths: stores.map((dir) => path.join(dir, FEEDBACK_LOG)),
      memoryStores: memory.stores.length,
    },
  };
}

function getAggregateStatuslineCachePath(options = {}) {
  const env = options.env || process.env;
  if (env.THUMBGATE_STATUSLINE_CACHE) return path.resolve(env.THUMBGATE_STATUSLINE_CACHE);
  return path.join(getHomeDir({ env }), '.thumbgate', STATUSLINE_CACHE);
}

module.exports = {
  ancestorProjectFeedbackDirs,
  collectAggregateLogEntries,
  computeAggregateFeedbackStats,
  getAggregateStatuslineCachePath,
  listFeedbackStoreDirs,
  normalizeSignal,
  shouldAggregateFeedback,
};
