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

test('compareSemver follows semver precedence, including prereleases', () => {
  const { compareSemver } = require(SCRIPT);
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.equal(compareSemver(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`);
    assert.equal(compareSemver(ordered[i + 1], ordered[i]), 1, `${ordered[i + 1]} > ${ordered[i]}`);
  }
  assert.equal(compareSemver('1.0.0-rc.1', '1.0.0-rc.1'), 0);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
});

test('run in-process: --flag=value forms, binary files skipped, output goes to io', () => {
  const { run } = require(SCRIPT);
  const { dir, publishedFile } = makeFixture({
    'README.md': 'npx thumbgate@1.0.0\n',
    'public/logo.svgz': Buffer.from([0x00, 0x74, 0x68]).toString() + 'thumbgate@9.9.9',
  }, ['1.0.0']);
  const logs = [];
  const errors = [];
  const io = { log: (m) => logs.push(m), error: (m) => errors.push(m) };
  assert.equal(run([`--root=${dir}`, `--published-file=${publishedFile}`], io), 0);
  assert.match(logs.join('\n'), /OK: 1 pinned/);
  assert.deepEqual(errors, []);

  fs.writeFileSync(path.join(dir, 'README.md'), 'npx thumbgate@1.0.0\nnpx thumbgate@7.7.7\n');
  assert.equal(run(['--root', dir, '--published-file', publishedFile], io), 1);
  assert.match(errors.join('\n'), /README\.md:2 thumbgate@7\.7\.7/);
});

test('rejects unknown arguments and malformed published lists', () => {
  const { parseArgs, loadPublishedVersions } = require(SCRIPT);
  assert.throws(() => parseArgs(['--nope']), /unknown argument: --nope/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-versions-bad-'));
  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, '[]');
  assert.throws(() => loadPublishedVersions({ publishedFile: empty }), /empty or malformed/);
  const single = path.join(dir, 'single.json');
  fs.writeFileSync(single, '"1.2.3"');
  assert.deepEqual(loadPublishedVersions({ publishedFile: single }), ['1.2.3']);
});

test('CLI exits 2 with a message on bad input', () => {
  const { dir, publishedFile } = makeFixture({ 'README.md': 'x\n' }, ['1.0.0']);
  const res = runScript(dir, publishedFile, ['--nope']);
  assert.equal(res.code, 2);
  assert.match(res.out, /unknown argument: --nope/);
});

test('git and npm resolve to absolute paths, not a PATH lookup', () => {
  const { resolveGitBinary, resolveNpmBinary } = require(SCRIPT);
  assert.ok(path.isAbsolute(resolveGitBinary()));
  assert.ok(path.isAbsolute(resolveNpmBinary()));
});
