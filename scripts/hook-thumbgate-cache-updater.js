#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook: updates ThumbGate statusline cache after dashboard/stat calls.
 * Also used directly by the CLI to refresh statusline counters after feedback capture.
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

function getCachePath() {
  const cacheDir = process.env.THUMBGATE_FEEDBACK_DIR || process.cwd();
  return path.join(cacheDir, '.thumbgate', 'statusline_cache.json');
}

function readExistingCache(cachePath = getCachePath()) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeStatuslineCache(nextCache, cachePath = getCachePath()) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(nextCache));
}

function normalizeDashboardPayload(payload = {}) {
  const approval = payload.approval || {};
  return {
    thumbs_up: String(approval.totalPositive || 0),
    thumbs_down: String(approval.totalNegative || 0),
    lessons: String((payload.rubric || {}).samples || 0),
    approval_rate: String(approval.approvalRate || '?'),
    trend: approval.trendDirection || '?',
    total_feedback: String(approval.total || 0),
  };
}

function normalizeStatsPayload(payload = {}) {
  return {
    thumbs_up: String(payload.totalPositive || 0),
    thumbs_down: String(payload.totalNegative || 0),
    lessons: String((payload.rubric || {}).samples || 0),
    approval_rate: String(Math.round((payload.approvalRate || 0) * 1000) / 10),
    trend: payload.trend || '?',
    total_feedback: String(payload.total || 0),
  };
}

function refreshStatuslineCache(statsPayload = {}, cachePath = getCachePath()) {
  const cache = {
    ...readExistingCache(cachePath),
    ...normalizeStatsPayload(statsPayload),
    updated_at: String(Math.floor(Date.now() / 1000)),
  };
  writeStatuslineCache(cache, cachePath);
  return cache;
}

function updateCacheFromEvent(event = {}, cachePath = getCachePath()) {
  const tool = event.tool_name || '';
  if (tool !== 'mcp__thumbgate__feedback_stats' && tool !== 'mcp__thumbgate__dashboard') {
    return null;
  }

  const raw = event.tool_response;
  if (!raw) return null;
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const cache = {
    ...readExistingCache(cachePath),
    ...(tool === 'mcp__thumbgate__feedback_stats'
      ? normalizeStatsPayload(data)
      : normalizeDashboardPayload(data)),
    updated_at: String(Math.floor(Date.now() / 1000)),
  };
  writeStatuslineCache(cache, cachePath);
  return cache;
}

function runFromStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      updateCacheFromEvent(input ? JSON.parse(input) : {});
    } catch {
      /* statusline cache is best-effort */
    }
  });
}

if (require.main === module) {
  runFromStdin();
}

module.exports = {
  getCachePath,
  normalizeDashboardPayload,
  normalizeStatsPayload,
  readExistingCache,
  refreshStatuslineCache,
  runFromStdin,
  updateCacheFromEvent,
  writeStatuslineCache,
};
