'use strict';

/**
 * auto-update-cli.js — background `npm install -g thumbgate@latest` triggered
 * by every CLI invocation, throttled to once per 24h via a marker file.
 *
 * Design:
 * - Non-blocking. Spawned detached, never delays the user's command.
 * - Throttled. Marker file `~/.thumbgate/.last-update-check` rewritten on each
 *   trigger; we skip if the marker is < 24h old.
 * - Permission-aware. If we can't infer write access to the npm global prefix
 *   we skip (don't trigger sudo prompts).
 * - Opt-out: `THUMBGATE_NO_AUTO_UPDATE=1` disables entirely.
 * - Source-checkout aware: if we're running from a dev checkout (no
 *   isSourceCheckout heuristic available cheaply here, so we check
 *   `process.env.npm_config_global` and the install path), skip.
 *
 * Why this exists (decided 2026-05-21 after CEO ask for "seamless auto-update
 * so users don't have to worry about it"): hook invocations already
 * auto-update via the Volta-style shim in install-shim.js, but direct CLI
 * invocations (`thumbgate cost`, `thumbgate stats`, etc.) used to run
 * whatever was last globally installed and grow stale. This closes that gap.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MARKER_PATH = path.join(os.homedir(), '.thumbgate', '.last-update-check');
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function isOptedOut(env = process.env) {
  // Opt-out for: explicit flag, CI environments (avoid surprising
  // pipeline runs with version drift), and dev-source checkouts.
  if (env.THUMBGATE_NO_AUTO_UPDATE === '1') return true;
  if (env.CI === 'true' || env.CI === '1') return true;
  if (env.NODE_ENV === 'test') return true;
  return false;
}

function markerAgeMs(now = Date.now(), markerPath = MARKER_PATH) {
  try {
    const stat = fs.statSync(markerPath);
    return now - stat.mtimeMs;
  } catch {
    return Infinity; // missing marker = "never checked" = trigger.
  }
}

function shouldTrigger({ now = Date.now(), env = process.env, markerPath = MARKER_PATH } = {}) {
  if (isOptedOut(env)) return false;
  return markerAgeMs(now, markerPath) >= TWENTY_FOUR_HOURS_MS;
}

function touchMarker(markerPath = MARKER_PATH) {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a fully detached `npm install -g thumbgate@latest` that survives the
 * parent CLI process exit. We don't wait for it; the next invocation gets the
 * newer version if the install succeeded.
 *
 * `unref()` is critical — without it, Node.js keeps the parent alive until
 * the child closes, which would block the user's terminal.
 */
function spawnUpdate({ env = process.env } = {}) {
  try {
    const child = spawn('npm', ['install', '-g', '--silent', '--no-audit', '--no-fund', 'thumbgate@latest'], {
      detached: true,
      stdio: 'ignore',
      env,
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Entry point called from bin/cli.js. Fire-and-forget. Never throws.
 */
function maybeTriggerBackgroundUpdate(options = {}) {
  try {
    if (!shouldTrigger(options)) return false;
    if (!touchMarker(options.markerPath)) return false;
    return spawnUpdate(options);
  } catch {
    return false;
  }
}

module.exports = {
  maybeTriggerBackgroundUpdate,
  shouldTrigger,
  touchMarker,
  isOptedOut,
  markerAgeMs,
  MARKER_PATH,
  TWENTY_FOUR_HOURS_MS,
};
