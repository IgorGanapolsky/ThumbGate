'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const {
  evaluateHerdrRoutingGate,
  isInsideDirectory,
  isBashReadOnly,
  resolveProtectedRepos,
} = require('../scripts/herdr-routing-gate');
const { runAsync } = require('../scripts/gates-engine');

const HOME = os.homedir();
const THUMBGATE_DIR = path.join(HOME, 'workspace', 'ThumbGate');
const DAYGLASS_DIR = path.join(HOME, 'workspace', 'dayglass');
const UNRELATED_DIR = path.join(HOME, 'workspace', 'other-repo');

test('Herdr routing gate: outside session editing ThumbGate is denied', async () => {
  const result = evaluateHerdrRoutingGate({
    cwd: UNRELATED_DIR,
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(THUMBGATE_DIR, 'scripts', 'gates-engine.js'),
    },
  });

  assert.ok(result, 'Expected gate to deny outside edit');
  assert.strictEqual(result.decision, 'deny');
  assert.strictEqual(result.gate, 'herdr-routing-gate');
  assert.strictEqual(
    result.message,
    'This repo is worked by its herdr agent. Use skill herdr-delegate: herdr --session thumbgate agent prompt <pane> ...'
  );
});

test('Herdr routing gate: outside session editing dayglass is denied', async () => {
  const result = evaluateHerdrRoutingGate({
    cwd: UNRELATED_DIR,
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(DAYGLASS_DIR, 'package.json'),
    },
  });

  assert.ok(result, 'Expected gate to deny outside write to dayglass');
  assert.strictEqual(result.decision, 'deny');
  assert.strictEqual(result.gate, 'herdr-routing-gate');
  assert.strictEqual(
    result.message,
    'This repo is worked by its herdr agent. Use skill herdr-delegate: herdr --session dayglass agent prompt <pane> ...'
  );
});

test('Herdr routing gate: outside session reading ThumbGate is allowed', async () => {
  const result = evaluateHerdrRoutingGate({
    cwd: UNRELATED_DIR,
    tool_name: 'Read',
    tool_input: {
      file_path: path.join(THUMBGATE_DIR, 'package.json'),
    },
  });

  assert.strictEqual(result, null, 'Reads should be allowed');
});

test('Herdr routing gate: outside session running read-only bash (git status, cat, grep) is allowed', async () => {
  const commands = [
    `git -C ${THUMBGATE_DIR} status`,
    `git -C ${DAYGLASS_DIR} log -n 5`,
    `cat ${path.join(THUMBGATE_DIR, 'package.json')}`,
    `grep "foo" ${path.join(DAYGLASS_DIR, 'index.js')}`,
    `ls -la ${THUMBGATE_DIR}`,
  ];

  for (const cmd of commands) {
    const result = evaluateHerdrRoutingGate({
      cwd: UNRELATED_DIR,
      tool_name: 'Bash',
      tool_input: { command: cmd },
    });
    assert.strictEqual(result, null, `Command '${cmd}' should be allowed`);
  }
});

test('Herdr routing gate: inside session editing is allowed', async () => {
  const resultInsideThumbGate = evaluateHerdrRoutingGate({
    cwd: THUMBGATE_DIR,
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(THUMBGATE_DIR, 'package.json'),
    },
  });
  assert.strictEqual(resultInsideThumbGate, null, 'Inside session editing ThumbGate should be allowed');

  const resultInsideDayglass = evaluateHerdrRoutingGate({
    cwd: DAYGLASS_DIR,
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(DAYGLASS_DIR, 'src', 'index.js'),
    },
  });
  assert.strictEqual(resultInsideDayglass, null, 'Inside session editing dayglass should be allowed');
});

test('Herdr routing gate: outside session editing unrelated repo is allowed', async () => {
  const result = evaluateHerdrRoutingGate({
    cwd: UNRELATED_DIR,
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(UNRELATED_DIR, 'src', 'app.js'),
    },
  });
  assert.strictEqual(result, null, 'Editing unrelated repo should be allowed');
});

test('Herdr routing gate: symlink and ../ path traversal tricks are denied', async () => {
  // Using relative .. from unrelated repo pointing into ThumbGate
  const dotDotPath = path.join(UNRELATED_DIR, '..', 'ThumbGate', 'package.json');
  const resultDotDot = evaluateHerdrRoutingGate({
    cwd: UNRELATED_DIR,
    tool_name: 'Edit',
    tool_input: {
      file_path: dotDotPath,
    },
  });

  assert.ok(resultDotDot, 'Traversal with ../ should be detected and denied');
  assert.strictEqual(resultDotDot.decision, 'deny');
  assert.strictEqual(resultDotDot.gate, 'herdr-routing-gate');
  assert.strictEqual(
    resultDotDot.message,
    'This repo is worked by its herdr agent. Use skill herdr-delegate: herdr --session thumbgate agent prompt <pane> ...'
  );

  // Tilde path expansion
  const tildePath = '~/workspace/ThumbGate/test-file.js';
  const resultTilde = evaluateHerdrRoutingGate({
    cwd: UNRELATED_DIR,
    tool_name: 'Write',
    tool_input: {
      file_path: tildePath,
    },
  });
  assert.ok(resultTilde, 'Tilde path should be detected and denied');
  assert.strictEqual(resultTilde.decision, 'deny');
  assert.strictEqual(resultTilde.gate, 'herdr-routing-gate');
});

test('Herdr routing gate: file-changing Bash command outside repo is denied', async () => {
  const mutatingCommands = [
    `echo "foo" > ${path.join(THUMBGATE_DIR, 'bad.txt')}`,
    `echo "foo" >> ~/workspace/dayglass/bad.txt`,
    `rm ${path.join(THUMBGATE_DIR, 'temp.txt')}`,
    `touch ~/workspace/dayglass/newfile.js`,
    `git -C ${THUMBGATE_DIR} commit -m "bad"`,
    `cd ~/workspace/ThumbGate && npm install`,
  ];

  for (const cmd of mutatingCommands) {
    const result = evaluateHerdrRoutingGate({
      cwd: UNRELATED_DIR,
      tool_name: 'Bash',
      tool_input: { command: cmd },
    });
    assert.ok(result, `Mutating command '${cmd}' should be denied`);
    assert.strictEqual(result.decision, 'deny');
    assert.strictEqual(result.gate, 'herdr-routing-gate');
  }
});

test('Herdr routing gate: integrated through gates-engine runAsync produces expected PreToolUse deny payload', async () => {
  const output = await runAsync({
    cwd: UNRELATED_DIR,
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(THUMBGATE_DIR, 'src', 'index.js'),
    },
  });

  const parsed = typeof output === 'string' ? JSON.parse(output) : output;
  assert.ok(parsed.hookSpecificOutput, 'Must contain hookSpecificOutput');
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(
    parsed.hookSpecificOutput.permissionDecisionReason,
    '[GATE:herdr-routing-gate] This repo is worked by its herdr agent. Use skill herdr-delegate: herdr --session thumbgate agent prompt <pane> ...'
  );
});
