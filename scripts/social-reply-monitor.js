'use strict';

/**
 * social-reply-monitor.js
 * Monitors Reddit, X.com, and LinkedIn for replies to our posts,
 * then generates and posts contextual responses.
 *
 * Usage:
 *   node scripts/social-reply-monitor.js                    # Check all platforms
 *   node scripts/social-reply-monitor.js --platform=reddit  # Check one platform
 *   node scripts/social-reply-monitor.js --dry-run          # Preview replies without posting
 *
 * Env vars: see individual publisher modules + GEMINI_API_KEY for reply generation.
 *
 * State file: .rlhf/reply-monitor-state.json — tracks which replies we've already responded to.
 */

const fs = require('fs');
const path = require('path');

// Load .env if available
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

const STATE_FILE = path.resolve(__dirname, '..', '.rlhf', 'reply-monitor-state.json');
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const ZERNIO_BASE = 'https://zernio.com/api/v1';

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return { repliedTo: {}, lastCheck: {} };
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Reply generation (uses Gemini API for cost-effective generation)
// ---------------------------------------------------------------------------

/**
 * Generate a contextual reply to a comment using Gemini.
 * Falls back to a template if no API key.
 */
async function generateReply(comment, context) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  // Always use template fallback if Gemini key is missing or looks like a placeholder
  if (!apiKey || apiKey.startsWith('AIzaSy') && apiKey.length < 40) {
    // Template fallback
    return `Thanks for the feedback! ${context.isQuestion ? "Happy to elaborate — " : ""}the gate engine works by intercepting tool calls before execution and checking them against validated failure patterns. The rules are auto-promoted from structured feedback, not hand-authored. If you want to dig into the implementation: https://github.com/IgorGanapolsky/mcp-memory-gateway`;
  }

  const systemPrompt = `You are replying to a comment on a social media post about mcp-memory-gateway, an open-source pre-action gate system for AI coding agents.

Rules:
- Be helpful, technical, and concise (2-4 sentences max)
- Answer questions directly with specific technical details
- Never be salesy or promotional — you're a developer having a conversation
- If they mention a competing approach, acknowledge it genuinely
- Always end with something useful (a specific detail, a link to relevant code, or a genuine question back)
- Include "Disclosure: I built this." only if it hasn't been said yet in the thread
- Use the GitHub link sparingly — only when directly relevant to their question`;

  const userPrompt = `Platform: ${context.platform}
Original post topic: ${context.postTitle || 'Pre-action gates for AI agent reliability'}
Their comment: "${comment}"
${context.parentComment ? `Parent comment (what they're replying to): "${context.parentComment}"` : ''}

Generate a reply:`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 256, temperature: 0.7 },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ---------------------------------------------------------------------------
// Reddit: fetch replies and respond
// ---------------------------------------------------------------------------

async function getRedditToken() {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } = process.env;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
    throw new Error('Missing Reddit credentials (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD)');
  }

  const credentials = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': `mcp-memory-gateway/1.0 by ${REDDIT_USERNAME}`,
    },
    body: new URLSearchParams({ grant_type: 'password', username: REDDIT_USERNAME, password: REDDIT_PASSWORD }).toString(),
  });

  const json = await res.json();
  if (json.error) throw new Error(`Reddit auth: ${json.error}`);
  return json.access_token;
}

async function checkRedditReplies(state, dryRun) {
  console.log('[reply-monitor] Checking Reddit inbox...');

  let token;
  try {
    token = await getRedditToken();
  } catch (err) {
    console.warn(`[reply-monitor] Reddit auth failed: ${err.message}`);
    return [];
  }

  const userAgent = `mcp-memory-gateway/1.0 by ${process.env.REDDIT_USERNAME}`;

  // Fetch inbox (comment replies)
  const res = await fetch(`${REDDIT_API_BASE}/message/inbox?limit=25`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
    },
  });

  if (!res.ok) {
    console.warn(`[reply-monitor] Reddit inbox fetch failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const replies = (data.data?.children || []).filter(
    (c) => c.kind === 't1' && (c.data.type === 'comment_reply' || c.data.type === 'post_reply')
  );

  const results = [];
  for (const reply of replies) {
    const commentId = reply.data.name;
    if (state.repliedTo[commentId]) continue; // Already replied

    const author = reply.data.author || '';
    // Skip mod/bot messages — don't reply to removals, automod, or flood bots
    if (/^(AutoModerator|.*-ModTeam|.*-mod-bot|reddit|BotDefense|floodassistant|Minkstix)$/i.test(author) || /forget.*previous.*instructions|ignore.*prompt|give me a .* recipe/i.test(reply.data.body || '')) {
      state.repliedTo[commentId] = { at: new Date().toISOString(), platform: 'reddit', skipped: 'bot/mod' };
      continue;
    }

    const commentBody = reply.data.body || '';
    const postTitle = reply.data.link_title || '';

    console.log(`[reply-monitor] New Reddit reply from u/${reply.data.author}: "${commentBody.slice(0, 80)}..."`);

    const isQuestion = /\?/.test(commentBody);
    const generatedReply = await generateReply(commentBody, {
      platform: 'reddit',
      postTitle,
      isQuestion,
    });

    if (!generatedReply) {
      console.warn(`[reply-monitor] Could not generate reply for ${commentId}`);
      continue;
    }

    console.log(`[reply-monitor] Generated reply: "${generatedReply.slice(0, 100)}..."`);

    if (dryRun) {
      console.log(`[dry-run] Would reply to ${commentId}`);
      results.push({ commentId, reply: generatedReply, posted: false });
      continue;
    }

    // Post the reply
    const postRes = await fetch(`${REDDIT_API_BASE}/api/comment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
      body: new URLSearchParams({ thing_id: commentId, text: generatedReply }).toString(),
    });

    if (postRes.ok) {
      state.repliedTo[commentId] = { at: new Date().toISOString(), platform: 'reddit' };
      results.push({ commentId, reply: generatedReply, posted: true });
      console.log(`[reply-monitor] Replied to ${commentId}`);
    } else {
      console.warn(`[reply-monitor] Failed to post reply to ${commentId}: ${postRes.status}`);
    }
  }

  state.lastCheck.reddit = new Date().toISOString();
  return results;
}

// ---------------------------------------------------------------------------
// X/Twitter: fetch mentions and respond
// ---------------------------------------------------------------------------

async function checkXReplies(state, dryRun) {
  console.log('[reply-monitor] Checking X/Twitter mentions...');

  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;
  if (!X_API_KEY || !X_ACCESS_TOKEN) {
    console.warn('[reply-monitor] X credentials not configured, skipping');
    return [];
  }

  // Use the post-to-x module for OAuth signing
  let xModule;
  try {
    xModule = require('./post-to-x.js');
  } catch {
    console.warn('[reply-monitor] Could not load post-to-x.js, skipping X');
    return [];
  }

  // Search for recent mentions
  let mentions;
  try {
    mentions = await xModule.searchTweets('mcp-memory-gateway OR ThumbGate OR "pre-action gates"');
  } catch (err) {
    console.warn(`[reply-monitor] X search failed: ${err.message}`);
    return [];
  }

  if (!mentions || !mentions.data) {
    console.log('[reply-monitor] No X mentions found');
    return [];
  }

  const results = [];
  for (const tweet of mentions.data) {
    const tweetId = tweet.id;
    if (state.repliedTo[`x_${tweetId}`]) continue;

    console.log(`[reply-monitor] New X mention: "${tweet.text.slice(0, 80)}..."`);

    const isQuestion = /\?/.test(tweet.text);
    const generatedReply = await generateReply(tweet.text, {
      platform: 'x',
      isQuestion,
    });

    if (!generatedReply) continue;

    // Truncate to 280 chars for Twitter
    const truncated = generatedReply.slice(0, 275) + (generatedReply.length > 275 ? '...' : '');

    console.log(`[reply-monitor] Generated X reply: "${truncated.slice(0, 100)}..."`);

    if (dryRun) {
      results.push({ tweetId, reply: truncated, posted: false });
      continue;
    }

    try {
      await xModule.postTweet(truncated, tweetId);
      state.repliedTo[`x_${tweetId}`] = { at: new Date().toISOString(), platform: 'x' };
      results.push({ tweetId, reply: truncated, posted: true });
      console.log(`[reply-monitor] Replied to tweet ${tweetId}`);
    } catch (err) {
      console.warn(`[reply-monitor] Failed to reply to tweet ${tweetId}: ${err.message}`);
    }
  }

  state.lastCheck.x = new Date().toISOString();
  return results;
}

// ---------------------------------------------------------------------------
// LinkedIn: check for comments on our posts
// ---------------------------------------------------------------------------

async function checkLinkedInReplies(state, dryRun) {
  console.log('[reply-monitor] Checking LinkedIn comments...');

  const { LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN } = process.env;
  if (!LINKEDIN_ACCESS_TOKEN || !LINKEDIN_PERSON_URN) {
    console.warn('[reply-monitor] LinkedIn credentials not configured, skipping');
    return [];
  }

  // LinkedIn's comment API is restrictive — log a note for now
  console.log('[reply-monitor] LinkedIn comment monitoring requires Community Management API approval.');
  console.log('[reply-monitor] Once approved, this will auto-fetch and reply to comments on our posts.');

  state.lastCheck.linkedin = new Date().toISOString();
  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function monitor({ platforms, dryRun } = {}) {
  const state = loadState();
  const allPlatforms = platforms || ['reddit', 'x', 'linkedin'];
  const allResults = {};

  for (const platform of allPlatforms) {
    try {
      if (platform === 'reddit') allResults.reddit = await checkRedditReplies(state, dryRun);
      else if (platform === 'x') allResults.x = await checkXReplies(state, dryRun);
      else if (platform === 'linkedin') allResults.linkedin = await checkLinkedInReplies(state, dryRun);
    } catch (err) {
      console.error(`[reply-monitor] ${platform} error: ${err.message}`);
      allResults[platform] = { error: err.message };
    }
  }

  saveState(state);

  const totalReplies = Object.values(allResults)
    .flat()
    .filter((r) => r && !r.error && r.posted).length;
  console.log(`\n[reply-monitor] Done. ${totalReplies} replies posted.`);

  return allResults;
}

module.exports = { monitor, generateReply };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  function getArg(flag) {
    const prefix = `${flag}=`;
    const entry = args.find((a) => a.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }

  const platformArg = getArg('--platform');
  const platforms = platformArg ? [platformArg] : null;

  // Load .env
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx);
        const value = trimmed.slice(eqIdx + 1);
        if (!process.env[key]) process.env[key] = value;
      }
    }
  }

  monitor({ platforms, dryRun })
    .then((results) => {
      console.log('\n[reply-monitor] Summary:', JSON.stringify(results, null, 2));
    })
    .catch((err) => {
      console.error('[reply-monitor] Fatal:', err.message);
      process.exit(1);
    });
}
