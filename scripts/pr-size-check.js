#!/usr/bin/env node
'use strict';

/**
 * Enforce the ThumbGate PR size ceiling (<= 1,000 changed lines, excluding
 * package-lock.json and generated artifacts). Large changes must be split into
 * reviewable layers via `gh stack` (GitHub Stacked PRs GA, 2026-10-06).
 */

const { execFileSync } = require('node:child_process');

const DEFAULT_MAX_LINES = 1000;

const EXCLUDED_PATH_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)bun\.lockb?$/,
  /^dist\//,
  /^coverage\//,
  /^\.artifacts\//,
  /\.min\.(js|css)$/,
  /\.snap$/,
  /\.map$/,
  /\.generated\./,
];

function isExcludedPath(filePath) {
  const normalized = String(filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!normalized) return true;
  return EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function parseNumstat(numstatOutput = '') {
  const entries = [];
  for (const rawLine of String(numstatOutput || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = rawLine.split('\t');
    if (parts.length < 3) continue;
    const [rawAdd, rawDel, ...pathParts] = parts;
    const filePath = pathParts.join('\t').trim();
    // Binary diff rows use "-" for additions/deletions in git diff --numstat.
    if (rawAdd === '-' || rawDel === '-') {
      entries.push({
        path: filePath,
        additions: 0,
        deletions: 0,
        binary: true,
      });
      continue;
    }
    const additions = Number.parseInt(rawAdd, 10);
    const deletions = Number.parseInt(rawDel, 10);
    entries.push({
      path: filePath,
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
      binary: false,
    });
  }
  return entries;
}

function evaluatePrSize(entries = [], options = {}) {
  const maxLines = Number.isFinite(options.maxLines) ? options.maxLines : DEFAULT_MAX_LINES;
  const countedFiles = [];
  const excludedFiles = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const entry of entries) {
    const filePath = String(entry?.path || '').trim();
    if (!filePath) continue;
    if (entry?.binary || isExcludedPath(filePath)) {
      excludedFiles.push({
        path: filePath,
        additions: Number(entry?.additions || 0),
        deletions: Number(entry?.deletions || 0),
        binary: Boolean(entry?.binary),
      });
      continue;
    }
    const additions = Math.max(0, Number(entry?.additions || 0));
    const deletions = Math.max(0, Number(entry?.deletions || 0));
    totalAdditions += additions;
    totalDeletions += deletions;
    countedFiles.push({
      path: filePath,
      additions,
      deletions,
      changedLines: additions + deletions,
    });
  }

  const totalChangedLines = totalAdditions + totalDeletions;
  const ok = totalChangedLines <= maxLines;

  return {
    ok,
    maxLines,
    totalChangedLines,
    totalAdditions,
    totalDeletions,
    countedFileCount: countedFiles.length,
    excludedFileCount: excludedFiles.length,
    countedFiles,
    excludedFiles,
    remediation: ok
      ? null
      : `PR changes ${totalChangedLines} lines (limit: ${maxLines} excluding package-lock.json and generated files). Split into stacked PRs using 'gh stack' (https://github.blog/changelog/2026-10-06-stacked-pull-requests-generally-available/).`,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    base: process.env.PR_SIZE_BASE_REF || 'origin/main',
    head: process.env.PR_SIZE_HEAD_REF || 'HEAD',
    maxLines: DEFAULT_MAX_LINES,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--base' && argv[i + 1]) {
      options.base = String(argv[++i]);
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
    } else if (arg === '--head' && argv[i + 1]) {
      options.head = String(argv[++i]);
    } else if (arg.startsWith('--head=')) {
      options.head = arg.slice('--head='.length);
    } else if (arg === '--max-lines' && argv[i + 1]) {
      options.maxLines = Number.parseInt(argv[++i], 10);
    } else if (arg.startsWith('--max-lines=')) {
      options.maxLines = Number.parseInt(arg.slice('--max-lines='.length), 10);
    }
  }

  return options;
}

function loadGitNumstat(base, head, execFn = execFileSync) {
  return execFn('git', ['diff', '--numstat', '--no-renames', `${base}...${head}`], {
    encoding: 'utf8',
  });
}

function runCli(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const numstat = typeof deps.loadNumstat === 'function'
    ? deps.loadNumstat(options.base, options.head)
    : loadGitNumstat(options.base, options.head, deps.execFn);
  const entries = parseNumstat(numstat);
  const result = evaluatePrSize(entries, { maxLines: options.maxLines });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(
      `pr-size ok: ${result.totalChangedLines}/${result.maxLines} changed lines across ${result.countedFileCount} file(s) (${result.excludedFileCount} excluded).`,
    );
  } else {
    console.error(`pr-size failed: ${result.remediation}`);
  }

  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = {
  DEFAULT_MAX_LINES,
  EXCLUDED_PATH_PATTERNS,
  evaluatePrSize,
  isExcludedPath,
  loadGitNumstat,
  parseArgs,
  parseNumstat,
  runCli,
};
