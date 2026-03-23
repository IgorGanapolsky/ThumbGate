'use strict';

/**
 * zernio.js
 * Unified publisher via Zernio API.
 *
 * Required env vars:
 *   ZERNIO_API_KEY — Bearer token for https://zernio.com/api/v1
 */

const ZERNIO_BASE = 'https://zernio.com/api/v1';

function requireApiKey() {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) {
    throw new Error('ZERNIO_API_KEY environment variable is required');
  }
  return key;
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

/**
 * Publishes a post immediately to one or more platforms.
 * @param {string} content
 * @param {Array<{platform: string, accountId: string}>} platforms
 * @returns {Promise<object>}
 */
async function publishPost(content, platforms) {
  if (!content) throw new Error('publishPost: content is required');
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error('publishPost: platforms must be a non-empty array');
  }

  console.log(`[zernio:publisher] Publishing to ${platforms.length} platform(s): ${platforms.map((p) => p.platform).join(', ')}`);

  const json = await zernioFetch('POST', '/posts', {
    content,
    publishNow: true,
    platforms,
  });

  const data = json.data ?? json;
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
async function schedulePost(content, platforms, scheduledFor, timezone) {
  if (!content) throw new Error('schedulePost: content is required');
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error('schedulePost: platforms must be a non-empty array');
  }
  if (!scheduledFor) throw new Error('schedulePost: scheduledFor is required');
  if (!timezone) throw new Error('schedulePost: timezone is required');

  console.log(`[zernio:publisher] Scheduling post for ${scheduledFor} (${timezone}) to ${platforms.length} platform(s)`);

  const json = await zernioFetch('POST', '/posts', {
    content,
    publishNow: false,
    platforms,
    scheduledFor,
    timezone,
  });

  const data = json.data ?? json;
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
  const accounts = Array.isArray(json) ? json : (json.data ?? json.accounts ?? []);

  console.log(`[zernio:publisher] ${accounts.length} connected account(s) found`);
  return accounts;
}

/**
 * Publishes a post to all connected Zernio accounts in one call.
 * @param {string} content
 * @returns {Promise<{ published: object[], errors: object[] }>}
 */
async function publishToAllPlatforms(content) {
  if (!content) throw new Error('publishToAllPlatforms: content is required');

  console.log('[zernio:publisher] Fetching all connected accounts for bulk publish');
  const accounts = await getConnectedAccounts();

  if (accounts.length === 0) {
    console.warn('[zernio:publisher] No connected accounts found — nothing to publish');
    return { published: [], errors: [] };
  }

  const platforms = accounts.map((acc) => ({
    platform: acc.platform,
    accountId: acc.accountId,
  }));

  const published = [];
  const errors = [];

  try {
    const result = await publishPost(content, platforms);
    published.push(result);
  } catch (err) {
    console.error(`[zernio:publisher] Bulk publish failed: ${err.message}`);
    errors.push({ error: err.message, platforms: platforms.map((p) => p.platform) });
  }

  console.log(`[zernio:publisher] Bulk publish complete. published=${published.length} errors=${errors.length}`);
  return { published, errors };
}

module.exports = {
  publishPost,
  schedulePost,
  publishToAllPlatforms,
  getConnectedAccounts,
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
