const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('sync-version --check reports no drift on main', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(result.version, 'version should be defined');
  assert.ok(result.targets.length > 10, `expected >10 sync targets, got ${result.targets.length}`);
  assert.deepEqual(result.drifted, [], `expected no drift, found: ${JSON.stringify(result.drifted)}`);
  assert.equal(result.allInSync, true);
});

test('sync-version covers mcpize.yaml', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(result.targets.includes('mcpize.yaml'), 'mcpize.yaml should be a sync target');
});

test('sync-version covers package-lock.json', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  const hasPackageLock = result.targets.some(t => t.includes('package-lock.json'));
  assert.ok(hasPackageLock, 'package-lock.json should be a sync target');
});
