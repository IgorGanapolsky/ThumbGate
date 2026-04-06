#!/usr/bin/env node
/**
 * JSONL File Watcher
 *
 * Watches feedback-log.jsonl for new entries written by external sources
 * (e.g., Amp plugin bridge) and routes them through captureFeedback()
 * for full pipeline processing: memory promotion, vector indexing,
 * sequence tracking, and DPO export eligibility.
 *
 * Usage:
 *   node scripts/jsonl-watcher.js                    # watch mode
 *   node scripts/jsonl-watcher.js --once             # process pending, exit
 *   node scripts/jsonl-watcher.js --source amp-plugin-bridge  # filter by source
 *
 * The watcher tracks its position via .thumbgate/.watcher-offset to avoid
 * reprocessing entries on restart.
 */

const fs = require('fs');
const path = require('path');
const { captureFeedback, getFeedbackPaths } = require('./feedback-loop');

const POLL_INTERVAL_MS = 2000;
const WATCHER_SOURCE_TAG = 'watcher-ingested';

// Use stderr for logging so stdout stays clean for MCP JSON-RPC when co-hosted
const log = (...args) => process.stderr.write(`${args.join(' ')}\n`);

function getOffsetPath(feedbackDir) {
  return path.join(feedbackDir, '.watcher-offset');
}

function readOffset(feedbackDir) {
  const offsetPath = getOffsetPath(feedbackDir);
  try {
    return parseInt(fs.readFileSync(offsetPath, 'utf-8').trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function writeOffset(feedbackDir, offset) {
  fs.writeFileSync(getOffsetPath(feedbackDir), String(offset) + '\n');
}

function parseEntry(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function shouldIngest(entry, sourceFilter) {
  // Only ingest entries from external sources (not from captureFeedback itself)
  if (!entry || !entry.source) return false;
  if (sourceFilter && entry.source !== sourceFilter) return false;
  // Skip entries already ingested by the watcher
  if (entry.tags && entry.tags.includes(WATCHER_SOURCE_TAG)) return false;
  return true;
}

function ingestEntry(entry) {
  const signal = entry.signal === 'positive' ? 'up' : entry.signal === 'negative' ? 'down' : entry.signal;

  const result = captureFeedback({
    signal,
    context: entry.context || '',
    whatWentWrong: entry.whatWentWrong || undefined,
    whatToChange: entry.whatToChange || undefined,
    whatWorked: entry.whatWorked || undefined,
    tags: [...(entry.tags || []), WATCHER_SOURCE_TAG, `bridged-from:${entry.source}`],
    skill: entry.skill || undefined,
  });

  return result;
}

function processNewEntries(feedbackDir, feedbackLogPath, sourceFilter) {
  if (!fs.existsSync(feedbackLogPath)) return { processed: 0, promoted: 0 };

  const content = fs.readFileSync(feedbackLogPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  const offset = readOffset(feedbackDir);

  if (offset >= lines.length) return { processed: 0, promoted: 0 };

  const newLines = lines.slice(offset);
  let processed = 0;
  let promoted = 0;

  for (const line of newLines) {
    const entry = parseEntry(line);
    if (shouldIngest(entry, sourceFilter)) {
      const result = ingestEntry(entry);
      processed++;
      if (result && result.accepted) promoted++;
    }
  }

  writeOffset(feedbackDir, lines.length);
  return { processed, promoted };
}

function watch(sourceFilter) {
  const { FEEDBACK_DIR, FEEDBACK_LOG_PATH } = getFeedbackPaths();

  // Initialize offset to current end of file to avoid reprocessing history
  if (!fs.existsSync(getOffsetPath(FEEDBACK_DIR))) {
    if (fs.existsSync(FEEDBACK_LOG_PATH)) {
      const lines = fs.readFileSync(FEEDBACK_LOG_PATH, 'utf-8').split('\n').filter(Boolean);
      writeOffset(FEEDBACK_DIR, lines.length);
    } else {
      writeOffset(FEEDBACK_DIR, 0);
    }
    log(`[jsonl-watcher] Initialized offset at current end of file`);
  }

  log(`[jsonl-watcher] Watching ${FEEDBACK_LOG_PATH}`);
  if (sourceFilter) log(`[jsonl-watcher] Filtering source: ${sourceFilter}`);

  setInterval(() => {
    try {
      const result = processNewEntries(FEEDBACK_DIR, FEEDBACK_LOG_PATH, sourceFilter);
      if (result.processed > 0) {
        log(`[jsonl-watcher] Ingested ${result.processed} entries (${result.promoted} promoted)`);
      }
    } catch (err) {
      log(`[jsonl-watcher] Poll error (non-fatal): ${err.message}`);
    }
  }, POLL_INTERVAL_MS);
}

function once(sourceFilter) {
  const { FEEDBACK_DIR, FEEDBACK_LOG_PATH } = getFeedbackPaths();
  const result = processNewEntries(FEEDBACK_DIR, FEEDBACK_LOG_PATH, sourceFilter);
  log(`[jsonl-watcher] Processed ${result.processed} entries (${result.promoted} promoted)`);
  return result;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const isOnce = args.includes('--once');
  const sourceIdx = args.indexOf('--source');
  const sourceFilter = sourceIdx >= 0 ? args[sourceIdx + 1] : undefined;

  if (isOnce) {
    once(sourceFilter);
  } else {
    watch(sourceFilter);
  }
}

module.exports = { processNewEntries, ingestEntry, shouldIngest, watch, once };
