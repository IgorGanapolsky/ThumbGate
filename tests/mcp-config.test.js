'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  parseWorktreePaths,
  portableMcpEntry,
  localMcpEntry,
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

  it('portableMcpEntry returns npx command with version', () => {
    const entry = portableMcpEntry('1.2.3');
    assert.strictEqual(entry.command, 'npx');
    assert.ok(entry.args.includes('-y'));
    assert.ok(entry.args.some(a => a.includes('1.2.3')));
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
});
