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

const ZERNIO_UTM = { source: 'zernio', medium: 'social', campaign: 'organic' };

/** Per-platform character limits. Platforms not listed have no enforced limit. */
const PLATFORM_CHAR_LIMITS = {
  bluesky: 300,
  x: 280,
  twitter: 280,
  threads: 500,
  mastodon: 500,
};

/**
 * Check content length against platform limits.
 * Returns platforms that would exceed the limit.
 * @param {string} content
 * @param {Array<{platform: string}>} platforms
 * @returns {Array<{platform: string, limit: number, length: number}>}
 */
function checkPlatformCharLimits(content, platforms) {
  const violations = [];
  const contentLength = content.length;
  for (const p of platforms) {
    const limit = PLATFORM_CHAR_LIMITS[p.platform.toLowerCase()];
    if (limit && contentLength > limit) {
      violations.push({ platform: p.platform, limit, length: contentLength });
    }
  }
  return violations;
}

const ZERNIO_BASE = 'https://zernio.com/api/v1';
const DEFAULT_DEDUP_LOG_PATH = path.join(__dirname, '..', '..', '..', '.thumbgate', 'zernio-dedup-log.json');

loadLocalEnv();

/**
 * Content-hash dedup: prevents the same content from being posted to the same
 * platform twice within a 24-hour window.
 */
function getDedupLogPath() {
  return process.env.THUMBGATE_DEDUP_LOG_PATH || DEFAULT_DEDUP_LOG_PATH;
}

function buildDedupKey(content, platform) {
  const hash = crypto.createHash('sha256').update(content.trim()).digest('hex').slice(0, 16);
  return `${platform}::${hash}`;
}

function loadDedupLog() {
  const logPath = getDedupLogPath();
  try {
    if (fs.existsSync(logPath)) {
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
  } catch { /* ignore corrupt log */ }
  return {};
}

function saveDedupLog(log) {
  const logPath = getDedupLogPath();
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
}

function isDuplicate(content, platform) {
  const log = loadDedupLog();
  const key = buildDedupKey(content, platform);
  const entry = log[key];
  if (!entry) return false;
  const ageMs = Date.now() - new Date(entry.postedAt).getTime();
  return ageMs < 24 * 60 * 60 * 1000; // 24-hour dedup window
}

function recordPost(content, platform) {
  const log = loadDedupLog();
  const key = buildDedupKey(content, platform);
  log[key] = { platform, postedAt: new Date().toISOString() };
  // Prune entries older than 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
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

async function zernioFetch(method, endpoint, body = null) {
  const apiKey = requireApiKey();
  const url = `${ZERNIO_BASE}${endpoint}`;

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };

  if (body !== null) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    const payload = parseZernioErrorText(errorText);
    if (isZernioQuotaPayload(res.status, payload, errorText)) {
      throw new ZernioQuotaError(payload?.error || 'Zernio post limit reached', {
        billingPeriod: payload?.billingPeriod,
        current: Number(payload?.current),
        endpoint,
        limit: Number(payload?.limit),
        method,
        planName: payload?.planName,
        status: res.status,
      });
    }
    throw new Error(`Zernio API ${res.status} for ${method} ${endpoint}: ${errorText}`);
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

  // Character limit check: reject platforms that would exceed their limit
  const charViolations = checkPlatformCharLimits(content, normalizedPlatforms);
  if (charViolations.length > 0) {
    for (const v of charViolations) {
      console.error(`[zernio:publisher] BLOCKED ${v.platform} — ${v.length} chars exceeds ${v.limit} limit`);
    }
    const violatedNames = new Set(charViolations.map((v) => v.platform.toLowerCase()));
    const safePlatforms = normalizedPlatforms.filter((p) => !violatedNames.has(p.platform.toLowerCase()));
    if (safePlatforms.length === 0) {
      return { blocked: true, reasons: charViolations.map((v) => ({ reason: `${v.platform}: ${v.length}/${v.limit} chars` })) };
    }
    // Continue with platforms that fit
    normalizedPlatforms.length = 0;
    normalizedPlatforms.push(...safePlatforms);
  }

  // Dedup: filter out platforms where identical content was posted in last 24h
  const dedupedPlatforms = normalizedPlatforms.filter((p) => {
    if (isDuplicate(content, p.platform)) {
      console.log(`[zernio:publisher] SKIPPED ${p.platform} — duplicate content within 24h`);
      return false;
    }
    return true;
  });

  if (dedupedPlatforms.length === 0) {
    console.log('[zernio:publisher] All platforms skipped (duplicate content)');
    return { blocked: true, reasons: [{ reason: 'duplicate_content_all_platforms' }] };
  }

  console.log(`[zernio:publisher] Publishing to ${dedupedPlatforms.length} platform(s): ${dedupedPlatforms.map((p) => p.platform).join(', ')}`);

  const json = await zernioFetch('POST', '/posts', {
    content,
    firstComment: options.firstComment,
    mediaItems: options.mediaItems,
    publishNow: true,
    platforms: dedupedPlatforms,
  });

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

  // Character limit check: reject platforms that would exceed their limit
  const charViolations = checkPlatformCharLimits(content, normalizedPlatforms);
  if (charViolations.length > 0) {
    for (const v of charViolations) {
      console.error(`[zernio:publisher] BLOCKED ${v.platform} schedule — ${v.length} chars exceeds ${v.limit} limit`);
    }
    const violatedNames = new Set(charViolations.map((v) => v.platform.toLowerCase()));
    const safePlatforms = normalizedPlatforms.filter((p) => !violatedNames.has(p.platform.toLowerCase()));
    if (safePlatforms.length === 0) {
      return { blocked: true, reasons: charViolations.map((v) => ({ reason: `${v.platform}: ${v.length}/${v.limit} chars` })) };
    }
    normalizedPlatforms.length = 0;
    normalizedPlatforms.push(...safePlatforms);
  }

  // Dedup: filter out platforms where identical content was scheduled in last 24h
  const dedupedPlatforms = normalizedPlatforms.filter((p) => {
    if (isDuplicate(content, p.platform)) {
      console.log(`[zernio:publisher] SKIPPED ${p.platform} schedule — duplicate content within 24h`);
      return false;
    }
    return true;
  });

  if (dedupedPlatforms.length === 0) {
    console.log('[zernio:publisher] All platforms skipped (duplicate content)');
    return { blocked: true, reasons: [{ reason: 'duplicate_content_all_platforms' }] };
  }

  console.log(`[zernio:publisher] Scheduling post for ${scheduledFor} (${timezone}) to ${dedupedPlatforms.length} platform(s)`);

  const json = await zernioFetch('POST', '/posts', {
    content,
    firstComment: options.firstComment,
    mediaItems: options.mediaItems,
    publishNow: false,
    platforms: dedupedPlatforms,
    scheduledFor,
    timezone,
  });

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
