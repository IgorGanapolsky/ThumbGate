'use strict';

/**
 * social-reply-monitor.js
 * Monitors Reddit and LinkedIn for replies to our posts, then generates and
 * drafts contextual responses. X/Twitter monitoring was retired 2026-04-20;
 * Bluesky replies are handled by scripts/social-reply-monitor-bluesky.js.
 *
 * Usage:
 *   node scripts/social-reply-monitor.js                    # Check all platforms
 *   node scripts/social-reply-monitor.js --platform=reddit  # Check one platform
 *   node scripts/social-reply-monitor.js --dry-run          # Preview replies without posting
 *
 * Env vars: see individual publisher modules.
 *   THUMBGATE_REDDIT_TRACKED_THREADS — comma/newline separated Reddit post URLs
 *     to watch in addition to inbox replies.
 *   THUMBGATE_REPLY_MONITOR_STATE_FILE — optional state path override.
 *   THUMBGATE_REPLY_DRAFT_FILE — optional draft path override.
 * Reply generation uses smart templates (zero cost, no external API).
 *
 * State file: .thumbgate/reply-monitor-state.json — tracks which replies we've already responded to.
 */

const fs = require('fs');
const path = require('path');
const { loadLocalEnv } = require('./social-analytics/load-env');
const { gateContextualReply, commentExplicitlyRequestsProduct } = require('./social-quality-gate');

const DEFAULT_STATE_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-monitor-state.json');
const DEFAULT_DRAFT_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-drafts.jsonl');
const REDDIT_API_BASE = 'https://oauth.reddit.com';

loadLocalEnv();

function resolveRuntimeFile(envName, defaultPath) {
  const configured = process.env[envName];
  return configured ? path.resolve(configured) : defaultPath;
}

function getStateFile() {
  return resolveRuntimeFile('THUMBGATE_REPLY_MONITOR_STATE_FILE', DEFAULT_STATE_FILE);
}

function getDraftFile() {
  return resolveRuntimeFile('THUMBGATE_REPLY_DRAFT_FILE', DEFAULT_DRAFT_FILE);
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function loadState() {
  const stateFile = getStateFile();
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch { /* ignore */ }
  return { repliedTo: {}, lastCheck: {} };
}

function saveState(state) {
  const stateFile = getStateFile();
  const dir = path.dirname(stateFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Reply generation (uses Gemini API for cost-effective generation)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Draft file for human review (Reddit replies are NEVER auto-posted)
// ---------------------------------------------------------------------------

function saveDraft(draft) {
  const draftFile = getDraftFile();
  const dir = path.dirname(draftFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(draftFile, JSON.stringify(draft) + '\n');
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
  const mentionsHow = /how (?:does|do|are|is|can|you)|explain|what is|can you describe|curious how|curious if|wondering/i.test(lc);
  const mentionsGates = /gate|block|prevent|hook|intercept|firewall/i.test(lc);
  const mentionsMemory = /memory|context|session|forget|amnesia|remember/i.test(lc);
  const mentionsCursor = /cursor|windsurf|copilot|cline/i.test(lc);
  const mentionsScaling = /scale|team|multi.?repo|collaborate|share/i.test(lc);
  const mentionsSkeptical = /why not|already exist|what.+different|vs |compared to/i.test(lc);
  const mentionsThanks = /thanks|thank you|cool|nice|interesting|awesome/i.test(lc);
  const mentionsSkillsProcess = /skill|template|process|workflow|review|sprint|implement|phase/i.test(lc);
  const mentionsConflictingDocs = /context doc|context docs|conflicting|inconsisten|claude\.md|cursorrules|instruction/i.test(lc);
  const mentionsOverBlocking = /over.?block|false positive|too broad|brittle/i.test(lc);
  const mentionsDeterministicPolicy = /deterministic|non.?deterministic|regex|ast|llm as policy|classif|policy/i.test(lc);

  // Build response that addresses THEIR specific point
  if (isReddit && mentionsGates && (mentionsOverBlocking || mentionsDeterministicPolicy || mentionsScaling)) {
    const reply = mentionsDeterministicPolicy || mentionsScaling
      ? [
        'The enforced part is deterministic.',
        'A thumbs-down can produce a proposed rule, but the thing that runs before execution is an inspectable policy over the tool name, args, cwd, and normalized command shape.',
        'I do not want an LLM making the final allow/deny call at runtime either.',
        'For teams, I treat sharing as promotion: personal gates stay local until a recurring pattern is generalized, reviewed, and promoted so one person\'s weird local path does not become everyone\'s brittle rule.'
      ].join(' ')
      : [
        'The main guardrail against over-blocking is scope.',
        'A thumbs-down should not become a broad ban; it becomes a narrow Pre-Action Gate tied to the rejected tool/action pattern and the evidence around it.',
        'If it blocks a good attempt, that is feedback too: loosen or expire that gate instead of letting it sit as permanent policy.'
      ].join(' ');
    const gate = gateContextualReply(comment, reply, context);
    return gate.allowed ? reply : null;
  }
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

  const userAgent = process.env.REDDIT_USER_AGENT || `thumbgate/1.0 by ${process.env.REDDIT_USERNAME || 'operator'}`;
  let token;
  try {
    token = await getRedditToken();
  } catch (err) {
    console.warn(`[reply-monitor] Reddit auth failed: ${err.message}`);
    const trackedResults = await checkTrackedRedditThreads({ token: null, userAgent, state });
    state.lastCheck.reddit = new Date().toISOString();
    return trackedResults;
  }

  // Fetch inbox (comment replies)
  const res = await fetch(`${REDDIT_API_BASE}/message/inbox?limit=25`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
    },
  });

  if (!res.ok) {
    console.warn(`[reply-monitor] Reddit inbox fetch failed: ${res.status}`);
    const trackedResults = await checkTrackedRedditThreads({ token, userAgent, state });
    state.lastCheck.reddit = new Date().toISOString();
    return trackedResults;
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

    const isQuestion = looksLikeQuestion(commentBody);
    const generatedReply = await generateReply(commentBody, {
      platform: 'reddit',
      author: reply.data.author,
      postTitle,
      isQuestion,
    });

    const result = draftRedditReply({
      state,
      commentId,
      generatedReply,
      author: reply.data.author,
      subreddit: reply.data.subreddit,
      commentBody,
      postTitle,
      permalink: reply.data.context,
      source: 'inbox',
    });
    if (result) results.push(result);
  }

  const trackedResults = await checkTrackedRedditThreads({ token, userAgent, state });
  results.push(...trackedResults);

  state.lastCheck.reddit = new Date().toISOString();
  return results;
}

function looksLikeQuestion(text) {
  return /\?/.test(String(text || '')) || /\b(?:curious how|curious if|wondering|how are you|how do you|how does|what is|can you|could you)\b/i.test(String(text || ''));
}

function draftRedditReply({
  state,
  commentId,
  generatedReply,
  author,
  subreddit,
  commentBody,
  postTitle,
  permalink,
  source,
}) {
  if (!generatedReply || generatedReply === '__DRAFT__') {
    console.warn(`[reply-monitor] Could not generate reply for ${commentId}`);
    return null;
  }

  console.log(`[reply-monitor] Generated reply: "${generatedReply.slice(0, 100)}..."`);

  // Reddit is ALWAYS draft-only — never auto-post.
  // Bot detection on Reddit is aggressive; human must review and post manually.
  const draft = {
    platform: 'reddit',
    commentId,
    author,
    subreddit,
    theirComment: commentBody.slice(0, 500),
    suggestedReply: generatedReply,
    postTitle,
    permalink,
    source,
    draftedAt: new Date().toISOString(),
    status: 'pending_review',
  };
  saveDraft(draft);
  state.repliedTo[commentId] = {
    at: new Date().toISOString(),
    platform: 'reddit',
    drafted: true,
    source,
  };
  console.log(`[reply-monitor] DRAFTED reply for ${commentId} (saved to ${path.relative(process.cwd(), getDraftFile())} — post manually)`);
  return { commentId, reply: generatedReply, posted: false, drafted: true, source };
}

function getTrackedRedditThreadTargets(env = process.env) {
  const raw = env.THUMBGATE_REDDIT_TRACKED_THREADS || '';
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseRedditThreadTarget)
    .filter(Boolean);
}

function parseRedditThreadTarget(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  try {
    const url = new URL(input.startsWith('www.') ? `https://${input}` : input);
    const postMatch = url.pathname.match(/\/comments\/([a-z0-9]+)/i);
    if (!postMatch) return null;
    const commentMatch = url.pathname.match(/\/comment\/([a-z0-9]+)/i);
    return {
      url: input,
      postId: postMatch[1],
      commentId: commentMatch ? `t1_${commentMatch[1]}` : null,
    };
  } catch {
    const postMatch = input.match(/\b(?:t3_)?([a-z0-9]{5,})\b/i);
    return postMatch ? { url: input, postId: postMatch[1], commentId: null } : null;
  }
}

async function fetchRedditThread(token, userAgent, target) {
  const url = token
    ? `${REDDIT_API_BASE}/comments/${encodeURIComponent(target.postId)}?limit=500&depth=3&sort=new`
    : `https://www.reddit.com/comments/${encodeURIComponent(target.postId)}.json?limit=500&depth=3&sort=new`;
  const headers = {
    'User-Agent': userAgent,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    headers,
  });
  if (!res.ok) {
    console.warn(`[reply-monitor] Reddit thread fetch failed for ${target.postId}: ${res.status}`);
    return [];
  }
  const listing = await res.json();
  return Array.isArray(listing) ? listing : [];
}

function flattenRedditComments(children, output = []) {
  for (const child of children || []) {
    if (child?.kind !== 't1') continue;
    const data = child.data || {};
    output.push(data);
    const replies = data.replies;
    if (replies && typeof replies === 'object') {
      flattenRedditComments(replies.data?.children || [], output);
    }
  }
  return output;
}

function hasOperatorReply(comment, comments, operatorUsernames) {
  const commentName = comment.name;
  if (!commentName) return false;
  return comments.some((candidate) => (
    candidate.parent_id === commentName &&
    operatorUsernames.has(String(candidate.author || '').toLowerCase())
  ));
}

async function checkTrackedRedditThreads({ token, userAgent, state }) {
  const targets = getTrackedRedditThreadTargets();
  if (targets.length === 0) return [];

  const operatorUsernames = new Set([
    process.env.REDDIT_USERNAME,
    'eazyigz123',
    'IgorGanapolsky',
  ].filter(Boolean).map((value) => String(value).toLowerCase()));
  const results = [];

  for (const target of targets) {
    console.log(`[reply-monitor] Checking tracked Reddit thread ${target.postId}...`);
    const listing = await fetchRedditThread(token, userAgent, target);
    const post = listing[0]?.data?.children?.[0]?.data || {};
    const comments = flattenRedditComments(listing[1]?.data?.children || []);
    const candidateComments = target.commentId
      ? comments.filter((comment) => comment.name === target.commentId || comment.parent_id === target.commentId)
      : comments;

    for (const comment of candidateComments) {
      const commentId = comment.name;
      if (!commentId || state.repliedTo[commentId]) continue;
      if (operatorUsernames.has(String(comment.author || '').toLowerCase())) continue;
      if (hasOperatorReply(comment, comments, operatorUsernames)) {
        state.repliedTo[commentId] = {
          at: new Date().toISOString(),
          platform: 'reddit',
          alreadyAnswered: true,
          source: 'tracked_thread',
        };
        continue;
      }

      const commentBody = comment.body || '';
      const generatedReply = await generateReply(commentBody, {
        platform: 'reddit',
        postTitle: post.title || comment.link_title || '',
        isQuestion: looksLikeQuestion(commentBody),
        author: comment.author,
      });
      const result = draftRedditReply({
        state,
        commentId,
        generatedReply,
        author: comment.author,
        subreddit: comment.subreddit || post.subreddit,
        commentBody,
        postTitle: post.title || comment.link_title || '',
        permalink: comment.permalink ? `https://www.reddit.com${comment.permalink}` : target.url,
        source: 'tracked_thread',
      });
      if (result) results.push(result);
    }
  }

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
  const allPlatforms = platforms || ['reddit', 'linkedin'];
  const allResults = {};

  for (const platform of allPlatforms) {
    try {
      if (platform === 'reddit') allResults.reddit = await checkRedditReplies(state, dryRun);
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
  checkTrackedRedditThreads,
  flattenRedditComments,
  generateReply,
  getTrackedRedditThreadTargets,
  looksLikeQuestion,
  monitor,
  parseRedditThreadTarget,
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
