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
 *   node scripts/social-reply-monitor-bluesky.js --once     # single pass (default, no --loop yet)
 *
 * State: .thumbgate/reply-monitor-state.json — tracks replied-to notification URIs.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadLocalEnv } = require('./social-analytics/load-env');
const { generateReply } = require('./social-reply-monitor');

loadLocalEnv();

const PDS_HOST = 'bsky.social';
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

function request(method, host, pathUrl, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      host,
      path: pathUrl,
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try {
          const json = buf ? JSON.parse(buf) : {};
          resolve({ status: res.statusCode, json });
        } catch (e) {
          resolve({ status: res.statusCode, json: {}, raw: buf });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pdsHostFromDidDoc(didDoc) {
  const svc = didDoc && Array.isArray(didDoc.service) ? didDoc.service : [];
  const pds = svc.find((s) => s && (s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'));
  if (!pds || !pds.serviceEndpoint) return null;
  try {
    return new URL(pds.serviceEndpoint).host;
  } catch { return null; }
}

async function createSession() {
  const identifier = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) {
    throw new Error('Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD');
  }
  const { status, json } = await request('POST', PDS_HOST, '/xrpc/com.atproto.server.createSession', {
    body: { identifier, password },
  });
  if (status !== 200 || !json.accessJwt) {
    throw new Error(`Bluesky auth failed (status=${status}): ${json.error || 'unknown'}`);
  }
  const pdsHost = pdsHostFromDidDoc(json.didDoc) || PDS_HOST;
  return { accessJwt: json.accessJwt, did: json.did, handle: json.handle, pdsHost };
}

async function listNotifications(session, limit = 40) {
  const host = session.pdsHost || PDS_HOST;
  const { status, json } = await request('GET', host, `/xrpc/app.bsky.notification.listNotifications?limit=${limit}`, {
    headers: { Authorization: `Bearer ${session.accessJwt}` },
  });
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

    const context = {
      platform: 'bluesky',
      author: (n.author && n.author.handle) || 'unknown',
      isQuestion: /\?/.test(text),
      notificationUri: n.uri,
      notificationCid: n.cid,
      rootUri: (n.record && n.record.reply && n.record.reply.root && n.record.reply.root.uri) || n.uri,
      rootCid: (n.record && n.record.reply && n.record.reply.root && n.record.reply.root.cid) || n.cid,
      parentUri: n.uri,
      parentCid: n.cid,
    };

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

  console.log(`[bluesky-monitor] notifications=${notifications.length} actionable=${actionable.length} queued=${queued} skipped=${skipped} dryRun=${DRY_RUN}`);
  return { notifications: notifications.length, actionable: actionable.length, queued, skipped };
}

function isTransient(err) {
  const msg = String(err && err.message || '');
  return /\b(502|503|504|UpstreamFailure|ECONNRESET|ETIMEDOUT|ENOTFOUND)\b/.test(msg);
}

if (require.main === module) {
  monitor().catch((err) => {
    if (isTransient(err)) {
      console.warn(`[bluesky-monitor] transient upstream error — will retry next tick: ${err.message}`);
      process.exit(0);
    }
    console.error(`[bluesky-monitor] FAIL: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { monitor, createSession, listNotifications };
