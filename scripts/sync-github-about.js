#!/usr/bin/env node
'use strict';

const {
  compareGitHubAbout,
  fetchLiveGitHubAbout,
  loadGitHubAboutConfig,
  updateLiveGitHubAbout,
} = require('./github-about');

async function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const about = loadGitHubAboutConfig();
  const before = await fetchLiveGitHubAbout({ repo: about.repo });
  const drift = compareGitHubAbout(about, before, `Live GitHub About (${about.repo})`);

  if (drift.length === 0) {
    console.log(`✅ GitHub About already matches source of truth for ${about.repo}.`);
    return;
  }

  if (!write) {
    console.error(`\n❌ GitHub About drift detected for ${about.repo}:\n`);
    for (const error of drift) {
      console.error(`  • ${error}`);
    }
    console.error('');
    process.exit(1);
  }

  console.log(`Syncing GitHub About for ${about.repo}...`);
  await updateLiveGitHubAbout({ repo: about.repo });

  const after = await fetchLiveGitHubAbout({ repo: about.repo });
  const remaining = compareGitHubAbout(about, after, `Live GitHub About (${about.repo})`);
  if (remaining.length > 0) {
    console.error(`\n❌ GitHub About sync incomplete for ${about.repo}:\n`);
    for (const error of remaining) {
      console.error(`  • ${error}`);
    }
    console.error('');
    process.exit(1);
  }

  console.log(`✅ GitHub About synced for ${about.repo}.`);
}

main().catch((error) => {
  console.error(`\n❌ GitHub About sync failed: ${error.message}\n`);
  process.exit(1);
});
