#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(PROJECT_ROOT, 'tests');
const COVERAGE_INCLUDE_GLOBS = [
  '.claude/**/*.js',
  'adapters/**/*.js',
  'bin/**/*.js',
  'plugins/**/*.js',
  'scripts/**/*.js',
  'src/**/*.js',
];
const COVERAGE_EXCLUDE_GLOBS = [
  'tests/**/*.js',
];

function findCoverageTestFiles({
  dir = TESTS_DIR,
  projectRoot = PROJECT_ROOT,
} = {}) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findCoverageTestFiles({ dir: fullPath, projectRoot }));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(path.relative(projectRoot, fullPath));
    }
  }

  return files.sort();
}

function supportsCoveragePatternFlags({
  spawn = spawnSync,
} = {}) {
  const result = spawn(process.execPath, ['--help'], {
    encoding: 'utf8',
  });

  if (result.error) {
    return false;
  }

  const help = `${result.stdout || ''}\n${result.stderr || ''}`;
  return help.includes('--test-coverage-include') && help.includes('--test-coverage-exclude');
}

function buildCoverageArgs(files, { supportsPatternFlags = true } = {}) {
  const args = [
    '--test',
    '--test-concurrency=1',
    '--experimental-test-coverage',
  ];

  if (supportsPatternFlags) {
    args.push(
      ...COVERAGE_INCLUDE_GLOBS.flatMap((pattern) => ['--test-coverage-include', pattern]),
      ...COVERAGE_EXCLUDE_GLOBS.flatMap((pattern) => ['--test-coverage-exclude', pattern]),
    );
  }

  args.push(...files);
  return args;
}

function runCoverage({
  files = findCoverageTestFiles(),
  cwd = PROJECT_ROOT,
  spawn = spawnSync,
  supportsPatternFlags = supportsCoveragePatternFlags({ spawn }),
} = {}) {
  if (files.length === 0) {
    return {
      exitCode: 1,
      error: 'No test files found for coverage run.',
      args: buildCoverageArgs(files, { supportsPatternFlags }),
    };
  }

  const args = buildCoverageArgs(files, { supportsPatternFlags });
  const result = spawn(process.execPath, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });

  return {
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    error: result.error ? result.error.message : null,
    args,
  };
}

if (require.main === module) {
  const result = runCoverage();
  if (result.error) {
    console.error(result.error);
  }
  process.exit(result.exitCode);
}

module.exports = {
  COVERAGE_EXCLUDE_GLOBS,
  COVERAGE_INCLUDE_GLOBS,
  PROJECT_ROOT,
  TESTS_DIR,
  findCoverageTestFiles,
  buildCoverageArgs,
  runCoverage,
  supportsCoveragePatternFlags,
};
