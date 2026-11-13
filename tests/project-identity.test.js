'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const identity = require('../scripts/project-identity');

test('same remote across clones, credentials and transports; owners remain distinct', () => {
  const a = identity.projectFromRemote('git@github.com:Owner/Example.git');
  assert.equal(a.projectKey, identity.projectFromRemote('https://secret:password@GITHUB.com/owner/example.git?token=x#ref').projectKey);
  assert.notEqual(a.projectKey, identity.projectFromRemote('https://github.com/other/example').projectKey);
  assert.equal(a.projectName, 'owner/example');
  assert.notEqual(identity.projectFromRemote('ssh://host:2222/Case/Repo').projectKey, identity.projectFromRemote('ssh://host/Case/Repo').projectKey);
  assert.notEqual(identity.projectFromRemote('https://host/Case/Repo').projectKey, identity.projectFromRemote('https://host/case/repo').projectKey);
});
test('nested cwd and worktrees resolve repository, remote changes take effect', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  run(['init']); run(['remote', 'add', 'origin', 'https://github.com/owner/example.git']);
  fs.mkdirSync(path.join(root, 'nested'));
  const a = identity.resolveLocalProject(root);
  assert.equal(a.projectKey, identity.resolveLocalProject(path.join(root, 'nested')).projectKey);
  run(['remote', 'set-url', 'origin', 'https://github.com/other/example.git']);
  assert.notEqual(a.projectKey, identity.resolveLocalProject(root).projectKey);
  run(['remote', 'remove', 'origin']);
  assert.notEqual(identity.resolveLocalProject(root, { machineId: 'a' }).projectKey, identity.resolveLocalProject(root, { machineId: 'b' }).projectKey);
});
test('pure historical attribution never trusts cwd or merges ambiguous legacy aliases', () => {
  assert.equal(identity.projectForRecord({ cwd: process.cwd() }).projectKey, 'unassigned');
  const a = identity.projectFromRemote('https://github.com/a/repo');
  const b = identity.projectFromRemote('https://github.com/b/repo');
  const records = [{ ...a, scope: { projectId: 'repo' } }, { ...b, scope: { projectId: 'repo' } }];
  const aliases = identity.buildAliases(records);
  assert.match(identity.projectForRecord({ scope: { projectId: 'repo' } }, { aliases }).projectKey, /^legacy_/);
  assert.equal(identity.projectForRecord({ scope: { projectId: 'repo' } }, { aliases: identity.buildAliases(records.slice(0, 1)) }).projectKey, a.projectKey);
});
test('selection validation rejects ambiguity and hosted capture never reads cwd', () => {
  const a = identity.projectFromRemote('https://github.com/a/repo');
  assert.equal(identity.parseProjectSelection(new URLSearchParams('project=' + a.projectKey)), a.projectKey);
  for (const query of ['project=', 'project=../x', 'project=all&project=all']) assert.throws(() => identity.parseProjectSelection(new URLSearchParams(query)), { statusCode: 400 });
  assert.throws(() => identity.parseProjectSelection(new URLSearchParams('project=all'), { 'x-thumbgate-project': a.projectKey }), { statusCode: 400 });
  assert.equal(identity.projectForCapture({ cwd: '/not/a/real/client/path' }, { hosted: true }).projectKey, 'unassigned');
  assert.equal(identity.projectForCapture({ ...a, cwd: '/not/a/real/client/path' }, { hosted: true }).projectKey, a.projectKey);
});
test('real independent repositories and a linked worktree have identical remote identity', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-clones-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'first'); const b = path.join(root, 'second'); const worktree = path.join(root, 'linked');
  const run = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
  for (const cwd of [a, b]) { fs.mkdirSync(cwd); run(cwd, ['init']); run(cwd, ['remote', 'add', 'origin', 'https://github.com/owner/shared.git']); }
  run(a, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
  run(a, ['worktree', 'add', '-b', 'fixture-linked', worktree]);
  const descriptor = identity.resolveLocalProject(a);
  assert.equal(identity.resolveLocalProject(b).projectKey, descriptor.projectKey);
  assert.equal(identity.resolveLocalProject(worktree).projectKey, descriptor.projectKey);
});
