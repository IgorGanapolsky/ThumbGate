#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';
const DEFAULT_STATE_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reddit-browser-notification-state.json');
const DEFAULT_EVENTS_FILE = path.resolve(__dirname, '..', '.thumbgate', 'reddit-browser-notifications.jsonl');
const REDDIT_NOTIFICATIONS_URL = 'https://www.reddit.com/notifications';

function resolveRuntimeFile(envName, defaultPath) {
  const configured = process.env[envName];
  return configured ? path.resolve(configured) : defaultPath;
}

function loadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // Ignore corrupt transient state; a later write will repair it.
  }
  return fallback;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function appendJsonl(filePath, rows) {
  if (rows.length === 0) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function fingerprintNotification(notification) {
  return [
    notification.author || '',
    notification.kind || '',
    notification.subreddit || '',
    notification.preview || '',
    notification.age || '',
  ].join('|').toLowerCase();
}

function scoreNotification(notification) {
  const text = `${notification.author || ''} ${notification.kind || ''} ${notification.preview || ''}`.toLowerCase();
  let score = 0;
  const reasons = [];

  if (/accepted your chat invite|chat invite/i.test(text)) {
    score += 5;
    reasons.push('chat_accepted');
  }
  if (/\b(interested|try|paid|diagnostic|workflow|failure|gate|thumbgate|thubgate)\b/i.test(text)) {
    score += 4;
    reasons.push('buyer_signal');
  }
  if (/\b(replied|mentioned)\b/i.test(text)) {
    score += 2;
    reasons.push('reply_or_mention');
  }
  if (/\b(spam|slop|bot|report|ignore all previous instructions)\b/i.test(text)) {
    score -= 5;
    reasons.push('hostile_or_meta');
  }
  if (/automoderator|mod-bot|minimum karma|removed|reviewed shortly/i.test(text)) {
    score -= 1;
    reasons.push('platform_moderation');
  }

  return { score, reasons };
}

function ageMinutes(age) {
  const text = String(age || '').trim().toLowerCase();
  if (!text || text === 'just now') return 0;
  const match = /^(\d+)\s*([mhdw])\s+ago$/.exec(text);
  if (!match) return Number.POSITIVE_INFINITY;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return value;
  if (unit === 'h') return value * 60;
  if (unit === 'd') return value * 24 * 60;
  return value * 7 * 24 * 60;
}

function isAgeLine(line) {
  return /^(?:just now|\d+\s*[mhdw]\s+ago)$/i.test(String(line || '').trim());
}

function isRecentNotification(notification, maxAgeMinutes = 48 * 60) {
  return ageMinutes(notification.age) <= maxAgeMinutes;
}

function parseNotificationBlocks(bodyText) {
  const lines = String(bodyText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const notifications = [];

  for (let index = 0; index < lines.length; index += 1) {
    let author = lines[index];
    let kind = lines[index + 1] || '';
    let kindIndex = index + 1;
    if (isAgeLine(author)) continue;

    if (/\b(replied to|mentioned you|new mentions)\b/i.test(author)) {
      kind = author;
      kindIndex = index;
      const authorMatch = /^u\/([^\s]+)/i.exec(kind);
      author = authorMatch ? authorMatch[1] : author;
    }

    if (!kind || !/\b(accepted your chat invite|replied to|mentioned you|new mentions)\b/i.test(kind)) continue;

    const hasPreview = !/accepted your chat invite|new mentions/i.test(kind);
    const preview = hasPreview ? (lines[kindIndex + 1] || '') : '';
    const age = hasPreview ? (lines[kindIndex + 2] || '') : (lines[kindIndex + 1] || '');
    const subredditMatch = /\bin\s+r\/([A-Za-z0-9_]+)/.exec(kind);
    const notification = {
      author,
      kind,
      subreddit: subredditMatch ? subredditMatch[1] : null,
      preview,
      age,
    };
    const scored = scoreNotification(notification);
    notifications.push({
      ...notification,
      ...scored,
      ageMinutes: ageMinutes(notification.age),
      fingerprint: fingerprintNotification(notification),
    });
  }

  return notifications;
}

async function readRedditNotifications({
  cdpEndpoint = process.env.THUMBGATE_CHROME_CDP_ENDPOINT || DEFAULT_CDP_ENDPOINT,
  timeoutMs = Number(process.env.THUMBGATE_REDDIT_BROWSER_TIMEOUT_MS || 15000),
} = {}) {
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(REDDIT_NOTIFICATIONS_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(3000);
    const bodyText = await page.locator('body').innerText({ timeout: timeoutMs });
    return parseNotificationBlocks(bodyText);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function run({ dryRun = false, now = new Date().toISOString() } = {}) {
  const stateFile = resolveRuntimeFile('THUMBGATE_REDDIT_BROWSER_STATE_FILE', DEFAULT_STATE_FILE);
  const eventsFile = resolveRuntimeFile('THUMBGATE_REDDIT_BROWSER_EVENTS_FILE', DEFAULT_EVENTS_FILE);
  const state = loadJson(stateFile, { seen: {} });
  const notifications = await readRedditNotifications();
  const fresh = notifications.filter((notification) => !state.seen[notification.fingerprint]);
  const actionable = fresh.filter((notification) => notification.score > 0 && isRecentNotification(notification));
  const rows = actionable.map((notification) => ({
    checkedAt: now,
    platform: 'reddit',
    source: 'browser_notifications',
    status: 'pending_review',
    ...notification,
  }));

  for (const notification of fresh) {
    state.seen[notification.fingerprint] = { seenAt: now, score: notification.score };
  }
  state.lastCheck = now;

  if (!dryRun) {
    writeJson(stateFile, state);
    appendJsonl(eventsFile, rows);
  }

  return {
    notifications: notifications.length,
    fresh: fresh.length,
    actionable: actionable.length,
    eventsFile,
    actionableItems: actionable,
    dryRun,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
  };
}

if (require.main === module) {
  const args = parseArgs();
  run({ dryRun: args.dryRun })
    .then((result) => {
      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`[reddit-browser-watch] notifications=${result.notifications} fresh=${result.fresh} actionable=${result.actionable} dryRun=${result.dryRun}`);
        for (const item of result.actionableItems) {
          console.log(`- score=${item.score} author=${item.author} kind=${item.kind} preview=${item.preview.slice(0, 120)}`);
        }
      }
    })
    .catch((err) => {
      console.error(`[reddit-browser-watch] ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  fingerprintNotification,
  ageMinutes,
  isRecentNotification,
  parseNotificationBlocks,
  readRedditNotifications,
  run,
  scoreNotification,
};
