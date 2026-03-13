'use strict';

/**
 * X.com (Twitter) OAuth 1.0a library + CLI
 *
 * Library usage:
 *   const { postTweet, searchTweets, postThread, buildOAuthHeader } = require('./post-to-x');
 *
 * CLI usage:
 *   node scripts/post-to-x.js "Your tweet text here"
 *   node scripts/post-to-x.js --thread
 *   node scripts/post-to-x.js --search "MCP memory gateway"
 *   node scripts/post-to-x.js --reply <tweetId> "Reply text"
 *   node scripts/post-to-x.js --dry-run "Preview this tweet"
 *   node scripts/post-to-x.js --dry-run --thread
 *
 * Env vars required:
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWEET_URL = 'https://api.twitter.com/2/tweets';
const SEARCH_URL = 'https://api.twitter.com/2/tweets/search/recent';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 5000;

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

function getCredentials() {
  return {
    apiKey: process.env.X_API_KEY,
    apiSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
  };
}

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
  const paramString = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const baseString = `${method}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildOAuthHeader(method, url, extraParams = {}) {
  const creds = getCredentials();
  const oauthParams = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  // Merge query params (for GET) into signature base
  const allParams = { ...oauthParams, ...extraParams };

  const signature = generateOAuthSignature(
    method, url, allParams, creds.apiSecret, creds.accessTokenSecret
  );
  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const resp = await fetch(url, options);

    if (resp.status === 429) {
      const retryAfter = resp.headers.get('retry-after');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : RETRY_BASE_MS * attempt;
      console.error(`  ⏳ Rate limited (429). Retry ${attempt}/${retries} in ${waitMs}ms...`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
    }

    return resp;
  }
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function postTweet(text, replyToId, { dryRun = false } = {}) {
  const body = { text };
  if (replyToId) {
    body.reply = { in_reply_to_tweet_id: replyToId };
  }

  if (dryRun) {
    const label = replyToId ? ` (reply to ${replyToId})` : '';
    console.log(`  🏜️  [dry-run] Would post${label}: ${text.slice(0, 120)}...`);
    return `dry-run-${Date.now()}`;
  }

  const authHeader = buildOAuthHeader('POST', TWEET_URL);

  const resp = await fetchWithRetry(TWEET_URL, {
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

async function searchTweets(query, { maxResults = 10, dryRun = false } = {}) {
  const queryParams = {
    query,
    max_results: String(maxResults),
    'tweet.fields': 'author_id,created_at,public_metrics',
  };

  if (dryRun) {
    console.log(`  🏜️  [dry-run] Would search: "${query}" (max ${maxResults})`);
    return [];
  }

  const qs = Object.entries(queryParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const fullUrl = `${SEARCH_URL}?${qs}`;

  // Query params must be included in OAuth signature for GET requests
  const authHeader = buildOAuthHeader('GET', SEARCH_URL, queryParams);

  const resp = await fetchWithRetry(fullUrl, {
    method: 'GET',
    headers: { 'Authorization': authHeader },
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error(`  ✗ Search failed (${resp.status}):`, JSON.stringify(data));
    return [];
  }

  return data.data || [];
}

// ---------------------------------------------------------------------------
// Thread helpers
// ---------------------------------------------------------------------------

function parseTweetsFromThread(content) {
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
      if (line.trim() && !line.startsWith('#') && !line.startsWith('---')) {
        currentTweet += (currentTweet ? ' ' : '') + line.trim();
      }
    }
  }
  if (currentTweet.trim()) tweets.push(currentTweet.trim());

  return tweets
    .map(t => t.replace(/\*\*/g, '').replace(/`/g, '').trim())
    .filter(t => t.length > 0 && t.length <= 280);
}

async function postThread(tweets, { dryRun = false } = {}) {
  console.log(`\n🐦 ${dryRun ? '[dry-run] ' : ''}Posting thread (${tweets.length} tweets) to X.com...\n`);
  let previousId = null;

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    console.log(`  [${i + 1}/${tweets.length}] (${tweet.length} chars)`);
    previousId = await postTweet(tweet, previousId, { dryRun });

    if (!previousId) {
      console.error(`  ✗ Thread broken at tweet ${i + 1}. Stopping.`);
      return;
    }

    if (!dryRun && i < tweets.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n✅ Thread ${dryRun ? 'preview' : 'posted'}! ${tweets.length} tweets.`);
  if (!dryRun) {
    console.log(`   https://x.com/IgorGanapolsky/status/${previousId}\n`);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const creds = getCredentials();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filtered = args.filter(a => a !== '--dry-run');

  if (!dryRun && (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessTokenSecret)) {
    console.error('❌ Missing X.com credentials. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET');
    process.exit(1);
  }

  const command = filtered[0];

  if (command === '--search') {
    const query = filtered[1];
    if (!query) {
      console.error('❌ Usage: --search "query"');
      process.exit(1);
    }
    const results = await searchTweets(query, { dryRun });
    if (results.length === 0) {
      console.log('No results found.');
    } else {
      results.forEach(t => {
        const metrics = t.public_metrics || {};
        console.log(`  [${t.id}] ${t.text.slice(0, 100)}...`);
        console.log(`    ↩ ${metrics.reply_count || 0}  🔁 ${metrics.retweet_count || 0}  ❤️ ${metrics.like_count || 0}\n`);
      });
    }
  } else if (command === '--reply') {
    const tweetId = filtered[1];
    const text = filtered[2];
    if (!tweetId || !text) {
      console.error('❌ Usage: --reply <tweetId> "text"');
      process.exit(1);
    }
    const id = await postTweet(text, tweetId, { dryRun });
    if (id) {
      console.log(`\n✅ Reply posted: https://x.com/IgorGanapolsky/status/${id}\n`);
    }
  } else if (command === '--scheduled') {
    const tips = [
      '🧠 Did you know? MCP Memory Gateway uses Thompson Sampling to decide which feedback signals matter most. Less noise, better training data.\n\nhttps://github.com/IgorGanapolsky/mcp-memory-gateway',
      '🛡️ AI agents repeat the same mistakes because they have no memory across sessions. MCP Memory Gateway fixes that with local-first feedback loops.\n\nnpx mcp-memory-gateway init',
      '📊 The learning curve dashboard shows your agent actually getting smarter — approval rate climbing, failure domains shrinking, prevention rules firing.\n\nhttps://github.com/IgorGanapolsky/mcp-memory-gateway',
      '🔄 Capture → Validate → Remember → Prevent → Export. Five phases to turn agent mistakes into training data.\n\nMCP Memory Gateway — local-first RLHF for AI agents.\n\nnpx mcp-memory-gateway init',
      '💡 Prevention rules generated from repeated failures = an immune system for your AI agent. No cloud required.\n\nPro Pack: $9 → https://gumroad.com/igorganapolsky',
      '⚡ Works with Claude Code, Amp, Codex, Gemini CLI, Cursor. One install, all agents learn.\n\nnpx mcp-memory-gateway init\n\nhttps://github.com/IgorGanapolsky/mcp-memory-gateway',
    ];
    const dayIndex = Math.floor(Date.now() / 86400000) % tips.length;
    const tip = tips[dayIndex];
    console.log(`📅 Scheduled tweet (tip #${dayIndex + 1}):`);
    const id = await postTweet(tip, null, { dryRun });
    if (id) {
      console.log(`\n✅ https://x.com/IgorGanapolsky/status/${id}\n`);
    }
  } else if (command === '--thread') {
    const candidates = [
      path.join(__dirname, '..', '.amp', 'in', 'artifacts', 'marketing', '03-twitter-thread.md'),
      path.join(__dirname, '..', 'docs', 'marketing', 'twitter-thread-formatted.md'),
    ];
    const threadFile = candidates.find(f => fs.existsSync(f));
    if (!threadFile) {
      console.error('❌ No twitter thread file found.');
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

    await postThread(tweets, { dryRun });
  } else if (command) {
    const id = await postTweet(command, null, { dryRun });
    if (id) {
      console.log(`\n✅ https://x.com/IgorGanapolsky/status/${id}\n`);
    }
  } else {
    const tweet = `🚀 Launched MCP Memory Gateway — local-first memory & RLHF feedback pipeline for AI agents.

Captures 👍/👎 → promotes memories → generates prevention rules → exports DPO pairs.

Works with Claude, Codex, Amp, Gemini.

npm: npx mcp-memory-gateway init
Pro Pack: $9

⭐ https://github.com/IgorGanapolsky/mcp-memory-gateway`;

    const id = await postTweet(tweet, null, { dryRun });
    if (id) {
      console.log(`\n✅ https://x.com/IgorGanapolsky/status/${id}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Exports + CLI guard
// ---------------------------------------------------------------------------

module.exports = {
  postTweet,
  postThread,
  searchTweets,
  buildOAuthHeader,
  percentEncode,
  generateOAuthSignature,
  parseTweetsFromThread,
};

if (require.main === module) {
  main();
}
