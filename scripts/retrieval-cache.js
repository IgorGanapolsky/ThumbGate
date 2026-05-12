#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolveFeedbackDir } = require('./feedback-paths');

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

function getCachePath(options = {}) {
  const feedbackDir = options.feedbackDir || resolveFeedbackDir();
  return path.join(feedbackDir, 'retrieval-cache.json');
}

function computeCacheKey(toolName, actionContext, options = {}) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      toolName: toolName || '',
      actionContext: actionContext || '',
      candidateCount: options.candidateCount || 20,
      maxResults: options.maxResults || 5,
    }))
    .digest('hex');
}

function readCache(options = {}) {
  try {
    const cachePath = getCachePath(options);
    if (!fs.existsSync(cachePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function pruneCache(cache, options = {}) {
  const now = options.now || Date.now();
  return Object.fromEntries(
    Object.entries(cache)
      .filter(([, entry]) => entry && now - Number(entry.timestamp || 0) < CACHE_TTL_MS)
      .sort((a, b) => Number(b[1].timestamp || 0) - Number(a[1].timestamp || 0))
      .slice(0, MAX_CACHE_ENTRIES),
  );
}

function getCachedRetrieval(toolName, actionContext, options = {}) {
  const key = computeCacheKey(toolName, actionContext, options);
  const cache = pruneCache(readCache(options), options);
  const entry = cache[key];
  return entry && Array.isArray(entry.results) ? entry.results : null;
}

function setCachedRetrieval(toolName, actionContext, results, options = {}) {
  if (!Array.isArray(results)) return false;

  try {
    const cachePath = getCachePath(options);
    const cache = pruneCache(readCache(options), options);
    cache[computeCacheKey(toolName, actionContext, options)] = {
      timestamp: options.now || Date.now(),
      results,
    };
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  CACHE_TTL_MS,
  MAX_CACHE_ENTRIES,
  computeCacheKey,
  getCachePath,
  getCachedRetrieval,
  setCachedRetrieval,
};
