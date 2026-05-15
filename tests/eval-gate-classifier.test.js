const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// End-to-end verification of scripts/eval_gate_classifier.py — the only
// sklearn-bearing surface in the repo. Synthesizes a small JSONL dataset
// in a temp dir, runs the pipeline, and asserts the joblib artifact + the
// metrics card are well-formed.
//
// sklearn is intentionally NOT a dependency of the npm package, so this
// test gracefully skips when scikit-learn is not importable. CI without
// sklearn stays green; CI with sklearn (or any local dev box) actually
// proves the pipeline contract.

const SCRIPT = path.join(__dirname, '..', 'scripts', 'eval_gate_classifier.py');

function sklearnAvailable() {
  const probe = spawnSync(
    'python3',
    ['-c', 'import sklearn, joblib, scipy; print("ok")'],
    { encoding: 'utf8' },
  );
  return probe.status === 0 && probe.stdout.trim() === 'ok';
}

function makeFixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-classifier-'));
  const log = path.join(dir, 'feedback-log.jsonl');
  const rows = [];
  // 30 entries each side — easily separable so the classifier can fit
  // and the test runs deterministically with seed=42.
  for (let i = 0; i < 30; i += 1) {
    rows.push(JSON.stringify({
      id: `pos_${i}`,
      signal: 'positive',
      context: `Edited src/feature_${i}.ts and ran the test suite cleanly`,
      whatWorked: 'verified before claiming done',
      tags: ['edit', 'verification'],
      lastAction: 'Edit',
      timestamp: '2026-05-14T00:00:00Z',
    }));
    rows.push(JSON.stringify({
      id: `neg_${i}`,
      signal: 'negative',
      context: `Force-pushed to main and broke production build ${i}`,
      whatWentWrong: 'force push without thread check',
      tags: ['git', 'destructive'],
      lastAction: 'Bash',
      timestamp: '2026-05-14T00:00:00Z',
    }));
  }
  fs.writeFileSync(log, `${rows.join('\n')}\n`);
  return { dir, log };
}

test('eval_gate_classifier.py compiles under python3', () => {
  const result = spawnSync('python3', ['-m', 'py_compile', SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'py_compile failed');
});

test('eval_gate_classifier.py reports a clear error when sklearn is missing', { skip: sklearnAvailable() && 'sklearn IS available locally — cannot test the missing branch' }, () => {
  // Pass an explicit nonexistent feedback log so the assertion is fully
  // isolated from whatever .thumbgate/feedback-log.jsonl exists in the
  // resolved feedback dir (clean CI checkout, dev box with sample data,
  // anything in between). The script must still surface the missing-deps
  // hint first, before any data-shape error.
  const probe = spawnSync(
    'python3',
    [SCRIPT, '--feedback-log', '/nonexistent/feedback-log.jsonl', '--json'],
    { encoding: 'utf8' },
  );
  assert.notEqual(probe.status, 0, 'should exit non-zero when sklearn missing');
  assert.match(probe.stderr + probe.stdout, /pip install scikit-learn/);
});

test('eval_gate_classifier.py end-to-end on synthetic dataset', { skip: !sklearnAvailable() && 'sklearn not installed (pip install scikit-learn joblib to enable)' }, () => {
  const { dir, log } = makeFixtureDir();
  const outDir = path.join(dir, 'eval');
  const probe = spawnSync(
    'python3',
    [
      SCRIPT,
      '--feedback-log', log,
      '--output-dir', outDir,
      '--random-seed', '42',
      '--test-size', '0.3',
      '--json',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, probe.stderr || 'pipeline exited non-zero');

  const card = JSON.parse(probe.stdout);
  assert.equal(card.dataset.positive, 30, 'positive count');
  assert.equal(card.dataset.negative, 30, 'negative count');
  assert.equal(card.dataset.train_size + card.dataset.test_size, 60, 'split sums to total');
  assert.ok(card.dataset.feature_dim > 0, 'feature_dim populated');
  assert.ok(card.precision.macro >= 0 && card.precision.macro <= 1, 'precision in [0,1]');
  assert.ok(card.recall.macro >= 0 && card.recall.macro <= 1, 'recall in [0,1]');
  assert.ok(card.f1.macro >= 0 && card.f1.macro <= 1, 'f1 in [0,1]');
  assert.ok(card.roc_auc === null || (card.roc_auc >= 0 && card.roc_auc <= 1), 'roc_auc in [0,1]');
  assert.ok(card.pr_auc === null || (card.pr_auc >= 0 && card.pr_auc <= 1), 'pr_auc in [0,1]');
  assert.ok(card.classification_report.positive, 'classification_report has positive class');
  assert.ok(card.classification_report.negative, 'classification_report has negative class');

  assert.ok(fs.existsSync(card.artifact_path), `joblib artifact written: ${card.artifact_path}`);
  const stat = fs.statSync(card.artifact_path);
  assert.ok(stat.size > 0, 'joblib artifact non-empty');

  const metricsPath = path.join(outDir, 'gate_classifier_metrics.json');
  assert.ok(fs.existsSync(metricsPath), 'metrics card written');

  // The synthetic data is highly separable; macro F1 should clear 0.7
  // even with the 0.3 holdout. If this drops, the pipeline regressed.
  assert.ok(card.f1.macro >= 0.7, `macro F1 should be >= 0.7 on separable data; got ${card.f1.macro}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('eval_gate_classifier.py refuses to train on too few labeled rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-classifier-tiny-'));
  const log = path.join(dir, 'feedback-log.jsonl');
  fs.writeFileSync(
    log,
    `${JSON.stringify({ signal: 'positive', context: 'tiny', tags: [] })}\n`,
  );
  const probe = spawnSync(
    'python3',
    [SCRIPT, '--feedback-log', log, '--output-dir', path.join(dir, 'eval')],
    { encoding: 'utf8' },
  );
  assert.notEqual(probe.status, 0);
  assert.match(probe.stderr + probe.stdout, /at least 10 labeled rows/);
  fs.rmSync(dir, { recursive: true, force: true });
});
