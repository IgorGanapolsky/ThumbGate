'use strict';

/**
 * Owner-only telemetry reader. Streams the telemetry log newest-first and stops at the window edge
 * or a byte cap, so a log of any size answers in bounded time and memory. Never refuses a large file:
 * when the cap is hit before the window edge, the result says `partial`.
 *
 * Stored telemetry lines are already normalised by appendTelemetryEvent (event type, visitor, source,
 * audience flags), so they are read as stored instead of being re-sanitised line by line.
 */

const fs = require('node:fs');
const path = require('node:path');
const telemetry = require('./telemetry-analytics');

const DAY_MS = 86400000;
const CHUNK_BYTES = 1024 * 1024;
const DEFAULT_MAX_BYTES = 96 * 1024 * 1024;
const OLD_RUN_TO_STOP = 200;

function stopped(signal) {
  if (signal && signal.aborted) throw Object.assign(new Error('Collection stopped'), { code: 'collection_timeout' });
}

function entryTime(entry) {
  const stamp = Date.parse(entry.receivedAt || entry.timestamp || '');
  return Number.isFinite(stamp) ? stamp : null;
}

// Streams one file newest-first. `onEntry(entry, time)` is called for every in-window line.
async function scanFile(filePath, { edgeMs, maxBytes, signal, onEntry }) {
  const meta = { bytesRead: 0, size: 0, reachedWindowEdge: false, capped: false, lines: 0 };
  let handle;
  try { handle = await fs.promises.open(filePath, 'r'); } catch (error) {
    if (error.code === 'ENOENT') return meta;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    meta.size = size;
    let position = size;
    let carry = Buffer.alloc(0);
    let oldRun = 0;
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    const handleLine = (bytes) => {
      if (!bytes.length) return true;
      let entry;
      try { entry = JSON.parse(bytes.toString('utf8')); } catch { return true; }
      if (!entry || typeof entry !== 'object') return true;
      meta.lines += 1;
      const time = entryTime(entry);
      if (time === null) return true;
      if (time < edgeMs) { oldRun += 1; return oldRun < OLD_RUN_TO_STOP; }
      oldRun = 0;
      onEntry(entry, time);
      return true;
    };
    while (position > 0) {
      stopped(signal);
      if (meta.bytesRead >= maxBytes) { meta.capped = true; return meta; }
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      await handle.read(buffer, 0, length, position);
      meta.bytesRead += length;
      const joined = carry.length ? Buffer.concat([buffer.subarray(0, length), carry]) : Buffer.from(buffer.subarray(0, length));
      let end = joined.length;
      let newline = joined.lastIndexOf(10, end - 1);
      while (newline >= 0) {
        if (!handleLine(joined.subarray(newline + 1, end))) { meta.reachedWindowEdge = true; return meta; }
        end = newline;
        newline = end > 0 ? joined.lastIndexOf(10, end - 1) : -1;
      }
      carry = Buffer.from(joined.subarray(0, end));
    }
    if (carry.length && !handleLine(carry)) meta.reachedWindowEdge = true;
    else if (position <= 0) meta.reachedWindowEdge = true;
    return meta;
  } finally {
    await handle.close();
  }
}

function telemetryPaths(feedbackDir) {
  try {
    const found = telemetry.getTelemetrySourceDiagnostics(feedbackDir).activePaths;
    if (found.length) return found;
  } catch { /* fall through to the default location */ }
  return [path.join(feedbackDir, telemetry.TELEMETRY_FILE_NAME)];
}

async function scanTelemetry({ feedbackDir, days = 30, now = Date.now(), maxBytes = DEFAULT_MAX_BYTES, signal, onEntry }) {
  const edgeMs = now - days * DAY_MS;
  const files = [];
  for (const filePath of telemetryPaths(feedbackDir)) files.push({ file: path.basename(filePath), ...(await scanFile(filePath, { edgeMs, maxBytes, signal, onEntry })) });
  const bytesRead = files.reduce((sum, file) => sum + file.bytesRead, 0);
  const size = files.reduce((sum, file) => sum + file.size, 0);
  const partial = files.some((file) => file.capped);
  return { windowDays: days, edge: new Date(edgeMs).toISOString(), bytesRead, size, partial, empty: size === 0, files: files.map(({ file, size: fileSize, bytesRead: read, capped }) => ({ file, size: fileSize, bytesRead: read, capped })) };
}

const kind = (entry) => String(entry.eventType || entry.event || '').toLowerCase();
const isWeb = (entry) => (entry.clientType || entry.client) === 'web';
const isFlagged = (entry) => entry.isBotTraffic === true || entry.isInternal === true || entry.isTest === true;

// Visitors, sessions, page views, CTA clicks, checkout starts and paid confirmations, in total and per UTC day.
async function readTrafficWindow(options) {
  const days = new Map();
  const visitors = new Set();
  const flagged = new Set();
  const sessions = new Set();
  const totals = { pageViews: 0, ctaClicks: 0, checkoutStarts: 0, checkoutPaidConfirmations: 0, webEvents: 0 };
  const dayOf = (time) => {
    const key = new Date(time).toISOString().slice(0, 10);
    let day = days.get(key);
    if (!day) { day = { date: key, visitors: new Set(), sessions: new Set(), pageViews: 0, ctaClicks: 0, checkoutStarts: 0, checkoutPaidConfirmations: 0 }; days.set(key, day); }
    return day;
  };
  const meta = await scanTelemetry({
    ...options,
    onEntry(entry, time) {
      if (!isWeb(entry)) return;
      totals.webEvents += 1;
      const day = dayOf(time);
      const who = entry.visitorId || entry.installId || entry.sessionId || null;
      if (who) { visitors.add(who); day.visitors.add(who); if (isFlagged(entry)) flagged.add(who); }
      if (entry.sessionId) { sessions.add(entry.sessionId); day.sessions.add(entry.sessionId); }
      const type = kind(entry);
      if (type === 'landing_page_view') { totals.pageViews += 1; day.pageViews += 1; }
      if (telemetry.isMarketingClickEvent(type) && !telemetry.isDirectStripeBeacon(entry)) { totals.ctaClicks += 1; day.ctaClicks += 1; }
      if (telemetry.isCheckoutStartEvent(type)) { totals.checkoutStarts += 1; day.checkoutStarts += 1; }
      if (type === 'checkout_paid_confirmed') { totals.checkoutPaidConfirmations += 1; day.checkoutPaidConfirmations += 1; }
    },
  });
  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({ date: day.date, visitors: day.visitors.size, sessions: day.sessions.size, pageViews: day.pageViews, ctaClicks: day.ctaClicks, checkoutStarts: day.checkoutStarts, checkoutPaidConfirmations: day.checkoutPaidConfirmations }));
  return {
    ...meta,
    traffic: { visitors: visitors.size, realVisitors: visitors.size - flagged.size, botOrInternalVisitors: flagged.size, sessions: sessions.size, pageViews: totals.pageViews, ctaClicks: totals.ctaClicks, checkoutStarts: totals.checkoutStarts, checkoutPaidConfirmations: totals.checkoutPaidConfirmations },
    daily,
  };
}

module.exports = { scanFile, scanTelemetry, readTrafficWindow, DEFAULT_MAX_BYTES };
