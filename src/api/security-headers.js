'use strict';

// Baseline response headers for every route. A header a handler sets itself (writeHead or
// setHeader afterwards) wins, so routes with a stricter policy, such as the nonce CSP on the
// owner pages, keep it.
//
// CSP note: about 165 of the 177 public pages carry inline <script> blocks and 9 use inline
// event handlers, so script-src still needs 'unsafe-inline' until those move to files or get
// a per-response nonce. Everything else in the policy is locked down.
// Never add a 'sha256-...' or nonce source to script-src while 'unsafe-inline' is needed: a browser that sees a hash or
// nonce ignores 'unsafe-inline', and every inline script on the site is blocked (found 25 Nov 2026 adding the Orion tag).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://plausible.io https://www.googletagmanager.com https://cdn.jsdelivr.net https://www.clarity.ms https://t.paradigmmachines.ai",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://plausible.io https://*.google-analytics.com https://www.googletagmanager.com https://*.clarity.ms https://t.paradigmmachines.ai https://api.github.com https://api.npmjs.org",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://accounts.google.com https://appleid.apple.com",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = Object.freeze({
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
});

function applySecurityHeaders(res) {
  // Bare response objects (in-process test doubles, some adapters) may lack the header API.
  if (!res || typeof res.setHeader !== 'function') return;
  const has = typeof res.hasHeader === 'function' ? (name) => res.hasHeader(name) : () => false;
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!has(name)) res.setHeader(name, value);
  }
}

module.exports = { SECURITY_HEADERS, CONTENT_SECURITY_POLICY, applySecurityHeaders };
