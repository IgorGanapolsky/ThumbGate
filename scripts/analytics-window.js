'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function validateTimeZone(value) {
  const resolved = normalizeText(value) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';
  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: resolved,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return resolved;
  } catch {
    const err = new Error(`Invalid timezone: ${resolved}`);
    err.code = 'invalid_timezone';
    throw err;
  }
}

function parseNow(value) {
  if (value === undefined || value === null || value === '') {
    return new Date();
  }

  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const err = new Error('Invalid now timestamp.');
    err.code = 'invalid_now';
    throw err;
  }
  return parsed;
}

function formatLocalDate(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function shiftLocalDate(localDate, offsetDays) {
  const [year, month, day] = String(localDate || '').split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return shifted.toISOString().slice(0, 10);
}

function normalizeWindow(value) {
  const normalized = (normalizeText(value) || 'lifetime').toLowerCase();
  switch (normalized) {
    case 'day':
    case 'daily':
      return 'today';
    case '7':
    case '7days':
    case '7-day':
      return '7d';
    case '30':
    case '30days':
    case '30-day':
      return '30d';
    default:
      return normalized;
  }
}

function serializeAnalyticsWindow(window) {
  return {
    window: window.window,
    timeZone: window.timeZone,
    bounded: window.bounded,
    startLocalDate: window.startLocalDate,
    endLocalDate: window.endLocalDate,
    now: window.now,
  };
}

function resolveAnalyticsWindow(options = {}) {
  if (options && options.__kind === 'analytics_window') {
    return options;
  }

  const window = normalizeWindow(options.window);
  if (!['lifetime', 'today', '7d', '30d'].includes(window)) {
    const err = new Error(`Invalid analytics window: ${window}`);
    err.code = 'invalid_window';
    throw err;
  }

  const timeZone = validateTimeZone(options.timeZone || options.timezone);
  const nowDate = parseNow(options.now);
  const endLocalDate = formatLocalDate(nowDate, timeZone);
  let startLocalDate = null;

  if (window === 'today') {
    startLocalDate = endLocalDate;
  } else if (window === '7d') {
    startLocalDate = shiftLocalDate(endLocalDate, -6);
  } else if (window === '30d') {
    startLocalDate = shiftLocalDate(endLocalDate, -29);
  }

  return {
    __kind: 'analytics_window',
    window,
    timeZone,
    bounded: Boolean(startLocalDate),
    startLocalDate,
    endLocalDate,
    now: nowDate.toISOString(),
  };
}

function eventOccursInWindow(timestamp, options = {}) {
  const window = resolveAnalyticsWindow(options);
  if (!window.bounded) return true;

  const normalized = normalizeText(timestamp);
  if (!normalized) return false;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const localDate = formatLocalDate(parsed, window.timeZone);
  return localDate >= window.startLocalDate && localDate <= window.endLocalDate;
}

function filterEntriesForWindow(entries = [], options = {}, resolveTimestamp = (entry) => entry && entry.timestamp) {
  const window = resolveAnalyticsWindow(options);
  return entries.filter((entry) => {
    if (!entry) return false;
    return eventOccursInWindow(resolveTimestamp(entry), window);
  });
}

module.exports = {
  eventOccursInWindow,
  filterEntriesForWindow,
  formatLocalDate,
  resolveAnalyticsWindow,
  serializeAnalyticsWindow,
};
