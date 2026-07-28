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
 *   node scripts/mine-eval-set.js            # mine into evals/
 *   node scripts/mine-eval-set.js --dry-run  # print what would be written
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = process.env.THUMBGATE_HOME || path.join(os.homedir(), '.thumbgate');
// audit-trail.jsonl, NOT gate-events-log.jsonl. The gate-events log records the VERDICT
// (gateId, decision, toolName) but drops toolInput, so nothing in it can be replayed —
// mining it produced 7 cases with empty commands, a benchmark that would pass vacuously.
// The audit trail keeps sanitizeToolInput(toolInput), which is what makes a case runnable.
const SOURCE = process.env.THUMBGATE_AUDIT_TRAIL || path.join(HOME, 'audit-trail.jsonl');
const OUT_DIR = path.join(__dirname, '..', 'evals');
const OUT_FILE = path.join(OUT_DIR, 'gate-decisions.golden.jsonl');

// A case is only useful if we can replay it. Events with no command carry nothing to re-run.
const REPLAYABLE_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit']);

function redact(text) {
  return String(text || '')
    .replace(/\/Users\/[^\s/"']+/g, '/Users/redacted')
    .replace(/\/home\/[^\s/"']+/g, '/home/redacted')
    // Claude/tooling encode paths with dashes: "-Users-igorganapolsky-workspace-...".
    // The slash-based patterns above miss that form entirely — caught by a leak scan
    // AFTER the first mined set looked clean.
    .replace(/-Users-[A-Za-z0-9_.]+/g, '-Users-redacted')
    .replace(/-home-[A-Za-z0-9_.]+/g, '-home-redacted')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'redacted@example.com')
    .replace(/\b(gh[pousr]_|sk-|npm_)[A-Za-z0-9]{8,}/g, '<redacted-token>')
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

function readEvents(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // distinguish "no source" from "source with zero usable events"
  }
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // a corrupt line is not a reason to lose the rest of the corpus
    }
  }
  return events;
}

function mine(events) {
  const seen = new Map();
  for (const event of events) {
    const toolName = event.toolName || event.tool_name;
    const command = event.toolInput?.command || event.command || '';
    const gateId = event.gateId || event.gate;
    const decision = event.decision;
    if (!toolName || !gateId || !decision) continue;
    if (!REPLAYABLE_TOOLS.has(toolName)) continue;
    // A case with no input cannot be replayed, and a benchmark of unreplayable cases
    // passes trivially while looking like coverage. Drop them rather than pad the count.
    if (!command) continue;

    const shape = commandShape(command);
    const key = `${toolName}|${shape}|${gateId}|${decision}`;
    if (seen.has(key)) {
      seen.get(key).observed += 1;
      continue;
    }
    seen.set(key, {
      // instruction: what to run
      toolName,
      command: redact(command),
      // expectation: what production actually decided
      expect: { gateId, decision },
      // provenance: this is a mined case, not an invented one
      source: 'production-trace',
      observed: 1,
    });
  }
  // Most-observed first: the cases that recur in production matter most.
  return [...seen.values()].sort((a, b) => b.observed - a.observed);
}

function main(argv) {
  const events = readEvents(SOURCE);
  if (events === null) {
    process.stderr.write(`mine-eval-set: no trace source at ${SOURCE}\n`);
    return 2;
  }
  const cases = mine(events);
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

module.exports = { redact, commandShape, mine, readEvents, main, OUT_FILE };

if (require.main && require.main.filename === module.filename) {
  process.exit(main(process.argv.slice(2)));
}
