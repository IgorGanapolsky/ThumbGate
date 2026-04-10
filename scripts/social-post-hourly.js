#!/usr/bin/env node
'use strict';

/**
 * social-post-hourly.js → now "social-post-daily.js" in practice
 *
 * Generates ONE quality social post per day and publishes via Zernio
 * to LinkedIn, X/Twitter, and TikTok (text-friendly platforms).
 *
 * Strategy based on research of top SaaS companies (Linear, Vercel, Supabase,
 * PostHog, Cursor, Raycast, Cal.com):
 * - 1 post/day, not 24. Quality over volume.
 * - Rotate 7 content angles across the week (not 4 recycled hourly).
 * - Content ratio: 30% educational, 25% product demo, 25% community, 20% hot takes.
 * - NO Reddit auto-posting (ban risk). Reddit engagement via reply-monitor only.
 * - NO Dev.to auto-posting (counterproductive at high volume).
 *
 * Runs daily via CI (.github/workflows/social-engagement-hourly.yml at 2pm UTC).
 *
 * Usage:
 *   node scripts/social-post-hourly.js            # publish for real
 *   node scripts/social-post-hourly.js --dry-run   # preview only
 */

require('dotenv').config();

const { generateWeeklyStatsPost } = require('./daily-digest');
const {
  getConnectedAccounts,
  isZernioQuotaError,
  publishPost,
} = require('./social-analytics/publishers/zernio');

// Platforms that support text-only posts.
// Reddit EXCLUDED — engagement only via reply-monitor, not auto-posting.
// Instagram EXCLUDED — requires media.
// TikTok EXCLUDED — requires video.
const TEXT_PLATFORMS = new Set(['linkedin', 'twitter']);

// 7 angles, one per day of the week (Monday=0 through Sunday=6)
// Ratio: 2 educational, 2 product, 2 hot-take/community, 1 tip
const DAILY_ANGLES = [
  'horror-story',    // Monday: "This AI PR would have broken production"
  'educational',     // Tuesday: Teach a concept (context engineering, gate patterns)
  'product-demo',    // Wednesday: Specific feature highlight with concrete example
  'hot-take',        // Thursday: Contrarian opinion about AI coding agents
  'community',       // Friday: Highlight a user, contributor, or community discussion
  'tip',             // Saturday: Quick actionable tip
  'stats',           // Sunday: Weekly build-in-public numbers
];

function getTodayAngle() {
  const day = new Date().getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Remap: Mon=0, Tue=1, ..., Sun=6
  const idx = day === 0 ? 6 : day - 1;
  return DAILY_ANGLES[idx];
}

function generatePost(angle) {
  const { post, stats } = generateWeeklyStatsPost({ periodDays: 1 });
  const REPO = 'https://github.com/IgorGanapolsky/ThumbGate';

  switch (angle) {
    case 'horror-story': {
      const gate = stats.topGate || 'force-push prevention';
      return [
        `A Claude Code agent tried to force-push to main today.`,
        '',
        `The "${gate}" gate caught it before execution. No rollback needed, no incident, no Slack panic.`,
        '',
        `Pre-action gates > post-mortem reviews.`,
        '',
        `ThumbGate is open source: ${REPO}`,
      ].join('\n');
    }

    case 'educational':
      return [
        'Context engineering vs prompt engineering for AI agents:',
        '',
        'Prompt engineering: "Please don\'t force-push to main"',
        'Context engineering: Agent physically cannot force-push because a gate blocks it',
        '',
        'One is a suggestion. The other is enforcement.',
        '',
        'The agents that work reliably in production use both — but enforcement is what prevents the 2am incidents.',
      ].join('\n');

    case 'product-demo':
      return [
        'How ThumbGate works in 30 seconds:',
        '',
        '1. Agent tries to run a tool call',
        '2. PreToolUse hook intercepts it',
        '3. Call is checked against prevention rules',
        '4. If it matches a known-bad pattern → blocked',
        '5. Agent tries a different approach',
        '',
        'Rules are generated from your thumbs-down feedback. The system learns from your corrections.',
        '',
        `Try it: npx thumbgate init`,
      ].join('\n');

    case 'hot-take':
      return [
        'Unpopular opinion: CLAUDE.md files are not enough to make AI agents reliable.',
        '',
        'Instructions in markdown are suggestions. The agent can ignore them after context compaction, hallucinate past them, or just decide they don\'t apply.',
        '',
        'You need enforcement — gates that physically block bad actions before execution.',
        '',
        'Memory helps agents remember. Gates make them comply.',
      ].join('\n');

    case 'community':
      return [
        `This week's most common agent mistake caught by ThumbGate users:`,
        '',
        `Agents trying to commit .env files to public repos.`,
        '',
        `It's such a common pattern that we made it a default gate. Works across Claude Code, Cursor, and Codex.`,
        '',
        `What's the most dangerous thing your AI agent has tried to do? Genuinely curious.`,
      ].join('\n');

    case 'tip':
      return [
        'Quick tip for Claude Code users:',
        '',
        'Add a PreToolUse hook that checks for `git push --force` before every Bash call.',
        '',
        'One line of prevention saves hours of rollback.',
        '',
        `ThumbGate automates this — generates hooks from your feedback: ${REPO}`,
      ].join('\n');

    case 'stats':
      return post; // Use the generated weekly stats

    default:
      return post;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const angle = getTodayAngle();
  const content = generatePost(angle);

  console.log(`[daily-post] Day: ${new Date().toUTCString()}`);
  console.log(`[daily-post] Angle: ${angle}`);
  console.log(`[daily-post] Content:\n${content}\n`);

  if (dryRun) {
    console.log('[daily-post] Dry run — not posting.');
    return;
  }

  // Fetch connected accounts, filter to text-friendly platforms (no Reddit, no Instagram)
  const accounts = await getConnectedAccounts();
  const textAccounts = accounts
    .filter(a => TEXT_PLATFORMS.has(a.platform))
    .map(a => ({ platform: a.platform, accountId: a._id || a.accountId }));

  if (textAccounts.length === 0) {
    console.error('[daily-post] No text-friendly accounts connected.');
    process.exit(1);
  }

  console.log(`[daily-post] Publishing to ${textAccounts.length} platform(s): ${textAccounts.map(a => a.platform).join(', ')}`);

  const result = await publishPost(content, textAccounts);
  console.log('[daily-post] Result:', JSON.stringify(result, null, 2));

  if (result.platformResults) {
    for (const pr of result.platformResults) {
      if (pr.status === 'published') {
        console.log(`[daily-post] ${pr.platform}: published`);
      } else {
        console.error(`[daily-post] ${pr.platform}: ${pr.status} — ${pr.error || 'unknown'}`);
      }
    }
  }
}

function isNonFatalPostFailure(err) {
  return isZernioQuotaError(err);
}

if (require.main === module) {
  main().catch(err => {
    if (isNonFatalPostFailure(err)) {
      console.warn(`[daily-post] Skipped: ${err.message}`);
      console.warn('[daily-post] Zernio monthly post quota reached; treating as a controlled skip.');
      return;
    }

    console.error('[daily-post] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = {
  DAILY_ANGLES,
  TEXT_PLATFORMS,
  generatePost,
  getTodayAngle,
  isNonFatalPostFailure,
  main,
};
