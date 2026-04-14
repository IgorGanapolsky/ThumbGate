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
  // LLM / AI crawlers — these started exploding in 2024+
  /\bgptbot\b/i,
  /\bchatgpt-user\b/i,
  /\boai-searchbot\b/i,
  /\bperplexitybot\b/i,
  /\banthropic-ai\b/i,
  /\bclaude(?:bot|-web)\b/i,
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

module.exports = {
  classifyRequester,
  isProbablyBot,
  BOT_PATTERNS,
};
