'use strict';

// Cover for the enforcement provenance check.
//
// The check exists because a guard installed from a CLOSED, unmerged pull
// request enforced globally for two days undetected. The first version of the
// check missed it: the hook command wrapped its path in double quotes and the
// extractor only matched whitespace-delimited paths. A provenance check with a
// blind spot over the exact case it was written for is worse than none, so the
// quoting forms are pinned here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  scriptPathsFrom,
  collectHooks,
  resolvePath,
  trackedOnDefaultBranch,
} = require('../scripts/enforcement-provenance-check.js');

test('script paths are extracted regardless of quoting', () => {
  const cases = [
    ['node /opt/a/guard.js', '/opt/a/guard.js'],
    ['node "/opt/a/guard.js"', '/opt/a/guard.js'],
    ["node '/opt/a/guard.js'", '/opt/a/guard.js'],
    ['bash scripts/verify.sh', 'scripts/verify.sh'],
    ['env FLAG=1 node "/opt/a/guard.js"', '/opt/a/guard.js'],
    ['node ~/.runtime/bin/guard.js', '~/.runtime/bin/guard.js'],
  ];
  for (const [command, expected] of cases) {
    assert.ok(
      scriptPathsFrom(command).includes(expected),
      `failed to extract ${expected} from: ${command}`,
    );
  }
});

test('a command with no script reference yields nothing', () => {
  assert.deepEqual(scriptPathsFrom('echo hello'), []);
  assert.deepEqual(scriptPathsFrom(''), []);
  assert.deepEqual(scriptPathsFrom(undefined), []);
});

test('hooks are collected across every event with matcher and command', () => {
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node "/x/g.js"' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'bash s/t.sh' }] }],
    },
  };
  const found = collectHooks(settings);
  assert.equal(found.length, 2);
  assert.equal(found[0].event, 'PreToolUse');
  assert.equal(found[0].matcher, '.*');
  assert.equal(found[1].matcher, '(any)');
});

test('malformed settings do not throw', () => {
  assert.deepEqual(collectHooks(null), []);
  assert.deepEqual(collectHooks({}), []);
  assert.deepEqual(collectHooks({ hooks: { PreToolUse: [] } }), []);
});

test('a path outside the repository is never considered reviewed', () => {
  const outside = path.join(os.tmpdir(), 'definitely-outside-the-repo.js');
  assert.equal(
    trackedOnDefaultBranch(process.cwd(), outside, 'origin/main'),
    false,
    'files outside the repository cannot be on the default branch',
  );
});

test('a file tracked on the default branch is considered reviewed', () => {
  const tracked = path.join(process.cwd(), 'package.json');
  assert.ok(fs.existsSync(tracked));
  assert.equal(trackedOnDefaultBranch(process.cwd(), tracked, 'origin/main'), true);
});

test('home-relative paths resolve against the home directory', () => {
  assert.equal(resolvePath('~/a/b.js', '/repo'), path.join(os.homedir(), 'a/b.js'));
  assert.equal(resolvePath('s/t.js', '/repo'), path.join('/repo', 's/t.js'));
  assert.equal(resolvePath('/abs/t.js', '/repo'), '/abs/t.js');
});
