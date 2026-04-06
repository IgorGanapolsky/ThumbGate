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
const { tagUrlsInText } = require('../utm');
const { loadLocalEnv } = require('../load-env');

const ZERNIO_UTM = { source: 'zernio', medium: 'social', campaign: 'organic' };

const ZERNIO_BASE = 'https://zernio.com/api/v1';

loadLocalEnv();

function requireApiKey() {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) {
    throw new Error('ZERNIO_API_KEY environment variable is required');
  }
  return key;
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

  console.log(`[zernio:publisher] Publishing to ${normalizedPlatforms.length} platform(s): ${normalizedPlatforms.map((p) => p.platform).join(', ')}`);

  const json = await zernioFetch('POST', '/posts', {
    content,
    firstComment: options.firstComment,
    mediaItems: options.mediaItems,
    publishNow: true,
    platforms: normalizedPlatforms,
  });

  const data = normalizePostResult(json);
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

  console.log(`[zernio:publisher] Scheduling post for ${scheduledFor} (${timezone}) to ${normalizedPlatforms.length} platform(s)`);

  const json = await zernioFetch('POST', '/posts', {
    content,
    firstComment: options.firstComment,
    mediaItems: options.mediaItems,
    publishNow: false,
    platforms: normalizedPlatforms,
    scheduledFor,
    timezone,
  });

  const data = normalizePostResult(json);
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
  deletePost,
  listPosts,
  publishPost,
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
