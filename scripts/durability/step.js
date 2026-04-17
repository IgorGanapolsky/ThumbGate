'use strict';

/**
 * step.js — lightweight durable-step helper.
 *
 * Inspired by the "use step" pattern in Vercel Workflows, without adopting
 * the full durable-execution runtime. Gives each external call (HTTP,
 * LanceDB, LLM) a uniform retry + idempotency wrapper:
 *
 *   const result = await runStep('zernio.publishPost', {
 *     retries: 3,
 *     idempotencyKey: idempotencyKey(content, platforms),
 *   }, async ({ attempt }) => {
 *     return zernioFetch('POST', '/posts', body, { idempotencyKey: ... });
 *   });
 *
 * Why a custom helper instead of Vercel Workflows / Temporal / Inngest?
 *   - We run on Railway, not Vercel.
 *   - SQLite + existing workflow tables already cover the durable state
 *     we need; the gap is per-call retry/idempotency, not orchestration.
 *   - A 60-line helper captures ~70% of the reliability benefit without
 *     the platform migration or new ops surface.
 *
 * Error classification:
 *   - Errors with `retryable: true` or a `code` in TRANSIENT_CODES retry.
 *   - Errors with `nonRetryable: true` bail immediately.
 *   - HTTP status (from `err.status` or parsed from message):
 *       * 429 or 5xx → retry
 *       * 4xx        → fail (no point retrying validation errors)
 *   - Unknown errors → retry (capped by `retries` count — fail-open on
 *     uncertainty, but bounded).
 */

const crypto = require('node:crypto');

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const DEFAULT_BACKOFF_MS = Object.freeze([250, 1000, 4000]);

function defaultClassify(err) {
  if (!err) return 'fail';
  if (err.nonRetryable === true) return 'fail';
  if (err.retryable === true) return 'retry';
  if (err.code && TRANSIENT_CODES.has(err.code)) return 'retry';

  // HTTP status from either an explicit prop or a parsed message.
  const statusFromProp = Number.isFinite(err.status) ? err.status : null;
  const msg = typeof err.message === 'string' ? err.message : '';
  const match = /\b(5\d{2}|4\d{2})\b/.exec(msg);
  const status = statusFromProp || (match ? Number(match[1]) : null);

  if (status === 429) return 'retry';
  if (status && status >= 500 && status < 600) return 'retry';
  if (status && status >= 400 && status < 500) return 'fail';

  // Unknown — retry cautiously. Bounded by the `retries` option.
  return 'retry';
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Build a stable 32-hex-char idempotency key from arbitrary inputs.
 * Same inputs → same key. Safe to use as an Idempotency-Key HTTP header,
 * a LanceDB row id, or a cache key for mid-flight deduplication.
 *
 * Usage:
 *   idempotencyKey(content, platformList, scheduledFor)
 */
function idempotencyKey(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) {
    if (p == null) {
      h.update('');
    } else if (typeof p === 'string') {
      h.update(p);
    } else {
      h.update(JSON.stringify(p));
    }
    h.update('\0'); // field separator — prevents ["a","b"] colliding with ["ab"]
  }
  return h.digest('hex').slice(0, 32);
}

/**
 * Execute `fn` with retry + backoff + classification. Returns the value
 * `fn` resolves to, or throws the last error after exhausting retries /
 * hitting a non-retryable verdict.
 *
 * @param {string} name          Step name, used in logs. e.g. 'zernio.publishPost'.
 * @param {object|function} options  { retries, backoffMs, classify, onRetry, onFail, logger }
 *                                   (may be passed directly as the callback shorthand)
 * @param {function({attempt:number}):Promise} fn  The actual work.
 */
async function runStep(name, options, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = {};
  }
  const {
    retries = 3,
    backoffMs = DEFAULT_BACKOFF_MS,
    classify = defaultClassify,
    onAttempt,
    onRetry,
    onFail,
    logger,
    sleepFn = sleep,
  } = options || {};

  if (typeof fn !== 'function') {
    throw new TypeError(`runStep(${name}): fn must be a function`);
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (typeof onAttempt === 'function') onAttempt({ name, attempt });
    try {
      return await fn({ attempt });
    } catch (err) {
      lastErr = err;
      const verdict = classify(err);
      const terminal = verdict === 'fail' || attempt >= retries;
      if (terminal) {
        if (typeof onFail === 'function') onFail({ name, attempt, err, verdict });
        if (typeof logger === 'function') {
          logger(`[step:${name}] FAIL attempt=${attempt} verdict=${verdict} err=${err && err.message || err}`);
        }
        throw err;
      }
      const wait = backoffMs[Math.min(attempt, backoffMs.length - 1)];
      if (typeof onRetry === 'function') onRetry({ name, attempt, err, waitMs: wait, verdict });
      if (typeof logger === 'function') {
        logger(`[step:${name}] RETRY attempt=${attempt} waitMs=${wait} err=${err && err.message || err}`);
      }
      await sleepFn(wait);
    }
  }
  throw lastErr;
}

module.exports = {
  runStep,
  idempotencyKey,
  defaultClassify,
  TRANSIENT_CODES,
  DEFAULT_BACKOFF_MS,
};
