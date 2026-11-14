'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projectFromRemote, UNASSIGNED } = require('../scripts/project-identity');

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('new feedback, audit events and tool calls record the project key at capture time', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-key-'));
  const repo = path.join(root, 'repo');
  const feedbackDir = path.join(root, 'feedback');
  fs.mkdirSync(repo);
  fs.mkdirSync(feedbackDir);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/capture-test/widget']);
  const expected = projectFromRemote('https://github.com/capture-test/widget');
  const oldDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  t.after(() => {
    if (oldDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR; else process.env.THUMBGATE_FEEDBACK_DIR = oldDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
  t.mock.method(globalThis, 'fetch', () => Promise.reject(new Error('network disabled in fixture')));

  const loop = require('../scripts/feedback-loop');
  const result = loop.captureFeedback({ cwd: repo, signal: 'negative', context: 'Migration ran before the backup finished.', whatWentWrong: 'No backup gate.', whatToChange: 'Run backups first.', tags: ['database'], reviewOrigin: 'human' }, { feedbackDir });
  await loop.waitForBackgroundSideEffects();
  assert.equal(result.accepted !== false, true);
  const feedback = readJsonl(path.join(feedbackDir, 'feedback-log.jsonl'));
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].projectKey, expected.projectKey);
  assert.equal(feedback[0].projectName, expected.projectName);

  require('../scripts/audit-trail').recordAuditEvent({ cwd: repo, feedbackDir, toolName: 'Bash', toolInput: { command: 'ls' }, decision: 'deny', gateId: 'g1', source: 'gates-engine' });
  const audit = readJsonl(path.join(feedbackDir, 'audit-trail.jsonl'));
  assert.equal(audit.at(-1).projectKey, expected.projectKey);

  require('../scripts/tool-kpi-tracker').recordToolCall({ toolName: 'Bash', cwd: repo, feedbackDir, success: true });
  const kpi = readJsonl(require('../scripts/tool-kpi-tracker').getKpiLogPath({ feedbackDir }));
  assert.equal(kpi.at(-1).projectKey, expected.projectKey);
});

test('rows with no project evidence stay labelled as unassigned before project tracking', () => {
  assert.equal(UNASSIGNED.projectKey, 'unassigned');
  assert.equal(UNASSIGNED.projectName, 'Unassigned (before project tracking)');
  const { projectForRecord } = require('../scripts/project-identity');
  const legacyHostedRow = { id: 'old_1', signal: 'down', context: 'recorded before project tracking existed' };
  assert.deepEqual(projectForRecord(legacyHostedRow), { ...UNASSIGNED });
});
