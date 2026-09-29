'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'distribution', 'agensi', 'thumbgate-pretool-gate');
const VERSION = require(path.join(ROOT, 'package.json')).version;

function read(name) {
  return fs.readFileSync(path.join(SKILL_DIR, name), 'utf8');
}

test('the Agensi skill folder matches its frontmatter and the published version', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /^---\nname: thumbgate-pretool-gate\n/);
  assert.match(skill, /description: "/);
  assert.match(skill, /Use when the user asks/);
  assert.ok(skill.includes(`thumbgate@${VERSION}`), 'SKILL.md must pin current thumbgate version');
  assert.match(skill, /https:\/\/thumbgate\.ai/);
  assert.match(skill, /https:\/\/www\.npmjs\.com\/package\/thumbgate/);
  assert.match(skill, /https:\/\/github\.com\/IgorGanapolsky\/ThumbGate/);
  assert.equal(path.basename(SKILL_DIR), 'thumbgate-pretool-gate');
  assert.match(read('README.md'), /\$9 one-time/);
  assert.match(read('examples/deny-and-warn.md'), /Result: deny/);
});

test('the listing zip has the skill at the folder root and no scan-bait', () => {
  const zipPath = path.join(os.tmpdir(), `thumbgate-pretool-gate-${process.pid}.zip`);
  const packed = spawnSync('zip', ['-r', '-X', zipPath, 'thumbgate-pretool-gate'], {
    cwd: path.join(ROOT, 'distribution', 'agensi'),
    encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stderr);
  const listed = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const names = listed.stdout.trim().split('\n').filter((name) => !name.endsWith('/')).sort();
  assert.deepEqual(names, [
    'thumbgate-pretool-gate/README.md',
    'thumbgate-pretool-gate/SKILL.md',
    'thumbgate-pretool-gate/examples/deny-and-warn.md',
  ]);
  const banned = /\b(curl|wget|eval\(|base64|sudo|printenv|process\.env|ignore previous|AKIA|BEGIN [A-Z]+ PRIVATE KEY)\b/i;
  for (const name of ['SKILL.md', 'README.md', 'examples/deny-and-warn.md']) {
    assert.equal(banned.test(read(name)), false, name);
  }
  fs.rmSync(zipPath, { force: true });
});
