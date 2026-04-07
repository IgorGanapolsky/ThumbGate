#!/usr/bin/env node
'use strict';

/**
 * social-post-hourly.js
 * Generates a fresh social post from ThumbGate stats and publishes
 * via Zernio to all connected platforms (LinkedIn, X, Reddit, TikTok, YouTube).
 *
 * Runs hourly via CI (.github/workflows/social-engagement-hourly.yml).
 *
 * Usage:
 *   node scripts/social-post-hourly.js            # publish for real
 *   node scripts/social-post-hourly.js --dry-run   # preview only
 */

require('dotenv').config();

const { generateWeeklyStatsPost } = require('./daily-digest');
const { publishPost, getConnectedAccounts } = require('./social-analytics/publishers/zernio');

// Platforms that support text-only posts (Instagram requires media).
const TEXT_PLATFORMS = new Set(['linkedin', 'twitter', 'reddit', 'tiktok']);

// Rotate post angles to avoid repetition
const ANGLES = [
  'stats',       // blocked-count / hours-saved numbers
  'story',       // mini narrative about a prevented mistake
  'question',    // engagement question about AI agent safety
  'tip',         // quick tip on using pre-action gates
];

function pickAngle() {
  const hour = new Date().getUTCHours();
  return ANGLES[hour % ANGLES.length];
}

function generatePost(angle) {
  const { post, stats } = generateWeeklyStatsPost({ periodDays: 1 });

  switch (angle) {
    case 'stats':
      return post;

    case 'story': {
      if (stats.topGate) {
        return [
          `Today the "${stats.topGate}" gate fired ${stats.blockedCount} times.`,
          'Each one was a mistake an AI agent would have committed without pre-action review.',
          '',
          'Context engineering > prompt engineering.',
          'https://github.com/IgorGanapolsky/ThumbGate',
        ].join('\n');
      }
      return post;
    }

    case 'question':
      return [
        'How do you stop AI coding agents from repeating the same mistakes?',
        '',
        `We built ThumbGate — pre-action gates that block known-bad patterns before they execute.`,
        `${stats.blockedCount} mistakes blocked today.`,
        'https://github.com/IgorGanapolsky/ThumbGate',
      ].join('\n');

    case 'tip':
      return [
        'Quick tip: Add a PreToolUse hook to your Claude Code setup.',
        'It fires before every tool call — perfect for catching bad file edits, risky commands, or known anti-patterns.',
        '',
        'ThumbGate automates this with feedback-driven prevention rules.',
        'https://github.com/IgorGanapolsky/ThumbGate',
      ].join('\n');

    default:
      return post;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const angle = pickAngle();
  const content = generatePost(angle);

  console.log(`[hourly-post] Angle: ${angle}`);
  console.log(`[hourly-post] Content:\n${content}\n`);

  if (dryRun) {
    console.log('[hourly-post] Dry run — not posting.');
    return;
  }

  // Fetch connected accounts, filter to text-friendly platforms
  const accounts = await getConnectedAccounts();
  const textAccounts = accounts
    .filter(a => TEXT_PLATFORMS.has(a.platform))
    .map(a => ({ platform: a.platform, accountId: a._id || a.accountId }));

  if (textAccounts.length === 0) {
    console.error('[hourly-post] No text-friendly accounts connected.');
    process.exit(1);
  }

  console.log(`[hourly-post] Publishing to ${textAccounts.length} platform(s): ${textAccounts.map(a => a.platform).join(', ')}`);

  const result = await publishPost(content, textAccounts);
  console.log('[hourly-post] Result:', JSON.stringify(result, null, 2));

  // Report per-platform status
  if (result.platformResults) {
    for (const pr of result.platformResults) {
      if (pr.status === 'published') {
        console.log(`[hourly-post] ${pr.platform}: published`);
      } else {
        console.error(`[hourly-post] ${pr.platform}: ${pr.status} — ${pr.error || 'unknown'}`);
      }
    }
  }
}

main().catch(err => {
  console.error('[hourly-post] Fatal:', err.message);
  process.exit(1);
});
