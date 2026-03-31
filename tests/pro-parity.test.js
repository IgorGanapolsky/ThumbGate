'use strict';

/**
 * Pro Package Parity Tests
 *
 * Ensures the free and Pro npm packages stay in sync. Added 2026-03-31
 * after discovering Pro was stuck at 0.8.3 while free shipped 0.8.5 —
 * two versions behind with no CI enforcement.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');
const freePkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
const proPkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'pro', 'package.json'), 'utf8'));

describe('pro package parity', () => {
  it('free and pro versions match exactly', () => {
    assert.equal(proPkg.version, freePkg.version,
      `Version mismatch: free=${freePkg.version} pro=${proPkg.version}. ` +
      'Run node scripts/sync-version.js to fix.'
    );
  });

  it('pro package name is mcp-memory-gateway-pro', () => {
    assert.equal(proPkg.name, 'mcp-memory-gateway-pro');
  });

  it('pro depends on free package', () => {
    assert.ok(proPkg.dependencies && proPkg.dependencies['mcp-memory-gateway'],
      'Pro package must depend on mcp-memory-gateway'
    );
  });

  it('pro has a bin entry', () => {
    assert.ok(proPkg.bin && Object.keys(proPkg.bin).length > 0,
      'Pro package must have a bin entry'
    );
  });

  it('pro has a CLI entrypoint that exists', () => {
    const binPath = Object.values(proPkg.bin)[0];
    const fullPath = path.join(PKG_ROOT, 'pro', binPath);
    assert.ok(fs.existsSync(fullPath), `Pro CLI entrypoint missing: ${fullPath}`);
  });

  it('publish-npm-pro.yml workflow exists', () => {
    const workflowPath = path.join(PKG_ROOT, '.github', 'workflows', 'publish-npm-pro.yml');
    assert.ok(fs.existsSync(workflowPath), 'Pro publish workflow must exist');
  });

  it('publish-npm-pro.yml contains version parity check', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, '.github', 'workflows', 'publish-npm-pro.yml'), 'utf8');
    assert.ok(src.includes('Version mismatch'), 'Pro publish workflow must enforce version parity');
  });
});
