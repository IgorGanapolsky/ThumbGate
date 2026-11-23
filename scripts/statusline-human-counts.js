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
const { isCountedHumanFeedback, isLegacyMcpCapture } = require('./human-feedback');

function normalizeSignal(entry) {
  const raw = String(entry.signal || entry.feedback || '').toLowerCase();
  if (raw === 'positive' || raw === 'up' || raw === 'thumbs_up') return 'up';
  if (raw === 'negative' || raw === 'down' || raw === 'thumbs_down') return 'down';
  return null;
}

// The agent records a thumb within seconds of the message that carried it.
const CORROBORATION_MS = 90 * 1000;

function rowTime(row) {
  const at = Date.parse(row.timestamp || row.createdAt || '');
  return Number.isFinite(at) ? at : null;
}

function isScrapedHumanThumb(row) {
  if (String(row.reviewOrigin || '').toLowerCase() !== 'human') return false;
  const tags = Array.isArray(row.tags) ? row.tags : [];
  return tags.includes('claude-history-sync');
}

function collectHumanRows(options = {}) {
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
  const mineRows = [];
  const ownDir = path.resolve(feedbackDir);
  // THUMBGATE_FEEDBACK_DIR can point the resolved dir at the shared store, which
  // would hide this project's own log. The project's own .thumbgate folder is always read too.
  const projectLocalDir = path.resolve(projectDir, '.thumbgate');
  const ownDirs = new Set([ownDir, projectLocalDir]);
  for (const dir of new Set([ownDir, projectLocalDir, path.resolve(globalDir)])) {
    // Rows written before project tracking carry no key. In the project's own
    // feedback dir they are this project's; in the shared global store they are not.
    const ownsUnassigned = ownDirs.has(dir) && dir !== path.resolve(globalDir);
    for (const row of readProjectRows(dir, 'feedback-log.jsonl', {})) {
      const mine = row.projectKey === projectKey || row.projectKey === aliasKey
        || (ownsUnassigned && row.projectKey === 'unassigned');
      if (!mine) continue;
      if (row.id) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      mineRows.push(row);
    }
  }

  // A thumb the history sync scraped from the person's own message is evidence
  // that the person gave one at that moment. An MCP capture that an older server
  // labelled automated counts when such evidence sits next to it; without it the
  // row is a lesson the agent logged on its own judgment.
  const scraped = { up: [], down: [] };
  for (const row of mineRows) {
    const signal = normalizeSignal(row);
    const at = rowTime(row);
    if (signal && at !== null && isScrapedHumanThumb(row)) scraped[signal].push(at);
  }
  const corroborated = (row) => {
    const signal = normalizeSignal(row);
    const at = rowTime(row);
    return Boolean(signal) && at !== null && scraped[signal].some((t) => Math.abs(t - at) <= CORROBORATION_MS);
  };

  const counted = mineRows.filter((row) => normalizeSignal(row)
    && (isCountedHumanFeedback(row) || (isLegacyMcpCapture(row) && corroborated(row))));
  return { rows: counted, projectKey, projectName, projectDir };
}

function computeHumanCounts(options = {}) {
  const { rows, projectName } = collectHumanRows(options);
  let up = 0;
  let down = 0;
  let latestDown = null;
  for (const row of rows) {
    const signal = normalizeSignal(row);
    if (signal === 'up') up += 1;
    if (signal === 'down') {
      down += 1;
      const at = rowTime(row);
      if (at !== null && (!latestDown || at > latestDown.at)) latestDown = { at, row };
    }
  }
  return { up, down, label: 'this project', project: projectName, latestDown: describeLatestDown(latestDown) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The reader's own clock, 12-hour: "Nov 19, 3:37 PM". Built by hand because
// toLocaleString puts a narrow no-break space before AM/PM on newer ICU builds.
function formatStamp(ms) {
  const d = new Date(ms);
  const hour = d.getHours() % 12 || 12;
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hour}:${minute} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

function describeLatestDown(found) {
  if (!found) return null;
  const { at, row } = found;
  const raw = String(row.whatWentWrong || row.whatToChange || row.context || '').replace(/\s+/g, ' ').trim();
  return {
    id: row.id || null,
    timestamp: new Date(at).toISOString(),
    label: `Latest mistake ${formatStamp(at)}`,
    text: raw.length > 60 ? `${raw.slice(0, 57)}...` : raw,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  try {
    process.stdout.write(JSON.stringify(computeHumanCounts()));
  } catch (_) {
    process.exit(0);
  }
}

module.exports = { computeHumanCounts, collectHumanRows };
