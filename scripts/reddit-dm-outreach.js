#!/usr/bin/env node
'use strict';

/**
 * reddit-dm-outreach.js
 * Send direct messages to engaged Reddit users via OAuth2 password grant flow.
 *
 * Usage:
 *   node scripts/reddit-dm-outreach.js
 *
 * Requires env vars:
 *   REDDIT_CLIENT_ID
 *   REDDIT_CLIENT_SECRET
 *   REDDIT_USERNAME
 *   REDDIT_PASSWORD
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Parse .env credentials line-by-line
function parseEnv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    result[key] = value;
  }

  return result;
}

const envPath = path.join(__dirname, '..', '.env');
const env = parseEnv(envPath);

const REDDIT_CLIENT_ID = env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = env.REDDIT_CLIENT_SECRET;
const REDDIT_USERNAME = env.REDDIT_USERNAME;
const REDDIT_PASSWORD = env.REDDIT_PASSWORD;

if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
  console.error('❌ Missing Reddit credentials in .env');
  process.exit(1);
}

console.log('📧 Reddit DM Outreach');
console.log('---');

// OAuth2 password grant flow
function authenticate() {
  return new Promise((resolve, reject) => {
    const authHeader = 'Basic ' + Buffer.from(
      REDDIT_CLIENT_ID + ':' + REDDIT_CLIENT_SECRET
    ).toString('base64');

    const postData = [
      'grant_type=password',
      `username=${encodeURIComponent(REDDIT_USERNAME)}`,
      `password=${encodeURIComponent(REDDIT_PASSWORD)}`,
      'duration=permanent'
    ].join('&');

    const authOptions = {
      hostname: 'www.reddit.com',
      port: 443,
      path: '/api/v1/access_token',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ThumbGate-Testimonial/1.0',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const authReq = https.request(authOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            console.log('✅ Authenticated as', REDDIT_USERNAME);
            resolve(parsed.access_token);
          } else {
            reject(new Error('Auth failed: ' + JSON.stringify(parsed)));
          }
        } catch (e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    });

    authReq.on('error', reject);
    authReq.write(postData);
    authReq.end();
  });
}

// Send a single DM
function sendDM(accessToken, to, subject, text) {
  return new Promise((resolve, reject) => {
    const dmData = JSON.stringify({ to, subject, text });

    const dmOptions = {
      hostname: 'oauth.reddit.com',
      port: 443,
      path: '/api/compose',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'User-Agent': 'ThumbGate-Testimonial/1.0',
        'Content-Length': Buffer.byteLength(dmData)
      }
    };

    const dmReq = https.request(dmOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });

    dmReq.on('error', reject);
    dmReq.write(dmData);
    dmReq.end();
  });
}

// Main
async function main() {
  try {
    const accessToken = await authenticate();

    const messages = [
      {
        to: 'game-of-kton',
        subject: 'Quick question about your agent workflow',
        text: 'Hey — you left some really thoughtful comments on the AI coding agent thread. I\'m building ThumbGate (agent mistake prevention via PreToolUse hooks) and your feedback was the most useful I got.\n\nI\'m trying to figure out if this is worth building further. Would you be open to a quick 15-min call this week? Just want to understand how you handle agent mistakes in your workflow.\n\nI\'ll give you lifetime Pro access regardless — no strings attached.\n\nHere\'s the repo if you want to look first: https://github.com/IgorGanapolsky/ThumbGate'
      },
      {
        to: 'Deep_Ad1959',
        subject: 'Your context-dependent blocking idea',
        text: 'Hey — your point about context-dependent blocking was really insightful. That\'s exactly the problem I\'m trying to solve with ThumbGate (using Thompson Sampling for adaptive gates instead of hard binary blocks).\n\nWould you be open to a quick 15-min call this week? I\'m trying to figure out what developers would actually pay for in this space. Your perspective would be genuinely valuable.\n\nLifetime Pro access is yours either way. Repo: https://github.com/IgorGanapolsky/ThumbGate'
      },
      {
        to: 'leogodin217',
        subject: 'Quick question about AI agent safety in your workflow',
        text: 'Hey — you engaged with one of my posts about AI coding agent tooling and your take stood out. I\'m building ThumbGate (prevents AI agents from repeating mistakes via automated prevention rules).\n\nI\'m at the stage where I need honest feedback from people who actually use agents daily. Would you do a quick 15-min call this week? Just want to understand your pain points.\n\nLifetime Pro access is yours regardless. Repo: https://github.com/IgorGanapolsky/ThumbGate'
      },
      {
        to: 'Enthu-Cutlet-1337',
        subject: 'Quick question about your AI coding agent setup',
        text: 'Hey — you commented on one of my posts about agent memory/safety tooling and your feedback was one of the few that was genuinely useful.\n\nI\'m building ThumbGate (automated mistake prevention for AI coding agents) and I\'m trying to figure out if this solves a real problem or if everyone just uses CLAUDE.md files. Would you be open to a quick 15-min call this week?\n\nLifetime Pro access is yours either way — no pitch, just questions. Repo: https://github.com/IgorGanapolsky/ThumbGate'
      }
    ];

    console.log(`\n📨 Sending ${messages.length} direct messages...\n`);

    for (const msg of messages) {
      try {
        await sendDM(accessToken, msg.to, msg.subject, msg.text);
        console.log(`✅ DM sent to u/${msg.to}`);
      } catch (err) {
        console.error(`❌ Failed to send DM to u/${msg.to}:`, err.message);
      }
    }

    console.log(`\n✅ Outreach complete (${messages.length}/${messages.length} sent)`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
