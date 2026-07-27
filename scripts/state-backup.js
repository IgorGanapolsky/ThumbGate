#!/usr/bin/env node
'use strict';

/**
 * state-backup.js — rolling local backup of ~/.thumbgate
 *
 * On 2026-07-26 the mini's ~/.thumbgate went from ~50 files to 4. The lessons database,
 * feedback log, gate statistics, governance state and audit trail were all lost and were
 * NOT recoverable: no .bak files existed and Time Machine returned "Operation not permitted".
 * Nothing alerted; it was found by accident.
 *
 * That corpus is the entire value of a self-improving firewall — every lesson it has learned.
 * Losing it silently is worse than a crash, because the product keeps running and quietly
 * knows nothing.
 *
 * This keeps N timestamped snapshots of the small, high-value state files. It deliberately
 * does NOT copy `runtime/` (reinstallable from npm) or `logs/` (large, low value).
 *
 *   node scripts/state-backup.js            # take a snapshot, prune old ones
 *   node scripts/state-backup.js --list     # show snapshots
 *   node scripts/state-backup.js --verify   # non-zero exit if there is no recent snapshot
 *   node scripts/state-backup.js --restore <snapshot>
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = process.env.THUMBGATE_HOME || path.join(os.homedir(), '.thumbgate');
const BACKUP_ROOT = process.env.THUMBGATE_BACKUP_DIR || path.join(HOME, 'backups');
const KEEP = Number(process.env.THUMBGATE_BACKUP_KEEP || 14);
const STALE_HOURS = Number(process.env.THUMBGATE_BACKUP_STALE_HOURS || 48);

// Small, irreplaceable, and cheap to copy. Everything here is state the product LEARNED;
// none of it can be regenerated from the package.
const PRECIOUS = [
  'lessons.sqlite',
  'lessons-index.jsonl',
  'lesson-embeddings.json',
  'feedback-log.jsonl',
  'attributed-feedback.jsonl',
  'gate-stats.json',
  'gate-state.json',
  'governance-state.json',
  'audit-trail.jsonl',
  'action-log.jsonl',
  'action-receipts.jsonl',
  'decision-journal.jsonl',
  'synthesized-rules.jsonl',
  'memory-log.jsonl',
  'risk-model.json',
  'intervention-policy.json',
  'session-constraints.json',
  'config.json',
  'install-id',
  'gate-canary-baseline.json',
];

function timestamp(nowMs) {
  return new Date(nowMs).toISOString().replace(/[:.]/g, '-');
}

function listSnapshots() {
  try {
    return fs.readdirSync(BACKUP_ROOT)
      .filter((name) => name.startsWith('snapshot-'))
      .sort();
  } catch {
    return [];
  }
}

function snapshotAgeMs(name, nowMs) {
  try {
    return nowMs - fs.statSync(path.join(BACKUP_ROOT, name)).mtimeMs;
  } catch {
    return Infinity;
  }
}

function backup(nowMs) {
  if (!fs.existsSync(HOME)) {
    process.stderr.write(`state-backup: no ThumbGate home at ${HOME}\n`);
    return 2;
  }
  const dest = path.join(BACKUP_ROOT, `snapshot-${timestamp(nowMs)}`);
  fs.mkdirSync(dest, { recursive: true });

  let copied = 0;
  let bytes = 0;
  for (const name of PRECIOUS) {
    const src = path.join(HOME, name);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, path.join(dest, name));
      bytes += fs.statSync(src).size;
      copied += 1;
    } catch (error) {
      process.stderr.write(`state-backup: could not copy ${name}: ${error.message}\n`);
    }
  }

  if (copied === 0) {
    // An empty snapshot is worse than none: it looks like protection and holds nothing.
    fs.rmSync(dest, { recursive: true, force: true });
    process.stderr.write('state-backup: nothing to back up — no state files present\n');
    return 2;
  }

  fs.writeFileSync(path.join(dest, 'MANIFEST.json'), JSON.stringify({
    createdAtMs: nowMs,
    source: HOME,
    files: copied,
    bytes,
  }, null, 2));

  // Prune oldest beyond KEEP.
  const snapshots = listSnapshots();
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - KEEP))) {
    fs.rmSync(path.join(BACKUP_ROOT, stale), { recursive: true, force: true });
  }

  process.stdout.write(`Backed up ${copied} files (${(bytes / 1024).toFixed(1)} KiB) -> ${dest}\n`);
  return 0;
}

function verify(nowMs) {
  const snapshots = listSnapshots();
  if (!snapshots.length) {
    process.stderr.write(`state-backup: NO SNAPSHOTS in ${BACKUP_ROOT}. State loss would be unrecoverable.\n`);
    return 1;
  }
  const newest = snapshots[snapshots.length - 1];
  const ageHours = snapshotAgeMs(newest, nowMs) / 3_600_000;
  if (ageHours > STALE_HOURS) {
    process.stderr.write(`state-backup: newest snapshot is ${ageHours.toFixed(1)}h old (limit ${STALE_HOURS}h): ${newest}\n`);
    return 1;
  }
  process.stdout.write(`OK: ${snapshots.length} snapshot(s), newest ${ageHours.toFixed(1)}h old (${newest})\n`);
  return 0;
}

function restore(name) {
  const src = path.join(BACKUP_ROOT, name);
  if (!fs.existsSync(src)) {
    process.stderr.write(`state-backup: no such snapshot ${name}\n`);
    return 2;
  }
  let restored = 0;
  for (const file of fs.readdirSync(src)) {
    if (file === 'MANIFEST.json') continue;
    fs.copyFileSync(path.join(src, file), path.join(HOME, file));
    restored += 1;
  }
  process.stdout.write(`Restored ${restored} files from ${name} -> ${HOME}\n`);
  return 0;
}

function main(argv, nowMs) {
  if (argv.includes('--list')) {
    const snapshots = listSnapshots();
    if (!snapshots.length) process.stdout.write('No snapshots.\n');
    for (const name of snapshots) {
      process.stdout.write(`${name}  (${(snapshotAgeMs(name, nowMs) / 3_600_000).toFixed(1)}h old)\n`);
    }
    return 0;
  }
  if (argv.includes('--verify')) return verify(nowMs);
  const restoreIndex = argv.indexOf('--restore');
  if (restoreIndex !== -1) return restore(argv[restoreIndex + 1]);
  return backup(nowMs);
}

module.exports = { PRECIOUS, listSnapshots, backup, verify, restore, main };

if (require.main && require.main.filename === module.filename) {
  process.exit(main(process.argv.slice(2), Date.now()));
}
