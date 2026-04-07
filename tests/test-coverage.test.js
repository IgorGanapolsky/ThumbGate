const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildCoverageArgs,
  COVERAGE_EXCLUDE_GLOBS,
  COVERAGE_INCLUDE_GLOBS,
  detectCoverageFilterSupport,
  findCoverageTestFiles,
  runCoverage,
} = require('../scripts/test-coverage');

test('findCoverageTestFiles returns sorted nested test files', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-tests-'));
  const nestedDir = path.join(tmpRoot, 'nested');
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'b.test.js'), '');
  fs.writeFileSync(path.join(nestedDir, 'a.test.js'), '');
  fs.writeFileSync(path.join(tmpRoot, 'ignore.js'), '');

  const files = findCoverageTestFiles({ dir: tmpRoot, projectRoot: tmpRoot });

  assert.deepEqual(files, ['b.test.js', path.join('nested', 'a.test.js')]);
});

test('buildCoverageArgs prepends Node coverage flags', () => {
  assert.deepEqual(buildCoverageArgs(['tests/a.test.js'], { supportsFilters: true }), [
    '--test',
    '--test-concurrency=1',
    '--experimental-test-coverage',
    ...COVERAGE_INCLUDE_GLOBS.flatMap((pattern) => ['--test-coverage-include', pattern]),
    ...COVERAGE_EXCLUDE_GLOBS.flatMap((pattern) => ['--test-coverage-exclude', pattern]),
    'tests/a.test.js',
  ]);
});

test('buildCoverageArgs omits unsupported filter flags', () => {
  assert.deepEqual(buildCoverageArgs(['tests/a.test.js'], { supportsFilters: false }), [
    '--test',
    '--test-concurrency=1',
    '--experimental-test-coverage',
    'tests/a.test.js',
  ]);
});

test('detectCoverageFilterSupport checks the runtime help output', () => {
  const supported = detectCoverageFilterSupport({
    spawn: () => ({
      stdout: '--test-coverage-include\n--test-coverage-exclude\n',
      stderr: '',
    }),
  });
  const unsupported = detectCoverageFilterSupport({
    spawn: () => ({
      stdout: '--experimental-test-coverage\n',
      stderr: '',
    }),
  });

  assert.equal(supported, true);
  assert.equal(unsupported, false);
});

test('runCoverage returns error when no test files are provided', () => {
  const result = runCoverage({ files: [], supportsFilters: false });

  assert.equal(result.exitCode, 1);
  assert.equal(result.error, 'No test files found for coverage run.');
});

test('runCoverage delegates to Node with test coverage flags', () => {
  let captured;
  const result = runCoverage({
    files: ['tests/a.test.js', 'tests/b.test.js'],
    cwd: '/tmp/coverage',
    supportsFilters: true,
    spawn: (cmd, args, options) => {
      captured = { cmd, args, options };
      return { status: 0, error: null };
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(captured.cmd, process.execPath);
  assert.deepEqual(captured.args, [
    '--test',
    '--test-concurrency=1',
    '--experimental-test-coverage',
    ...COVERAGE_INCLUDE_GLOBS.flatMap((pattern) => ['--test-coverage-include', pattern]),
    ...COVERAGE_EXCLUDE_GLOBS.flatMap((pattern) => ['--test-coverage-exclude', pattern]),
    'tests/a.test.js',
    'tests/b.test.js',
  ]);
  assert.equal(captured.options.cwd, '/tmp/coverage');
  assert.equal(captured.options.stdio, 'inherit');
});

test('runCoverage falls back when coverage filter flags are unsupported', () => {
  let captured;
  const result = runCoverage({
    files: ['tests/a.test.js'],
    cwd: '/tmp/coverage',
    supportsFilters: false,
    spawn: (cmd, args, options) => {
      captured = { cmd, args, options };
      return { status: 0, error: null };
    },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(captured.args, [
    '--test',
    '--test-concurrency=1',
    '--experimental-test-coverage',
    'tests/a.test.js',
  ]);
});
