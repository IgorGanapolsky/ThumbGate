#!/usr/bin/env node
'use strict';

// Status-line thumb counts: only feedback a person gave, only for the project
// the status line is rendered in. Prints {"up":N,"down":N,"label":"this project"}.
const path = require('node:path');
const { readProjectRows } = require('./project-catalog');
const { resolveLocalProject } = require('./project-identity');
const { resolveProjectDir, resolveFeedbackDir } = require('./feedback-paths');
const { isCountedHumanFeedback } = require('./human-feedback');

function normalizeSignal(entry) {
  const raw = String(entry.signal || entry.feedback || '').toLowerCase();
  if (raw === 'positive' || raw === 'up' || raw === 'thumbs_up') return 'up';
  if (raw === 'negative' || raw === 'down' || raw === 'thumbs_down') return 'down';
  return null;
}

function computeHumanCounts(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const projectDir = resolveProjectDir({ cwd, env });
  const feedbackDir = resolveFeedbackDir({ projectDir, env });
  const { projectKey } = resolveLocalProject(projectDir);
  const rows = readProjectRows(feedbackDir, 'feedback-log.jsonl', { projectKey });
  let up = 0;
  let down = 0;
  for (const row of rows) {
    if (!isCountedHumanFeedback(row)) continue;
    const signal = normalizeSignal(row);
    if (signal === 'up') up += 1;
    if (signal === 'down') down += 1;
  }
  return { up, down, label: 'this project', project: path.basename(projectDir) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  try {
    process.stdout.write(JSON.stringify(computeHumanCounts()));
  } catch (_) {
    process.exit(0);
  }
}

module.exports = { computeHumanCounts };
