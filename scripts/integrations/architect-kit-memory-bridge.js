#!/usr/bin/env node
'use strict';

/**
 * architect-kit-memory-bridge.js
 *
 * One-shot ingester: converts an @ultrathink-art/agent-architect-kit memory
 * directory (per-role markdown files following the Agent Memory Protocol) into
 * ThumbGate feedback entries, so teams graduating from markdown-backed memory
 * to ThumbGate's queryable lesson DB don't lose their accumulated mistakes
 * and learnings.
 *
 * Architect-kit memory files look like this (see their memory-directive.md):
 *
 *   # Coder Agent Memory
 *
 *   ## Mistakes
 *   - [2026-02-06] Pushed code without running tests. Tests were failing. MUST
 *     run tests after final commit, verify exit 0 before push.
 *
 *   ## Learnings
 *   - [2026-02-06] Published products can't be edited via update API (error
 *     8252). Must create new product + swap ID.
 *
 *   ## Stakeholder Feedback
 *   - [2026-02-06] Rejected sticker designs — "poster layout, not die-cut."
 *
 *   ## Session Log
 *   - [2026-02-06] WQ-716: Fixed broken template syntax.
 *
 * We map those sections to ThumbGate feedback as follows:
 *
 *   Mistakes              -> signal=down, whatWentWrong=<entry>
 *   Learnings             -> signal=up,   whatWorked=<entry>
 *   Stakeholder Feedback  -> signal=down if entry mentions "Rejected"/negative
 *                            keywords, else signal=up
 *   Session Log           -> skipped (too granular; noise in a lesson DB)
 *
 * Every ingested entry gets tags `[architect-kit, <role>, <section>]` so
 * imports can be audited and rolled back (`feedback:stats --tag=architect-kit`).
 *
 * Usage:
 *   node scripts/integrations/architect-kit-memory-bridge.js \
 *     --dir=/path/to/agents/state/memory
 *   node scripts/integrations/architect-kit-memory-bridge.js \
 *     --dir=./memory --role=coder --dry-run
 *
 * Options:
 *   --dir=<path>   Required. Directory containing per-role .md files.
 *   --role=<name>  Optional. Only import the matching <name>.md file.
 *   --dry-run      Parse + classify but don't write feedback entries.
 *   --json         Emit machine-readable summary on stdout.
 *
 * Exit code 0 on success, 1 on missing dir / no matching files / capture fail.
 *
 * Exports (test surface):
 *   parseMemoryFile(content, role)
 *   classifyEntry({ section, text })
 *   importDirectory({ dir, roleFilter, dryRun, captureFn, readFileFn, listFilesFn })
 */

const fs = require('node:fs');
const path = require('node:path');

const SECTION_HEADINGS = {
  'mistakes': 'mistakes',
  'learnings': 'learnings',
  'stakeholder feedback': 'stakeholder_feedback',
  'session log': 'session_log',
};

// Keywords that flip a stakeholder-feedback entry from positive to negative.
// Order-independent, case-insensitive substring match.
const NEGATIVE_STAKEHOLDER_KEYWORDS = [
  'rejected', 'rejects', 'reject',
  'bad', 'broken', 'broke',
  'wrong', 'incorrect',
  'hate', 'hated', 'dislike', 'disliked',
  'thumbs down', 'thumbs-down', 'thumbs_down',
  'not good', "don't like", 'do not like',
  'failing', 'failed', 'fix this', 'unacceptable',
];

/**
 * Parse a single architect-kit memory markdown file.
 *
 * The format is permissive: section headers are `## <Name>`, entries are
 * top-level bullets starting with `-` or `*`. Entries may wrap across multiple
 * lines (continuation lines indent by 2+ spaces). We preserve the full entry
 * text minus the leading bullet + date stamp.
 *
 * @param {string} content raw markdown
 * @param {string} role role name (usually derived from the file basename)
 * @returns {{ role: string, sections: Record<string, Array<{date: string|null, text: string}>> }}
 */
function startEntryFromBullet(body) {
  const dateMatch = /^\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/.exec(body);
  return dateMatch
    ? { date: dateMatch[1], text: dateMatch[2].trim() }
    : { date: null, text: body.trim() };
}

function classifyParsedLine(line) {
  const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
  if (headingMatch) {
    return { kind: 'heading', value: headingMatch[1].trim().toLowerCase() };
  }
  const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
  if (bulletMatch) {
    return { kind: 'bullet', value: bulletMatch[1] };
  }
  const continuation = /^\s{2,}(\S.*)$/.exec(line);
  if (continuation) {
    return { kind: 'continuation', value: continuation[1].trim() };
  }
  if (line.trim() === '') {
    return { kind: 'blank' };
  }
  return { kind: 'other' };
}

function parseMemoryFile(content, role) {
  const sections = {
    mistakes: [],
    learnings: [],
    stakeholder_feedback: [],
    session_log: [],
  };
  const state = { section: null, entry: null };

  const flush = () => {
    if (state.entry && state.section) {
      sections[state.section].push(state.entry);
    }
    state.entry = null;
  };

  const lines = String(content || '').split(/\r?\n/);
  for (const raw of lines) {
    const parsed = classifyParsedLine(raw.trimEnd());
    if (parsed.kind === 'heading') {
      flush();
      state.section = SECTION_HEADINGS[parsed.value] || null;
      continue;
    }
    if (!state.section) continue;

    if (parsed.kind === 'bullet') {
      flush();
      state.entry = startEntryFromBullet(parsed.value);
    } else if (parsed.kind === 'continuation' && state.entry) {
      state.entry.text = `${state.entry.text} ${parsed.value}`.trim();
    } else if (parsed.kind === 'blank' && state.entry) {
      // Blank line closes the current entry so further prose doesn't merge in.
      flush();
    }
  }
  flush();

  // Strip fully-empty entries (e.g. a bullet with no text).
  for (const key of Object.keys(sections)) {
    sections[key] = sections[key].filter((e) => e.text && e.text.length > 0);
  }
  return { role, sections };
}

/**
 * Classify a single entry into ThumbGate feedback shape. Returns null for
 * sections we intentionally skip (session_log).
 *
 * @returns {null | { signal: 'up'|'down', tags: string[], context: string,
 *                    whatWentWrong?: string, whatWorked?: string }}
 */
function classifyEntry({ section, text, role }) {
  if (!text || !section) return null;
  if (section === 'session_log') return null;

  const lower = text.toLowerCase();
  const tags = ['architect-kit', `role:${role}`, section];

  if (section === 'mistakes') {
    return {
      signal: 'down',
      context: text,
      whatWentWrong: text,
      tags,
    };
  }
  if (section === 'learnings') {
    return {
      signal: 'up',
      context: text,
      whatWorked: text,
      tags,
    };
  }
  // stakeholder_feedback
  const isNegative = NEGATIVE_STAKEHOLDER_KEYWORDS.some((kw) => lower.includes(kw));
  return isNegative
    ? { signal: 'down', context: text, whatWentWrong: text, tags }
    : { signal: 'up', context: text, whatWorked: text, tags };
}

function defaultListFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}
function defaultReadFile(p) {
  return fs.readFileSync(p, 'utf8');
}

/**
 * Import all per-role memory files under `dir`. Returns a summary describing
 * what was found, classified, and captured. When captureFn throws for an
 * entry we record the error and keep going — partial imports are more useful
 * than bailing on the first bad line.
 */
function invokeCapture(captureFn, classification, entry, role) {
  return captureFn({
    signal: classification.signal,
    context: classification.context,
    whatWentWrong: classification.whatWentWrong,
    whatWorked: classification.whatWorked,
    tags: classification.tags,
    source: 'architect-kit-memory-bridge',
    role,
    originalDate: entry.date,
  });
}

function processEntry({ section, entry, role, dryRun, captureFn, summary, perRole }) {
  summary.totalEntries += 1;
  const classification = classifyEntry({ section, text: entry.text, role });
  if (!classification) {
    summary.skipped += 1;
    return;
  }
  if (dryRun || !captureFn) {
    summary.captured += 1;
    perRole.captured += 1;
    return;
  }
  try {
    const result = invokeCapture(captureFn, classification, entry, role);
    if (result?.accepted === false) {
      summary.skipped += 1;
      perRole.errors.push({ text: entry.text, reason: result.reason || 'not accepted' });
    } else {
      summary.captured += 1;
      perRole.captured += 1;
    }
  } catch (err) {
    summary.errors.push({ role, section, text: entry.text, message: err.message });
    perRole.errors.push({ text: entry.text, reason: err.message });
  }
}

function buildPerRole(role, parsed) {
  return {
    role,
    mistakes: parsed.sections.mistakes.length,
    learnings: parsed.sections.learnings.length,
    stakeholder_feedback: parsed.sections.stakeholder_feedback.length,
    session_log_skipped: parsed.sections.session_log.length,
    captured: 0,
    errors: [],
  };
}

function processFile({ file, dir, readFileFn, dryRun, captureFn, summary }) {
  const role = path.basename(file, '.md');
  const content = readFileFn(path.join(dir, file));
  const parsed = parseMemoryFile(content, role);
  const perRole = buildPerRole(role, parsed);

  for (const [section, entries] of Object.entries(parsed.sections)) {
    for (const entry of entries) {
      processEntry({ section, entry, role, dryRun, captureFn, summary, perRole });
    }
  }
  summary.filesImported += 1;
  summary.perRole[role] = perRole;
}

function importDirectory({
  dir,
  roleFilter = null,
  dryRun = false,
  captureFn = null,
  readFileFn = defaultReadFile,
  listFilesFn = defaultListFiles,
} = {}) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('architect-kit-memory-bridge: --dir is required');
  }
  const files = listFilesFn(dir);
  const targets = roleFilter
    ? files.filter((f) => path.basename(f, '.md') === roleFilter)
    : files;

  const summary = {
    dir,
    roleFilter,
    dryRun,
    filesScanned: files.length,
    filesImported: 0,
    totalEntries: 0,
    captured: 0,
    skipped: 0,
    errors: [],
    perRole: {},
  };

  for (const file of targets) {
    processFile({ file, dir, readFileFn, dryRun, captureFn, summary });
  }
  return summary;
}

function parseArgs(argv) {
  const out = { dir: null, role: null, dryRun: false, json: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--dir=')) out.dir = arg.slice('--dir='.length);
    else if (arg.startsWith('--role=')) out.role = arg.slice('--role='.length);
  }
  return out;
}

function formatTextSummary(summary) {
  const lines = [];
  lines.push(
    `[architect-kit-bridge] dir=${summary.dir} dryRun=${summary.dryRun} ` +
      `files=${summary.filesImported}/${summary.filesScanned} ` +
      `entries=${summary.totalEntries} captured=${summary.captured} ` +
      `skipped=${summary.skipped} errors=${summary.errors.length}`,
  );
  for (const [role, info] of Object.entries(summary.perRole)) {
    lines.push(
      `  ${role}: mistakes=${info.mistakes} learnings=${info.learnings} ` +
        `feedback=${info.stakeholder_feedback} ` +
        `sessionLogSkipped=${info.session_log_skipped} captured=${info.captured} ` +
        `errors=${info.errors.length}`,
    );
  }
  if (summary.errors.length > 0) {
    lines.push('errors:');
    for (const err of summary.errors.slice(0, 5)) {
      lines.push(`  [${err.role}/${err.section}] ${err.message}`);
    }
    if (summary.errors.length > 5) {
      lines.push(`  (+${summary.errors.length - 5} more)`);
    }
  }
  return lines.join('\n');
}

function loadCaptureFn() {
  // Lazy so tests / dry-run don't pay for feedback-loop bootstrap.
  const { captureFeedback } = require('../feedback-loop');
  return (params) => captureFeedback(params);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.dir) {
    process.stderr.write(
      'usage: architect-kit-memory-bridge --dir=<path> [--role=<name>] [--dry-run] [--json]\n',
    );
    process.exit(1);
  }
  if (!fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    process.stderr.write(`[architect-kit-bridge] dir not found: ${args.dir}\n`);
    process.exit(1);
  }
  const captureFn = args.dryRun ? null : loadCaptureFn();
  const summary = importDirectory({
    dir: args.dir,
    roleFilter: args.role,
    dryRun: args.dryRun,
    captureFn,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write(formatTextSummary(summary) + '\n');
  }
  process.exit(summary.errors.length > 0 ? 1 : 0);
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  try {
    runCli();
  } catch (err) {
    process.stderr.write(`[architect-kit-bridge] FAIL: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  parseMemoryFile,
  classifyEntry,
  importDirectory,
  formatTextSummary,
  SECTION_HEADINGS,
  NEGATIVE_STAKEHOLDER_KEYWORDS,
};
