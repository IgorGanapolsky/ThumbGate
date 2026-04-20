'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');
const {
  parseWorktreePaths,
  publishedCliAvailable,
  portableMcpEntry,
  codexAutoUpdateCliEntry,
  codexAutoUpdateMcpEntry,
  localMcpEntry,
  resolveMcpEntry,
  resolveLocalServerPath,
  resolveStableSourceRoot,
  isSourceCheckout,
} = require('../scripts/mcp-config');

describe('mcp-config', () => {
  it('parseWorktreePaths extracts worktree lines from porcelain output', () => {
    const raw = 'worktree /home/user/repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /home/user/repo-wt\nHEAD def456\n';
    const result = parseWorktreePaths(raw);
    assert.deepStrictEqual(result, ['/home/user/repo', '/home/user/repo-wt']);
  });

  it('parseWorktreePaths returns empty array for empty input', () => {
    assert.deepStrictEqual(parseWorktreePaths(''), []);
    assert.deepStrictEqual(parseWorktreePaths(null), []);
  });

  it('portableMcpEntry returns a shell wrapper that pins the published package version', () => {
    const entry = portableMcpEntry('1.2.3');
    assert.strictEqual(entry.command, 'sh');
    assert.deepStrictEqual(entry.args.slice(0, 1), ['-lc']);
    assert.match(entry.args[1], /thumbgate@1\.2\.3/);
    assert.match(entry.args[1], /thumbgate/);
    assert.match(entry.args[1], /serve/);
    assert.match(entry.args[1], /\.thumbgate\/runtime/);
  });

  it('codexAutoUpdateMcpEntry returns a latest-resolving shell wrapper without the stale binary fast path', () => {
    const entry = codexAutoUpdateMcpEntry();
    assert.strictEqual(entry.command, 'sh');
    assert.deepStrictEqual(entry.args.slice(0, 1), ['-lc']);
    assert.match(entry.args[1], /thumbgate@latest/);
    assert.match(entry.args[1], /thumbgate/);
    assert.match(entry.args[1], /serve/);
    assert.match(entry.args[1], /\.thumbgate\/runtime/);
    assert.doesNotMatch(entry.args[1], /\[ -x /);
  });

  it('resolveMcpEntry uses a latest-resolving launcher for published external installs', () => {
    process.env.THUMBGATE_PUBLISH_STATE = 'published';
    process.env.THUMBGATE_PUBLISHED_CLI_STATE = 'available';
    try {
      const entry = resolveMcpEntry({
        pkgRoot: path.resolve(__dirname, '..'),
        pkgVersion: '1.2.3',
        scope: 'project',
        targetDir: path.join(path.sep, 'tmp', 'external-thumbgate-consumer'),
      });

      assert.strictEqual(entry.command, 'sh');
      assert.match(entry.args[1], /thumbgate@latest/);
      assert.match(entry.args[1], /npm "install"/);
      assert.doesNotMatch(entry.args[1], /\[ -x /);
      assert.doesNotMatch(entry.args[1], /thumbgate@1\.2\.3/);
    } finally {
      delete process.env.THUMBGATE_PUBLISH_STATE;
      delete process.env.THUMBGATE_PUBLISHED_CLI_STATE;
    }
  });

  it('resolveMcpEntry uses a latest-resolving launcher outside source checkouts', () => {
    const pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-non-source-'));
    try {
      const entry = resolveMcpEntry({
        pkgRoot,
        pkgVersion: '1.2.3',
        scope: 'project',
        targetDir: pkgRoot,
      });

      assert.strictEqual(entry.command, 'sh');
      assert.match(entry.args[1], /thumbgate@latest/);
      assert.doesNotMatch(entry.args[1], /thumbgate@1\.2\.3/);
    } finally {
      fs.rmSync(pkgRoot, { recursive: true, force: true });
    }
  });

  it('codexAutoUpdateCliEntry supports hook commands with the same latest-resolving policy', () => {
    const entry = codexAutoUpdateCliEntry(['gate-check']);
    assert.strictEqual(entry.command, 'sh');
    assert.match(entry.args[1], /thumbgate@latest/);
    assert.match(entry.args[1], /gate-check/);
    assert.match(entry.args[1], /npm "install"/);
    assert.doesNotMatch(entry.args[1], /\[ -x /);
  });

  it('localMcpEntry returns node command pointing to server-stdio.js', () => {
    const pkgRoot = '/fake/root';
    const entry = localMcpEntry(pkgRoot);
    assert.strictEqual(entry.command, 'node');
    assert.ok(entry.args[0].endsWith('server-stdio.js'));
  });

  it('isSourceCheckout returns true for repo with .git', () => {
    const pkgRoot = path.resolve(__dirname, '..');
    assert.strictEqual(isSourceCheckout(pkgRoot), true);
  });

  it('resolveStableSourceRoot falls back safely when pkgRoot is omitted', () => {
    const stableRoot = resolveStableSourceRoot();
    assert.ok(typeof stableRoot === 'string' && stableRoot.length > 0);
    assert.ok(path.isAbsolute(stableRoot));
  });

  it('publishedCliAvailable respects the explicit availability override', () => {
    process.env.THUMBGATE_PUBLISHED_CLI_STATE = 'available';
    try {
      assert.equal(publishedCliAvailable('0.9.10'), true);
    } finally {
      delete process.env.THUMBGATE_PUBLISHED_CLI_STATE;
    }
  });
});
