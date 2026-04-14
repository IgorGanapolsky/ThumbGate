#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const CHANGESET_DIR = path.join(PROJECT_ROOT, '.changeset');
const DEFAULT_PACKAGE_NAME = 'thumbgate';
const MIN_SUMMARY_LENGTH = 20;
const RELEASE_TYPES = new Set(['major', 'minor', 'patch']);
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
  const normalized = String(relPath || '').trim().replaceAll('\\', '/');
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

function isVersionedReleaseChangeSet(changedFiles = []) {
  const normalizedFiles = changedFiles.map((file) => String(file || '').trim().replaceAll('\\', '/'));
  return normalizedFiles.includes('package.json')
    && normalizedFiles.includes('CHANGELOG.md')
    && normalizedFiles.some(isChangesetMarkdownFile);
}

function splitChangesetDocument(content) {
  const normalized = String(content || '').replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    return null;
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closingIndex === -1) {
    return null;
  }

  return {
    frontmatterLines: lines.slice(1, closingIndex),
    summary: lines.slice(closingIndex + 1).join('\n').trim(),
  };
}

function stripWrappingQuotes(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('\'') && text.endsWith('\'')))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function parseReleaseLine(line) {
  const normalized = String(line || '').trim();
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    return null;
  }

  const packageName = stripWrappingQuotes(normalized.slice(0, separatorIndex));
  const releaseType = normalized.slice(separatorIndex + 1).trim();
  if (!packageName || !RELEASE_TYPES.has(releaseType)) {
    return null;
  }

  return {
    packageName,
    releaseType,
  };
}

function parseChangesetMarkdown(content) {
  const document = splitChangesetDocument(content);
  if (!document) {
    return {
      releases: {},
      summary: '',
      errors: ['missing frontmatter'],
    };
  }

  const summary = document.summary;
  const releases = {};
  const errors = [];
  const lines = document.frontmatterLines.map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const entry = parseReleaseLine(line);
    if (!entry) {
      errors.push(`invalid frontmatter line: ${line}`);
      continue;
    }
    releases[entry.packageName] = entry.releaseType;
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
  files,
} = {}) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const allowedNames = Array.isArray(files)
    ? new Set(files.filter(isChangesetMarkdownFile).map((file) => path.basename(file)))
    : null;

  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .filter((name) => !allowedNames || allowedNames.has(name))
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
  const versionedRelease = isVersionedReleaseChangeSet(changedFiles);

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

  if (versionedRelease) {
    return {
      ok: true,
      required: true,
      relevantFiles,
      validChangesets,
      invalidChangesets,
      reason: 'Release PR already consumed pending changesets into versioned artifacts.',
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
    } catch {}
  }

  return candidates.at(-1);
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
  const output = runGitCommand(['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${mergeBase}...HEAD`], { cwd, runner });
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
  const changesets = collectChangesets({ files: changedFiles });
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
  isVersionedReleaseChangeSet,
  parseArgs,
  parseChangesetMarkdown,
  resolveBaseRef,
  runCli,
  runGitCommand,
};
