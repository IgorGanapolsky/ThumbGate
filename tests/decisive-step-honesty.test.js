'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  findDecisiveStep,
  buildDecisiveStepHonestyReport,
  formatDecisiveStepHonestyReport,
} = require('../scripts/decisive-step-honesty');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'decisive-step-honesty.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

function ids(report) {
  return report.findings.map((item) => item.id);
}

test('map-only is ready and lists the decisive-step rails', () => {
  const report = buildDecisiveStepHonestyReport({ mapOnly: true });
  assert.equal(report.status, 'ready');
  assert.equal(report.ok, true);
  assert.equal(report.name, 'thumbgate-decisive-step-honesty');
  assert.equal(report.decisiveStep, null);
  assert.deepEqual(report.recommendedGates, ['score-decisive-edit-only']);
  assert.ok(report.map.length >= 5);
  assert.equal(report.source, 'https://arxiv.org/abs/2610.10478');
});

test('a passing edit after a failing edit is the decisive step and cleanup is ignored', () => {
  const cleanup = { tool: 'Edit', verifier: 'pass', action_id: 'cleanup' };
  const found = findDecisiveStep([
    { tool: 'Edit', verifier: 'fail', action_id: 'fail' },
    { tool: 'Edit', verifier: 'pass', action_id: 'tstar' },
    cleanup,
  ]);
  assert.equal(found.step.action_id, 'tstar');
  assert.equal(found.index, 1);
  assert.equal(found.certifiedAt, 1);
  assert.equal(found.prefixCount, 1);
});

test('a later test command certifies the previous post-fail edit', () => {
  const found = findDecisiveStep([
    { tool: 'Edit', verifier: 'fail', action_id: 'fail' },
    { tool: 'Edit', action_id: 'edit2' },
    { tool: 'Bash', tests: 'pass', action_id: 'retest' },
  ]);
  assert.equal(found.step.action_id, 'edit2');
  assert.equal(found.index, 1);
  assert.equal(found.certifiedAt, 2);
  assert.equal(found.prefixCount, 1);
});

test('a pass with no prior fail returns null immediately', () => {
  const found = findDecisiveStep([
    { tool: 'Edit', verifier: 'pass', action_id: 'early' },
    { tool: 'Edit', verifier: 'fail' },
    { tool: 'Edit', verifier: 'pass', action_id: 'later' },
  ]);
  assert.equal(found, null);
});

test('an edit before any fail is not a candidate', () => {
  const found = findDecisiveStep([
    { tool: 'Edit', action_id: 'early' },
    { tool: 'Bash', verifier: 'fail' },
    { tool: 'Bash', verifier: 'pass' },
  ]);
  assert.equal(found, null);
});

test('a failing edit clears the candidate', () => {
  const found = findDecisiveStep([
    { tool: 'Bash', verifier: 'fail' },
    { tool: 'Edit', action_id: 'cand' },
    { tool: 'Edit', verifier: 'fail' },
    { tool: 'Bash', verifier: 'pass' },
  ]);
  assert.equal(found, null);
});

test('a later test fail clears the candidate', () => {
  const found = findDecisiveStep([
    { tool: 'Bash', verifier: 'fail' },
    { tool: 'Edit', action_id: 'cand' },
    { tool: 'Bash', verifier: 'fail' },
    { tool: 'Bash', verifier: 'pass' },
  ]);
  assert.equal(found, null);
});

test('a pass with no candidate returns null immediately', () => {
  const found = findDecisiveStep([
    { tool: 'Bash', verifier: 'fail' },
    { tool: 'Bash', verifier: 'pass' },
    { tool: 'Edit', verifier: 'pass', action_id: 'too-late' },
  ]);
  assert.equal(found, null);
});

test('a null verifier does not fall through to tests', () => {
  const found = findDecisiveStep([
    { tool: 'Edit', verifier: 'fail' },
    { tool: 'Edit', verifier: null, tests: 'pass', action_id: 'hidden' },
  ]);
  assert.equal(found, null);
});

test('object and boolean verdicts certify the edit', () => {
  const objects = findDecisiveStep([
    { tool: 'Edit', verifier: { status: 'fail' } },
    { tool: 'Edit', verifier: { passed: true }, action_id: 'obj' },
  ]);
  assert.equal(objects.step.action_id, 'obj');
  const flags = findDecisiveStep([
    { tool: 'Edit', tests: false },
    { tool: 'Edit', tests: true, action_id: 'bool' },
  ]);
  assert.equal(flags.step.action_id, 'bool');
  assert.equal(flags.prefixCount, 1);
});

test('kind bash does not hide tool_name Edit', () => {
  const found = findDecisiveStep([
    { tool_name: 'Bash', verifier: 'fail' },
    { kind: 'bash', tool_name: 'Edit', verifier: 'pass', action_id: 'hidden-edit' },
  ]);
  assert.equal(found.step.action_id, 'hidden-edit');
  assert.equal(found.certifiedAt, 1);
});

test('empty string and numeric verifier are present but not a verdict', () => {
  assert.equal(findDecisiveStep([
    { tool: 'Edit', verifier: 'fail' },
    { tool: 'Edit', verifier: '', tests: 'pass', action_id: 'blank' },
  ]), null);
  assert.equal(findDecisiveStep([
    { tool: 'Edit', verifier: 'fail' },
    { tool: 'Edit', verifier: 1, tests: 'pass', action_id: 'num' },
  ]), null);
});

test('non-array input returns null', () => {
  assert.equal(findDecisiveStep(null), null);
  assert.equal(findDecisiveStep({ steps: [] }), null);
});

test('all-step scoring, coding-quiz ranking, borrowed correlation, and nvidia training fail closed', () => {
  const claims = [
    ['score every step of the run', 'all_step_score'],
    ['average all steps', 'all_step_score'],
    ['all-step ranking', 'all_step_score'],
    ['Rank agents by HumanEval', 'coding_quiz_rank'],
    ['MBPP is our agent ranking', 'coding_quiz_rank'],
    ['simple coding test as the agent ranking', 'coding_quiz_rank'],
    ['HumanEval as the agent ranking', 'coding_quiz_rank'],
    ['our 0.964', 'borrowed_correlation'],
    ['we measured 0.964', 'borrowed_correlation'],
    ['0.964 is our', 'borrowed_correlation'],
    ['install nvidia weights', 'nvidia_train'],
    ['nemo-aligner', 'nvidia_train'],
    ['openrlhf', 'nvidia_train'],
    ['train the base model', 'nvidia_train'],
  ];
  for (const [claim, id] of claims) {
    const report = buildDecisiveStepHonestyReport({ claim, mapOnly: true });
    assert.equal(report.status, 'fail', claim);
    assert.ok(ids(report).includes(id), `${claim} -> ${ids(report).join(',')}`);
    for (const item of report.findings) {
      assert.equal(item.message.includes('0.964'), false, item.id);
    }
  }
});

test('a paper citation, a bare quiz name, and NVIDIA/UC Berkeley stay ready', () => {
  const claims = [
    'https://arxiv.org/abs/2610.10478',
    'HumanEval',
    'the paper reports 0.964',
    'the paper reports 0.964 and our doctor cites it',
    'NVIDIA/UC Berkeley',
  ];
  for (const claim of claims) {
    const report = buildDecisiveStepHonestyReport({ claim });
    assert.equal(report.status, 'ready', `${claim} ${JSON.stringify(report.findings)}`);
  }
});

test('missing, invalid, and wrong-shape traces are unreadable', () => {
  const missing = buildDecisiveStepHonestyReport({ trace: path.join(os.tmpdir(), 'missing-decisive-trace.json') });
  assert.ok(ids(missing).includes('trace_unreadable'));
  assert.equal(missing.decisiveStep, null);

  const invalid = buildDecisiveStepHonestyReport({ trace: '{not json' });
  assert.ok(ids(invalid).includes('trace_unreadable'));

  const shape = buildDecisiveStepHonestyReport({ trace: JSON.stringify({ foo: 1 }) });
  assert.ok(ids(shape).includes('trace_unreadable'));
  assert.equal(shape.decisiveStep, null);

  const bareSteps = buildDecisiveStepHonestyReport({ steps: true });
  assert.ok(ids(bareSteps).includes('trace_unreadable'));
  assert.equal(bareSteps.decisiveStep, null);
});

test('a readable trace attaches the decisive step', () => {
  const steps = [
    { tool: 'Edit', verifier: 'fail' },
    { tool: 'Edit', verifier: 'pass', action_id: 'tstar' },
  ];
  const inline = buildDecisiveStepHonestyReport({ trace: JSON.stringify(steps) });
  assert.equal(inline.status, 'ready');
  assert.equal(inline.decisiveStep.step.action_id, 'tstar');

  const wrapped = buildDecisiveStepHonestyReport({ trace: JSON.stringify({ actions: steps }) });
  assert.equal(wrapped.decisiveStep.index, 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decisive-trace-'));
  const file = path.join(dir, 'trace.json');
  fs.writeFileSync(file, JSON.stringify({ steps }));
  const fromFile = buildDecisiveStepHonestyReport({ trace: file });
  assert.equal(fromFile.decisiveStep.prefixCount, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('format text does not quote the paper correlation', () => {
  const ready = formatDecisiveStepHonestyReport(buildDecisiveStepHonestyReport({ mapOnly: true }));
  const failed = formatDecisiveStepHonestyReport(buildDecisiveStepHonestyReport({ claim: 'our 0.964' }));
  assert.match(ready, /Decisive-Step Honesty Doctor/);
  assert.match(ready, /Does not train a model/);
  for (const text of [ready, failed]) {
    assert.equal(text.includes('0.964'), false);
    assert.equal(text.includes('ρ'), false);
  }
});

test('CLI --help exits 0', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /does not train/i);
});

test('CLI --json --map-only exits 0', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--map-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.name, 'thumbgate-decisive-step-honesty');
  assert.equal(report.status, 'ready');
  assert.equal(report.decisiveStep, null);
});

test('CLI borrowed claim exits 1', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--claim=our 0.964'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.findings.some((item) => item.id === 'borrowed_correlation'));
});

test('bin/cli.js decisive-step-honesty is wired', () => {
  const result = spawnSync(process.execPath, [CLI, 'decisive-step-honesty', '--json', '--map-only'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
});

test('skill names the compare-not-clone contract', () => {
  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.agents', 'skills', 'decisive-step-honesty-not-clone', 'SKILL.md'),
    'utf8'
  );
  for (const heading of ['## Goal', '## Constraints', '## Reference', '## Examples', '## Procedures', '## Rubric']) {
    assert.ok(skill.includes(heading), `missing ${heading}`);
  }
  assert.match(skill, /Weak:/);
  assert.match(skill, /Gold:/);
  assert.match(skill, /Do NOT/);
  assert.match(skill, /arxiv\.org\/abs\/2610\.10478/);
  assert.equal(skill.includes('0.964'), false);
  assert.equal(skill.includes('ρ'), false);
});
