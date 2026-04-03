#!/usr/bin/env node
/**
 * KTO (Kahneman-Tversky Optimization) Exporter
 *
 * Transforms binary up/down feedback into KTO JSONL records.
 * Unlike DPO (which needs paired preferences), KTO works with
 * individual binary signals — a natural fit for thumbs-up/down data.
 *
 * Output format per line:
 *   {"prompt": "...", "completion": "...", "label": true/false, "metadata": {...}}
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const FEEDBACK_DIR = process.env.RLHF_FEEDBACK_DIR || path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');
const DEFAULT_FEEDBACK_LOG = path.join(FEEDBACK_DIR, 'feedback-log.jsonl');
const DEFAULT_MEMORY_LOG = path.join(FEEDBACK_DIR, 'memory-log.jsonl');

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Infer a prompt string from a feedback entry.
 * Uses context, tags, or domain info to reconstruct what was being asked.
 */
function inferPrompt(entry) {
  if (entry.context && entry.context.trim()) {
    return entry.context.trim();
  }
  if (entry.richContext && entry.richContext.domain) {
    return `Task domain: ${entry.richContext.domain}`;
  }
  if (Array.isArray(entry.tags) && entry.tags.length > 0) {
    return `Task: ${entry.tags.join(', ')}`;
  }
  return 'General coding task';
}

/**
 * Infer a completion string from a feedback entry.
 * For positive: whatWorked or content describes the good response.
 * For negative: whatWentWrong or whatToChange describes the bad response.
 */
function inferCompletion(entry) {
  const signal = normalizeSignal(entry.signal);
  if (signal === 'positive') {
    if (entry.whatWorked && entry.whatWorked.trim()) return entry.whatWorked.trim();
    if (entry.content && entry.content.trim()) return entry.content.trim();
    return 'Completed task successfully';
  }
  if (entry.whatWentWrong && entry.whatWentWrong.trim()) return entry.whatWentWrong.trim();
  if (entry.whatToChange && entry.whatToChange.trim()) return entry.whatToChange.trim();
  if (entry.content && entry.content.trim()) return entry.content.trim();
  return 'Failed to complete task correctly';
}

function normalizeSignal(signal) {
  const value = String(signal || '').trim().toLowerCase();
  if (['up', 'thumbsup', 'thumbs-up', 'thumbs_up', 'positive', 'good'].includes(value)) return 'positive';
  if (['down', 'thumbsdown', 'thumbs-down', 'thumbs_down', 'negative', 'bad'].includes(value)) return 'negative';
  return null;
}

/**
 * Build a single KTO record from a feedback or memory entry.
 * Returns null if the entry lacks a valid signal.
 */
function buildKtoRecord(entry) {
  const signal = normalizeSignal(entry.signal);
  if (!signal) return null;

  const label = signal === 'positive';
  const prompt = inferPrompt(entry);
  const completion = inferCompletion(entry);

  return {
    prompt,
    completion,
    label,
    metadata: {
      sourceId: entry.id || null,
      signal,
      signalSource: entry.sourceFeedbackId ? 'memory-log' : 'feedback-log',
      tags: entry.tags || [],
      domain: (entry.richContext && entry.richContext.domain) || null,
      outcomeCategory: (entry.richContext && entry.richContext.outcomeCategory) || null,
      timestamp: entry.timestamp || null,
      rubricScore: (entry.rubric && entry.rubric.weightedScore != null)
        ? entry.rubric.weightedScore
        : null,
    },
  };
}

/**
 * Build KTO records from an array of feedback/memory entries.
 */
function buildKtoPairs(entries) {
  const records = [];
  const skipped = [];
  for (const entry of entries) {
    const record = buildKtoRecord(entry);
    if (record) {
      records.push(record);
    } else {
      skipped.push(entry);
    }
  }
  return { records, skipped };
}

function toJSONL(records) {
  if (records.length === 0) return '';
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

function exportKtoFromFeedback(feedbackEntries, memoryEntries) {
  const all = [...feedbackEntries, ...memoryEntries];
  // Deduplicate by id
  const seen = new Set();
  const unique = [];
  for (const entry of all) {
    const key = entry.id || JSON.stringify(entry);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }
  const result = buildKtoPairs(unique);
  return {
    records: result.records,
    skipped: result.skipped,
    totalInput: unique.length,
    jsonl: toJSONL(result.records),
  };
}

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  });
  return args;
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (args.test) {
    runTests();
    return;
  }

  let feedbackEntries = [];
  let memoryEntries = [];

  if (args.input) {
    const raw = fs.readFileSync(args.input, 'utf-8');
    const parsed = JSON.parse(raw);
    feedbackEntries = Array.isArray(parsed) ? parsed : parsed.entries || [];
  } else if (args['from-local']) {
    feedbackEntries = readJSONL(DEFAULT_FEEDBACK_LOG);
    memoryEntries = readJSONL(DEFAULT_MEMORY_LOG);
  } else {
    console.error('Provide --input=<path-to-json> or --from-local');
    process.exit(1);
  }

  const result = exportKtoFromFeedback(feedbackEntries, memoryEntries);

  if (args.output) {
    fs.writeFileSync(args.output, result.jsonl);
    console.error(`Wrote ${result.records.length} KTO records to ${args.output}`);
  } else {
    process.stdout.write(result.jsonl);
  }

  const positiveCount = result.records.filter((r) => r.label === true).length;
  const negativeCount = result.records.filter((r) => r.label === false).length;
  console.error(`Total=${result.totalInput} Exported=${result.records.length} Positive=${positiveCount} Negative=${negativeCount} Skipped=${result.skipped.length}`);
}

function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      passed++;
      console.log(`  PASS ${name}`);
    } else {
      failed++;
      console.log(`  FAIL ${name}`);
    }
  }

  console.log('\nexport-kto-pairs.js tests\n');

  // Test 1: positive signal produces label true
  const pos = buildKtoRecord({
    id: 'fb_1',
    signal: 'positive',
    context: 'Implemented auth',
    whatWorked: 'JWT tokens with refresh rotation',
    tags: ['auth'],
    timestamp: '2025-01-01T00:00:00Z',
  });
  assert(pos !== null, 'positive signal produces a record');
  assert(pos.label === true, 'positive signal produces label: true');

  // Test 2: negative signal produces label false
  const neg = buildKtoRecord({
    id: 'fb_2',
    signal: 'negative',
    context: 'Tried to deploy',
    whatWentWrong: 'Missing env vars',
    tags: ['deploy'],
    timestamp: '2025-01-01T00:00:00Z',
  });
  assert(neg !== null, 'negative signal produces a record');
  assert(neg.label === false, 'negative signal produces label: false');

  // Test 3: missing context handled gracefully
  const noCtx = buildKtoRecord({
    id: 'fb_3',
    signal: 'up',
    tags: ['testing'],
  });
  assert(noCtx !== null, 'entry with missing context still produces record');
  assert(noCtx.prompt === 'Task: testing', 'missing context falls back to tags');

  // Test 4: invalid signal returns null
  const invalid = buildKtoRecord({ id: 'fb_4', signal: 'maybe' });
  assert(invalid === null, 'invalid signal returns null');

  // Test 5: JSONL output is valid
  const records = [pos, neg];
  const jsonl = toJSONL(records);
  const lines = jsonl.trim().split('\n');
  let allValid = true;
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      allValid = false;
    }
  }
  assert(allValid, 'JSONL output is valid JSON per line');
  assert(jsonl.endsWith('\n'), 'JSONL output ends with newline');

  // Test 6: metadata includes signal source and timestamp
  assert(pos.metadata.signalSource === 'feedback-log', 'metadata includes signal source');
  assert(pos.metadata.timestamp === '2025-01-01T00:00:00Z', 'metadata includes timestamp');
  assert(pos.metadata.signal === 'positive', 'metadata includes normalized signal');

  // Test 7: empty context with richContext domain
  const richCtx = buildKtoRecord({
    id: 'fb_5',
    signal: 'up',
    richContext: { domain: 'security', outcomeCategory: 'quick-success' },
  });
  assert(richCtx.prompt === 'Task domain: security', 'richContext domain used as prompt fallback');
  assert(richCtx.metadata.domain === 'security', 'metadata captures domain');

  // Test 8: buildKtoPairs filters bad entries
  const result = buildKtoPairs([
    { id: 'a', signal: 'up', context: 'good' },
    { id: 'b', signal: 'invalid' },
    { id: 'c', signal: 'down', context: 'bad', whatWentWrong: 'broke it' },
  ]);
  assert(result.records.length === 2, 'buildKtoPairs keeps valid entries');
  assert(result.skipped.length === 1, 'buildKtoPairs tracks skipped entries');

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = {
  readJSONL,
  normalizeSignal,
  inferPrompt,
  inferCompletion,
  buildKtoRecord,
  buildKtoPairs,
  toJSONL,
  exportKtoFromFeedback,
  DEFAULT_FEEDBACK_LOG,
  DEFAULT_MEMORY_LOG,
};

if (require.main === module) {
  runCli();
}
