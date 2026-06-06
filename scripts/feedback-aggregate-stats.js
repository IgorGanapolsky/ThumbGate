#!/usr/bin/env node
'use strict';

// Cross-store feedback aggregation for the statusline.
//
// WHY: feedback is persisted per-project under `<cwd>/.thumbgate` (or the global
// `~/.thumbgate/projects/<name>` fallback). `analyzeFeedback()` reads exactly ONE
// resolved store, so the statusline only ever reflects the slice for the folder it
// happens to run in. On 2026-06-06 the CEO's statusline showed `8👍 0👎` (the
// ThumbGate repo's own store) while ~150 thumbs-down from the same period lived in
// a different project's store — the display looked like feedback was being dropped,
// even though capture was fine. This module sums signal across every discoverable
// store, deduped by feedback id, so the statusline shows a stable, true total
// regardless of the working directory.
//
// Read-only: it never writes feedback and does not touch the capture path.

const fs = require('fs');
const path = require('path');
const { getHomeDir, resolveFeedbackDir } = require('./feedback-paths');

function readJSONL(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // tolerate a partially-written trailing line; skip it
    }
  }
  return out;
}

// All feedback-log.jsonl paths worth summing for a global view.
function collectFeedbackLogPaths(options = {}) {
  const env = options.env || process.env;
  const home = getHomeDir(options);
  const candidates = [];

  if (home) {
    const globalRoot = path.join(home, '.thumbgate');
    candidates.push(path.join(globalRoot, 'feedback-log.jsonl'));
    const projectsDir = path.join(globalRoot, 'projects');
    let names = [];
    try {
      names = fs.readdirSync(projectsDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      candidates.push(path.join(projectsDir, name, 'feedback-log.jsonl'));
    }
  }

  // The store the current project actually resolves to (repo-local .thumbgate, a
  // compat/legacy dir, or the global fallback) — captures the active session.
  try {
    const activeDir = resolveFeedbackDir(options);
    if (activeDir) candidates.push(path.join(activeDir, 'feedback-log.jsonl'));
  } catch {
    // resolution failure shouldn't break aggregation
  }

  // Escape hatch: explicit extra store dirs (e.g. scattered repo-local stores not
  // under ~/.thumbgate). Delimiter-separated dirs each containing feedback-log.jsonl.
  const extra = options.extraDirs
    || (env.THUMBGATE_AGGREGATE_DIRS ? env.THUMBGATE_AGGREGATE_DIRS.split(path.delimiter) : []);
  for (const dir of extra) {
    if (dir) candidates.push(path.join(String(dir).trim(), 'feedback-log.jsonl'));
  }

  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

// Sum positive/negative signal across all stores, deduping entries by id so a
// store copied/synced into two locations is not double-counted. Returns a payload
// shaped for normalizeStatsPayload() in hook-thumbgate-cache-updater.
function aggregateFeedbackStats(options = {}) {
  const logPaths = options.logPaths || collectFeedbackLogPaths(options);
  const seenIds = new Set();
  let totalPositive = 0;
  let totalNegative = 0;
  let storesWithData = 0;

  for (const logPath of logPaths) {
    let counted = false;
    for (const entry of readJSONL(logPath)) {
      const signal = entry && entry.signal;
      if (signal !== 'positive' && signal !== 'negative') continue;
      const id = entry && entry.id;
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      if (signal === 'positive') totalPositive += 1;
      else totalNegative += 1;
      counted = true;
    }
    if (counted) storesWithData += 1;
  }

  const total = totalPositive + totalNegative;
  return {
    totalPositive,
    totalNegative,
    total,
    approvalRate: total > 0 ? totalPositive / total : 0,
    trend: 'aggregate',
    storeCount: storesWithData,
    logPaths,
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(aggregateFeedbackStats(), null, 2));
}

module.exports = { collectFeedbackLogPaths, aggregateFeedbackStats, readJSONL };
