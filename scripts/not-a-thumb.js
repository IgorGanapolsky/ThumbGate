#!/usr/bin/env node
'use strict';

// Marks feedback rows as "not a person's thumb" so every counter leaves them out. The log is never edited and no
// row is deleted: this appends one line per row id to <project>/.thumbgate/not-counted-feedback.jsonl, which
// statusline-human-counts.js reads on every count.
//   node scripts/not-a-thumb.js <row-id> [<row-id> ...] --reason "what wrote it"
const fs = require('node:fs');
const path = require('node:path');
const { resolveProjectDir } = require('./feedback-paths');
const { NOT_COUNTED_FILE } = require('./statusline-human-counts');

function markNotCounted(ids, reason, options = {}) {
  const projectDir = resolveProjectDir({ cwd: options.cwd || process.cwd(), env: options.env || process.env, projectDir: options.projectDir });
  const dir = path.join(projectDir, '.thumbgate');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, NOT_COUNTED_FILE);
  const at = new Date().toISOString();
  const lines = ids.map((id) => `${JSON.stringify({ id: String(id), reason: String(reason || ''), markedAt: at })}\n`);
  fs.appendFileSync(file, lines.join(''));
  return { file, ids };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--reason');
  const reason = at >= 0 ? args.splice(at, 2)[1] : '';
  if (!args.length || !reason) {
    process.stderr.write('usage: not-a-thumb.js <row-id> [<row-id> ...] --reason "what wrote it"\n');
    process.exit(2);
  }
  const done = markNotCounted(args, reason);
  process.stdout.write(`${JSON.stringify(done)}\n`);
}

module.exports = { markNotCounted };
