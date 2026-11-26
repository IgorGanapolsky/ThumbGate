'use strict';

// Microsoft Clarity: the session-replay and heatmap tag on public thumbgate.ai pages, and the owner console's read
// of Clarity's Data Export API.
//
// Tag rules:
// - The project id is public (it ships in every page), so it defaults to ThumbGate's project. Set
//   THUMBGATE_CLARITY_PROJECT_ID=off to remove the tag without a deploy of new code.
// - Never on private surfaces (admin, dashboard, sign-in, checkout, billing, success pages, JSON API).
// - Never when the visitor sends Global Privacy Control or Do Not Track; the tag also re-checks in the browser.
// - Forms and inputs are marked data-clarity-mask so typed text, emails and keys are never recorded.
// - Consent first: nothing from Clarity (or Orion) loads until the visitor accepts on the banner. Accepting sends
//   Clarity consentv2 analytics granted (advertising always denied); declining or withdrawing sends the withdrawal.
// - A click on a /checkout/pro link sends the Clarity custom event checkout_click (the page navigates as normal).
//
// Export rules: Clarity allows 10 export calls per project per day and only the last 1 to 3 days. The snapshot is
// cached on disk, refreshed at most every 8 hours with 3 calls, so restarts and deploys never spend the budget.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PROJECT_ID = 'zjaflwztgq';
const PROJECT_ID_PATTERN = /^[a-z0-9]{6,16}$/;
const EXPORT_URL = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
const REFRESH_MS = 8 * 60 * 60 * 1000;
// A failed refresh may have spent up to 3 of the 10 daily calls, so it waits as long as a successful one.
const FAILURE_RETRY_MS = REFRESH_MS;
const FETCH_TIMEOUT_MS = 7000;
const CACHE_FILE = 'clarity-insights.json';
const MAX_ROWS = 25;
// Each refresh: totals and behavior metrics, then traffic by page, then traffic by source.
const EXPORT_QUERIES = Object.freeze([
  { key: 'overall', params: { numOfDays: '1' } },
  { key: 'byUrl', params: { numOfDays: '1', dimension1: 'URL' } },
  { key: 'bySource', params: { numOfDays: '1', dimension1: 'Source' } },
]);
const PRIVATE_PATH_PREFIXES = Object.freeze([
  '/admin', '/v1/', '/api/', '/dashboard', '/cloud', '/signin', '/login', '/logout', '/checkout', '/success',
  '/billing', '/portal', '/account', '/oauth', '/auth', '/sso', '/keys', '/settings', '/lessons', '/feedback/',
]);
const OFF_VALUES = new Set(['off', 'false', '0', 'no', 'disabled', 'none']);

function resolveClarityProjectId(env = process.env) {
  const raw = String((env && env.THUMBGATE_CLARITY_PROJECT_ID) || '').trim().toLowerCase();
  if (OFF_VALUES.has(raw)) return '';
  return PROJECT_ID_PATTERN.test(raw) ? raw : DEFAULT_PROJECT_ID;
}

function resolveClarityToken(env = process.env) {
  const raw = String((env && (env.THUMBGATE_CLARITY_API_TOKEN || env.CLARITY_API_TOKEN)) || '').trim();
  return raw.length >= 20 && !/\s/.test(raw) ? raw : '';
}

function isPrivatePath(pathname) {
  const value = String(pathname || '/').toLowerCase();
  return PRIVATE_PATH_PREFIXES.some((prefix) => (prefix.endsWith('/')
    ? value.startsWith(prefix)
    : value === prefix || value.startsWith(prefix + '/') || value.startsWith(prefix + '.')));
}

function hasPrivacySignal(headers = {}) {
  const get = (name) => String(headers[name] ?? headers[name.toLowerCase()] ?? '').trim();
  return get('sec-gpc') === '1' || get('dnt') === '1';
}

// ---- Consent-gated page tags (Clarity and Orion) ----
// One inline consent manager per public page. Nothing from Clarity or Orion loads, and no request leaves the page,
// until the visitor presses "Accept". "Decline" (or a later withdrawal) stores the refusal, sends Clarity's consent
// withdrawal (which erases its cookies) and stops Orion. The choice is kept in localStorage under CONSENT_KEY; any
// element with data-analytics-consent reopens the choice. GPC/DNT visitors get no banner and nothing loads.

const CONSENT_KEY = 'thumbgate_analytics_consent';
const CONSENT_MARKER = 'data-thumbgate-consent';

// Pro checkout click: one custom event, then the link proceeds. The handler never touches the navigation.
const CHECKOUT_HANDLER = [
  "      d.addEventListener('click',function(e){",
  '        try {',
  "          var n=e.target; while (n && n.nodeType===1 && !(n.tagName==='A' && n.getAttribute('href'))) n=n.parentNode;",
  '          if (!n || n.nodeType!==1) return;',
  "          if (/^(https?:\\/\\/(www\\.)?thumbgate\\.ai)?\\/checkout\\/pro(\\?|#|$)/i.test(n.getAttribute('href'))) w.clarity('event','checkout_click');",
  '        } catch (_) {}',
  '      },true);',
];

// Pages that link to Pro checkout, or load a script that inserts such links (connect-panel.js, buyer-intent.js),
// get the click handler; form-only pages (partner intake, etc.) stay free of checkout references.
const PRO_CHECKOUT_LINK = /href=["'](https?:\/\/(www\.)?thumbgate\.ai)?\/checkout\/pro(\?|#|["'])/i;
const CHECKOUT_LINK_SCRIPT = /<script\b[^>]*\bsrc=["'][^"']*\/js\/(connect-panel|buyer-intent)\.js/i;
const linksToProCheckout = (html) => PRO_CHECKOUT_LINK.test(html) || CHECKOUT_LINK_SCRIPT.test(html);

const BANNER_TEXT = 'May we measure how visitors use this site? With your OK, Microsoft Clarity and Orion record pages, '
  + 'clicks and scrolling (form fields are masked). Nothing loads unless you accept.';

function buildConsentTag({ clarityId = '', orionSrc = '', trackCheckout = false } = {}) {
  const clarity = PROJECT_ID_PATTERN.test(clarityId || '') ? clarityId : '';
  if (!clarity && !orionSrc) return '';
  const lines = [
    `<script ${CONSENT_MARKER}>`,
    '(function(w,d,cfg){',
    "  try { if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || w.doNotTrack === '1') return; } catch (_) {}",
    '  var KEY=cfg.key, loaded=false, stopped=false;',
    '  function get(){ try { return w.localStorage.getItem(KEY); } catch (_) { return null; } }',
    '  function put(v){ try { w.localStorage.setItem(KEY,v); } catch (_) {} }',
    "  function add(src){ var s=d.createElement('script'); s.async=true; s.src=src; var f=d.getElementsByTagName('script')[0]; f.parentNode.insertBefore(s,f); }",
    '  function load(){',
    '    if (loaded) {',
    "      if (cfg.clarity && typeof w.clarity==='function') w.clarity('consentv2',{ad_Storage:'denied',analytics_Storage:'granted'});",
    // Orion has no restart after stop(): a fresh page load brings it back under the new consent.
    "      if (stopped && cfg.orion) { try { w.location.reload(); } catch (_) {} }",
    '      stopped=false; return;',
    '    }',
    '    loaded=true;',
    '    if (cfg.clarity) {',
    '      w.clarity=w.clarity||function(){(w.clarity.q=w.clarity.q||[]).push(arguments)};',
    "      w.clarity('consentv2',{ad_Storage:'denied',analytics_Storage:'granted'});",
    "      add('https://www.clarity.ms/tag/'+cfg.clarity);",
    ...(trackCheckout && clarity ? CHECKOUT_HANDLER : []),
    '    }',
    '    if (cfg.orion) {',
    `      ${ORION_STUB};`,
    '      add(cfg.orion);',
    '    }',
    '  }',
    '  function stop(){',
    '    if (!loaded) return; stopped=true;',
    "    try { if (typeof w.clarity==='function') { w.clarity('consentv2',{ad_Storage:'denied',analytics_Storage:'denied'}); w.clarity('consent',false); } } catch (_) {}",
    "    try { if (w.orion && typeof w.orion.stop==='function') w.orion.stop(); } catch (_) {}",
    '  }',
    "  function hide(){ var b=d.getElementById('tg-consent'); if (b && b.parentNode) b.parentNode.removeChild(b); }",
    "  function choose(v){ put(v); hide(); if (v==='granted') load(); else stop(); }",
    '  function show(){',
    "    if (d.getElementById('tg-consent')) return;",
    "    if (!d.body) { d.addEventListener('DOMContentLoaded',show); return; }",
    "    var b=d.createElement('div'); b.id='tg-consent'; b.setAttribute('role','region'); b.setAttribute('aria-label','Analytics choice');",
    "    b.style.cssText='position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;max-width:560px;margin:0 auto;padding:14px 16px;border-radius:10px;background:#111827;color:#f9fafb;font:14px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3)';",
    "    var p=d.createElement('p'); p.style.margin='0 0 10px'; p.textContent=cfg.text; b.appendChild(p);",
    "    var row=d.createElement('div'); row.style.cssText='display:flex;gap:8px;flex-wrap:wrap;align-items:center';",
    "    function btn(label,v,primary){ var x=d.createElement('button'); x.type='button'; x.textContent=label; x.setAttribute('data-consent-choice',v);",
    "      x.style.cssText='padding:7px 14px;border-radius:6px;border:1px solid #9ca3af;cursor:pointer;font:inherit;'+(primary?'background:#f9fafb;color:#111827':'background:transparent;color:#f9fafb');",
    "      x.addEventListener('click',function(){ choose(v); }); row.appendChild(x); }",
    "    btn('Accept','granted',true); btn('Decline','denied',false);",
    "    var a=d.createElement('a'); a.href='/privacy'; a.textContent='Privacy'; a.style.color='#d1d5db'; row.appendChild(a);",
    '    b.appendChild(row); d.body.appendChild(b);',
    '  }',
    "  w.thumbgateConsent={ accept:function(){ choose('granted'); }, decline:function(){ choose('denied'); }, open:show };",
    "  d.addEventListener('click',function(e){ var n=e.target; while (n && n.nodeType===1 && !(n.hasAttribute && n.hasAttribute('data-analytics-consent'))) n=n.parentNode;",
    "    if (n && n.nodeType===1) { if (e.preventDefault) e.preventDefault(); show(); } });",
    // A choice made in another tab applies here too (withdrawal stops this page's Clarity and Orion).
    "  try { w.addEventListener('storage',function(e){ if (e.key!==KEY) return; hide(); if (e.newValue==='granted') load(); else if (e.newValue==='denied') stop(); }); } catch (_) {}",
    "  var state=get(); if (state==='granted') load(); else if (state!=='denied') show();",
    `})(window, document, ${JSON.stringify({ key: CONSENT_KEY, clarity, orion: orionSrc, text: BANNER_TEXT })});`,
    '</script>',
  ];
  return lines.join('\n');
}

// Adds the consent-gated tag to a public HTML page. Returns the page unchanged when nothing may load.
// Local dev servers and test runs (localhost, 127.0.0.1, [::1]) never get the tag, so they stay out of Clarity.
const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:\d+)?$/i;
function isLoopbackHost(headers = {}) {
  const host = String(headers.host || headers.Host || '').trim();
  return LOOPBACK_HOST.test(host);
}
const isLoopbackUrl = (url) => /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:\d+)?(\/|$)/i.test(String(url || ''));

function injectAnalyticsTags(html, { pathname = '/', headers = {}, env = process.env } = {}) {
  if (typeof html !== 'string' || !/<\/head>/i.test(html)) return html;
  if (isPrivatePath(pathname) || hasPrivacySignal(headers) || isLoopbackHost(headers) || html.includes(CONSENT_MARKER)) return html;
  const clarityId = resolveClarityProjectId(env) || '';
  const orionSrc = orionEnabled(env) ? ORION_SRC : '';
  const tag = buildConsentTag({ clarityId, orionSrc, trackCheckout: linksToProCheckout(html) });
  if (!tag) return html;
  const page = clarityId ? maskFormFields(html) : html;
  return page.replace(/<\/head>/i, `${tag}\n</head>`);
}

// Kept for callers of the old name: Clarity and Orion now share the one consent-gated tag.
const injectClarityTag = injectAnalyticsTags;

// Marks forms and fields outside <script>, <style> and <template> blocks, so markup inside JS strings is untouched.
function maskFormFields(html) {
  return html.split(/(<(script|style|template)\b[\s\S]*?<\/\2\s*>)/i).map((part, index) => {
    if (index % 3 === 1) return part;
    if (index % 3 === 2) return '';
    return part
      .replace(/<form(?![^>]*data-clarity-mask)(\s|>)/gi, '<form data-clarity-mask="True"$1')
      .replace(/<(input|textarea|select)(?![^>]*data-clarity-mask)(\s|>)/gi, '<$1 data-clarity-mask="True"$2');
  }).join('');
}

// ---- Data Export API (owner console) ----

const clip = (value, max = 160) => (typeof value === 'string' ? value.slice(0, max) : value);

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

// Keeps only flat, primitive fields from Clarity's rows, so nothing unexpected reaches the console.
function projectRow(row) {
  const out = {};
  if (!row || typeof row !== 'object') return out;
  for (const [key, value] of Object.entries(row).slice(0, 16)) {
    if (!/^[A-Za-z0-9_ /-]{1,48}$/.test(key)) continue;
    const num = toNumber(value);
    if (num !== null) out[key] = num;
    else if (typeof value === 'string') out[key] = clip(value);
  }
  return out;
}

// Traffic keeps every row (Clarity returns at most 1,000) so breakdowns pick the busiest pages and sources;
// other metrics keep their first rows.
function projectMetrics(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.slice(0, 40).filter((m) => m && typeof m.metricName === 'string').map((m) => {
    const rows = Array.isArray(m.information) ? m.information : [];
    const keep = m.metricName.toLowerCase() === 'traffic' ? 1000 : MAX_ROWS;
    return { name: clip(m.metricName, 64), rows: rows.slice(0, keep).map(projectRow) };
  });
}

// What the console shows and the cache keeps: Traffic trimmed to its busiest rows.
function trimMetrics(metrics) {
  return (metrics || []).map((m) => ({
    name: m.name,
    rows: m.name.toLowerCase() === 'traffic'
      ? [...m.rows].sort((a, b) => (pick(b, ['totalSessionCount', 'sessionsCount']) || 0) - (pick(a, ['totalSessionCount', 'sessionsCount']) || 0)).slice(0, MAX_ROWS)
      : m.rows,
  }));
}

function pick(row, names) {
  for (const name of names) {
    const found = Object.keys(row || {}).find((key) => key.toLowerCase() === name.toLowerCase());
    if (found !== undefined && toNumber(row[found]) !== null) return toNumber(row[found]);
  }
  return null;
}

function summarize(overall) {
  const metrics = Object.fromEntries((overall || []).map((m) => [m.name.toLowerCase(), m.rows]));
  const traffic = (metrics.traffic || [])[0] || {};
  const share = (name) => {
    const row = (metrics[name] || [])[0];
    return row ? pick(row, ['sessionsWithMetricPercentage', 'percentage']) : null;
  };
  const scroll = (metrics.scrolldepth || [])[0];
  const engagement = (metrics.engagementtime || [])[0];
  return {
    sessions: pick(traffic, ['totalSessionCount', 'sessionsCount']),
    botSessions: pick(traffic, ['totalBotSessionCount']),
    distinctUsers: pick(traffic, ['distinctUserCount', 'distantUserCount']),
    pagesPerSession: pick(traffic, ['pagesPerSessionPercentage', 'PagesPerSessionPercentage']),
    averageScrollDepthPercent: scroll ? pick(scroll, ['averageScrollDepth', 'scrollDepth']) : null,
    engagementSeconds: engagement ? pick(engagement, ['activeTime', 'totalTime']) : null,
    rageClickSessionsPercent: share('rageclickcount'),
    deadClickSessionsPercent: share('deadclickcount'),
    quickbackSessionsPercent: share('quickbackclick'),
    scriptErrorSessionsPercent: share('scripterrorcount'),
    errorClickSessionsPercent: share('errorclickcount'),
    excessiveScrollSessionsPercent: share('excessivescroll'),
  };
}

function breakdown(metrics, dimension) {
  const traffic = (metrics || []).find((m) => m.name.toLowerCase() === 'traffic');
  if (!traffic) return [];
  return traffic.rows.filter((row) => {
    const dimKey = Object.keys(row).find((key) => key.toLowerCase() === dimension.toLowerCase());
    const value = dimKey ? String(row[dimKey]) : '';
    return !isLoopbackUrl(value) && !/^(localhost|127\.0\.0\.1)$/i.test(value);
  }).map((row) => {
    const dimKey = Object.keys(row).find((key) => key.toLowerCase() === dimension.toLowerCase());
    return {
      [dimension.toLowerCase()]: dimKey ? row[dimKey] : 'Unknown',
      sessions: pick(row, ['totalSessionCount', 'sessionsCount']),
      botSessions: pick(row, ['totalBotSessionCount']),
      distinctUsers: pick(row, ['distinctUserCount', 'distantUserCount']),
      pagesPerSession: pick(row, ['pagesPerSessionPercentage']),
    };
  }).sort((a, b) => (b.sessions || 0) - (a.sessions || 0)).slice(0, MAX_ROWS);
}

function readCache(feedbackDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(feedbackDir, CACHE_FILE), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeCache(feedbackDir, value) {
  try {
    fs.mkdirSync(feedbackDir, { recursive: true });
    const file = path.join(feedbackDir, CACHE_FILE);
    fs.writeFileSync(file + '.tmp', JSON.stringify(value));
    fs.renameSync(file + '.tmp', file);
  } catch { /* the console still shows the in-memory result */ }
}

async function callExport(query, { token, fetchImpl, signal }) {
  const url = EXPORT_URL + '?' + new URLSearchParams(query.params);
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: controller.signal });
    if (!response.ok) {
      const code = response.status === 401 ? 'clarity_token_rejected' : response.status === 403 ? 'clarity_forbidden' : response.status === 429 ? 'clarity_daily_limit' : 'clarity_http_' + response.status;
      throw Object.assign(new Error(code), { code });
    }
    return projectMetrics(await response.json());
  } catch (error) {
    if (error.code) throw error;
    throw Object.assign(new Error('clarity_unreachable'), { code: 'clarity_unreachable' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

let inFlight = null;

function wait(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(null); }, { once: true });
  });
}

async function refreshSnapshot({ token, projectId, feedbackDir, fetchImpl, now, previous }) {
  const fetched = {};
  for (const query of EXPORT_QUERIES) {
    try {
      fetched[query.key] = await callExport(query, { token, fetchImpl });
    } catch (error) {
      // Keep whatever the earlier snapshot had and remember the failure so the next try waits.
      const failed = { ...(previous || {}), projectId, lastAttemptAt: now, lastError: error.code };
      writeCache(feedbackDir, failed);
      return failed;
    }
  }
  const snapshot = {
    fetchedAt: now,
    lastAttemptAt: now,
    lastError: null,
    window: 'last 24 hours (UTC)',
    projectId,
    metrics: trimMetrics(fetched.overall),
    summary: summarize(fetched.overall),
    topPages: breakdown(fetched.byUrl, 'Url'),
    topSources: breakdown(fetched.bySource, 'Source'),
  };
  writeCache(feedbackDir, snapshot);
  return snapshot;
}

// What /v1/admin/behavior returns. Never contains the token.
async function collectClarity({ feedbackDir, env = process.env, fetchImpl = globalThis.fetch, now = Date.now(), signal, force = false, waitMs = 8000 } = {}) {
  let refreshing = false;
  const projectId = resolveClarityProjectId(env);
  const token = resolveClarityToken(env);
  const base = {
    projectId: projectId || null,
    tagEnabled: Boolean(projectId),
    tagExcludes: 'admin, dashboard, sign-in, checkout, billing and success pages; visitors with Global Privacy Control or Do Not Track; anyone who has not pressed Accept on the analytics banner',
    dashboardUrl: projectId ? `https://clarity.microsoft.com/projects/view/${projectId}/dashboard` : null,
    recordingsUrl: projectId ? `https://clarity.microsoft.com/projects/view/${projectId}/impressions` : null,
    heatmapsUrl: projectId ? `https://clarity.microsoft.com/projects/view/${projectId}/heatmaps` : null,
    exportConfigured: Boolean(token),
    callsPerRefresh: EXPORT_QUERIES.length,
    refreshHours: REFRESH_MS / 3600000,
  };
  if (!projectId) return { data: base, warnings: ['clarity_tag_disabled'] };
  if (!token) return { data: base, warnings: ['clarity_export_token_missing'] };
  let snapshot = readCache(feedbackDir);
  // A snapshot from another Clarity project is never shown under this one.
  if (snapshot && snapshot.projectId !== projectId) snapshot = null;
  const fresh = snapshot?.fetchedAt && now - snapshot.fetchedAt < REFRESH_MS;
  const waiting = snapshot?.lastError && snapshot?.lastAttemptAt && now - snapshot.lastAttemptAt < FAILURE_RETRY_MS;
  if ((!fresh && !waiting) || force) {
    if (typeof fetchImpl !== 'function') return { data: base, warnings: ['clarity_unreachable'] };
    // The refresh is not tied to this request, so a slow Clarity answer still lands in the cache for the next view.
    inFlight = inFlight || refreshSnapshot({ token, projectId, feedbackDir, fetchImpl, now, previous: snapshot }).finally(() => { inFlight = null; });
    const settled = await Promise.race([inFlight, wait(waitMs, signal)]);
    if (settled) snapshot = settled;
    else refreshing = true;
  }
  const warnings = [];
  if (refreshing) warnings.push('clarity_refreshing');
  if (snapshot?.lastError) warnings.push(snapshot.lastError);
  if (!snapshot?.fetchedAt) warnings.push('clarity_no_snapshot_yet');
  else if (now - snapshot.fetchedAt > REFRESH_MS * 2) warnings.push('clarity_snapshot_stale');
  return {
    data: {
      ...base,
      fetchedAt: snapshot?.fetchedAt ? new Date(snapshot.fetchedAt).toISOString() : null,
      window: snapshot?.window || null,
      summary: snapshot?.summary || null,
      topPages: snapshot?.topPages || [],
      topSources: snapshot?.topSources || [],
      metrics: snapshot?.metrics || [],
    },
    warnings,
  };
}

// ---- Orion visit-analytics (loaded only through the consent tag above) ----
// No visitor is identified: we never call orion.identify(). THUMBGATE_ORION=off removes Orion without new code.
const ORION_SCRIPT_ORIGIN = 'https://t.paradigmmachines.ai';
const ORION_SRC = `${ORION_SCRIPT_ORIGIN}/q6ksr42etswa3fz583qr.js`;
const ORION_STUB = "!function(w){var h=w.__orion=w.__orion||{},o=w.orion=w.orion||{};h.q=h.q||[];['identify','stop'].forEach(function(m){var f=function(){h.q.push([m,[].slice.call(arguments)])};f.q=1;if(!o[m])o[m]=f;if(!h[m])h[m]=f})}(window)";
function orionEnabled(env = process.env) {
  return !OFF_VALUES.has(String((env && env.THUMBGATE_ORION) || '').trim().toLowerCase());
}

module.exports = {
  CONSENT_KEY,
  ORION_STUB,
  ORION_SRC,
  ORION_SCRIPT_ORIGIN,
  orionEnabled,
  buildConsentTag,
  injectAnalyticsTags,
  DEFAULT_PROJECT_ID,
  EXPORT_URL,
  EXPORT_QUERIES,
  REFRESH_MS,
  resolveClarityProjectId,
  resolveClarityToken,
  isPrivatePath,
  hasPrivacySignal,
  injectClarityTag,
  maskFormFields,
  projectMetrics,
  summarize,
  breakdown,
  collectClarity,
};
