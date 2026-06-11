#!/usr/bin/env node
'use strict';

/**
 * Post-action verification window for volatile GitHub mutations.
 *
 * `gh issue edit` can succeed and then be reverted by another actor or
 * automation seconds later. PreToolUse can only inspect the command before it
 * runs; this watcher snapshots the post-action state, waits a short window,
 * then re-checks the watched fields and reports regressions.
 *
 * Hook mode is intentionally non-blocking. It enqueues on PostToolUse and
 * checks any due watches on later hook invocations. Use `--check` for an
 * explicit poll, or `--enqueue '<gh issue edit ...>'` for a manual test.
 */

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const DEFAULT_WINDOW_MS = 120000;
const DEFAULT_STATE_PATH = path.join(process.cwd(), '.thumbgate', 'post-action-verification-watches.json');

const FIELD_FLAG_MAP = new Map([
  ['--title', 'title'],
  ['--body', 'body'],
  ['--state', 'state'],
  ['--milestone', 'milestone'],
  ['--add-label', 'labels'],
  ['--remove-label', 'labels'],
  ['--label', 'labels'],
  ['--add-assignee', 'assignees'],
  ['--remove-assignee', 'assignees'],
  ['--assignee', 'assignees'],
]);

const FIELD_JSON = ['title', 'body', 'state', 'labels', 'assignees', 'milestone'];

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function statePath(options = {}) {
  return options.statePath || process.env.THUMBGATE_POST_ACTION_WATCH_PATH || DEFAULT_STATE_PATH;
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readState(options = {}) {
  const file = statePath(options);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      version: 1,
      watches: Array.isArray(parsed.watches) ? parsed.watches : [],
    };
  } catch {
    return { version: 1, watches: [] };
  }
}

function writeState(state, options = {}) {
  const file = statePath(options);
  ensureDirFor(file);
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, watches: state.watches || [] }, null, 2)}\n`, 'utf8');
}

function shellSplit(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaping = false;

  for (const ch of String(command || '')) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function extractHookCommand(payload = {}) {
  const candidates = [
    payload.tool_input?.command,
    payload.toolInput?.command,
    payload.input?.command,
    payload.command,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function hookSucceeded(payload = {}) {
  const response = payload.tool_response || payload.toolResponse || payload.response || {};
  const code = response.exitCode ?? response.exit_code ?? response.status ?? payload.exitCode ?? payload.exit_code;
  if (code === undefined || code === null || code === '') return true;
  return Number(code) === 0;
}

function parseGhIssueEdit(command) {
  const tokens = shellSplit(command);
  const ghIndex = tokens.findIndex((token, index) => token === 'gh' && tokens[index + 1] === 'issue' && tokens[index + 2] === 'edit');
  if (ghIndex < 0) return null;

  const issue = tokens[ghIndex + 3];
  if (!issue || issue.startsWith('-')) return null;

  const watchedFields = new Set();
  let repo = null;
  for (let i = ghIndex + 4; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--repo' || token === '-R') {
      repo = tokens[i + 1] || null;
      i += 1;
      continue;
    }
    const eqMatch = token.match(/^(--repo|-R)=(.+)$/);
    if (eqMatch) {
      repo = eqMatch[2];
      continue;
    }

    const flag = token.includes('=') ? token.split('=')[0] : token;
    if (FIELD_FLAG_MAP.has(flag)) {
      watchedFields.add(FIELD_FLAG_MAP.get(flag));
      if (!token.includes('=') && tokens[i + 1] && !tokens[i + 1].startsWith('-')) i += 1;
    }
  }

  return {
    command,
    issue,
    repo,
    watchedFields: Array.from(watchedFields).sort(),
  };
}

function normalizeSnapshot(raw = {}) {
  return {
    title: raw.title ?? null,
    body: raw.body ?? null,
    state: raw.state ?? null,
    labels: Array.isArray(raw.labels)
      ? raw.labels.map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean).sort()
      : [],
    assignees: Array.isArray(raw.assignees)
      ? raw.assignees.map((assignee) => (typeof assignee === 'string' ? assignee : assignee?.login)).filter(Boolean).sort()
      : [],
    milestone: raw.milestone
      ? (typeof raw.milestone === 'string' ? raw.milestone : raw.milestone.title || raw.milestone.name || null)
      : null,
  };
}

function snapshotIssue(parsed, options = {}) {
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  const args = ['issue', 'view', parsed.issue, '--json', FIELD_JSON.join(',')];
  if (parsed.repo) args.push('--repo', parsed.repo);
  const raw = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return normalizeSnapshot(JSON.parse(raw || '{}'));
}

function watchedValues(snapshot, fields) {
  const out = {};
  for (const field of fields || []) out[field] = snapshot[field];
  return out;
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffWatchedFields(expected, actual, fields) {
  const diffs = [];
  for (const field of fields || []) {
    if (!valuesEqual(expected[field], actual[field])) {
      diffs.push({ field, expected: expected[field], actual: actual[field] });
    }
  }
  return diffs;
}

function enqueueWatch(command, options = {}) {
  if (process.env.THUMBGATE_POST_ACTION_WATCH_DISABLED === '1') {
    return { queued: false, reason: 'disabled' };
  }
  const parsed = parseGhIssueEdit(command);
  if (!parsed || parsed.watchedFields.length === 0) {
    return { queued: false, reason: 'not-gh-issue-edit' };
  }

  let snapshot;
  try {
    snapshot = snapshotIssue(parsed, options);
  } catch (error) {
    return { queued: false, reason: `snapshot-failed: ${error.message}` };
  }

  const now = options.now || Date.now();
  const windowMs = Number(options.windowMs || process.env.THUMBGATE_GH_WATCH_WINDOW_MS || DEFAULT_WINDOW_MS);
  const state = readState(options);
  const watch = {
    id: `gh-issue-${parsed.repo || 'default'}-${parsed.issue}-${now}`,
    type: 'gh_issue_edit',
    command: parsed.command,
    repo: parsed.repo,
    issue: parsed.issue,
    watchedFields: parsed.watchedFields,
    expected: watchedValues(snapshot, parsed.watchedFields),
    createdAt: nowIso(now),
    checkAfter: nowIso(now + windowMs),
    status: 'pending',
  };
  state.watches.push(watch);
  writeState(state, options);
  return { queued: true, watch };
}

function checkDueWatches(options = {}) {
  const now = options.now || Date.now();
  const state = readState(options);
  const reports = [];
  let changed = false;

  for (const watch of state.watches) {
    if (watch.status !== 'pending') continue;
    if (Date.parse(watch.checkAfter) > now) continue;

    let actual;
    try {
      actual = watchedValues(snapshotIssue(watch, options), watch.watchedFields);
    } catch (error) {
      watch.status = 'error';
      watch.error = error.message;
      watch.checkedAt = nowIso(now);
      reports.push({ watch, status: 'error', error: error.message });
      changed = true;
      continue;
    }

    const diffs = diffWatchedFields(watch.expected, actual, watch.watchedFields);
    watch.actual = actual;
    watch.checkedAt = nowIso(now);
    if (diffs.length > 0) {
      watch.status = 'regressed';
      watch.diffs = diffs;
      reports.push({ watch, status: 'regressed', diffs });
    } else {
      watch.status = 'verified';
      reports.push({ watch, status: 'verified' });
    }
    changed = true;
  }

  if (changed) writeState(state, options);
  return reports;
}

function formatReports(reports) {
  const actionable = reports.filter((report) => report.status === 'regressed' || report.status === 'error');
  if (actionable.length === 0) return '';
  const lines = ['ThumbGate post-action verification window: GitHub state changed after mutation.'];
  for (const report of actionable) {
    const watch = report.watch;
    lines.push(`- gh issue ${watch.issue}${watch.repo ? ` (${watch.repo})` : ''}: ${report.status}`);
    if (report.diffs) {
      for (const diff of report.diffs) {
        lines.push(`  ${diff.field}: expected ${JSON.stringify(diff.expected)} but saw ${JSON.stringify(diff.actual)}`);
      }
    }
    if (report.error) lines.push(`  error: ${report.error}`);
  }
  lines.push('Re-check the issue before claiming the race is over, stable, verified, or done.');
  return lines.join('\n');
}

function runHook(options = {}) {
  const raw = fs.readFileSync(0, 'utf8');
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const reports = checkDueWatches(options);
  const command = extractHookCommand(payload);
  if (command && hookSucceeded(payload)) enqueueWatch(command, options);
  const formatted = formatReports(reports);
  if (formatted) process.stdout.write(`${formatted}\n`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const formatted = formatReports(checkDueWatches());
    if (formatted) process.stdout.write(`${formatted}\n`);
    return;
  }
  const enqueueIndex = args.indexOf('--enqueue');
  if (enqueueIndex >= 0) {
    const result = enqueueWatch(args[enqueueIndex + 1] || '');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  runHook();
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    main();
  } catch (error) {
    process.stdout.write(`ThumbGate post-action verification window failed open: ${error.message}\n`);
  }
}

module.exports = {
  DEFAULT_WINDOW_MS,
  FIELD_JSON,
  checkDueWatches,
  diffWatchedFields,
  enqueueWatch,
  extractHookCommand,
  formatReports,
  hookSucceeded,
  normalizeSnapshot,
  parseGhIssueEdit,
  readState,
  shellSplit,
  snapshotIssue,
  statePath,
  watchedValues,
  writeState,
};
