'use strict';

/**
 * Post to X.com (Twitter) using OAuth 1.0a
 *
 * Usage:
 *   node scripts/post-to-x.js "Your tweet text here"
 *   node scripts/post-to-x.js --thread   # Posts the generated Twitter thread
 *
 * Env vars required (set in .env):
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

const TWEET_URL = 'https://api.twitter.com/2/tweets';

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function generateOAuthSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');
  const baseString = `${method}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildOAuthHeader(method, url, body) {
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  const allParams = { ...oauthParams };

  const signature = generateOAuthSignature(method, url, allParams, API_SECRET, ACCESS_TOKEN_SECRET);
  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

async function postTweet(text, replyToId) {
  const body = { text };
  if (replyToId) {
    body.reply = { in_reply_to_tweet_id: replyToId };
  }

  const authHeader = buildOAuthHeader('POST', TWEET_URL, body);

  const resp = await fetch(TWEET_URL, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error(`  ✗ Tweet failed (${resp.status}):`, JSON.stringify(data));
    return null;
  }

  console.log(`  ✓ Posted tweet ${data.data.id}: ${text.slice(0, 60)}...`);
  return data.data.id;
}

function parseTweetsFromThread(content) {
  // Extract numbered tweets like "1/N ...", "2/N ...", etc.
  const tweets = [];
  const lines = content.split('\n');
  let currentTweet = '';

  for (const line of lines) {
    const match = line.match(/^\*?\*?(\d+)[\/\\](\d+|N)\*?\*?\s*[:\-–]?\s*(.*)/);
    if (match) {
      if (currentTweet.trim()) tweets.push(currentTweet.trim());
      currentTweet = match[3] || '';
    } else if (line.match(/^Tweet\s+\d+/i)) {
      if (currentTweet.trim()) tweets.push(currentTweet.trim());
      currentTweet = '';
    } else if (currentTweet !== '' || tweets.length > 0) {
      // continuation of current tweet
      if (line.trim() && !line.startsWith('#') && !line.startsWith('---')) {
        currentTweet += (currentTweet ? ' ' : '') + line.trim();
      }
    }
  }
  if (currentTweet.trim()) tweets.push(currentTweet.trim());

  // Clean up markdown artifacts
  return tweets
    .map(t => t.replace(/\*\*/g, '').replace(/`/g, '').trim())
    .filter(t => t.length > 0 && t.length <= 280);
}

async function postThread(tweets) {
  console.log(`\n🐦 Posting thread (${tweets.length} tweets) to X.com...\n`);
  let previousId = null;

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    console.log(`  [${i + 1}/${tweets.length}] (${tweet.length} chars)`);
    previousId = await postTweet(tweet, previousId);

    if (!previousId) {
      console.error(`  ✗ Thread broken at tweet ${i + 1}. Stopping.`);
      return;
    }

    // Rate limit: wait 2s between tweets
    if (i < tweets.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n✅ Thread posted! ${tweets.length} tweets.`);
  console.log(`   https://x.com/IgorGanapolsky/status/${previousId}\n`);
}

async function main() {
  if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_TOKEN_SECRET) {
    console.error('❌ Missing X.com credentials in env. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET');
    process.exit(1);
  }

  const arg = process.argv[2];

  if (arg === '--thread') {
    // Read the generated twitter thread
    const threadFile = path.join(__dirname, '..', '.amp', 'in', 'artifacts', 'marketing', '03-twitter-thread.md');
    if (!fs.existsSync(threadFile)) {
      console.error('❌ No twitter thread file. Run: npm run marketing:posts first');
      process.exit(1);
    }
    const content = fs.readFileSync(threadFile, 'utf-8');
    const tweets = parseTweetsFromThread(content);

    if (tweets.length === 0) {
      console.error('❌ Could not parse tweets from thread file.');
      process.exit(1);
    }

    console.log(`Parsed ${tweets.length} tweets:`);
    tweets.forEach((t, i) => console.log(`  ${i + 1}. (${t.length}c) ${t.slice(0, 80)}...`));
    console.log('');

    await postThread(tweets);
  } else if (arg) {
    // Single tweet
    const id = await postTweet(arg);
    if (id) {
      console.log(`\n✅ https://x.com/IgorGanapolsky/status/${id}\n`);
    }
  } else {
    // Default: post a single launch tweet
    const tweet = `🚀 Launched MCP Memory Gateway — local-first memory & RLHF feedback pipeline for AI agents.

Captures 👍/👎 → promotes memories → generates prevention rules → exports DPO pairs.

Works with Claude, Codex, Amp, Gemini.

npm: npx rlhf-feedback-loop init
Pro Pack: $9

⭐ https://github.com/IgorGanapolsky/mcp-memory-gateway`;

    const id = await postTweet(tweet);
    if (id) {
      console.log(`\n✅ https://x.com/IgorGanapolsky/status/${id}\n`);
    }
  }
}

main();
