#!/usr/bin/env node
'use strict';

// Status-line thumb counts: only feedback a person gave, only for the project
// the status line is rendered in. Prints {"up":N,"down":N,"label":"this project"}.
//
// Two stores can hold a project's thumbs: the project's own feedback dir, and the
// global ~/.thumbgate store, where MCP capture_feedback calls land because the MCP
// server does not run in the project directory. Global rows belong to this
// project when they carry its project key, or only scope.projectId equal to the
// project folder name.
const path = require('node:path');
const { readProjectRows } = require('./project-catalog');
const { resolveLocalProject, hash } = require('./project-identity');
const { resolveProjectDir, resolveFeedbackDir, getHomeDir } = require('./feedback-paths');
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
  const projectName = path.basename(projectDir);
  // readProjectRows maps a row that only names a project in scope.projectId to this legacy key.
  const aliasKey = `legacy_${hash(projectName)}`;
  const globalDir = path.join(getHomeDir({ env }), '.thumbgate');

  const seen = new Set();
  let up = 0;
  let down = 0;
  const ownDir = path.resolve(feedbackDir);
  for (const dir of new Set([ownDir, path.resolve(globalDir)])) {
    // Rows written before project tracking carry no key. In the project's own
    // feedback dir they are this project's; in the shared global store they are not.
    const ownsUnassigned = dir === ownDir && dir !== path.resolve(globalDir);
    for (const row of readProjectRows(dir, 'feedback-log.jsonl', {})) {
      const mine = row.projectKey === projectKey || row.projectKey === aliasKey
        || (ownsUnassigned && row.projectKey === 'unassigned');
      if (!mine) continue;
      if (!isCountedHumanFeedback(row)) continue;
      if (row.id) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      const signal = normalizeSignal(row);
      if (signal === 'up') up += 1;
      if (signal === 'down') down += 1;
    }
  }
  return { up, down, label: 'this project', project: projectName };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  try {
    process.stdout.write(JSON.stringify(computeHumanCounts()));
  } catch (_) {
    process.exit(0);
  }
}

module.exports = { computeHumanCounts };
