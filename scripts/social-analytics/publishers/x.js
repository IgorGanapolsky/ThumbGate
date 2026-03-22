'use strict';

/**
 * x.js
 * Publishes tweets to X (Twitter) via the X API v2.
 *
 * Required env vars for publishing (OAuth 1.0a user context):
 *   X_API_KEY             — Consumer/API key (required for posting)
 *   X_API_SECRET          — Consumer/API secret (required for posting)
 *   X_ACCESS_TOKEN        — User OAuth 1.0a access token (required for posting)
 *   X_ACCESS_TOKEN_SECRET — User OAuth 1.0a access token secret (required for posting)
 *
 * Optional env vars (read-only operations only):
 *   X_BEARER_TOKEN        — App-only Bearer Token. Suitable for GET endpoints only.
 *                           Tweet creation (POST /2/tweets) requires OAuth 1.0a user
 *                           context — a Bearer Token alone is not sufficient for posting.
 *
 * X API v2 reference:
 *   POST /2/tweets — https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
 *
 * OAuth 1.0a reference:
 *   https://developer.twitter.com/en/docs/authentication/oauth-1-0a
 */

const crypto = require('crypto');

const X_TWEETS_URL = 'https://api.twitter.com/2/tweets';

// ---------------------------------------------------------------------------
// OAuth 1.0a helpers
// ---------------------------------------------------------------------------

/**
 * Percent-encodes a string per RFC 3986 (replaces characters that
 * URLSearchParams does not encode, such as '!', "'", '(', ')', '*').
 *
 * @param {string} str
 * @returns {string}
 */
function rfc3986Encode(str) {
  return encodeURIComponent(String(str)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Builds an OAuth 1.0a Authorization header using HMAC-SHA1 signing.
 *
 * Steps:
 *   1. Collect OAuth parameters (oauth_consumer_key, oauth_nonce,
 *      oauth_signature_method, oauth_timestamp, oauth_token, oauth_version).
 *   2. Merge with any extra request params (query/body), sort, percent-encode.
 *   3. Build the Signature Base String: METHOD&url&params.
 *   4. Build the signing key: consumerSecret&tokenSecret.
 *   5. HMAC-SHA1 sign; base64-encode the digest.
 *   6. Return the Authorization header value.
 *
 * @param {string} method          - HTTP method in uppercase (e.g. 'POST')
 * @param {string} url             - Base URL without query string
 * @param {Record<string, string>} params - Additional request parameters to include in the signature
 * @param {string} consumerKey     - X_API_KEY
 * @param {string} consumerSecret  - X_API_SECRET
 * @param {string} tokenKey        - X_ACCESS_TOKEN
 * @param {string} tokenSecret     - X_ACCESS_TOKEN_SECRET
 * @returns {string} Value for the Authorization HTTP header
 */
function buildOAuth1Header(method, url, params, consumerKey, consumerSecret, tokenKey, tokenSecret) {
  if (!method) throw new Error('buildOAuth1Header: method is required');
  if (!url) throw new Error('buildOAuth1Header: url is required');
  if (!consumerKey) throw new Error('buildOAuth1Header: consumerKey is required');
  if (!consumerSecret) throw new Error('buildOAuth1Header: consumerSecret is required');
  if (!tokenKey) throw new Error('buildOAuth1Header: tokenKey is required');
  if (!tokenSecret) throw new Error('buildOAuth1Header: tokenSecret is required');

  const oauthNonce = crypto.randomBytes(16).toString('hex');
  const oauthTimestamp = String(Math.floor(Date.now() / 1000));

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: oauthNonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: oauthTimestamp,
    oauth_token: tokenKey,
    oauth_version: '1.0',
  };

  // Merge oauth params with any additional request params for signature computation.
  const allParams = { ...params, ...oauthParams };

  // Sort by encoded key, then by encoded value.
  const sortedPairs = Object.entries(allParams)
    .map(([k, v]) => [rfc3986Encode(k), rfc3986Encode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  // Signature Base String: METHOD & encoded-url & encoded-params
  const signatureBase = [
    method.toUpperCase(),
    rfc3986Encode(url),
    rfc3986Encode(sortedPairs),
  ].join('&');

  // Signing key: encoded consumer secret & encoded token secret
  const signingKey = `${rfc3986Encode(consumerSecret)}&${rfc3986Encode(tokenSecret)}`;

  // HMAC-SHA1 digest, base64-encoded.
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  // Build Authorization header — only include oauth_* params, not request params.
  const headerParams = { ...oauthParams, oauth_signature: signature };
  const headerValue =
    'OAuth ' +
    Object.entries(headerParams)
      .map(([k, v]) => `${rfc3986Encode(k)}="${rfc3986Encode(v)}"`)
      .join(', ');

  return headerValue;
}

// ---------------------------------------------------------------------------
// Publishing functions
// ---------------------------------------------------------------------------

/**
 * Publishes a single tweet using OAuth 1.0a user context.
 *
 * @param {string} text - Tweet text (max 280 characters)
 * @param {{ reply?: { in_reply_to_tweet_id: string }, media?: { media_ids: string[] } }} [options]
 * @returns {Promise<{ id: string, text: string }>} Created tweet object
 */
async function publishTweet(text, options = {}) {
  if (!text) throw new Error('publishTweet: text is required');

  const consumerKey = process.env.X_API_KEY;
  const consumerSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  if (!consumerKey) throw new Error('X_API_KEY environment variable is required for posting');
  if (!consumerSecret) throw new Error('X_API_SECRET environment variable is required for posting');
  if (!accessToken) throw new Error('X_ACCESS_TOKEN environment variable is required for posting');
  if (!accessTokenSecret) throw new Error('X_ACCESS_TOKEN_SECRET environment variable is required for posting');

  const body = { text };

  if (options.reply?.in_reply_to_tweet_id) {
    body.reply = { in_reply_to_tweet_id: options.reply.in_reply_to_tweet_id };
  }

  if (options.media?.media_ids?.length) {
    body.media = { media_ids: options.media.media_ids };
  }

  // OAuth 1.0a header — no extra request params for a JSON body POST.
  const authHeader = buildOAuth1Header(
    'POST',
    X_TWEETS_URL,
    {},
    consumerKey,
    consumerSecret,
    accessToken,
    accessTokenSecret
  );

  console.log(`[x:publisher] Posting tweet: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);

  const res = await fetch(X_TWEETS_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`X API ${res.status} for POST /2/tweets: ${errorText}`);
  }

  const json = await res.json();

  if (json.errors && !json.data) {
    throw new Error(`X API errors: ${JSON.stringify(json.errors)}`);
  }

  const tweet = json.data;
  console.log(`[x:publisher] Tweet published. id=${tweet.id}`);
  return tweet;
}

/**
 * Publishes an array of tweet texts as a thread.
 * Each tweet after the first replies to the previous tweet in the thread.
 *
 * @param {string[]} tweets - Array of tweet text strings in thread order
 * @returns {Promise<Array<{ id: string, text: string }>>} Array of created tweet objects
 */
async function publishThread(tweets) {
  if (!Array.isArray(tweets) || tweets.length === 0) {
    throw new Error('publishThread: tweets must be a non-empty array');
  }

  console.log(`[x:publisher] Publishing thread of ${tweets.length} tweets`);

  const published = [];
  let previousTweetId = null;

  for (let i = 0; i < tweets.length; i++) {
    const text = tweets[i];
    const options = {};

    if (previousTweetId) {
      options.reply = { in_reply_to_tweet_id: previousTweetId };
    }

    const tweet = await publishTweet(text, options);
    published.push(tweet);
    previousTweetId = tweet.id;

    console.log(`[x:publisher] Thread tweet ${i + 1}/${tweets.length} published. id=${tweet.id}`);
  }

  console.log(`[x:publisher] Thread complete. ${published.length} tweets published.`);
  return published;
}

module.exports = { buildOAuth1Header, publishTweet, publishThread };

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

  if (!text) {
    console.error('Usage: node x.js --text=<tweet text>');
    process.exit(1);
  }

  publishTweet(text)
    .then((tweet) => {
      console.log(`[x:publisher] Done. id=${tweet.id} text="${tweet.text}"`);
    })
    .catch((err) => {
      console.error('[x:publisher] Publish failed:', err.message);
      process.exit(1);
    });
}
