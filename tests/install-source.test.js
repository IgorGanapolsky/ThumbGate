'use strict';

// install-source-1: tell npm, clone and Bluesky-link installs apart without a hand-set label.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-install-source-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { installChannel, installSourceFields, INSTALL_SOURCE_PATH } = require('../scripts/cli-telemetry');

test('npm and clone installs are told apart, and the guess is never saved', () => {
  const clone = path.join(home, 'clone');
  fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
  const npm = path.join(home, 'app', 'node_modules', 'thumbgate');
  assert.equal(installChannel(clone), 'git-clone');
  assert.equal(installChannel(npm), 'npm');
  assert.equal(installChannel(path.join(home, 'unpacked')), '');
  assert.ok(INSTALL_SOURCE_PATH.startsWith(home), 'test must not touch the real home');
  assert.deepEqual(installSourceFields({}, npm), { source: 'npm', utmSource: 'npm' });
  assert.equal(fs.existsSync(INSTALL_SOURCE_PATH), false);
  assert.deepEqual(installSourceFields({ THUMBGATE_INSTALL_SOURCE: 'bluesky' }, npm), { source: 'bluesky', utmSource: 'bluesky' });
});

test('the homepage labels the copied command for a Bluesky visitor only', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const block = html.match(/var CMD = 'npx thumbgate init --agent claude';[\s\S]*?(?=\n    function legacyCopy)/)[0];
  const run = (search, userAgent) => {
    const code = { textContent: 'npx thumbgate init --agent claude' };
    const context = { URLSearchParams, location: { search }, navigator: { userAgent }, document: { querySelectorAll: () => [code] } };
    vm.runInNewContext(`${block}\nresult = CMD;`, context);
    return [context.result, code.textContent];
  };
  const labelled = 'THUMBGATE_INSTALL_SOURCE=bluesky npx thumbgate init --agent claude';
  const plain = 'npx thumbgate init --agent claude';
  assert.deepEqual(run('?utm_source=bluesky', 'Macintosh'), [labelled, labelled]);
  assert.deepEqual(run('?utm_source=bluesky', 'Windows NT 10.0'), [plain, plain]);
  assert.deepEqual(run('?utm_source=reddit', 'Macintosh'), [plain, plain]);
});
