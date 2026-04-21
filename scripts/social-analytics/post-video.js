#!/usr/bin/env node
'use strict';

/**
 * post-video.js
 * Generates a marketing short video and posts it to TikTok, YouTube, and
 * Instagram Reels via Zernio. Tracks everything in the marketing DB to
 * prevent double-posting.
 *
 * Usage:
 *   node scripts/social-analytics/post-video.js
 *   node scripts/social-analytics/post-video.js --campaign=v1.4.1 --dry-run
 *   node scripts/social-analytics/post-video.js --video=/path/to/custom.mp4
 *
 * Required env:
 *   ZERNIO_API_KEY
 * Optional env (overrides hardcoded account IDs):
 *   ZERNIO_TIKTOK_ACCOUNT_ID
 *   ZERNIO_YOUTUBE_ACCOUNT_ID
 *   ZERNIO_INSTAGRAM_ACCOUNT_ID
 */

const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadLocalEnv } = require('./load-env');

loadLocalEnv();

const { hashContent, isDuplicate, record } = require('./db/marketing-db');
const zernioPublisher = require('./publishers/zernio');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ACCOUNTS = {
  tiktok:    process.env.ZERNIO_TIKTOK_ACCOUNT_ID    || '69bee0fd6cb7b8cf4c8b2425',
  youtube:   process.env.ZERNIO_YOUTUBE_ACCOUNT_ID   || '69c14dc36cb7b8cf4c91c1e4',
  instagram: process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID || '69bed6ad6cb7b8cf4c8b0865',
};

// Per-platform cooldown in hours — prevents over-posting even when CI fires every 4h
const PLATFORM_COOLDOWN_HOURS = {
  tiktok:    4,   // up to 6 videos/day — TikTok rewards frequency
  instagram: 8,   // up to 3 Reels/day
  youtube:   12,  // 1-2 Shorts/day
};

const CAPTIONS = {
  // Primary CTA routes through the production landing page so the funnel
  // ledger attributes views → installs → paid. GitHub is kept as secondary
  // proof ("open source") but no longer the primary click target, because
  // clicks on github.com never touch our funnel tracker.
  tiktok: `Your AI agent deleted prod config because it "looked unused" 😬

ThumbGate v1.4.1 intercepts BEFORE the action runs. Checks it against lessons from past failures. Blocks it permanently.

👎 feedback → lesson DB → prevention rule → physical gate

Not a prompt. A block.

See what it's blocked this week: https://thumbgate-production.up.railway.app/numbers
Source (MIT): https://github.com/IgorGanapolsky/ThumbGate

#ClaudeCode #AIAgents #DevTools #TechTok #Coding #SoftwareDev #AITools #Programming #DevTok`,

  youtube: `ThumbGate v1.4.1: How to stop AI coding agents from repeating mistakes

Your agent force-pushed to main. Deleted prod config. Ran the wrong migration. You told it not to. Next session — same mistake.

ThumbGate solves this with pre-action gates: every 👎 becomes a lesson, every lesson becomes a gate, every gate is enforced via PreToolUse hooks.

v1.4.1: Thompson Sampling · LanceDB vector search · SQLite+FTS5 lesson DB

See this week's blocked actions + token savings: https://thumbgate-production.up.railway.app/numbers
Source (MIT): https://github.com/IgorGanapolsky/ThumbGate
npx thumbgate serve

#ClaudeCode #AIAgents #DevTools #Shorts`,

  instagram: `AI agent deleted prod config because it "looked unused" 😬

ThumbGate v1.4.1: pre-action safety gates that physically block known-bad patterns before they run.

👎 → lesson DB → prevention rule → blocked forever

Live GPT demo: chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate
Free + open source. Link in bio 👆

#AIAgents #ClaudeCode #DevTools #Coding #TechTok #SoftwareDev #AITools #MachineLearning #BuildInPublic`,
};

const YT_TITLE = 'ThumbGate v1.4.1: Stop AI Agents From Repeating Mistakes #shorts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { dryRun: false, campaign: 'default', videoPath: null, platforms: null, template: 'auto' };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--campaign=')) opts.campaign = arg.slice(11);
    else if (arg.startsWith('--video=')) opts.videoPath = arg.slice(8);
    else if (arg.startsWith('--platforms=')) opts.platforms = arg.slice(12).split(',');
    else if (arg.startsWith('--template=')) opts.template = arg.slice(11);
  }
  return opts;
}

function requireKey() {
  const k = process.env.ZERNIO_API_KEY;
  if (!k) throw new Error('ZERNIO_API_KEY env var is required');
  return k;
}

/**
 * Upload a local video via Zernio's presign flow.
 * Returns the full media item object Zernio expects in subsequent /posts calls:
 *   { url, key, size, contentType, type }
 * Instagram in particular validates these fields — passing only { url, type }
 * (the previous direct /media multipart upload shape) caused silent rejection.
 */
async function zernioUpload(_apiKey, filePath, deps = {}) {
  const upload = deps.uploadLocalMedia || zernioPublisher.uploadLocalMedia;
  return upload(filePath);
}

// ---------------------------------------------------------------------------
// Video generation
// ---------------------------------------------------------------------------

function generateVideo(outDir, template = 'auto', campaign = 'default') {
  const slidesScript = path.join(__dirname, 'generate-slides.js');
  const concatFile = path.join(outDir, 'concat.txt');
  const videoOut = path.join(outDir, 'thumbgate-short.mp4');

  console.log('[post-video] Generating slides...');
  execFileSync(process.execPath, [
    slidesScript,
    `--out=${outDir}`,
    `--template=${template}`,
    `--campaign=${campaign}`,
  ], { stdio: 'inherit' });

  // Build ffmpeg concat file from manifest
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  const concatLines = manifest.slides.map(s => `file '${path.join(outDir, s.file)}'\nduration ${s.holdSeconds}`);
  const lastSlide = manifest.slides[manifest.slides.length - 1];
  concatLines.push(`file '${path.join(outDir, lastSlide.file)}'`);
  fs.writeFileSync(concatFile, concatLines.join('\n'));

  console.log('[post-video] Rendering video...');
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" \
      -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1" \
      -c:v libx264 -r 30 -pix_fmt yuv420p -movflags +faststart \
      "${videoOut}"`,
    { stdio: 'pipe' }
  );

  const size = (fs.statSync(videoOut).size / 1024).toFixed(0);
  console.log(`[post-video] Video ready: ${videoOut} (${size} KB, ${manifest.totalDuration}s)`);
  return videoOut;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function prepareVideo(opts) {
  let videoPath = opts.videoPath;
  let templateId = opts.template;
  if (!videoPath) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-video-'));
    videoPath = generateVideo(tmpDir, opts.template, opts.campaign);
    // Read back the chosen template id from manifest
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'manifest.json'), 'utf8'));
      templateId = String(manifest.templateId || opts.template);
    } catch {}
  }
  return { videoPath, templateId };
}

function buildPlatformPlan(platform, baseHash) {
  const caption = CAPTIONS[platform];
  if (!caption) {
    console.warn(`[post-video] No caption for platform: ${platform} — skipping`);
    return null;
  }

  const contentHash = hashContent(`${baseHash}::${platform}`);
  const cooldownHours = PLATFORM_COOLDOWN_HOURS[platform] || 4;
  return { platform, caption, contentHash, cooldownDays: cooldownHours / 24 };
}

function duplicateResult(plan, isDuplicateFn = isDuplicate) {
  const existing = isDuplicateFn(plan.platform, plan.contentHash, plan.cooldownDays);
  if (!existing) return null;
  console.log(`[post-video] SKIP ${plan.platform} — already posted (${existing.published_at}): ${existing.post_url}`);
  return { platform: plan.platform, status: 'skipped', reason: 'duplicate', existing };
}

function recordPostOutcome({ plan, status, postUrl, error, campaign, mediaUrl, templateId, response, recordFn = record }) {
  if (status === 'published') {
    console.log(`[post-video] ✓ ${plan.platform}: ${postUrl}`);
    recordFn({ type: 'video', platform: plan.platform, contentHash: plan.contentHash, postUrl, campaign,
      tags: ['v1.4.1', 'short', campaign],
      extra: { mediaUrl, templateId, zernioPostId: response.post?._id } });
    return;
  }

  console.error(`[post-video] ✗ ${plan.platform}: ${error}`);
  recordFn({ type: 'video', platform: plan.platform, contentHash: plan.contentHash, status: 'failed', campaign,
    extra: { error } });
}

async function processPlatform(plan, context) {
  const duplicate = duplicateResult(plan, context.isDuplicate);
  if (duplicate) return duplicate;

  if (context.dryRun) {
    console.log(`[post-video] DRY-RUN ${plan.platform} — would post video`);
    return { platform: plan.platform, status: 'dry-run' };
  }

  try {
    const uploadFn = context.uploadLocalMedia || zernioPublisher.uploadLocalMedia;
    const publishFn = context.publishPost || zernioPublisher.publishPost;

    if (!context.mediaItem) {
      console.log(`[post-video] Uploading video to Zernio (presign flow)...`);
      context.mediaItem = await uploadFn(context.videoPath);
      console.log(`[post-video] Uploaded: ${context.mediaItem.url}`);
    }

    console.log(`[post-video] Posting to ${plan.platform}...`);
    // Force video type (Instagram Reels / TikTok / YT Shorts all require video).
    // uploadLocalMedia infers type from extension, but .mp4 -> 'video' already;
    // this is defensive in case a caller overrides the extension inference.
    const mediaItems = [{ ...context.mediaItem, type: 'video' }];
    const response = await publishFn(plan.caption, [
      { platform: plan.platform, accountId: ACCOUNTS[plan.platform] },
    ], {
      mediaItems,
      // YouTube Shorts use `title`; other platforms ignore it.
      firstComment: undefined,
    });

    if (response && response.blocked) {
      const reasons = Array.isArray(response.reasons)
        ? response.reasons.map(r => r.reason || String(r)).join(', ')
        : 'blocked';
      recordPostOutcome({ plan, status: 'blocked', postUrl: '', error: reasons, campaign: context.campaign,
        mediaUrl: context.mediaItem.url, templateId: context.templateId, response,
      recordFn: context.record });
      return { platform: plan.platform, status: 'blocked', error: reasons };
    }

    const platformResult = response.post?.platforms?.[0]
      || (Array.isArray(response.platforms) ? response.platforms[0] : null)
      || {};
    const status = platformResult.status || (response.id ? 'published' : 'unknown');
    const postUrl = platformResult.platformPostUrl || platformResult.postUrl || '';
    const error = platformResult.errorMessage || response.error || '';
    recordPostOutcome({ plan, status, postUrl, error, campaign: context.campaign,
      mediaUrl: context.mediaItem.url, templateId: context.templateId, response,
      recordFn: context.record });
    return { platform: plan.platform, status, postUrl, error };
  } catch (err) {
    console.error(`[post-video] ✗ ${plan.platform} error: ${err.message}`);
    return { platform: plan.platform, status: 'error', error: err.message };
  }
}

function statusIcon(status) {
  if (status === 'published') return '✓';
  if (['skipped', 'dry-run'].includes(status)) return '→';
  return '✗';
}

function printSummary(results) {
  console.log('\n[post-video] Summary:');
  for (const r of results) {
    const icon = statusIcon(r.status);
    console.log(`  ${icon} ${r.platform}: ${r.status}${r.postUrl ? ' — ' + r.postUrl : ''}${r.error ? ' — ' + r.error : ''}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = opts.dryRun ? null : requireKey();
  const platforms = opts.platforms || ['tiktok', 'youtube', 'instagram'];
  console.log(`[post-video] campaign=${opts.campaign} platforms=${platforms.join(',')} dryRun=${opts.dryRun}`);

  const { videoPath, templateId } = prepareVideo(opts);
  const baseHash = hashContent(`video::template-${templateId}::${opts.campaign}`);
  const context = { apiKey, campaign: opts.campaign, dryRun: opts.dryRun, mediaItem: null, templateId, videoPath };
  const plans = platforms.map(platform => buildPlatformPlan(platform, baseHash)).filter(Boolean);
  const results = [];

  for (const plan of plans) {
    results.push(await processPlatform(plan, context));
  }

  printSummary(results);

  return results;
}

module.exports = {
  ACCOUNTS,
  CAPTIONS,
  PLATFORM_COOLDOWN_HOURS,
  buildPlatformPlan,
  duplicateResult,
  parseArgs,
  processPlatform,
  zernioUpload,
};

// Only auto-run when executed directly (keeps module require()-able for tests).
if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
