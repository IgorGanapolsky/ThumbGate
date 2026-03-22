'use strict';

/**
 * LinkedIn post publisher using the LinkedIn Posts API (LinkedIn-Version: 202401).
 *
 * Required environment variables:
 *   LINKEDIN_ACCESS_TOKEN  — OAuth 2.0 access token with w_member_social scope (required)
 *   LINKEDIN_PERSON_URN    — Authenticated member URN, e.g. urn:li:person:XXXXX (required)
 *
 * LinkedIn API references:
 *   Posts API:   https://api.linkedin.com/rest/posts
 *   Images API:  https://api.linkedin.com/rest/images?action=initializeUpload
 */

const LI_REST_BASE = 'https://api.linkedin.com/rest';

/**
 * Build standard headers for the LinkedIn Posts API.
 * @param {string} token
 * @returns {Record<string, string>}
 */
function buildHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': '202401',
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  };
}

/**
 * Publishes a plain text post to LinkedIn.
 *
 * @param {string} token     - LinkedIn OAuth access token (w_member_social scope required).
 * @param {string} personUrn - Author URN, e.g. "urn:li:person:XXXXX".
 * @param {string} text      - Post body text (commentary).
 * @returns {Promise<string>} The created post URN from the X-RestLi-Id response header.
 */
async function publishTextPost(token, personUrn, text) {
  if (!token) throw new Error('publishTextPost: token is required');
  if (!personUrn) throw new Error('publishTextPost: personUrn is required');
  if (!text) throw new Error('publishTextPost: text is required');

  const url = `${LI_REST_BASE}/posts`;
  const body = {
    author: personUrn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED' },
    lifecycleState: 'PUBLISHED',
  };

  console.log(`[linkedin:publisher] Publishing text post as ${personUrn}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`publishTextPost HTTP ${res.status}: ${errBody}`);
  }

  // LinkedIn returns the created post URN in the X-RestLi-Id header.
  const postUrn = res.headers.get('x-restli-id') ?? res.headers.get('X-RestLi-Id') ?? '';
  console.log(`[linkedin:publisher] Text post created. URN: ${postUrn}`);
  return postUrn;
}

/**
 * Publishes a post with image attachments to LinkedIn.
 *
 * LinkedIn requires a multi-step upload flow for images:
 *   1. POST /rest/images?action=initializeUpload  → get uploadUrl + image URN.
 *   2. PUT <uploadUrl> with raw image binary.
 *   3. POST /rest/posts with content.media referencing the image URN.
 *
 * NOTE: This implementation handles the full flow for each image URL by fetching
 * the image from the provided URL and uploading the binary to LinkedIn's upload endpoint.
 * imageUrls must be publicly accessible URLs pointing to image files (JPEG/PNG/GIF/WEBP).
 * For production use, consider reading local file buffers directly instead of re-fetching.
 *
 * MVP behaviour: if imageUrls is empty or undefined, falls back to publishTextPost.
 *
 * @param {string}   token      - LinkedIn OAuth access token.
 * @param {string}   personUrn  - Author URN.
 * @param {string}   text       - Post commentary text.
 * @param {string[]} imageUrls  - Array of publicly accessible image URLs to attach.
 * @returns {Promise<string>} The created post URN.
 */
async function publishImagePost(token, personUrn, text, imageUrls) {
  if (!token) throw new Error('publishImagePost: token is required');
  if (!personUrn) throw new Error('publishImagePost: personUrn is required');
  if (!text) throw new Error('publishImagePost: text is required');

  // Fall back to text-only post if no images supplied.
  if (!imageUrls || imageUrls.length === 0) {
    console.warn('[linkedin:publisher] No imageUrls provided; falling back to text-only post.');
    return publishTextPost(token, personUrn, text);
  }

  // Step 1 — Register image upload for each image and upload the binary.
  const initUrl = `${LI_REST_BASE}/images?action=initializeUpload`;

  const imageUrns = [];
  for (const imgUrl of imageUrls) {
    console.log(`[linkedin:publisher] Initializing image upload for ${imgUrl}`);

    const initRes = await fetch(initUrl, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify({ initializeUploadRequest: { owner: personUrn } }),
    });

    if (!initRes.ok) {
      const errBody = await initRes.text().catch(() => '');
      throw new Error(`publishImagePost initializeUpload HTTP ${initRes.status}: ${errBody}`);
    }

    const initJson = await initRes.json();
    const uploadUrl = initJson.value?.uploadUrl;
    const imageUrn = initJson.value?.image;

    if (!uploadUrl || !imageUrn) {
      throw new Error(
        `publishImagePost: initializeUpload returned unexpected shape: ${JSON.stringify(initJson)}`
      );
    }

    // Step 2 — Fetch the image binary and upload it to LinkedIn's upload endpoint.
    console.log(`[linkedin:publisher] Fetching image binary from ${imgUrl}`);
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) {
      throw new Error(`publishImagePost: failed to fetch image from ${imgUrl}: HTTP ${imgRes.status}`);
    }
    const imgBuffer = await imgRes.arrayBuffer();

    console.log(`[linkedin:publisher] Uploading image binary (${imgBuffer.byteLength} bytes) to ${uploadUrl}`);
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: imgBuffer,
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text().catch(() => '');
      throw new Error(`publishImagePost upload HTTP ${uploadRes.status}: ${errBody}`);
    }

    imageUrns.push(imageUrn);
    console.log(`[linkedin:publisher] Image registered: ${imageUrn}`);
  }

  // Step 3 — Create the post referencing the uploaded image(s).
  // LinkedIn's Posts API supports a single media attachment per post.
  // For multi-image posts a multiImage content type is required (uses a different
  // content.multiImage shape). Here we attach the first image; for multi-image
  // carousels extend this to use content.multiImage.images[].
  const url = `${LI_REST_BASE}/posts`;
  const postBody = {
    author: personUrn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED' },
    lifecycleState: 'PUBLISHED',
    content: {
      media: { id: imageUrns[0] },
    },
  };

  console.log(`[linkedin:publisher] Creating image post with ${imageUrns.length} image(s) as ${personUrn}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(postBody),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`publishImagePost HTTP ${res.status}: ${errBody}`);
  }

  const postUrn = res.headers.get('x-restli-id') ?? res.headers.get('X-RestLi-Id') ?? '';
  console.log(`[linkedin:publisher] Image post created. URN: ${postUrn}`);
  return postUrn;
}

/**
 * Publishes a post with an article (URL) link attachment.
 *
 * LinkedIn will generate a link preview card from the article URL.
 *
 * @param {string} token      - LinkedIn OAuth access token.
 * @param {string} personUrn  - Author URN, e.g. "urn:li:person:XXXXX".
 * @param {string} text       - Post commentary text shown above the preview card.
 * @param {string} articleUrl - The URL to attach as a link preview.
 * @param {string} title      - Title to display in the link preview card.
 * @returns {Promise<string>} The created post URN.
 */
async function publishArticlePost(token, personUrn, text, articleUrl, title) {
  if (!token) throw new Error('publishArticlePost: token is required');
  if (!personUrn) throw new Error('publishArticlePost: personUrn is required');
  if (!text) throw new Error('publishArticlePost: text is required');
  if (!articleUrl) throw new Error('publishArticlePost: articleUrl is required');
  if (!title) throw new Error('publishArticlePost: title is required');

  const url = `${LI_REST_BASE}/posts`;
  const body = {
    author: personUrn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED' },
    lifecycleState: 'PUBLISHED',
    content: {
      article: {
        source: articleUrl,
        title: title,
      },
    },
  };

  console.log(`[linkedin:publisher] Publishing article post: "${title}" → ${articleUrl}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`publishArticlePost HTTP ${res.status}: ${errBody}`);
  }

  const postUrn = res.headers.get('x-restli-id') ?? res.headers.get('X-RestLi-Id') ?? '';
  console.log(`[linkedin:publisher] Article post created. URN: ${postUrn}`);
  return postUrn;
}

module.exports = { publishTextPost, publishImagePost, publishArticlePost };

// ---------------------------------------------------------------------------
// Stand-alone execution
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);

  function getArg(flag) {
    const prefix = `${flag}=`;
    const entry = args.find((a) => a.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }

  const text = getArg('--text');
  const articleUrl = getArg('--article-url');
  const title = getArg('--title');

  if (!text) {
    console.error(
      'Usage: node linkedin.js --text=<post text> [--article-url=<url> --title=<title>]'
    );
    process.exit(1);
  }

  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;

  if (!token) {
    console.error('LINKEDIN_ACCESS_TOKEN is not set');
    process.exit(1);
  }
  if (!personUrn) {
    console.error('LINKEDIN_PERSON_URN is not set');
    process.exit(1);
  }

  (async () => {
    try {
      let postUrn;
      if (articleUrl && title) {
        postUrn = await publishArticlePost(token, personUrn, text, articleUrl, title);
      } else {
        postUrn = await publishTextPost(token, personUrn, text);
      }
      console.log(`[linkedin:publisher] Done. Post URN: ${postUrn}`);
    } catch (err) {
      console.error('[linkedin:publisher] Failed:', err.message);
      process.exit(1);
    }
  })();
}
