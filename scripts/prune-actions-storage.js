#!/usr/bin/env node
'use strict';

/**
 * Prune GitHub Actions Storage Artifacts to stay frugal and under the 2 GB free limit.
 * Deletes artifacts older than MAX_AGE_HOURS (default: 24h).
 *
 * Usage:
 *   node scripts/prune-actions-storage.js [--max-age-hours=24] [--limit=500]
 */

const { execFileSync } = require('node:child_process');

const REPO = process.env.GITHUB_REPOSITORY || 'IgorGanapolsky/ThumbGate';
const MAX_AGE_HOURS = Number((process.argv.find((a) => a.startsWith('--max-age-hours=')) || '').split('=')[1]) || 24;
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 1000;

function fetchArtifactsPage(page = 1) {
  try {
    const raw = execFileSync(
      'gh',
      ['api', `repos/${REPO}/actions/artifacts?per_page=100&page=${page}`],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to fetch page ${page}:`, err.message);
    return { artifacts: [] };
  }
}

function deleteArtifact(id) {
  try {
    execFileSync('gh', ['api', '-X', 'DELETE', `repos/${REPO}/actions/artifacts/${id}`], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`[Storage Pruner] Auditing GitHub Actions storage for ${REPO}...`);
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);

  let deletedCount = 0;
  let freedBytes = 0;
  let page = 1;

  while (deletedCount < LIMIT) {
    const data = fetchArtifactsPage(page);
    const artifacts = data.artifacts || [];
    if (!artifacts.length) break;

    const toDelete = artifacts.filter((a) => {
      const createdAt = new Date(a.created_at);
      return createdAt < cutoff || a.expired;
    });

    if (!toDelete.length) {
      page += 1;
      if (page > 10) break;
      continue;
    }

    console.log(`[Storage Pruner] Page ${page}: deleting ${toDelete.length} artifacts created before ${cutoff.toISOString()}...`);

    for (const item of toDelete) {
      if (deleteArtifact(item.id)) {
        deletedCount += 1;
        freedBytes += item.size_in_bytes || 0;
      }
      if (deletedCount >= LIMIT) break;
    }

    // Refresh page 1 if we deleted from current view
    page = 1;
  }

  const freedMB = (freedBytes / (1024 * 1024)).toFixed(2);
  console.log(`[Storage Pruner] Deleted ${deletedCount} artifacts. Freed ~${freedMB} MB of Actions Storage.`);
}

main().catch((err) => {
  console.error('[Storage Pruner] Error:', err);
  process.exit(1);
});
