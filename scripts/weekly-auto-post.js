#!/usr/bin/env node
'use strict';

/**
 * Weekly Auto-Post — build-in-public experiment loop.
 *
 * Every week, auto-generates a social post from ThumbGate stats
 * ("X mistakes blocked, Y hours saved") and posts to configured platforms.
 * Closes the deploy → measure → share → compound loop.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateWeeklyStatsPost } = require('./daily-digest');
const { createSchedule } = require('./schedule-manager');

const POSTS_DIR = path.join(os.homedir(), '.rlhf', 'weekly-posts');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

/**
 * Generate a weekly stats post file in post-everywhere format.
 * Returns the file path.
 */
function generateWeeklyPostFile({ periodDays = 7 } = {}) {
  const { post, stats } = generateWeeklyStatsPost({ periodDays });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `weekly-stats-${date}.md`;

  // Build post-everywhere compatible frontmatter
  const content = [
    '---',
    `title: ThumbGate Weekly Stats — ${date}`,
    'platform: x',
    `tags: thumbgate, ai-agents, build-in-public`,
    '---',
    '',
    post,
    '',
    '#ThumbGate #AIAgents #BuildInPublic',
  ].join('\n');

  ensureDir(POSTS_DIR);
  const filePath = path.join(POSTS_DIR, filename);
  fs.writeFileSync(filePath, content);

  return { filePath, filename, post, stats, date };
}

/**
 * Generate and post weekly stats. Full pipeline.
 * If dryRun is true, generates the file but doesn't post.
 */
async function runWeeklyPost({ periodDays = 7, platforms, dryRun = false } = {}) {
  const generated = generateWeeklyPostFile({ periodDays });

  let postResult = null;
  let zernioResult = null;

  if (!dryRun) {
    // Primary: Zernio API (posts to all connected platforms — X, LinkedIn, Instagram, TikTok)
    try {
      const { publishToAllPlatforms } = require('./social-analytics/publishers/zernio');
      zernioResult = await publishToAllPlatforms(generated.post);
    } catch (err) {
      zernioResult = { error: err.message };
    }

    // Fallback: post-everywhere (if Zernio fails or specific platforms needed)
    if (zernioResult && zernioResult.error && platforms) {
      try {
        const { postEverywhere } = require('./post-everywhere');
        postResult = await postEverywhere(generated.filePath, { platforms, dryRun });
      } catch (err) {
        postResult = { error: err.message };
      }
    }
  }

  return {
    generated,
    posted: !dryRun,
    zernioResult,
    postResult,
    dryRun,
  };
}

/**
 * Create a weekly schedule for auto-posting.
 * Default: every Monday at 10:00 AM.
 */
function createWeeklyPostSchedule({ day = 'monday', time = '10:00', dryRun = false } = {}) {
  const command = [
    `const wp = require(${JSON.stringify(__filename)});`,
    `wp.runWeeklyPost(${JSON.stringify({ dryRun })})`,
    '.then(r => { process.stdout.write(JSON.stringify(r, null, 2) + "\\n"); })',
    '.catch(e => { process.stderr.write(e.message + "\\n"); process.exit(1); });',
  ].join(' ');

  return createSchedule({
    id: 'thumbgate-weekly-post',
    name: 'ThumbGate Weekly Build-in-Public Post',
    description: `Weekly stats post every ${day} at ${time}`,
    schedule: `weekly ${day} ${time}`,
    command,
  });
}

/**
 * List all generated weekly post files.
 */
function listWeeklyPosts() {
  ensureDir(POSTS_DIR);
  return fs.readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .map((f) => ({ filename: f, path: path.join(POSTS_DIR, f), date: f.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null }));
}

module.exports = { generateWeeklyPostFile, runWeeklyPost, createWeeklyPostSchedule, listWeeklyPosts, POSTS_DIR };
