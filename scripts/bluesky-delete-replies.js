#!/usr/bin/env node
'use strict';

/**
 * One-shot: delete the 6 Bluesky replies posted by bluesky-send-replies.js
 * after the CEO thumbs-downed the AI-pitch voice on 2026-04-21.
 *
 * Reads URIs from .thumbgate/reply-monitor-state.json (repliedTo.bluesky.*.postedUri),
 * calls com.atproto.repo.deleteRecord for each, then clears the postedUri entries
 * so the monitor can re-queue the parent notifications for human-voiced redrafts.
 *
 * Env: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD.
 *
 * Usage:
 *   node scripts/bluesky-delete-replies.js            # delete for real
 *   node scripts/bluesky-delete-replies.js --dry-run  # preview only
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadLocalEnv } = require('./social-analytics/load-env');
loadLocalEnv();

const STATE_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-monitor-state.json');
const DRY_RUN = process.argv.includes('--dry-run');
const PDS_HOST = 'bsky.social';

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
        try { resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : {} }); }
        catch { resolve({ status: res.statusCode, json: {}, raw: buf }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pdsHost(didDoc) {
  const svc = didDoc && Array.isArray(didDoc.service) ? didDoc.service : [];
  const pds = svc.find((s) => s && (s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'));
  if (!pds || !pds.serviceEndpoint) return null;
  try { return new URL(pds.serviceEndpoint).host; } catch { return null; }
}

async function createSession() {
  const identifier = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) throw new Error('Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD');
  const { status, json } = await request('POST', PDS_HOST, '/xrpc/com.atproto.server.createSession', {
    body: { identifier, password },
  });
  if (status !== 200 || !json.accessJwt) throw new Error(`auth failed: ${status} ${json.error || ''}`);
  return { accessJwt: json.accessJwt, did: json.did, handle: json.handle, pdsHost: pdsHost(json.didDoc) || PDS_HOST };
}

// Parse "at://did:plc:.../app.bsky.feed.post/<rkey>" → { did, collection, rkey }.
function parseAtUri(uri) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!m) return null;
  return { did: m[1], collection: m[2], rkey: m[3] };
}

async function deleteRecord(session, uri) {
  const parts = parseAtUri(uri);
  if (!parts) throw new Error(`bad uri: ${uri}`);
  if (parts.did !== session.did) throw new Error(`refuse to delete record owned by ${parts.did}`);
  const { status, json } = await request('POST', session.pdsHost, '/xrpc/com.atproto.repo.deleteRecord', {
    headers: { Authorization: `Bearer ${session.accessJwt}` },
    body: { repo: session.did, collection: parts.collection, rkey: parts.rkey },
  });
  if (status !== 200) throw new Error(`deleteRecord failed: ${status} ${JSON.stringify(json)}`);
  return true;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { repliedTo: {}, lastCheck: {} }; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

(async () => {
  const session = await createSession();
  console.log(`authenticated as @${session.handle} (${session.did})`);

  const state = loadState();
  const bluesky = (state.repliedTo && state.repliedTo.bluesky) || {};
  const targets = Object.entries(bluesky).filter(([, v]) => v && v.postedUri);

  if (targets.length === 0) {
    console.log('no posted replies found to delete.');
    return;
  }

  console.log(`found ${targets.length} posted replies to delete:`);
  for (const [parentUri, v] of targets) console.log(`  ${v.postedUri}  (parent ${parentUri})`);

  if (DRY_RUN) { console.log('\n[dry-run] no deletes performed.'); return; }

  let deleted = 0;
  let failed = 0;
  for (const [parentUri, v] of targets) {
    try {
      await deleteRecord(session, v.postedUri);
      console.log(`✅ deleted ${v.postedUri}`);
      // Remove the entry entirely so the monitor can re-queue the parent for a human-voiced redraft.
      delete bluesky[parentUri];
      deleted++;
    } catch (err) {
      console.error(`❌ ${v.postedUri}: ${err.message}`);
      failed++;
    }
  }

  state.repliedTo = state.repliedTo || {};
  state.repliedTo.bluesky = bluesky;
  saveState(state);

  console.log(`\n[bluesky-delete-replies] deleted=${deleted} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(`[bluesky-delete-replies] FAIL: ${err.message}`);
  process.exit(1);
});
