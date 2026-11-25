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
// - No consent call is made. Clarity's own Consent Mode applies to EEA, UK and Switzerland visitors (it waits for a
//   consent signal before setting cookies); this site has no banner, so it sends none. No browser time-zone guess.
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

// Pro checkout click: one custom event, then the link proceeds. The handler never touches the navigation.
const CHECKOUT_HANDLER = [
  "  l.addEventListener('click',function(e){",
  '    try {',
  "      var n=e.target; while (n && n.nodeType===1 && !(n.tagName==='A' && n.getAttribute('href'))) n=n.parentNode;",
  '      if (!n || n.nodeType!==1) return;',
  "      if (/^(https?:\\/\\/(www\\.)?thumbgate\\.ai)?\\/checkout\\/pro(\\?|#|$)/i.test(n.getAttribute('href'))) c[a]('event','checkout_click');",
  '    } catch (_) {}',
  '  },true);',
];

// Pages that link to Pro checkout get the click handler; form-only pages (partner intake, etc.) stay free of
// checkout references.
const PRO_CHECKOUT_LINK = /href=["'](https?:\/\/(www\.)?thumbgate\.ai)?\/checkout\/pro(\?|#|["'])/i;

function buildClarityTag(projectId, { trackCheckout = true } = {}) {
  if (!PROJECT_ID_PATTERN.test(projectId || '')) return '';
  const checkoutHandler = trackCheckout ? CHECKOUT_HANDLER : [];
  return [
    '<script>',
    '(function(c,l,a,r,i,t,y){',
    "  try { if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return; } catch (_) {}",
    '  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};',
    '  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;',
    '  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);',
    // No consent call and no guess from the browser time zone. Clarity applies Consent Mode itself for visitors in the
    // EEA, UK and Switzerland: it waits for a consent signal before setting cookies, and this site sends none.
    ...checkoutHandler,
    `})(window, document, "clarity", "script", "${projectId}");`,
    '</script>',
  ].join('\n');
}

// Adds the tag to a public HTML page. Returns the page unchanged when the tag must not load.
function injectClarityTag(html, { pathname = '/', headers = {}, env = process.env } = {}) {
  if (typeof html !== 'string' || !/<\/head>/i.test(html)) return html;
  const projectId = resolveClarityProjectId(env);
  if (!projectId || isPrivatePath(pathname) || hasPrivacySignal(headers)) return html;
  if (html.includes('www.clarity.ms/tag/')) return html;
  return maskFormFields(html).replace(/<\/head>/i, `${buildClarityTag(projectId, { trackCheckout: PRO_CHECKOUT_LINK.test(html) })}\n</head>`);
}

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
  return traffic.rows.map((row) => {
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
    tagExcludes: 'admin, dashboard, sign-in, checkout, billing and success pages; visitors with Global Privacy Control or Do Not Track',
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

module.exports = {
  DEFAULT_PROJECT_ID,
  EXPORT_URL,
  EXPORT_QUERIES,
  REFRESH_MS,
  resolveClarityProjectId,
  resolveClarityToken,
  isPrivatePath,
  hasPrivacySignal,
  buildClarityTag,
  injectClarityTag,
  maskFormFields,
  projectMetrics,
  summarize,
  breakdown,
  collectClarity,
};
