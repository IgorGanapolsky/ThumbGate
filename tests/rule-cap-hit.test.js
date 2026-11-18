// tests/rule-cap-hit.test.js
// The free tier enforces 3 learned rules. The 4th is stored but never enforced. That moment must
// (1) be countable locally and opt-in, with no rule content, and (2) show one plain upgrade line
// naming the rule that could not be enforced.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rateLimiter = require('../scripts/rate-limiter');
const { promote, WARN_THRESHOLD } = require('../scripts/auto-promote-gates');
const { recordCapHit, readCapHitCount, COUNTER_FILE } = require('../scripts/cap-hit-counter');

// Assembled at runtime so no token-shaped literal sits in the repo.
const FAKE_TOKEN = ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz123456'].join('');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-cap-hit-'));
}

function seedFourRules(dir) {
  const logPath = path.join(dir, 'feedback-log.jsonl');
  const lines = [];
  for (let p = 0; p < 4; p++) {
    for (let i = 0; i < WARN_THRESHOLD; i++) {
      lines.push(JSON.stringify({
        signal: 'negative',
        tags: [`pattern-${p}`],
        context: `npm test -- suite-${p}`,
        whatWentWrong: 'Something broke',
        timestamp: new Date().toISOString(),
      }));
    }
  }
  fs.writeFileSync(logPath, `${lines.join('\n')}\n`);
  return logPath;
}

function withEnv(t, dir, extra = {}) {
  const saved = {};
  const env = { THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_TRIAL: '1', ...extra };
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

function stubTier(t, isPro) {
  const original = rateLimiter.isProTier;
  rateLimiter.isProTier = () => isPro;
  t.after(() => { rateLimiter.isProTier = original; });
}

test('capUpgradeLine names the rule that cannot be enforced, in one plain line', () => {
  const line = rateLimiter.capUpgradeLine('agent deployed without tests');
  assert.ok(line, 'expected a line');
  assert.equal(line.includes('\n'), false, 'one line only');
  assert.match(line, /agent deployed without tests/);
  assert.match(line, /but Free enforces 3\. Pro enforces all of them: https:\/\/thumbgate\.ai\/pro$/);
  assert.equal(line, 'ThumbGate learned a 4th rule (agent deployed without tests), but Free enforces 3. Pro enforces all of them: https://thumbgate.ai/pro');
});

test('capUpgradeLine redacts secrets and returns null for empty text', () => {
  const line = rateLimiter.capUpgradeLine(`leaked ${FAKE_TOKEN} in a log`);
  assert.equal(line.includes(FAKE_TOKEN), false);
  assert.equal(rateLimiter.capUpgradeLine('   '), null);
  assert.equal(rateLimiter.capUpgradeLine(undefined), null);
});

test('promote on the free tier reports a cap-hit for the 4th rule only, with the upgrade line', (t) => {
  const dir = tmpDir();
  withEnv(t, dir);
  stubTier(t, false);
  const result = promote(seedFourRules(dir));
  const capHits = result.promotions.filter((p) => p.type === 'cap-hit');
  assert.equal(capHits.length, 1, `expected exactly one cap-hit, got ${JSON.stringify(result.promotions.map((p) => p.type))}`);
  assert.equal(capHits[0].enforced, false);
  assert.equal(capHits[0].cap, 3);
  assert.equal(capHits[0].activeGates, 4);
  assert.ok(result.upgradeLine, 'result should carry the upgrade line');
  assert.match(result.upgradeLine, /^ThumbGate learned a 4th rule \(.*suite-3.*\), but Free enforces 3\. Pro enforces all of them: https:\/\/thumbgate\.ai\/pro$/);
  assert.match(result.upgradeLine, /suite-3/);
});

test('promote on Pro never reports a cap-hit and writes no counter', (t) => {
  const dir = tmpDir();
  withEnv(t, dir, { THUMBGATE_LOCAL_COUNTERS: '1' });
  stubTier(t, true);
  const result = promote(seedFourRules(dir));
  assert.equal(result.promotions.filter((p) => p.type === 'cap-hit').length, 0);
  assert.equal(result.upgradeLine, undefined);
  assert.equal(fs.existsSync(path.join(dir, COUNTER_FILE)), false);
});

test('the cap-hit counter is off by default and writes nothing', (t) => {
  const dir = tmpDir();
  withEnv(t, dir, { THUMBGATE_LOCAL_COUNTERS: undefined });
  stubTier(t, false);
  promote(seedFourRules(dir));
  assert.equal(fs.existsSync(path.join(dir, COUNTER_FILE)), false);
  assert.equal(readCapHitCount({ feedbackDir: dir }), 0);
});

test('with THUMBGATE_LOCAL_COUNTERS=1 the cap-hit is one local line holding no rule content', (t) => {
  const dir = tmpDir();
  withEnv(t, dir, { THUMBGATE_LOCAL_COUNTERS: '1' });
  stubTier(t, false);
  promote(seedFourRules(dir));
  const lines = fs.readFileSync(path.join(dir, COUNTER_FILE), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(event).sort(), ['activeGates', 'cap', 'event', 'ts']);
  assert.equal(event.event, 'rule_cap_hit');
  assert.equal(event.cap, 3);
  assert.equal(event.activeGates, 4);
  assert.doesNotMatch(lines[0], /suite-|npm test/, 'no rule or command text in the counter');
  assert.equal(readCapHitCount({ feedbackDir: dir }), 1);
});

test('capturing a 4th learned rule prints the upgrade line once on stderr (end to end)', (t) => {
  const { spawnSync } = require('node:child_process');
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(__dirname, '..');
  const script = `
    const rl = require(${JSON.stringify(path.join(repo, 'scripts/rate-limiter'))});
    rl.isProTier = () => false;
    const fl = require(${JSON.stringify(path.join(repo, 'scripts/feedback-loop'))});
    (async () => {
      for (let p = 0; p < 4; p++) for (let i = 0; i < 3; i++) {
        await fl.captureFeedback({ signal: 'down', context: 'npm test -- suite-' + p,
          whatWentWrong: 'ran npm test -- suite-' + p + ' without the build step and shipped a broken bundle',
          whatToChange: 'run the build before npm test -- suite-' + p, tags: ['pattern-' + p] });
      }
      setTimeout(() => process.exit(0), 500);
    })();`;
  const env = { PATH: process.env.PATH, HOME: dir, THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_TRIAL: '1', THUMBGATE_NO_TELEMETRY: '1' };
  const run = spawnSync(process.execPath, ['-e', script], { env, cwd: dir, encoding: 'utf8', timeout: 90000 });
  const lines = run.stderr.split('\n').filter((l) => l.startsWith('ThumbGate learned a 4th rule'));
  assert.equal(lines.length, 1, `expected one upgrade line, stderr was:\n${run.stderr.slice(-600)}`);
  assert.match(lines[0], /suite-3/);
});

test('recordCapHit swallows write errors and the module never touches the network', () => {
  assert.doesNotThrow(() => recordCapHit({ feedbackDir: '/nonexistent/\0bad', cap: 3, activeGates: 4, enabled: true }));
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cap-hit-counter.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?(?:https?|net|dgram|tls)['"]\)|fetch\(/);
});
