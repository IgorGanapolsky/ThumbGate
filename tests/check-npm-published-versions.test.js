'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'check-npm-published-versions.js');

function makeFixture(files, published) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-versions-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const publishedFile = path.join(dir, '.published.json');
  fs.writeFileSync(publishedFile, JSON.stringify(published));
  return { dir, publishedFile };
}

function runScript(dir, publishedFile, extra = []) {
  try {
    const stdout = execFileSync('node', [SCRIPT, '--root', dir, '--published-file', publishedFile, ...extra], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

test('passes when every pinned version is published', () => {
  const { dir, publishedFile } = makeFixture({
    'README.md': 'npx thumbgate@1.2.3 init\n',
    'docs/a.md': 'x\nuse thumbgate@1.2.4-beta.1 here\n',
    'package.json': '{"version":"1.2.3"}',
  }, ['1.2.3', '1.2.4-beta.1']);
  const r = runScript(dir, publishedFile);
  assert.equal(r.code, 0, r.out);
});

test('fails and names file:line for an unpublished version', () => {
  const { dir, publishedFile } = makeFixture({
    'README.md': 'ok thumbgate@1.2.3\n',
    'plugins/x/.mcp.json': '{\n  "args": ["thumbgate@9.9.9"]\n}\n',
    'src/ignored.js': 'thumbgate@8.8.8\n',
    'package.json': '{"version":"1.2.3"}',
  }, ['1.2.3']);
  const r = runScript(dir, publishedFile);
  assert.equal(r.code, 1);
  assert.match(r.out, /plugins\/x\/\.mcp\.json:2 thumbgate@9\.9\.9/);
  assert.doesNotMatch(r.out, /8\.8\.8/);
  assert.doesNotMatch(r.out, /README\.md/);
});

test('covers server-card files anywhere and ignores scoped package names', () => {
  const { dir, publishedFile } = makeFixture({
    'foo/bar/my-server-card.json': '{"v":"thumbgate@7.7.7"}',
    'docs/b.md': '@thumbgate/core@7.7.7 and mythumbgate@7.7.7\n',
    'package.json': '{"version":"1.2.3"}',
  }, ['1.2.3']);
  const r = runScript(dir, publishedFile);
  assert.equal(r.code, 1);
  assert.match(r.out, /foo\/bar\/my-server-card\.json:1 thumbgate@7\.7\.7/);
  assert.doesNotMatch(r.out, /docs\/b\.md/);
});

test('PR mode allows an unreleased package.json bump, strict mode does not', () => {
  const files = {
    'README.md': 'npx thumbgate@1.3.0\n',
    'package.json': '{"version":"1.3.0"}',
  };
  const { dir, publishedFile } = makeFixture(files, ['1.2.3']);
  assert.equal(runScript(dir, publishedFile).code, 1);
  assert.equal(runScript(dir, publishedFile, ['--allow-unreleased-package-version']).code, 0);
});

test('PR mode never allows a version at or below latest published, or a non-package version', () => {
  const { dir, publishedFile } = makeFixture({
    'README.md': 'npx thumbgate@1.2.2 and thumbgate@1.4.0\n',
    'package.json': '{"version":"1.3.0"}',
  }, ['1.2.3', '1.2.1']);
  const r = runScript(dir, publishedFile, ['--allow-unreleased-package-version']);
  assert.equal(r.code, 1);
  assert.match(r.out, /README\.md:1 thumbgate@1\.2\.2/);
  assert.match(r.out, /thumbgate@1\.4\.0/);
});

test('PR mode does not allow package.json version that is already behind latest', () => {
  const { dir, publishedFile } = makeFixture({
    'README.md': 'thumbgate@1.2.0\n',
    'package.json': '{"version":"1.2.0"}',
  }, ['1.2.3', '1.2.1']);
  assert.equal(runScript(dir, publishedFile, ['--allow-unreleased-package-version']).code, 1);
});

test('captures hyphens inside prerelease identifiers', () => {
  const { collectPins } = require(SCRIPT);
  const { dir, publishedFile } = makeFixture({
    'README.md': 'npx thumbgate@1.41.0-beta-1\nnpx thumbgate@2.0.0-rc.1-x.2 init\n',
  }, ['1.41.0-beta-1', '2.0.0-rc.1-x.2']);
  assert.deepEqual(collectPins(dir, ['README.md']).map((p) => p.version), ['1.41.0-beta-1', '2.0.0-rc.1-x.2']);
  assert.equal(runScript(dir, publishedFile).code, 0);
});
