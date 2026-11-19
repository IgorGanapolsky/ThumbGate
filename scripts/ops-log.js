'use strict';

/**
 * Owner-console operations log: server errors, Stripe webhook arrivals and failures, failed sign-ins, and a
 * once-a-minute heartbeat the uptime figure is computed from. Append-only JSON lines in the feedback directory,
 * trimmed to the newest half when a file passes MAX_BYTES (about 50,000 heartbeats: more than 30 days).
 * Holds no personal data: an event is a time, a kind and a short plain-words label.
 */

const fs = require('node:fs');
const path = require('node:path');
const { scanFile } = require('./owner-telemetry');

const EVENTS_FILE = 'ops-events.jsonl';
const HEARTBEAT_FILE = 'uptime-heartbeats.jsonl';
const HEARTBEAT_MS = 60000;
const MAX_BYTES = 4 * 1024 * 1024;
const DAY_MS = 86400000;
let directory = null;
let timer = null;

function setDirectory(dir) { directory = dir ? path.resolve(dir) : null; }

// The directory must already exist: a log write never recreates a directory someone removed.
function append(file, row) {
  if (!directory) return false;
  try {
    fs.appendFileSync(path.join(directory, file), JSON.stringify(row) + '\n');
    return true;
  } catch { return false; }
}

const stamp = () => new Date().toISOString();

// A server error in plain words, from the route that failed. Never a path with ids or query strings.
function describeError(pathname) {
  const route = String(pathname || '');
  if (/^\/v1\/billing\/webhook|^\/webhook\/stripe/.test(route)) return 'Stripe payment notification failed';
  if (/^\/v1\/(billing\/checkout|checkout)|^\/checkout|^\/go\//.test(route)) return 'Checkout failed';
  if (/^\/v1\/(cloud\/sso|auth)|^\/signin|^\/logout/.test(route)) return 'Sign-in or sign-out failed';
  if (/^\/v1\/telemetry/.test(route)) return 'Site telemetry was not saved';
  if (/^\/(v1\/admin|admin)/.test(route)) return 'Owner console request failed';
  if (/^\/(dashboard|cloud)/.test(route)) return 'Dashboard page failed';
  if (/^\/v1\//.test(route)) return 'API request failed';
  return 'Web page failed';
}

function recordError(pathname, status) { return append(EVENTS_FILE, { timestamp: stamp(), kind: 'error', what: describeError(pathname), status: Number.isFinite(status) ? status : null }); }
function recordWebhook(ok, status) { return append(EVENTS_FILE, { timestamp: stamp(), kind: 'webhook', ok: Boolean(ok), status: Number.isFinite(status) ? status : null }); }
function recordSignInFailure(reason) {
  const safe = /^[a-z0-9_]{1,48}$/.test(String(reason || '')) ? String(reason) : 'sign_in_failed';
  return append(EVENTS_FILE, { timestamp: stamp(), kind: 'sign_in_failed', reason: safe });
}

function trim(file) {
  if (!directory) return;
  const target = path.join(directory, file);
  try {
    const { size } = fs.statSync(target);
    if (size <= MAX_BYTES) return;
    const fd = fs.openSync(target, 'r');
    try {
      const keep = Math.floor(MAX_BYTES / 2);
      const buffer = Buffer.alloc(keep);
      fs.readSync(fd, buffer, 0, keep, size - keep);
      const text = buffer.toString('utf8');
      const firstNewline = text.indexOf('\n');
      fs.writeFileSync(target, firstNewline >= 0 ? text.slice(firstNewline + 1) : '');
    } finally { fs.closeSync(fd); }
  } catch { /* the log is best effort */ }
}

// One beat now and one a minute from now on, for as long as the process lives. Calling it again restarts the timer.
function startHeartbeat(dir) {
  if (dir) setDirectory(dir);
  if (timer) clearInterval(timer);
  const beat = () => { append(HEARTBEAT_FILE, { timestamp: stamp() }); trim(HEARTBEAT_FILE); trim(EVENTS_FILE); };
  beat();
  timer = setInterval(beat, HEARTBEAT_MS);
  timer.unref?.();
  return () => { clearInterval(timer); timer = null; };
}

// Every row of one log file inside the window, as {time, ...row}, newest first.
async function readLog(feedbackDir, file, { now = Date.now(), days = 30, signal } = {}) {
  const rows = [];
  const meta = await scanFile(path.join(feedbackDir, file), { edgeMs: now - days * DAY_MS, maxBytes: 8 * 1024 * 1024, signal, onEntry: (entry, time) => rows.push({ ...entry, time }) });
  return { rows, size: meta.size };
}

module.exports = { EVENTS_FILE, HEARTBEAT_FILE, HEARTBEAT_MS, MAX_BYTES, setDirectory, describeError, recordError, recordWebhook, recordSignInFailure, startHeartbeat, readLog };
