'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RELEASE_TYPE = 'patch';
const DEFAULT_PACKAGE_NAME = 'thumbgate';
const DEPENDABOT_TITLE_PATTERN = /^chore\((deps|deps-dev)\):\s+bump\s+(.+?)\s+from\s+([^\s]+)\s+to\s+([^\s]+)\s*$/i;

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'dependabot-update';
}

function parseDependabotTitle(title) {
  const normalized = String(title || '').trim();
  const match = normalized.match(DEPENDABOT_TITLE_PATTERN);
  if (!match) {
    return {
      updateType: 'deps',
      dependencyName: '',
      fromVersion: '',
      toVersion: '',
      rawTitle: normalized,
      matched: false,
    };
  }

  return {
    updateType: match[1].toLowerCase(),
    dependencyName: match[2].trim(),
    fromVersion: match[3].trim(),
    toVersion: match[4].trim(),
    rawTitle: normalized,
    matched: true,
  };
}

function buildDependabotSummary(title) {
  const parsed = parseDependabotTitle(title);
  if (!parsed.matched) {
    return 'Keep ThumbGate release automation current by shipping this Dependabot dependency update through the audited changeset lane.';
  }

  const dependencyKind = parsed.updateType === 'deps-dev' ? 'build and test dependency' : 'runtime dependency';
  return `Bump ${parsed.dependencyName} from ${parsed.fromVersion} to ${parsed.toVersion} to keep the shipped ${dependencyKind} set current under ThumbGate's audited release flow.`;
}

function buildDependabotChangeset(title, {
  packageName = DEFAULT_PACKAGE_NAME,
  releaseType = DEFAULT_RELEASE_TYPE,
} = {}) {
  const safePackageName = String(packageName || DEFAULT_PACKAGE_NAME).trim() || DEFAULT_PACKAGE_NAME;
  const safeReleaseType = String(releaseType || DEFAULT_RELEASE_TYPE).trim() || DEFAULT_RELEASE_TYPE;
  const summary = buildDependabotSummary(title);
  return [
    '---',
    `'${safePackageName}': ${safeReleaseType}`,
    '---',
    '',
    summary,
    '',
  ].join('\n');
}

function defaultOutputPath(title, {
  directory = '.changeset',
  prefix = 'dependabot',
} = {}) {
  const parsed = parseDependabotTitle(title);
  const stem = parsed.dependencyName
    ? `${prefix}-${slugify(parsed.dependencyName)}`
    : `${prefix}-${slugify(title)}`;
  return path.join(directory, `${stem}.md`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    title: '',
    output: '',
    packageName: DEFAULT_PACKAGE_NAME,
    releaseType: DEFAULT_RELEASE_TYPE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--title' && argv[index + 1]) {
      options.title = argv[index + 1];
      index += 1;
    } else if (arg === '--output' && argv[index + 1]) {
      options.output = argv[index + 1];
      index += 1;
    } else if (arg === '--package-name' && argv[index + 1]) {
      options.packageName = argv[index + 1];
      index += 1;
    } else if (arg === '--release-type' && argv[index + 1]) {
      options.releaseType = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.title) {
    throw new Error('--title is required');
  }

  const outputPath = options.output || defaultOutputPath(options.title);
  const content = buildDependabotChangeset(options.title, {
    packageName: options.packageName,
    releaseType: options.releaseType,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
  process.stdout.write(`${outputPath}\n`);
  return outputPath;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  buildDependabotChangeset,
  buildDependabotSummary,
  defaultOutputPath,
  parseDependabotTitle,
  runCli,
  slugify,
};
