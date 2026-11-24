'use strict';

// Visits, installs and checkout starts grouped by utm_source, for the last 7 and
// 30 days. Read-only over the telemetry ledger; counts external traffic only.

const { loadTelemetryEvents, CHECKOUT_START_EVENT_TYPES } = require('./telemetry-analytics');

const WINDOW_DAYS = [7, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

function sourceKey(entry) {
  const raw = entry.utmSource || entry.source;
  const text = String(raw || '').trim().toLowerCase();
  return text || 'unknown';
}

function emptyRow(source) {
  return {
    source,
    visits: 0,
    visitors: new Set(),
    installIds: new Set(),
    checkoutStarts: 0,
  };
}

function summarizeWindow(events, days, nowMs) {
  const sinceMs = nowMs - days * DAY_MS;
  const rows = new Map();
  const row = (source) => {
    if (!rows.has(source)) rows.set(source, emptyRow(source));
    return rows.get(source);
  };

  for (const entry of events) {
    if ((entry.audience || 'external') !== 'external') continue;
    const at = Date.parse(entry.receivedAt || '');
    if (!Number.isFinite(at) || at < sinceMs || at > nowMs) continue;
    const client = entry.clientType || entry.client;
    const type = entry.eventType || entry.event;
    if (client === 'web' && type === 'landing_page_view') {
      const r = row(sourceKey(entry));
      r.visits += 1;
      const visitor = entry.visitorId || entry.sessionId;
      if (visitor) r.visitors.add(visitor);
    } else if (client === 'web' && CHECKOUT_START_EVENT_TYPES.has(type)) {
      row(sourceKey(entry)).checkoutStarts += 1;
    } else if (client === 'cli' && entry.installId && entry.installId !== 'unknown') {
      row(sourceKey(entry)).installIds.add(entry.installId);
    }
  }

  const sources = [...rows.values()]
    .map((r) => ({
      source: r.source,
      visits: r.visits,
      visitors: r.visitors.size,
      installs: r.installIds.size,
      checkoutStarts: r.checkoutStarts,
    }))
    .sort((a, b) => b.visits - a.visits || a.source.localeCompare(b.source));

  const allVisitors = new Set();
  const allInstalls = new Set();
  for (const r of rows.values()) {
    for (const v of r.visitors) allVisitors.add(v);
    for (const i of r.installIds) allInstalls.add(i);
  }
  const totals = {
    visits: sources.reduce((n, s) => n + s.visits, 0),
    visitors: allVisitors.size,
    installs: allInstalls.size,
    checkoutStarts: sources.reduce((n, s) => n + s.checkoutStarts, 0),
  };
  return { days, since: new Date(sinceMs).toISOString(), sources, totals };
}

function getUtmSourceSummary(feedbackDir, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const events = loadTelemetryEvents(feedbackDir);
  return {
    asOf: now.toISOString(),
    note: 'External traffic only. Installs are distinct CLI install ids; a CLI ping carries a source only when the install command passed one.',
    windows: WINDOW_DAYS.map((days) => summarizeWindow(events, days, now.getTime())),
  };
}

module.exports = { getUtmSourceSummary, WINDOW_DAYS };
