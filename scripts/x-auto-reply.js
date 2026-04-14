#!/usr/bin/env node
'use strict';

/**
 * X/Twitter Auto-Reply — scans mentions and replies to unanswered ones.
 * Runs via GitHub Actions cron every 4 hours.
 */

const crypto = require('crypto');
const https = require('https');

const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_TOKEN_SECRET) {
  console.error('Missing X API credentials');
  process.exit(1);
}

function oauthRequest(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const params = {
      oauth_consumer_key: API_KEY, oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: timestamp,
      oauth_token: ACCESS_TOKEN, oauth_version: '1.0'
    };
    const allParams = { ...params };
    if (method === 'GET') u.searchParams.forEach((v, k) => { allParams[k] = v; });
    const paramString = Object.keys(allParams).sort().map(k => `${k}=${encodeURIComponent(allParams[k])}`).join('&');
    const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
    const baseString = `${method}&${encodeURIComponent(baseUrl)}&${encodeURIComponent(paramString)}`;
    const signingKey = `${encodeURIComponent(API_SECRET)}&${encodeURIComponent(ACCESS_TOKEN_SECRET)}`;
    params.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    const authHeader = 'OAuth ' + Object.entries(params).map(([k, v]) => `${k}="${encodeURIComponent(v)}"`).join(', ');
    const headers = { 'Authorization': authHeader };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => { let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data || '{}') })); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function generateReply(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('enforcement') || t.includes('rules') || t.includes('gate') || t.includes('block'))
    return "The enforcement layer sits between the agent and its tools — not in the prompt. PreToolUse hooks fire before execution. The agent doesn't get a vote.\n\nhttps://github.com/IgorGanapolsky/ThumbGate";
  if (t.includes('memory') || t.includes('repeat') || t.includes('mistake') || t.includes('same'))
    return "Memory alone isn't enough — you need enforcement. ThumbGate turns past mistakes into hard gates that block before execution. One thumbs-down, never again.\n\nhttps://github.com/IgorGanapolsky/ThumbGate";
  if (t.includes('how') || t.includes('install') || t.includes('setup') || t.includes('try'))
    return "30 seconds to install:\n\nnpx thumbgate init\n\nAuto-detects your agent (Claude Code, Cursor, Codex, Gemini). PreToolUse hooks block known-bad patterns before execution.\n\nhttps://github.com/IgorGanapolsky/ThumbGate";
  if (t.includes('cursor') || t.includes('claude') || t.includes('codex') || t.includes('agent'))
    return "Works with Claude Code, Cursor, Codex, Gemini CLI, and Amp. One thumbs-down = prevention rule shared across the whole team. The agent physically cannot repeat the mistake.\n\nhttps://github.com/IgorGanapolsky/ThumbGate";
  return "Thanks! ThumbGate adds PreToolUse hooks that block known-bad AI agent actions before execution. One thumbs-down becomes a prevention rule. Not a suggestion — a hard stop.\n\nhttps://github.com/IgorGanapolsky/ThumbGate";
}

async function main() {
  const me = await oauthRequest('GET', 'https://api.x.com/2/users/me', null);
  const myId = me.data?.data?.id;
  if (!myId) { console.error('Could not get user ID'); process.exit(1); }
  console.log(`User: ${me.data?.data?.username} (${myId})`);

  const mentions = await oauthRequest('GET',
    `https://api.x.com/2/users/${myId}/mentions?max_results=15&tweet.fields=author_id,conversation_id,created_at,text`, null);
  const myTweets = await oauthRequest('GET',
    `https://api.x.com/2/users/${myId}/tweets?max_results=15&tweet.fields=conversation_id`, null);

  const myConvos = new Set((myTweets.data?.data || []).map(t => t.conversation_id));
  const unanswered = (mentions.data?.data || []).filter(m => m.author_id !== myId && !myConvos.has(m.conversation_id));

  console.log(`Mentions: ${(mentions.data?.data || []).length}, Unanswered: ${unanswered.length}`);

  let replied = 0;
  for (const m of unanswered) {
    const reply = generateReply(m.text);
    console.log(`\nReplying to ${m.id}: ${m.text?.slice(0, 60)}...`);
    const body = JSON.stringify({ text: reply, reply: { in_reply_to_tweet_id: m.id } });
    const r = await oauthRequest('POST', 'https://api.x.com/2/tweets', body);
    if (r.status === 201) {
      console.log(`  ✅ https://x.com/i/web/status/${r.data?.data?.id}`);
      replied++;
    } else {
      console.log(`  ❌ ${r.status}: ${JSON.stringify(r.data).slice(0, 100)}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\nDone. Replied to ${replied}/${unanswered.length} mentions.`);
}

main().catch(e => { console.error(e); process.exit(1); });
