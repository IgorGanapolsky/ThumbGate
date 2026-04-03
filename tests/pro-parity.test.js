'use strict';

/**
 * Public/Private Boundary Tests
 *
 * Ensures the public OSS repository does not publish or embed the private
 * Pro package surface by accident.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');
const freePkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
describe('public/private boundary', () => {
  it('public repo does not ship a publishable pro package manifest', () => {
    assert.equal(fs.existsSync(path.join(PKG_ROOT, 'pro', 'package.json')), false);
  });

  it('public repo does not have a dedicated pro publish workflow', () => {
    const workflowPath = path.join(PKG_ROOT, '.github', 'workflows', 'publish-npm-pro.yml');
    assert.equal(fs.existsSync(workflowPath), false);
  });

  it('public repo keeps a migration stub for pro distribution', () => {
    const readme = fs.readFileSync(path.join(PKG_ROOT, 'pro', 'README.md'), 'utf8');
    assert.match(readme, /private repository/i);
    assert.match(readme, /@igorganapolsky\/mcp-memory-gateway-pro/);
  });

  it('public package metadata still describes the OSS core only', () => {
    assert.equal(freePkg.name, 'mcp-memory-gateway');
    assert.ok(!String(freePkg.name).includes('pro'));
  });
});
