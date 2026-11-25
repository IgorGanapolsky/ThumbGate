'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { diff, OUT, SKILLS } = require('../scripts/build-claude-directory-plugin');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('plugins/claude-directory matches the generator output', () => {
  const { problems } = diff();
  assert.deepEqual(problems, [], 'run node scripts/build-claude-directory-plugin.js');
});

test('directory plugin pins every npx launcher to the package version', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(OUT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const hooks = JSON.parse(fs.readFileSync(path.join(OUT, 'hooks', 'hooks.json'), 'utf8'));
  const spec = `thumbgate@${pkg.version}`;
  assert.equal(plugin.version, pkg.version);
  assert.deepEqual(plugin.mcpServers.thumbgate.args, ['-y', spec, 'serve']);
  const commands = Object.values(hooks.hooks).flat().flatMap((entry) => entry.hooks);
  assert.ok(commands.length >= 2);
  for (const hook of commands) {
    assert.equal(hook.command, 'npx');
    assert.equal(hook.args[1], spec);
  }
});

test('directory plugin holds only files the directory accepts', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(OUT, full).split(path.sep).join('/'));
    }
  };
  walk(OUT);
  for (const rel of files) {
    assert.match(rel, /(\.md|\.json|^LICENSE|icon\.png)$/, `unexpected file type ${rel}`);
    assert.ok(!/(^|\/)(package(-lock)?\.json|bin\/)/.test(rel), `forbidden file ${rel}`);
  }
  for (const name of SKILLS) assert.ok(files.includes(`skills/${name}/SKILL.md`), `missing skill ${name}`);
  const readme = fs.readFileSync(path.join(OUT, 'README.md'), 'utf8');
  assert.match(readme, /DO_NOT_TRACK=1/, 'README must disclose telemetry opt-out');
});
