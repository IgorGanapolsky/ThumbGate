'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  EXIT_BLOCK,
  advertisedBase,
  classifyPush,
  diagnoseRepo,
  serveFetch,
} = require('../scripts/pando-one-branch');

test('one named branch is allowed', () => {
  assert.deepEqual(classifyPush(['-u', 'origin', 'HEAD']), { decision: 'allow', rule: 'one-branch' });
  assert.deepEqual(classifyPush(['origin']), { decision: 'allow', rule: 'one-branch' });
  assert.deepEqual(classifyPush([], 'simple'), { decision: 'allow', rule: 'one-branch' });
  assert.deepEqual(classifyPush([], 'current'), { decision: 'allow', rule: 'one-branch' });
  assert.deepEqual(
    classifyPush(['origin', 'HEAD:refs/heads/my-branch']),
    { decision: 'allow', rule: 'one-branch' },
  );
});

test('a push of every ref is blocked', () => {
  assert.deepEqual(classifyPush(['--all']), { decision: 'block', rule: 'every-ref' });
  assert.deepEqual(classifyPush(['--mirror', 'origin']), { decision: 'block', rule: 'every-ref' });
  assert.deepEqual(classifyPush(['--tags']), { decision: 'block', rule: 'every-ref' });
  assert.deepEqual(classifyPush(['origin', 'main', 'feature']), { decision: 'block', rule: 'many-refs' });
  assert.deepEqual(
    classifyPush(['origin', 'refs/heads/*:refs/heads/*']),
    { decision: 'block', rule: 'wildcard' },
  );
  assert.deepEqual(classifyPush([], 'matching'), { decision: 'block', rule: 'matching' });
  assert.deepEqual(classifyPush([], ''), { decision: 'block', rule: 'push-default-unknown' });
});

test('the check command exits 77 and does not push', () => {
  const argvAll = ['check', '--default', 'simple', '--', 'git', 'push', '--all'];
  const first = spawnSync(process.execPath, [path.join(__dirname, '../scripts/pando-one-branch.js'), ...argvAll], {
    encoding: 'utf8',
  });
  assert.equal(first.status, EXIT_BLOCK);
  assert.match(first.stdout, /decision=block rule=every-ref/);
  const second = spawnSync(process.execPath, [
    path.join(__dirname, '../scripts/pando-one-branch.js'),
    'check', '--', 'git', 'push', '-u', 'origin', 'HEAD',
  ], { encoding: 'utf8' });
  assert.equal(second.status, 0);
  assert.match(second.stdout, /decision=allow rule=one-branch/);
});

test('only the trunk ref is advertised as a base', () => {
  const refs = [
    'aaa refs/heads/feature',
    'bbb refs/heads/main',
    'ccc refs/tags/v1',
  ];
  assert.deepEqual(advertisedBase(refs, 'main'), ['bbb refs/heads/main']);
});

test('a fetch is served from stored packs and a fresh pack is refused', () => {
  const served = serveFetch({
    trunk: 'main',
    haves: ['base'],
    stored: [
      { id: 'base', bytes: 10, base: 'main' },
      { id: 'next', bytes: 4, base: 'main' },
      { id: 'side', bytes: 9, base: 'other' },
    ],
  });
  assert.equal(served.decision, 'allow');
  assert.equal(served.generatedPacks, 0);
  assert.deepEqual(served.served.map((pack) => pack.id), ['next']);
  assert.equal(served.servedBytes, 4);
  const built = serveFetch({ build: true, stored: [{ id: 'next', bytes: 4, base: 'main' }] });
  assert.equal(built.decision, 'block');
  assert.equal(built.rule, 'no-fresh-pack');
  assert.equal(built.generatedPacks, 0);
});

test('the script does not repeat the article figures', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/pando-one-branch.js'), 'utf8');
  assert.equal(source.includes('petabyte'), false);
  assert.equal(source.includes('nearly 5'), false);
  assert.equal(source.includes('5x'), false);
});

test('diagnose counts local refs and does not push', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pando-one-'));
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(git(['init', '-q', '-b', 'main']).status, 0);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(root, 'note.txt'), 'one\n');
  assert.equal(git(['add', 'note.txt']).status, 0);
  assert.equal(git(['commit', '-q', '-m', 'one']).status, 0);
  assert.equal(git(['branch', 'other']).status, 0);
  const report = diagnoseRepo(root);
  assert.equal(report.ok, true);
  assert.ok(report.refs >= 2);
  assert.ok(report.showRefBytes > 0);
  assert.equal(report.pushed, false);
  assert.equal(report.pushDefault, 'simple');
  assert.equal(report.advertised.length, 1);
  assert.match(report.advertised[0], / refs\/heads\/main$/);
  const remotes = git(['remote']);
  assert.equal(remotes.stdout.trim(), '');
  fs.rmSync(root, { recursive: true, force: true });
});
