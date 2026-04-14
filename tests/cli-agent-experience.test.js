'use strict';

/**
 * Tests for the agent-first CLI experience features:
 *   - thumbgate status [--json]
 *   - thumbgate demo [--json]
 *   - thumbgate explore lessons [--json]
 *   - thumbgate explore rules [--json]
 *   - thumbgate explore gates [--json]
 *   - thumbgate explore firings [--json]
 *   - --json flag on capture, summary, rules, compact
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const CLI = path.resolve(__dirname, '../bin/cli.js');
const PKG_ROOT = path.resolve(__dirname, '..');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-agent-test-'));
}

function runCliSync(args, options = {}) {
  const { env: optEnv, ...restOptions } = options;
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    killSignal: 'SIGKILL',
    maxBuffer: 10 * 1024 * 1024,
    ...restOptions,
    env: { THUMBGATE_API_URL: 'http://127.0.0.1:1', THUMBGATE_NO_NUDGE: '1', ...process.env, ...optEnv },
  });
}

function setupFeedbackDir(tmpDir) {
  const feedbackDir = path.join(tmpDir, '.thumbgate');
  fs.mkdirSync(feedbackDir, { recursive: true });

  // Write some mock feedback entries
  const feedbackLog = [
    { id: 'fb-001', signal: 'negative', context: 'force-pushed to main', tags: ['git', 'deployment'], timestamp: '2026-04-10T10:00:00.000Z' },
    { id: 'fb-002', signal: 'positive', context: 'tests passed correctly', tags: ['testing'], timestamp: '2026-04-11T10:00:00.000Z' },
    { id: 'fb-003', signal: 'negative', context: 'skipped code review', tags: ['review'], timestamp: '2026-04-12T10:00:00.000Z' },
  ];
  fs.writeFileSync(
    path.join(feedbackDir, 'feedback-log.jsonl'),
    feedbackLog.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  // Write memory log (lessons)
  const memoryLog = [
    { id: 'mem-001', signal: 'negative', content: 'force-push to main overwrites work', tags: ['git'], domain: 'git-workflow', timestamp: '2026-04-10T10:00:00.000Z', sourceFeedbackId: 'fb-001' },
    { id: 'mem-002', signal: 'positive', content: 'TDD approach worked well', tags: ['testing'], domain: 'testing', timestamp: '2026-04-11T10:00:00.000Z', sourceFeedbackId: 'fb-002' },
  ];
  fs.writeFileSync(
    path.join(feedbackDir, 'memory-log.jsonl'),
    memoryLog.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  // Write prevention rules
  fs.writeFileSync(
    path.join(feedbackDir, 'prevention-rules.md'),
    '# Prevention Rules\n\n## Never force-push to main\nForce-pushing overwrites others\' work.\n\n## Always run tests\nTests must pass before committing.\n'
  );

  // Write rejection ledger (gate firings)
  const rejections = [
    { id: 'rej-001', signal: 'negative', context: 'tried to force-push', reason: 'auto-gate: force-push', timestamp: '2026-04-13T10:00:00.000Z' },
  ];
  fs.writeFileSync(
    path.join(feedbackDir, 'rejection-ledger.jsonl'),
    rejections.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  return feedbackDir;
}

describe('agent-first CLI experience', () => {
  let tmpDir;
  let feedbackDir;

  before(() => {
    tmpDir = makeTmpDir();
    feedbackDir = setupFeedbackDir(tmpDir);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // status command
  // -------------------------------------------------------------------------

  test('status exits 0 and shows agent-friendly output', () => {
    const result = runCliSync(['status'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `status failed:\n${result.stderr}`);
    assert.match(result.stdout, /thumbgate status/);
    assert.match(result.stdout, /Enforcement/);
    assert.match(result.stdout, /Lessons/);
    assert.match(result.stdout, /Feedback/);
  });

  test('status --json outputs valid JSON with expected fields', () => {
    const result = runCliSync(['status', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `status --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('version' in data);
    assert.ok('gates' in data);
    assert.ok('lessons' in data);
    assert.ok('feedback' in data);
    assert.ok('enforcementActive' in data);
    assert.ok('lastFeedbackTimestamp' in data);
    assert.equal(typeof data.lessons, 'number');
    assert.equal(typeof data.feedback.total, 'number');
    assert.equal(data.feedback.total, 3);
    assert.equal(data.lessons, 2);
  });

  // -------------------------------------------------------------------------
  // demo command
  // -------------------------------------------------------------------------

  test('demo exits 0 and shows walkthrough', () => {
    const result = runCliSync(['demo'], { cwd: tmpDir });
    assert.equal(result.status, 0, `demo failed:\n${result.stderr}`);
    assert.match(result.stdout, /thumbgate demo/i);
    assert.match(result.stdout, /force/i);
    assert.match(result.stdout, /BLOCKED/i);
  });

  test('demo --json outputs structured steps', () => {
    const result = runCliSync(['demo', '--json'], { cwd: tmpDir });
    assert.equal(result.status, 0, `demo --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.demo, true);
    assert.ok(Array.isArray(data.steps));
    assert.ok(data.steps.length >= 4);
    assert.equal(data.steps[0].event, 'bad_action');
    assert.equal(data.steps[data.steps.length - 1].result, 'BLOCKED');
  });

  // -------------------------------------------------------------------------
  // explore subcommands
  // -------------------------------------------------------------------------

  test('explore lessons --json outputs lesson array', () => {
    const result = runCliSync(['explore', 'lessons', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore lessons --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('lessons' in data);
    assert.ok(Array.isArray(data.lessons));
    assert.equal(data.lessons.length, 2);
    assert.equal(data.scope, 'local');
    assert.ok(data.lessons[0].id);
    assert.ok(data.lessons[0].scope === 'local');
  });

  test('explore lessons (no --json) shows human-readable output with badges', () => {
    const result = runCliSync(['explore', 'lessons'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore lessons failed:\n${result.stderr}`);
    assert.match(result.stdout, /explore lessons/);
  });

  test('explore rules --json outputs rules array', () => {
    const result = runCliSync(['explore', 'rules', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore rules --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('rules' in data);
    assert.ok(Array.isArray(data.rules));
    assert.equal(data.rules.length, 2);
    assert.equal(data.scope, 'local');
  });

  test('explore gates --json outputs gates array', () => {
    const result = runCliSync(['explore', 'gates', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore gates --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('gates' in data);
    assert.ok(Array.isArray(data.gates));
    assert.equal(data.scope, 'local');
  });

  test('explore firings --json outputs firings array', () => {
    const result = runCliSync(['explore', 'firings', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore firings --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('firings' in data);
    assert.ok(Array.isArray(data.firings));
    assert.equal(data.firings.length, 1);
    assert.equal(data.firings[0].result, 'blocked');
  });

  test('explore --json without subcommand defaults to lessons', () => {
    const result = runCliSync(['explore', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('lessons' in data);
  });

  // -------------------------------------------------------------------------
  // --json on existing commands
  // -------------------------------------------------------------------------

  test('stats --json outputs JSON with expected fields', () => {
    const result = runCliSync(['stats', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `stats --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('total' in data);
    assert.ok('approvalRate' in data);
  });

  test('summary --json outputs JSON', () => {
    const result = runCliSync(['summary', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `summary --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('total' in data);
    assert.ok('approvalRate' in data);
  });

  // -------------------------------------------------------------------------
  // cli-status module
  // -------------------------------------------------------------------------

  test('generateAgentStatus returns expected shape', () => {
    const { generateAgentStatus } = require('../scripts/cli-status');
    // Point to mock feedback dir via env
    const savedDir = process.env.THUMBGATE_FEEDBACK_DIR;
    process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
    try {
      const status = generateAgentStatus({ pkgRoot: PKG_ROOT, projectDir: tmpDir });
      assert.equal(typeof status.version, 'string');
      assert.equal(typeof status.lessons, 'number');
      assert.equal(typeof status.feedback.total, 'number');
      assert.equal(typeof status.enforcementActive, 'boolean');
      assert.ok('gates' in status);
      assert.ok('preventionRules' in status);
    } finally {
      if (savedDir !== undefined) process.env.THUMBGATE_FEEDBACK_DIR = savedDir;
      else delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  });

  // -------------------------------------------------------------------------
  // explore-subcommands module
  // -------------------------------------------------------------------------

  test('exploreLessons returns JSON payload', () => {
    const { exploreLessons } = require('../scripts/explore-subcommands');
    const result = exploreLessons({ feedbackDir, json: true, limit: 10 });
    assert.ok(Array.isArray(result.lessons));
    assert.equal(result.scope, 'local');
  });

  test('exploreRules returns JSON payload', () => {
    const { exploreRules } = require('../scripts/explore-subcommands');
    const result = exploreRules({ feedbackDir, json: true });
    assert.ok(Array.isArray(result.rules));
    assert.equal(result.rules.length, 2);
  });

  test('exploreGateFirings returns JSON payload', () => {
    const { exploreGateFirings } = require('../scripts/explore-subcommands');
    const result = exploreGateFirings({ feedbackDir, json: true });
    assert.ok(Array.isArray(result.firings));
    assert.equal(result.firings.length, 1);
  });

  // -------------------------------------------------------------------------
  // cli-demo module
  // -------------------------------------------------------------------------

  test('runDemo returns string for human output', () => {
    const { runDemo } = require('../scripts/cli-demo');
    const result = runDemo({ json: false });
    assert.equal(typeof result, 'string');
    assert.match(result, /BLOCKED/);
    assert.match(result, /force/i);
  });

  test('runDemo returns JSON object for --json', () => {
    const { runDemo } = require('../scripts/cli-demo');
    const result = runDemo({ json: true });
    assert.equal(typeof result, 'object');
    assert.equal(result.demo, true);
    assert.ok(Array.isArray(result.steps));
  });

  // -------------------------------------------------------------------------
  // context signal badges in output
  // -------------------------------------------------------------------------

  test('explore lessons output includes LEARNING badge', () => {
    const { exploreLessons } = require('../scripts/explore-subcommands');
    const result = exploreLessons({ feedbackDir, json: false });
    assert.match(result, /LEARNING/);
  });

  test('explore gates output includes LOCAL badge', () => {
    const { exploreGates } = require('../scripts/explore-subcommands');
    const result = exploreGates({ pkgRoot: PKG_ROOT, json: false });
    assert.match(result, /LOCAL/);
  });

  // -------------------------------------------------------------------------
  // help includes new commands
  // -------------------------------------------------------------------------

  test('help lists status, demo, and explore subcommands', () => {
    const result = runCliSync(['help'], { cwd: tmpDir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /status/);
    assert.match(result.stdout, /demo/);
    assert.match(result.stdout, /explore lessons/);
    assert.match(result.stdout, /explore gates/);
    assert.match(result.stdout, /explore rules/);
  });

  // -------------------------------------------------------------------------
  // cli-schema includes new commands
  // -------------------------------------------------------------------------

  test('cli-schema includes status and demo commands', () => {
    const { findCommand } = require('../scripts/cli-schema');
    const statusCmd = findCommand('status');
    assert.ok(statusCmd, 'status command not in schema');
    assert.ok(statusCmd.flags.some(f => f.name === 'json'), 'status missing --json flag');

    const demoCmd = findCommand('demo');
    assert.ok(demoCmd, 'demo command not in schema');
    assert.ok(demoCmd.flags.some(f => f.name === 'json'), 'demo missing --json flag');
  });

  test('cli-schema explore has --json and --limit flags', () => {
    const { findCommand } = require('../scripts/cli-schema');
    const exploreCmd = findCommand('explore');
    assert.ok(exploreCmd, 'explore command not in schema');
    assert.ok(exploreCmd.flags.some(f => f.name === 'json'), 'explore missing --json flag');
    assert.ok(exploreCmd.flags.some(f => f.name === 'limit'), 'explore missing --limit flag');
  });
});
