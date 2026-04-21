'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  formatInstallSummary,
  installGitHooks,
  parseGitVersion,
  resolvesToRepoHooksDir,
  supportsConfigBasedHooks,
} = require('../scripts/git-hook-installer');

function makeTmpRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-git-hooks-'));
  const hooksDir = path.join(repoRoot, '.githooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\nexit 0\n');
  fs.writeFileSync(path.join(hooksDir, 'pre-push'), '#!/bin/sh\nexit 0\n');
  return repoRoot;
}

function makeConfigStore(initialConfig = {}) {
  const config = new Map();
  for (const [key, value] of Object.entries(initialConfig)) {
    config.set(key, Array.isArray(value) ? [...value] : [value]);
  }

  return {
    readConfig(key) {
      const values = config.get(key);
      return values && values.length > 0 ? values[values.length - 1] : null;
    },
    readConfigAll(key) {
      return [...(config.get(key) || [])];
    },
    setConfig(key, value, options = {}) {
      if (options.append) {
        config.set(key, [...(config.get(key) || []), value]);
        return;
      }
      config.set(key, [value]);
    },
    unsetConfig(key) {
      config.delete(key);
    },
    dump() {
      return new Map(config);
    },
  };
}

describe('git-hook-installer', () => {
  test('parseGitVersion reads semver triples', () => {
    assert.deepStrictEqual(parseGitVersion('git version 2.54.0'), {
      major: 2,
      minor: 54,
      patch: 0,
    });
    assert.equal(parseGitVersion('not git'), null);
  });

  test('supportsConfigBasedHooks gates on Git 2.54+', () => {
    assert.equal(supportsConfigBasedHooks('git version 2.54.0'), true);
    assert.equal(supportsConfigBasedHooks('git version 2.53.1'), false);
  });

  test('resolvesToRepoHooksDir matches both relative and absolute repo hook paths', () => {
    const repoRoot = makeTmpRepo();
    try {
      assert.equal(resolvesToRepoHooksDir('.githooks', repoRoot), true);
      assert.equal(resolvesToRepoHooksDir(path.join(repoRoot, '.githooks'), repoRoot), true);
      assert.equal(resolvesToRepoHooksDir('/tmp/shared-hooks', repoRoot), false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('installGitHooks uses Git 2.54 config hooks and disables duplicate repo hooksPath', () => {
    const repoRoot = makeTmpRepo();
    const store = makeConfigStore({
      'core.hooksPath': '.githooks',
    });

    try {
      const result = installGitHooks({
        repoRoot,
        gitVersion: 'git version 2.54.0',
        readConfig: store.readConfig,
        readConfigAll: store.readConfigAll,
        setConfig: store.setConfig,
        unsetConfig: store.unsetConfig,
      });

      assert.equal(result.mode, 'config');
      assert.equal(result.changed, true);
      assert.equal(result.disabledRepoHooksPath, true);
      assert.equal(store.readConfig('core.hooksPath'), null);
      assert.equal(
        store.readConfig('hook.thumbgate-pre-commit.command'),
        path.join(repoRoot, '.githooks', 'pre-commit')
      );
      assert.deepStrictEqual(
        store.readConfigAll('hook.thumbgate-pre-commit.event'),
        ['pre-commit']
      );
      assert.equal(store.readConfig('hook.thumbgate-pre-commit.enabled'), 'true');
      assert.equal(
        store.readConfig('hook.thumbgate-pre-push.command'),
        path.join(repoRoot, '.githooks', 'pre-push')
      );
      assert.deepStrictEqual(
        store.readConfigAll('hook.thumbgate-pre-push.event'),
        ['pre-push']
      );
      assert.equal(store.readConfig('hook.thumbgate-pre-push.enabled'), 'true');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('installGitHooks preserves a custom existing hooksPath when layering config hooks', () => {
    const repoRoot = makeTmpRepo();
    const store = makeConfigStore({
      'core.hooksPath': '/opt/company-hooks',
    });

    try {
      const result = installGitHooks({
        repoRoot,
        gitVersion: 'git version 2.54.0',
        readConfig: store.readConfig,
        readConfigAll: store.readConfigAll,
        setConfig: store.setConfig,
        unsetConfig: store.unsetConfig,
      });

      assert.equal(result.mode, 'config');
      assert.equal(result.disabledRepoHooksPath, false);
      assert.equal(result.preservedHooksPath, '/opt/company-hooks');
      assert.equal(store.readConfig('core.hooksPath'), '/opt/company-hooks');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('installGitHooks falls back to core.hooksPath before Git 2.54', () => {
    const repoRoot = makeTmpRepo();
    const store = makeConfigStore();

    try {
      const result = installGitHooks({
        repoRoot,
        gitVersion: 'git version 2.53.0',
        readConfig: store.readConfig,
        readConfigAll: store.readConfigAll,
        setConfig: store.setConfig,
        unsetConfig: store.unsetConfig,
      });

      assert.equal(result.mode, 'hookspath');
      assert.equal(result.changed, true);
      assert.equal(store.readConfig('core.hooksPath'), '.githooks');
      assert.equal(store.readConfig('hook.thumbgate-pre-commit.command'), null);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('installGitHooks is idempotent in config mode', () => {
    const repoRoot = makeTmpRepo();
    const store = makeConfigStore({
      'hook.thumbgate-pre-commit.command': path.join(repoRoot, '.githooks', 'pre-commit'),
      'hook.thumbgate-pre-commit.event': ['pre-commit'],
      'hook.thumbgate-pre-commit.enabled': 'true',
      'hook.thumbgate-pre-push.command': path.join(repoRoot, '.githooks', 'pre-push'),
      'hook.thumbgate-pre-push.event': ['pre-push'],
      'hook.thumbgate-pre-push.enabled': 'true',
    });

    try {
      const before = store.dump();
      const result = installGitHooks({
        repoRoot,
        gitVersion: 'git version 2.54.0',
        readConfig: store.readConfig,
        readConfigAll: store.readConfigAll,
        setConfig: store.setConfig,
        unsetConfig: store.unsetConfig,
      });

      assert.equal(result.changed, false);
      assert.deepStrictEqual(store.dump(), before);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('formatInstallSummary reports config-hook mode clearly', () => {
    const repoRoot = makeTmpRepo();
    try {
      const text = formatInstallSummary({
        mode: 'config',
        gitVersion: 'git version 2.54.0',
        hooks: [
          { event: 'pre-commit', command: path.join(repoRoot, '.githooks', 'pre-commit') },
          { event: 'pre-push', command: path.join(repoRoot, '.githooks', 'pre-push') },
        ],
        disabledRepoHooksPath: true,
        preservedHooksPath: null,
      });
      assert.match(text, /Git 2\.54\+ config hooks/);
      assert.match(text, /disabled core\.hooksPath=.githooks/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
