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
 *   node scripts/social-analytics/post-video.js --campaign=v1.4.0 --dry-run
 *   node scripts/social-analytics/post-video.js --video=/path/to/custom.mp4
 *
 * Required env:
 *   ZERNIO_API_KEY
 * Optional env (overrides hardcoded account IDs):
 *   ZERNIO_TIKTOK_ACCOUNT_ID
 *   ZERNIO_YOUTUBE_ACCOUNT_ID
 *   ZERNIO_INSTAGRAM_ACCOUNT_ID
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadLocalEnv } = require('./load-env');

loadLocalEnv();

const { hashContent, isDuplicate, record } = require('./db/marketing-db');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ZERNIO_BASE = 'https://zernio.com/api/v1';

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
  tiktok: `Your AI agent deleted prod config because it "looked unused" 😬

ThumbGate v1.4.0 intercepts BEFORE the action runs. Checks it against lessons from past failures. Blocks it permanently.

👎 feedback → lesson DB → prevention rule → physical gate

Not a prompt. A block.

npx thumbgate serve — free + open source
github.com/IgorGanapolsky/ThumbGate

#ClaudeCode #AIAgents #DevTools #TechTok #Coding #SoftwareDev #AITools #Programming #DevTok`,

  youtube: `ThumbGate v1.4.0: How to stop AI coding agents from repeating mistakes

Your agent force-pushed to main. Deleted prod config. Ran the wrong migration. You told it not to. Next session — same mistake.

ThumbGate solves this with pre-action gates: every 👎 becomes a lesson, every lesson becomes a gate, every gate is enforced via PreToolUse hooks.

v1.4.0: Thompson Sampling · LanceDB vector search · SQLite+FTS5 lesson DB

Free + open source: https://github.com/IgorGanapolsky/ThumbGate
npx thumbgate serve

#ClaudeCode #AIAgents #DevTools #Shorts`,

  instagram: `AI agent deleted prod config because it "looked unused" 😬

ThumbGate v1.4.0: pre-action safety gates that physically block known-bad patterns before they run.

👎 → lesson DB → prevention rule → blocked forever

Free + open source. Link in bio 👆

#AIAgents #ClaudeCode #DevTools #Coding #TechTok #SoftwareDev #AITools #MachineLearning #BuildInPublic`,
};

const YT_TITLE = 'ThumbGate v1.4.0: Stop AI Agents From Repeating Mistakes #shorts';

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

async function zernioUpload(apiKey, filePath) {
  const FormData = (() => {
    try { return require('form-data'); } catch { return null; }
  })();

  // Use curl as fallback (works through egress proxy)
  const out = execSync(
    `curl -s -X POST "${ZERNIO_BASE}/media" \
      -H "Authorization: Bearer ${apiKey}" \
      -F "files=@${filePath}"`,
    { maxBuffer: 10 * 1024 * 1024 }
  ).toString();

  const data = JSON.parse(out);
  const files = data.files || [];
  if (!files.length) throw new Error(`Zernio upload failed: ${out}`);
  return files[0].url;
}

async function zernioPost(apiKey, { platform, accountId, title, content, mediaUrl, mediaType = 'video' }) {
  const body = {
    content,
    mediaItems: [{ url: mediaUrl, type: mediaType }],
    platforms: [{ platform, accountId }],
    publishNow: true,
  };
  if (title) body.title = title;

  const payload = JSON.stringify(body).replace(/'/g, "'\\''");
  const out = execSync(
    `curl -s -X POST "${ZERNIO_BASE}/posts" \
      -H "Authorization: Bearer ${apiKey}" \
      -H "Content-Type: application/json" \
      -d '${payload}'`,
    { maxBuffer: 5 * 1024 * 1024 }
  ).toString();

  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Video generation
// ---------------------------------------------------------------------------

function generateVideo(outDir, template = 'auto') {
  const slidesScript = path.join(__dirname, '..', '..', '.artifacts', 'youtube-short', 'generate-slides.js');
  const concatFile = path.join(outDir, 'concat.txt');
  const videoOut = path.join(outDir, 'thumbgate-short.mp4');

  console.log('[post-video] Generating slides...');
  execSync(`node ${slidesScript} --out=${outDir} --template=${template}`, { stdio: 'inherit' });

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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = requireKey();

  const platforms = opts.platforms || ['tiktok', 'youtube', 'instagram'];
  console.log(`[post-video] campaign=${opts.campaign} platforms=${platforms.join(',')} dryRun=${opts.dryRun}`);

  // Generate or use provided video
  let videoPath = opts.videoPath;
  let templateId = opts.template;
  if (!videoPath) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-video-'));
    videoPath = generateVideo(tmpDir, opts.template);
    // Read back the chosen template id from manifest
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'manifest.json'), 'utf8'));
      templateId = String(manifest.templateId || opts.template);
    } catch {}
  }

  // Content hash includes templateId so each template gets its own dedup key
  const baseHash = hashContent(`video::template-${templateId}::${opts.campaign}`);

  // Upload once, reuse URL across platforms
  let mediaUrl = null;

  const results = [];

  for (const platform of platforms) {
    const caption = CAPTIONS[platform];
    if (!caption) {
      console.warn(`[post-video] No caption for platform: ${platform} — skipping`);
      continue;
    }

    const contentHash = hashContent(`${baseHash}::${platform}`);
    const cooldownHours = PLATFORM_COOLDOWN_HOURS[platform] || 4;
    const cooldownDays = cooldownHours / 24;

    // Dedup check — per-platform cooldown prevents over-posting
    const existing = isDuplicate(platform, contentHash, cooldownDays);
    if (existing) {
      console.log(`[post-video] SKIP ${platform} — already posted (${existing.published_at}): ${existing.post_url}`);
      results.push({ platform, status: 'skipped', reason: 'duplicate', existing });
      continue;
    }

    if (opts.dryRun) {
      console.log(`[post-video] DRY-RUN ${platform} — would post video`);
      results.push({ platform, status: 'dry-run' });
      continue;
    }

    // Upload video (once, reused)
    if (!mediaUrl) {
      console.log(`[post-video] Uploading video to Zernio...`);
      mediaUrl = await zernioUpload(apiKey, videoPath);
      console.log(`[post-video] Uploaded: ${mediaUrl}`);
    }

    console.log(`[post-video] Posting to ${platform}...`);
    try {
      const resp = await zernioPost(apiKey, {
        platform,
        accountId: ACCOUNTS[platform],
        title: platform === 'youtube' ? YT_TITLE : undefined,
        content: caption,
        mediaUrl,
      });

      const pl = resp.post?.platforms?.[0] || {};
      const status = pl.status || 'unknown';
      const postUrl = pl.platformPostUrl || '';
      const error = pl.errorMessage || resp.error || '';

      if (status === 'published') {
        console.log(`[post-video] ✓ ${platform}: ${postUrl}`);
        record({ type: 'video', platform, contentHash, postUrl, campaign: opts.campaign,
          tags: ['v1.4.0', 'short', opts.campaign],
          extra: { mediaUrl, templateId, zernioPostId: resp.post?._id } });
      } else {
        console.error(`[post-video] ✗ ${platform}: ${error}`);
        record({ type: 'video', platform, contentHash, status: 'failed', campaign: opts.campaign,
          extra: { error } });
      }

      results.push({ platform, status, postUrl, error });
    } catch (err) {
      console.error(`[post-video] ✗ ${platform} error: ${err.message}`);
      results.push({ platform, status: 'error', error: err.message });
    }
  }

  console.log('\n[post-video] Summary:');
  for (const r of results) {
    const icon = r.status === 'published' ? '✓' : r.status === 'skipped' ? '→' : '✗';
    console.log(`  ${icon} ${r.platform}: ${r.status}${r.postUrl ? ' — ' + r.postUrl : ''}${r.error ? ' — ' + r.error : ''}`);
  }

  return results;
}

main().catch(err => { console.error(err.message); process.exit(1); });
