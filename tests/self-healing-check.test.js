const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_CHECKS,
  DEFAULT_TESTS_TIMEOUT_MS,
  EMBEDDING_DRIFT_MAX_LAG_HOURS,
  evaluateEmbeddingIndexDrift,
  collectHealthReport,
  runCommand,
  reportToText,
} = require('../scripts/self-healing-check');

function makeDriftFixture({ feedbackLogContent, feedbackLogMtime, embeddingsMtime } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-embedding-drift-'));
  const feedbackLogPath = path.join(dir, 'feedback-log.jsonl');
  const embeddingsPath = path.join(dir, 'lesson-embeddings.json');
  if (feedbackLogContent !== undefined) {
    fs.writeFileSync(feedbackLogPath, feedbackLogContent);
    if (feedbackLogMtime) fs.utimesSync(feedbackLogPath, feedbackLogMtime, feedbackLogMtime);
  }
  if (embeddingsMtime) {
    fs.writeFileSync(embeddingsPath, '{}');
    fs.utimesSync(embeddingsPath, embeddingsMtime, embeddingsMtime);
  }
  return { dir, feedbackLogPath, embeddingsPath };
}

test('DEFAULT_CHECKS delegates verification through npm test', () => {
  const testsCheck = DEFAULT_CHECKS.find((check) => check.name === 'tests');
  assert.deepEqual(testsCheck.command, ['npm', 'test']);
  assert.equal(testsCheck.timeoutMs, DEFAULT_TESTS_TIMEOUT_MS);
  assert.ok(testsCheck.timeoutMs >= 60 * 60_000);
});

test('DEFAULT_CHECKS isolates proof artifacts for prove checks', () => {
  const proveAdapters = DEFAULT_CHECKS.find((check) => check.name === 'prove_adapters');
  const proveAutomation = DEFAULT_CHECKS.find((check) => check.name === 'prove_automation');
  const proveDataPipeline = DEFAULT_CHECKS.find((check) => check.name === 'prove_data_pipeline');
  const proveTessl = DEFAULT_CHECKS.find((check) => check.name === 'prove_tessl');

  assert.equal(proveAdapters.useTempProofDir, true);
  assert.equal(proveAutomation.useTempProofDir, true);
  assert.equal(proveDataPipeline.useTempProofDir, true);
  assert.equal(proveTessl.useTempProofDir, true);
});

test('DEFAULT_CHECKS includes the embedding index drift check', () => {
  const drift = DEFAULT_CHECKS.find((check) => check.name === 'embedding_index_drift');
  assert.ok(drift, 'embedding_index_drift check must be part of the self-heal surface');
  assert.equal(typeof drift.evaluate, 'function');
  assert.equal(EMBEDDING_DRIFT_MAX_LAG_HOURS, 24);
});

test('evaluateEmbeddingIndexDrift is healthy when the index is fresh', () => {
  const now = new Date();
  const fixture = makeDriftFixture({
    feedbackLogContent: '{"id":"lesson-1"}\n',
    feedbackLogMtime: now,
    embeddingsMtime: now,
  });
  try {
    const result = evaluateEmbeddingIndexDrift({ feedbackDir: fixture.dir });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /fresh/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('evaluateEmbeddingIndexDrift tolerates lag under 24h', () => {
  const now = new Date();
  const fixture = makeDriftFixture({
    feedbackLogContent: '{"id":"lesson-1"}\n',
    feedbackLogMtime: now,
    embeddingsMtime: new Date(now.getTime() - (23 * 3_600_000)),
  });
  try {
    const result = evaluateEmbeddingIndexDrift({ feedbackDir: fixture.dir });
    assert.equal(result.exitCode, 0);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('evaluateEmbeddingIndexDrift flags a stale index with both paths, lag hours, and remediation', () => {
  const now = new Date();
  const fixture = makeDriftFixture({
    feedbackLogContent: '{"id":"lesson-1"}\n',
    feedbackLogMtime: now,
    embeddingsMtime: new Date(now.getTime() - (30 * 3_600_000)),
  });
  try {
    const result = evaluateEmbeddingIndexDrift({ feedbackDir: fixture.dir });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes(fixture.feedbackLogPath), 'names the feedback log path');
    assert.ok(result.stdout.includes(fixture.embeddingsPath), 'names the embeddings path');
    assert.match(result.stdout, /30h newer/);
    assert.match(result.stdout, /run: node scripts\/backfill-lesson-embeddings\.js/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('evaluateEmbeddingIndexDrift flags a missing index while lessons exist', () => {
  const fixture = makeDriftFixture({ feedbackLogContent: '{"id":"lesson-1"}\n' });
  try {
    const result = evaluateEmbeddingIndexDrift({ feedbackDir: fixture.dir });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes(fixture.feedbackLogPath));
    assert.ok(result.stdout.includes(fixture.embeddingsPath));
    assert.match(result.stdout, /run: node scripts\/backfill-lesson-embeddings\.js/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('evaluateEmbeddingIndexDrift skips when there is no feedback log', () => {
  const fixture = makeDriftFixture({});
  try {
    const result = evaluateEmbeddingIndexDrift({ feedbackDir: fixture.dir });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /skipped/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('evaluateEmbeddingIndexDrift stays healthy for an empty log with no index', () => {
  const fixture = makeDriftFixture({ feedbackLogContent: '' });
  try {
    const result = evaluateEmbeddingIndexDrift({ feedbackDir: fixture.dir });
    assert.equal(result.exitCode, 0);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('collectHealthReport surfaces embedding drift as an unhealthy check', () => {
  const now = new Date();
  const fixture = makeDriftFixture({
    feedbackLogContent: '{"id":"lesson-1"}\n',
    feedbackLogMtime: now,
    embeddingsMtime: new Date(now.getTime() - (48 * 3_600_000)),
  });
  try {
    const report = collectHealthReport({
      checks: [{
        name: 'embedding_index_drift',
        command: ['internal', 'embedding-index-drift'],
        evaluate: () => evaluateEmbeddingIndexDrift({ feedbackDir: fixture.dir }),
      }],
      runner: () => {
        throw new Error('runner must not be invoked for evaluate-based checks');
      },
    });

    assert.equal(report.overall_status, 'unhealthy');
    assert.equal(report.checks[0].status, 'unhealthy');
    assert.match(report.checks[0].outputTail, /48h newer/);
    assert.match(report.checks[0].outputTail, /run: node scripts\/backfill-lesson-embeddings\.js/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('collectHealthReport marks overall healthy when all checks pass', () => {
  const checks = [
    { name: 'a', command: ['mock', 'a'] },
    { name: 'b', command: ['mock', 'b'] },
  ];

  const report = collectHealthReport({
    checks,
    runner: () => ({ exitCode: 0, durationMs: 1, stdout: 'ok', stderr: '', error: null }),
  });

  assert.equal(report.overall_status, 'healthy');
  assert.equal(report.summary.healthy, 2);
  assert.equal(report.summary.unhealthy, 0);
});

test('collectHealthReport marks overall unhealthy when one check fails', () => {
  const checks = [
    { name: 'a', command: ['mock', 'a'] },
    { name: 'b', command: ['mock', 'b'] },
  ];

  const report = collectHealthReport({
    checks,
    runner: (command) => ({
      exitCode: command[1] === 'a' ? 0 : 1,
      durationMs: 2,
      stdout: '',
      stderr: 'boom',
      error: null,
    }),
  });

  assert.equal(report.overall_status, 'unhealthy');
  assert.equal(report.summary.healthy, 1);
  assert.equal(report.summary.unhealthy, 1);
  assert.equal(report.checks[1].status, 'unhealthy');
  assert.equal(report.checks[1].diagnosis.rootCauseCategory, 'system_failure');
});

test('collectHealthReport records duration for each check', () => {
  let callCount = 0;
  const report = collectHealthReport({
    checks: [{ name: 'slow', command: ['mock'] }],
    runner: () => {
      callCount++;
      return { exitCode: 0, durationMs: 500, stdout: '', stderr: '', error: null };
    },
  });

  assert.equal(callCount, 1);
  assert.ok(report.checks[0].durationMs >= 0);
});

test('collectHealthReport injects and cleans temp proof dirs for proof checks', () => {
  let capturedProofDir = null;
  let capturedAutomationProofDir = null;
  const report = collectHealthReport({
    checks: [{ name: 'prove_automation', command: ['npm', 'run', 'prove:automation'], useTempProofDir: true }],
    runner: (_command, options) => {
      capturedProofDir = options.env.THUMBGATE_PROOF_DIR;
      capturedAutomationProofDir = options.env.THUMBGATE_AUTOMATION_PROOF_DIR;
      assert.ok(capturedProofDir);
      assert.equal(capturedProofDir, capturedAutomationProofDir);
      assert.equal(fs.existsSync(capturedProofDir), true);
      return { exitCode: 0, durationMs: 1, stdout: 'ok', stderr: '', error: null };
    },
  });

  assert.equal(report.overall_status, 'healthy');
  assert.ok(capturedProofDir);
  assert.ok(capturedAutomationProofDir);
  assert.equal(fs.existsSync(capturedProofDir), false);
});

test('runCommand handles large stdout without buffer overflow', () => {
  const result = runCommand([
    process.execPath,
    '-e',
    "process.stdout.write('x'.repeat(2_000_000));",
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.error, null);
  assert.ok(result.stdout.length >= 2_000_000);
});

test('collectHealthReport captures output tail on failure', () => {
  const report = collectHealthReport({
    checks: [{ name: 'failing', command: ['mock'] }],
    runner: () => ({
      exitCode: 1,
      durationMs: 10,
      stdout: 'some stdout\nmore output',
      stderr: 'error details here',
      error: 'timeout',
    }),
  });

  assert.equal(report.checks[0].status, 'unhealthy');
  assert.ok(report.checks[0].outputTail.includes('error details'));
});

test('collectHealthReport can persist unhealthy diagnoses for shared analytics', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-self-heal-'));
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  const report = collectHealthReport({
    checks: [{ name: 'failing', command: ['mock'] }],
    persistDiagnostics: true,
    runner: () => ({
      exitCode: 1,
      durationMs: 10,
      stdout: '',
      stderr: 'error details here',
      error: null,
    }),
  });

  const diagnosticLog = path.join(tmpDir, 'diagnostic-log.jsonl');
  const entries = fs.readFileSync(diagnosticLog, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(report.checks[0].persistedDiagnosis.diagnosis.rootCauseCategory, 'system_failure');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, 'self_heal_check');

  delete process.env.THUMBGATE_FEEDBACK_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('collectHealthReport handles empty checks array', () => {
  const report = collectHealthReport({
    checks: [],
    runner: () => ({ exitCode: 0, durationMs: 0, stdout: '', stderr: '', error: null }),
  });

  assert.equal(report.overall_status, 'healthy');
  assert.equal(report.summary.total, 0);
});

test('collectHealthReport has timestamp', () => {
  const report = collectHealthReport({
    checks: [{ name: 'x', command: ['mock'] }],
    runner: () => ({ exitCode: 0, durationMs: 1, stdout: '', stderr: '', error: null }),
  });

  assert.ok(report.generatedAt);
  assert.ok(new Date(report.generatedAt).getTime() > 0);
});

test('collectHealthReport includes total duration', () => {
  const report = collectHealthReport({
    checks: [{ name: 'x', command: ['mock'] }],
    runner: () => ({ exitCode: 0, durationMs: 1, stdout: '', stderr: '', error: null }),
  });

  assert.ok(typeof report.durationMs === 'number');
  assert.ok(report.durationMs >= 0);
});

test('reportToText includes overall status and check names', () => {
  const text = reportToText({
    generatedAt: '2026-03-03T00:00:00.000Z',
    overall_status: 'healthy',
    summary: { healthy: 1, total: 1 },
    checks: [{ name: 'tests', status: 'healthy', durationMs: 10 }],
  });

  assert.match(text, /Overall: HEALTHY/);
  assert.match(text, /tests/);
});

test('reportToText shows unhealthy status', () => {
  const text = reportToText({
    generatedAt: '2026-03-03T00:00:00.000Z',
    overall_status: 'unhealthy',
    summary: { healthy: 0, total: 1, unhealthy: 1 },
    checks: [{
      name: 'broken',
      status: 'unhealthy',
      durationMs: 5,
      diagnosis: { rootCauseCategory: 'system_failure' },
    }],
  });

  assert.match(text, /UNHEALTHY/i);
  assert.match(text, /broken/);
  assert.match(text, /system_failure/);
});

test('reportToText includes multiple checks', () => {
  const text = reportToText({
    generatedAt: '2026-03-03T00:00:00.000Z',
    overall_status: 'unhealthy',
    summary: { healthy: 1, total: 2, unhealthy: 1 },
    checks: [
      { name: 'budget', status: 'healthy', durationMs: 10 },
      { name: 'tests', status: 'unhealthy', durationMs: 5000 },
    ],
  });

  assert.match(text, /budget/);
  assert.match(text, /tests/);
});
