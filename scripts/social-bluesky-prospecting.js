#!/usr/bin/env node
'use strict';

/**
 * social-bluesky-prospecting.js
 *
 * Finds relevant Bluesky posts outside our owned threads and queues technical
 * ThumbGate reply drafts. This is intentionally draft-only: public replies are
 * representational communication and must be approved before publishing.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnv } = require('./social-analytics/load-env');
const {
  DEFAULT_PDS_HOST,
  atprotoRequest,
  createSession,
  isTransientAtprotoError,
  parseAtUri,
  sanitizeForLog,
} = require('./lib/bluesky-atproto');

loadLocalEnv();

const DEFAULT_STATE_FILE = path.resolve(__dirname, '..', '.thumbgate', 'bluesky-prospect-state.json');
const DEFAULT_DRAFT_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-drafts.jsonl');
const DEFAULT_LIMIT_PER_QUERY = 12;
const DEFAULT_MAX_DRAFTS = 5;
const MAX_REPLY_CHARS = 290;

const DEFAULT_QUERIES = [
  'Claude Code repeating mistakes',
  'AI agent deleted files',
  'MCP tool call mistake',
  'AI agent memory bug',
  'Cursor agent made same mistake',
  'coding agent guardrails',
  'local first AI agents',
  'agent workflow reliability',
];

function resolveRuntimeFile(envName, defaultPath) {
  const configured = process.env[envName];
  return configured ? path.resolve(configured) : defaultPath;
}

function getStateFile() {
  return resolveRuntimeFile('THUMBGATE_BLUESKY_PROSPECT_STATE_FILE', DEFAULT_STATE_FILE);
}

function getDraftFile() {
  return resolveRuntimeFile('THUMBGATE_REPLY_DRAFT_FILE', DEFAULT_DRAFT_FILE);
}

function loadState(stateFile = getStateFile()) {
  try {
    if (fs.existsSync(stateFile)) return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    // Start fresh if state is malformed; prospect dedupe is best-effort.
  }
  return { seen: {}, lastCheck: null };
}

function saveState(state, stateFile = getStateFile()) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function saveDraft(draft, draftFile = getDraftFile()) {
  fs.mkdirSync(path.dirname(draftFile), { recursive: true });
  fs.appendFileSync(draftFile, `${JSON.stringify(draft)}\n`);
}

function parseQueries(value) {
  if (!value) return [...DEFAULT_QUERIES];
  const queries = String(value)
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return queries.length ? queries : [...DEFAULT_QUERIES];
}

function postUrl(post) {
  const parsed = parseAtUri(post.uri);
  const handle = post.author?.handle || parsed?.did || 'unknown';
  return parsed ? `https://bsky.app/profile/${handle}/post/${parsed.rkey}` : '';
}

function normalizeSearchPost(post, query) {
  return {
    uri: post.uri || '',
    cid: post.cid || '',
    text: typeof post.record?.text === 'string' ? post.record.text : '',
    indexedAt: post.indexedAt || '',
    author: {
      did: post.author?.did || '',
      handle: post.author?.handle || 'unknown',
      displayName: post.author?.displayName || '',
    },
    metrics: {
      replies: Number(post.replyCount || 0),
      reposts: Number(post.repostCount || 0),
      likes: Number(post.likeCount || 0),
    },
    query,
  };
}

function isOwnPost(post, session) {
  const authorDid = post.author?.did || '';
  const authorHandle = post.author?.handle || '';
  return Boolean(
    authorDid && session?.did && authorDid === session.did
  ) || Boolean(
    authorHandle && session?.handle && authorHandle === session.handle
  );
}

function scoreProspect(post) {
  const text = String(post.text || '').toLowerCase();
  if (!text.trim()) return { score: 0, reasons: ['empty'] };

  const negative = [
    'spam',
    'giveaway',
    'crypto',
    'airdrop',
    'nsfw',
    'hiring',
    'job opening',
    'politics',
  ];
  if (negative.some((term) => text.includes(term))) {
    return { score: 0, reasons: ['off_topic_or_low_trust'] };
  }

  const weighted = [
    [8, 'repeated_mistake', /\b(repeat|again|same mistake|keeps? doing|keeps? breaking|regression)\b/],
    [8, 'dangerous_action', /\b(delete|deleted|rm -rf|drop table|force push|overwrite|credential|secret|charged twice)\b/],
    [7, 'agent_tooling', /\b(agent|coding agent|ai agent|claude code|cursor|cline|roo code|gemini cli|mcp)\b/],
    [6, 'memory_context', /\b(memory|context|remember|forgot|session|instruction|claude\.md|rules?)\b/],
    [5, 'guardrail_need', /\b(guardrail|approval|policy|prevent|block|pre.?action|hook|firewall|governance)\b/],
    [4, 'team_workflow', /\b(team|workflow|repo|production|deploy|ci|review)\b/],
  ];

  const reasons = [];
  let score = 0;
  for (const [weight, reason, pattern] of weighted) {
    if (pattern.test(text)) {
      score += weight;
      reasons.push(reason);
    }
  }

  const engagement = (post.metrics?.replies || 0) + (post.metrics?.reposts || 0) + (post.metrics?.likes || 0);
  if (engagement > 5) {
    score += 2;
    reasons.push('has_engagement');
  }

  return { score, reasons };
}

function buildProspectReply(post, scored) {
  const text = String(post.text || '').toLowerCase();
  let reply;

  if (/delete|rm -rf|drop table|force push|overwrite|secret|credential/.test(text)) {
    reply = 'This is the failure mode where memory alone is too weak. ThumbGate turns a thumbs-down into a local Pre-Action Gate, so the next risky tool call is blocked before it runs instead of merely documented after the damage.';
  } else if (/same mistake|repeat|again|keeps? doing|regression/.test(text)) {
    reply = 'The expensive part is not the first agent mistake; it is paying for the same mistake twice. ThumbGate is built around that loop: capture the failure, promote it into an inspectable local rule, then stop the repeat before execution.';
  } else if (/memory|context|remember|forgot|session/.test(text)) {
    reply = 'Agent memory helps recall context, but recall is not enforcement. The useful boundary is: “remember this” plus “block me if I try the rejected action again.” That is the ThumbGate lane: local-first memory that can become a pre-action guard.';
  } else {
    reply = 'This is why I think agent governance needs to sit before the tool call, not only in dashboards after the fact. ThumbGate focuses on local-first Pre-Action Gates: turn concrete thumbs-down feedback into enforceable checks before the next run.';
  }

  if (scored?.reasons?.includes('team_workflow') && reply.length < 235) {
    reply += ' That makes it easier to promote only the proven team-safe rules instead of sharing every local quirk.';
  }

  return reply.length <= MAX_REPLY_CHARS ? reply : `${reply.slice(0, MAX_REPLY_CHARS - 1).trim()}…`;
}

async function searchPosts(session, query, {
  request = atprotoRequest,
  limit = DEFAULT_LIMIT_PER_QUERY,
} = {}) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    sort: 'latest',
  });
  const { status, json } = await request(
    'GET',
    DEFAULT_PDS_HOST,
    `/xrpc/app.bsky.feed.searchPosts?${params.toString()}`,
    { headers: { Authorization: `Bearer ${session.accessJwt}` } },
  );
  if (status !== 200) {
    throw new Error(`searchPosts failed for "${query}": ${status} ${json.error || ''}`);
  }
  return (json.posts || []).map((post) => normalizeSearchPost(post, query));
}

async function prospectBluesky({
  sessionFactory = createSession,
  searchPosts: searchPostsFn = searchPosts,
  loadState: loadStateFn = loadState,
  saveState: saveStateFn = saveState,
  saveDraft: saveDraftFn = saveDraft,
  queries = parseQueries(process.env.THUMBGATE_BLUESKY_PROSPECT_QUERIES),
  limitPerQuery = DEFAULT_LIMIT_PER_QUERY,
  maxDrafts = DEFAULT_MAX_DRAFTS,
  minScore = 12,
  dryRun = false,
  now = () => new Date(),
} = {}) {
  const session = await sessionFactory();
  const state = loadStateFn();
  state.seen = state.seen || {};

  const candidates = [];
  for (const query of queries) {
    const posts = await searchPostsFn(session, query, { limit: limitPerQuery });
    for (const post of posts) {
      if (!post.uri || state.seen[post.uri] || isOwnPost(post, session)) continue;
      const scored = scoreProspect(post);
      if (scored.score < minScore) continue;
      candidates.push({ post, scored });
    }
  }

  candidates.sort((a, b) => b.scored.score - a.scored.score);
  const selected = candidates.slice(0, maxDrafts);
  const createdAt = now().toISOString();
  const drafts = [];

  for (const { post, scored } of selected) {
    const draftReply = buildProspectReply(post, scored);
    const draft = {
      platform: 'bluesky',
      kind: 'prospect_reply',
      createdAt,
      prospect: {
        uri: post.uri,
        cid: post.cid,
        url: postUrl(post),
        query: post.query,
        authorHandle: post.author.handle,
        authorDid: post.author.did,
        score: scored.score,
        reasons: scored.reasons,
      },
      incomingText: post.text,
      draftReply,
      reply: {
        root: { uri: post.uri, cid: post.cid },
        parent: { uri: post.uri, cid: post.cid },
      },
      approved: false,
      autoPost: false,
    };
    drafts.push(draft);

    if (!dryRun) {
      saveDraftFn(draft);
      state.seen[post.uri] = {
        queuedAt: createdAt,
        score: scored.score,
        query: post.query,
      };
    }
  }

  if (!dryRun) {
    state.lastCheck = createdAt;
    saveStateFn(state);
  }

  for (const draft of drafts) {
    console.log(
      `[bluesky-prospect] queued score=${draft.prospect.score} @${sanitizeForLog(draft.prospect.authorHandle)} ${sanitizeForLog(draft.prospect.url)}`,
    );
  }
  console.log(
    `[bluesky-prospect] queries=${queries.length} candidates=${candidates.length} queued=${dryRun ? 0 : drafts.length} dryRun=${dryRun}`,
  );

  return {
    queries: queries.length,
    candidates: candidates.length,
    queued: dryRun ? 0 : drafts.length,
    drafts,
    dryRun,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const getValue = (name, fallback) => {
    const prefix = `${name}=`;
    const item = argv.find((arg) => arg.startsWith(prefix));
    return item ? item.slice(prefix.length) : fallback;
  };
  return {
    dryRun: args.has('--dry-run'),
    limitPerQuery: Number(getValue('--limit-per-query', DEFAULT_LIMIT_PER_QUERY)),
    maxDrafts: Number(getValue('--max-drafts', DEFAULT_MAX_DRAFTS)),
    minScore: Number(getValue('--min-score', 12)),
    queries: parseQueries(getValue('--queries', process.env.THUMBGATE_BLUESKY_PROSPECT_QUERIES || '')),
  };
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  const options = parseArgs();
  prospectBluesky(options).catch((err) => {
    if (isTransientAtprotoError(err)) {
      console.warn(`[bluesky-prospect] transient upstream error — retry next tick: ${sanitizeForLog(err.message)}`);
      process.exit(0);
    }
    console.error(`[bluesky-prospect] FAIL: ${sanitizeForLog(err.message)}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_QUERIES,
  buildProspectReply,
  isOwnPost,
  normalizeSearchPost,
  parseQueries,
  postUrl,
  prospectBluesky,
  scoreProspect,
  searchPosts,
};
