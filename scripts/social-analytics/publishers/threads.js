'use strict';

/**
 * Threads post publisher using the Threads API (Meta, launched June 2024).
 *
 * Publishing flow:
 *   1. Create a media container (TEXT, IMAGE, or CAROUSEL).
 *   2. Publish the container via threads_publish.
 *
 * For carousels:
 *   1. Create child containers for each item (IMAGE).
 *   2. Create a CAROUSEL parent container referencing the child IDs.
 *   3. Publish the parent container.
 *
 * Required environment variables:
 *   THREADS_ACCESS_TOKEN — long-lived Threads user access token
 *   THREADS_USER_ID      — Threads user ID (numeric string)
 *
 * Handle: @igor.ganapolsky
 */

const THREADS_BASE = 'https://graph.threads.net/v1.0';

/**
 * Creates a Threads media container.
 *
 * @param {string} token  - Threads access token.
 * @param {string} userId - Threads user ID.
 * @param {object} opts
 * @param {string}  opts.text            - Post text content.
 * @param {string}  [opts.mediaType]     - 'TEXT' (default), 'IMAGE', or 'CAROUSEL'.
 * @param {string}  [opts.imageUrl]      - Public HTTPS URL of image (required for IMAGE type).
 * @param {string}  [opts.linkAttachment] - URL to attach as a link preview (TEXT posts only).
 * @returns {Promise<string>} The container ID returned by the API.
 */
async function createThreadContainer(token, userId, { text, mediaType, imageUrl, linkAttachment } = {}) {
  const resolvedMediaType = (mediaType ?? 'TEXT').toUpperCase();

  console.log(`[threads:publisher] Creating ${resolvedMediaType} container…`);

  const params = new URLSearchParams({
    media_type: resolvedMediaType,
    access_token: token,
  });

  if (text) params.set('text', text);
  if (resolvedMediaType === 'IMAGE' && imageUrl) params.set('image_url', imageUrl);
  if (resolvedMediaType === 'TEXT' && linkAttachment) params.set('link_attachment', linkAttachment);

  const res = await fetch(`${THREADS_BASE}/${userId}/threads`, {
    method: 'POST',
    body: params,
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `createThreadContainer failed (HTTP ${res.status}): ${JSON.stringify(json.error ?? json)}`
    );
  }

  console.log(`[threads:publisher] Container created: ${json.id}`);
  return json.id;
}

/**
 * Publishes a finalised Threads media container.
 *
 * @param {string} token       - Threads access token.
 * @param {string} userId      - Threads user ID.
 * @param {string} containerId - ID of the container to publish.
 * @returns {Promise<string>} The published thread ID.
 */
async function publishThread(token, userId, containerId) {
  console.log(
    `[threads:publisher] Publishing container ${containerId}…`
  );

  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
  });

  const res = await fetch(`${THREADS_BASE}/${userId}/threads_publish`, {
    method: 'POST',
    body: params,
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `publishThread failed (HTTP ${res.status}): ${JSON.stringify(json.error ?? json)}`
    );
  }

  console.log(`[threads:publisher] Published thread ID: ${json.id}`);
  return json.id;
}

/**
 * Creates and publishes a Threads carousel post.
 *
 * Multi-step flow:
 *   1. Create child IMAGE containers for each item.
 *   2. Create a CAROUSEL parent container referencing all child IDs.
 *   3. Publish the parent container.
 *
 * @param {string} token  - Threads access token.
 * @param {string} userId - Threads user ID.
 * @param {object} opts
 * @param {string}   opts.text  - Caption for the carousel.
 * @param {object[]} opts.items - Array of { imageUrl, text } for each slide.
 * @returns {Promise<string>} The published thread ID.
 */
async function createCarouselThread(token, userId, { text, items }) {
  if (!items || items.length < 2) {
    throw new Error('createCarouselThread requires at least 2 items');
  }
  if (items.length > 20) {
    throw new Error('Threads carousels support a maximum of 20 items');
  }

  console.log(
    `[threads:publisher] Creating carousel thread with ${items.length} items…`
  );

  // Step 1: Create child containers for each item.
  const childIds = [];
  for (const item of items) {
    const childParams = new URLSearchParams({
      media_type: 'IMAGE',
      is_carousel_item: 'true',
      access_token: token,
    });
    if (item.imageUrl) childParams.set('image_url', item.imageUrl);
    if (item.text) childParams.set('text', item.text);

    const childRes = await fetch(`${THREADS_BASE}/${userId}/threads`, {
      method: 'POST',
      body: childParams,
    });
    const childJson = await childRes.json();

    if (!childRes.ok || childJson.error) {
      throw new Error(
        `createCarouselThread child failed (HTTP ${childRes.status}): ${JSON.stringify(childJson.error ?? childJson)}`
      );
    }

    console.log(`[threads:publisher] Child container created: ${childJson.id}`);
    childIds.push(childJson.id);
  }

  // Step 2: Create the CAROUSEL parent container.
  const parentParams = new URLSearchParams({
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    access_token: token,
  });
  if (text) parentParams.set('text', text);

  const parentRes = await fetch(`${THREADS_BASE}/${userId}/threads`, {
    method: 'POST',
    body: parentParams,
  });
  const parentJson = await parentRes.json();

  if (!parentRes.ok || parentJson.error) {
    throw new Error(
      `createCarouselThread parent failed (HTTP ${parentRes.status}): ${JSON.stringify(parentJson.error ?? parentJson)}`
    );
  }

  console.log(`[threads:publisher] Carousel parent container created: ${parentJson.id}`);

  // Step 3: Publish the parent container.
  const publishedId = await publishThread(token, userId, parentJson.id);

  console.log(`[threads:publisher] Carousel thread published: ${publishedId}`);
  return publishedId;
}

/**
 * Convenience: creates and publishes a plain-text Threads post.
 *
 * @param {object} opts
 * @param {string} opts.text   - Post text content.
 * @param {string} opts.token  - Threads access token (defaults to env var).
 * @param {string} opts.userId - Threads user ID (defaults to env var).
 * @returns {Promise<string>} The published thread ID.
 */
async function postTextThread({ text, token, userId }) {
  const resolvedToken = token ?? process.env.THREADS_ACCESS_TOKEN;
  const resolvedUserId = userId ?? process.env.THREADS_USER_ID;

  if (!resolvedToken) throw new Error('THREADS_ACCESS_TOKEN is not set');
  if (!resolvedUserId) throw new Error('THREADS_USER_ID is not set');
  if (!text) throw new Error('postTextThread: text is required');

  const containerId = await createThreadContainer(resolvedToken, resolvedUserId, {
    text,
    mediaType: 'TEXT',
  });
  return publishThread(resolvedToken, resolvedUserId, containerId);
}

/**
 * Convenience: creates and publishes a Threads post with an image.
 *
 * @param {object} opts
 * @param {string} opts.text     - Post text content.
 * @param {string} opts.imageUrl - Public HTTPS URL of the image.
 * @param {string} opts.token    - Threads access token (defaults to env var).
 * @param {string} opts.userId   - Threads user ID (defaults to env var).
 * @returns {Promise<string>} The published thread ID.
 */
async function postImageThread({ text, imageUrl, token, userId }) {
  const resolvedToken = token ?? process.env.THREADS_ACCESS_TOKEN;
  const resolvedUserId = userId ?? process.env.THREADS_USER_ID;

  if (!resolvedToken) throw new Error('THREADS_ACCESS_TOKEN is not set');
  if (!resolvedUserId) throw new Error('THREADS_USER_ID is not set');
  if (!imageUrl) throw new Error('postImageThread: imageUrl is required');

  const containerId = await createThreadContainer(resolvedToken, resolvedUserId, {
    text,
    mediaType: 'IMAGE',
    imageUrl,
  });
  return publishThread(resolvedToken, resolvedUserId, containerId);
}

module.exports = {
  createThreadContainer,
  publishThread,
  createCarouselThread,
  postTextThread,
  postImageThread,
};

// Allow running directly:
//   node scripts/social-analytics/publishers/threads.js --text "Hello Threads!"
//   node scripts/social-analytics/publishers/threads.js --text "Check this out" --image "https://example.com/img.jpg"
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const get = (flag) => {
      const idx = args.indexOf(flag);
      return idx !== -1 ? args[idx + 1] : null;
    };

    const text = get('--text');
    const image = get('--image');

    if (!text) {
      console.error('Usage: node threads.js --text "..." [--image "https://..."]');
      process.exit(1);
    }

    try {
      let publishedId;
      if (image) {
        publishedId = await postImageThread({ text, imageUrl: image });
      } else {
        publishedId = await postTextThread({ text });
      }
      console.log(`[threads:publisher] Success. Published thread ID: ${publishedId}`);
    } catch (err) {
      console.error('[threads:publisher] Fatal error:', err.message);
      process.exit(1);
    }
  })();
}
