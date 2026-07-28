'use strict';

// Tests for the trace miner that produces the drift benchmark.
//
// This script decides which real production commands become regression cases, and it writes
// them to a file that ships in a PUBLIC repo. Two things therefore have to hold, and neither
// is cosmetic: redaction must actually redact (the corpus is mined from a real machine), and
// a case must be replayable (mining the wrong log once produced 7 cases with empty commands,
// a benchmark that passes vacuously while looking like coverage).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { redact, commandShape, mine, readEvents } = require('../scripts/mine-eval-set.js');

test('redact removes slash-form home paths', () => {
  assert.strictEqual(redact('/Users/igorganapolsky/workspace/x'), '/Users/redacted/workspace/x');
  assert.strictEqual(redact('/home/someone/thing'), '/home/redacted/thing');
});

test('redact removes DASH-encoded home paths', () => {
  // The form Claude tooling uses for project directories. The slash patterns miss it entirely,
  // which is how a mined set that looked clean still carried the username.
  assert.strictEqual(
    redact('-Users-igorganapolsky-workspace-git'),
    '-Users-redacted-workspace-git',
  );
  assert.doesNotMatch(redact('/tmp/-Users-igorganapolsky-foo'), /igorganapolsky/);
});

test('redact removes credentials and emails', () => {
  for (const token of ['ghp_abcdefgh12345678', 'sk-abcdefgh12345678', 'npm_abcdefgh12345678']) {
    assert.doesNotMatch(redact(`export TOKEN=${token}`), /abcdefgh/, `leaked: ${token}`);
  }
  assert.strictEqual(redact('mail me at person@example.com'), 'mail me at redacted@example.com');
});

test('redact normalizes ports so localhost variation does not fragment shapes', () => {
  assert.strictEqual(redact('curl http://localhost:8642/health'), 'curl http://localhost:PORT/health');
});

test('redact is total: null and undefined do not throw', () => {
  assert.strictEqual(redact(null), '');
  assert.strictEqual(redact(undefined), '');
});

test('commandShape groups by the first four tokens', () => {
  assert.strictEqual(commandShape('git commit -m "some long message here"'), 'git commit -m "some');
  assert.strictEqual(
    commandShape('git   add    file.txt'),
    'git add file.txt',
    'runs of whitespace should collapse',
  );
  // Same shape for different file names: the benchmark should not be 300 copies of one command.
  assert.strictEqual(commandShape('rm -rf /tmp/a'), commandShape('rm -rf /tmp/a'));
});

test('commandShape redacts before grouping', () => {
  assert.doesNotMatch(commandShape('cat /Users/igorganapolsky/secret'), /igorganapolsky/);
});

test('mine deduplicates by shape and counts observations', () => {
  const events = [
    // Shapes are the first FOUR tokens, so these two collapse while a different 4th token
    // would not — that granularity is the point of the grouping.
    { toolName: 'Bash', toolInput: { command: 'git push origin main' }, gateId: 'g1', decision: 'deny' },
    { toolName: 'Bash', toolInput: { command: 'git push origin main --force' }, gateId: 'g1', decision: 'deny' },
    { toolName: 'Bash', toolInput: { command: 'npm test' }, gateId: 'g2', decision: 'none' },
  ];
  const cases = mine(events);
  assert.strictEqual(cases.length, 2, 'the two git pushes share a 4-token shape and should collapse');
  const gitCase = cases.find((entry) => entry.command.startsWith('git push'));
  assert.strictEqual(gitCase.observed, 2);
  assert.deepEqual(gitCase.expect, { gateId: 'g1', decision: 'deny' });
  assert.strictEqual(gitCase.source, 'production-trace');

  // The complement: a different fourth token is a different shape and must NOT collapse.
  const distinct = mine([
    { toolName: 'Bash', toolInput: { command: 'git push origin main' }, gateId: 'g1', decision: 'deny' },
    { toolName: 'Bash', toolInput: { command: 'git push origin other' }, gateId: 'g1', decision: 'deny' },
  ]);
  assert.strictEqual(distinct.length, 2, 'distinct fourth tokens must stay distinct shapes');
});

test('mine sorts most-observed first', () => {
  const events = [
    { toolName: 'Bash', toolInput: { command: 'rare command here' }, gateId: 'g1', decision: 'deny' },
    ...Array.from({ length: 5 }, () => (
      { toolName: 'Bash', toolInput: { command: 'common command here' }, gateId: 'g2', decision: 'warn' }
    )),
  ];
  const cases = mine(events);
  assert.strictEqual(cases[0].observed, 5, 'recurring production commands must come first');
});

test('mine drops cases that cannot be replayed', () => {
  const events = [
    { toolName: 'Bash', toolInput: {}, gateId: 'g1', decision: 'deny' },          // no command
    { toolName: 'Bash', gateId: 'g1', decision: 'deny' },                          // no input at all
    { toolName: 'Read', toolInput: { command: 'x y z' }, gateId: 'g1', decision: 'deny' }, // not replayable
    { toolName: 'Bash', toolInput: { command: 'ok command' }, decision: 'deny' },  // no gateId
    { toolName: 'Bash', toolInput: { command: 'ok command' }, gateId: 'g1' },      // no decision
  ];
  assert.deepEqual(mine(events), [], 'unreplayable events must be dropped, not padded into the set');
});

test('mine accepts the alternate tool_name spelling', () => {
  const cases = mine([
    { tool_name: 'Bash', toolInput: { command: 'echo hi' }, gateId: 'g1', decision: 'none' },
  ]);
  assert.strictEqual(cases.length, 1);
});

test('readEvents distinguishes a missing source from an empty one', () => {
  assert.strictEqual(readEvents(path.join(os.tmpdir(), 'definitely-absent-trace.jsonl')), null,
    'a missing file must be distinguishable from a file with no usable events');
});

test('readEvents survives corrupt lines without losing the rest of the corpus', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mine-')), 'trace.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ toolName: 'Bash', toolInput: { command: 'a b c' }, gateId: 'g', decision: 'deny' }),
    '{ this is not json',
    '',
    JSON.stringify({ toolName: 'Bash', toolInput: { command: 'd e f' }, gateId: 'g', decision: 'none' }),
  ].join('\n'));

  const events = readEvents(file);
  assert.strictEqual(events.length, 2, 'one bad line should not discard the whole trace');
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('a mined case carries everything needed to replay and check it', () => {
  const [entry] = mine([
    { toolName: 'Bash', toolInput: { command: 'sudo rm -rf /' }, gateId: 'catastrophic', decision: 'deny' },
  ]);
  assert.ok(entry.command, 'no command to replay');
  assert.ok(entry.toolName, 'no tool to replay it with');
  assert.ok(entry.expect.gateId && entry.expect.decision, 'no expectation to check against');
});
