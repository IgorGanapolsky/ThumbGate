#!/usr/bin/env node
'use strict';

/**
 * One-shot: delete the Bluesky replies tracked in
 * .thumbgate/reply-monitor-state.json (repliedTo.bluesky.*.postedUri).
 *
 * Built 2026-04-21 to roll back a batch of AI-pitch-voice replies that the
 * CEO thumbs-downed. Reads the postedUri entries, calls
 * com.atproto.repo.deleteRecord for each, then clears the entries so the
 * monitor can re-queue the parent notifications for a human-voiced redraft.
 *
 * Env: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD.
 *
 * Usage:
 *   node scripts/bluesky-delete-replies.js            # delete for real
 *   node scripts/bluesky-delete-replies.js --dry-run  # preview only
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnv } = require('./social-analytics/load-env');
loadLocalEnv();
const {
  atprotoRequest,
  createSession,
  parseAtUri,
} = require('./lib/bluesky-atproto');

const STATE_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-monitor-state.json');
const DRY_RUN = process.argv.includes('--dry-run');

async function deleteRecord(session, uri) {
  const parts = parseAtUri(uri);
  if (!parts) throw new Error(`bad uri: ${uri}`);
  if (parts.did !== session.did) {
    throw new Error(`refuse to delete record owned by ${parts.did}`);
  }
  const { status, json } = await atprotoRequest(
    'POST',
    session.pdsHost,
    '/xrpc/com.atproto.repo.deleteRecord',
    {
      headers: { Authorization: `Bearer ${session.accessJwt}` },
      body: { repo: session.did, collection: parts.collection, rkey: parts.rkey },
    },
  );
  if (status !== 200) {
    throw new Error(`deleteRecord failed: ${status} ${JSON.stringify(json)}`);
  }
  return true;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { repliedTo: {}, lastCheck: {} }; }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function run() {
  const session = await createSession();
  console.log(`authenticated as @${session.handle} (${session.did})`);

  const state = loadState();
  const bluesky = (state.repliedTo && state.repliedTo.bluesky) || {};
  const targets = Object.entries(bluesky).filter(([, v]) => v && v.postedUri);

  if (targets.length === 0) {
    console.log('no posted replies found to delete.');
    return { deleted: 0, failed: 0 };
  }

  console.log(`found ${targets.length} posted replies to delete:`);
  for (const [parentUri, v] of targets) {
    console.log(`  ${v.postedUri}  (parent ${parentUri})`);
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] no deletes performed.');
    return { deleted: 0, failed: 0 };
  }

  let deleted = 0;
  let failed = 0;
  for (const [parentUri, v] of targets) {
    try {
      await deleteRecord(session, v.postedUri);
      console.log(`deleted ${v.postedUri}`);
      delete bluesky[parentUri];
      deleted++;
    } catch (err) {
      console.error(`delete-failed ${v.postedUri}: ${err.message}`);
      failed++;
    }
  }

  state.repliedTo = state.repliedTo || {};
  state.repliedTo.bluesky = bluesky;
  saveState(state);

  console.log(`\n[bluesky-delete-replies] deleted=${deleted} failed=${failed}`);
  return { deleted, failed };
}

if (require.main === module) {
  run()
    .then((r) => process.exit(r.failed > 0 ? 1 : 0))
    .catch((err) => {
      console.error(`[bluesky-delete-replies] FAIL: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { run, deleteRecord };
