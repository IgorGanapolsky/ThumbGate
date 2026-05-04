'use strict';

/**
 * social-reply-monitor-bluesky.js
 *
 * Polls Bluesky notifications (replies, mentions, quotes) for our account and
 * queues draft responses into .thumbgate/reply-drafts.jsonl for human review.
 *
 * Default mode never posts. Drafts are reviewed first; publishing requires an
 * approved draft plus the explicit --confirm-publish CLI guard.
 *
 * Env:
 *   BLUESKY_HANDLE          — e.g. iganapolsky.bsky.social
 *   BLUESKY_APP_PASSWORD    — app password (https://bsky.app/settings/app-passwords)
 *
 * Usage:
 *   node scripts/social-reply-monitor-bluesky.js                                # poll + queue drafts
 *   node scripts/social-reply-monitor-bluesky.js --dry-run                      # poll, log what would be queued
 *   node scripts/social-reply-monitor-bluesky.js --publish-approved --dry-run   # count approved publish candidates
 *   node scripts/social-reply-monitor-bluesky.js --publish-approved --confirm-publish
 *
 * State: .thumbgate/reply-monitor-state.json tracks replied-to notification URIs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnv } = require('./social-analytics/load-env');
const { generateReply } = require('./social-reply-monitor');
const {
  atprotoRequest,
  createSession,
  isTransientAtprotoError,
  parseAtUri,
  sanitizeForLog,
  DEFAULT_PDS_HOST,
} = require('./lib/bluesky-atproto');

loadLocalEnv();

const STATE_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-monitor-state.json');
const DRAFT_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-drafts.jsonl');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch { /* ignore */ }
  return { repliedTo: {}, lastCheck: {} };
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function saveDraft(draft) {
  const dir = path.dirname(DRAFT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(DRAFT_FILE, JSON.stringify(draft) + '\n');
}

function loadDrafts(draftFile = DRAFT_FILE) {
  try {
    if (!fs.existsSync(draftFile)) return [];
    return fs.readFileSync(draftFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function listNotifications(session, limit = 40) {
  const host = session.pdsHost || DEFAULT_PDS_HOST;
  const { status, json } = await atprotoRequest(
    'GET',
    host,
    `/xrpc/app.bsky.notification.listNotifications?limit=${limit}`,
    { headers: { Authorization: `Bearer ${session.accessJwt}` } },
  );
  if (status !== 200) {
    throw new Error(`listNotifications failed on ${host}: ${status} ${json.error || ''}`);
  }
  return json.notifications || [];
}

function extractPostText(notification) {
  const rec = notification?.record;
  if (!rec) return '';
  if (typeof rec.text === 'string') return rec.text;
  return '';
}

function buildReplyContext(notification) {
  const text = extractPostText(notification);
  const reply = notification.record?.reply;
  return {
    platform: 'bluesky',
    author: notification.author?.handle || 'unknown',
    isQuestion: /\?/.test(text),
    notificationUri: notification.uri,
    notificationCid: notification.cid,
    rootUri: reply?.root?.uri || notification.uri,
    rootCid: reply?.root?.cid || notification.cid,
    parentUri: notification.uri,
    parentCid: notification.cid,
  };
}

function assertPublishableDraft(draft) {
  if (draft?.platform !== 'bluesky') {
    throw new Error('publishReply requires a Bluesky draft');
  }
  if (!draft.approved) {
    throw new Error('refuse to publish unapproved Bluesky draft');
  }
  if (!draft.draftReply || typeof draft.draftReply !== 'string') {
    throw new Error('approved Bluesky draft is missing draftReply');
  }
  if (!draft.reply?.root?.uri || !draft.reply?.root?.cid || !draft.reply?.parent?.uri || !draft.reply?.parent?.cid) {
    throw new Error('approved Bluesky draft is missing reply root/parent refs');
  }
}

async function publishReply(session, draft, { request = atprotoRequest, now = () => new Date() } = {}) {
  assertPublishableDraft(draft);
  const parent = parseAtUri(draft.reply.parent.uri);
  if (!parent) throw new Error(`bad parent uri: ${draft.reply.parent.uri}`);

  const record = {
    $type: 'app.bsky.feed.post',
    text: draft.draftReply,
    createdAt: now().toISOString(),
    reply: {
      root: draft.reply.root,
      parent: draft.reply.parent,
    },
  };

  const { status, json } = await request(
    'POST',
    session.pdsHost || DEFAULT_PDS_HOST,
    '/xrpc/com.atproto.repo.createRecord',
    {
      headers: { Authorization: `Bearer ${session.accessJwt}` },
      body: {
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      },
    },
  );

  if (status !== 200 || !json.uri) {
    throw new Error(`createRecord failed: ${status} ${json.error || ''}`);
  }
  return { uri: json.uri, cid: json.cid || null, parentUri: draft.reply.parent.uri };
}

async function publishApprovedDrafts({
  sessionFactory = createSession,
  loadDrafts: loadDraftsFn = loadDrafts,
  loadState: loadStateFn = loadState,
  saveState: saveStateFn = saveState,
  publishReply: publishReplyFn = publishReply,
  confirmPublish = false,
  dryRun = false,
} = {}) {
  const drafts = loadDraftsFn()
    .filter((draft) => draft.platform === 'bluesky')
    .filter((draft) => draft.approved === true)
    .filter((draft) => !draft.postedUri);

  if (dryRun) {
    return { eligible: drafts.length, published: 0, dryRun: true };
  }

  if (!confirmPublish) {
    return {
      eligible: drafts.length,
      published: 0,
      blocked: true,
      reason: 'missing_confirm_publish',
    };
  }

  const session = await sessionFactory();
  const state = loadStateFn();
  state.repliedTo = state.repliedTo || {};
  state.repliedTo.bluesky = state.repliedTo.bluesky || {};

  const published = [];
  const failed = [];
  for (const draft of drafts) {
    try {
      const result = await publishReplyFn(session, draft);
      const previousReplyState = state.repliedTo.bluesky[result.parentUri];
      state.repliedTo.bluesky[result.parentUri] = {
        ...(previousReplyState || {}),
        postedAt: new Date().toISOString(),
        postedUri: result.uri,
        postedCid: result.cid,
      };
      published.push(result);
    } catch (err) {
      failed.push({ parentUri: draft.reply?.parent?.uri || draft.notification?.uri || '', error: err.message });
    }
  }

  saveStateFn(state);
  return { eligible: drafts.length, published: published.length, failed: failed.length, results: published, failures: failed };
}

async function monitor({
  sessionFactory = createSession,
  listNotifications: listFn = listNotifications,
  generateReply: generateReplyFn = generateReply,
  saveDraft: saveDraftFn = saveDraft,
  saveState: saveStateFn = saveState,
  loadState: loadStateFn = loadState,
  dryRun = DRY_RUN,
} = {}) {
  const session = await sessionFactory();
  const state = loadStateFn();
  state.repliedTo.bluesky = state.repliedTo.bluesky || {};

  const notifications = await listFn(session);
  const actionable = notifications.filter((n) => ['reply', 'mention', 'quote'].includes(n.reason));

  let queued = 0;
  let skipped = 0;

  for (const n of actionable) {
    if (state.repliedTo.bluesky[n.uri]) { skipped += 1; continue; }
    if (n.author?.handle === session.handle) { skipped += 1; continue; }

    const text = extractPostText(n);
    if (!text) { skipped += 1; continue; }

    const context = buildReplyContext(n);
    const reply = await generateReplyFn(text, context);
    if (!reply) { skipped += 1; continue; }

    const draft = {
      platform: 'bluesky',
      createdAt: new Date().toISOString(),
      notification: {
        uri: n.uri,
        cid: n.cid,
        reason: n.reason,
        indexedAt: n.indexedAt,
        authorHandle: context.author,
        authorDid: n.author?.did,
      },
      incomingText: text,
      draftReply: reply,
      reply: {
        root: { uri: context.rootUri, cid: context.rootCid },
        parent: { uri: context.parentUri, cid: context.parentCid },
      },
      autoPost: false,
    };

    if (dryRun) {
      console.log(
        `[dry-run] would queue ${sanitizeForLog(n.reason)} from @${sanitizeForLog(context.author)}`,
      );
      console.log(`  in:  ${sanitizeForLog(text.slice(0, 120))}`);
      console.log(`  out: ${sanitizeForLog(String(reply).slice(0, 120))}`);
    } else {
      saveDraftFn(draft);
      state.repliedTo.bluesky[n.uri] = { queuedAt: draft.createdAt, reason: n.reason };
      queued += 1;
    }
  }

  if (!dryRun) {
    state.lastCheck.bluesky = new Date().toISOString();
    saveStateFn(state);
  }

  console.log(
    `[bluesky-monitor] notifications=${notifications.length} actionable=${actionable.length} queued=${queued} skipped=${skipped} dryRun=${dryRun}`,
  );
  return { notifications: notifications.length, actionable: actionable.length, queued, skipped };
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  const publishMode = args.has('--publish-approved');
  const confirmPublish = args.has('--confirm-publish');
  const task = publishMode
    ? publishApprovedDrafts({ dryRun: DRY_RUN, confirmPublish })
    : monitor();
  task.catch((err) => {
    if (isTransientAtprotoError(err)) {
      console.warn(
        `[bluesky-monitor] transient upstream error — will retry next tick: ${sanitizeForLog(err.message)}`,
      );
      process.exit(0);
    }
    console.error(`[bluesky-monitor] FAIL: ${sanitizeForLog(err.message)}`);
    process.exit(1);
  });
}

module.exports = {
  monitor,
  createSession,
  listNotifications,
  loadDrafts,
  extractPostText,
  buildReplyContext,
  assertPublishableDraft,
  publishApprovedDrafts,
  publishReply,
};
