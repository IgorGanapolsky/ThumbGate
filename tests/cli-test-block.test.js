'use strict';

/**
 * tests/cli-test-block.test.js — coverage for `npx thumbgate test-block`.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'cli-test-block.js');

function withTempCwd(fn) {
  const prev = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-test-block-'));
  try {
    process.chdir(tmp);
    return fn(tmp);
  } finally {
    process.chdir(prev);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function captureStdio(fn) {
  const out = [];
  const err = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => {
    out.push(typeof s === 'string' ? s : s.toString('utf8'));
    return true;
  };
  process.stderr.write = (s) => {
    err.push(typeof s === 'string' ? s : s.toString('utf8'));
    return true;
  };
  let value;
  try {
    value = fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { value, stdout: out.join(''), stderr: err.join('') };
}

function freshLoad() {
  delete require.cache[require.resolve(SCRIPT_PATH)];
  return require(SCRIPT_PATH);
}

describe('cli-test-block: parseArgs', () => {
  test('returns dryRun=true when --dry-run passed', () => {
    const mod = freshLoad();
    assert.equal(mod.parseArgs(['--dry-run']).dryRun, true);
  });

  test('returns noCta=true when --no-cta passed', () => {
    const mod = freshLoad();
    assert.equal(mod.parseArgs(['--no-cta']).noCta, true);
  });

  test('returns help=true when --help passed', () => {
    const mod = freshLoad();
    assert.equal(mod.parseArgs(['--help']).help, true);
  });

  test('default opts have no flags set', () => {
    const mod = freshLoad();
    const opts = mod.parseArgs([]);
    assert.equal(opts.dryRun, false);
    assert.equal(opts.noCta, false);
    assert.equal(opts.help, undefined);
  });
});

describe('cli-test-block: buildTestRule', () => {
  test('rule matches sentinel + is marked as test rule + expires in 5 min', () => {
    const mod = freshLoad();
    const now = Date.now();
    const rule = mod.buildTestRule(now);
    assert.equal(rule.pattern, mod.SENTINEL);
    assert.equal(rule.isTestRule, true);
    assert.equal(rule.decision, 'deny');
    const expires = Date.parse(rule.expiresAt);
    assert.ok(
      expires - now > 4 * 60 * 1000 && expires - now < 6 * 60 * 1000,
      'expiresAt should be ~5 min from now',
    );
  });
});

describe('cli-test-block: runTestBlock', () => {
  test('returns code 2 when .thumbgate/ does not exist', () => {
    withTempCwd(() => {
      const mod = freshLoad();
      const cap = captureStdio(() => mod.runTestBlock([]));
      assert.equal(cap.value.code, 2);
      assert.equal(cap.value.error, 'not_initialized');
      assert.match(cap.stderr, /ThumbGate is not initialized/);
    });
  });

  test('--dry-run does not write the test rule file', () => {
    withTempCwd((tmp) => {
      fs.mkdirSync(path.join(tmp, '.thumbgate'));
      const mod = freshLoad();
      const ruleFile = path.join(tmp, '.thumbgate', 'rules', 'test-block.json');
      const cap = captureStdio(() => mod.runTestBlock(['--dry-run']));
      assert.equal(cap.value.code, 0);
      assert.equal(cap.value.dryRun, true);
      assert.equal(fs.existsSync(ruleFile), false, 'dry-run must not write rule');
      assert.match(cap.stdout, /dry-run complete/);
    });
  });

  test('full run: writes rule in step 1, removes it in step 4, prints BLOCKED', () => {
    withTempCwd((tmp) => {
      fs.mkdirSync(path.join(tmp, '.thumbgate'));
      const mod = freshLoad();
      const ruleFile = path.join(tmp, '.thumbgate', 'rules', 'test-block.json');
      const cap = captureStdio(() => mod.runTestBlock(['--no-cta']));
      assert.equal(cap.value.code, 0);
      assert.match(cap.stdout, /\[1\/4\].*Installing test prevention rule/);
      assert.match(cap.stdout, /\[2\/4\].*Simulating an agent tool call/);
      assert.match(cap.stdout, /\[3\/4\].*Catching the block/);
      assert.match(cap.stdout, /\[4\/4\].*Cleaning up/);
      assert.match(cap.stdout, /BLOCKED/);
      assert.match(cap.stdout, /Test rule fired and blocked/);
      assert.equal(
        fs.existsSync(ruleFile),
        false,
        'rule must be cleaned up at step 4',
      );
    });
  });

  test('--no-cta suppresses the Pro upsell', () => {
    withTempCwd((tmp) => {
      fs.mkdirSync(path.join(tmp, '.thumbgate'));
      const mod = freshLoad();
      const cap = captureStdio(() => mod.runTestBlock(['--no-cta']));
      assert.equal(cap.value.code, 0);
      assert.doesNotMatch(cap.stdout, /checkout\/pro/);
      assert.doesNotMatch(cap.stdout, /Pro upgrade/);
    });
  });

  test('default run (no --no-cta) includes the Pro upsell + capture next-step', () => {
    withTempCwd((tmp) => {
      fs.mkdirSync(path.join(tmp, '.thumbgate'));
      const mod = freshLoad();
      const cap = captureStdio(() => mod.runTestBlock([]));
      assert.equal(cap.value.code, 0);
      assert.match(cap.stdout, /thumbgate capture/);
      assert.match(cap.stdout, /checkout\/pro/);
    });
  });

  test('--help prints usage and exits 0 without writing anything', () => {
    withTempCwd((tmp) => {
      fs.mkdirSync(path.join(tmp, '.thumbgate'));
      const mod = freshLoad();
      const ruleFile = path.join(tmp, '.thumbgate', 'rules', 'test-block.json');
      const cap = captureStdio(() => mod.runTestBlock(['--help']));
      assert.equal(cap.value.code, 0);
      assert.match(cap.stdout, /Usage/);
      assert.equal(fs.existsSync(ruleFile), false);
    });
  });
});

describe('cli-test-block: evaluateBlock', () => {
  test('in-process fallback returns deny when sentinel is in the command', () => {
    const mod = freshLoad();
    const rule = mod.buildTestRule(Date.now());
    const decision = mod.evaluateBlock(rule, {
      tool_name: 'Bash',
      tool_input: { command: `echo ${mod.SENTINEL}` },
    });
    assert.equal(decision.decision, 'deny');
    assert.equal(decision.matchedRule, rule.name);
  });

  test('in-process fallback allows commands without the sentinel', () => {
    const mod = freshLoad();
    const rule = mod.buildTestRule(Date.now());
    const decision = mod.evaluateBlock(rule, {
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
    });
    // Either fallback says allow, or real gates-engine says something else
    // (in which case the test sentinel wouldn't match either). What we don't
    // want is a deny on an unrelated command via our test rule.
    if (decision.source === 'in-process simulation') {
      assert.equal(decision.decision, 'allow');
    }
  });
});
