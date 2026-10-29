'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMablFailureHonesty } = require('../scripts/mabl-failure-honesty');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mabl-honesty-'));
process.env.THUMBGATE_STATE_DIR = stateDir;
process.env.THUMBGATE_NO_NUDGE = '1';

const gates = require('../scripts/gates-engine');

function edit(file, oldText, newText, toolName = 'Edit') {
  return {
    toolName,
    toolInput: { file_path: file, old_string: oldText, new_string: newText },
  };
}

function bash(command) {
  return { toolName: 'Bash', toolInput: { command }, command };
}

test('removing an assertion from a test file is denied', () => {
  const result = evaluateMablFailureHonesty(edit(
    'tests/pay.test.js',
    'assert.equal(total, 149);',
    'const total = 149;',
  ));
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'mabl-failure-honesty');
  assert.equal(result.severity, 'critical');
  assert.equal(result.failureReason, 'assertion_removed');
  assert.match(result.message, /fewer assertions/);
});

test('replacing an assertion with another assertion is allowed', () => {
  const result = evaluateMablFailureHonesty(edit(
    'tests/pay.test.js',
    'assert.equal(total, 149);',
    'expect(total).toBe(149);',
  ));
  assert.equal(result, null);
});

test('moving an assertion into a comment is denied', () => {
  const result = evaluateMablFailureHonesty(edit(
    'tests/pay.test.js',
    'assert.equal(total, 149);',
    '// assert.equal(total, 149);',
  ));
  assert.equal(result.failureReason, 'assertion_removed');
});

test('deleting an assertion that was already a comment is allowed', () => {
  const result = evaluateMablFailureHonesty(edit(
    'tests/pay.test.js',
    '// assert.equal(total, 149);',
    '',
  ));
  assert.equal(result, null);
});

test('adding it.skip, test.skip, describe.skip, or xit is denied', () => {
  for (const skipped of ['it.skip(', 'test.skip(', 'describe.skip(', 'xit(']) {
    const result = evaluateMablFailureHonesty(edit(
      'tests/pay.test.js',
      "it('charges', () => { assert.equal(1, 1); });",
      `${skipped}'charges', () => { assert.equal(1, 1); });`,
    ));
    assert.equal(result && result.failureReason, 'assertion_skipped', skipped);
  }
});

test('a skipped test that exists only inside a comment is allowed', () => {
  const result = evaluateMablFailureHonesty(edit(
    'tests/pay.test.js',
    'assert.equal(1, 1);',
    'assert.equal(1, 1);\n// it.skip("later")',
  ));
  assert.equal(result, null);
});

test('an edit outside a test file is allowed', () => {
  const result = evaluateMablFailureHonesty(edit(
    'scripts/pay.js',
    'assert.equal(total, 149);',
    'const total = 149;',
  ));
  assert.equal(result, null);
});

test('search_replace and one MultiEdit hunk that drops an assertion are denied', () => {
  const replaced = evaluateMablFailureHonesty(edit(
    'tests/pay.test.js',
    'expect(paid).toBe(true);',
    'const paid = true;',
    'search_replace',
  ));
  assert.equal(replaced.failureReason, 'assertion_removed');

  const multi = evaluateMablFailureHonesty({
    toolName: 'MultiEdit',
    toolInput: {
      file_path: 'tests/pay.test.js',
      edits: [
        { old_string: 'const name = "pro";', new_string: 'const name = "Pro";' },
        { old_string: 'assert.equal(1, 1);', new_string: 'const ok = true;' },
      ],
    },
  });
  assert.equal(multi.failureReason, 'assertion_removed');
});

test('npm test, node --test, and pytest forced green are denied', () => {
  for (const command of [
    'npm test || true',
    'npm run test || /bin/true',
    'node --test tests/pay.test.js || exit 0',
    'pytest -q || :',
  ]) {
    const result = evaluateMablFailureHonesty(bash(command));
    assert.equal(result && result.failureReason, 'forced_green', command);
  }
});

test('a test command without a forced-green suffix is allowed', () => {
  assert.equal(evaluateMablFailureHonesty(bash('npm test')), null);
  assert.equal(evaluateMablFailureHonesty(bash('node --test tests/pay.test.js')), null);
  assert.equal(evaluateMablFailureHonesty(bash('pytest -q')), null);
});

test('a loop that reloads the test suite is allowed', () => {
  assert.equal(
    evaluateMablFailureHonesty(bash('for i in 1 2; do npm test; done')),
    null,
  );
});

test('a loop around publish, login, checkout, reset, or clean is denied', () => {
  const commands = [
    'for i in 1 2; do git push origin feature; done',
    'until gh pr merge 12; do sleep 1; done',
    'while az repos pr update --id 12 --is-draft false; do sleep 1; done',
    'for attempt in 1 2; do gh auth login; done',
    'retry git checkout -- public/index.html',
    'for i in 1 2; do git reset --hard; done',
    'for i in 1 2; do git clean -fd; done',
  ];
  for (const command of commands) {
    const result = evaluateMablFailureHonesty(bash(command));
    assert.equal(result && result.failureReason, 'retry_changes_meaning', command);
    assert.equal(result.gate, 'mabl-failure-honesty');
  }
});

test('one git push, including the words "wait for ci", is allowed', () => {
  assert.equal(evaluateMablFailureHonesty(bash('git push origin feature')), null);
  assert.equal(
    evaluateMablFailureHonesty(bash('echo wait for ci && git push origin feature')),
    null,
  );
});

test('a shell comment that mentions git push does not make a test loop a retry', () => {
  assert.equal(
    evaluateMablFailureHonesty(bash('for i in 1 2; do npm test; done # git push')),
    null,
  );
});

test('the repeated-mistake hard floor denies the weakened assertion', () => {
  const input = {
    tool_name: 'Edit',
    tool_input: {
      file_path: 'tests/pay.test.js',
      old_string: 'assert.equal(1, 1);',
      new_string: 'const ok = true;',
    },
  };
  const direct = gates.evaluateRepeatedMistakeGates(input);
  assert.equal(direct.decision, 'deny');
  assert.equal(direct.gate, 'mabl-failure-honesty');
  assert.equal(direct.failureReason, 'assertion_removed');

  const body = JSON.parse(gates.runHardFloor(input));
  assert.equal(body.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:mabl-failure-honesty\]/);
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /fewer assertions/);
});
