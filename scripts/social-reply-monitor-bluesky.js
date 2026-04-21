'use strict';

/**
 * social-reply-monitor-bluesky.js
 *
 * Polls Bluesky notifications (replies, mentions, quotes) for our account and
 * queues draft responses into .thumbgate/reply-drafts.jsonl for human review.
 *
 * Never auto-posts. Drafts are reviewed, then sent manually (or by a separate
 * queue-consumer with explicit sign-off).
 *
 * Env:
 *   BLUESKY_HANDLE          — e.g. iganapolsky.bsky.social
 *   BLUESKY_APP_PASSWORD    — app password (https://bsky.app/settings/app-passwords)
 *
 * Usage:
 *   node scripts/social-reply-monitor-bluesky.js            # poll + queue drafts
 *   node scripts/social-reply-monitor-bluesky.js --dry-run  # poll, log what would be queued
 *
 * State: .thumbgate/reply-monitor-state.json — tracks replied-to notification URIs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnv } = require('./social-analytics/load-env');
const { generateReply } = require('./social-reply-monitor');
const {
  atprotoRequest,
  createSession,
  isTransientAtprotoError,
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
  const rec = notification && notification.record;
  if (!rec) return '';
  if (typeof rec.text === 'string') return rec.text;
  return '';
}

function buildReplyContext(notification) {
  const text = extractPostText(notification);
  const reply = notification.record && notification.record.reply;
  return {
    platform: 'bluesky',
    author: (notification.author && notification.author.handle) || 'unknown',
    isQuestion: /\?/.test(text),
    notificationUri: notification.uri,
    notificationCid: notification.cid,
    rootUri: (reply && reply.root && reply.root.uri) || notification.uri,
    rootCid: (reply && reply.root && reply.root.cid) || notification.cid,
    parentUri: notification.uri,
    parentCid: notification.cid,
  };
}

async function monitor() {
  const session = await createSession();
  const state = loadState();
  state.repliedTo.bluesky = state.repliedTo.bluesky || {};

  const notifications = await listNotifications(session);
  const actionable = notifications.filter((n) => ['reply', 'mention', 'quote'].includes(n.reason));

  let queued = 0;
  let skipped = 0;

  for (const n of actionable) {
    if (state.repliedTo.bluesky[n.uri]) { skipped += 1; continue; }
    if (n.author && n.author.handle === session.handle) { skipped += 1; continue; }

    const text = extractPostText(n);
    if (!text) { skipped += 1; continue; }

    const context = buildReplyContext(n);
    const reply = await generateReply(text, context);
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
        authorDid: n.author && n.author.did,
      },
      incomingText: text,
      draftReply: reply,
      reply: {
        root: { uri: context.rootUri, cid: context.rootCid },
        parent: { uri: context.parentUri, cid: context.parentCid },
      },
      autoPost: false,
    };

    if (DRY_RUN) {
      console.log(`[dry-run] would queue ${n.reason} from @${context.author}`);
      console.log(`  in:  ${text.slice(0, 120)}`);
      console.log(`  out: ${String(reply).slice(0, 120)}`);
    } else {
      saveDraft(draft);
      state.repliedTo.bluesky[n.uri] = { queuedAt: draft.createdAt, reason: n.reason };
      queued += 1;
    }
  }

  if (!DRY_RUN) {
    state.lastCheck.bluesky = new Date().toISOString();
    saveState(state);
  }

  console.log(
    `[bluesky-monitor] notifications=${notifications.length} actionable=${actionable.length} queued=${queued} skipped=${skipped} dryRun=${DRY_RUN}`,
  );
  return { notifications: notifications.length, actionable: actionable.length, queued, skipped };
}

if (require.main === module) {
  monitor().catch((err) => {
    if (isTransientAtprotoError(err)) {
      console.warn(
        `[bluesky-monitor] transient upstream error — will retry next tick: ${err.message}`,
      );
      process.exit(0);
    }
    console.error(`[bluesky-monitor] FAIL: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  monitor,
  createSession,
  listNotifications,
  extractPostText,
  buildReplyContext,
};
