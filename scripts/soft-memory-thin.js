#!/usr/bin/env node
'use strict';

/**
 * soft-memory-thin.js — ThumbGate owns "capture vs Soft Memory lease".
 *
 * Hawk/Harsh (2026-09): autonomously generated notes/memory are mostly
 * worthless and get worse as they grow. Keep only corrections you'd hate to
 * repeat — those belong in ThumbGate (capture → prevention_rules / skills /
 * alwaysApply / evals). Soft Obsidian Agents/Memory stays thin: surface leases,
 * one-liners, open Waiting `- [ ]` gates. NOT autonomous diaries.
 *
 * Usage:
 *   node scripts/soft-memory-thin.js route --intent "I'd hate to repeat Fast ON"
 *   node scripts/soft-memory-thin.js check --file note.md
 *   node scripts/soft-memory-thin.js check --text "$body"
 *   node scripts/soft-memory-thin.js --fixture-good
 *   node scripts/soft-memory-thin.js --fixture-bad
 *   npm run soft-memory:thin -- route --intent "..."
 */

const fs = require('fs');
const path = require('path');

const MAX_BODY_LINES = Number(process.env.SOFT_MEMORY_MAX_LINES || 40);
const FIX_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'soft-memory-thin');

const FIREHOSE_RE = /flowchart\s+TB|flowchart\s+LR|##\s*Executive verdict|##\s*Architecture\s*\(ideal|World-Class Soft|Primary sources\s*\(fetched|session diary|autonomous\s+(diary|memory|notes)|what I (did|learned) (today|this session)|research dump|##\s*Soft north star/i;
const LASTING_RE = /(always|never again|lasting (pref|preference|correction)|Igor (prefers|always|never)|standing order|I('d| would) (hate|be annoyed) to repeat)/i;
const THUMBGATE_POINTER_RE = /(ThumbGate|capture_feedback|prevention_rules|alwaysApply|eval\s*\*\*[0-9]+|\.cursor\/rules\/|skills\/)/i;
const LEASE_RE = /(^kind:\s*surface-lease|surface:\s*|^\*\*Surface:\*\*|^\*\*Owner:\*\*|^#\s*Lease:|agent-claim\.sh)/im;
const WAITING_RE = /^- \[ \]/m;
const ROUTE_CAPTURE_RE = /(hate to repeat|annoyed to repeat|lasting (pref|preference|correction)|capture_feedback|prevention rule|thumbgate|never again|alwaysApply)/i;
const ROUTE_LEASE_RE = /(lease|surface:|agent-claim|psn-qa-iis-deploy|ado-pr-\d+-overview|single-writer)/i;
const ROUTE_WAITING_RE = /(waiting on|-\s*\[\s*\]|human gate|ratif)/i;

function stripFrontmatter(body) {
  const text = String(body || '');
  if (!text.startsWith('---\n') && text !== '---') return text;
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return text;
  return text.slice(end + 5);
}

function nonEmptyLineCount(body) {
  return stripFrontmatter(body)
    .split(/\r?\n/)
    .filter((line) => /\S/.test(line)).length;
}

/**
 * Route an agent intent before writing Soft Memory or capturing feedback.
 * @returns {{ rail: string, action: string, ok: boolean, reason: string }}
 */
function routeIntent({ intent = '', text = '' } = {}) {
  const blob = `${intent}\n${text}`.trim();
  if (!blob) {
    return {
      rail: 'reject',
      action: 'ask_for_intent',
      ok: false,
      reason: 'empty intent — say lasting correction vs lease vs Waiting',
    };
  }
  if (FIREHOSE_RE.test(blob) || /mermaid|research novel|session diary/i.test(blob)) {
    return {
      rail: 'reject_firehose',
      action: 'do_not_write_memory',
      ok: false,
      reason: 'firehose / diary / blueprint — do not write Soft Memory; encode lasting prefs via ThumbGate',
    };
  }
  if (ROUTE_CAPTURE_RE.test(blob) && !ROUTE_LEASE_RE.test(blob) && !WAITING_RE.test(blob)) {
    return {
      rail: 'thumbgate_capture',
      action: 'capture_feedback_then_prevention',
      ok: true,
      reason: 'lasting correction → ThumbGate capture_feedback → prevention_rules / skill / alwaysApply / eval',
    };
  }
  if (ROUTE_LEASE_RE.test(blob)) {
    return {
      rail: 'memory_lease',
      action: 'write_thin_lease',
      ok: true,
      reason: 'coordination lease → thin Soft Memory (owner + surface + UTC)',
    };
  }
  if (ROUTE_WAITING_RE.test(blob) || WAITING_RE.test(blob)) {
    return {
      rail: 'memory_waiting',
      action: 'write_waiting_checkboxes',
      ok: true,
      reason: 'open human gate → Soft Memory with Waiting `- [ ]` + owner',
    };
  }
  if (LASTING_RE.test(blob)) {
    return {
      rail: 'thumbgate_capture',
      action: 'capture_feedback_then_prevention',
      ok: true,
      reason: 'sounds lasting — prefer ThumbGate over Soft Memory diary',
    };
  }
  // Short one-liner status is OK as Soft Memory
  const lines = nonEmptyLineCount(blob);
  if (lines <= 12) {
    return {
      rail: 'memory_oneliner',
      action: 'write_thin_oneliner',
      ok: true,
      reason: 'short Soft Memory one-liner OK (≤12 non-empty lines)',
    };
  }
  return {
    rail: 'reject_firehose',
    action: 'do_not_write_memory',
    ok: false,
    reason: 'ambiguous long Soft Memory — thin by default; capture lasting prefs in ThumbGate',
  };
}

/**
 * Verify a Soft Memory note body is thin (not a diary).
 * @returns {{ ok: boolean, lines: number, reason: string, id?: string }}
 */
function verifySoftMemoryBody(body) {
  const raw = String(body || '');
  if (!raw.trim()) {
    return { ok: false, lines: 0, id: 'empty', reason: 'empty Soft Memory body' };
  }
  const stripped = stripFrontmatter(raw);
  const lines = nonEmptyLineCount(raw);

  if (FIREHOSE_RE.test(stripped)) {
    return {
      ok: false,
      lines,
      id: 'firehose',
      reason: 'firehose / diary / research-novel Soft Memory (thin leases/one-liners/Waiting only; lasting → ThumbGate)',
    };
  }
  if (/^```mermaid/m.test(stripped)) {
    return {
      ok: false,
      lines,
      id: 'mermaid',
      reason: 'mermaid blueprint in Soft Memory — put architecture in a skill/docs, not Memory',
    };
  }
  if (LASTING_RE.test(stripped) && !THUMBGATE_POINTER_RE.test(stripped)) {
    return {
      ok: false,
      lines,
      id: 'lasting_without_thumbgate',
      reason: 'lasting correction language without ThumbGate/rule/skill/eval pointer — encode there, not Soft Memory diary',
    };
  }
  if (lines > MAX_BODY_LINES) {
    return {
      ok: false,
      lines,
      id: 'too_long',
      reason: `Soft Memory body has ${lines} non-empty lines (max ${MAX_BODY_LINES}) — thin by default`,
    };
  }

  let kindOk = false;
  if (LEASE_RE.test(stripped)) kindOk = true;
  if (WAITING_RE.test(stripped)) kindOk = true;
  if (/soft-memory-thin|thin Soft Memory|Waiting on /i.test(stripped)) kindOk = true;
  if (lines <= 12) kindOk = true;
  if (!kindOk) {
    return {
      ok: false,
      lines,
      id: 'wrong_kind',
      reason: 'Soft Memory must be lease / Waiting - [ ] / short one-liner (≤12 lines) — not a freeform essay',
    };
  }
  return {
    ok: true,
    lines,
    id: 'thin_ok',
    reason: `soft memory thin (${lines} non-empty body lines ≤ ${MAX_BODY_LINES})`,
  };
}

function checkFile(filePath) {
  const body = fs.readFileSync(filePath, 'utf8');
  return verifySoftMemoryBody(body);
}

function takeValue(flag, next) {
  if (next == null || next.startsWith('-')) {
    throw new Error(`Incomplete argument: ${flag} requires a value`);
  }
  return next;
}

function parseArgs(argv) {
  const out = {
    mode: null,
    file: null,
    text: null,
    intent: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === 'route' || arg === 'check') out.mode = arg;
    else if (arg === '--file') { out.file = takeValue(arg, next); i += 1; }
    else if (arg === '--text') { out.text = takeValue(arg, next); i += 1; }
    else if (arg === '--intent') { out.intent = takeValue(arg, next); i += 1; }
    else if (arg === '--fixture-good') out.mode = 'fixture-good';
    else if (arg === '--fixture-bad') out.mode = 'fixture-bad';
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/soft-memory-thin.js <command> [options]

Commands:
  route --intent "<text>"   Classify: thumbgate_capture | memory_lease | memory_waiting | reject
  check --file <path>       Verify Soft Memory note is thin
  check --text "<body>"     Verify Soft Memory body is thin
  --fixture-good            Must-pass fixtures
  --fixture-bad             Must-fail firehose fixture

Options:
  --json
  --help

Rails (Hawk/Harsh): lasting prefs → ThumbGate; Soft Memory = leases / Waiting / one-liners only.
`);
}

function emit(obj, asJson) {
  if (asJson) console.log(JSON.stringify(obj, null, 2));
  else if (obj.ok) console.log(`PASS: ${obj.reason || obj.rail || 'ok'}`);
  else console.error(`FAIL: ${obj.reason || obj.rail || 'fail'}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.mode) {
    printHelp();
    process.exit(args.help ? 0 : 2);
  }

  if (args.mode === 'route') {
    const result = routeIntent({ intent: args.intent || '', text: args.text || '' });
    emit(result, args.json);
    process.exit(result.ok ? 0 : 1);
  }

  if (args.mode === 'fixture-good') {
    const a = checkFile(path.join(FIX_DIR, 'good-lease.md'));
    const b = checkFile(path.join(FIX_DIR, 'good-waiting.md'));
    if (!a.ok || !b.ok) {
      emit({ ok: false, reason: `fixture-good failed: ${a.reason} / ${b.reason}` }, args.json);
      process.exit(1);
    }
    emit({ ok: true, reason: 'fixture-good lease + waiting', a, b }, args.json);
    process.exit(0);
  }

  if (args.mode === 'fixture-bad') {
    const bad = checkFile(path.join(FIX_DIR, 'bad-firehose.md'));
    if (bad.ok) {
      emit({ ok: false, reason: 'fixture-bad should fail' }, args.json);
      process.exit(1);
    }
    emit({ ok: true, reason: 'fixture-bad rejected', rejected: bad }, args.json);
    process.exit(0);
  }

  if (args.mode === 'check') {
    let result;
    if (args.text != null) result = verifySoftMemoryBody(args.text);
    else if (args.file) result = checkFile(args.file);
    else {
      printHelp();
      process.exit(2);
    }
    emit(result, args.json);
    process.exit(result.ok ? 0 : 1);
  }

  printHelp();
  process.exit(2);
}

if (require.main === module || path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    main();
  } catch (err) {
    console.error(`FAIL: ${err.message || err}`);
    process.exit(1);
  }
}

module.exports = {
  MAX_BODY_LINES,
  stripFrontmatter,
  nonEmptyLineCount,
  routeIntent,
  verifySoftMemoryBody,
  checkFile,
};
