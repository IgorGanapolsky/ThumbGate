'use strict';

// 27 Nov 2026: a thumbs-down held `export GH_TOKEN="$(gh auth …`, so every command with that opener was refused,
// including a reviewed push. A hold covers the action, not the setup in front of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sg = require('../scripts/send-gate');

const TOKEN = 'export GH_TOKEN="$(gh auth token --user someone)"';

function after(complainedAbout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hold-prefix-'));
  const t = Date.now();
  const call = (command, now) => sg.evaluate({ feedbackDir: dir, toolName: 'Bash', toolInput: { command }, sessionId: 's', now });
  call(complainedAbout, t);
  sg.placeHold({ feedbackDir: dir, sessionId: 's', reason: 'thumbs down', now: t + 1000 });
  return (command) => Boolean(call(command, t + 2000));
}

test('other commands behind the same credential line are not held', () => {
  const held = after(`${TOKEN} && node scripts/post-everywhere.js --live`);
  assert.equal(held(`${TOKEN} && git push origin feat/reviewed`), false);
  assert.equal(held(`${TOKEN}; gh pr create --fill`), false);
  assert.equal(held(TOKEN), false);
});

test('the action itself stays held, whatever stands in front of it', () => {
  const held = after(`${TOKEN} && git push origin main`);
  assert.equal(held(`${TOKEN} && git push origin main`), true);
  assert.equal(held('git push origin main'), true);
  assert.equal(held('cd /repo && GIT_TRACE=1 git push origin main 2>&1 | tail -3'), true);
});

test('a destructive command cannot hide behind setup, redirects or a substitution', () => {
  assert.equal(after('rm -rf build')('export A=1; rm -rf build'), true);
  assert.equal(after('rm -rf build')('echo "$(rm -rf build)"'), true);
  assert.equal(after('export X="$(rm -rf build)"')('rm -rf build'), true);
  assert.equal(after('cd app && node deploy.js > out.log')('node deploy.js'), true);
});
