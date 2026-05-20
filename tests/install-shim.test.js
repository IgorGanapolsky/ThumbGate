'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('install-shim', () => {
  let tmpDir;
  let originalHome;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-shim-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('installShim creates executable shim at ~/.thumbgate/bin/thumbgate-hook', () => {
    // Re-require after setting HOME so paths resolve to tmpDir
    delete require.cache[require.resolve('../scripts/install-shim')];
    const { installShim } = require('../scripts/install-shim');

    const result = installShim();
    assert.ok(fs.existsSync(result), 'shim file should exist');
    const stat = fs.statSync(result);
    assert.ok((stat.mode & 0o111) !== 0, 'shim should be executable');
    assert.ok(result.endsWith('thumbgate-hook'), 'shim path should end with thumbgate-hook');
  });

  test('shim content contains bash shebang and exec calls', () => {
    delete require.cache[require.resolve('../scripts/install-shim')];
    const { shimContent } = require('../scripts/install-shim');

    const content = shimContent();
    assert.ok(content.startsWith('#!/usr/bin/env bash'), 'should have bash shebang');
    assert.ok(content.includes('exec "$RUNTIME_BIN" "$@"'), 'should exec runtime binary');
    assert.ok(content.includes('thumbgate@latest'), 'should reference @latest for auto-update');
    assert.ok(content.includes('npx --yes'), 'should use npx fallback');
  });

  test('shimInstalled returns false when no shim exists', () => {
    delete require.cache[require.resolve('../scripts/install-shim')];
    const { shimInstalled } = require('../scripts/install-shim');

    assert.equal(shimInstalled(), false);
  });

  test('shimInstalled returns true after installShim', () => {
    delete require.cache[require.resolve('../scripts/install-shim')];
    const { installShim, shimInstalled } = require('../scripts/install-shim');

    installShim();
    assert.equal(shimInstalled(), true);
  });

  test('shim contains background upgrade spawn', () => {
    delete require.cache[require.resolve('../scripts/install-shim')];
    const { shimContent } = require('../scripts/install-shim');

    const content = shimContent();
    assert.ok(content.includes('nohup npm install'), 'should spawn background upgrade');
    assert.ok(content.includes('>/dev/null 2>&1'), 'background upgrade should be silent');
  });

  test('hook-runtime uses shim path when shim is installed (non-source-checkout)', () => {
    delete require.cache[require.resolve('../scripts/install-shim')];
    const { installShim } = require('../scripts/install-shim');
    installShim();

    // Stub isSourceCheckout to return false (simulates npm-installed package)
    delete require.cache[require.resolve('../scripts/mcp-config')];
    const mcpConfig = require('../scripts/mcp-config');
    const origIsSource = mcpConfig.isSourceCheckout;
    mcpConfig.isSourceCheckout = () => false;

    // Clear hook-runtime cache so it picks up the new shim state
    delete require.cache[require.resolve('../scripts/hook-runtime')];
    const { resolveCliCommand } = require('../scripts/hook-runtime');

    try {
      const command = resolveCliCommand('gate-check');
      assert.ok(
        command.includes('thumbgate-hook') && command.includes('gate-check'),
        `Expected shim-based command, got: ${command}`,
      );
    } finally {
      mcpConfig.isSourceCheckout = origIsSource;
    }
  });
});
