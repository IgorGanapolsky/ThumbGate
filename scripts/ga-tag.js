'use strict';

// Google Analytics 4 tag for public thumbgate.ai pages, so the whole checkout funnel is measurable:
// page views on every public page, begin_checkout on /checkout/pro, purchase on a Stripe-verified /success.
//
// Rules:
// - One loader per page. Pages rendered from a template carry it already (marker data-thumbgate-ga); every other
//   public HTML page gets it from sendHtml.
// - Never on private surfaces (admin, dashboard, sign-in, billing portal, JSON API, lessons).
// - Never for a visitor who sends Global Privacy Control or Do Not Track (checked on the server and in the browser).
// - Google Consent Mode v2: ads storage is always denied. Analytics storage starts denied in the EEA, UK and
//   Switzerland (cookieless pings only) and granted elsewhere; the visitor's choice on the site's analytics banner
//   (localStorage thumbgate_analytics_consent) overrides both, and scripts/clarity.js updates it on Accept/Decline.
// - Event parameters never carry an email. GA's web-stream data redaction (on by default) removes an email that
//   appears in a page URL, such as /checkout/pro?customer_email=; a gtag page_location override is ignored by the
//   current Google tag (checked in Chromium 2026-11-27), so the tag does not rely on one.

const GA_MARKER = 'data-thumbgate-ga';
const CONSENT_KEY = 'thumbgate_analytics_consent';
const GA_ID_PATTERN = /^G-[A-Z0-9]+$/i;
const SKIP_PATH_PREFIXES = Object.freeze([
  '/admin', '/v1/', '/api/', '/dashboard', '/cloud', '/signin', '/login', '/logout', '/billing', '/portal',
  '/account', '/oauth', '/auth', '/sso', '/keys', '/settings', '/lessons', '/feedback/',
]);
// EEA + UK + Switzerland (ISO 3166-1 / 3166-2 codes as Google Consent Mode expects).
const CONSENT_REQUIRED_REGIONS = Object.freeze([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
]);

function isSkippedPath(pathname) {
  const value = String(pathname || '/').toLowerCase();
  return SKIP_PATH_PREFIXES.some((prefix) => (prefix.endsWith('/')
    ? value.startsWith(prefix)
    : value === prefix || value.startsWith(prefix + '/') || value.startsWith(prefix + '.')));
}

function hasPrivacySignal(headers = {}) {
  const get = (name) => String(headers[name] ?? headers[name.toLowerCase()] ?? '').trim();
  return get('sec-gpc') === '1' || get('dnt') === '1';
}

function cleanIds(ids) {
  return (Array.isArray(ids) ? ids : [ids])
    .map((id) => String(id || '').trim())
    .filter((id, at, all) => GA_ID_PATTERN.test(id) && all.indexOf(id) === at);
}

// JSON for an inline <script>: "<" is escaped so a value can never close the tag.
function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildGaBootstrap(ids, { events = [] } = {}) {
  const gaIds = cleanIds(ids);
  if (!gaIds.length) return '';
  const denied = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
  const lines = [
    `  <script async src="https://www.googletagmanager.com/gtag/js?id=${gaIds[0]}" ${GA_MARKER}></script>`,
    `  <script ${GA_MARKER}>`,
    '    window.dataLayer = window.dataLayer || [];',
    '    function gtag(){dataLayer.push(arguments);}',
    '    (function(){',
    `      var ids = ${inlineJson(gaIds)};`,
    "      try { if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') { ids.forEach(function (id) { window['ga-disable-' + id] = true; }); } } catch (_) {}",
    `      gtag('consent', 'default', ${inlineJson({ ...denied, analytics_storage: 'denied', region: CONSENT_REQUIRED_REGIONS })});`,
    `      gtag('consent', 'default', ${inlineJson({ ...denied, analytics_storage: 'granted' })});`,
    `      try { var c = window.localStorage.getItem(${inlineJson(CONSENT_KEY)}); if (c === 'granted' || c === 'denied') gtag('consent', 'update', { analytics_storage: c }); } catch (_) {}`,
    '    })();',
    "    gtag('js', new Date());",
    ...gaIds.map((id) => `    gtag('config', '${id}');`),
    ...buildEventLines(events),
    '  </script>',
  ];
  return lines.join('\n');
}

function buildEventLines(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event && /^[a-z][a-z0-9_]{0,39}$/.test(String(event.name || '')))
    .map((event) => `    gtag('event', '${event.name}', ${inlineJson(event.params || {})});`);
}

// Adds the GA tag to a public HTML page. Returns the page unchanged when it may not load or already has a loader.
function injectGaTag(html, { pathname = '/', headers = {}, ids = [], events = [] } = {}) {
  if (typeof html !== 'string' || !/<\/head>/i.test(html)) return html;
  if (isSkippedPath(pathname) || hasPrivacySignal(headers)) return html;
  if (html.includes(GA_MARKER) || html.includes('googletagmanager.com/gtag/js')) {
    // The page has its own loader: only add the page's funnel events after it.
    const eventLines = buildEventLines(events);
    if (!eventLines.length || !html.includes(GA_MARKER)) return html;
    const script = [`  <script ${GA_MARKER}-events>`, "    if (typeof gtag === 'function') {", ...eventLines.map((l) => `  ${l}`), '    }', '  </script>'].join('\n');
    return html.replace(/<\/head>/i, `${script}\n</head>`);
  }
  const tag = buildGaBootstrap(ids, { events });
  if (!tag) return html;
  return html.replace(/<\/head>/i, `${tag}\n</head>`);
}

module.exports = {
  GA_MARKER,
  CONSENT_REQUIRED_REGIONS,
  buildGaBootstrap,
  injectGaTag,
  isSkippedPath,
};
