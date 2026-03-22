'use strict';

/**
 * tiktok.js
 * Publishes videos to TikTok via the official Content Posting API v2.
 *
 * Required env vars:
 *   TIKTOK_ACCESS_TOKEN  — OAuth 2.0 access token with post.publish scope (required)
 *
 * TikTok API reference:
 *   POST /v2/post/publish/video/init/         — Initiate a direct post
 *   POST /v2/post/publish/status/fetch/       — Poll publish status
 */

const TIKTOK_API_BASE = 'https://open.tiktokapis.com';

const POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Initiate a TikTok video post via URL pull.
 *
 * @param {string} token - TikTok OAuth access token
 * @param {{ title: string, videoUrl: string, privacyLevel?: string }} options
 * @returns {Promise<string>} publish_id
 */
async function initDirectPost(token, { title, videoUrl, privacyLevel }) {
  if (!token) throw new Error('token is required');
  if (!videoUrl) throw new Error('videoUrl is required');
  if (!title) throw new Error('title is required');

  const url = `${TIKTOK_API_BASE}/v2/post/publish/video/init/`;
  const body = {
    post_info: {
      title,
      privacy_level: privacyLevel || 'PUBLIC_TO_EVERYONE',
    },
    source_info: {
      source: 'PULL_FROM_URL',
      video_url: videoUrl,
    },
  };

  console.log(`[tiktok:publisher] Initiating post: title="${title}" url=${videoUrl}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TikTok API ${res.status} for ${url}: ${text}`);
  }

  const json = await res.json();

  if (json.error && json.error.code !== 'ok') {
    throw new Error(`TikTok API error: ${json.error.code} — ${json.error.message}`);
  }

  const publishId = json.data?.publish_id;
  if (!publishId) {
    throw new Error(`TikTok init post returned no publish_id. Response: ${JSON.stringify(json)}`);
  }

  console.log(`[tiktok:publisher] Post initiated. publish_id=${publishId}`);
  return publishId;
}

/**
 * Check the publish status of a previously initiated post.
 *
 * @param {string} token - TikTok OAuth access token
 * @param {string} publishId - publish_id returned from initDirectPost
 * @returns {Promise<object>} Status object from TikTok API
 */
async function checkPublishStatus(token, publishId) {
  if (!token) throw new Error('token is required');
  if (!publishId) throw new Error('publishId is required');

  const url = `${TIKTOK_API_BASE}/v2/post/publish/status/fetch/`;
  const body = { publish_id: publishId };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TikTok API ${res.status} for ${url}: ${text}`);
  }

  const json = await res.json();

  if (json.error && json.error.code !== 'ok') {
    throw new Error(`TikTok API error: ${json.error.code} — ${json.error.message}`);
  }

  return json.data ?? {};
}

/**
 * Poll publish status every 5 seconds until PUBLISH_COMPLETE or a terminal failure.
 * Rejects if the timeout is reached before completion.
 *
 * @param {string} token - TikTok OAuth access token
 * @param {string} publishId - publish_id to poll
 * @param {number} [timeoutMs=120000] - Maximum wait time in milliseconds
 * @returns {Promise<object>} Final status object
 */
async function pollPublishStatus(token, publishId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!token) throw new Error('token is required');
  if (!publishId) throw new Error('publishId is required');

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  console.log(`[tiktok:publisher] Polling publish status for publish_id=${publishId} (timeout=${timeoutMs}ms)`);

  while (Date.now() < deadline) {
    attempt += 1;
    const statusData = await checkPublishStatus(token, publishId);
    const status = statusData.status ?? statusData.publish_status ?? 'UNKNOWN';

    console.log(`[tiktok:publisher] Attempt ${attempt}: status=${status}`);

    if (status === 'PUBLISH_COMPLETE') {
      console.log(`[tiktok:publisher] Video published successfully. publish_id=${publishId}`);
      return statusData;
    }

    // Terminal failure states reported by the TikTok API.
    const failureStates = ['FAILED', 'PUBLISH_FAILED', 'CANCELLED', 'ERROR'];
    if (failureStates.includes(status)) {
      throw new Error(
        `TikTok publish failed with status=${status}. publish_id=${publishId}. ` +
          `Data: ${JSON.stringify(statusData)}`
      );
    }

    // Not done yet — wait before the next poll.
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `TikTok publish timed out after ${timeoutMs}ms. publish_id=${publishId} ` +
      `— video may still be processing.`
  );
}

/**
 * Orchestrates the full TikTok video publish flow:
 *   1. Initiate post via URL pull
 *   2. Poll until PUBLISH_COMPLETE
 *
 * @param {{ videoUrl: string, title: string, token?: string, privacyLevel?: string }} options
 * @returns {Promise<{ publishId: string, status: object }>}
 */
async function publishTikTokVideo({ videoUrl, title, token, privacyLevel }) {
  const accessToken = token || process.env.TIKTOK_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('TIKTOK_ACCESS_TOKEN environment variable (or token param) is required');
  }
  if (!videoUrl) throw new Error('videoUrl is required');
  if (!title) throw new Error('title is required');

  console.log(`[tiktok:publisher] Starting publish flow for "${title}"`);

  const publishId = await initDirectPost(accessToken, { title, videoUrl, privacyLevel });
  const statusResult = await pollPublishStatus(accessToken, publishId);

  console.log(`[tiktok:publisher] Publish complete. publish_id=${publishId}`);
  return { publishId, status: statusResult };
}

module.exports = { initDirectPost, checkPublishStatus, pollPublishStatus, publishTikTokVideo };

// ---------------------------------------------------------------------------
// Stand-alone execution
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);

  // Parse --video-url and --title from CLI args.
  function getArg(flag) {
    const prefix = `${flag}=`;
    const entry = args.find((a) => a.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }

  const videoUrl = getArg('--video-url');
  const title = getArg('--title');

  if (!videoUrl || !title) {
    console.error('Usage: node tiktok.js --video-url=<url> --title=<title>');
    process.exit(1);
  }

  publishTikTokVideo({ videoUrl, title })
    .then(({ publishId, status }) => {
      console.log(`[tiktok:publisher] Done. publish_id=${publishId} status=${JSON.stringify(status)}`);
    })
    .catch((err) => {
      console.error('[tiktok:publisher] Publish failed:', err.message);
      process.exit(1);
    });
}
