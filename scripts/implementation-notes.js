'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DIR = path.join(REPO_ROOT, '.thumbgate');
const MARKDOWN_NAME = 'implementation-notes.md';
const JSONL_NAME = 'implementation-notes.jsonl';

function resolvePaths({ dir } = {}) {
  const base = dir ? path.resolve(dir) : DEFAULT_DIR;
  return {
    dir: base,
    markdownPath: path.join(base, MARKDOWN_NAME),
    jsonlPath: path.join(base, JSONL_NAME),
  };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function noteId(record) {
  const seed = `${record.timestamp}|${record.tool}|${record.decision}|${record.rationale}`;
  return `note_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

function renderMarkdownEntry(record) {
  const lines = [
    `### ${record.id} — ${record.timestamp}`,
    '',
    `- **Tool**: ${record.tool || '(unspecified)'}`,
    `- **Decision**: ${record.decision || '(none)'}`,
  ];
  if (record.rationale) lines.push(`- **Rationale**: ${record.rationale}`);
  if (record.signal && record.signal !== 'info') lines.push(`- **Signal**: ${record.signal}`);
  if (record.specSection) lines.push(`- **Spec section**: ${record.specSection}`);
  if (record.tags && record.tags.length) lines.push(`- **Tags**: ${record.tags.join(', ')}`);
  lines.push('');
  return lines.join('\n');
}

function appendNote({ tool, decision, rationale, signal, specSection, tags, timestamp, dir } = {}) {
  const decisionText = normalizeText(decision);
  if (!decisionText) {
    throw new Error('appendNote: decision is required');
  }
  const paths = resolvePaths({ dir });
  ensureDir(paths.dir);

  const record = {
    timestamp: timestamp || new Date().toISOString(),
    tool: normalizeText(tool) || 'unspecified',
    decision: decisionText,
    rationale: normalizeText(rationale),
    signal: normalizeText(signal) || 'info',
    specSection: normalizeText(specSection),
    tags: Array.isArray(tags) ? tags.map(normalizeText).filter(Boolean) : [],
  };
  record.id = noteId(record);

  if (!fs.existsSync(paths.markdownPath)) {
    fs.writeFileSync(
      paths.markdownPath,
      '# Implementation Notes\n\nAuto-captured agent decisions, tradeoffs, and ambiguities. ' +
        'Promote high-value entries to durable lessons via `thumbgate notes promote <id>`.\n\n',
      'utf8',
    );
  }
  fs.appendFileSync(paths.markdownPath, renderMarkdownEntry(record), 'utf8');
  fs.appendFileSync(paths.jsonlPath, `${JSON.stringify(record)}\n`, 'utf8');

  return record;
}

function listNotes({ dir, limit = 20 } = {}) {
  const paths = resolvePaths({ dir });
  if (!fs.existsSync(paths.jsonlPath)) return [];
  const raw = fs.readFileSync(paths.jsonlPath, 'utf8');
  const records = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_err) {
        return null;
      }
    })
    .filter(Boolean);
  return records.slice(-Math.max(1, Number(limit) || 20));
}

function findNote({ id, dir }) {
  if (!id) return null;
  const paths = resolvePaths({ dir });
  if (!fs.existsSync(paths.jsonlPath)) return null;
  const raw = fs.readFileSync(paths.jsonlPath, 'utf8');
  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      if (record.id === id) return record;
    } catch (_err) {
      // ignore malformed lines
    }
  }
  return null;
}

function promoteToLesson({ id, dir, capture }) {
  const record = findNote({ id, dir });
  if (!record) {
    throw new Error(`promoteToLesson: no note with id ${id}`);
  }
  if (typeof capture !== 'function') {
    throw new Error('promoteToLesson: capture function required (inject the feedback-capture module to keep this module dependency-free)');
  }
  const result = capture({
    feedback: record.signal === 'down' ? 'down' : record.signal === 'up' ? 'up' : 'down',
    context: `[implementation-note ${record.id}] ${record.decision}`,
    whatWentWrong: record.signal === 'down' ? record.rationale || record.decision : '',
    whatWorked: record.signal === 'up' ? record.rationale || record.decision : '',
    whatToChange: record.specSection ? `Update spec section: ${record.specSection}` : '',
    tags: ['implementation-note', ...(record.tags || [])],
    sourceNoteId: record.id,
  });
  return { noteId: record.id, captureResult: result };
}

function parseCliArgs(argv) {
  const args = { _: [] };
  for (const raw of argv) {
    if (raw.startsWith('--')) {
      const [key, value] = raw.slice(2).split('=');
      if (value === undefined) args[key] = true;
      else if (key === 'tags') args[key] = value.split(',').map((t) => t.trim()).filter(Boolean);
      else args[key] = value;
    } else {
      args._.push(raw);
    }
  }
  return args;
}

function cli(argv = process.argv.slice(3)) {
  const subcommand = argv[0];
  const rest = argv.slice(1);
  const args = parseCliArgs(rest);

  switch (subcommand) {
    case 'append': {
      const record = appendNote({
        tool: args.tool,
        decision: args.decision,
        rationale: args.rationale,
        signal: args.signal,
        specSection: args['spec-section'] || args.section,
        tags: args.tags,
        dir: args.dir,
      });
      console.log(JSON.stringify(record, null, 2));
      return record;
    }
    case 'list': {
      const records = listNotes({ dir: args.dir, limit: args.limit });
      if (args.json) {
        console.log(JSON.stringify(records, null, 2));
      } else if (records.length === 0) {
        console.log('No implementation notes yet. Capture one via: thumbgate notes append --decision="..."');
      } else {
        for (const r of records) {
          console.log(`${r.id}  [${r.signal}]  ${r.tool}  ${r.decision.slice(0, 80)}`);
        }
      }
      return records;
    }
    case 'show': {
      const id = args._[0] || args.id;
      const record = findNote({ id, dir: args.dir });
      if (!record) {
        console.error(`No note with id ${id}`);
        process.exitCode = 1;
        return null;
      }
      console.log(JSON.stringify(record, null, 2));
      return record;
    }
    case 'promote': {
      const id = args._[0] || args.id;
      let capture;
      try {
        ({ captureFeedback: capture } = require(path.join(REPO_ROOT, 'scripts', 'capture-feedback')));
      } catch (_err) {
        capture = (payload) => {
          console.log('[notes promote] (no capture-feedback module wired) payload:');
          console.log(JSON.stringify(payload, null, 2));
          return { dryRun: true };
        };
      }
      const result = promoteToLesson({ id, dir: args.dir, capture });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    default:
      console.log('Usage: thumbgate notes <append|list|show|promote> [flags]');
      console.log('');
      console.log('  append   Append an implementation note.');
      console.log('           --decision="..." (required)  --tool=<name>  --rationale="..."');
      console.log('           --signal=info|up|down  --spec-section=<id>  --tags=a,b,c');
      console.log('  list     Show recent notes. --json for raw, --limit=N to cap.');
      console.log('  show     Show a single note by id.');
      console.log('  promote  Promote a note to a durable lesson via capture-feedback.');
      console.log('');
      console.log('Storage: .thumbgate/implementation-notes.{md,jsonl} (gitignored).');
      return null;
  }
}

function isCliInvocation(argv = process.argv) {
  return path.resolve(argv[1] || '') === path.resolve(__filename);
}

if (isCliInvocation()) {
  cli(process.argv.slice(2));
}

module.exports = {
  appendNote,
  listNotes,
  findNote,
  promoteToLesson,
  cli,
  resolvePaths,
};
