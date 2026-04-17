'use strict';

/**
 * zernio.js
 * Unified publisher via Zernio API.
 *
 * Required env vars:
 *   ZERNIO_API_KEY — Bearer token for https://zernio.com/api/v1
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tagUrlsInText } = require('../utm');
const { loadLocalEnv } = require('../load-env');
const { validateContentForPlatforms, truncateForPlatform } = require('../platform-limits');
const { runStep, idempotencyKey } = require('../../durability/step');

const ZERNIO_UTM = { source: 'zernio', medium: 'social', campaign: 'organic' };

const ZERNIO_BASE = 'https://zernio.com/api/v1';
const DEFAULT_DEDUP_LOG_PATH = path.join(__dirname, '..', '..', '..', '.thumbgate', 'zernio-dedup-log.json');

loadLocalEnv();

// ---------------------------------------------------------------------------
// Dedup — backed by marketing DB (SQLite) with JSON-file fallback
// ---------------------------------------------------------------------------

let _mktgDb = null;
function getMktgDb() {
  if (process.env.THUMBGATE_DEDUP_LOG_PATH && !process.env.THUMBGATE_ANALYTICS_DB) {
    return null;
  }
  if (_mktgDb) return _mktgDb;
  try {
    _mktgDb = require('../db/marketing-db');
    return _mktgDb;
  } catch {
    return null; // graceful degradation to JSON log
  }
}

function buildDedupKey(content, platform) {
  const hash = crypto.createHash('sha256').update(content.trim()).digest('hex').slice(0, 16);
  return `${platform}::${hash}`;
}

// Legacy JSON log helpers (fallback when DB unavailable)
function getDedupLogPath() {
  return process.env.THUMBGATE_DEDUP_LOG_PATH || DEFAULT_DEDUP_LOG_PATH;
}
function loadDedupLog() {
  try {
    const p = getDedupLogPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { /* ignore */ }
  return {};
}
function saveDedupLog(log) {
  const p = getDedupLogPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(log, null, 2));
}

function isDuplicate(content, platform) {
  // Use marketing DB only when not in test mode (test mode sets THUMBGATE_DEDUP_LOG_PATH)
  if (!process.env.THUMBGATE_DEDUP_LOG_PATH) {
    const db = getMktgDb();
    if (db) {
      const hash = db.hashContent(content);
      return !!db.isDuplicate(platform, hash, 1); // 24-hour window
    }
  }
  // JSON log fallback (always used in tests)
  const log = loadDedupLog();
  const entry = log[buildDedupKey(content, platform)];
  if (!entry) return false;
  return Date.now() - new Date(entry.postedAt).getTime() < 86_400_000;
}

function recordPost(content, platform, extra = {}) {
  const db = getMktgDb();
  if (db) {
    db.record({
      type: 'post', platform,
      contentHash: db.hashContent(content),
      postUrl: extra.postUrl || null,
      postId: extra.postId || null,
      campaign: extra.campaign || 'organic',
      tags: extra.tags || [],
    });
    return;
  }
  // fallback
  const log = loadDedupLog();
  const key = buildDedupKey(content, platform);
  log[key] = { platform, postedAt: new Date().toISOString() };
  const cutoff = Date.now() - 7 * 86_400_000;
  for (const [k, v] of Object.entries(log)) {
    if (new Date(v.postedAt).getTime() < cutoff) delete log[k];
  }
  saveDedupLog(log);
}

function requireApiKey() {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) {
    throw new Error('ZERNIO_API_KEY environment variable is required');
  }
  return key;
}

class ZernioQuotaError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ZernioQuotaError';
    this.code = 'ZERNIO_POST_LIMIT_REACHED';
    this.billingPeriod = details.billingPeriod || null;
    this.current = Number.isFinite(details.current) ? details.current : null;
    this.endpoint = details.endpoint || null;
    this.limit = Number.isFinite(details.limit) ? details.limit : null;
    this.method = details.method || null;
    this.planName = details.planName || null;
    this.status = details.status || null;
  }
}

function parseZernioErrorText(errorText) {
  if (!errorText || typeof errorText !== 'string') return null;
  try {
    const parsed = JSON.parse(errorText);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isZernioQuotaError(error) {
  return Boolean(
    error &&
    (error instanceof ZernioQuotaError || error.code === 'ZERNIO_POST_LIMIT_REACHED')
  );
}

function isZernioQuotaPayload(status, payload, errorText) {
  const message = String(payload?.error || payload?.message || errorText || '');
  return status === 403 && /post limit reached/i.test(message);
}

function resolveAccountId(account) {
  if (!account || typeof account !== 'object') {
    return '';
  }
  return String(account.accountId || account._id || account.id || '').trim();
}

function normalizeAccount(account) {
  if (!account || typeof account !== 'object') {
    return null;
  }
  const platform = String(account.platform || '').trim();
  const accountId = resolveAccountId(account);
  return {
    ...account,
    platform,
    accountId,
  };
}

function normalizePlatforms(platforms) {
  return platforms
    .map(normalizeAccount)
    .filter(Boolean)
    .map((platform) => ({
      platform: platform.platform,
      accountId: platform.accountId,
    }));
}

function groupAccountsByPlatform(accounts) {
  const groups = new Map();
  for (const account of accounts) {
    if (!account || !account.platform || !account.accountId) {
      continue;
    }
    const existing = groups.get(account.platform) || [];
    existing.push({
      platform: account.platform,
      accountId: account.accountId,
    });
    groups.set(account.platform, existing);
  }
  return groups;
}

function inferContentType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  return 'application/octet-stream';
}

function inferMediaType(contentType) {
  if (String(contentType || '').startsWith('video/')) {
    return 'video';
  }
  return 'image';
}

function normalizePostResult(payload) {
  const data = payload && typeof payload === 'object' ? (payload.data ?? payload) : {};
  const post = data.post && typeof data.post === 'object' ? data.post : null;
  const id = data.id || data._id || post?._id || post?.id || null;
  return {
    ...data,
    id,
    post: post || data.post,
  };
}

async function zernioFetch(method, endpoint, body = null, fetchOptions = {}) {
  const apiKey = requireApiKey();
  const url = `${ZERNIO_BASE}${endpoint}`;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  // Pass an Idempotency-Key header when the caller supplies one. Safe-by-default
  // for retried POSTs — Zernio (like Stripe) honors this to short-circuit dupes.
  if (fetchOptions.idempotencyKey) {
    headers['Idempotency-Key'] = fetchOptions.idempotencyKey;
  }

  const options = { method, headers };
  if (body !== null) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    const payload = parseZernioErrorText(errorText);
    if (isZernioQuotaPayload(res.status, payload, errorText)) {
      // Quota is a permanent failure for this billing window; never burn
      // retries on it. runStep honors the `nonRetryable` flag.
      const qErr = new ZernioQuotaError(payload?.error || 'Zernio post limit reached', {
        billingPeriod: payload?.billingPeriod,
        current: Number(payload?.current),
        endpoint,
        limit: Number(payload?.limit),
        method,
        planName: payload?.planName,
        status: res.status,
      });
      qErr.nonRetryable = true;
      throw qErr;
    }
    const httpErr = new Error(`Zernio API ${res.status} for ${method} ${endpoint}: ${errorText}`);
    httpErr.status = res.status; // lets defaultClassify see the status directly
    throw httpErr;
  }

  return res.json();
}

async function listPosts(options = {}) {
  const query = new URLSearchParams();
  if (options.limit) query.set('limit', String(options.limit));
  if (options.page) query.set('page', String(options.page));
  if (options.status) query.set('status', String(options.status));

  const suffix = query.toString() ? `?${query.toString()}` : '';
  const json = await zernioFetch('GET', `/posts${suffix}`);
  return Array.isArray(json.posts) ? json.posts : (json.data?.posts || json.data || []);
}

async function deletePost(postId) {
  if (!postId) throw new Error('deletePost: postId is required');
  const json = await zernioFetch('DELETE', `/posts/${encodeURIComponent(String(postId).trim())}`);
  return json.data ?? json;
}

async function requestMediaPresign(filename, contentType, size) {
  if (!filename) throw new Error('requestMediaPresign: filename is required');
  if (!contentType) throw new Error('requestMediaPresign: contentType is required');

  const json = await zernioFetch('POST', '/media/presign', {
    filename,
    contentType,
    size,
  });

  return json.data ?? json;
}

async function uploadLocalMedia(filePath, options = {}) {
  const resolvedPath = path.resolve(String(filePath || ''));
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`uploadLocalMedia: file not found at ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  const filename = options.filename || path.basename(resolvedPath);
  const contentType = options.contentType || inferContentType(resolvedPath);
  const presign = await requestMediaPresign(filename, contentType, stats.size);

  if (!presign.uploadUrl || !presign.publicUrl) {
    throw new Error('uploadLocalMedia: presign response missing uploadUrl or publicUrl');
  }

  const uploadResponse = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: fs.readFileSync(resolvedPath),
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text().catch(() => '');
    throw new Error(`uploadLocalMedia: upload failed with ${uploadResponse.status}: ${errorText}`);
  }

  return {
    contentType,
    key: presign.key || '',
    size: stats.size,
    type: presign.type || inferMediaType(contentType),
    url: presign.publicUrl,
  };
}

/**
 * Publishes a post immediately to one or more platforms.
 * @param {string} content
 * @param {Array<{platform: string, accountId: string}>} platforms
 * @returns {Promise<object>}
 */
async function publishPost(content, platforms, options = {}) {
  if (!content) throw new Error('publishPost: content is required');
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error('publishPost: platforms must be a non-empty array');
  }

  const normalizedPlatforms = normalizePlatforms(platforms);
  if (normalizedPlatforms.length === 0 || normalizedPlatforms.some((entry) => !entry.platform || !entry.accountId)) {
    throw new Error('publishPost: each platform entry requires platform and accountId');
  }

  // Tag trackable URLs with Zernio UTM parameters before publishing
  content = tagUrlsInText(content, options.utm || ZERNIO_UTM);

  const qualityGate = require('../../social-quality-gate');
  const gateResult = qualityGate.gatePost(content);
  if (!gateResult.allowed) {
    const reasons = gateResult.findings.map(f => f.reason).join(', ');
    console.error(`[zernio:publisher] BLOCKED by quality gate: ${reasons}`);
    return { blocked: true, reasons: gateResult.findings };
  }

  // Per-platform char-limit guard. Zernio blasts identical content to every
  // connected platform, so a 315-char post silently fails at Bluesky's 300
  // ceiling. Reject the over-limit targets up front with actionable detail.
  const { valid: withinLimit, rejected: overLimit } = validateContentForPlatforms(content, normalizedPlatforms);
  for (const r of overLimit) {
    console.error(
      `[zernio:publisher] BLOCKED ${r.platform} — content ${r.length} chars exceeds ${r.limit} by ${r.overBy}`,
    );
  }
  if (withinLimit.length === 0) {
    return {
      blocked: true,
      reasons: overLimit.map((r) => ({
        reason: 'platform_char_limit_exceeded',
        platform: r.platform,
        limit: r.limit,
        length: r.length,
        overBy: r.overBy,
      })),
    };
  }

  // Dedup: filter out platforms where identical content was posted in last 24h
  const dedupedPlatforms = withinLimit.filter((p) => {
    if (isDuplicate(content, p.platform)) {
      console.log(`[zernio:publisher] SKIPPED ${p.platform} — duplicate content within 24h`);
      return false;
    }
    return true;
  }).map(({ platform, accountId }) => ({ platform, accountId }));

  if (dedupedPlatforms.length === 0) {
    console.log('[zernio:publisher] All platforms skipped (duplicate content)');
    return { blocked: true, reasons: [{ reason: 'duplicate_content_all_platforms' }] };
  }

  console.log(`[zernio:publisher] Publishing to ${dedupedPlatforms.length} platform(s): ${dedupedPlatforms.map((p) => p.platform).join(', ')}`);

  // Idempotency key derived from content + platform set. Identical publish
  // requests retried within the same key window collapse to one Zernio post.
  const publishKey = idempotencyKey('zernio.publishPost', content, dedupedPlatforms);

  const json = await runStep('zernio.publishPost', {
    retries: 3,
    // Strip CR/LF from user-controlled error text to prevent log forging (S5145).
    logger: (msg) => console.warn(String(msg).replace(/[\r\n]+/g, ' ')),
  }, async () => zernioFetch('POST', '/posts', {
    content,
    firstComment: options.firstComment,
    mediaItems: options.mediaItems,
    publishNow: true,
    platforms: dedupedPlatforms,
  }, { idempotencyKey: publishKey }));

  const data = normalizePostResult(json);
  // Record each platform to prevent future dupes
  for (const p of dedupedPlatforms) {
    recordPost(content, p.platform);
  }
  console.log(`[zernio:publisher] Post published. id=${data.id ?? 'unknown'}`);
  return data;
}

/**
 * Schedules a post for future publication.
 * @param {string} content
 * @param {Array<{platform: string, accountId: string}>} platforms
 * @param {string} scheduledFor  ISO 8601 datetime
 * @param {string} timezone      IANA timezone string
 * @returns {Promise<object>}
 */
async function schedulePost(content, platforms, scheduledFor, timezone, options = {}) {
  if (!content) throw new Error('schedulePost: content is required');
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error('schedulePost: platforms must be a non-empty array');
  }
  if (!scheduledFor) throw new Error('schedulePost: scheduledFor is required');
  if (!timezone) throw new Error('schedulePost: timezone is required');

  const normalizedPlatforms = normalizePlatforms(platforms);
  if (normalizedPlatforms.length === 0 || normalizedPlatforms.some((entry) => !entry.platform || !entry.accountId)) {
    throw new Error('schedulePost: each platform entry requires platform and accountId');
  }

  content = tagUrlsInText(content, options.utm || ZERNIO_UTM);

  // Per-platform char-limit guard — same reasoning as publishPost.
  const { valid: withinLimit, rejected: overLimit } = validateContentForPlatforms(content, normalizedPlatforms);
  for (const r of overLimit) {
    console.error(
      `[zernio:publisher] BLOCKED ${r.platform} schedule — content ${r.length} chars exceeds ${r.limit} by ${r.overBy}`,
    );
  }
  if (withinLimit.length === 0) {
    return {
      blocked: true,
      reasons: overLimit.map((r) => ({
        reason: 'platform_char_limit_exceeded',
        platform: r.platform,
        limit: r.limit,
        length: r.length,
        overBy: r.overBy,
      })),
    };
  }

  // Dedup: filter out platforms where identical content was scheduled in last 24h
  const dedupedPlatforms = withinLimit.filter((p) => {
    if (isDuplicate(content, p.platform)) {
      console.log(`[zernio:publisher] SKIPPED ${p.platform} schedule — duplicate content within 24h`);
      return false;
    }
    return true;
  }).map(({ platform, accountId }) => ({ platform, accountId }));

  if (dedupedPlatforms.length === 0) {
    console.log('[zernio:publisher] All platforms skipped (duplicate content)');
    return { blocked: true, reasons: [{ reason: 'duplicate_content_all_platforms' }] };
  }

  console.log(`[zernio:publisher] Scheduling post for ${scheduledFor} (${timezone}) to ${dedupedPlatforms.length} platform(s)`);

  // Include scheduledFor + timezone in the key so that two schedules of the
  // same content at different times get distinct idempotency slots.
  const scheduleKey = idempotencyKey('zernio.schedulePost', content, dedupedPlatforms, scheduledFor, timezone);

  const json = await runStep('zernio.schedulePost', {
    retries: 3,
    // Strip CR/LF from user-controlled error text to prevent log forging (S5145).
    logger: (msg) => console.warn(String(msg).replace(/[\r\n]+/g, ' ')),
  }, async () => zernioFetch('POST', '/posts', {
    content,
    firstComment: options.firstComment,
    mediaItems: options.mediaItems,
    publishNow: false,
    platforms: dedupedPlatforms,
    scheduledFor,
    timezone,
  }, { idempotencyKey: scheduleKey }));

  const data = normalizePostResult(json);
  for (const p of dedupedPlatforms) {
    recordPost(content, p.platform);
  }
  console.log(`[zernio:publisher] Post scheduled. id=${data.id ?? 'unknown'}`);
  return data;
}

/**
 * Fetches all connected platform accounts from Zernio.
 * @returns {Promise<Array<{platform: string, accountId: string, name: string}>>}
 */
async function getConnectedAccounts() {
  console.log('[zernio:publisher] Fetching connected accounts');

  const json = await zernioFetch('GET', '/accounts');
  const accounts = (Array.isArray(json) ? json : (json.data ?? json.accounts ?? []))
    .map(normalizeAccount)
    .filter((account) => account && account.platform && account.accountId);

  console.log(`[zernio:publisher] ${accounts.length} connected account(s) found`);
  return accounts;
}

/**
 * Publishes a post to all connected Zernio accounts in one call.
 * @param {string} content
 * @returns {Promise<{ published: object[], errors: object[] }>}
 */
async function publishToAllPlatforms(content, options = {}) {
  if (!content) throw new Error('publishToAllPlatforms: content is required');

  console.log('[zernio:publisher] Fetching all connected accounts for bulk publish');
  const accounts = await getConnectedAccounts();

  if (accounts.length === 0) {
    console.warn('[zernio:publisher] No connected accounts found — nothing to publish');
    return { published: [], errors: [] };
  }

  const published = [];
  const errors = [];
  const requestedPlatforms = Array.isArray(options.platforms) && options.platforms.length > 0
    ? new Set(options.platforms.map((platform) => String(platform || '').trim()).filter(Boolean))
    : null;
  const groupedAccounts = groupAccountsByPlatform(accounts);

  for (const [platform, platformAccounts] of groupedAccounts.entries()) {
    if (requestedPlatforms && !requestedPlatforms.has(platform)) {
      continue;
    }

    try {
      const result = await publishPost(content, platformAccounts, {
        utm: {
          source: platform,
          medium: options.medium || ZERNIO_UTM.medium,
          campaign: options.campaign || ZERNIO_UTM.campaign,
        },
      });
      published.push({ platform, result });
    } catch (err) {
      console.error(`[zernio:publisher] Bulk publish failed for ${platform}: ${err.message}`);
      errors.push({ error: err.message, platform });
    }
  }

  console.log(`[zernio:publisher] Bulk publish complete. published=${published.length} errors=${errors.length}`);
  return { published, errors };
}

module.exports = {
  buildDedupKey,
  deletePost,
  isDuplicate,
  isZernioQuotaError,
  listPosts,
  ZernioQuotaError,
  publishPost,
  recordPost,
  schedulePost,
  publishToAllPlatforms,
  getConnectedAccounts,
  groupAccountsByPlatform,
  inferContentType,
  inferMediaType,
  normalizeAccount,
  normalizePlatforms,
  normalizePostResult,
  requestMediaPresign,
  resolveAccountId,
  uploadLocalMedia,
};

if (require.main === module) {
  const args = process.argv.slice(2);

  function getArg(flag) {
    const prefix = `${flag}=`;
    const entry = args.find((a) => a.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }

  const text = getArg('--text');
  const schedule = getArg('--schedule');
  const timezone = getArg('--timezone') || 'UTC';

  if (!text) {
    console.error('Usage: node zernio.js --text="..." [--schedule="2026-04-01T10:00:00Z" --timezone="America/New_York"]');
    process.exit(1);
  }

  (async () => {
    try {
      if (schedule) {
        const accounts = await getConnectedAccounts();
        const platforms = accounts.map((a) => ({ platform: a.platform, accountId: a.accountId }));
        const result = await schedulePost(text, platforms, schedule, timezone);
        console.log(`[zernio:publisher] Scheduled. id=${result.id ?? 'unknown'}`);
      } else {
        const result = await publishToAllPlatforms(text);
        console.log(`[zernio:publisher] Done. published=${result.published.length} errors=${result.errors.length}`);
      }
    } catch (err) {
      console.error('[zernio:publisher] Failed:', err.message);
      process.exit(1);
    }
  })();
}
