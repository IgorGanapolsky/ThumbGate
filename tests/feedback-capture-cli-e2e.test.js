'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const captureScript = path.join(repoRoot, '.claude', 'scripts', 'feedback', 'capture-feedback.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-cli-e2e-'));
}

function readJSONL(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runCaptureCli(args, env, timeout = 5000) {
  return spawnSync(process.execPath, [captureScript, ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout,
  });
}

test('feedback CLI e2e captures negative feedback, updates stats and writes prevention rules without hanging', (t) => {
  const feedbackDir = makeTmpDir();
  const homeDir = makeTmpDir();
  const optimizerPath = path.join(feedbackDir, 'noop-self-harness-optimizer.js');
  const rulesPath = path.join(feedbackDir, 'prevention-rules.md');
  fs.writeFileSync(
    optimizerPath,
    [
      "'use strict';",
      "require('node:fs').writeFileSync(process.env.THUMBGATE_SELF_HARNESS_MARKER, 'launched');",
      "setTimeout(() => {}, 250);",
      '',
    ].join('\n')
  );

  const env = {
    ...process.env,
    HOME: homeDir,
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_DISABLE_TELEMETRY: '1',
    THUMBGATE_NO_TELEMETRY: '1',
    THUMBGATE_SELF_HARNESS_OPTIMIZER_PATH: optimizerPath,
    THUMBGATE_SELF_HARNESS_MARKER: path.join(feedbackDir, 'optimizer-marker.txt'),
  };

  t.after(() => {
    try { fs.rmSync(feedbackDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
    try { fs.rmSync(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const capture = runCaptureCli([
    '--feedback=down',
    '--context=CLI e2e feedback capture must exit promptly after durable write',
    '--what-went-wrong=The wrapper previously left a live child-process IPC handle open.',
    '--what-to-change=Use detached non-IPC launch for background optimizer and keep feedback capture bounded.',
    '--tags=dogfood,feedback-capture,e2e',
  ], env);

  assert.equal(capture.error, undefined, `capture CLI should not time out: ${capture.error && capture.error.message}`);
  assert.equal(capture.status, 0, capture.stderr || capture.stdout);
  assert.match(capture.stdout, /ThumbGate Feedback Captured \[DOWN\]/);
  assert.match(capture.stdout, /Storage\s+: JSONL log \+ LanceDB vector index/);

  const feedbackLog = readJSONL(path.join(feedbackDir, 'feedback-log.jsonl'));
  const memoryLog = readJSONL(path.join(feedbackDir, 'memory-log.jsonl'));
  assert.equal(feedbackLog.length, 1);
  assert.equal(memoryLog.length, 1);
  assert.equal(feedbackLog[0].signal, 'negative');
  assert.equal(memoryLog[0].sourceFeedbackId, feedbackLog[0].id);
  assert.match(memoryLog[0].title, /MISTAKE:/);

  const stats = runCaptureCli(['--stats'], env);
  assert.equal(stats.status, 0, stats.stderr || stats.stdout);
  const parsedStats = JSON.parse(stats.stdout);
  assert.equal(parsedStats.totalNegative, 1);
  assert.equal(parsedStats.total, 1);

  const rules = runCaptureCli(['--rules', `--output=${rulesPath}`, '--min=1'], env);
  assert.equal(rules.status, 0, rules.stderr || rules.stdout);
  assert.ok(fs.existsSync(rulesPath), 'rules file should be written');
  assert.match(fs.readFileSync(rulesPath, 'utf8'), /# Prevention Rules/);
  assert.match(fs.readFileSync(rulesPath, 'utf8'), /feedback-capture|testing|general/);
});
