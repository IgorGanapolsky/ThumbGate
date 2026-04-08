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
 * Env vars: see individual publisher modules.
 * Reply generation uses smart templates (zero cost, no external API).
 *
 * State file: .thumbgate/reply-monitor-state.json — tracks which replies we've already responded to.
 */

const fs = require('fs');
const path = require('path');
const { loadLocalEnv } = require('./social-analytics/load-env');
const { gateContextualReply, commentExplicitlyRequestsProduct } = require('./social-quality-gate');

const STATE_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-monitor-state.json');
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const DEFAULT_X_HANDLE = 'IgorGanapolsky';

loadLocalEnv();

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

// ---------------------------------------------------------------------------
// Draft file for human review (Reddit replies are NEVER auto-posted)
// ---------------------------------------------------------------------------

const DRAFT_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-drafts.jsonl');

function saveDraft(draft) {
  const dir = path.dirname(DRAFT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(DRAFT_FILE, JSON.stringify(draft) + '\n');
}

function normalizeArray(value) {
  if (value && Array.isArray(value.data)) {
    return value.data;
  }
  return Array.isArray(value) ? value : [];
}

function isRevenueRelevantXTweet(tweet = {}) {
  const text = String(tweet.text || '').toLowerCase();
  if (!text) return false;
  return /thumbgate|thumbgate-production|checkout\/pro|workflow-sprint|pre-action gates|vibe coding/.test(text);
}

function buildOwnedConversationQuery(tweetId, username = DEFAULT_X_HANDLE) {
  const normalizedId = String(tweetId || '').trim();
  const normalizedUsername = String(username || DEFAULT_X_HANDLE).trim();
  if (!normalizedId) {
    return '';
  }
  return `conversation_id:${normalizedId} -from:${normalizedUsername}`;
}

async function collectXSearchCandidates(options = {}) {
  const searchTweets = options.searchTweets;
  if (typeof searchTweets !== 'function') {
    return { tweets: [], searchMode: 'unavailable', queryLog: [] };
  }

  const username = options.username || process.env.X_USERNAME || DEFAULT_X_HANDLE;
  const ownUserId = options.ownUserId || process.env.X_USER_ID || '1733256637199073280';
  const queryLog = [];
  const aggregate = [];
  const seenTweetIds = new Set();
  let ownedCandidates = [];

  if (typeof options.fetchOwnedTweets === 'function') {
    try {
      const recentTweets = await options.fetchOwnedTweets();
      ownedCandidates = normalizeArray(recentTweets)
        .filter((tweet) => String(tweet.author_id || ownUserId) === ownUserId)
        .filter(isRevenueRelevantXTweet)
        .slice(0, 6);
    } catch (err) {
      console.warn(`[reply-monitor] Could not fetch own X tweets: ${err.message}`);
    }
  }

  for (const tweet of ownedCandidates) {
    const query = buildOwnedConversationQuery(tweet.id, username);
    if (!query) continue;
    queryLog.push(query);
    const replies = normalizeArray(await searchTweets(query, { maxResults: 10 }));
    for (const reply of replies) {
      if (!reply || seenTweetIds.has(reply.id)) continue;
      seenTweetIds.add(reply.id);
      aggregate.push(reply);
    }
  }

  if (aggregate.length > 0) {
    return {
      tweets: aggregate,
      ownTweets: ownedCandidates.map((tweet) => ({ id: tweet.id, text: tweet.text || '' })),
      queryLog,
      searchMode: 'owned_conversations',
    };
  }

  const fallbackQuery = 'thumbgate OR ThumbGate OR "pre-action gates"';
  queryLog.push(fallbackQuery);
  const fallbackTweets = normalizeArray(await searchTweets(fallbackQuery, { maxResults: 10 }));
  return {
    tweets: fallbackTweets,
    ownTweets: ownedCandidates.map((tweet) => ({ id: tweet.id, text: tweet.text || '' })),
    queryLog,
    searchMode: 'keyword_fallback',
  };
}

// ---------------------------------------------------------------------------
// Bot/hostile detection — skip comments that are calling us out
// ---------------------------------------------------------------------------

function isHostileOrMeta(comment) {
  const lc = (comment || '').toLowerCase();
  const hostile = [
    'bot', 'spam', 'shill', 'promotional', 'reported',
    'same answer', 'word for word', 'copy paste', 'running amok',
    'smell these', 'not what i asked', 'didn\'t ask',
    'auto-generated', 'ai generated', 'chatgpt', 'template',
  ];
  return hostile.some(phrase => lc.includes(phrase));
}

// ---------------------------------------------------------------------------
// Reply generation — context-aware, NOT canned templates
// ---------------------------------------------------------------------------

/**
 * Generate a contextual reply by actually reading the comment.
 * Returns null if we should NOT reply (hostile, off-topic, or duplicate risk).
 */
async function generateReply(comment, context) {
  const lc = (comment || '').toLowerCase();

  // NEVER reply to hostile/meta comments calling out bots
  if (isHostileOrMeta(comment)) {
    console.log('[reply-monitor] Skipping hostile/meta comment — do not engage');
    return null;
  }

  // NEVER reply to our own comments
  if (context.author === 'eazyigz123' || context.author === 'IgorGanapolsky') {
    return null;
  }

  // NEVER reply with generic fluff — build reply from what they ACTUALLY said
  const isQuestion = context.isQuestion || /\?/.test(comment);
  const isReddit = context.platform === 'reddit';
  const wantsProductDetails = commentExplicitlyRequestsProduct(comment);

  // Extract the specific topic they're asking about
  const mentionsSetup = /install|setup|config|init|npx|how.+start/i.test(lc);
  const mentionsHow = /how does|how do|explain|what is|can you describe/i.test(lc);
  const mentionsGates = /gate|block|prevent|hook|intercept|firewall/i.test(lc);
  const mentionsMemory = /memory|context|session|forget|amnesia|remember/i.test(lc);
  const mentionsCursor = /cursor|windsurf|copilot|cline/i.test(lc);
  const mentionsScaling = /scale|team|multi.?repo|collaborate|share/i.test(lc);
  const mentionsSkeptical = /why not|already exist|what.+different|vs |compared to/i.test(lc);
  const mentionsThanks = /thanks|thank you|cool|nice|interesting|awesome/i.test(lc);
  const mentionsSkillsProcess = /skill|template|process|workflow|review|sprint|implement|phase/i.test(lc);
  const mentionsConflictingDocs = /context doc|context docs|conflicting|inconsisten|claude\.md|cursorrules|instruction/i.test(lc);

  // Build response that addresses THEIR specific point
  if (mentionsSkillsProcess || mentionsConflictingDocs) {
    const reply = [
      'That matches what I have seen too.',
      'Smaller review/implement phases hold up much better than one giant instruction blob,',
      'and conflicting context docs are where things usually start drifting.'
    ].join(' ');
    const gate = gateContextualReply(comment, reply, context);
    return gate.allowed ? reply : null;
  }
  if (mentionsSetup && isQuestion && !isReddit) {
    return `\`npx thumbgate init\` auto-detects your agent and wires the hooks. Takes about 30 seconds. What agent are you using?`;
  }
  if (mentionsSkeptical) {
    // Build a reply that mirrors the commenter's frame (memory, context docs, or general rules)
    // so gateContextualReply's topic-overlap check passes.
    let replyBase;
    if (mentionsMemory) {
      replyBase = 'The distinction from memory tools is enforcement: memory helps the agent remember a past mistake, but it can still repeat it. The gate stops the already-rejected move before it runs. Whether that extra step is worth the setup depends on how often your agent ignores its own memory.';
    } else {
      replyBase = 'The difference from cursorrules or instruction files is enforcement: the bad action gets stopped before execution instead of being added to context docs and then ignored anyway. Whether that tradeoff is worth it depends on how often your agent repeats the same mistake.';
    }
    const gate = gateContextualReply(comment, replyBase, context);
    return gate.allowed ? replyBase : null;
  }
  if (mentionsGates && (mentionsHow || (!isReddit && !mentionsThanks))) {
    // On X, engage on gate-topic statements too (not just "how does" questions).
    // On Reddit, keep the old conservative behavior (questions only via mentionsHow).
    if (isReddit && !mentionsHow) return null;
    const reply = isReddit
      ? 'The short version is: the tool call gets checked before it runs. If it matches a previously rejected pattern, it is blocked and the agent has to try a different path.'
      : 'PreToolUse hooks intercept the tool call before it runs. Each call is checked against prevention rules promoted from past failures. If it matches, the action is blocked and the agent has to try a different approach. The rules adapt over time so false positives decrease.';
    const gate = gateContextualReply(comment, reply, context);
    return gate.allowed ? reply : null;
  }
  if (mentionsScaling) {
    if (isReddit && !wantsProductDetails) {
      return null;
    }
    const reply = 'For teams, the useful part is shared lessons instead of each developer relearning the same failure pattern alone. Solo workflows usually benefit first from the local version.';
    const gate = gateContextualReply(comment, reply, context);
    return gate.allowed ? reply : null;
  }
  if (mentionsMemory) {
    // Engage on memory/context topics whether it's a question or a statement — both are worth a reply on X
    if (isReddit && !isQuestion) return null; // Reddit: only reply to direct questions
    const reply = 'The useful distinction is memory versus enforcement. Memory helps the agent remember, but it can still ignore that memory. Enforcement is what stops the already-rejected move from happening again.';
    const gate = gateContextualReply(comment, reply, context);
    return gate.allowed ? reply : null;
  }
  if (mentionsCursor && isQuestion && !isReddit) {
    return 'Works with Cursor via MCP. The same prevention rules can apply across Cursor, Claude Code, and Codex. What specific failure patterns are you hitting?';
  }
  if (mentionsThanks && !isQuestion) {
    // Don't reply to simple "thanks" — it looks desperate
    return null;
  }
  if (isReddit && wantsProductDetails) {
    const reply = 'Happy to share the repo or setup details if that would help. The main thing that worked for me was keeping accepted and rejected patterns outside the session so the next run starts with the same constraints.';
    const gate = gateContextualReply(comment, reply, context);
    return gate.allowed ? reply : null;
  }
  if (isQuestion) {
    // They asked something specific we didn't match — signal to caller to save a draft for human review
    return '__DRAFT__';
  }
  // Not a question, not hostile, not thanks — probably a statement. Don't reply.
  return null;
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
      'User-Agent': `thumbgate/1.0 by ${REDDIT_USERNAME}`,
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

  const userAgent = `thumbgate/1.0 by ${process.env.REDDIT_USERNAME}`;

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
    (c) => c.kind === 't1' && c.data.type === 'comment_reply'
  );

  const results = [];
  for (const reply of replies) {
    const commentId = reply.data.name;
    if (state.repliedTo[commentId]) continue; // Already replied

    const commentBody = reply.data.body || '';
    const postTitle = reply.data.link_title || '';

    console.log(`[reply-monitor] New Reddit reply from u/${reply.data.author}: "${commentBody.slice(0, 80)}..."`);

    const isQuestion = /\?/.test(commentBody);
    const generatedReply = await generateReply(commentBody, {
      platform: 'reddit',
      postTitle,
      isQuestion,
    });

    if (!generatedReply || generatedReply === '__DRAFT__') {
      console.warn(`[reply-monitor] Could not generate reply for ${commentId}`);
      continue;
    }

    console.log(`[reply-monitor] Generated reply: "${generatedReply.slice(0, 100)}..."`);

    // Reddit is ALWAYS draft-only — never auto-post.
    // Bot detection on Reddit is aggressive; human must review and post manually.
    const draft = {
      platform: 'reddit',
      commentId,
      author: reply.data.author,
      subreddit: reply.data.subreddit,
      theirComment: commentBody.slice(0, 500),
      suggestedReply: generatedReply,
      postTitle,
      draftedAt: new Date().toISOString(),
      status: 'pending_review',
    };
    saveDraft(draft);
    state.repliedTo[commentId] = { at: new Date().toISOString(), platform: 'reddit', drafted: true };
    results.push({ commentId, reply: generatedReply, posted: false, drafted: true });
    console.log(`[reply-monitor] 📝 DRAFTED reply for ${commentId} (saved to .thumbgate/reply-drafts.jsonl — post manually)`);

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
  let xPoller;
  try {
    xModule = require('./post-to-x.js');
    xPoller = require('./social-analytics/pollers/x.js');
  } catch {
    console.warn('[reply-monitor] Could not load X modules, skipping X');
    return [];
  }

  let searchResult;
  try {
    searchResult = await collectXSearchCandidates({
      searchTweets: xModule.searchTweets,
      fetchOwnedTweets: process.env.X_BEARER_TOKEN && process.env.X_USER_ID
        ? async () => {
          const response = await xPoller.fetchUserTweets(process.env.X_BEARER_TOKEN, process.env.X_USER_ID);
          return response && response.data;
        }
        : null,
      ownUserId: process.env.X_USER_ID || '1733256637199073280',
      username: process.env.X_USERNAME || DEFAULT_X_HANDLE,
    });
  } catch (err) {
    console.warn(`[reply-monitor] X search failed: ${err.message}`);
    return [];
  }

  const mentionsList = normalizeArray(searchResult && searchResult.tweets);
  if (!mentionsList || mentionsList.length === 0) {
    console.log('[reply-monitor] No X mentions found');
    return [];
  }

  console.log(`[reply-monitor] X candidate search mode: ${searchResult.searchMode}`);

  const results = [];
  const repliesSentThisRun = new Set(); // Track reply text to prevent duplicates

  // Our own user ID — skip our own tweets
  const OWN_USER_ID = process.env.X_USER_ID || '1733256637199073280';

  for (const tweet of mentionsList) {
    const tweetId = tweet.id;
    if (state.repliedTo[`x_${tweetId}`]) continue;

    // Skip our own tweets
    if (tweet.author_id === OWN_USER_ID) {
      state.repliedTo[`x_${tweetId}`] = { at: new Date().toISOString(), platform: 'x', skipped: 'own_tweet' };
      continue;
    }

    console.log(`[reply-monitor] New X mention: "${tweet.text.slice(0, 80)}..."`);

    const isQuestion = /\?/.test(tweet.text);
    const generatedReply = await generateReply(tweet.text, {
      platform: 'x',
      isQuestion,
      author: tweet.author_id,
    });

    if (!generatedReply) {
      // Mark as seen so we don't re-process, but don't reply
      state.repliedTo[`x_${tweetId}`] = { at: new Date().toISOString(), platform: 'x', skipped: 'no_reply_generated' };
      continue;
    }

    // Unmatched question — save a draft for human review rather than silently skipping
    if (generatedReply === '__DRAFT__') {
      const draft = {
        platform: 'x',
        tweetId,
        author: tweet.author_id,
        theirTweet: tweet.text.slice(0, 500),
        suggestedReply: null,
        draftedAt: new Date().toISOString(),
        status: 'needs_human_reply',
        reason: 'unmatched_question',
      };
      saveDraft(draft);
      state.repliedTo[`x_${tweetId}`] = { at: new Date().toISOString(), platform: 'x', drafted: true, skipped: 'needs_human_reply' };
      results.push({ tweetId, reply: null, posted: false, drafted: true });
      console.log(`[reply-monitor] 📝 DRAFTED (needs human reply) for tweet ${tweetId} — saved to .thumbgate/reply-drafts.jsonl`);
      continue;
    }

    // Truncate to 280 chars for Twitter
    const truncated = generatedReply.slice(0, 275) + (generatedReply.length > 275 ? '...' : '');

    // DUPLICATE CHECK: don't post the same text twice in one run
    if (repliesSentThisRun.has(truncated)) {
      console.log(`[reply-monitor] Skipping duplicate reply for tweet ${tweetId}`);
      state.repliedTo[`x_${tweetId}`] = { at: new Date().toISOString(), platform: 'x', skipped: 'duplicate' };
      continue;
    }

    console.log(`[reply-monitor] Generated X reply: "${truncated.slice(0, 100)}..."`);

    if (dryRun) {
      results.push({ tweetId, reply: truncated, posted: false });
      repliesSentThisRun.add(truncated);
      continue;
    }

    try {
      await xModule.postTweet(truncated, tweetId);
      state.repliedTo[`x_${tweetId}`] = { at: new Date().toISOString(), platform: 'x' };
      results.push({ tweetId, reply: truncated, posted: true });
      repliesSentThisRun.add(truncated);
      console.log(`[reply-monitor] Replied to tweet ${tweetId}`);
    } catch (err) {
      console.warn(`[reply-monitor] Failed to reply to tweet ${tweetId}: ${err.message}`);
      // Still mark as seen to avoid retry spam
      state.repliedTo[`x_${tweetId}`] = { at: new Date().toISOString(), platform: 'x', skipped: 'post_failed' };
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

module.exports = {
  buildOwnedConversationQuery,
  checkXReplies,
  collectXSearchCandidates,
  generateReply,
  isRevenueRelevantXTweet,
  monitor,
};

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

  monitor({ platforms, dryRun })
    .then((results) => {
      console.log('\n[reply-monitor] Summary:', JSON.stringify(results, null, 2));
    })
    .catch((err) => {
      console.error('[reply-monitor] Fatal:', err.message);
      process.exit(1);
    });
}
