#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_PRICE_LABEL,
  TEAM_PRICE_LABEL,
} = require('./commercial-offer');

const USAGE_FILE = path.join(process.env.HOME || '/tmp', '.thumbgate', 'usage-limits.json');

// ──────────────────────────────────────────────────────────
// Free tier: generous on captures (habit formation) and rules
// (5 active gates), gated on Pro-only features (recall, search,
// exports). Dashboard, exports, and unlimited rules drive Pro.
// ──────────────────────────────────────────────────────────
const FREE_TIER_LIMITS = {
  capture_feedback:   { daily: Infinity, lifetime: Infinity, label: 'feedback captures' },
  prevention_rules:   { daily: Infinity, lifetime: Infinity, label: 'prevention rules generated' },
  recall:             { daily: 0,        lifetime: 0,        label: 'recall queries (Pro only)' },
  search_lessons:     { daily: 0,        lifetime: 0,        label: 'lesson searches (Pro only)' },
  search_thumbgate:   { daily: 0,        lifetime: 0,        label: 'ThumbGate searches (Pro only)' },
  commerce_recall:    { daily: 0,        lifetime: 0,        label: 'commerce recalls (Pro only)' },
  export_dpo:         { daily: 0,        lifetime: 0,        label: 'DPO exports (Pro only)' },
  export_databricks:  { daily: 0,        lifetime: 0,        label: 'Databricks exports (Pro only)' },
  construct_context_pack: { daily: Infinity, lifetime: Infinity, label: 'context packs' },
};

const FREE_TIER_MAX_GATES = 5; // 5 active prevention rules on free; Pro is unlimited

const UPGRADE_MESSAGE = `Pro: ${PRO_PRICE_LABEL} — unlimited rules, recall, lesson search, dashboard, and exports: ${PRO_MONTHLY_PAYMENT_LINK}\n  Team: ${TEAM_PRICE_LABEL} after workflow qualification.`;

const PAYWALL_MESSAGES = {
  prevention_rules: 'Free tier includes 5 active prevention rules. Promote more or unlock unlimited rules with Pro.',
  recall: 'Recall is a Pro feature. Your past feedback is stored locally — upgrade to search and reuse it.',
  search_lessons: 'Lesson search is a Pro feature. Upgrade to find patterns in your agent\'s mistakes.',
  default: 'This feature requires Pro. Start Pro — card required; billed today.',
};

const TRIAL_DAYS = 14;

function getInstallAgeDays() {
  try {
    const { INSTALL_ID_PATH } = require('./cli-telemetry');
    if (!fs.existsSync(INSTALL_ID_PATH)) return null;
    const created = fs.statSync(INSTALL_ID_PATH).birthtimeMs || fs.statSync(INSTALL_ID_PATH).mtimeMs;
    if (!Number.isFinite(created) || created <= 0) return null;
    return (Date.now() - created) / (1000 * 60 * 60 * 24);
  } catch (_) {
    return null;
  }
}

function isInTrialPeriod() {
  if (process.env.CI || process.env.GITHUB_ACTIONS) return false;
  const age = getInstallAgeDays();
  if (age === null) return false;
  return age < TRIAL_DAYS;
}

function trialDaysRemaining() {
  const age = getInstallAgeDays();
  if (age === null) return 0;
  return Math.max(0, Math.ceil(TRIAL_DAYS - age));
}

function isProTier(authContext) {
  if (authContext && authContext.tier === 'pro') return true;
  if (process.env.THUMBGATE_API_KEY) return true;
  // Creator/dogfooding bypass: when the owner has the dev secret + bypass
  // configured (env or ~/.config/thumbgate/dev.json), treat the install as Pro
  // so marketing nudges and rate limits stop firing on the maintainer's own
  // machine.
  try {
    const { isCreatorDev } = require('./pro-local-dashboard');
    if (isCreatorDev()) return true;
  } catch (_) {
    // pro-local-dashboard unavailable in this runtime — fall through to
    // license/free-tier handling rather than failing the check.
  }
  try {
    const { isProLicensed } = require('./license');
    if (isProLicensed()) return true;
  } catch (_) {}
  // 14-day reverse trial: new installs get full Pro access
  if (isInTrialPeriod()) return true;
  return false;
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
 * Now enforces LIFETIME limits in addition to daily limits.
 * Returns { allowed: true } or { allowed: false, message: string }
 */
function checkLimit(action, authContext) {
  if (isProTier(authContext)) return { allowed: true };

  const limitEntry = FREE_TIER_LIMITS[action];
  if (limitEntry == null) return { allowed: true };

  const dailyLimit = typeof limitEntry === 'object' ? limitEntry.daily : limitEntry;
  const lifetimeLimit = typeof limitEntry === 'object' ? limitEntry.lifetime : Infinity;

  const usage = loadUsage();
  const today = todayKey();

  // Reset daily counts if different day
  if (usage.date !== today) {
    usage.date = today;
    usage.counts = {};
  }

  usage.counts = usage.counts || {};
  usage.lifetime = usage.lifetime || {};

  const dailyCurrent = usage.counts[action] || 0;
  const lifetimeCurrent = usage.lifetime[action] || 0;

  // Check lifetime limit first (the hard wall)
  if (lifetimeLimit !== Infinity && lifetimeCurrent >= lifetimeLimit) {
    const paywallMsg = PAYWALL_MESSAGES[action] || PAYWALL_MESSAGES.default;
    return {
      allowed: false,
      message: `${paywallMsg}\n\n${UPGRADE_MESSAGE}`,
      used: lifetimeCurrent,
      limit: lifetimeLimit,
      limitType: 'lifetime',
    };
  }

  // Check daily limit
  if (dailyLimit !== Infinity && dailyCurrent >= dailyLimit) {
    return {
      allowed: false,
      message: `Daily limit reached. ${UPGRADE_MESSAGE}`,
      used: dailyCurrent,
      limit: dailyLimit,
      limitType: 'daily',
    };
  }

  // Increment both counters
  usage.counts[action] = dailyCurrent + 1;
  usage.lifetime[action] = lifetimeCurrent + 1;
  saveUsage(usage);

  const remaining = lifetimeLimit === Infinity
    ? Infinity
    : lifetimeLimit - (lifetimeCurrent + 1);

  // Warn when approaching limit
  const warningThreshold = lifetimeLimit <= 3 ? 1 : Math.ceil(lifetimeLimit * 0.2);
  const isNearLimit = remaining <= warningThreshold && remaining > 0;

  return {
    allowed: true,
    used: lifetimeCurrent + 1,
    limit: lifetimeLimit,
    remaining,
    limitType: 'lifetime',
    warning: isNearLimit
      ? `${remaining} free ${limitEntry.label} remaining. Upgrade to Pro for unlimited.`
      : undefined,
  };
}

/**
 * Get current usage without incrementing.
 */
function getUsage(action, authContext) {
  if (isProTier(authContext)) return { count: 0, limit: Infinity, remaining: Infinity };

  const limitEntry = FREE_TIER_LIMITS[action];
  const lifetimeLimit = limitEntry == null ? Infinity : (typeof limitEntry === 'object' ? (limitEntry.lifetime ?? Infinity) : Infinity);
  const usage = loadUsage();

  const lifetimeCount = (usage.lifetime || {})[action] || 0;
  return { count: lifetimeCount, limit: lifetimeLimit, remaining: Math.max(0, lifetimeLimit - lifetimeCount) };
}

module.exports = {
  checkLimit,
  getUsage,
  isProTier,
  isInTrialPeriod,
  trialDaysRemaining,
  loadUsage,
  saveUsage,
  todayKey,
  FREE_TIER_LIMITS,
  FREE_TIER_MAX_GATES,
  TRIAL_DAYS,
  UPGRADE_MESSAGE,
  PAYWALL_MESSAGES,
  USAGE_FILE,
};
