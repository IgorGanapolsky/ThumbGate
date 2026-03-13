#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const USAGE_FILE = path.join(process.env.HOME || '/tmp', '.rlhf', 'usage-limits.json');

const FREE_TIER_LIMITS = {
  capture_feedback: 5,
  recall: 5,
};

const FREE_TIER_MAX_GATES = 5;

const UPGRADE_MESSAGE = 'Free tier limit reached. Upgrade to Pro ($29/mo) for unlimited: https://rlhf-feedback-loop-production.up.railway.app';

function isProTier() {
  return !!(process.env.RLHF_API_KEY || process.env.RLHF_PRO_MODE === '1' || process.env.RLHF_NO_RATE_LIMIT === '1');
}

function getUsageFile() {
  return module.exports.USAGE_FILE;
}

function loadUsage() {
  try {
    const f = getUsageFile();
    if (!fs.existsSync(f)) return {};
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveUsage(data) {
  const f = getUsageFile();
  const dir = path.dirname(f);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Check and increment usage for a given action.
 * Returns { allowed: true } or { allowed: false, message: string }
 */
function checkLimit(action) {
  if (isProTier()) return { allowed: true };

  const limit = FREE_TIER_LIMITS[action];
  if (limit == null) return { allowed: true }; // no limit for this action

  const usage = loadUsage();
  const today = todayKey();

  // Reset if different day
  if (usage.date !== today) {
    usage.date = today;
    usage.counts = {};
  }

  usage.counts = usage.counts || {};
  const current = usage.counts[action] || 0;

  if (current >= limit) {
    return { allowed: false, message: UPGRADE_MESSAGE };
  }

  // Increment
  usage.counts[action] = current + 1;
  saveUsage(usage);

  return { allowed: true };
}

/**
 * Get current usage without incrementing.
 */
function getUsage(action) {
  if (isProTier()) return { count: 0, limit: Infinity, remaining: Infinity };

  const limit = FREE_TIER_LIMITS[action] || Infinity;
  const usage = loadUsage();
  const today = todayKey();

  if (usage.date !== today) return { count: 0, limit, remaining: limit };

  const count = (usage.counts || {})[action] || 0;
  return { count, limit, remaining: Math.max(0, limit - count) };
}

module.exports = {
  checkLimit,
  getUsage,
  isProTier,
  loadUsage,
  saveUsage,
  todayKey,
  FREE_TIER_LIMITS,
  FREE_TIER_MAX_GATES,
  UPGRADE_MESSAGE,
  USAGE_FILE,
};
