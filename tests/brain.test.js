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

test('CLI exposes dream and triage commands', () => {
  const tmp = makeTmpDir();
  try {
    const init = runCli(['brain', 'init', '--json'], tmp);
    assert.equal(init.status, 0);

    const dream = runCli(['dream', '--json'], tmp);
    assert.equal(dream.status, 0, dream.stderr);
    const dreamPayload = JSON.parse(dream.stdout);
    assert.equal(dreamPayload.success, true);

    const triage = runCli(['triage', '--json'], tmp);
    assert.equal(triage.status, 0, triage.stderr);
    const triagePayload = JSON.parse(triage.stdout);
    assert.equal(triagePayload.success, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cmdBrain auto-wires CLAUDE.md and AGENTS.md if they exist', () => {
  const tmp = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# Original CLAUDE\n\nSome instructions.\n');
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# Original AGENTS\n\nSome agent conventions.\n');

    const result = runCli(['brain', '--write'], tmp);
    assert.equal(result.status, 0, result.stderr);

    const claudeContent = fs.readFileSync(path.join(tmp, 'CLAUDE.md'), 'utf8');
    const agentsContent = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf8');

    assert.ok(claudeContent.includes('<!-- ThumbGate -->'));
    assert.ok(claudeContent.includes('Read .thumbgate/BRAIN.md first'));
    assert.ok(claudeContent.includes('# Original CLAUDE'));

    assert.ok(agentsContent.includes('<!-- ThumbGate -->'));
    assert.ok(agentsContent.includes('Read .thumbgate/BRAIN.md first'));
    assert.ok(agentsContent.includes('# Original AGENTS'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI exposes community query command', () => {
  const tmp = makeTmpDir();
  try {
    const result = runCli(['community', 'query', 'npm', '--json'], tmp);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.query, 'npm');
    assert.ok(payload.resultsCount >= 1);
    assert.equal(payload.results[0].id, 'comm_001');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI exposes community share command', () => {
  const tmp = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmp, 'auto-promoted-gates.json'), JSON.stringify({
      gates: [
        {
          id: 'synth_123',
          pattern: 'git push --force',
          action: 'block',
          message: 'NEVER force push directly to main'
        }
      ]
    }));

    const result = runCli(['community', 'share', 'synth_123', '--json'], tmp);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.shared, true);
    assert.equal(payload.payload.ruleId, 'synth_123');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
