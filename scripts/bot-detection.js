'use strict';

/**
 * bot-detection.js — Cheap heuristic to detect crawlers, link-preview
 * fetchers, and LLM scrapers hitting the checkout endpoint.
 *
 * Why this matters:
 *   GET /checkout/pro immediately creates a live Stripe Checkout session
 *   and 302s to Stripe. Every bot that follows that redirect spawns a
 *   session that will never complete. Result: the funnel shows "100+
 *   sessions opened, 0 completed" — which looks like product failure but
 *   is actually bot noise.
 *
 * The fix: if the requester is probably a bot, serve an HTML interstitial
 * that does NOT create a Stripe session. A real user on an interstitial
 * page clicks through (or the page JS-redirects them). A bot sees HTML
 * and moves on without dirtying the funnel.
 *
 * Heuristics (all cheap string checks):
 *   1. User-Agent matches a known bot/crawler/preview pattern.
 *   2. User-Agent is missing entirely (raw curl/Node fetch defaults).
 *   3. Accept header lacks text/html (most browsers send it; bots don't).
 *   4. Purpose / Sec-Purpose = 'prefetch' (Chrome's link prefetch).
 *   5. Sec-Fetch-Mode indicates preflight/prefetch rather than navigate.
 *
 * We intentionally err on the side of classifying ambiguous traffic as
 * "bot" — the downside (user sees an extra click) is tiny compared to
 * the upside (clean conversion data).
 */

const BOT_PATTERNS = [
  // Search engine crawlers
  /\bgooglebot\b/i,
  /\bbingbot\b/i,
  /\byandex(?:bot|images)\b/i,
  /\bbaiduspider\b/i,
  /\bduckduckbot\b/i,
  /\bapplebot\b/i,
  /slurp/i,
  /petalbot/i,
  /mediapartners/i,
  // LLM / AI crawlers — these started exploding in 2024+
  /\bgptbot\b/i,
  /chatgpt/i,
  /\boai-searchbot\b/i,
  /perplexity/i,
  /anthropic/i,
  /\bclaude(?:bot|-web)\b/i,
  /claude-searchbot/i,
  /google-extended/i,
  /\bccbot\b/i,
  /\bcohere-ai\b/i,
  /\bbytespider\b/i,
  /\bmeta-externalagent\b/i,
  /\bimagesiftbot\b/i,
  /\bdiffbot\b/i,
  // Link-preview fetchers
  /\bfacebookexternalhit\b/i,
  /\bfacebot\b/i,
  /\blinkedinbot\b/i,
  /\btwitterbot\b/i,
  /\bslackbot(?:-linkexpanding)?\b/i,
  /\btelegrambot\b/i,
  /\bwhatsapp\b/i,
  /\bdiscordbot\b/i,
  /\bskypeuripreview\b/i,
  /\bpinterest(?:bot|\/)/i,
  /\bredditbot\b/i,
  /\bembedly\b/i,
  /\biframely\b/i,
  // Generic bot/crawler/spider markers
  /\bbot\b/i,
  /\bcrawler\b/i,
  /\bcrawl\b/i,
  /\bspider\b/i,
  /\brobot\b/i,
  /\bheadless(?:chrome|browser)?\b/i,
  /\bphantomjs\b/i,
  /\bpuppeteer\b/i,
  /\bplaywright\b/i,
  /\bselenium\b/i,
  // HTTP clients (not browsers)
  /\bcurl\//i,
  /\bwget\//i,
  /\bnode-fetch\b/i,
  /\bgot\s*\(/i,
  /\bpython-requests\b/i,
  /\bpython-urllib\b/i,
  /\baxios\b/i,
  /\bokhttp\b/i,
  /\blibwww-perl\b/i,
  /\bjava\//i,
  /\bgo-http-client\b/i,
  /scrapy/i,
  /httpclient/i,
  /\bruby\b/i,
  // API/test tools
  /\bpostman(?:runtime)?\b/i,
  /\binsomnia\b/i,
  /\bhttpie\b/i,
  // Uptime/monitoring/security scanners
  /\buptimerobot\b/i,
  /\bbetteruptime\b/i,
  /\bpingdom\b/i,
  /\bstatuscake\b/i,
  /\bnewrelic\b/i,
  /\bdatadog\b/i,
  /\bahrefs\b/i,
  /\bsemrush\b/i,
  /\bmj12bot\b/i,
  /\bdotbot\b/i,
  /\bsocket(?:bot|-io)\b/i,
  /\bgitguardian\b/i,
  /\bsnyk\b/i,
  // Perf/audit
  /\blighthouse\b/i,
  /\bspeedcurve\b/i,
  /\bpagespeed\b/i,
  // Bare Mozilla/5.0, internal audit probes, and fuzzers observed on /go/* and /cancel
  /^mozilla\/5\.0\s*$/i,
  /\bfirstpage\//i,
  /\bmoney-v\d+-audit\b/i,
  /\bprotocolv\d+-gate\b/i,
  /\bfuzz faster u fool\b/i,
  /\bffuf\b/i,
  /\bbrowseros\b/i,
  /\bclaude-user\b/i,
];

function normalizeHeader(value) {
  if (Array.isArray(value)) return value.join(',');
  return typeof value === 'string' ? value : '';
}

/**
 * @param {import('http').IncomingHttpHeaders | Record<string,string>} headers
 * @returns {{ isBot: boolean, reason: string | null }}
 */
function classifyRequester(headers = {}) {
  const ua = normalizeHeader(headers['user-agent'] || headers['User-Agent']).trim();
  if (!ua) {
    return { isBot: true, reason: 'missing_user_agent' };
  }
  for (const pattern of BOT_PATTERNS) {
    if (pattern.test(ua)) {
      return { isBot: true, reason: `ua_match:${pattern.source}` };
    }
  }

  const purpose = normalizeHeader(headers.purpose || headers['sec-purpose']).toLowerCase();
  if (purpose.includes('prefetch')) {
    return { isBot: true, reason: 'prefetch_purpose' };
  }

  const secFetchMode = normalizeHeader(headers['sec-fetch-mode']).toLowerCase();
  if (secFetchMode && secFetchMode !== 'navigate' && secFetchMode !== 'cors' && secFetchMode !== 'same-origin') {
    return { isBot: true, reason: `sec_fetch_mode:${secFetchMode}` };
  }

  const accept = normalizeHeader(headers.accept || headers.Accept).toLowerCase();
  // Real browsers navigating to a page send an Accept header that includes
  // text/html. Bots frequently send */* or application/json or nothing.
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) {
    return { isBot: true, reason: 'accept_no_html' };
  }
  if (!accept) {
    return { isBot: true, reason: 'missing_accept' };
  }

  return { isBot: false, reason: null };
}

function isProbablyBot(headers) {
  return classifyRequester(headers).isBot;
}

/**
 * Stricter check for links that open a checkout page on GET. Link unfurlers and
 * email security scanners send browser-shaped User-Agent and Accept headers but
 * no Sec-Fetch-* navigation headers, so they pass classifyRequester and leave
 * expired sessions nobody saw. Browsers send Sec-Fetch-Mode: navigate on a link
 * click; older browsers without Sec-Fetch pass when the Referer is our own site.
 */
function isSameOriginReferer(headers = {}, appOrigin = '') {
  const referer = normalizeHeader(headers.referer || headers.referrer);
  if (!referer || !appOrigin) return false;
  try {
    return new URL(referer).host === new URL(appOrigin).host;
  } catch {
    return false;
  }
}

function isHumanCheckoutNavigation(headers = {}, appOrigin = '') {
  const mode = normalizeHeader(headers['sec-fetch-mode']).toLowerCase();
  const dest = normalizeHeader(headers['sec-fetch-dest']).toLowerCase();
  if (mode === 'navigate' && (!dest || dest === 'document')) {
    const site = normalizeHeader(headers['sec-fetch-site']).toLowerCase();
    if (!site || site === 'same-origin' || site === 'same-site') return true;
    const user = normalizeHeader(headers['sec-fetch-user']).toLowerCase();
    return user === '?1' || isSameOriginReferer(headers, appOrigin);
  }
  if (mode) return false;
  return isSameOriginReferer(headers, appOrigin);
}

// --- Rapid multi-checkout guard ---------------------------------------------
// A person opens one checkout, then reads the Stripe page. Headless agents and
// link checkers walk every buy button in a few seconds, and each walk opens a
// live Stripe session that later shows up as an abandoned checkout. When one
// requester (first forwarded IP + user agent) reaches a second checkout link
// within the window, the caller should send it to the no-session confirm page.
const RAPID_CHECKOUT_WINDOW_MS = 20 * 1000;
const RAPID_CHECKOUT_MAX_KEYS = 5000;

// Production traffic always arrives through the edge proxy with
// X-Forwarded-For set. Direct socket connections (local dev, tests) are not
// tracked, so a missing header yields no key.
function checkoutRequesterKey(headers = {}) {
  const ip = normalizeHeader(headers['x-forwarded-for']).split(',')[0].trim();
  if (!ip) return null;
  return `${ip}|${normalizeHeader(headers['user-agent'])}`;
}

function createRapidCheckoutGuard({ windowMs = RAPID_CHECKOUT_WINDOW_MS, maxKeys = RAPID_CHECKOUT_MAX_KEYS } = {}) {
  const lastSeen = new Map();
  function prune(now) {
    for (const [key, at] of lastSeen) {
      if (now - at <= windowMs && lastSeen.size <= maxKeys) break;
      lastSeen.delete(key);
    }
  }
  return {
    // Records this checkout hit and reports whether the same requester already
    // reached a checkout link inside the window.
    hit(key, now = Date.now()) {
      if (!key) return false;
      const previous = lastSeen.get(key);
      lastSeen.delete(key);
      lastSeen.set(key, now);
      prune(now);
      return previous !== undefined && now - previous <= windowMs;
    },
    size() {
      return lastSeen.size;
    },
  };
}

// --- Visitor classification (analytics filtering) ---------------------------
// Classifies telemetry/analytics traffic as bot / owner / real_user.
// Owner traffic is identified via the THUMBGATE_OWNER_EMAILS env var
// (comma-separated, case-insensitive). There is no built-in default:
// operators opt in via config, so the shipped artifact carries no
// personal data.

function getOwnerEmails(env = process.env) {
  const raw = env.THUMBGATE_OWNER_EMAILS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function classifyVisitor(req) {
  const ua = (req.headers && req.headers['user-agent']) || '';
  const email = req.email || (req.query && req.query.email) || '';

  for (const pattern of BOT_PATTERNS) {
    if (pattern.test(ua)) {
      return { type: 'bot', reason: `UA matches: ${pattern}`, userAgent: ua };
    }
  }
  if (!ua || ua.length < 10) {
    return { type: 'bot', reason: 'Empty or short user-agent', userAgent: ua };
  }
  if (email) {
    const normalized = email.toLowerCase();
    if (getOwnerEmails().some((ownerEmail) => normalized.includes(ownerEmail))) {
      return { type: 'owner', reason: 'Email matches configured owner list', userAgent: ua };
    }
  }
  return { type: 'real_user', reason: 'No bot pattern matched', userAgent: ua };
}

function shouldExcludeFromAnalytics(req) {
  const classification = req.visitorClass || classifyVisitor(req);
  return classification.type === 'bot';
}

function botFilterMiddleware(req, res, next) {
  req.visitorClass = classifyVisitor(req);
  next();
}

module.exports = {
  classifyRequester,
  isProbablyBot,
  isHumanCheckoutNavigation,
  checkoutRequesterKey,
  createRapidCheckoutGuard,
  RAPID_CHECKOUT_WINDOW_MS,
  classifyVisitor,
  shouldExcludeFromAnalytics,
  botFilterMiddleware,
  getOwnerEmails,
  BOT_PATTERNS,
};
