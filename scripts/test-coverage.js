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
let cachedCoverageFilterSupport;

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

function detectCoverageFilterSupport({ spawn = spawnSync } = {}) {
  if (spawn === spawnSync && cachedCoverageFilterSupport !== undefined) {
    return cachedCoverageFilterSupport;
  }

  const result = spawn(process.execPath, ['--help'], {
    encoding: 'utf8',
  });
  const helpText = `${result.stdout || ''}\n${result.stderr || ''}`;
  const supported = helpText.includes('--test-coverage-include') && helpText.includes('--test-coverage-exclude');

  if (spawn === spawnSync) {
    cachedCoverageFilterSupport = supported;
  }

  return supported;
}

function buildCoverageArgs(files, { spawn = spawnSync, supportsFilters } = {}) {
  const args = [
    '--test',
    '--test-concurrency=1',
    '--experimental-test-coverage',
  ];

  const useFilterFlags = supportsFilters === undefined
    ? detectCoverageFilterSupport({ spawn })
    : supportsFilters;
  if (useFilterFlags) {
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
  supportsFilters,
} = {}) {
  if (files.length === 0) {
    return {
      exitCode: 1,
      error: 'No test files found for coverage run.',
      args: buildCoverageArgs(files, { spawn, supportsFilters }),
    };
  }

  const args = buildCoverageArgs(files, { spawn, supportsFilters });
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
  detectCoverageFilterSupport,
  findCoverageTestFiles,
  buildCoverageArgs,
  runCoverage,
};
