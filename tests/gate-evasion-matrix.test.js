'use strict';

// Property test: a command the gates deny must stay denied however it is spelled.
//
// This exists because hand-picked samples twice gave a false sense of closure, and because
// the first version of this very file passed locally and failed in CI — it depended on
// whatever governance state happened to be in ~/.thumbgate. Everything here is sandboxed so
// the result is a property of the ENGINE, not of the machine.
//
// Add a row when a new command class becomes gated, and a column when a new way of spelling
// a command turns up. A hole here is a bypass, not a style issue.

const test = require('node:test');
const { beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const gatesEngine = require('../scripts/gates-engine.js');
const { evaluateGatesAsync } = gatesEngine;

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

const ORIGINAL_PATHS = {
  STATE_PATH: gatesEngine.STATE_PATH,
  STATS_PATH: gatesEngine.STATS_PATH,
  CONSTRAINTS_PATH: gatesEngine.CONSTRAINTS_PATH,
  SESSION_ACTIONS_PATH: gatesEngine.SESSION_ACTIONS_PATH,
  GOVERNANCE_STATE_PATH: gatesEngine.GOVERNANCE_STATE_PATH,
};
const ORIGINAL_ENV = {
  THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
  THUMBGATE_FEEDBACK_LOG: process.env.THUMBGATE_FEEDBACK_LOG,
  THUMBGATE_ATTRIBUTED_FEEDBACK: process.env.THUMBGATE_ATTRIBUTED_FEEDBACK,
};

let repo;
let sandbox;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-evasion-state-'));
  gatesEngine.STATE_PATH = path.join(sandbox, 'gate-state.json');
  gatesEngine.STATS_PATH = path.join(sandbox, 'gate-stats.json');
  gatesEngine.CONSTRAINTS_PATH = path.join(sandbox, 'session-constraints.json');
  gatesEngine.SESSION_ACTIONS_PATH = path.join(sandbox, 'session-actions.json');
  gatesEngine.GOVERNANCE_STATE_PATH = path.join(sandbox, 'governance-state.json');
  process.env.THUMBGATE_FEEDBACK_DIR = path.join(sandbox, 'feedback-runtime');
  process.env.THUMBGATE_FEEDBACK_LOG = path.join(sandbox, 'feedback-log.jsonl');
  process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = path.join(sandbox, 'attributed-feedback.jsonl');
  fs.mkdirSync(process.env.THUMBGATE_FEEDBACK_DIR, { recursive: true });
  fs.writeFileSync(process.env.THUMBGATE_FEEDBACK_LOG, '');
  fs.writeFileSync(process.env.THUMBGATE_ATTRIBUTED_FEEDBACK, '');

  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-evasion-repo-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt']);
  git(['commit', '-m', 'init']);
  // Dirty + STAGED content, so the file-driven gates (task scope, protected files) have
  // something to evaluate. Without a staged file `git commit` is legitimately ungated and
  // the matrix would silently test nothing.
  //
  // beforeEach, not before: workflow-sentinel accumulates risk across a session, so after the
  // matrix has run ~100 destructive commands it (correctly) starts denying anything at all —
  // including `ls -la`. Each test gets clean state so it measures the engine, not the
  // leftovers of the previous test.
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'protected\n');
  fs.writeFileSync(path.join(repo, 'app.js'), 'code\n');
  git(['add', 'app.js']);
});

afterEach(() => {
  Object.assign(gatesEngine, ORIGINAL_PATHS);
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

async function denies(command) {
  const verdict = await evaluateGatesAsync('Bash', { command, cwd: repo });
  return Boolean(verdict && verdict.decision === 'deny');
}

test('no command in the corpus is evadable by re-spelling', async () => {
  const holes = [];
  let covered = 0;

  for (const command of CORPUS) {
    // Only meaningful for commands the gates actually catch in plain form. A command that
    // is legitimately ungated here (nothing staged, no remote, …) proves nothing either way.
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

  // Guards against the matrix quietly becoming vacuous if gate config changes.
  assert.ok(covered >= 5, `expected the corpus to exercise the gates; only ${covered} denied plainly`);
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
