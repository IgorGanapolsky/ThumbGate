'use strict';

const path = require('node:path');
const { loadLocalEnv } = require('./load-env');

loadLocalEnv({ envPath: path.resolve(__dirname, '..', '..', '.env') });

const { initDb } = require('./store');

/**
 * Canonical pollers (2026-04-20+): Zernio is the single social-stack abstraction.
 *
 * Why the trim:
 *   - Direct per-platform pollers (reddit, linkedin, x, threads, instagram, youtube, tiktok)
 *     require separate OAuth apps, tokens, and rate-limit handling. Most were silently
 *     skipping on missing env for months while dashboards still looked "green."
 *   - Zernio's /analytics endpoints cover every connected account through one API key,
 *     and its unified model maps cleanly to our engagement_metrics schema.
 *   - github + plausible remain direct because they are not social publishers and
 *     Zernio does not cover them.
 *
 * To re-enable direct pollers temporarily (e.g. to debug a Zernio outage), set
 * THUMBGATE_USE_DIRECT_POLLERS=1. This surfaces the legacy list without making it
 * the default contract.
 *
 * See CLAUDE.md § Social stack: Zernio canonical before broadening this list.
 */
const POLLERS = [
  { name: 'github', module: './pollers/github', envRequired: ['GITHUB_TOKEN'] },
  // PLAUSIBLE_SITE_ID defaults to thumbgate-production.up.railway.app if not set.
  { name: 'plausible', module: './pollers/plausible', envRequired: ['PLAUSIBLE_API_KEY'] },
  // Zernio covers all connected social accounts (Reddit, LinkedIn, Bluesky, Threads,
  // Instagram, YouTube, TikTok) via a unified API. This is the canonical social poller.
  { name: 'zernio', module: './pollers/zernio', envRequired: ['ZERNIO_API_KEY'] },
];

/**
 * Legacy direct-API pollers. Off by default. Activated only when
 * THUMBGATE_USE_DIRECT_POLLERS=1 — treat as emergency fallback, not steady state.
 *
 * X/Twitter was retired from distribution 2026-04-20 (see CLAUDE.md § Distribution
 * Channel Focus) and is no longer included in the legacy fallback either.
 */
const LEGACY_POLLERS = [
  { name: 'instagram', module: './pollers/instagram', envRequired: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_USER_ID'] },
  { name: 'tiktok', module: './pollers/tiktok', envRequired: ['TIKTOK_ACCESS_TOKEN'] },
  { name: 'linkedin', module: './pollers/linkedin', envRequired: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN'] },
  { name: 'reddit', module: './pollers/reddit', envRequired: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'REDDIT_PASSWORD'] },
  { name: 'threads', module: './pollers/threads', envRequired: ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID'] },
  { name: 'youtube', module: './pollers/youtube', envRequired: ['YOUTUBE_API_KEY', 'YOUTUBE_CHANNEL_ID'] },
];

function activePollers() {
  if (process.env.THUMBGATE_USE_DIRECT_POLLERS === '1') {
    return [...POLLERS, ...LEGACY_POLLERS];
  }
  return POLLERS;
}

function hasEnv(keys) {
  return keys.every((k) => process.env[k]);
}

async function pollAll(options = {}) {
  const db = initDb(options.dbPath);
  const results = { succeeded: [], skipped: [], failed: [] };

  const pollers = activePollers();

  for (const poller of pollers) {
    if (!hasEnv(poller.envRequired)) {
      console.log(`⏭  ${poller.name}: skipped (missing env: ${poller.envRequired.filter((k) => !process.env[k]).join(', ')})`);
      results.skipped.push(poller.name);
      continue;
    }

    try {
      const mod = require(poller.module);
      // Resolve the poll function by trying the simple title-case name first, then
      // known capitalization variants (pollGitHub, pollTikTok, pollLinkedIn, pollYouTube),
      // and finally any exported function whose name starts with "poll" as a last resort.
      const baseName = poller.name.charAt(0).toUpperCase() + poller.name.slice(1);
      const KNOWN_VARIANTS = {
        github:   'pollGitHub',
        tiktok:   'pollTikTok',
        linkedin: 'pollLinkedIn',
        youtube:  'pollYouTube',
      };
      const fn = mod[`poll${baseName}`]
        || (KNOWN_VARIANTS[poller.name] && mod[KNOWN_VARIANTS[poller.name]])
        || Object.values(mod).find((v) => typeof v === 'function' && v.name && v.name.startsWith('poll'));

      if (!fn) {
        console.log(`⚠  ${poller.name}: no poll function found in module`);
        results.skipped.push(poller.name);
        continue;
      }

      console.log(`🔄 ${poller.name}: polling...`);
      await fn(db);
      console.log(`✅ ${poller.name}: complete`);
      results.succeeded.push(poller.name);
    } catch (err) {
      console.error(`❌ ${poller.name}: ${err.message}`);
      results.failed.push({ name: poller.name, error: err.message });
    }
  }

  db.close();
  return results;
}

async function main() {
  console.log('=== Social Analytics Poll All ===');
  console.log(`Time: ${new Date().toISOString()}`);
  if (process.env.THUMBGATE_USE_DIRECT_POLLERS === '1') {
    console.log('Mode: DIRECT (legacy per-platform pollers enabled)');
  } else {
    console.log('Mode: ZERNIO-CANONICAL (github + plausible + zernio)');
  }
  console.log('');

  const results = await pollAll();

  console.log('');
  console.log('=== Summary ===');
  console.log(`Succeeded: ${results.succeeded.join(', ') || 'none'}`);
  console.log(`Skipped:   ${results.skipped.join(', ') || 'none'}`);
  console.log(`Failed:    ${results.failed.map((f) => f.name).join(', ') || 'none'}`);

  // Exit non-zero only if nothing succeeded AND there were failures.
  // Partial success (some pollers skipped/failed but at least one succeeded) is OK.
  if (results.succeeded.length === 0 && results.failed.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { pollAll, POLLERS, LEGACY_POLLERS, activePollers };
