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
const { resolveHostedBillingConfig } = require('./hosted-config');
const { loadLocalEnv } = require('./social-analytics/load-env');
const { advanceSalesLead } = require('./sales-pipeline');
const { buildWarmRedditMessages } = require('./warm-outreach-targets');

loadLocalEnv();

const WARM_REDDIT_LEAD_IDS = {
  Deep_Ad1959: 'reddit_deep_ad1959_r_cursor',
  'game-of-kton': 'reddit_game_of_kton_r_cursor',
  leogodin217: 'reddit_leogodin217_r_claudecode',
  'Enthu-Cutlet-1337': 'reddit_enthu_cutlet_1337_r_claudecode',
};

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

function getRedditCredentials() {
  return {
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    REDDIT_USERNAME: process.env.REDDIT_USERNAME,
    REDDIT_PASSWORD: process.env.REDDIT_PASSWORD,
  };
}

function markContacted(message, { advanceLead = advanceSalesLead, timestamp = new Date().toISOString() } = {}) {
  const leadId = WARM_REDDIT_LEAD_IDS[message.to];
  if (!leadId) return null;
  const result = advanceLead({
    leadId,
    stage: 'contacted',
    channel: 'reddit_dm',
    note: `Sent same-day $499 workflow diagnostic offer to u/${message.to}.`,
    timestamp,
  });
  return {
    leadId,
    unchanged: result.unchanged === true,
  };
}

// OAuth2 password grant flow
function authenticate() {
  const {
    REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET,
    REDDIT_USERNAME,
    REDDIT_PASSWORD,
  } = getRedditCredentials();

  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
    throw new Error('Missing Reddit credentials in environment or .env');
  }

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
    const dryRun = process.argv.includes('--dry-run');
    const shouldMarkContacted = process.argv.includes('--mark-contacted');
    const toArg = process.argv.find((arg) => arg.startsWith('--to='));
    const selectedTargets = toArg
      ? new Set(toArg.slice('--to='.length).split(',').map((item) => item.trim()).filter(Boolean))
      : null;
    console.log('📧 Reddit DM Outreach');
    console.log('---');
    const billingConfig = resolveHostedBillingConfig({
      requestOrigin: 'https://thumbgate-production.up.railway.app',
    });
    let messages = buildWarmRedditMessages(`${billingConfig.appOrigin}/#workflow-sprint-intake`);
    if (selectedTargets && !selectedTargets.has('all')) {
      messages = messages.filter((message) => selectedTargets.has(message.to));
    }

    if (selectedTargets && !selectedTargets.has('all') && messages.length === 0) {
      throw new Error(`No warm Reddit messages matched --to=${Array.from(selectedTargets).join(',')}`);
    }

    if (dryRun) {
      console.log(JSON.stringify({ dryRun: true, messages }, null, 2));
      return;
    }

    const accessToken = await authenticate();
    console.log(`\n📨 Sending ${messages.length} direct messages...\n`);

    let sent = 0;
    for (const msg of messages) {
      try {
        await sendDM(accessToken, msg.to, msg.subject, msg.text);
        sent += 1;
        console.log(`✅ DM sent to u/${msg.to}`);
        if (shouldMarkContacted) {
          const tracked = markContacted(msg);
          if (tracked) console.log(`📈 Pipeline tracked ${tracked.leadId}`);
        }
      } catch (err) {
        console.error(`❌ Failed to send DM to u/${msg.to}:`, err.message);
      }
    }

    console.log(`\n✅ Outreach complete (${sent}/${messages.length} sent)`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  main().catch((err) => {
    console.error('❌ Error:', err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  buildWarmRedditMessages,
  getRedditCredentials,
  isCliInvocation,
  main,
  markContacted,
  parseEnv,
};
