#!/usr/bin/env node
'use strict';

/**
 * Quick-read upsell — at-the-pain-point CLI offer.
 *
 * Fires after a thumbs-down capture when the operator has logged 3+
 * thumbs-downs in the last 24h and is NOT Pro-licensed. The offer points
 * at the existing $19 Quick Read Stripe Payment Link wired into /pro.
 *
 * Rationale: 760+ weekly npm downloads, zero conversion. The /pro page
 * has the offer, but free users live in the CLI, not the marketing page.
 * Surface the offer at the moment of pain — right after a thumbs-down,
 * when the operator has just demonstrated they have a recurring failure
 * pattern that ThumbGate's free-tier auto-rules didn't catch.
 *
 * Guardrails (do not be spammy):
 *   - Suppressed by `THUMBGATE_NO_UPSELL=1`
 *   - Suppressed if Pro-licensed
 *   - Suppressed if shown in the last 24h (rate-limit via timestamp file)
 *   - Only fires after thumbs-DOWN (not up); only when 3+ downs in 24h
 *   - Print to stderr (never stdout) so script consumers parsing JSON
 *     output remain unaffected
 */

const fs = require('node:fs');
const path = require('node:path');

const QUICK_READ_PAYMENT_LINK = 'https://buy.stripe.com/aFa8wPgH29Lo4lH35V3sI0w';
const QUICK_READ_PRICE_USD = 19;
const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 upsell per 24h

function getHomeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || '';
}

function getLastShownPath(homeDir = getHomeDir()) {
  return path.join(homeDir, '.thumbgate', 'last-upsell.json');
}

function readLastShown(homeDir = getHomeDir()) {
  try {
    const raw = fs.readFileSync(getLastShownPath(homeDir), 'utf8');
    const parsed = JSON.parse(raw);
    const ts = Date.parse(parsed.timestamp);
    if (Number.isFinite(ts)) return ts;
  } catch {
    // Missing/corrupt file = treat as never shown
  }
  return 0;
}

function writeLastShown(now = new Date(), homeDir = getHomeDir()) {
  const filePath = getLastShownPath(homeDir);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ timestamp: now.toISOString() }, null, 2));
  } catch {
    // Best-effort — if we can't write, we'll show again next time, which
    // is a soft fail (mildly annoying, not broken).
  }
}

function countRecentThumbsDown(feedbackLogPath, options = {}) {
  const windowMs = options.windowMs || DEFAULT_WINDOW_MS;
  const now = options.now ? options.now.getTime() : Date.now();
  const cutoff = now - windowMs;

  let raw;
  try {
    raw = fs.readFileSync(feedbackLogPath, 'utf8');
  } catch {
    return 0;
  }

  let count = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry && entry.signal === 'down') {
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (Number.isFinite(ts) && ts >= cutoff) count += 1;
    }
  }
  return count;
}

function formatUpsellMessage(downCount) {
  const lines = [
    '',
    '  ─────────────────────────────────────────────────────────────',
    `  You've logged ${downCount} thumbs-downs in the last 24h.`,
    '',
    '  ThumbGate auto-generated prevention rules for them, but the',
    '  synthesis is generic. For $19 I will personally read one,',
    '  ship the exact prevention rule, and explain the fix:',
    '',
    `    ${QUICK_READ_PAYMENT_LINK}`,
    '',
    `  Skip with: export THUMBGATE_NO_UPSELL=1`,
    '  ─────────────────────────────────────────────────────────────',
    '',
  ];
  return lines.join('\n');
}

/**
 * @param {object} [options]
 * @param {string} [options.feedbackLogPath]
 * @param {boolean} [options.isPro=false]
 * @param {Date}    [options.now]
 * @param {string}  [options.homeDir]
 * @param {object}  [options.env]
 * @param {(msg:string)=>void} [options.write]
 * @param {number}  [options.threshold]
 * @param {number}  [options.windowMs]
 * @param {number}  [options.cooldownMs]
 * @returns {{shown:boolean, reason:string, downCount:number, message?:string}}
 */
function maybePrintUpsell(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || getHomeDir(env);
  const now = options.now || new Date();
  const threshold = options.threshold || DEFAULT_THRESHOLD;
  const cooldownMs = options.cooldownMs || DEFAULT_COOLDOWN_MS;
  const write = options.write || ((msg) => process.stderr.write(msg));

  if (env.THUMBGATE_NO_UPSELL === '1' || env.THUMBGATE_NO_UPSELL === 'true') {
    return { shown: false, reason: 'suppressed-by-env', downCount: 0 };
  }
  if (options.isPro) {
    return { shown: false, reason: 'pro-licensed', downCount: 0 };
  }
  if (!options.feedbackLogPath || !fs.existsSync(options.feedbackLogPath)) {
    return { shown: false, reason: 'no-feedback-log', downCount: 0 };
  }

  const downCount = countRecentThumbsDown(options.feedbackLogPath, {
    windowMs: options.windowMs,
    now,
  });
  if (downCount < threshold) {
    return { shown: false, reason: 'below-threshold', downCount };
  }

  const lastShown = readLastShown(homeDir);
  if (lastShown && now.getTime() - lastShown < cooldownMs) {
    return { shown: false, reason: 'in-cooldown', downCount };
  }

  const message = formatUpsellMessage(downCount);
  write(message);
  writeLastShown(now, homeDir);
  return { shown: true, reason: 'displayed', downCount, message };
}

module.exports = {
  QUICK_READ_PAYMENT_LINK,
  QUICK_READ_PRICE_USD,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_MS,
  DEFAULT_COOLDOWN_MS,
  countRecentThumbsDown,
  formatUpsellMessage,
  getLastShownPath,
  maybePrintUpsell,
  readLastShown,
  writeLastShown,
};
