#!/usr/bin/env node
'use strict';

// Resolve the statusline cache to read for display.
//
// PRIOR BUG: the earlier version of this script "aggregated" by summing the
// thumbs_up/down fields across every per-folder statusline_cache.json. That
// double-counted, because the global aggregate cache at
// ~/.thumbgate/statusline_cache.json is ITSELF already the cross-store sum
// (written by feedback-aggregate.js / hook-thumbgate-cache-updater.js). Summing
// the global aggregate plus per-folder caches counted every event twice or more
// and produced bogus totals like 1152↑/747↓ when the true aggregate was 727/600.
//
// CORRECT BEHAVIOR: pick the highest-priority existing cache from the
// candidate list (`statusline-cache-path.js` puts the canonical aggregate path
// first when aggregation is enabled) and return its content unchanged. No
// summing across files — the upstream aggregator already did that work.

const fs = require('node:fs');
const path = require('node:path');
const { getStatuslineCacheCandidates } = require('./statusline-cache-path');

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

function readResolvedStatuslineCache(options = {}) {
  const candidates = getStatuslineCacheCandidates(options);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const data = readCacheFile(candidate);
    if (data) {
      return { ...data, source: path.resolve(candidate) };
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
  readResolvedStatuslineCache,
};
