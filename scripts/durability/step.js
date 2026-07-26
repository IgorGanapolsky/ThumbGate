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
function errMessage(err) {
  return err?.message ?? err;
}

function retryAfterMs(err) {
  const raw = err?.retryAfterMs
    ?? err?.headers?.['retry-after-ms']
    ?? err?.headers?.['retry-after'];
  if (raw === undefined || raw === null || raw === '') return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return String(raw).includes('.') || err?.headers?.['retry-after'] !== undefined
      ? Math.max(0, numeric * 1000)
      : Math.max(0, numeric);
  }
  const dateMs = Date.parse(raw);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

function handleStepError({
  err,
  attempt,
  retries,
  classify,
  backoffMs,
  name,
  onRetry,
  onFail,
  logger,
  jitterRatio,
  randomFn,
}) {
  const verdict = classify(err);
  const terminal = verdict === 'fail' || attempt >= retries;
  if (terminal) {
    if (typeof onFail === 'function') onFail({ name, attempt, err, verdict });
    if (typeof logger === 'function') {
      logger(`[step:${name}] FAIL attempt=${attempt} verdict=${verdict} err=${errMessage(err)}`);
    }
    return { terminal: true };
  }
  const configuredWait = backoffMs[Math.min(attempt, backoffMs.length - 1)];
  const serverWait = retryAfterMs(err);
  const baseWait = serverWait === null ? configuredWait : Math.max(configuredWait, serverWait);
  const jitter = jitterRatio > 0 ? baseWait * jitterRatio * ((randomFn() * 2) - 1) : 0;
  const waitMs = Math.max(0, Math.round(baseWait + jitter));
  if (typeof onRetry === 'function') onRetry({ name, attempt, err, waitMs, verdict });
  if (typeof logger === 'function') {
    logger(`[step:${name}] RETRY attempt=${attempt} waitMs=${waitMs} err=${errMessage(err)}`);
  }
  return { terminal: false, waitMs };
}

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
    sideEffect = false,
    idempotencyKey: stepIdempotencyKey,
    maxElapsedMs = Infinity,
    jitterRatio = 0,
    randomFn = Math.random,
  } = options || {};

  if (typeof fn !== 'function') {
    throw new TypeError(`runStep(${name}): fn must be a function`);
  }
  if (sideEffect && !String(stepIdempotencyKey || '').trim()) {
    const error = new Error(`runStep(${name}): side-effecting steps require idempotencyKey`);
    error.code = 'THUMBGATE_IDEMPOTENCY_KEY_REQUIRED';
    error.nonRetryable = true;
    throw error;
  }
  if (!Number.isFinite(Number(maxElapsedMs)) && maxElapsedMs !== Infinity) {
    throw new TypeError(`runStep(${name}): maxElapsedMs must be finite or Infinity`);
  }

  let lastErr;
  const startedAt = Date.now();
  for (let attempt = 0; attempt <= retries; attempt++) {
    const context = {
      name,
      attempt,
      idempotencyKey: stepIdempotencyKey || null,
      elapsedMs: Date.now() - startedAt,
    };
    if (typeof onAttempt === 'function') onAttempt(context);
    try {
      return await fn(context);
    } catch (err) {
      lastErr = err;
      const outcome = handleStepError({
        err,
        attempt,
        retries,
        classify,
        backoffMs,
        name,
        onRetry,
        onFail,
        logger,
        jitterRatio: Math.max(0, Number(jitterRatio) || 0),
        randomFn,
      });
      if (outcome.terminal) throw err;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs + outcome.waitMs > maxElapsedMs) {
        err.code = err.code || 'THUMBGATE_RETRY_BUDGET_EXHAUSTED';
        err.retryBudgetExhausted = true;
        if (typeof onFail === 'function') {
          onFail({ name, attempt, err, verdict: 'retry_budget_exhausted' });
        }
        throw err;
      }
      await sleepFn(outcome.waitMs);
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
  retryAfterMs,
};
