#!/usr/bin/env node
'use strict';

/**
 * HuggingFace Dataset Exporter
 *
 * Exports ThumbGate agent traces as a HuggingFace-compatible dataset in two formats:
 *
 * 1. Agent Traces (traces split) — raw feedback entries with tool calls, signals,
 *    context, and outcomes. Matches the "share your agent traces" initiative.
 *
 * 2. DPO Preferences (preferences split) — chosen/rejected preference pairs
 *    derived from error→learning memory promotion. Ready for DPO/RLHF training.
 *
 * Output: Parquet-compatible JSONL files + dataset_info.json (HF Dataset Card metadata).
 *
 * HuggingFace Datasets format:
 *   dataset_dir/
 *     dataset_info.json        — metadata, features schema, splits
 *     traces.jsonl             — agent trace rows
 *     preferences.jsonl        — DPO preference pair rows
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { exportDpoFromMemories } = require('./export-dpo-pairs');
const { getProvenance } = require('./contextfs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJSONL(filePath, rows) {
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, content ? `${content}\n` : '');
}

// ---------------------------------------------------------------------------
// PII / path redaction
// ---------------------------------------------------------------------------

function redactPaths(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text
    .replace(/\/Users\/[^\s/]+/g, '/Users/redacted')
    .replace(/\/home\/[^\s/]+/g, '/home/redacted')
    .replace(/C:\\Users\\[^\s\\]+/g, 'C:\\Users\\redacted');
}

function redactEntry(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      out[key] = redactPaths(value);
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === 'string' ? redactPaths(v) : v));
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trace row builder — converts feedback-log entries to HF trace rows
// ---------------------------------------------------------------------------

function buildTraceRow(entry, index) {
  return {
    trace_id: entry.id || `trace_${index}`,
    timestamp: entry.timestamp || null,
    signal: entry.signal || entry.feedback || 'unknown',
    tool_name: entry.toolName || entry.actionType || 'unknown',
    context: redactPaths(entry.context || ''),
    what_worked: redactPaths(entry.whatWorked || ''),
    what_went_wrong: redactPaths(entry.whatWentWrong || ''),
    what_to_change: redactPaths(entry.whatToChange || ''),
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    failure_type: entry.failureType || null,
    source: 'thumbgate',
  };
}

// ---------------------------------------------------------------------------
// Preference row builder — converts DPO pairs to HF preference rows
// ---------------------------------------------------------------------------

function buildPreferenceRow(pair, index) {
  return {
    pair_id: `pref_${index}`,
    prompt: redactPaths(pair.prompt || ''),
    chosen: redactPaths(pair.chosen || ''),
    rejected: redactPaths(pair.rejected || ''),
    match_score: pair.metadata ? pair.metadata.matchScore : null,
    matched_keys: pair.metadata ? pair.metadata.matchedKeys || [] : [],
    rubric_delta: pair.metadata && pair.metadata.rubric
      ? pair.metadata.rubric.weightedDelta
      : null,
    source: 'thumbgate',
  };
}

// ---------------------------------------------------------------------------
// Dataset info (HuggingFace Dataset Card metadata)
// ---------------------------------------------------------------------------

function buildDatasetInfo({ traceCount, preferenceCount, exportedAt }) {
  return {
    dataset_info: {
      description: 'Agent traces and DPO preference pairs from ThumbGate — pre-action gates for AI coding agents. Contains real-world tool call feedback, failure patterns, and learned corrections.',
      citation: '',
      homepage: 'https://github.com/IgorGanapolsky/ThumbGate',
      license: 'MIT',
      features: {
        traces: {
          trace_id: { dtype: 'string' },
          timestamp: { dtype: 'string' },
          signal: { dtype: 'string' },
          tool_name: { dtype: 'string' },
          context: { dtype: 'string' },
          what_worked: { dtype: 'string' },
          what_went_wrong: { dtype: 'string' },
          what_to_change: { dtype: 'string' },
          tags: { dtype: 'list', inner: { dtype: 'string' } },
          failure_type: { dtype: 'string' },
          source: { dtype: 'string' },
        },
        preferences: {
          pair_id: { dtype: 'string' },
          prompt: { dtype: 'string' },
          chosen: { dtype: 'string' },
          rejected: { dtype: 'string' },
          match_score: { dtype: 'float32' },
          matched_keys: { dtype: 'list', inner: { dtype: 'string' } },
          rubric_delta: { dtype: 'float32' },
          source: { dtype: 'string' },
        },
      },
      splits: {
        traces: { num_examples: traceCount },
        preferences: { num_examples: preferenceCount },
      },
    },
    exported_at: exportedAt,
    exporter: 'thumbgate/export-hf-dataset',
    version: '1.0.0',
  };
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Export ThumbGate data as a HuggingFace-compatible dataset.
 *
 * @param {Object} options
 * @param {string} [options.outputDir] - Directory to write dataset files
 * @param {string} [options.feedbackDir] - Override feedback data directory
 * @param {boolean} [options.includeProvenance] - Include provenance events in traces
 * @returns {Object} Export summary
 */
function exportHfDataset(options = {}) {
  const feedbackDir = options.feedbackDir || resolveFeedbackDir();
  const outputDir = options.outputDir || path.join(feedbackDir, 'hf-dataset');
  const includeProvenance = options.includeProvenance !== false;

  ensureDir(outputDir);

  // --- Traces split ---
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const feedbackEntries = readJSONL(feedbackLogPath);
  const traceRows = feedbackEntries.map((entry, i) => buildTraceRow(redactEntry(entry), i));

  // Optionally append provenance events as traces
  if (includeProvenance) {
    try {
      const provenanceEvents = getProvenance(200);
      for (const evt of provenanceEvents) {
        traceRows.push({
          trace_id: evt.id || `prov_${traceRows.length}`,
          timestamp: evt.timestamp || null,
          signal: 'provenance',
          tool_name: evt.type || 'context_assembly',
          context: redactPaths(JSON.stringify(evt).slice(0, 500)),
          what_worked: '',
          what_went_wrong: '',
          what_to_change: '',
          tags: ['provenance'],
          failure_type: null,
          source: 'thumbgate',
        });
      }
    } catch {
      // Provenance read failure should not break export
    }
  }

  writeJSONL(path.join(outputDir, 'traces.jsonl'), traceRows);

  // --- Preferences split ---
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const memories = readJSONL(memoryLogPath);
  let preferenceRows = [];

  if (memories.length > 0) {
    try {
      const dpoResult = exportDpoFromMemories(memories);
      preferenceRows = dpoResult.pairs.map((pair, i) => buildPreferenceRow(pair, i));
    } catch {
      // DPO export failure should not break the traces export
    }
  }

  writeJSONL(path.join(outputDir, 'preferences.jsonl'), preferenceRows);

  // --- Dataset info ---
  const exportedAt = new Date().toISOString();
  const info = buildDatasetInfo({
    traceCount: traceRows.length,
    preferenceCount: preferenceRows.length,
    exportedAt,
  });
  fs.writeFileSync(
    path.join(outputDir, 'dataset_info.json'),
    JSON.stringify(info, null, 2) + '\n',
  );

  return {
    outputDir,
    traceCount: traceRows.length,
    preferenceCount: preferenceRows.length,
    files: ['traces.jsonl', 'preferences.jsonl', 'dataset_info.json'],
    exportedAt,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  });

  const result = exportHfDataset({
    outputDir: args.output || undefined,
    includeProvenance: args.provenance !== 'false',
  });

  console.log(`Exported HuggingFace dataset to ${result.outputDir}`);
  console.log(`  Traces: ${result.traceCount}`);
  console.log(`  Preferences: ${result.preferenceCount}`);
  console.log(`  Files: ${result.files.join(', ')}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  exportHfDataset,
  buildTraceRow,
  buildPreferenceRow,
  buildDatasetInfo,
  redactPaths,
  redactEntry,
  readJSONL,
};
