'use strict';

/**
 * youtube.js
 * Publishes YouTube Shorts via the YouTube Data API v3 resumable upload protocol.
 *
 * Required env vars:
 *   YOUTUBE_ACCESS_TOKEN — OAuth2 bearer token with youtube.upload scope (required)
 *
 * Note: YouTube uploads require OAuth2, not just an API key.
 * The access token must have the scope:
 *   https://www.googleapis.com/auth/youtube.upload
 *
 * API reference:
 *   POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
 *   PUT  {resumableUploadUri}  — upload binary chunk
 */

const fs = require('fs');
const path = require('path');

const YOUTUBE_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

/**
 * Initiates a YouTube resumable upload session.
 * Returns the upload URI from the Location response header.
 *
 * @param {string} token                   - OAuth2 bearer token
 * @param {object} options                 - Video metadata
 * @param {string} options.title           - Video title
 * @param {string} [options.description]   - Video description
 * @param {string[]} [options.tags]        - Array of tags
 * @param {string} [options.categoryId]    - YouTube category ID (e.g. '22' = People & Blogs)
 * @param {string} [options.privacyStatus] - 'public' | 'private' | 'unlisted' (default: 'public')
 * @returns {Promise<string>} Resumable upload URI
 */
async function initResumableUpload(token, { title, description, tags, categoryId, privacyStatus }) {
  if (!token) throw new Error('token is required');
  if (!title) throw new Error('title is required');

  const url =
    `${YOUTUBE_UPLOAD_BASE}/videos` +
    `?uploadType=resumable&part=snippet,status`;

  const body = {
    snippet: {
      title,
      description: description || '',
      tags: tags || [],
      categoryId: categoryId || '22',
    },
    status: {
      privacyStatus: privacyStatus || 'public',
      selfDeclaredMadeForKids: false,
    },
  };

  console.log(`[youtube:publisher] Initiating resumable upload: title="${title}"`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/*',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status} for resumable upload init: ${text}`);
  }

  const uploadUri = res.headers.get('Location');
  if (!uploadUri) {
    throw new Error(
      'YouTube resumable upload init did not return a Location header. ' +
        `Status: ${res.status}`
    );
  }

  console.log(`[youtube:publisher] Resumable upload URI obtained`);
  return uploadUri;
}

/**
 * Uploads the video binary to the resumable upload URI.
 * Uses a single PUT request (suitable for files up to ~5 GB).
 *
 * @param {string} uploadUri      - Resumable upload URI from initResumableUpload
 * @param {Buffer} videoBuffer    - Raw video file buffer
 * @param {string} [contentType]  - MIME type (default: 'video/mp4')
 * @returns {Promise<object>} Created video resource from YouTube API
 */
async function uploadVideoChunk(uploadUri, videoBuffer, contentType) {
  if (!uploadUri) throw new Error('uploadUri is required');
  if (!Buffer.isBuffer(videoBuffer)) throw new Error('videoBuffer must be a Buffer');

  const mimeType = contentType || 'video/mp4';

  console.log(
    `[youtube:publisher] Uploading video chunk: ` +
      `size=${videoBuffer.length} bytes contentType=${mimeType}`
  );

  const res = await fetch(uploadUri, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(videoBuffer.length),
    },
    body: videoBuffer,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube upload chunk failed ${res.status}: ${text}`);
  }

  const json = await res.json();

  if (json.error) {
    throw new Error(`YouTube API error after upload: ${json.error.code} — ${json.error.message}`);
  }

  const videoId = json.id;
  console.log(`[youtube:publisher] Video uploaded successfully. videoId=${videoId}`);

  return json;
}

/**
 * Orchestrates the full YouTube Shorts publish flow:
 *   1. Read video file from disk
 *   2. Ensure #Shorts is in the description
 *   3. Initiate resumable upload session
 *   4. Upload video binary
 *
 * @param {object} options
 * @param {string} options.videoPath      - Absolute or relative path to the local video file
 * @param {string} options.title          - Video title
 * @param {string} [options.description]  - Video description (will have #Shorts appended if missing)
 * @param {string[]} [options.tags]       - Array of tags
 * @param {string} [options.token]        - OAuth2 token (falls back to YOUTUBE_ACCESS_TOKEN env var)
 * @param {string} [options.privacyStatus] - 'public' | 'private' | 'unlisted' (default: 'public')
 * @param {string} [options.categoryId]   - YouTube category ID (default: '22')
 * @returns {Promise<{ videoId: string, url: string }>}
 */
async function publishYouTubeShort({ videoPath, title, description, tags, token, privacyStatus, categoryId }) {
  const accessToken = token || process.env.YOUTUBE_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('YOUTUBE_ACCESS_TOKEN environment variable (or token param) is required');
  }
  if (!videoPath) throw new Error('videoPath is required');
  if (!title) throw new Error('title is required');

  const resolvedPath = path.resolve(videoPath);

  console.log(`[youtube:publisher] Starting YouTube Shorts publish flow`);
  console.log(`[youtube:publisher] Reading video file: ${resolvedPath}`);

  const videoBuffer = fs.readFileSync(resolvedPath);
  console.log(`[youtube:publisher] Video file loaded: ${videoBuffer.length} bytes`);

  // Ensure #Shorts is present in the description for YouTube to classify as a Short.
  let finalDescription = description || '';
  if (!finalDescription.includes('#Shorts')) {
    finalDescription = finalDescription
      ? `${finalDescription}\n\n#Shorts`
      : '#Shorts';
  }

  const uploadUri = await initResumableUpload(accessToken, {
    title,
    description: finalDescription,
    tags: tags || [],
    categoryId: categoryId || '22',
    privacyStatus: privacyStatus || 'public',
  });

  const videoResource = await uploadVideoChunk(uploadUri, videoBuffer, 'video/mp4');

  const videoId = videoResource.id;
  const url = `https://youtube.com/shorts/${videoId}`;

  console.log(`[youtube:publisher] Short published: videoId=${videoId} url=${url}`);

  return { videoId, url };
}

module.exports = { initResumableUpload, uploadVideoChunk, publishYouTubeShort };

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

  const videoPath = getArg('--video');
  const title = getArg('--title');
  const description = getArg('--description');

  if (!videoPath || !title) {
    console.error('Usage: node youtube.js --video=<path> --title=<title> [--description=<desc>]');
    process.exit(1);
  }

  publishYouTubeShort({ videoPath, title, description: description || '' })
    .then(({ videoId, url }) => {
      console.log(`[youtube:publisher] Done. videoId=${videoId} url=${url}`);
    })
    .catch((err) => {
      console.error('[youtube:publisher] Publish failed:', err.message);
      process.exit(1);
    });
}
