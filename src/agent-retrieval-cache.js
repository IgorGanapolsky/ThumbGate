'use strict';

/**
 * High-Concurrency Agent Retrieval Cache & Anti-Drift Guard.
 *
 * Addresses key failure modes when hundreds of agents hit the retrieval layer:
 * 1. Latency Stacking: Single-flight request coalescing for concurrent duplicate queries.
 * 2. Stale Context: Instantaneous mtime invalidation on file mutation.
 * 3. Relevance Drift / Slop: Automated filtering of transient agent logs, scratch files, and worktree artifacts.
 */

const fs = require('node:fs');
const path = require('node:path');

const POLLUTION_PATTERNS = [
  /\.system_generated\//,
  /\.claude\/worktrees\//,
  /\.git\//,
  /node_modules\//,
  /\.tmp\//,
  /\.coverage\//,
  /dist\//,
  /build\//,
  /\.DS_Store/,
];

class AgentRetrievalCache {
  constructor({ maxEntries = 1000, ttlMs = 300000 } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.cache = new Map(); // key -> { value, timestamp, mtimes: Map<filepath, mtimeMs> }
    this.inFlight = new Map(); // key -> Promise
    this.stats = {
      hits: 0,
      misses: 0,
      coalesced: 0,
      invalidations: 0,
      slopRejections: 0,
    };
  }

  static isPollutionPath(filepath) {
    if (!filepath || typeof filepath !== 'string') return false;
    const normalized = filepath.replace(/\\/g, '/');
    return POLLUTION_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  async getOrFetch(key, watchedFiles = [], fetchFn) {
    // 1. Check cache freshness & mtimes
    const entry = this.cache.get(key);
    const now = Date.now();

    if (entry && (now - entry.timestamp < this.ttlMs)) {
      let isStale = false;
      for (const [file, cachedMtime] of entry.mtimes.entries()) {
        try {
          const stat = fs.statSync(file);
          if (stat.mtimeMs > cachedMtime) {
            isStale = true;
            break;
          }
        } catch {
          isStale = true;
          break;
        }
      }

      if (!isStale) {
        this.stats.hits++;
        return entry.value;
      }
      this.cache.delete(key);
      this.stats.invalidations++;
    }

    // 2. Single-flight request coalescing (prevents latency stacking)
    if (this.inFlight.has(key)) {
      this.stats.coalesced++;
      return this.inFlight.get(key);
    }

    this.stats.misses++;

    const fetchPromise = (async () => {
      try {
        const result = await fetchFn();

        // 3. Record mtimes for watched files
        const mtimes = new Map();
        for (const file of watchedFiles) {
          if (!AgentRetrievalCache.isPollutionPath(file)) {
            try {
              const stat = fs.statSync(file);
              mtimes.set(file, stat.mtimeMs);
            } catch {
              // ignore missing files
            }
          } else {
            this.stats.slopRejections++;
          }
        }

        if (this.cache.size >= this.maxEntries) {
          const oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
          value: result,
          timestamp: Date.now(),
          mtimes,
        });

        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, fetchPromise);
    return fetchPromise;
  }

  invalidateFile(filepath) {
    let purged = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.mtimes.has(filepath)) {
        this.cache.delete(key);
        purged++;
      }
    }
    this.stats.invalidations += purged;
    return purged;
  }

  clear() {
    this.cache.clear();
    this.inFlight.clear();
  }

  getMetrics() {
    return {
      ...this.stats,
      size: this.cache.size,
      inFlightCount: this.inFlight.size,
    };
  }
}

module.exports = {
  AgentRetrievalCache,
  POLLUTION_PATTERNS,
};
