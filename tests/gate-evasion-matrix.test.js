'use strict';

// Property test: a command the gates deny must stay denied however it is spelled.
//
// This exists because a hand-picked sample twice gave a false sense of closure. Reasoning
// from regex shape missed that four gates anchor with a bare `^` and were therefore skipped
// for any chained command. Measuring the full corpus x transform grid found 62 evasion holes
// on unmodified origin/main; this test asserts the grid stays empty.
//
// Add a row when a new command class becomes gated, and a column when a new way of spelling
// a command turns up. A hole here is a bypass, not a style issue.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { evaluateGatesAsync } = require('../scripts/gates-engine.js');

// Representative commands spanning the block-action gate surface.
const CORPUS = [
  'rm -rf ~',
  'rm -rf /',
  'rm -rf $HOME',
  'git reset --hard HEAD~5',
  'git clean -fd',
  'git push --force origin main',
  'git add .',
  'git commit -m x',
  'git tag v9.9.9',
  'git push origin main',
  'npm publish',
  'gh release create v9.9.9',
  'gh pr create --title x',
  'gh pr merge 1',
];

// Ways the same command can be spelled without changing what it does.
const TRANSFORMS = [
  ['sudo', (c) => `sudo ${c}`],
  ['env assignment prefix', (c) => `env FOO=1 ${c}`],
  ['chained with &&', (c) => `echo hi && ${c}`],
  ['chained with ;', (c) => `echo hi; ${c}`],
  ['on a new line', (c) => `echo hi\n${c}`],
  ['absolute binary path', (c) => c.replace(/^(\w+)/, '/usr/bin/$1')],
  ['quoted binary', (c) => c.replace(/^(\w+)/, '"$1"')],
  ['backslash-escaped', (c) => `\\${c}`],
  ['git global option', (c) => (c.startsWith('git ') ? c.replace(/^git /, 'git -C . ') : null)],
];

let repo;
test.before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-evasion-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt']);
  git(['commit', '-m', 'init']);
  fs.writeFileSync(path.join(repo, 'app.js'), 'code\n');
});

async function denies(command) {
  const verdict = await evaluateGatesAsync('Bash', { command, cwd: repo });
  return Boolean(verdict && verdict.decision === 'deny');
}

test('no command in the corpus is evadable by re-spelling', async () => {
  const holes = [];
  let covered = 0;

  for (const command of CORPUS) {
    // Only meaningful for commands the gates actually catch in plain form.
    if (!(await denies(command))) continue;
    covered += 1;

    for (const [label, transform] of TRANSFORMS) {
      const variant = transform(command);
      if (!variant) continue;
      if (!(await denies(variant))) {
        holes.push(`${label}: ${JSON.stringify(command)} -> ${JSON.stringify(variant)}`);
      }
    }
  }

  assert.ok(covered >= 10, `expected the corpus to exercise the gates; only ${covered} denied plainly`);
  assert.deepEqual(holes, [], `evasion holes found:\n  ${holes.join('\n  ')}`);
});

// The other direction. Widening what counts as "command position" must not start denying
// ordinary work, and in particular must not treat a command NAMED inside a string as run.
const MUST_NOT_DENY = [
  'ls -la',
  'npm test',
  'cat README.md',
  'git status',
  'git diff',
  'git log --oneline -5',
  'echo hi && ls',
  'echo "git reset --hard is dangerous"',
  'echo "git commit -m x"',
  'grep -r "git clean -fd" docs/',
  'grep -r "rm -rf ~" docs/',
  'rm -rf node_modules',
  'rm -rf build/',
  'sudo rm -rf /tmp/scratch-dir',
  'sudo ls /var/log',
];

test('re-spelling coverage does not deny ordinary work', async () => {
  const denied = [];
  for (const command of MUST_NOT_DENY) {
    if (await denies(command)) denied.push(command);
  }
  assert.deepEqual(denied, [], `benign commands denied:\n  ${denied.join('\n  ')}`);
});
