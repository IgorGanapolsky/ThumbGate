#!/usr/bin/env node
'use strict';

/**
 * mine-eval-set.js — turn real gate decisions into a regression benchmark.
 *
 * Follows the eval-engineering argument that production traces, not invented examples, are
 * the source of good evals: recurring real failures become measurable cases. We had the
 * traces (gate-events-log.jsonl) and no benchmark — `evals/` did not exist at all, so
 * retrieval and enforcement quality were not comparable between runs.
 *
 * What it produces: evals/gate-decisions.golden.jsonl, one case per DISTINCT
 * (toolName, command-shape, gateId, decision) observed in production. The verifier
 * (tests/gate-golden-set.test.js) replays each case against the current engine in an
 * isolated sandbox and asserts the verdict still holds.
 *
 * Redaction is mandatory, not optional: gate messages embed absolute paths, and a benchmark
 * committed to a public repo must not carry someone's home directory or repo layout.
 *
 *   node scripts/mine-eval-set.js [--source path]... [--exclude regex]... [--dry-run]
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = process.env.THUMBGATE_HOME || path.join(os.homedir(), '.thumbgate');
// audit-trail.jsonl, NOT gate-events-log.jsonl. The gate-events log records the VERDICT
// (gateId, decision, toolName) but drops toolInput, so nothing in it can be replayed —
// mining it produced 7 cases with empty commands, a benchmark that would pass vacuously.
// The audit trail keeps sanitizeToolInput(toolInput), which is what makes a case runnable.
const DEFAULT_SOURCES = (process.env.THUMBGATE_AUDIT_TRAIL || path.join(HOME, 'audit-trail.jsonl'))
  .split(path.delimiter)
  .filter(Boolean);
const OUT_DIR = path.join(__dirname, '..', 'evals');
const OUT_FILE = path.join(OUT_DIR, 'gate-decisions.golden.jsonl');

// A case is only useful if we can replay it. Events with no command carry nothing to re-run.
const REPLAYABLE_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit']);

function redact(text) {
  return String(text || '')
    .replace(/\/(?:private\/)?var\/folders\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+\/T\/[A-Za-z0-9._-]+/g, '/tmp/redacted')
    .replace(/\/Users\/[^\s/"']+/g, '/Users/redacted')
    .replace(/\/home\/[^\s/"']+/g, '/home/redacted')
    // Claude/tooling encode paths with dashes: "-Users-igorganapolsky-workspace-...".
    // The slash-based patterns above miss that form entirely — caught by a leak scan
    // AFTER the first mined set looked clean.
    .replace(/-Users-[A-Za-z0-9_.]+/g, '-Users-redacted')
    .replace(/-home-[A-Za-z0-9_.]+/g, '-home-redacted')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'redacted@example.com')
    .replace(/\b(?:gh[pousr]_|sk-|sk_live_|sk_test_|rk_live_|rk_test_|npm_|AKIA)[A-Za-z0-9_-]{8,}/g, '<redacted-token>')
    .replace(/:\d{4,5}\b/g, ':PORT');
}

// Group by the SHAPE of the command, not its exact text, so a benchmark is not 300 copies of
// the same git invocation with different file names.
function commandShape(command) {
  return redact(command)
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)
    .join(' ');
}

// Drop sibling-repo infra, private operator home dotfiles, secret helpers, oversized scripts, and 200-char slices.
const UNPUBLISHABLE = [
  /arn:aws:|\b\d{12}\b/,
  /workspace\/(?!ThumbGate)[A-Za-z]|\.worktrees\//,
  /\/(?:Users|home)\/[^\s/"']+\/\.(?:local|claude\/plans)\//,
  /with-secrets|find-generic-password|\.thumbgate\/secrets/,
  /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/,
];

function isPublishable(command, exclude = []) {
  if (command.length > 400 || (command.length >= 200 && command.endsWith('...'))) return false;
  if (command.split('\n').length > 4) return false;
  if (UNPUBLISHABLE.some((pattern) => pattern.test(command))) return false;
  const lower = command.toLowerCase();
  return !exclude.some((needle) => lower.includes(needle));
}

function readEvents(file, seenLines = new Set()) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // distinguish "no source" from "source with zero usable events"
  }
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.trim() || seenLines.has(line)) continue;
    seenLines.add(line);
    try {
      events.push(JSON.parse(line));
    } catch {
      // a corrupt line is not a reason to lose the rest of the corpus
    }
  }
  return events;
}

// Union of several trails. Returns null only when NO source could be read.
function readSources(files) {
  const seenLines = new Set();
  let found = false;
  const events = [];
  for (const file of files) {
    const batch = readEvents(file, seenLines);
    if (batch === null) continue;
    found = true;
    events.push(...batch);
  }
  return found ? events : null;
}

function parseArgs(argv) {
  const sources = [];
  const exclude = [];
  let index = 0;
  while (index < argv.length) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === '--source' && next) {
      sources.push(next);
      index += 2;
    } else if (flag === '--exclude' && next) {
      exclude.push(String(next).toLowerCase());
      index += 2;
    } else {
      index += 1;
    }
  }
  return { sources: sources.length > 0 ? sources : DEFAULT_SOURCES, exclude };
}

function extractReplayableInput(event, toolName) {
  const ti = event.toolInput || {};
  if (toolName === 'Bash') return ti.command || event.command || '';
  return ti.command || event.command || ti.file_path || ti.filePath || '';
}

function normalizeTraceEvent(event, exclude) {
  const toolName = event.toolName || event.tool_name;
  if (typeof toolName !== 'string' || !REPLAYABLE_TOOLS.has(toolName)) return null;
  const decision = event.decision;
  if (typeof decision !== 'string' || !decision) return null;
  const rawGate = event.gateId ?? event.gate;
  const gateId = rawGate === undefined || rawGate === null
    ? (decision === 'allow' ? 'none' : '')
    : rawGate;
  if (typeof gateId !== 'string' || !gateId) return null;
  const command = extractReplayableInput(event, toolName);
  if (typeof command !== 'string' || !command || !isPublishable(command, exclude)) return null;
  return { toolName, command: redact(command), gateId, decision };
}

function mine(events, { exclude = [] } = {}) {
  const needles = exclude.map((x) => String(x).toLowerCase()).filter(Boolean);
  const seen = new Map();
  const seenInputs = new Set();
  for (const event of events) {
    const row = normalizeTraceEvent(event, needles);
    if (!row) continue;
    const shape = commandShape(row.command);
    const key = `${row.toolName}|${shape}|${row.gateId}|${row.decision}`;
    if (seen.has(key)) {
      seen.get(key).observed += 1;
      continue;
    }
    const inputKey = `${row.toolName}|${row.command}`;
    if (seenInputs.has(inputKey)) continue;
    seenInputs.add(inputKey);
    seen.set(key, {
      toolName: row.toolName,
      command: row.command,
      expect: { gateId: row.gateId, decision: row.decision },
      source: 'production-trace',
      observed: 1,
    });
  }
  return [...seen.values()].sort((a, b) => b.observed - a.observed);
}

function main(argv) {
  const { sources, exclude } = parseArgs(argv);
  const events = readSources(sources);
  if (events === null) {
    process.stderr.write(`mine-eval-set: no trace source at ${sources.join(', ')}\n`);
    return 2;
  }
  const cases = mine(events, { exclude });
  if (cases.length === 0) {
    // An empty benchmark looks like coverage and provides none.
    process.stderr.write(`mine-eval-set: ${events.length} events yielded 0 replayable cases\n`);
    return 2;
  }

  const body = cases.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  if (argv.includes('--dry-run')) {
    process.stdout.write(body);
    process.stdout.write(`\n# ${cases.length} case(s) from ${events.length} event(s)\n`);
    return 0;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, body);
  const gates = new Set(cases.map((c) => c.expect.gateId));
  process.stdout.write(
    `Mined ${cases.length} case(s) across ${gates.size} gate(s) from ${events.length} event(s)\n`
    + `  -> ${OUT_FILE}\n`,
  );
  return 0;
}

module.exports = { redact, commandShape, isPublishable, mine, readEvents, readSources, parseArgs, main, OUT_FILE };

if (require.main && require.main.filename === module.filename) {
  process.exit(main(process.argv.slice(2)));
}
