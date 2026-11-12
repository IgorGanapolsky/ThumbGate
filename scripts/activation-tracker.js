'use strict';

/**
 * Activation tracker — fires `activation_first_rule_promoted` exactly once
 * per install, the first time a prevention rule auto-promotes from feedback.
 *
 * Why: v1.17.0 opened the free tier (5 active rules, unlimited captures).
 * The metric that decides whether that worked is the % of `npx thumbgate init`
 * runs that produce a first auto-promoted prevention rule within 24h. Without
 * this telemetry, every funnel decision is guessing. This is improvement #1
 * from the 2026-05-13 revenue-ROI critique.
 *
 * Payload (anonymous):
 *   - eventType: 'activation_first_rule_promoted'
 *   - installId: stable random UUID (from cli-telemetry.getInstallId)
 *   - daysToFirstRule: days between INSTALL_ID_PATH creation and now
 *   - visitorType: ci | owner | real_user (from cli-telemetry.classifyInstall)
 *
 * No personal data, no rule content, no feedback text. Just the activation
 * signal. Respects THUMBGATE_NO_TELEMETRY=1 / DO_NOT_TRACK=1 opt-out via
 * the underlying trackEvent helper.
 *
 * Idempotency: writes a marker file. After the first firing the function
 * is a no-op for the lifetime of that install.
 */

const fs = require('node:fs');
const path = require('node:path');

const { trackEvent, getInstallId, classifyInstall, INSTALL_ID_PATH } = require('./cli-telemetry');

const MARKER_DIR = path.join(path.dirname(INSTALL_ID_PATH), 'activation');
const MARKER_PATH = path.join(MARKER_DIR, 'first-rule-promoted.json');
const FIRST_BLOCK_MARKER_PATH = path.join(MARKER_DIR, 'first-blocked-call.json');

function readMarker() {
  try {
    if (!fs.existsSync(MARKER_PATH)) return null;
    return JSON.parse(fs.readFileSync(MARKER_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeMarker(record) {
  try {
    if (!fs.existsSync(MARKER_DIR)) fs.mkdirSync(MARKER_DIR, { recursive: true });
    fs.writeFileSync(MARKER_PATH, JSON.stringify(record, null, 2));
  } catch {
    // non-fatal: worst case we double-fire on a future run; the telemetry
    // backend can dedup by installId. Better to be silent than to throw.
  }
}

function computeDaysSinceInstall() {
  try {
    if (!fs.existsSync(INSTALL_ID_PATH)) return null;
    const installed = fs.statSync(INSTALL_ID_PATH).mtimeMs;
    if (!Number.isFinite(installed) || installed <= 0) return null;
    const diffMs = Date.now() - installed;
    if (diffMs < 0) return 0;
    // 1 decimal of precision; the metric uses 24h buckets but a finer-grained
    // number lets analytics chart same-day vs. 1d / 2d / week-of activation.
    return Math.round((diffMs / 86_400_000) * 10) / 10;
  } catch {
    return null;
  }
}

function computeMinutesSinceInstall() {
  try {
    if (!fs.existsSync(INSTALL_ID_PATH)) return null;
    const installed = fs.statSync(INSTALL_ID_PATH).mtimeMs;
    if (!Number.isFinite(installed) || installed <= 0) return null;
    const diffMs = Date.now() - installed;
    if (diffMs < 0) return 0;
    return Math.round((diffMs / 60_000) * 10) / 10;
  } catch {
    return null;
  }
}

/**
 * Fire the activation event if this is the first rule promotion for this
 * install. Returns true if an event was actually emitted, false if skipped
 * (already fired before, or environment opted out of telemetry).
 *
 * Always synchronous and never throws — safe to call from any side-effect
 * site without try/catch wrapping. The underlying telemetry call is itself
 * fire-and-forget over HTTPS with a 3s timeout.
 */
function recordFirstRulePromotion(metadata = {}) {
  if (readMarker()) return false; // already fired

  if (process.env.THUMBGATE_NO_TELEMETRY === '1' || process.env.DO_NOT_TRACK === '1') {
    // Still write the marker so a later run with telemetry re-enabled does not
    // fire stale activation data weeks after the actual first promotion.
    writeMarker({
      installId: getInstallId(),
      promotedAt: new Date().toISOString(),
      telemetryOptOut: true,
    });
    return false;
  }

  const installId = getInstallId();
  const daysToFirstRule = computeDaysSinceInstall();
  const visitorType = classifyInstall();

  writeMarker({
    installId,
    promotedAt: new Date().toISOString(),
    daysToFirstRule,
    visitorType,
    ...metadata,
  });

  trackEvent('activation_first_rule_promoted', {
    daysToFirstRule,
    visitorType,
    ...metadata,
  });
  return true;
}

/**
 * Fire the first_blocked_tool_call activation event exactly once per install/workspace.
 * Returns true if an event was actually emitted, false if skipped.
 */
function recordFirstBlockedToolCall(metadata = {}) {
  try {
    if (fs.existsSync(FIRST_BLOCK_MARKER_PATH)) return false;
  } catch {
    return false;
  }

  const installId = getInstallId();
  const minutesSinceInstall = computeMinutesSinceInstall();
  const visitorType = classifyInstall();

  if (process.env.THUMBGATE_NO_TELEMETRY === '1' || process.env.DO_NOT_TRACK === '1') {
    try {
      if (!fs.existsSync(MARKER_DIR)) fs.mkdirSync(MARKER_DIR, { recursive: true });
      fs.writeFileSync(FIRST_BLOCK_MARKER_PATH, JSON.stringify({
        installId,
        blockedAt: new Date().toISOString(),
        minutesSinceInstall,
        telemetryOptOut: true,
      }, null, 2));
    } catch {}
    return false;
  }

  try {
    if (!fs.existsSync(MARKER_DIR)) fs.mkdirSync(MARKER_DIR, { recursive: true });
    fs.writeFileSync(FIRST_BLOCK_MARKER_PATH, JSON.stringify({
      installId,
      blockedAt: new Date().toISOString(),
      minutesSinceInstall,
      visitorType,
      ...metadata,
    }, null, 2));
  } catch {}

  trackEvent('first_blocked_tool_call', {
    minutesSinceInstall,
    visitorType,
    ...metadata,
  });
  return true;
}

/**
 * Summarize first_blocked_tool_call events from raw/parsed telemetry entries.
 * Returns { count, medianMinutes, under5MinutesCount }.
 */
function summarizeFirstBlockEvents(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { count: 0, medianMinutes: null, under5MinutesCount: 0 };
  }

  let count = 0;
  const minutesList = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const et = e.eventType || e.event || '';
    if (et !== 'first_blocked_tool_call') continue;
    if (e.visitorType === 'bot' || e.visitorType === 'ci') continue;
    count += 1;

    let m = null;
    if (typeof e.minutesSinceInstall === 'number' && Number.isFinite(e.minutesSinceInstall)) {
      m = e.minutesSinceInstall;
    } else if (typeof e.minutesToFirstBlock === 'number' && Number.isFinite(e.minutesToFirstBlock)) {
      m = e.minutesToFirstBlock;
    } else if (typeof e.signupToFirstBlockMs === 'number' && Number.isFinite(e.signupToFirstBlockMs)) {
      m = Math.round((e.signupToFirstBlockMs / 60_000) * 10) / 10;
    } else if (typeof e.elapsedSinceOpenMs === 'number' && Number.isFinite(e.elapsedSinceOpenMs)) {
      m = Math.round((e.elapsedSinceOpenMs / 60_000) * 10) / 10;
    }

    if (m !== null && m >= 0) {
      minutesList.push(m);
    }
  }

  if (count === 0) {
    return { count: 0, medianMinutes: null, under5MinutesCount: 0 };
  }
  if (minutesList.length === 0) {
    return { count, medianMinutes: null, under5MinutesCount: 0 };
  }

  minutesList.sort((a, b) => a - b);
  const mid = Math.floor(minutesList.length / 2);
  const medianMinutes = minutesList.length % 2 === 0
    ? Math.round(((minutesList[mid - 1] + minutesList[mid]) / 2) * 10) / 10
    : Math.round(minutesList[mid] * 10) / 10;
  const under5MinutesCount = minutesList.filter(v => v <= 5).length;

  return {
    count,
    medianMinutes,
    under5MinutesCount,
  };
}

function resetForTesting() {
  // Test-only helper. Removes the marker so a subsequent recordFirstRulePromotion
  // call re-fires. Never used in production code paths.
  try {
    if (fs.existsSync(MARKER_PATH)) fs.unlinkSync(MARKER_PATH);
    if (fs.existsSync(FIRST_BLOCK_MARKER_PATH)) fs.unlinkSync(FIRST_BLOCK_MARKER_PATH);
  } catch {}
}

module.exports = {
  recordFirstRulePromotion,
  recordFirstBlockedToolCall,
  summarizeFirstBlockEvents,
  computeDaysSinceInstall,
  computeMinutesSinceInstall,
  readMarker,
  writeMarker,
  MARKER_PATH,
  FIRST_BLOCK_MARKER_PATH,
  resetForTesting,
};
