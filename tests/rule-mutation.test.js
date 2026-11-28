'use strict';

// Able-to-fail testing for learned rules (scripts/rule-mutation.js). Synthetic paths only: no command is run and no
// file outside the throwaway feedback dir is touched; the gate only reads command text.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENV_KEYS = [
  'HOME', 'USERPROFILE', 'THUMBGATE_FEEDBACK_DIR', 'THUMBGATE_STATE_DIR', 'THUMBGATE_API_KEY', 'THUMBGATE_DEV_BYPASS',
  'THUMBGATE_NO_RATE_LIMIT', 'THUMBGATE_NO_TRIAL', 'THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE',
  'THUMBGATE_GATES_CONFIG', 'THUMBGATE_INTENT_GATES', 'THUMBGATE_RULE_MUTATION', 'CI', 'GITHUB_ACTIONS',
];

function withLearned(command, env, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mutation-'));
  const home = path.join(root, 'home');
  const feedbackDir = path.join(root, 'feedback');
  fs.mkdirSync(home);
  fs.mkdirSync(feedbackDir);
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    HOME: home, USERPROFILE: home, THUMBGATE_FEEDBACK_DIR: feedbackDir, THUMBGATE_STATE_DIR: feedbackDir,
    THUMBGATE_NO_TRIAL: '1', THUMBGATE_STRICT_ENFORCEMENT: '1', ...env,
  });
  for (const mod of ['../scripts/rate-limiter', '../scripts/auto-promote-gates', '../scripts/gates-engine', '../scripts/rule-mutation']) {
    delete require.cache[require.resolve(mod)];
  }
  try {
    const promote = require('../scripts/auto-promote-gates');
    const ge = require('../scripts/gates-engine');
    ge.STATS_PATH = path.join(feedbackDir, 'gate-stats.json');
    const result = promote.forcePromote(command, 'block', { feedbackDir });
    // Decision of the learned gate only: built-in gates (find-delete-broad, task-scope-required) decide other calls too.
    const decide = (input) => {
      const r = ge.evaluateGates('Bash', input);
      return r && r.gate === result.gateId ? r.decision : 'not-learned-gate';
    };
    return fn({ result, decide });
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const TARGET = '/tmp/tg-synth-mutation/scratch-data';

test('a learned delete records its intent and how many reworded variants it catches', () => {
  withLearned(`rm -rf ${TARGET}`, {}, ({ result }) => {
    const audit = result.mutationAudit;
    assert.ok(audit, 'mutation audit recorded on the gate');
    assert.ok(audit.caughtBefore < audit.variants, 'learned text alone misses some rewordings');
    assert.equal(audit.caughtAfter, audit.variants, 'with the intent every variant is caught');
    assert.deepEqual(audit.missed, []);
    assert.equal(audit.intentMode, 'warn');
  });
});

test('reworded deletes warn by default (law 12) and the learned text still blocks', () => {
  withLearned(`rm -rf ${TARGET}`, {}, ({ decide }) => {
    assert.equal(decide({ command: `rm -rf ${TARGET}` }), 'deny');
    for (const command of [`rm -fr ${TARGET}`, `rm -r -f "${TARGET}"`, `node -e "require('fs').rmSync('${TARGET}',{recursive:true})"`, `rsync -a --delete /tmp/empty/ ${TARGET}`]) {
      assert.equal(decide({ command }), 'warn', command);
    }
  });
});

test('THUMBGATE_INTENT_GATES=enforce blocks the reworded deletes', () => {
  withLearned(`rm -rf ${TARGET}`, { THUMBGATE_INTENT_GATES: 'enforce' }, ({ decide }) => {
    for (const command of [`rm -r -f ${TARGET}`, `rm --recursive --force "${TARGET}"`, `python3 -c "import os; os.rmdir('${TARGET}')"`]) {
      assert.equal(decide({ command }), 'deny', command);
    }
  });
});

test('other paths and read-only commands are left alone', () => {
  withLearned(`rm -rf ${TARGET}`, { THUMBGATE_INTENT_GATES: 'enforce' }, ({ decide }) => {
    for (const command of [`rm -fr ${TARGET}-other`, `ls ${TARGET}`, `find ${TARGET} -name '*.log'`, `cat ${TARGET}/notes.txt`]) {
      assert.equal(decide({ command }), 'not-learned-gate', command);
    }
  });
});

test('a learned force-push catches -f, --force-with-lease and +refspec for the same branch only', () => {
  // Built-in force-push gates answer first in evaluateGates, so test the learned gate's own match.
  withLearned('git push --force origin release-x', {}, ({ result }) => {
    assert.equal(result.mutationAudit.caughtAfter, result.mutationAudit.variants);
    const m = require('../scripts/rule-mutation');
    const gate = { intent: m.intentFor('git push --force origin release-x') };
    for (const command of ['git push -f origin release-x', 'git push --force-with-lease origin release-x', 'git push origin +release-x', 'git push origin +HEAD:release-x']) {
      assert.equal(m.intentMatches(gate, 'Bash', { command }), true, command);
    }
    for (const command of ['git push origin release-x', 'git push -f origin other-branch', 'git status']) {
      assert.equal(m.intentMatches(gate, 'Bash', { command }), false, command);
    }
  });
});

test('intentFor and variantsFor describe the action, not the spelling', () => {
  const m = require('../scripts/rule-mutation');
  assert.deepEqual(m.intentFor('rm -rf ./build-cache'), { kind: 'delete-path', targets: ['build-cache'] });
  assert.deepEqual(m.intentFor('git push origin +main'), { kind: 'force-push', branches: ['main'] });
  assert.equal(m.intentFor('npm publish --tag latest').kind, 'command-words');
  assert.equal(m.intentFor('ls'), null);
  assert.ok(m.variantsFor('rm -rf ./x').some(([label]) => label === 'python shutil.rmtree'));
});

test('a computed Node path is not the learned path, and variants use the real target', () => {
  const m = require('../scripts/rule-mutation');
  const gate = { intent: m.intentFor('rm -rf /tmp/data') };
  assert.equal(m.intentMatches(gate, 'Bash', { command: `node -e "require('fs').rmSync('/tmp/data' + '-backup', {recursive:true})"` }), false);
  assert.equal(m.intentMatches(gate, 'Bash', { command: `node -e "require('fs').rmSync('/tmp/data', {recursive:true})"` }), true);
  const fromPython = m.variantsFor(`python3 -c "import shutil; shutil.rmtree('/tmp/data')"`);
  assert.ok(fromPython.length > 0 && fromPython.every(([, cmd]) => cmd.includes('/tmp/data') && !cmd.includes('"import')), 'python learned command');
  const afterCd = m.variantsFor('cd /tmp && rm -rf /tmp/data');
  assert.ok(afterCd.every(([, cmd]) => cmd.includes('/tmp/data')), 'cd-prefixed learned command');
});

test('THUMBGATE_RULE_MUTATION=0 turns the refinement off', () => {
  withLearned(`rm -rf ${TARGET}`, { THUMBGATE_RULE_MUTATION: '0' }, ({ result, decide }) => {
    assert.equal(result.mutationAudit, undefined);
    assert.equal(decide({ command: `rm -fr ${TARGET}` }), 'not-learned-gate');
  });
});
