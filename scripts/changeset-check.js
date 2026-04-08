#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const CHANGESET_DIR = path.join(PROJECT_ROOT, '.changeset');
const DEFAULT_PACKAGE_NAME = 'thumbgate';
const MIN_SUMMARY_LENGTH = 20;
const RELEASE_RELEVANT_FILES = new Set([
  'README.md',
  'package.json',
  'package-lock.json',
  'server.json',
]);
const RELEASE_RELEVANT_PREFIXES = [
  '.claude-plugin/',
  '.cursor-plugin/',
  '.well-known/',
  'adapters/',
  'bin/',
  'config/',
  'plugins/',
  'public/',
  'scripts/',
  'src/',
  'workers/',
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (const arg of argv) {
    if (arg.startsWith('--base=')) {
      options.baseRef = arg.slice('--base='.length);
    } else if (arg.startsWith('--since=')) {
      options.baseRef = arg.slice('--since='.length);
    }
  }
  return options;
}

function isChangesetMarkdownFile(relPath) {
  return relPath.startsWith('.changeset/')
    && relPath.endsWith('.md')
    && path.basename(relPath) !== 'README.md';
}

function isReleaseRelevantFile(relPath) {
  const normalized = String(relPath || '').trim().replace(/\\/g, '/');
  if (!normalized || isChangesetMarkdownFile(normalized)) {
    return false;
  }
  if (normalized.startsWith('docs/')
    || normalized.startsWith('proof/')
    || normalized.startsWith('tests/')
    || normalized.startsWith('.github/')) {
    return false;
  }
  if (RELEASE_RELEVANT_FILES.has(normalized)) {
    return true;
  }
  return RELEASE_RELEVANT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function parseChangesetMarkdown(content) {
  const source = String(content || '');
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return {
      releases: {},
      summary: '',
      errors: ['missing frontmatter'],
    };
  }

  const frontmatter = match[1];
  const summary = match[2].trim();
  const releases = {};
  const errors = [];
  const lines = frontmatter.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const entryMatch = line.match(/^["']?([^"']+)["']?\s*:\s*(major|minor|patch)\s*$/);
    if (!entryMatch) {
      errors.push(`invalid frontmatter line: ${line}`);
      continue;
    }
    releases[entryMatch[1]] = entryMatch[2];
  }

  if (!summary) {
    errors.push('missing summary');
  } else if (summary.length < MIN_SUMMARY_LENGTH) {
    errors.push(`summary must be at least ${MIN_SUMMARY_LENGTH} characters`);
  }

  if (Object.keys(releases).length === 0) {
    errors.push('missing release entries');
  }

  return {
    releases,
    summary,
    errors,
  };
}

function collectChangesets({
  dir = CHANGESET_DIR,
  packageName = DEFAULT_PACKAGE_NAME,
} = {}) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => {
      const filePath = path.join(dir, name);
      const parsed = parseChangesetMarkdown(fs.readFileSync(filePath, 'utf8'));
      const releaseType = parsed.releases[packageName] || null;
      const errors = [...parsed.errors];
      if (!releaseType) {
        errors.push(`missing ${packageName} release entry`);
      }
      return {
        file: path.posix.join('.changeset', name),
        releaseType,
        summary: parsed.summary,
        errors,
        validForPackage: errors.length === 0,
      };
    });
}

function evaluateChangesetRequirement({
  changedFiles = [],
  changesets = [],
} = {}) {
  const relevantFiles = changedFiles.filter(isReleaseRelevantFile);
  const required = relevantFiles.length > 0;
  const validChangesets = changesets.filter((entry) => entry.validForPackage);
  const invalidChangesets = changesets.filter((entry) => !entry.validForPackage);

  if (!required) {
    return {
      ok: true,
      required: false,
      relevantFiles,
      validChangesets,
      invalidChangesets,
      reason: 'No release-relevant changes detected. Changeset not required.',
    };
  }

  if (validChangesets.length > 0) {
    return {
      ok: true,
      required: true,
      relevantFiles,
      validChangesets,
      invalidChangesets,
      reason: `Found ${validChangesets.length} valid changeset file(s) for release-relevant changes.`,
    };
  }

  return {
    ok: false,
    required: true,
    relevantFiles,
    validChangesets,
    invalidChangesets,
    reason: 'Release-relevant changes require at least one valid .changeset entry for thumbgate.',
  };
}

function runGitCommand(args, {
  cwd = PROJECT_ROOT,
  runner = execFileSync,
} = {}) {
  return String(runner('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }) || '').trim();
}

function resolveBaseRef({
  args = parseArgs(),
  env = process.env,
  cwd = PROJECT_ROOT,
  runner = execFileSync,
} = {}) {
  const explicitBase = String(args.baseRef || '').trim();
  const baseRef = explicitBase
    || String(env.CHANGESET_BASE_REF || '').trim()
    || String(env.GITHUB_BASE_REF || '').trim()
    || (env.GITHUB_EVENT_NAME === 'merge_group' ? 'origin/main' : '');

  if (!baseRef) {
    return null;
  }

  const candidates = [baseRef];
  if (!baseRef.startsWith('origin/')) {
    candidates.push(`origin/${baseRef}`);
  }

  for (const candidate of candidates) {
    try {
      runGitCommand(['rev-parse', '--verify', candidate], { cwd, runner });
      return candidate;
    } catch (error) {}
  }

  return candidates[candidates.length - 1];
}

function getChangedFiles({
  baseRef,
  cwd = PROJECT_ROOT,
  runner = execFileSync,
} = {}) {
  if (!baseRef) {
    return [];
  }

  const mergeBase = runGitCommand(['merge-base', 'HEAD', baseRef], { cwd, runner });
  const output = runGitCommand(['diff', '--name-only', '--diff-filter=ACMRTUXB', `${mergeBase}...HEAD`], { cwd, runner });
  return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

function formatFailure(result) {
  const lines = [result.reason, ''];
  if (result.relevantFiles.length > 0) {
    lines.push('Release-relevant files:');
    result.relevantFiles.forEach((file) => lines.push(`- ${file}`));
    lines.push('');
  }
  if (result.invalidChangesets.length > 0) {
    lines.push('Invalid changesets:');
    result.invalidChangesets.forEach((entry) => {
      lines.push(`- ${entry.file}: ${entry.errors.join('; ')}`);
    });
    lines.push('');
  }
  lines.push('Run `npm run changeset` and add a release note for thumbgate before merging.');
  return lines.join('\n');
}

function runCli({
  cwd = PROJECT_ROOT,
  env = process.env,
  runner = execFileSync,
} = {}) {
  const baseRef = resolveBaseRef({ env, cwd, runner });
  if (!baseRef) {
    const result = {
      ok: true,
      skipped: true,
      reason: 'No base ref detected. Skipping changeset check outside PR or merge-group context.',
    };
    console.log(result.reason);
    return result;
  }

  const changedFiles = getChangedFiles({ baseRef, cwd, runner });
  const changesets = collectChangesets();
  const result = evaluateChangesetRequirement({ changedFiles, changesets });
  if (result.ok) {
    console.log(result.reason);
    return result;
  }

  console.error(formatFailure(result));
  process.exitCode = 1;
  return result;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  CHANGESET_DIR,
  DEFAULT_PACKAGE_NAME,
  MIN_SUMMARY_LENGTH,
  RELEASE_RELEVANT_FILES,
  RELEASE_RELEVANT_PREFIXES,
  collectChangesets,
  evaluateChangesetRequirement,
  formatFailure,
  getChangedFiles,
  isChangesetMarkdownFile,
  isReleaseRelevantFile,
  parseArgs,
  parseChangesetMarkdown,
  resolveBaseRef,
  runCli,
  runGitCommand,
};
