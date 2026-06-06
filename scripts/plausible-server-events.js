'use strict';

/**
 * Server-side Plausible custom event emitter.
 *
 * Why: CLAUDE.md anti-lying directive + the 2026-05-13 revenue-ROI
 * critique flagged improvement #2 — "0/50 checkout sessions completed
 * and you don't know why." The full /checkout/pro funnel already writes
 * to local JSONL via appendBestEffortTelemetry(), but Plausible (where
 * we actually look at funnel charts) only sees page-views, not the
 * email-submitted / stripe-redirect-started transitions.
 *
 * This helper POSTs to the Plausible events API
 *   https://plausible.io/api/event
 * so the three funnel transitions show up alongside page-views in the
 * same dashboard.
 *
 * Hard guarantees:
 *  - Fire-and-forget. Never throws. Never blocks a 302 redirect.
 *  - Disabled when THUMBGATE_PLAUSIBLE_DISABLE=1 (CI / tests / opt-out).
 *  - 2-second hard timeout. The request socket is unref-ed so the
 *    process can exit without waiting for the response.
 *  - No PII. Only event name + UTM/CTA metadata (already public).
 */

const https = require('node:https');
const {
  resolvePlausibleDataDomain,
} = require('./plausible-domain-config');

const PLAUSIBLE_ENDPOINT = 'https://plausible.io/api/event';
const REQUEST_TIMEOUT_MS = 2_000;

function isPlausibleDisabled() {
  if (process.env.THUMBGATE_PLAUSIBLE_DISABLE === '1') return true;
  if (process.env.DO_NOT_TRACK === '1') return true;
  // Automatically disable Plausible events in local development unless explicitly overridden in tests
  if (process.env.THUMBGATE_PLAUSIBLE_DISABLE !== '0' && process.env.NODE_ENV !== 'production') {
    return true;
  }
  return false;
}

function getPlausibleDomain() {
  return resolvePlausibleDataDomain();
}

/**
 * Map raw telemetry fields onto Plausible "props" (string-only). Drop
 * undefined values; cap each prop at 100 chars to satisfy Plausible's limits.
 */
function buildProps(metadata = {}) {
  const props = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null || value === '') continue;
    const str = typeof value === 'string' ? value : String(value);
    if (str.length === 0) continue;
    props[key] = str.length > 100 ? `${str.slice(0, 97)}...` : str;
  }
  return props;
}

function buildPayload(eventName, options = {}) {
  const domain = options.domain || getPlausibleDomain();
  const pageUrl = options.pageUrl || `https://${domain}${options.page || '/'}`;
  return {
    name: eventName,
    url: pageUrl,
    domain,
    referrer: options.referrer || undefined,
    props: buildProps(options.props || {}),
  };
}

/**
 * Send a custom event to Plausible. Always returns a Promise that resolves —
 * the caller can `void plausibleEvent(...)` and ignore. Resolved value is
 * { sent, reason } so tests can assert the dispatch path was taken.
 */
function plausibleEvent(eventName, options = {}) {
  if (isPlausibleDisabled()) {
    return Promise.resolve({ sent: false, reason: 'disabled' });
  }
  if (typeof eventName !== 'string' || !eventName.trim()) {
    return Promise.resolve({ sent: false, reason: 'invalid_event_name' });
  }

  const payload = JSON.stringify(buildPayload(eventName, options));
  const url = new URL(PLAUSIBLE_ENDPOINT);
  const userAgent =
    options.userAgent ||
    `thumbgate-server/${process.env.npm_package_version || 'unknown'} (+https://github.com/IgorGanapolsky/ThumbGate)`;
  const xff = options.forwardedFor || options.remoteAddr;

  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'User-Agent': userAgent,
            ...(xff ? { 'X-Forwarded-For': xff } : {}),
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          // Plausible returns 202 on accept. Drain the response body so the
          // socket can be released back to the pool, then resolve.
          res.on('data', () => {});
          res.on('end', () => done({ sent: true, statusCode: res.statusCode }));
        }
      );
      req.on('error', () => done({ sent: false, reason: 'request_error' }));
      req.on('timeout', () => {
        req.destroy();
        done({ sent: false, reason: 'timeout' });
      });
      req.on('socket', (s) => s.unref());
      req.end(payload);
    } catch {
      done({ sent: false, reason: 'exception' });
    }
  });
}

/**
 * Convenience: fire the three /checkout/pro funnel events by name without
 * each caller having to know the canonical Plausible event labels.
 * The labels are chosen to read cleanly in the Plausible UI's event list.
 */
const CHECKOUT_EVENT_NAMES = Object.freeze({
  view: 'Checkout Pro Viewed',
  emailSubmitted: 'Checkout Pro Email Submitted',
  stripeRedirect: 'Checkout Pro Stripe Redirect Started',
  purchase: 'Checkout Pro Purchase Completed',
});

function recordCheckoutFunnelEvent(stage, options = {}) {
  const name = CHECKOUT_EVENT_NAMES[stage];
  if (!name) return Promise.resolve({ sent: false, reason: 'unknown_stage' });
  return plausibleEvent(name, options);
}

module.exports = {
  plausibleEvent,
  recordCheckoutFunnelEvent,
  buildPayload,
  buildProps,
  isPlausibleDisabled,
  getPlausibleDomain,
  CHECKOUT_EVENT_NAMES,
  PLAUSIBLE_ENDPOINT,
};
