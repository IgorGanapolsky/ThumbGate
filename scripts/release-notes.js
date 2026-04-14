#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseChangesetMarkdown } = require('./changeset-check');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_PACKAGE_NAME = 'thumbgate';
const REPO_FULL_NAME = 'IgorGanapolsky/ThumbGate';

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (const arg of argv) {
    if (arg.startsWith('--version=')) options.version = arg.slice('--version='.length);
    else if (arg.startsWith('--package=')) options.packageName = arg.slice('--package='.length);
    else if (arg.startsWith('--current-ref=')) options.currentRef = arg.slice('--current-ref='.length);
    else if (arg.startsWith('--previous-tag=')) options.previousTag = arg.slice('--previous-tag='.length);
    else if (arg.startsWith('--output=')) options.outputPath = arg.slice('--output='.length);
    else if (arg.startsWith('--github-run-url=')) options.githubRunUrl = arg.slice('--github-run-url='.length);
    else if (arg.startsWith('--repo=')) options.repoFullName = arg.slice('--repo='.length);
  }
  return options;
}

function runGit(args, { cwd = PROJECT_ROOT, runner = execFileSync } = {}) {
  return String(runner('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }) || '').trim();
}

function readPackageVersion({ cwd = PROJECT_ROOT } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  return String(pkg.version || '').trim();
}

function semverTagValue(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(tag || '').trim());
  if (!match) return null;
  return match.slice(1, 4).map((value) => Number(value));
}

function compareSemverTagsDescending(a, b) {
  const aParts = semverTagValue(a);
  const bParts = semverTagValue(b);
  if (!aParts && !bParts) return String(b).localeCompare(String(a));
  if (!aParts) return 1;
  if (!bParts) return -1;
  for (let index = 0; index < aParts.length; index += 1) {
    if (aParts[index] !== bParts[index]) return bParts[index] - aParts[index];
  }
  return String(b).localeCompare(String(a));
}

function listTags({ cwd = PROJECT_ROOT, runner = execFileSync } = {}) {
  const output = runGit(['tag', '--list', 'v*'], { cwd, runner });
  return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

function detectPreviousTag({
  version,
  currentTag = `v${version}`,
  cwd = PROJECT_ROOT,
  runner = execFileSync,
} = {}) {
  const tags = listTags({ cwd, runner })
    .filter((tag) => semverTagValue(tag))
    .filter((tag) => tag !== currentTag)
    .sort(compareSemverTagsDescending);
  return tags[0] || '';
}

function getChangedChangesetFiles({
  previousTag,
  currentRef = 'HEAD',
  cwd = PROJECT_ROOT,
  runner = execFileSync,
} = {}) {
  if (!previousTag) return [];
  const output = runGit([
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    `${previousTag}...${currentRef}`,
    '--',
    '.changeset/*.md',
  ], { cwd, runner });

  return output
    ? output.split('\n')
      .map((line) => line.trim())
      .filter((file) => file && path.basename(file) !== 'README.md')
    : [];
}

function readChangesetEntries({
  files = [],
  packageName = DEFAULT_PACKAGE_NAME,
  cwd = PROJECT_ROOT,
} = {}) {
  return files.map((file) => {
    const content = fs.readFileSync(path.join(cwd, file), 'utf8');
    const parsed = parseChangesetMarkdown(content);
    return {
      file,
      releaseType: parsed.releases[packageName] || null,
      summary: parsed.summary,
      errors: parsed.errors,
    };
  }).filter((entry) => entry.releaseType);
}

function extractChangelogEntry(changelog, version) {
  const lines = String(changelog || '').replaceAll('\r\n', '\n').split('\n');
  const headingPattern = new RegExp(`^##\\s+(?:\\[)?${String(version).replaceAll('.', '\\.')}(?:\\])?(?:\\s|$)`);
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) return '';

  const next = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines.slice(start, next === -1 ? undefined : next).join('\n').trim();
}

function groupChangesets(entries) {
  const groups = {
    major: [],
    minor: [],
    patch: [],
  };
  for (const entry of entries) {
    if (groups[entry.releaseType]) groups[entry.releaseType].push(entry);
  }
  return groups;
}

function renderChangesetGroup(title, entries) {
  if (entries.length === 0) return '';
  const lines = [`### ${title}`, ''];
  for (const entry of entries) {
    lines.push(`#### ${entry.file}`);
    lines.push('');
    lines.push(entry.summary.trim());
    lines.push('');
  }
  return lines.join('\n').trim();
}

function formatReleaseNotes({
  packageName = DEFAULT_PACKAGE_NAME,
  repoFullName = REPO_FULL_NAME,
  version,
  previousTag,
  currentTag = `v${version}`,
  currentRef = 'HEAD',
  githubRunUrl = '',
  changesets = [],
  changelogEntry = '',
} = {}) {
  const releaseUrl = `https://github.com/${repoFullName}/releases/tag/${currentTag}`;
  const npmUrl = `https://www.npmjs.com/package/${packageName}/v/${version}`;
  const compareUrl = previousTag
    ? `https://github.com/${repoFullName}/compare/${previousTag}...${currentTag}`
    : `https://github.com/${repoFullName}/releases/tag/${currentTag}`;
  const groups = groupChangesets(changesets);
  const sections = [
    `# ${packageName}@${version}`,
    '',
    '## Release Links',
    '',
    `- npm: ${npmUrl}`,
    `- GitHub Release: ${releaseUrl}`,
    `- Compare: ${compareUrl}`,
    githubRunUrl ? `- Publish workflow: ${githubRunUrl}` : '',
    `- Release ref: ${currentRef}`,
    '',
    '## Full Changeset Release Notes',
    '',
  ].filter((line) => line !== '');

  const renderedGroups = [
    renderChangesetGroup('Major Changes', groups.major),
    renderChangesetGroup('Minor Changes', groups.minor),
    renderChangesetGroup('Patch Changes', groups.patch),
  ].filter(Boolean);

  if (renderedGroups.length > 0) {
    sections.push(renderedGroups.join('\n\n'));
  } else {
    sections.push('No changed `.changeset/*.md` entries were detected for this release range.');
  }

  sections.push('');
  sections.push('## CHANGELOG.md Entry');
  sections.push('');
  sections.push(changelogEntry || `No \`CHANGELOG.md\` section was found for ${version}; the release notes above were generated from the changed Changeset files.`);
  sections.push('');
  sections.push('## Verification Standard');
  sections.push('');
  sections.push('- Publish only runs from `main` after version sync, tests, and runtime proof pass.');
  sections.push('- The npm package is smoke-tested after publish by installing `thumbgate@VERSION` in a clean runtime.');
  sections.push('- GitHub Release notes are generated from Changesets, not only GitHub auto-generated PR titles.');

  return `${sections.join('\n')}\n`;
}

function buildReleaseNotes({
  version,
  packageName = DEFAULT_PACKAGE_NAME,
  repoFullName = REPO_FULL_NAME,
  currentRef = 'HEAD',
  previousTag,
  githubRunUrl = '',
  cwd = PROJECT_ROOT,
  runner = execFileSync,
} = {}) {
  const resolvedVersion = String(version || readPackageVersion({ cwd })).trim();
  const currentTag = `v${resolvedVersion}`;
  const resolvedPreviousTag = previousTag || detectPreviousTag({
    version: resolvedVersion,
    currentTag,
    cwd,
    runner,
  });
  const changedChangesetFiles = getChangedChangesetFiles({
    previousTag: resolvedPreviousTag,
    currentRef,
    cwd,
    runner,
  });
  const changesets = readChangesetEntries({
    files: changedChangesetFiles,
    packageName,
    cwd,
  });
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  const changelogEntry = fs.existsSync(changelogPath)
    ? extractChangelogEntry(fs.readFileSync(changelogPath, 'utf8'), resolvedVersion)
    : '';

  return {
    markdown: formatReleaseNotes({
      packageName,
      repoFullName,
      version: resolvedVersion,
      previousTag: resolvedPreviousTag,
      currentTag,
      currentRef,
      githubRunUrl,
      changesets,
      changelogEntry,
    }),
    version: resolvedVersion,
    previousTag: resolvedPreviousTag,
    changedChangesetFiles,
    changesets,
  };
}

function runCli({
  argv = process.argv.slice(2),
  cwd = PROJECT_ROOT,
  env = process.env,
  runner = execFileSync,
} = {}) {
  const options = parseArgs(argv);
  const result = buildReleaseNotes({
    version: options.version || env.VERSION,
    packageName: options.packageName || DEFAULT_PACKAGE_NAME,
    repoFullName: options.repoFullName || env.GITHUB_REPOSITORY || REPO_FULL_NAME,
    currentRef: options.currentRef || env.GITHUB_SHA || 'HEAD',
    previousTag: options.previousTag,
    githubRunUrl: options.githubRunUrl || env.GITHUB_RUN_URL || '',
    cwd,
    runner,
  });

  if (options.outputPath) {
    fs.writeFileSync(path.resolve(cwd, options.outputPath), result.markdown);
  }
  process.stdout.write(result.markdown);
  return result;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  buildReleaseNotes,
  compareSemverTagsDescending,
  detectPreviousTag,
  extractChangelogEntry,
  formatReleaseNotes,
  getChangedChangesetFiles,
  parseArgs,
  readChangesetEntries,
  runCli,
  semverTagValue,
};
