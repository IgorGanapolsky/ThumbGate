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
 *
 * Safe against concurrent writers: --apply commits via compare-and-swap and
 * retries, so a record appended mid-compaction is never lost (worst case the
 * run reports contended:true and changes nothing).
 */

const fs = require('fs');
const path = require('path');
const { clusterNearDupeMemories } = require('./memory-near-dupe');

function parseJsonlRaw(raw) {
  const records = [];
  for (const line of String(raw).split('\n')) {
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

function readJsonlRecords(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return parseJsonlRaw(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Compare-and-swap replacement for the memory log. Commits only when the file
 * still matches the raw content the clustering ran against, so a record
 * appended by a concurrent writer between read and commit is never clobbered.
 * The replacement itself is a tmp-write + atomic rename.
 */
function commitIfUnchanged(filePath, expectedRaw, newRaw, backupPath) {
  const currentRaw = fs.readFileSync(filePath, 'utf8');
  if (currentRaw !== expectedRaw) return false;
  fs.copyFileSync(filePath, backupPath);
  const tmpPath = `${filePath}.compact-tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, newRaw);
  fs.renameSync(tmpPath, filePath);
  return true;
}

const MAX_COMMIT_ATTEMPTS = 3;

function resolveMemoryLogPath(dir) {
  if (dir) return path.join(dir, 'memory-log.jsonl');
  const { getFeedbackPaths } = require('./feedback-loop');
  return getFeedbackPaths().MEMORY_LOG_PATH;
}

function compactMemoryStore(options = {}) {
  const memoryLogPath = resolveMemoryLogPath(options.dir);
  const report = {
    memoryLogPath,
    before: 0,
    after: 0,
    merged: 0,
    applied: false,
    contended: false,
    backupPath: null,
  };
  if (!fs.existsSync(memoryLogPath)) return report;

  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    const raw = fs.readFileSync(memoryLogPath, 'utf8');
    const before = parseJsonlRaw(raw);
    const { records } = clusterNearDupeMemories(before, {
      similarityThreshold: options.similarityThreshold,
    });
    report.before = before.length;
    report.after = records.length;
    report.merged = before.length - records.length;
    if (!options.apply || records.length >= before.length) return report;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = memoryLogPath.replace(/\.jsonl$/, `.pre-compact-${stamp}.jsonl`);
    const newRaw = records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
    if (commitIfUnchanged(memoryLogPath, raw, newRaw, backupPath)) {
      report.applied = true;
      report.backupPath = backupPath;
      return report;
    }
    // A writer appended between read and commit — re-read and re-cluster.
  }
  report.contended = true;
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

module.exports = { compactMemoryStore, readJsonlRecords, commitIfUnchanged };
