'use strict';

/**
 * reddit.js
 * Publishes posts and comments to Reddit via the OAuth2 API.
 *
 * Required env vars:
 *   REDDIT_CLIENT_ID      — OAuth2 application client ID (required)
 *   REDDIT_CLIENT_SECRET  — OAuth2 application client secret (required)
 *   REDDIT_USERNAME       — Reddit account username (required)
 *   REDDIT_PASSWORD       — Reddit account password (required)
 *   REDDIT_USER_AGENT     — Custom User-Agent string (default: thumbgate/1.0 by <username>)
 *
 * Target subreddits for our product:
 *   r/ClaudeCode, r/ClaudeAI, r/MCP, r/LocalLLaMA, r/SideProject
 *
 * Reddit API reference:
 *   POST https://oauth.reddit.com/api/submit   — submit a link or text post
 *   POST https://oauth.reddit.com/api/comment  — submit a reply/comment
 */

const { tagUrlsInText, buildUTMLink } = require('../utm');

const REDDIT_UTM = { source: 'reddit', medium: 'social', campaign: 'organic' };

const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Exchange Reddit credentials for an OAuth2 access token using the password grant flow.
 *
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string} username
 * @param {string} password
 * @returns {Promise<string>} access_token
 */
async function getRedditToken(clientId, clientSecret, username, password) {
  if (!clientId) throw new Error('clientId is required');
  if (!clientSecret) throw new Error('clientSecret is required');
  if (!username) throw new Error('username is required');
  if (!password) throw new Error('password is required');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
  });

  console.log('[reddit:publisher] Fetching access token');

  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': `thumbgate/1.0 by ${username}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Reddit token endpoint ${res.status}: ${text}`);
  }

  const json = await res.json();

  if (json.error) {
    throw new Error(`Reddit token error: ${json.error} — ${json.message || ''}`);
  }

  const token = json.access_token;
  if (!token) {
    throw new Error(`Reddit token response missing access_token: ${JSON.stringify(json)}`);
  }

  console.log('[reddit:publisher] Access token obtained');
  return token;
}

// ---------------------------------------------------------------------------
// Post submission
// ---------------------------------------------------------------------------

/**
 * Submit a self (text) post to a subreddit.
 *
 * @param {string} token - Reddit OAuth2 access token
 * @param {string} userAgent - User-Agent header value
 * @param {{ subreddit: string, title: string, text: string }} options
 * @returns {Promise<object>} Reddit API response data
 */
async function submitTextPost(token, userAgent, { subreddit, title, text }) {
  if (!token) throw new Error('token is required');
  if (!subreddit) throw new Error('subreddit is required');
  if (!title) throw new Error('title is required');
  if (!text) throw new Error('text is required');

  const url = `${REDDIT_API_BASE}/api/submit`;
  const body = new URLSearchParams({
    kind: 'self',
    sr: subreddit,
    title,
    text,
    resubmit: 'true',
    nsfw: 'false',
    spoiler: 'false',
  });

  console.log(`[reddit:publisher] Submitting text post to r/${subreddit}: "${title}"`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text_body = await res.text().catch(() => '');
    throw new Error(`Reddit API ${res.status} for ${url}: ${text_body}`);
  }

  const json = await res.json();

  // Reddit wraps errors inside json.json.errors even on HTTP 200.
  const errors = json.json?.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`Reddit submit error: ${JSON.stringify(errors)}`);
  }

  const postData = json.json?.data ?? json;
  console.log(
    `[reddit:publisher] Text post submitted. url=${postData.url || postData.name || 'unknown'}`
  );
  return postData;
}

/**
 * Submit a link post to a subreddit.
 *
 * @param {string} token - Reddit OAuth2 access token
 * @param {string} userAgent - User-Agent header value
 * @param {{ subreddit: string, title: string, url: string }} options
 * @returns {Promise<object>} Reddit API response data
 */
async function submitLinkPost(token, userAgent, { subreddit, title, url }) {
  if (!token) throw new Error('token is required');
  if (!subreddit) throw new Error('subreddit is required');
  if (!title) throw new Error('title is required');
  if (!url) throw new Error('url is required');

  const endpoint = `${REDDIT_API_BASE}/api/submit`;
  const body = new URLSearchParams({
    kind: 'link',
    sr: subreddit,
    title,
    url,
    resubmit: 'true',
    nsfw: 'false',
    spoiler: 'false',
  });

  console.log(`[reddit:publisher] Submitting link post to r/${subreddit}: "${title}" -> ${url}`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text_body = await res.text().catch(() => '');
    throw new Error(`Reddit API ${res.status} for ${endpoint}: ${text_body}`);
  }

  const json = await res.json();

  const errors = json.json?.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`Reddit submit error: ${JSON.stringify(errors)}`);
  }

  const postData = json.json?.data ?? json;
  console.log(
    `[reddit:publisher] Link post submitted. url=${postData.url || postData.name || 'unknown'}`
  );
  return postData;
}

/**
 * Submit a comment or reply to an existing post or comment.
 *
 * @param {string} token - Reddit OAuth2 access token
 * @param {string} userAgent - User-Agent header value
 * @param {{ parentId: string, text: string }} options
 *   parentId — fullname of the parent thing (e.g. "t3_abc123" for a post, "t1_xyz" for a comment)
 * @returns {Promise<object>} Reddit API response data
 */
async function submitComment(token, userAgent, { parentId, text }) {
  if (!token) throw new Error('token is required');
  if (!parentId) throw new Error('parentId is required');
  if (!text) throw new Error('text is required');

  const url = `${REDDIT_API_BASE}/api/comment`;
  const body = new URLSearchParams({
    thing_id: parentId,
    text,
  });

  console.log(`[reddit:publisher] Submitting comment on ${parentId}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text_body = await res.text().catch(() => '');
    throw new Error(`Reddit API ${res.status} for ${url}: ${text_body}`);
  }

  const json = await res.json();

  const errors = json.json?.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`Reddit comment error: ${JSON.stringify(errors)}`);
  }

  const commentData = json.json?.data?.things?.[0]?.data ?? json.json?.data ?? json;
  console.log(
    `[reddit:publisher] Comment submitted. id=${commentData.id || commentData.name || 'unknown'}`
  );
  return commentData;
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Build the standard follow-up comment for a Reddit post.
 * This is disclosure-only and should not behave like a CTA.
 *
 * @param {string} subreddit - The subreddit name (used for UTM tracking)
 * @param {string} [utmContent] - Optional UTM content tag (defaults to subreddit name)
 * @returns {string} The follow-up comment text
 */
function buildFollowUpComment(subreddit, utmContent) {
  return [
    'Disclosure: I built ThumbGate.',
    '',
    'The point of the post is the workflow: explicit thumbs-up/down feedback that survives the next session and can block a previously rejected move.',
    '',
    'If anyone wants the repo or setup details, ask and I will share them in-thread.',
  ].join('\n');
}

function normalizeFollowUpComment(followUpComment) {
  if (typeof followUpComment !== 'string') {
    return null;
  }
  const trimmed = followUpComment.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Publish to Reddit — submits a link post if url is provided, otherwise a text post.
 * Optionally posts a disclosure-only follow-up comment.
 *
 * Reads credentials from environment variables if token is not supplied.
 *
 * @param {{ subreddit: string, title: string, text?: string, url?: string, token?: string, followUpComment?: boolean|string, utmContent?: string }} options
 * @returns {Promise<object>} Reddit API response data for the submitted post
 */
async function publishToReddit({ subreddit, title, text, url, token, followUpComment, utmContent }) {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  const userAgent =
    process.env.REDDIT_USER_AGENT || `thumbgate/1.0 by ${username}`;

  const accessToken =
    token ||
    (await getRedditToken(clientId, clientSecret, username, password));

  const qualityGate = require('../../social-quality-gate');
  const gateResult = qualityGate.gatePost([title, text].filter(Boolean).join('\n'));
  if (!gateResult.allowed) {
    const reasons = gateResult.findings.map(f => f.reason).join(', ');
    console.error(`[reddit:publisher] BLOCKED by quality gate: ${reasons}`);
    return { blocked: true, reasons: gateResult.findings };
  }

  if (!subreddit) throw new Error('subreddit is required');
  if (!title) throw new Error('title is required');

  // Tag trackable URLs with Reddit UTM parameters
  if (text) text = tagUrlsInText(text, REDDIT_UTM);
  if (url) {
    const taggedUrl = tagUrlsInText(url, REDDIT_UTM);
    return submitLinkPost(accessToken, userAgent, { subreddit, title, url: taggedUrl });
  }

  if (!text) throw new Error('text is required when url is not provided');
  const postData = await submitTextPost(accessToken, userAgent, { subreddit, title, text });

  // Post disclosure-only follow-up comment if requested
  if (postData.name) {
    const commentText = normalizeFollowUpComment(followUpComment);
    if (followUpComment && !commentText) {
      console.log('[reddit:publisher] Generic auto follow-up comments are disabled; skipping');
    }
    if (!commentText) {
      return postData;
    }
  if (followUpComment && postData.name) {
    const commentText = typeof followUpComment === 'string'
      ? followUpComment
      : buildFollowUpComment(subreddit, utmContent);

    const commentGate = qualityGate.gatePost(commentText);
    if (!commentGate.allowed) {
      console.error('[reddit:publisher] Follow-up comment BLOCKED by quality gate');
    } else {
      try {
        await submitComment(accessToken, userAgent, { parentId: postData.name, text: commentText });
        console.log('[reddit:publisher] Follow-up disclosure comment posted');
      } catch (err) {
        console.error('[reddit:publisher] Follow-up comment failed:', err.message);
      }
    }
  }

  return postData;
}

module.exports = {
  getRedditToken,
  submitTextPost,
  submitLinkPost,
  submitComment,
  publishToReddit,
  buildFollowUpComment,
  normalizeFollowUpComment,
};

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

  const subreddit = getArg('--subreddit');
  const title = getArg('--title');
  const text = getArg('--text');
  const url = getArg('--url');
  const followUp = args.includes('--follow-up');
  const followUpText = getArg('--follow-up-text');
  const utmContent = getArg('--utm-content');

  if (!subreddit || !title || (!text && !url)) {
    console.error(
      'Usage: node reddit.js --subreddit=<sub> --title=<title> [--text=<body> | --url=<url>] [--follow-up-text=<comment>] [--utm-content=<tag>]'
    );
    process.exit(1);
  }

  if (followUp && !followUpText) {
    console.error('[reddit:publisher] --follow-up is no longer supported without explicit --follow-up-text');
    process.exit(1);
  }

  publishToReddit({ subreddit, title, text, url, followUpComment: followUpText, utmContent })
    .then((data) => {
      console.log(`[reddit:publisher] Done. response=${JSON.stringify(data)}`);
    })
    .catch((err) => {
      console.error('[reddit:publisher] Publish failed:', err.message);
      process.exit(1);
    });
}
