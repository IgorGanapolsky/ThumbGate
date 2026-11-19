'use strict';

/**
 * One plain upgrade line right after a user's FIRST real block, then at most once per 7 days.
 *
 * Shape: "ThumbGate just stopped <what>. Pro adds <feature> - thumbgate.ai/pricing?utm_source=cli&utm_medium=first_block"
 *
 * Channel: a PreToolUse hook is never a TTY (stdin and stdout are pipes), so the line is not printed.
 * It rides in the hook JSON's top-level `systemMessage`, which the host shows to the person and
 * never feeds to the model. `permissionDecisionReason` (what the model reads) is left unchanged.
 * Nothing in this module writes to stdout or stderr.
 *
 * Never shown: in CI, with THUMBGATE_NO_UPSELL=1, to a paying or licensed install, to the owner's
 * own machine, or when the once-per-7-days state cannot be written.
 * What was stopped is a fixed phrase per gate id, never the command, so no secret can leak into it.
 */

const fs = require('node:fs');
const path = require('node:path');

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PRICING_URL = 'thumbgate.ai/pricing?utm_source=cli&utm_medium=first_block';
const STATE_FILE = 'first-block-upsell.json';
const CI_VARS = ['CI', 'GITHUB_ACTIONS', 'TRAVIS', 'CIRCLECI', 'JENKINS_URL', 'GITLAB_CI', 'CODEBUILD_BUILD_ID'];

const STOPPED_PHRASES = {
  'secret-exfiltration': 'a secret being sent out of your machine',
  'force-push': 'a force push',
  'git-reset-hard': 'a hard reset that would discard your work',
  'git-clean-force': 'a forced clean that would delete untracked files',
  'rm-rf-home-or-root': 'a recursive delete of your home or root folder',
  'db-drop-table-production': 'a production table drop',
  'security-vuln-scan': 'code with a critical security finding',
  'slopsquat-guard': 'an install of a package name that looks made up',
  'learned-lesson': 'a repeat of a mistake you told ThumbGate about',
};
const DEFAULT_PHRASE = 'a risky tool call';

function stoppedPhrase(gateId) {
  return STOPPED_PHRASES[gateId] || DEFAULT_PHRASE;
}

function proFeature() {
  let cap = 3;
  try { cap = require('./rate-limiter').FREE_TIER_MAX_GATES || cap; } catch { /* keep default */ }
  return `enforcement of every rule you learn (Free enforces ${cap})`;
}

function buildLine(gateId) {
  return `ThumbGate just stopped ${stoppedPhrase(gateId)}. Pro adds ${proFeature()} - ${PRICING_URL}`;
}

// A paying, licensed, creator or owner install never sees the line. The 7-day trial is NOT exempt:
// the first block almost always lands inside it, and that is exactly when this line should show.
function defaultExempt(env) {
  if (env.THUMBGATE_API_KEY) return 'paid';
  if (env.THUMBGATE_NO_RATE_LIMIT === '1') return 'paid';
  try { if (require('./pro-local-dashboard').isCreatorDev()) return 'creator'; } catch { /* unavailable */ }
  try { if (require('./license').isProLicensed()) return 'paid'; } catch { /* unavailable */ }
  try { if (require('./cli-telemetry').classifyInstall() === 'owner') return 'owner'; } catch { /* unavailable */ }
  return null;
}

function resolveStateDir(env, stateDir) {
  if (stateDir) return stateDir;
  if (env.THUMBGATE_STATE_DIR) return env.THUMBGATE_STATE_DIR;
  try { return path.dirname(require('./cli-telemetry').INSTALL_ID_PATH); } catch { return null; }
}

function readState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { corrupt: true };
  } catch (err) {
    return err && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? null : { corrupt: true };
  }
}

/**
 * Decide whether to show the line for a real block, and record it when shown.
 * @returns {{ show: boolean, line?: string, reason?: string }}
 */
function maybeUpsell({ gate, env = process.env, now = Date.now(), stateDir, exempt = defaultExempt } = {}) {
  try {
    if (env.THUMBGATE_NO_UPSELL === '1') return { show: false, reason: 'opt-out' };
    if (CI_VARS.some((name) => env[name])) return { show: false, reason: 'ci' };
    if (env.THUMBGATE_SANDBOX_EVAL === '1') return { show: false, reason: 'sandbox' };
    const exemptReason = exempt(env);
    if (exemptReason) return { show: false, reason: exemptReason };

    const dir = resolveStateDir(env, stateDir);
    if (!dir) return { show: false, reason: 'no-state-dir' };
    const file = path.join(dir, STATE_FILE);
    const record = { firstShownAt: new Date(now).toISOString(), lastShownAt: now, shownCount: 1 };
    const state = readState(file);

    if (state === null) {
      // First ever: claim with an exclusive create so two parallel hooks cannot both show it.
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx' });
      } catch (err) {
        return { show: false, reason: err && err.code === 'EEXIST' ? 'claimed-elsewhere' : 'state-unwritable' };
      }
      return { show: true, line: buildLine(gate) };
    }

    if (state.corrupt) {
      // Unreadable state: stay quiet now and restart the 7-day clock so it heals.
      try { fs.writeFileSync(file, JSON.stringify({ ...record, firstShownAt: null, shownCount: 0 })); } catch { /* ignore */ }
      return { show: false, reason: 'state-corrupt' };
    }

    const last = Number(state.lastShownAt);
    if (Number.isFinite(last) && now - last < COOLDOWN_MS) return { show: false, reason: 'cooldown' };

    const next = {
      firstShownAt: state.firstShownAt || record.firstShownAt,
      lastShownAt: now,
      shownCount: (Number(state.shownCount) || 0) + 1,
    };
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(next));
      fs.renameSync(tmp, file);
    } catch {
      return { show: false, reason: 'state-unwritable' };
    }
    return { show: true, line: buildLine(gate) };
  } catch {
    return { show: false, reason: 'error' };
  }
}

function gateIdFromReason(reason) {
  const match = /^\[GATE:([^\]]+)\]/.exec(String(reason || ''));
  return match ? match[1] : null;
}

/**
 * Add `systemMessage` to a hook response object when it is a real deny and the line is due.
 * Returns the same object (mutated) or an untouched one; never throws.
 * `gateOverride` names a block that carries no [GATE:id] prefix (a learned-lesson block).
 */
function attachUpsell(response, options = {}) {
  try {
    if (!response || typeof response !== 'object' || response.systemMessage) return response;
    const hook = response.hookSpecificOutput || {};
    const reason = String(hook.permissionDecisionReason || response.reason || '');
    if (hook.permissionDecision !== 'deny') return response;
    if (/APPROVAL REQUIRED/.test(reason)) return response;
    const gate = options.gateOverride || gateIdFromReason(reason);
    if (!gate || gate === 'financial-control') return response;
    const result = maybeUpsell({ ...options, gate });
    if (result.show) response.systemMessage = result.line;
    return response;
  } catch {
    return response;
  }
}

/** String form for the gate engine's hook output. */
function withFirstBlockUpsell(output, options = {}) {
  try {
    if (typeof output !== 'string') return output;
    let parsed;
    try { parsed = JSON.parse(output); } catch { return output; }
    const before = parsed && parsed.systemMessage;
    const after = attachUpsell(parsed, options);
    return after && after.systemMessage && after.systemMessage !== before ? JSON.stringify(after) : output;
  } catch {
    return output;
  }
}

module.exports = {
  COOLDOWN_MS,
  PRICING_URL,
  STATE_FILE,
  STOPPED_PHRASES,
  stoppedPhrase,
  buildLine,
  maybeUpsell,
  attachUpsell,
  withFirstBlockUpsell,
  gateIdFromReason,
};
