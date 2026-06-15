'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '../bin/cli.js');
const {
  buildContextPack,
  checkNeverDo,
  cleanupReport,
  ensureBrain,
  recordMemory,
} = require('../scripts/brain');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-brain-'));
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: {
      ...process.env,
      THUMBGATE_NO_NUDGE: '1',
      THUMBGATE_NO_TELEMETRY: '1',
      THUMBGATE_API_URL: 'http://127.0.0.1:1',
    },
  });
}

test('ensureBrain scaffolds soul, memory, router, and never-do gates', () => {
  const tmp = makeTmpDir();
  try {
    const result = ensureBrain(tmp);
    assert.equal(result.ok, true);
    assert.ok(fs.existsSync(path.join(tmp, '.thumbgate/brain/soul/company-profile.md')));
    assert.ok(fs.existsSync(path.join(tmp, '.thumbgate/brain/soul/audience.md')));
    assert.ok(fs.existsSync(path.join(tmp, '.thumbgate/brain/soul/keyword-map.md')));
    assert.ok(fs.existsSync(path.join(tmp, '.thumbgate/brain/soul/never-do.md')));
    assert.ok(fs.existsSync(path.join(tmp, '.thumbgate/brain/memory/decisions')));
    assert.ok(fs.existsSync(path.join(tmp, '.thumbgate/brain/memory/patterns/tool-failures.md')));
    assert.ok(fs.existsSync(path.join(tmp, '.thumbgate/brain/router.md')));
    assert.ok(fs.existsSync(path.join(tmp, '.thumbgate/brain/never-do-gates.json')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('context pack routes files by task type instead of loading everything', () => {
  const tmp = makeTmpDir();
  try {
    ensureBrain(tmp);
    const marketing = buildContextPack(tmp, { task: 'write SEO content brief' });
    assert.ok(marketing.files.includes('.thumbgate/brain/soul/style-guide.md'));
    assert.ok(marketing.files.includes('.thumbgate/brain/soul/audience.md'));
    assert.ok(marketing.files.includes('.thumbgate/brain/soul/keyword-map.md'));
    assert.ok(!marketing.files.includes('.thumbgate/brain/memory/patterns/tool-failures.md'));

    const engineering = buildContextPack(tmp, { task: 'debug CI tool failure' });
    assert.ok(engineering.files.includes('.thumbgate/brain/memory/patterns/engineering.md'));
    assert.ok(engineering.files.includes('.thumbgate/brain/memory/patterns/tool-failures.md'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('recordMemory requires provenance and cleanup reports unsourced memory', () => {
  const tmp = makeTmpDir();
  try {
    ensureBrain(tmp);
    const rejected = recordMemory(tmp, { title: 'No source' });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /requires --source/);

    const stored = recordMemory(tmp, {
      type: 'decision',
      title: 'Do not claim publish before npm verification',
      content: 'Require npm and CI evidence before saying a release is published.',
      source: 'User correction in Codex session, 2026-06-01',
      tags: 'release,proof',
    });
    assert.equal(stored.ok, true);
    assert.ok(fs.existsSync(path.join(tmp, stored.path)));

    fs.writeFileSync(path.join(tmp, '.thumbgate/brain/memory/log/unsourced.md'), '# Unsourced\n\nMissing provenance.\n');
    const report = cleanupReport(tmp);
    assert.ok(report.unsourced.includes('.thumbgate/brain/memory/log/unsourced.md'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('never-do check blocks matching rejected patterns', () => {
  const tmp = makeTmpDir();
  try {
    ensureBrain(tmp);
    const result = checkNeverDo(tmp, {
      text: 'I will claim a release without command or URL evidence.',
    });
    assert.equal(result.decision, 'block');
    assert.ok(result.blocked.length >= 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI exposes brain command and JSON workflows', () => {
  const tmp = makeTmpDir();
  try {
    const init = runCli(['brain', 'init', '--json'], tmp);
    assert.equal(init.status, 0, init.stderr);
    const initPayload = JSON.parse(init.stdout);
    assert.equal(initPayload.ok, true);
    assert.ok(initPayload.gateCount >= 1);

    const remember = runCli([
      'brain',
      'remember',
      '--type=feedback',
      '--title=Capture thumbs down with provenance',
      '--source=tests/brain.test.js',
      '--json',
    ], tmp);
    assert.equal(remember.status, 0, remember.stderr);
    assert.equal(JSON.parse(remember.stdout).ok, true);

    const context = runCli(['brain', 'context', '--task=debug CI failure', '--json'], tmp);
    assert.equal(context.status, 0, context.stderr);
    assert.ok(JSON.parse(context.stdout).files.includes('.thumbgate/brain/memory/patterns/tool-failures.md'));

    const blocked = runCli([
      'brain',
      'check',
      '--text=I will claim a release without command or URL evidence',
      '--json',
    ], tmp);
    assert.equal(blocked.status, 2);
    assert.equal(JSON.parse(blocked.stdout).decision, 'block');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
