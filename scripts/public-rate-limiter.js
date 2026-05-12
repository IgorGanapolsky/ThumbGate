'use strict';

/**
 * Per-IP rate limiter for public HTTP endpoints.
 *
 * Built 2026-05-12 after audit found that `scripts/rate-limiter.js` (the CLI
 * usage-tracker, single global namespace, disk-backed) was applied to exactly
 * ONE server endpoint (`/v1/feedback/capture`). Every other public POST was
 * unrate-limited — including `/v1/intake/workflow-sprint`, which is the
 * lead-pipeline spam vector.
 *
 * Design:
 * - In-memory sliding window per IP × action.
 * - O(1) check + record.
 * - Memory-bounded: stale entries pruned on each check.
 * - No disk I/O (per-request perf > millisecond-budget).
 * - Bypass when THUMBGATE_NO_RATE_LIMIT=1 (test/dev).
 *
 * Why not the existing rate-limiter.js?
 * - It's keyed on action only, not (action × IP).
 * - It writes a JSON file on every check — fine for once-per-CLI-invocation,
 *   catastrophic at HTTP request rates.
 * - Its limits are designed for monetization (Free=N/day, Pro=unlimited),
 *   not for DOS prevention.
 */

const DEFAULT_LIMITS = {
  // Burst protection for high-volume legitimate ingest.
  telemetry_ping:           { windowMs: 60_000,    max: 120 },   // 120 / minute
  // Lead-pipeline spam protection (most important — these become real human conversations).
  intake_workflow_sprint:   { windowMs: 3_600_000, max: 5 },     // 5 / hour per IP
  // Self-serve checkout creation (Stripe session creation is rate-limited downstream too).
  checkout_create:          { windowMs: 60_000,    max: 20 },    // 20 / minute
  checkout_session:         { windowMs: 60_000,    max: 60 },    // 60 / minute (read-mostly)
  // Heavier compute paths.
  harness_job:              { windowMs: 60_000,    max: 30 },
  intents_plan:             { windowMs: 60_000,    max: 30 },
};

// (action × ip) → array of unix-ms timestamps within window
const _buckets = new Map();

// Soft cap on total tracked keys to bound memory. When exceeded, evict the
// least-recently-accessed half. 50k keys × ~8 bytes-per-timestamp × ~20
// timestamps = ~8 MB upper bound.
const MAX_TRACKED_KEYS = 50_000;
const _lastAccessed = new Map();

function _clientIp(req) {
  // Trust X-Forwarded-For only when behind a known proxy (Railway). Always
  // fall back to socket address.
  const xff = req.headers?.['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    // First (leftmost) IP is the originating client per RFC 7239 convention,
    // assuming the proxy chain is trusted.
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return (req.socket && (req.socket.remoteAddress || '')) || 'unknown';
}

function _evictIfFull() {
  if (_buckets.size <= MAX_TRACKED_KEYS) return;
  // Sort by last-accessed ascending, drop bottom half.
  const sorted = [...(_lastAccessed.entries())].sort((a, b) => a[1] - b[1]);
  const dropCount = Math.floor(sorted.length / 2);
  for (let i = 0; i < dropCount; i++) {
    const key = sorted[i][0];
    _buckets.delete(key);
    _lastAccessed.delete(key);
  }
}

/**
 * Check whether a request is allowed. Records the request if allowed.
 *
 * @param {string} action - one of the keys in DEFAULT_LIMITS (or a custom name; falls back to "deny none")
 * @param {http.IncomingMessage} req
 * @param {object} [opts]
 * @param {object} [opts.limit] - override { windowMs, max }
 * @returns {{ allowed: boolean, retryAfterSeconds?: number, count?: number, limit?: number }}
 */
function checkAndRecord(action, req, opts = {}) {
  if (process.env.THUMBGATE_NO_RATE_LIMIT === '1') {
    return { allowed: true };
  }
  const limit = opts.limit || DEFAULT_LIMITS[action];
  if (!limit) {
    // Unknown action — fail open (the alternative is to block requests
    // because we forgot to declare a limit, which is worse than no limit).
    return { allowed: true };
  }
  const ip = _clientIp(req);
  const key = `${action}\u0000${ip}`;
  const now = Date.now();
  const windowStart = now - limit.windowMs;
  let timestamps = _buckets.get(key);
  if (!timestamps) {
    timestamps = [];
    _buckets.set(key, timestamps);
  }
  // Drop entries outside the window.
  while (timestamps.length > 0 && timestamps[0] < windowStart) {
    timestamps.shift();
  }
  _lastAccessed.set(key, now);
  if (timestamps.length >= limit.max) {
    const oldest = timestamps[0];
    const retryAfterMs = Math.max(1000, oldest + limit.windowMs - now);
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      count: timestamps.length,
      limit: limit.max,
    };
  }
  timestamps.push(now);
  _evictIfFull();
  return {
    allowed: true,
    count: timestamps.length,
    limit: limit.max,
  };
}

/**
 * Send a problem-detail 429 response. The handler that calls checkAndRecord()
 * is responsible for invoking this on `!allowed`.
 */
function sendRateLimited(res, result) {
  const body = JSON.stringify({
    type: 'urn:thumbgate:error:rate-limited',
    title: 'Rate limited',
    status: 429,
    detail: 'Too many requests from this IP for this endpoint. Try again later.',
    retryAfterSeconds: result.retryAfterSeconds,
  });
  res.writeHead(429, {
    'Content-Type': 'application/problem+json',
    'Retry-After': String(result.retryAfterSeconds || 60),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function _resetForTests() {
  _buckets.clear();
  _lastAccessed.clear();
}

module.exports = {
  checkAndRecord,
  sendRateLimited,
  DEFAULT_LIMITS,
  _resetForTests,
};
