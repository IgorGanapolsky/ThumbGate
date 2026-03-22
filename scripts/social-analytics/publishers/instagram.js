'use strict';

/**
 * Instagram carousel publisher using the Instagram Graph API v21.0.
 *
 * Replaces the Playwright-based approach with a fully headless API workflow:
 *   1. Create container items for each image (carousel children).
 *   2. Poll each child container until FINISHED.
 *   3. Create a carousel parent container referencing the child IDs.
 *   4. Poll the parent container until FINISHED.
 *   5. Publish the parent container to the feed.
 *
 * Required environment variables:
 *   INSTAGRAM_ACCESS_TOKEN  — long-lived page/user access token
 *   INSTAGRAM_USER_ID       — Instagram business/creator account user ID
 *   R2_PUBLIC_URL           — base URL for publicly accessible hosted images
 *                             (e.g. https://pub-abc123.r2.dev/instagram)
 */

const path = require('path');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

// Default polling configuration.
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Returns the public URL for a locally staged image file.
 *
 * NOTE: This is a placeholder. Wire in the Cloudflare R2 SDK (or AWS S3 SDK)
 * to actually upload `localPath` to the bucket and return the resulting URL.
 * For now we assume the file has already been staged at the public base URL.
 *
 * @param {string} localPath - Absolute or relative path to the image file.
 * @returns {string} Publicly accessible HTTPS URL.
 */
function uploadImageToR2(localPath) {
  const r2Base = process.env.R2_PUBLIC_URL;
  if (!r2Base) throw new Error('R2_PUBLIC_URL is not set');

  const filename = path.basename(localPath);
  // TODO: Replace with actual R2/S3 upload using the AWS SDK v3 or
  //       @cloudflare/workers-types + fetch upload. Return the resulting URL.
  return `${r2Base}/${filename}`;
}

/**
 * Creates a single carousel child media container on the Graph API.
 *
 * @param {string}  token    - Instagram access token.
 * @param {string}  userId   - Instagram user ID.
 * @param {string}  imageUrl - Public HTTPS URL of the image (or video).
 * @param {boolean} [isVideo=false] - If true, treats the URL as a video_url.
 * @returns {Promise<string>} The container ID returned by the API.
 */
async function createCarouselChild(token, userId, imageUrl, isVideo = false) {
  console.log(
    `[instagram:publisher] Creating carousel child — ${isVideo ? 'video' : 'image'}: ${imageUrl}`
  );

  const body = new URLSearchParams({
    is_carousel_item: 'true',
    access_token: token,
    ...(isVideo ? { video_url: imageUrl } : { image_url: imageUrl }),
  });

  const res = await fetch(`${GRAPH_BASE}/${userId}/media`, {
    method: 'POST',
    body,
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `createCarouselChild failed (HTTP ${res.status}): ${JSON.stringify(json.error ?? json)}`
    );
  }

  console.log(`[instagram:publisher] Child container created: ${json.id}`);
  return json.id;
}

/**
 * Polls a media container until its status_code is FINISHED or ERROR.
 *
 * @param {string} token       - Instagram access token.
 * @param {string} containerId - ID of the container to poll.
 * @param {number} [timeoutMs] - Max milliseconds to wait (default 120 000).
 * @returns {Promise<void>} Resolves when FINISHED; rejects on ERROR or timeout.
 */
async function pollContainerStatus(token, containerId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  console.log(`[instagram:publisher] Polling container ${containerId}…`);

  while (Date.now() < deadline) {
    const url =
      `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${token}`;

    const res = await fetch(url);
    const json = await res.json();

    if (!res.ok || json.error) {
      throw new Error(
        `pollContainerStatus HTTP ${res.status}: ${JSON.stringify(json.error ?? json)}`
      );
    }

    const status = json.status_code;
    console.log(`[instagram:publisher] Container ${containerId} status: ${status}`);

    if (status === 'FINISHED') return;
    if (status === 'ERROR') {
      throw new Error(
        `Container ${containerId} entered ERROR state. Check media URL validity and permissions.`
      );
    }

    // Status is IN_PROGRESS or PUBLISHED — keep waiting.
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }

  throw new Error(
    `pollContainerStatus timed out after ${timeoutMs}ms for container ${containerId}`
  );
}

/**
 * Creates the carousel parent container referencing the given child IDs.
 *
 * @param {string}   token    - Instagram access token.
 * @param {string}   userId   - Instagram user ID.
 * @param {string[]} childIds - Ordered list of child container IDs.
 * @param {string}   caption  - Post caption (hashtags included here).
 * @returns {Promise<string>} The parent container ID.
 */
async function createCarouselParent(token, userId, childIds, caption) {
  console.log(
    `[instagram:publisher] Creating carousel parent with ${childIds.length} children…`
  );

  const body = new URLSearchParams({
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
    access_token: token,
  });

  const res = await fetch(`${GRAPH_BASE}/${userId}/media`, {
    method: 'POST',
    body,
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `createCarouselParent failed (HTTP ${res.status}): ${JSON.stringify(json.error ?? json)}`
    );
  }

  console.log(`[instagram:publisher] Parent container created: ${json.id}`);
  return json.id;
}

/**
 * Publishes a finalised container to the Instagram feed.
 *
 * @param {string} token       - Instagram access token.
 * @param {string} userId      - Instagram user ID.
 * @param {string} containerId - ID of the FINISHED parent container.
 * @returns {Promise<string>} The published media ID.
 */
async function publishContainer(token, userId, containerId) {
  console.log(
    `[instagram:publisher] Publishing container ${containerId} for user ${userId}…`
  );

  const body = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
  });

  const res = await fetch(`${GRAPH_BASE}/${userId}/media_publish`, {
    method: 'POST',
    body,
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `publishContainer failed (HTTP ${res.status}): ${JSON.stringify(json.error ?? json)}`
    );
  }

  console.log(`[instagram:publisher] Published media ID: ${json.id}`);
  return json.id;
}

/**
 * Fetches the permalink of a published post by media ID.
 *
 * @param {string} token   - Instagram access token.
 * @param {string} mediaId - ID of the published post.
 * @returns {Promise<string|null>} The permalink URL, or null if unavailable.
 */
async function fetchPermalink(token, mediaId) {
  try {
    const url = `${GRAPH_BASE}/${mediaId}?fields=permalink&access_token=${token}`;
    const res = await fetch(url);
    const json = await res.json();
    return json.permalink ?? null;
  } catch {
    return null;
  }
}

/**
 * Orchestrates the full carousel publish flow end-to-end.
 *
 * @param {object}   opts
 * @param {string[]} opts.imageUrls - Ordered array of public HTTPS image URLs.
 * @param {string}   opts.caption   - Post caption (may include hashtags).
 * @param {string}   [opts.token]   - Access token (defaults to env var).
 * @param {string}   [opts.userId]  - User ID (defaults to env var).
 * @returns {Promise<{ id: string, permalink: string|null }>}
 */
async function publishCarousel({ imageUrls, caption, token, userId }) {
  const resolvedToken = token ?? process.env.INSTAGRAM_ACCESS_TOKEN;
  const resolvedUserId = userId ?? process.env.INSTAGRAM_USER_ID;

  if (!resolvedToken) throw new Error('INSTAGRAM_ACCESS_TOKEN is not set');
  if (!resolvedUserId) throw new Error('INSTAGRAM_USER_ID is not set');
  if (!imageUrls || imageUrls.length < 2) {
    throw new Error('publishCarousel requires at least 2 image URLs');
  }
  if (imageUrls.length > 10) {
    throw new Error('Instagram carousels support a maximum of 10 images');
  }

  // Step 1: Create child containers.
  console.log(`[instagram:publisher] Starting carousel publish — ${imageUrls.length} images`);
  const childIds = [];
  for (const imageUrl of imageUrls) {
    const childId = await createCarouselChild(resolvedToken, resolvedUserId, imageUrl, false);
    childIds.push(childId);
  }

  // Step 2: Poll each child until FINISHED.
  console.log('[instagram:publisher] Polling child containers…');
  for (const childId of childIds) {
    await pollContainerStatus(resolvedToken, childId);
  }

  // Step 3: Create the carousel parent container.
  const parentId = await createCarouselParent(
    resolvedToken,
    resolvedUserId,
    childIds,
    caption
  );

  // Step 4: Poll the parent until FINISHED.
  console.log('[instagram:publisher] Polling parent container…');
  await pollContainerStatus(resolvedToken, parentId);

  // Step 5: Publish.
  const publishedId = await publishContainer(resolvedToken, resolvedUserId, parentId);

  // Retrieve the permalink for the caller.
  const permalink = await fetchPermalink(resolvedToken, publishedId);

  console.log(`[instagram:publisher] Carousel live: ${permalink ?? publishedId}`);
  return { id: publishedId, permalink };
}

module.exports = {
  uploadImageToR2,
  createCarouselChild,
  pollContainerStatus,
  createCarouselParent,
  publishContainer,
  publishCarousel,
};

// Allow running directly:
//   node scripts/social-analytics/publishers/instagram.js \
//     --images "https://pub.r2.dev/img1.jpg,https://pub.r2.dev/img2.jpg" \
//     --caption "Your caption here #hashtag"
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const get = (flag) => {
      const idx = args.indexOf(flag);
      return idx !== -1 ? args[idx + 1] : null;
    };

    const imagesArg = get('--images');
    const caption = get('--caption') ?? '';

    if (!imagesArg) {
      console.error('Usage: node instagram.js --images "url1,url2,..." --caption "..."');
      process.exit(1);
    }

    const imageUrls = imagesArg.split(',').map((u) => u.trim()).filter(Boolean);

    try {
      const result = await publishCarousel({ imageUrls, caption });
      console.log('[instagram:publisher] Success:', JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('[instagram:publisher] Fatal error:', err.message);
      process.exit(1);
    }
  })();
}
