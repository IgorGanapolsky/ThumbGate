#!/usr/bin/env node
'use strict';

/**
 * Maintenance CLI: compact memory-log.jsonl by clustering near-duplicate
 * promoted lessons (canonical hash + bigram similarity) with honest
 * occurrence merging. See scripts/memory-near-dupe.js for the policy.
 *
 * Dry-run by default — prints a JSON report and touches nothing.
 *   node scripts/compact-memory-store.js
 *   node scripts/compact-memory-store.js --apply           # writes, after backup
 *   node scripts/compact-memory-store.js --dir=/some/dir   # override feedback dir
 *   node scripts/compact-memory-store.js --threshold=0.9
 */

const fs = require('fs');
const path = require('path');
const { clusterNearDupeMemories } = require('./memory-near-dupe');

function readJsonlRecords(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const records = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Unparseable lines are excluded from the compacted output; the
      // pre-compaction backup keeps them recoverable.
    }
  }
  return records;
}

function resolveMemoryLogPath(dir) {
  if (dir) return path.join(dir, 'memory-log.jsonl');
  const { getFeedbackPaths } = require('./feedback-loop');
  return getFeedbackPaths().MEMORY_LOG_PATH;
}

function compactMemoryStore(options = {}) {
  const memoryLogPath = resolveMemoryLogPath(options.dir);
  const before = readJsonlRecords(memoryLogPath);
  const { records, stats } = clusterNearDupeMemories(before, {
    similarityThreshold: options.similarityThreshold,
  });
  const report = {
    memoryLogPath,
    before: before.length,
    after: records.length,
    merged: stats.merged,
    applied: false,
    backupPath: null,
  };
  if (options.apply && records.length < before.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    report.backupPath = memoryLogPath.replace(/\.jsonl$/, `.pre-compact-${stamp}.jsonl`);
    fs.copyFileSync(memoryLogPath, report.backupPath);
    fs.writeFileSync(
      memoryLogPath,
      records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''),
    );
    report.applied = true;
  }
  return report;
}

function parseArgs(argv) {
  const options = { apply: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--dir=')) options.dir = arg.slice('--dir='.length);
    else if (arg.startsWith('--threshold=')) options.similarityThreshold = Number(arg.slice('--threshold='.length));
  }
  return options;
}

// Path-based main check: the `require.main === module` form trips SonarCloud S3403.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const report = compactMemoryStore(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
  if (!report.applied) {
    console.log('[dry-run] pass --apply to write the compacted memory log (a timestamped backup is created first)');
  }
}

module.exports = { compactMemoryStore, readJsonlRecords };
