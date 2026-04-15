'use strict';

/**
 * run-social-post.js
 * Posts ThumbGate content across all social platforms.
 * Uses Zernio API for publishing.
 */

const { loadLocalEnv } = require('./load-env');
loadLocalEnv();

const {
  uploadLocalMedia,
  publishPost,
} = require('./publishers/zernio');

const path = require('node:path');

// Content for each platform group
const GITHUB_URL = 'https://github.com/IgorGanapolsky/ThumbGate';

// Morning angle: Technical insight — Thompson Sampling gate self-tuning, architecture
const FULL_POST = `Thompson Sampling self-tunes every gate in real time. High-value blocks gain weight; stale rules fade out automatically. ThumbGate adapts to your codebase — no LLM calls, no manual tuning. ${GITHUB_URL} #AIAgents #Architecture`;

const LINKEDIN_POST = `How does ThumbGate decide which gates matter most? Thompson Sampling.

Each PreToolUse gate starts with equal weight. Every time a gate fires and the feedback confirms it was correct, the gate gains confidence. Every false positive or stale rule naturally decays. No LLM required. No human retuning.

The result: your 33 gates evolve with your codebase. Budget enforcement gates tighten when you approach your action limit. Destructive-command gates sharpen after near-misses. Architecture stays simple — the intelligence is Bayesian, not neural.

Gate your AI agents before they gate you.

Open source: ${GITHUB_URL} #AIAgents #Architecture`;

// Bluesky: strict 300 char limit
const BLUESKY_POST = `Thompson Sampling self-tunes ThumbGate's pre-action gates. High-value blocks gain weight; stale rules fade. No LLM, no manual tuning. ${GITHUB_URL} #AIAgents`;

// Platform account IDs (from task spec)
const PLATFORMS = {
  twitter: { platform: 'twitter', accountId: '69d3e03e7dea335c2bbcd5bd' },
  linkedin: { platform: 'linkedin', accountId: '69c14c536cb7b8cf4c91bd65' },
  bluesky: { platform: 'bluesky', accountId: '69d939187dea335c2bd3d880' },
  threads: { platform: 'threads', accountId: '69d939607dea335c2bd3da87' },
  instagram: { platform: 'instagram', accountId: '69bed6ad6cb7b8cf4c8b0865' },
  tiktok: { platform: 'tiktok', accountId: '69bee0fd6cb7b8cf4c8b2425' },
  youtube: { platform: 'youtube', accountId: '69c14dc36cb7b8cf4c91c1e4' },
};

const IMAGE_PATH = path.join(__dirname, '..', '..', '.thumbgate', 'instagram-card.png');

async function run() {
  console.log('[social-post] Starting ThumbGate social post run — 2026-04-14');

  // Step 1: Upload image to Zernio
  console.log('[social-post] Uploading Instagram card image...');
  let mediaItems;
  try {
    const uploaded = await uploadLocalMedia(IMAGE_PATH);
    console.log(`[social-post] Image uploaded: ${uploaded.url}`);
    mediaItems = [{
      url: uploaded.url,
      type: uploaded.type,
    }];
  } catch (err) {
    console.error(`[social-post] Image upload failed: ${err.message}`);
    console.error('[social-post] Proceeding without media for visual platforms (posts may be skipped by platform)');
    mediaItems = null;
  }

  const results = [];

  // Step 2: Post to visual platforms (Instagram, TikTok, YouTube) WITH image
  if (mediaItems) {
    console.log('[social-post] Publishing to Instagram, TikTok, YouTube (with image)...');
    try {
      const result = await publishPost(FULL_POST, [
        PLATFORMS.instagram,
        PLATFORMS.tiktok,
        PLATFORMS.youtube,
      ], { mediaItems });
      console.log(`[social-post] Visual platforms result: ${JSON.stringify(result)}`);
      results.push({ group: 'visual', result });
    } catch (err) {
      console.error(`[social-post] Visual platforms failed: ${err.message}`);
      results.push({ group: 'visual', error: err.message });
    }
  }

  // Step 3: Twitter (280 char limit)
  const twitterPost = FULL_POST.length <= 280 ? FULL_POST : FULL_POST.slice(0, 277) + '...';
  console.log(`[social-post] Publishing to Twitter (${twitterPost.length} chars)...`);
  try {
    const result = await publishPost(twitterPost, [PLATFORMS.twitter]);
    console.log(`[social-post] Twitter result: ${JSON.stringify(result)}`);
    results.push({ group: 'twitter', result });
  } catch (err) {
    console.error(`[social-post] Twitter failed: ${err.message}`);
    results.push({ group: 'twitter', error: err.message });
  }

  // Step 4: LinkedIn (long-form)
  console.log('[social-post] Publishing to LinkedIn...');
  try {
    const result = await publishPost(LINKEDIN_POST, [PLATFORMS.linkedin]);
    console.log(`[social-post] LinkedIn result: ${JSON.stringify(result)}`);
    results.push({ group: 'linkedin', result });
  } catch (err) {
    console.error(`[social-post] LinkedIn failed: ${err.message}`);
    results.push({ group: 'linkedin', error: err.message });
  }

  // Step 5: Bluesky (300 char limit)
  console.log(`[social-post] Publishing to Bluesky (${BLUESKY_POST.length} chars)...`);
  if (BLUESKY_POST.length > 300) {
    console.error(`[social-post] BLUESKY_POST exceeds 300 chars (${BLUESKY_POST.length}). Skipping.`);
    results.push({ group: 'bluesky', error: 'content too long for bluesky' });
  } else {
    try {
      const result = await publishPost(BLUESKY_POST, [PLATFORMS.bluesky]);
      console.log(`[social-post] Bluesky result: ${JSON.stringify(result)}`);
      results.push({ group: 'bluesky', result });
    } catch (err) {
      console.error(`[social-post] Bluesky failed: ${err.message}`);
      results.push({ group: 'bluesky', error: err.message });
    }
  }

  // Step 6: Threads
  console.log('[social-post] Publishing to Threads...');
  try {
    const result = await publishPost(FULL_POST, [PLATFORMS.threads]);
    console.log(`[social-post] Threads result: ${JSON.stringify(result)}`);
    results.push({ group: 'threads', result });
  } catch (err) {
    console.error(`[social-post] Threads failed: ${err.message}`);
    results.push({ group: 'threads', error: err.message });
  }

  console.log('\n[social-post] === SUMMARY ===');
  const successes = results.filter(r => !r.error && !r.result?.blocked);
  const blocked = results.filter(r => r.result?.blocked);
  const failures = results.filter(r => r.error);
  console.log(`Published: ${successes.length} | Blocked (dedup/gate): ${blocked.length} | Failed: ${failures.length}`);
  if (failures.length > 0) {
    for (const f of failures) {
      console.log(`  ❌ ${f.group}: ${f.error}`);
    }
  }
  if (blocked.length > 0) {
    for (const b of blocked) {
      console.log(`  ⚠️  ${b.group}: blocked (${JSON.stringify(b.result?.reasons)})`);
    }
  }
  console.log('[social-post] Done.');
}

run().catch(err => {
  console.error('[social-post] Fatal error:', err.message);
  process.exit(1);
});
