'use strict';

// AGENT-3667, 25 Nov 2026: a command that deletes the same target as an already-learned and denied delete command,
// written as a Python one-liner or script instead of the shell command, is denied too. Synthetic paths only: nothing
// here creates, reads or deletes a real file (the gate only reads the command text), and no command is ever run.
//
// Covered: literal targets in python -c / heredoc / Write of a .py file calling shutil.rmtree, os.remove, os.unlink,
// os.rmdir, Path.unlink, Path.rmdir, send2trash-free subprocess/os.system rm. NOT covered (see the last test):
// targets computed at run time, scripts the gate cannot read, and other languages.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TARGET = '/tmp/tg-synth-reword/scratch-data';
const OTHER = '/tmp/tg-synth-reword/other-data';
const LEARNED = `rm -rf ${TARGET}`;

const ENV_KEYS = [
  'HOME', 'USERPROFILE', 'THUMBGATE_FEEDBACK_DIR', 'THUMBGATE_STATE_DIR', 'THUMBGATE_API_KEY', 'THUMBGATE_DEV_BYPASS',
  'THUMBGATE_NO_RATE_LIMIT', 'THUMBGATE_NO_TRIAL', 'THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE',
  'THUMBGATE_GATES_CONFIG', 'CI', 'GITHUB_ACTIONS',
];

function withLearnedDelete(fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-reword-'));
  const home = path.join(root, 'home');
  const feedbackDir = path.join(root, 'feedback');
  fs.mkdirSync(home);
  fs.mkdirSync(feedbackDir);
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    HOME: home, USERPROFILE: home, THUMBGATE_FEEDBACK_DIR: feedbackDir, THUMBGATE_STATE_DIR: feedbackDir,
    THUMBGATE_NO_TRIAL: '1', THUMBGATE_STRICT_ENFORCEMENT: '1',
  });
  for (const mod of ['../scripts/rate-limiter', '../scripts/auto-promote-gates', '../scripts/gates-engine']) {
    delete require.cache[require.resolve(mod)];
  }
  try {
    const promote = require('../scripts/auto-promote-gates');
    const ge = require('../scripts/gates-engine');
    ge.STATS_PATH = path.join(feedbackDir, 'gate-stats.json');
    promote.forcePromote(LEARNED, 'block', { feedbackDir });
    return fn({ ge, root, decide: (toolName, input) => { const r = ge.evaluateGates(toolName, input); return (r && r.decision) || 'allow'; } });
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const REWRITES = [
  ['shutil.rmtree in python -c', `python3 -c "import shutil; shutil.rmtree('${TARGET}')"`],
  ['os.remove in python -c', `python -c 'import os; os.remove("${TARGET}")'`],
  ['os.unlink in a heredoc script', `python3 - <<'PY'\nimport os\nos.unlink("${TARGET}")\nPY`],
  ['pathlib rmdir', `python3 -c "from pathlib import Path; Path('${TARGET}').rmdir()"`],
  ['subprocess rm -rf with an argument list', `python3 -c "import subprocess; subprocess.run(['rm', '-rf', '${TARGET}'])"`],
  ['os.remove with shell-escaped double quotes', `python3 -c "import os; os.remove(\\"${TARGET}\\")"`],
];

const HARMLESS = [
  ['ls', `ls ${TARGET}`],
  ['git status', 'git status'],
  ['print', 'python3 -c "print(1)"'],
  ['read the learned target', `python3 -c "print(open('${TARGET}/notes.txt').read())"`],
  ['list the learned target', `python3 -c "import os; print(os.listdir('${TARGET}'))"`],
  ['copy the learned target', `python3 -c "import shutil; shutil.copytree('${TARGET}', '${OTHER}')"`],
  ['rmtree of a different path', `python3 -c "import shutil; shutil.rmtree('${OTHER}')"`],
  ['os.remove of a different path', `python3 -c "import os; os.remove('${OTHER}/a.txt')"`],
  ['rm of a different path', `rm -rf ${OTHER}`],
  ['path that only shares a prefix', `python3 -c "import shutil; shutil.rmtree('${TARGET}-backup')"`],
  ['python test run', 'python3 -m pytest -q tests/'],
  ['pip install', 'pip install requests'],
  ['node version', 'node --version'],
  ['mkdir of the target', `mkdir -p ${TARGET}`],
  ['echo mentioning a delete', 'echo "remember to call shutil.rmtree later"'],
  ['npm test', 'npm test'],
  ['rm argument list that is only printed', `python3 -c "print(['rm', '-rf', '${TARGET}'])"`],
  ['literal joined with a suffix at run time', `python3 -c "import shutil; shutil.rmtree('${TARGET}' + '-backup')"`],
];

test('REQ-01: the learned shell delete itself is denied (setup check)', () => {
  withLearnedDelete(({ decide }) => {
    assert.equal(decide('Bash', { command: LEARNED }), 'deny');
  });
});

for (const [name, command] of REWRITES) {
  test(`REQ-01: rewrite denied: ${name}`, () => {
    withLearnedDelete(({ decide }) => {
      assert.equal(decide('Bash', { command }), 'deny');
    });
  });
}

test('REQ-01: rewrite denied: a .py file written with the delete', () => {
  withLearnedDelete(({ decide }) => {
    const content = `import shutil\nshutil.rmtree("${TARGET}")\n`;
    assert.equal(decide('Write', { file_path: '/tmp/tg-synth-reword/cleanup.py', content }), 'deny');
  });
});

test('REQ-02: all 18 harmless controls stay allowed', () => {
  assert.equal(HARMLESS.length, 18);
  withLearnedDelete(({ decide }) => {
    for (const [name, command] of HARMLESS) {
      const decision = decide('Bash', { command });
      assert.notEqual(decision, 'deny', `${name}: ${command}`);
    }
    assert.notEqual(decide('Write', { file_path: '/tmp/tg-synth-reword/notes.py', content: `print(open("${TARGET}/a").read())\n` }), 'deny');
  });
});

test('REQ-03: what is not covered stays allowed, so the claim stays narrow', () => {
  withLearnedDelete(({ decide }) => {
    const computed = `python3 -c "import shutil; shutil.rmtree('/tmp/tg-synth-reword' + '/scratch-data')"`;
    assert.equal(decide('Bash', { command: computed }), 'allow', 'a path built at run time is NOT covered');
  });
});
