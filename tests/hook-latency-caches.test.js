'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

// gates-engine destructures execFileSync when it loads, so the spy goes in before the first require.
const spawned = [];
const originalExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = function spy(binary, ...rest) {
  spawned.push(binary);
  return originalExecFileSync.call(this, binary, ...rest);
};
const { resolveRepoRoot, computeExecutableHash } = require('../scripts/gates-engine');
childProcess.execFileSync = originalExecFileSync;

function countSpawns(binary, fn) {
  const before = spawned.filter((b) => b === binary).length;
  fn();
  return spawned.filter((b) => b === binary).length - before;
}

test('resolveRepoRoot spawns git once per directory and notices a new repository', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-root-cache-')));
  const nested = path.join(dir, 'pkg');
  fs.mkdirSync(nested);
  childProcess.execFileSync('git', ['init', '-q'], { cwd: dir });
  assert.equal(countSpawns('git', () => assert.equal(resolveRepoRoot({ cwd: nested }), dir)), 1, 'first lookup asks git');
  const spawns = countSpawns('git', () => {
    for (let i = 0; i < 10; i += 1) assert.equal(resolveRepoRoot({ cwd: nested }), dir);
  });
  assert.equal(spawns, 0, 'repeat lookups must come from the cache');

  // A nested repository changes the answer; the stamp must catch it.
  childProcess.execFileSync('git', ['init', '-q'], { cwd: nested });
  assert.equal(resolveRepoRoot({ cwd: nested }), nested);
});

test('computeExecutableHash finds commands on PATH without spawning which', () => {
  let hash;
  assert.equal(countSpawns('which', () => { hash = computeExecutableHash('node --version'); }), 0);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(computeExecutableHash('__nonexistent_binary_xyz_123__'), null);
});

test('interventionPolicyStale retrains when the model is missing or old, not on every event', () => {
  const { interventionPolicyStale } = require('../scripts/audit-trail');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-policy-stale-'));
  assert.equal(interventionPolicyStale(dir), true, 'missing model trains right away');
  const model = path.join(dir, 'intervention-policy.json');
  fs.writeFileSync(model, '{}');
  assert.equal(interventionPolicyStale(dir), false, 'fresh model is reused');
  assert.equal(interventionPolicyStale(dir, Date.now() + 6 * 60 * 1000), true, 'old model retrains');
  const saved = process.env.THUMBGATE_POLICY_RETRAIN_MS;
  process.env.THUMBGATE_POLICY_RETRAIN_MS = '0';
  try {
    assert.equal(interventionPolicyStale(dir), true, '0 restores retrain-on-every-event');
  } finally {
    if (saved === undefined) delete process.env.THUMBGATE_POLICY_RETRAIN_MS; else process.env.THUMBGATE_POLICY_RETRAIN_MS = saved;
  }
});

test('project identity is reused from the disk cache by a new process', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-identity-home-'));
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-identity-repo-')));
  childProcess.execFileSync('git', ['init', '-q'], { cwd: repo });
  childProcess.execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/identity-cache.git'], { cwd: repo });
  const script = `
    const cp = require('node:child_process');
    const orig = cp.execFileSync; let n = 0;
    cp.execFileSync = function (b, ...r) { if (b === 'git') n += 1; return orig.call(this, b, ...r); };
    const { resolveLocalProject } = require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'project-identity'))});
    const id = resolveLocalProject(${JSON.stringify(repo)}, { machineId: 'test' });
    process.stdout.write(JSON.stringify({ n, key: id.projectKey }));
  `;
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const first = JSON.parse(childProcess.execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }));
  const second = JSON.parse(childProcess.execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }));
  assert.ok(first.n > 0);
  assert.equal(second.n, 0, 'second process must not spawn git');
  assert.equal(second.key, first.key);

  // Changing the remote changes the stamp, so the cache is not served.
  childProcess.execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/example/other.git'], { cwd: repo });
  const third = JSON.parse(childProcess.execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }));
  assert.ok(third.n > 0);
  assert.notEqual(third.key, first.key);
});
