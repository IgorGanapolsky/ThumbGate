'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RELEASE_TYPE = 'patch';
const DEFAULT_PACKAGE_NAME = 'thumbgate';
const DEPENDABOT_PREFIXES = [
  { prefix: 'chore(deps): bump ', updateType: 'deps' },
  { prefix: 'chore(deps-dev): bump ', updateType: 'deps-dev' },
];

function parseDependabotPayload(payload) {
  const toIndex = payload.lastIndexOf(' to ');
  if (toIndex <= 0) {
    return null;
  }

  const fromIndex = payload.lastIndexOf(' from ', toIndex - 1);
  if (fromIndex <= 0) {
    return null;
  }

  const dependencyName = payload.slice(0, fromIndex).trim();
  const fromVersion = payload.slice(fromIndex + 6, toIndex).trim();
  const toVersion = payload.slice(toIndex + 4).trim();
  if (!dependencyName || !fromVersion || !toVersion) {
    return null;
  }

  return {
    dependencyName,
    fromVersion,
    toVersion,
  };
}

function slugify(value) {
  const lower = String(value || '').trim().toLowerCase();
  let result = '';
  let lastWasHyphen = false;

  for (const character of lower) {
    const isAlphaNumeric = (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9');
    if (isAlphaNumeric) {
      result += character;
      lastWasHyphen = false;
      continue;
    }

    if (!lastWasHyphen && result.length > 0) {
      result += '-';
      lastWasHyphen = true;
    }
  }

  const trimmed = result.endsWith('-') ? result.slice(0, -1) : result;
  return trimmed.slice(0, 64) || 'dependabot-update';
}

function parseDependabotTitle(title) {
  const normalized = String(title || '').trim();
  const lower = normalized.toLowerCase();

  for (const candidate of DEPENDABOT_PREFIXES) {
    if (!lower.startsWith(candidate.prefix)) {
      continue;
    }

    const payload = parseDependabotPayload(normalized.slice(candidate.prefix.length));
    if (!payload) {
      break;
    }

    return {
      updateType: candidate.updateType,
      dependencyName: payload.dependencyName,
      fromVersion: payload.fromVersion,
      toVersion: payload.toVersion,
      rawTitle: normalized,
      matched: true,
    };
  }

  return {
    updateType: 'deps',
    dependencyName: '',
    fromVersion: '',
    toVersion: '',
    rawTitle: normalized,
    matched: false,
  };
}

function isDirectCliExecution(argv = process.argv, filename = __filename) {
  const entrypoint = argv[1];
  if (!entrypoint) {
    return false;
  }

  return path.resolve(entrypoint) === filename;
}

function buildDependabotSummary(title) {
  const parsed = parseDependabotTitle(title);
  if (!parsed.matched) {
    return 'Keep ThumbGate release automation current by shipping this Dependabot dependency update through the audited changeset lane.';
  }

  return `Bump ${parsed.dependencyName} from ${parsed.fromVersion} to ${parsed.toVersion} to keep the shipped ${parsed.updateType === 'deps-dev' ? 'build and test dependency' : 'runtime dependency'} set current under ThumbGate's audited release flow.`;
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

if (isDirectCliExecution()) {
  runCli();
}

module.exports = {
  buildDependabotChangeset,
  buildDependabotSummary,
  defaultOutputPath,
  isDirectCliExecution,
  parseDependabotTitle,
  runCli,
  slugify,
};
