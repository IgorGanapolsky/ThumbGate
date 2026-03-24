'use strict';

const path = require('node:path');
const { initDb } = require('./store');

const POLLERS = [
  { name: 'github', module: './pollers/github', envRequired: ['GITHUB_TOKEN'] },
  { name: 'instagram', module: './pollers/instagram', envRequired: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_USER_ID'] },
  { name: 'tiktok', module: './pollers/tiktok', envRequired: ['TIKTOK_ACCESS_TOKEN'] },
  { name: 'linkedin', module: './pollers/linkedin', envRequired: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN'] },
  { name: 'x', module: './pollers/x', envRequired: ['X_BEARER_TOKEN', 'X_USER_ID'] },
  { name: 'reddit', module: './pollers/reddit', envRequired: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'REDDIT_PASSWORD'] },
  { name: 'threads', module: './pollers/threads', envRequired: ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID'] },
  { name: 'youtube', module: './pollers/youtube', envRequired: ['YOUTUBE_API_KEY', 'YOUTUBE_CHANNEL_ID'] },
  { name: 'plausible', module: './pollers/plausible', envRequired: ['PLAUSIBLE_API_KEY', 'PLAUSIBLE_SITE_ID'] },
  { name: 'zernio', module: './pollers/zernio', envRequired: ['ZERNIO_API_KEY'] },
];

function hasEnv(keys) {
  return keys.every((k) => process.env[k]);
}

async function pollAll(options = {}) {
  const db = initDb(options.dbPath);
  const results = { succeeded: [], skipped: [], failed: [] };

  for (const poller of POLLERS) {
    if (!hasEnv(poller.envRequired)) {
      console.log(`⏭  ${poller.name}: skipped (missing env: ${poller.envRequired.filter((k) => !process.env[k]).join(', ')})`);
      results.skipped.push(poller.name);
      continue;
    }

    try {
      const mod = require(poller.module);
      const fn = mod[`poll${poller.name.charAt(0).toUpperCase()}${poller.name.slice(1)}`]
        || mod.pollGitHub || mod.pollInstagram || mod.pollTikTok
        || mod.pollLinkedIn || mod.pollX || mod.pollReddit
        || mod.pollThreads || mod.pollPlausible || mod.pollZernio;

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

module.exports = { pollAll, POLLERS };
