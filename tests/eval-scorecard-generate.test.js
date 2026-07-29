'use strict';

// Coverage backfill for scripts/generate-eval-scorecard.js (PR #3072 debt).
// SonarCloud measured 63 uncovered new lines (74.1% new-code coverage) because
// only one renderScorecard happy path was exercised. These tests cover the
// exported surface — renderScorecard branches, the generate() writer flow, and
// runBench() dispatch + error branches — using fixtures and stubs so the real
// gate suite never runs. No CI env or operator data is required.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const pkg = require('../package.json');
const {
  generate,
  renderScorecard,
  runBench,
  OUTPUT_PATH,
} = require('../scripts/generate-eval-scorecard');

const ROOT = path.join(__dirname, '..');
const BENCH_MODULE_PATH = require.resolve('../scripts/thumbgate-bench.js');

const FIXTURE_METRICS = {
  score: 100,
  taskSuccessRate: 1,
  unsafeActionRate: 0,
  blockedUnsafeRate: 1,
  capabilityRate: 1,
  falseBlockRate: 0,
  replayStability: 1,
};

const FIXTURE_SCENARIOS = [
  {
    id: 'github-force-push-main',
    service: 'github',
    unsafe: true,
    expectedDecision: 'deny',
    actualDecision: 'deny',
    passed: true,
  },
  {
    id: 'fs-read-safe-file',
    service: 'filesystem',
    unsafe: false,
    expectedDecision: 'allow',
    actualDecision: 'allow',
    passed: true,
  },
];

const FIXTURE_REPORT = {
  metrics: FIXTURE_METRICS,
  passed: true,
  scenarios: FIXTURE_SCENARIOS,
  sourcePath: 'bench/thumbgate-bench.json',
};

function renderFixture(overrides = {}) {
  return renderScorecard({
    version: '1.99.0',
    nowIso: '2026-07-29T12:00:00.000Z',
    nowDate: '2026-07-29',
    metrics: FIXTURE_METRICS,
    passed: true,
    scenarios: FIXTURE_SCENARIOS,
    sourcePath: 'bench/thumbgate-bench.json',
    ...overrides,
  });
}

// Temporarily replace the cached thumbgate-bench module so runBench() sees the
// injected exports instead of loading (and executing) the real benchmark.
function withBenchModuleStub(exportsObject, fn) {
  const previous = require.cache[BENCH_MODULE_PATH];
  require.cache[BENCH_MODULE_PATH] = {
    id: BENCH_MODULE_PATH,
    filename: BENCH_MODULE_PATH,
    loaded: true,
    exports: exportsObject,
  };
  try {
    return fn();
  } finally {
    if (previous === undefined) delete require.cache[BENCH_MODULE_PATH];
    else require.cache[BENCH_MODULE_PATH] = previous;
  }
}

function withSpawnSyncStub(fakeSpawnSync, fn) {
  const realSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = fakeSpawnSync;
  try {
    return fn();
  } finally {
    childProcess.spawnSync = realSpawnSync;
  }
}

describe('renderScorecard branches', () => {
  it('renders passing fixture metrics with PASS rows and JSON-LD dataset', () => {
    const html = renderFixture();
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('<strong>1.99.0</strong>'), 'version rendered');
    assert.ok(html.includes('Updated: 2026-07-29'), 'freshness marker rendered');
    assert.ok(html.includes('Generated at 2026-07-29T12:00:00.000Z'));
    assert.ok(html.includes('github-force-push-main'));
    assert.ok(html.includes('fs-read-safe-file'));
    assert.ok(html.includes('<span class="good">PASS</span>'));
    assert.ok(html.includes('<span class="good">PASSED</span>'));
    assert.ok(html.includes('100.0%'), 'rates formatted as percentages');
    assert.ok(html.includes('"@type":"Dataset"'), 'Dataset JSON-LD emitted');
    assert.ok(html.includes('"name":"unsafeActionRate"'));
    assert.ok(html.includes('bench/thumbgate-bench.json'));
  });

  it('classifies unsafe vs safe scenarios in the table rows', () => {
    const html = renderFixture();
    assert.ok(html.includes('<td>unsafe</td>'));
    assert.ok(html.includes('<td>safe</td>'));
  });

  it('renders FAIL badges and a FAILED verdict for regressions', () => {
    const html = renderFixture({
      passed: false,
      metrics: { ...FIXTURE_METRICS, score: 42, unsafeActionRate: 0.25, falseBlockRate: 0.1 },
      scenarios: [
        {
          id: 'github-force-push-main',
          service: 'github',
          unsafe: true,
          expectedDecision: 'deny',
          actualDecision: 'allow',
          passed: false,
        },
      ],
    });
    assert.ok(html.includes('<span class="bad">FAIL</span>'));
    assert.ok(html.includes('<span class="bad">FAILED</span>'));
    assert.ok(html.includes('25.0%'), 'nonzero unsafe rate rendered');
    // Nonzero unsafeActionRate / falseBlockRate flip the metric tiles off "good".
    assert.match(html, /<div class="value bad">25\.0%<\/div>/);
    assert.match(html, /<div class="value warn">10\.0%<\/div>/);
  });

  it('renders n/a for non-finite rates and missing score', () => {
    const html = renderFixture({ metrics: {} });
    assert.ok(html.includes('n/a'), 'pct() falls back to n/a');
    assert.ok(
      html.includes('composite score <strong>n/a</strong>'),
      'missing score falls back to n/a',
    );
  });

  it('tolerates missing scenarios and missing sourcePath', () => {
    const html = renderScorecard({
      version: '0.0.1',
      nowIso: '2026-07-29T12:00:00.000Z',
      nowDate: '2026-07-29',
      metrics: FIXTURE_METRICS,
      passed: true,
    });
    assert.ok(html.includes('<tbody>'), 'table still renders with no rows');
    assert.ok(!html.includes('<tr>\n      <td><code>'), 'no scenario rows emitted');
    assert.ok(
      html.includes('bench/thumbgate-bench.json'),
      'sourcePath falls back to the committed suite path',
    );
  });

  it('escapes HTML-significant characters in untrusted scenario fields', () => {
    const html = renderFixture({
      version: '<img src=x onerror=alert(1)>',
      scenarios: [
        {
          id: '<script>alert(1)</script>',
          service: 'git & "hub"',
          unsafe: false,
          expectedDecision: "allow'",
          actualDecision: 'allow',
          passed: true,
        },
      ],
    });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('git &amp; &quot;hub&quot;'));
    assert.ok(html.includes('allow&#39;'));
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  });
});

describe('generate writer flow', () => {
  it('writes the rendered scorecard to an injected output path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-scorecard-'));
    const outPath = path.join(tmpDir, 'nested', 'dir', 'eval-scorecard.html');
    try {
      const result = generate({
        version: '9.9.9',
        now: new Date('2026-07-29T00:00:00Z'),
        report: FIXTURE_REPORT,
        outputPath: outPath,
      });
      assert.equal(result.outPath, outPath);
      assert.equal(result.report, FIXTURE_REPORT);
      const written = fs.readFileSync(outPath, 'utf8');
      assert.equal(written, result.html);
      assert.ok(written.startsWith('<!DOCTYPE html>'));
      assert.ok(written.includes('<strong>9.9.9</strong>'));
      assert.ok(written.includes('Updated: 2026-07-29'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('defaults the version from package.json when not injected', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-scorecard-'));
    const outPath = path.join(tmpDir, 'eval-scorecard.html');
    try {
      const result = generate({ report: FIXTURE_REPORT, outputPath: outPath });
      assert.ok(
        result.html.includes(`<strong>${pkg.version}</strong>`),
        'loadVersion() must read the repo package.json version',
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts a bare metrics report without metrics/scenarios wrappers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-scorecard-'));
    const outPath = path.join(tmpDir, 'eval-scorecard.html');
    try {
      const result = generate({
        version: '1.0.0',
        now: new Date('2026-07-29T00:00:00Z'),
        report: { score: 87, taskSuccessRate: 0.9 },
        outputPath: outPath,
      });
      assert.ok(
        result.html.includes('composite score <strong>87</strong>'),
        'report itself is used as the metrics object when report.metrics is absent',
      );
      assert.ok(
        result.html.includes('<span class="good">PASSED</span>'),
        'passed defaults to true unless explicitly false',
      );
      assert.ok(result.html.includes('90.0%'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('exports the committed public output path without writing to it', () => {
    assert.equal(OUTPUT_PATH, path.join(ROOT, 'public', 'eval-scorecard.html'));
  });
});

describe('runBench dispatch and error branches', () => {
  it('prefers the public runBenchmark API with the golden-suite options', () => {
    const sentinel = { metrics: { score: 95 }, passed: true, scenarios: [] };
    let receivedOptions = null;
    const report = withBenchModuleStub({
      runBenchmark(options) {
        receivedOptions = options;
        return sentinel;
      },
    }, () => runBench());
    assert.equal(report, sentinel);
    assert.ok(receivedOptions, 'runBenchmark received options');
    assert.equal(
      receivedOptions.suitePath,
      path.join(ROOT, 'bench', 'thumbgate-bench.json'),
    );
    assert.equal(receivedOptions.minScore, 90);
    assert.equal(receivedOptions.useRuntimeState, false);
  });

  it('falls back to a --json subprocess when only a CLI entry is exported', () => {
    let capturedArgs = null;
    const report = withBenchModuleStub({ main() {} }, () => withSpawnSyncStub(
      (execPath, args) => {
        capturedArgs = { execPath, args };
        return {
          status: 0,
          stdout: 'ThumbGate Bench log noise\n{"metrics":{"score":91},"passed":true}\ntrailing noise',
          stderr: '',
        };
      },
      () => runBench(),
    ));
    assert.deepEqual(report, { metrics: { score: 91 }, passed: true });
    assert.equal(capturedArgs.execPath, process.execPath);
    assert.deepEqual(capturedArgs.args, [
      path.join(ROOT, 'scripts', 'thumbgate-bench.js'),
      '--json',
    ]);
  });

  it('surfaces subprocess stderr when the bench fails without output', () => {
    withBenchModuleStub({}, () => withSpawnSyncStub(
      () => ({ status: 1, stdout: '', stderr: 'suite exploded' }),
      () => {
        assert.throws(() => runBench(), /suite exploded/);
      },
    ));
  });

  it('throws a generic failure when the bench fails silently', () => {
    withBenchModuleStub({}, () => withSpawnSyncStub(
      () => ({ status: 1, stdout: '', stderr: '' }),
      () => {
        assert.throws(() => runBench(), /thumbgate-bench failed/);
      },
    ));
  });

  it('rejects bench output that contains no JSON object', () => {
    withBenchModuleStub({}, () => withSpawnSyncStub(
      () => ({ status: 0, stdout: 'no json here', stderr: '' }),
      () => {
        assert.throws(() => runBench(), /did not emit JSON/);
      },
    ));
  });
});
