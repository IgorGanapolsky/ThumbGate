'use strict';

/**
 * Pure functions that turn the operations log, the in-memory response timings and the deploy facts into the
 * plain-words Observability report the owner console shows. Every block carries either its numbers and a
 * `source`, or a `reason` saying why the numbers are missing: nothing here returns a bare null for a human to guess at.
 * Times travel as ISO strings; the page formats them in the owner's own clock.
 */

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const HEARTBEAT_MS = 60000;
const BEAT_GAP_MS = 150000;
const GB = 1024 ** 3;

const iso = (ms) => new Date(ms).toISOString();
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

function ago(ms) {
  if (ms < MIN) return 'under a minute ago';
  if (ms < HOUR) return plural(Math.round(ms / MIN), 'minute') + ' ago';
  if (ms < DAY) return plural(Math.round(ms / HOUR), 'hour') + ' ago';
  return plural(Math.round(ms / DAY), 'day') + ' ago';
}

function uptimeBlock({ beats, now }) {
  const source = 'server heartbeat, one a minute';
  if (!beats.length) return { percent: null, observedDays: null, since: null, lastOutage: null, source, reason: 'Uptime is not collected yet: the server heartbeat has not written anything.' };
  const times = beats.slice().sort((a, b) => a - b);
  const first = times[0];
  const observedMs = now - first;
  if (times.length < 3 || observedMs < 5 * MIN) return { percent: null, observedDays: null, since: iso(first), lastOutage: null, source, reason: 'Not enough heartbeats yet to measure uptime.' };
  let downMs = 0;
  let lastOutage = null;
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    if (gap <= BEAT_GAP_MS) continue;
    const down = gap - HEARTBEAT_MS;
    downMs += down;
    lastOutage = { startedAt: iso(times[i - 1] + HEARTBEAT_MS), endedAt: iso(times[i]), minutes: Math.max(1, Math.round(down / MIN)) };
  }
  return { percent: Math.round((1 - downMs / observedMs) * 10000) / 100, observedDays: Math.round((observedMs / DAY) * 10) / 10, since: iso(first), lastOutage, source, reason: null };
}

function errorsBlock({ events, now, collectingSince }) {
  const source = 'server error log (HTTP 500 to 599 answers)';
  if (collectingSince === null) return { lastHour: null, last24Hours: null, top: [], since: null, source, reason: 'The error log is not collected yet.' };
  const errors = events.filter((event) => event.kind === 'error');
  const within = (event, span) => now - event.time <= span;
  const groups = new Map();
  for (const event of errors.filter((e) => within(e, DAY))) {
    const key = event.what + '|' + event.status;
    const group = groups.get(key) || { what: String(event.what || 'Server error'), status: event.status ?? null, count: 0, lastSeenMs: 0 };
    group.count += 1;
    group.lastSeenMs = Math.max(group.lastSeenMs, event.time);
    groups.set(key, group);
  }
  const top = [...groups.values()].sort((a, b) => b.count - a.count || b.lastSeenMs - a.lastSeenMs).slice(0, 5).map((g) => ({ what: g.what, status: g.status, count: g.count, lastSeenAt: iso(g.lastSeenMs) }));
  return { lastHour: errors.filter((e) => within(e, HOUR)).length, last24Hours: errors.filter((e) => within(e, DAY)).length, top, since: iso(collectingSince), source, reason: null };
}

const SPEED_GROUPS = [['page', 'Web pages'], ['api', 'API'], ['telemetry', 'Site telemetry']];
function speedBlock({ speed, startedAt }) {
  const source = 'response times measured by this server since it started';
  const groups = [];
  for (const [key, name] of SPEED_GROUPS) {
    const entry = speed && speed[key];
    if (entry && entry.samples > 0) groups.push({ name, samples: entry.samples, typicalMs: entry.p50, slowestFivePercentMs: entry.p95 });
  }
  if (!groups.length) return { groups: [], since: startedAt, source, reason: 'No requests have been measured since the server started.' };
  return { groups, since: startedAt, source, reason: null };
}

function deployBlock({ startedAt, sha, title, titleReason, repo }) {
  const full = typeof sha === 'string' && /^[0-9a-f]{7,64}$/i.test(sha) ? sha.toLowerCase() : null;
  return {
    startedAt: startedAt || null,
    sha: full,
    shortSha: full ? full.slice(0, 9) : null,
    commitUrl: full && repo ? 'https://github.com/' + repo + '/commit/' + full : null,
    commitTitle: title || null,
    reason: full ? (title ? null : (titleReason || 'The commit title could not be looked up.')) : 'This build did not report which commit it came from.',
    source: 'build record and GitHub',
  };
}

function webhookBlock({ events, now, collectingSince }) {
  const source = 'Stripe notifications received by this server';
  if (collectingSince === null) return { lastArrivedAt: null, failures24h: null, lastFailureAt: null, since: null, source, reason: 'Stripe notification logging is not collected yet.' };
  const hooks = events.filter((event) => event.kind === 'webhook').sort((a, b) => b.time - a.time);
  const failures = hooks.filter((event) => event.ok === false);
  const failures24h = failures.filter((event) => now - event.time <= DAY).length;
  return {
    lastArrivedAt: hooks.length ? iso(hooks[0].time) : null,
    failures24h,
    lastFailureAt: failures.length ? iso(failures[0].time) : null,
    since: iso(collectingSince),
    source,
    reason: hooks.length ? null : 'No Stripe notification has arrived since logging began.',
  };
}

const SIGN_IN_WORDS = {
  invalid_state: 'sign-in link expired or was reused',
  invalid_id_token: 'provider sent a bad token',
  invalid_signature: 'token signature did not match',
  expired_token: 'token had expired',
  wrong_audience: 'token was meant for another app',
  invalid_issuer: 'token came from an unexpected issuer',
  unverified_email: 'email address not verified',
  sso_not_configured: 'sign-in is not configured',
  jwks_unavailable: 'provider keys could not be loaded',
  unknown_signing_key: 'provider key not recognised',
  invalid_nonce: 'sign-in check value did not match',
  sign_in_failed: 'sign-in failed',
};
function signInBlock({ events, now, collectingSince }) {
  const source = 'sign-in failures logged by this server';
  if (collectingSince === null) return { failed24h: null, reasons: [], since: null, source, reason: 'Sign-in failures are not collected yet.' };
  const failed = events.filter((event) => event.kind === 'sign_in_failed' && now - event.time <= DAY);
  const counts = new Map();
  for (const event of failed) counts.set(event.reason, (counts.get(event.reason) || 0) + 1);
  const reasons = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ words: SIGN_IN_WORDS[reason] || String(reason).replaceAll('_', ' '), count }));
  return { failed24h: failed.length, reasons, since: iso(collectingSince), source, reason: null };
}

function diskBlock(disk) {
  const source = 'the volume holding the data folder';
  if (!disk || !Number.isFinite(disk.capacityBytes) || disk.capacityBytes <= 0) return { usedGb: null, capacityGb: null, percent: null, source, reason: 'Disk size could not be read from the server.' };
  const round1 = (value) => Math.round(value * 10) / 10;
  return { usedGb: round1(disk.usedBytes / GB), capacityGb: round1(disk.capacityBytes / GB), percent: Math.round((disk.usedBytes / disk.capacityBytes) * 100), source, reason: null };
}

function headline({ uptime, errors, webhooks, signIn, disk, now }) {
  const problems = [];
  let red = false;
  if (errors.lastHour > 0) { problems.push(plural(errors.lastHour, 'server error') + ' in the last hour'); if (errors.lastHour >= 10) red = true; }
  if (uptime.lastOutage && now - Date.parse(uptime.lastOutage.endedAt) <= DAY) problems.push('the site was down for ' + plural(uptime.lastOutage.minutes, 'minute') + ', ' + ago(now - Date.parse(uptime.lastOutage.endedAt)));
  if (webhooks.failures24h > 0) {
    problems.push(plural(webhooks.failures24h, 'Stripe notification') + ' failed in 24 hours');
    if (webhooks.lastFailureAt && now - Date.parse(webhooks.lastFailureAt) <= HOUR) red = true;
  }
  if (signIn.failed24h >= 5) problems.push(signIn.failed24h + ' failed sign-ins in 24 hours');
  if (disk.percent !== null && disk.percent >= 85) { problems.push('the disk is ' + disk.percent + '% full'); if (disk.percent >= 95) red = true; }
  if (problems.length) return { level: red ? 'red' : 'amber', sentence: (red ? 'Problem: ' : 'Needs a look: ') + problems.join('; ') + '.' };
  if (errors.reason) return { level: 'amber', sentence: 'The site is up, but server errors are not being counted yet.' };
  if (errors.since && now - Date.parse(errors.since) < HOUR) return { level: 'green', sentence: 'All good so far: site up, no errors since error counting began ' + ago(now - Date.parse(errors.since)) + '.' };
  return { level: 'green', sentence: 'All good: site up, no errors in the last hour.' };
}

// events: ops-events rows {time, kind, ...}; beats: heartbeat times in ms; collectingSince: ms of the first heartbeat or event, or null.
function buildReport({ now = Date.now(), events = [], beats = [], speed = null, startedAt = null, uptimeSeconds = null, sha = null, commitTitle = null, commitTitleReason = null, repo = null, disk = null }) {
  const times = [...beats, ...events.map((event) => event.time)];
  const collectingSince = times.length ? Math.min(...times) : null;
  const uptime = uptimeBlock({ beats, now });
  const errors = errorsBlock({ events, now, collectingSince });
  const webhooks = webhookBlock({ events, now, collectingSince });
  const signIn = signInBlock({ events, now, collectingSince });
  const diskReport = diskBlock(disk);
  return {
    headline: headline({ uptime, errors, webhooks, signIn, disk: diskReport, now }),
    uptime,
    errors,
    speed: speedBlock({ speed, startedAt }),
    lastDeploy: deployBlock({ startedAt, sha, title: commitTitle, titleReason: commitTitleReason, repo }),
    webhooks,
    signIn,
    disk: diskReport,
    runningFor: { seconds: Number.isFinite(uptimeSeconds) ? Math.floor(uptimeSeconds) : null, since: startedAt, source: 'this server process', reason: Number.isFinite(uptimeSeconds) ? null : 'The server did not report how long it has been running.' },
  };
}

module.exports = { buildReport, uptimeBlock, errorsBlock, speedBlock, deployBlock, webhookBlock, signInBlock, diskBlock, headline, ago };
