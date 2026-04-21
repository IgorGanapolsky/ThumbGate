#!/usr/bin/env node
'use strict';

/**
 * One-shot: dump full text + reply thread context for all actionable,
 * un-replied Bluesky notifications so a human can craft specific replies.
 * Does NOT post. Does NOT queue.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnv } = require('./social-analytics/load-env');
loadLocalEnv();
const { createSession, listNotifications } = require('./social-reply-monitor-bluesky');
const { sanitizeForLog } = require('./lib/bluesky-atproto');

const STATE_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reply-monitor-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { repliedTo: {}, lastCheck: {} }; }
}

(async () => {
  const session = await createSession();
  const notifications = await listNotifications(session, 60);
  const state = loadState();
  const replied = state.repliedTo?.bluesky || {};

  const actionable = notifications.filter((n) => ['reply', 'mention', 'quote'].includes(n.reason));
  const openItems = actionable.filter(
    (n) => !replied[n.uri] && n.author?.handle && n.author.handle !== session.handle,
  );

  console.log(`session.handle=${sanitizeForLog(session.handle)}`);
  console.log(
    `total=${notifications.length} actionable=${actionable.length} open=${openItems.length}\n`,
  );

  for (let i = 0; i < openItems.length; i++) {
    const n = openItems[i];
    const text = n.record?.text || '';
    const rootUri = n.record?.reply?.root?.uri || n.uri;
    const rootCid = n.record?.reply?.root?.cid || n.cid;
    console.log(
      `#${i + 1}  @${sanitizeForLog(n.author.handle)}  reason=${sanitizeForLog(n.reason)}  indexedAt=${sanitizeForLog(n.indexedAt)}`,
    );
    console.log(`  uri:  ${sanitizeForLog(n.uri)}`);
    console.log(`  cid:  ${sanitizeForLog(n.cid)}`);
    console.log(`  root: ${sanitizeForLog(rootUri)}`);
    console.log(`  rCid: ${sanitizeForLog(rootCid)}`);
    console.log(`  text: ${sanitizeForLog(text)}`);
    console.log('');
  }
})().catch((err) => {
  console.error(`[bluesky-list] FAIL: ${sanitizeForLog(err.message)}`);
  process.exit(1);
});
