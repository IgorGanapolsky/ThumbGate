'use strict';

/**
 * checkout-human-gate.js: decides whether a request may open a Stripe Checkout
 * Session. A session is created only for a POST that carries a short-lived,
 * single-use token fetched by page JS after a trusted pointer or keyboard
 * event, from a browser-class user agent, with at most 2 admissions per IP per
 * minute and a site-wide ceiling. Spec: docs/designs/2026-11-18-human-click-checkout.md.
 *
 * What this does not stop: a script that rotates IPs and calls the token
 * endpoint itself. The ceiling bounds that, it does not prevent it.
 */

const crypto = require('node:crypto');
const { classifyRequester } = require('./bot-detection');

const TOKEN_TTL_MS = 120 * 1000;
const BURST_MAX = 2;
const BURST_WINDOW_MS = 60 * 1000;
const BURST_MAX_KEYS = 5000;
const GLOBAL_MAX = 60;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const META_VALUE_MAX = 200;
const BUTTON_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,80}$/;
const LANDING_PATH_PATTERN = /^\/[A-Za-z0-9/_.~%-]{0,199}$/;

function headerValue(headers, name) {
  const value = headers && headers[name];
  if (Array.isArray(value)) return value.join(',');
  return typeof value === 'string' ? value : '';
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('base64url').slice(0, 22);
}

// Same trust rule the intake alert limiter uses (buildIntakeAlertRateLimitKey in
// src/api/server.js): behind Railway, x-real-ip is overwritten at the ingress and
// can be trusted; anywhere else every forwarding header is caller controlled and
// is ignored. cf-connecting-ip and x-forwarded-for are never used: no Cloudflare
// fronts this site, so a client can set both.
function clientIpKey(headers = {}, remoteAddress = '', env = process.env) {
  const behindRailway = Boolean(env && (env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID));
  const realIp = headerValue(headers, 'x-real-ip').trim();
  if (behindRailway && /^[0-9a-f:.]{3,64}$/i.test(realIp)) return realIp;
  return String(remoteAddress || '').trim() || 'no-ip';
}

function classifyUserAgentClass(headers = {}) {
  if (!headerValue(headers, 'user-agent').trim()) return 'unknown';
  return classifyRequester(headers).isBot ? 'bot' : 'browser';
}

function createTokenService({ secret, now = Date.now, ttlMs = TOKEN_TTL_MS } = {}) {
  if (!secret) throw new Error('createTokenService needs a signing value');
  const used = new Map();

  function sign(payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  }
  function prune(at) {
    for (const [nonce, expiresAt] of used) {
      if (expiresAt > at) break;
      used.delete(nonce);
    }
  }

  function issue({ ipKey, userAgent, buttonId, landingPage }) {
    const at = now();
    const claims = {
      iat: at,
      exp: at + ttlMs,
      ip: shortHash(ipKey),
      ua: shortHash(userAgent),
      btn: String(buttonId || '').slice(0, META_VALUE_MAX),
      lp: String(landingPage || '').slice(0, META_VALUE_MAX),
      n: crypto.randomBytes(12).toString('base64url'),
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  // consume=false lets the caller check other limits first and burn the token last.
  function verify(token, { ipKey, userAgent } = {}, { consume = true } = {}) {
    if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' };
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
    const expected = Buffer.from(sign(parts[0]));
    const given = Buffer.from(parts[1]);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      return { ok: false, reason: 'bad_signature' };
    }
    let claims;
    try {
      claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    const at = now();
    if (!claims || typeof claims.exp !== 'number' || claims.exp < at) return { ok: false, reason: 'expired' };
    if (claims.ip !== shortHash(ipKey)) return { ok: false, reason: 'ip_mismatch' };
    if (claims.ua !== shortHash(userAgent)) return { ok: false, reason: 'ua_mismatch' };
    prune(at);
    if (used.has(claims.n)) return { ok: false, reason: 'replayed' };
    if (consume) used.set(claims.n, claims.exp);
    return { ok: true, claims };
  }

  function consume(claims) {
    if (claims && claims.n) used.set(claims.n, claims.exp);
  }

  return { issue, verify, consume };
}

function createBurstLimiter({ max = BURST_MAX, windowMs = BURST_WINDOW_MS, maxKeys = BURST_MAX_KEYS } = {}) {
  const hits = new Map();
  function recent(key, at) {
    return (hits.get(key) || []).filter((stamp) => at - stamp <= windowMs);
  }
  return {
    wouldAdmit(key, at = Date.now()) {
      return recent(key, at).length < max;
    },
    // Records an admission and returns true, or returns false without recording
    // when the key already used its allowance inside the window.
    admit(key, at = Date.now()) {
      const live = recent(key, at);
      if (live.length >= max) {
        hits.set(key, live);
        return false;
      }
      live.push(at);
      hits.delete(key);
      hits.set(key, live);
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
      return true;
    },
    size() {
      return hits.size;
    },
  };
}

function cleanReferrer(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  let cut = text;
  try {
    const url = new URL(text);
    cut = `${url.origin}${url.pathname}`;
  } catch {
    cut = text.split(/[?#]/)[0];
  }
  return cut.slice(0, META_VALUE_MAX);
}

// landingPage and buttonId come from the browser, so they are recorded as
// untrusted: only values shaped like a path or an id are kept.
function cleanLandingPage(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  let path = text;
  try {
    path = new URL(text, 'https://thumbgate.invalid').pathname;
  } catch {
    path = text.split(/[?#]/)[0];
  }
  return LANDING_PATH_PATTERN.test(path) ? path : '';
}

function cleanButtonId(raw) {
  const text = String(raw || '').trim();
  return BUTTON_ID_PATTERN.test(text) ? text : '';
}

// Always returns the four keys; a missing or invalid value is the word "unknown".
function buildClickMetadata({ headers = {}, claims = null } = {}) {
  return {
    landingPage: cleanLandingPage(claims && claims.lp) || 'unknown',
    referrer: cleanReferrer(headerValue(headers, 'referer') || headerValue(headers, 'referrer')) || 'unknown',
    uaClass: classifyUserAgentClass(headers),
    buttonId: cleanButtonId(claims && claims.btn) || 'unknown',
  };
}

function createHumanGate({
  secret,
  now = Date.now,
  ttlMs,
  max,
  windowMs,
  globalMax = GLOBAL_MAX,
  globalWindowMs = GLOBAL_WINDOW_MS,
  env = process.env,
} = {}) {
  const tokens = createTokenService({ secret, now, ttlMs });
  const limiter = createBurstLimiter({ max, windowMs });
  const ceiling = createBurstLimiter({ max: globalMax, windowMs: globalWindowMs, maxKeys: 1 });

  // Gives a token only to a browser-class user agent.
  function issueToken({ headers = {}, remoteAddress = '', buttonId = '', landingPage = '' } = {}) {
    if (classifyUserAgentClass(headers) !== 'browser') return null;
    return tokens.issue({
      ipKey: clientIpKey(headers, remoteAddress, env),
      userAgent: headerValue(headers, 'user-agent'),
      buttonId,
      landingPage,
    });
  }

  function admit({ method, headers = {}, remoteAddress = '', token } = {}) {
    const refuse = (status, reason) => ({ ok: false, status, reason });
    if (String(method || '').toUpperCase() !== 'POST') return refuse(405, 'method_not_post');
    const uaClass = classifyUserAgentClass(headers);
    if (uaClass !== 'browser') return refuse(403, `ua_${uaClass}`);
    const ipKey = clientIpKey(headers, remoteAddress, env);
    const checked = tokens.verify(token, { ipKey, userAgent: headerValue(headers, 'user-agent') }, { consume: false });
    if (!checked.ok) return refuse(403, `token_${checked.reason}`);
    const at = now();
    if (!limiter.wouldAdmit(ipKey, at)) return refuse(429, 'burst_limit');
    if (!ceiling.wouldAdmit('all', at)) return refuse(429, 'global_ceiling');
    limiter.admit(ipKey, at);
    ceiling.admit('all', at);
    tokens.consume(checked.claims);
    return {
      ok: true,
      status: 200,
      reason: null,
      humanClick: { admitted: true, metadata: buildClickMetadata({ headers, claims: checked.claims }) },
    };
  }

  return { issueToken, admit, tokens, limiter, ceiling };
}

module.exports = {
  TOKEN_TTL_MS,
  BURST_MAX,
  BURST_WINDOW_MS,
  GLOBAL_MAX,
  clientIpKey,
  classifyUserAgentClass,
  createTokenService,
  createBurstLimiter,
  buildClickMetadata,
  createHumanGate,
};
