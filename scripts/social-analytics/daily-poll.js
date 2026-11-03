#!/usr/bin/env node
/**
 * Daily Analytics Poll
 * Runs all social analytics pollers (including Gumroad) and generates a summary.
 * Scheduled via cron at 9:04 AM EST daily (after content generation + publishing).
 */

const { initDb } = require('./store');

async function main() {
  const db = initDb();
  const json = process.argv.includes('--json');

  if (!json) {
    console.log('🔄 Running daily analytics poll...\n');
  }

  const results = {};
  
  const pollers = [
    { name: 'gumroad', module: require('./pollers/gumroad.js'), fn: 'pollGumroad' },
    { name: 'plausible', module: require('./pollers/plausible.js'), fn: 'pollPlausible' },
    { name: 'github', module: require('./pollers/github.js'), fn: 'pollGitHub' },
    { name: 'reddit', module: require('./pollers/reddit.js'), fn: 'pollReddit' },
    { name: 'youtube', module: require('./pollers/youtube.js'), fn: 'pollYouTube' },
    { name: 'linkedin', module: require('./pollers/linkedin.js'), fn: 'pollLinkedIn' },
    { name: 'threads', module: require('./pollers/threads.js'), fn: 'pollThreads' },
    { name: 'instagram', module: require('./pollers/instagram.js'), fn: 'pollInstagram' },
    { name: 'tiktok', module: require('./pollers/tiktok.js'), fn: 'pollTikTok' },
    { name: 'zernio', module: require('./pollers/zernio.js'), fn: 'pollZernio' },
  ];

  for (const { name, module, fn } of pollers) {
    try {
      if (module[fn]) {
        const result = await module[fn](db);
        results[name] = result;
        if (!json) {
          if (result.available) {
            const metrics = result.metrics || result;
            console.log(`  ✅ ${name}: ${JSON.stringify(metrics).substring(0, 120)}`);
          } else {
            console.log(`  ⚠️  ${name}: ${result.error}`);
          }
        }
      } else {
        results[name] = { available: false, error: `poll function '${fn}' not found` };
        if (!json) console.log(`  ⚠️  ${name}: function not found`);
      }
    } catch(e) {
      results[name] = { available: false, error: e.message };
      if (!json) console.log(`  ⚠️  ${name}: ${e.message}`);
    }
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  }
  
  if (!json) {
    console.log('\n✅ Daily poll complete.');
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
