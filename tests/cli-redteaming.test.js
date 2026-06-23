'use strict';

process.env.NODE_ENV = 'test';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CLI = path.resolve(__dirname, '../bin/cli.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-cli-rt-test-'));
}

describe('CLI Red-Teaming Feedback Capture', () => {
  let tmpDir;
  let feedbackDir;
  let env;

  before(() => {
    tmpDir = makeTmpDir();
    feedbackDir = path.join(tmpDir, '.thumbgate');
    fs.mkdirSync(feedbackDir, { recursive: true });
    env = {
      ...process.env,
      THUMBGATE_FEEDBACK_DIR: feedbackDir,
      THUMBGATE_API_URL: 'http://127.0.0.1:1',
      THUMBGATE_DISABLE_TELEMETRY: '1',
    };
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('captures feedback with red-teaming categories, edge case, and rationale via CLI', () => {
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        'capture',
        '--feedback=down',
        '--context=Discovery of unapproved remote execution path',
        '--what-went-wrong=Command execution bypassed verification via nested properties',
        '--what-to-change=Sanitize nested commands recursively',
        '--tags=security,red-teaming',
        '--risk-categories=Data Exfiltration,Unapproved Execution',
        '--edge-case=true',
        '--rationale=Simulated role simulation bypasses flat string patterns.',
        '--json'
      ],
      {
        encoding: 'utf8',
        env,
      }
    );

    assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
    const parsedOut = JSON.parse(result.stdout);
    assert.equal(parsedOut.ok, true);

    // Read the feedback-log and memory-log to verify the new fields are written correctly
    const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
    const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');

    assert.ok(fs.existsSync(feedbackLogPath));
    assert.ok(fs.existsSync(memoryLogPath));

    const feedbackLines = fs.readFileSync(feedbackLogPath, 'utf8').trim().split('\n');
    const lastFeedback = JSON.parse(feedbackLines[feedbackLines.length - 1]);

    assert.deepEqual(lastFeedback.riskCategories, ['Data Exfiltration', 'Unapproved Execution']);
    assert.equal(lastFeedback.isEdgeCase, true);
    assert.equal(lastFeedback.rationale, 'Simulated role simulation bypasses flat string patterns.');

    const memoryLines = fs.readFileSync(memoryLogPath, 'utf8').trim().split('\n');
    const lastMemory = JSON.parse(memoryLines[memoryLines.length - 1]);

    assert.deepEqual(lastMemory.riskCategories, ['Data Exfiltration', 'Unapproved Execution']);
    assert.equal(lastMemory.isEdgeCase, true);
    assert.equal(lastMemory.rationale, 'Simulated role simulation bypasses flat string patterns.');
  });
});
