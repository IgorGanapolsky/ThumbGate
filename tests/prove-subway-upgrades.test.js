const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REQUIRED_SUBWAY_ARTIFACTS = [
  ['.claude', 'scripts', 'feedback', 'vector-store.js'],
  ['.claude', 'scripts', 'feedback', 'dpo-optimizer.js'],
  ['.claude', 'scripts', 'feedback', 'thompson-sampling.js'],
  ['.github', 'workflows', 'self-healing-monitor.yml'],
  ['.github', 'workflows', 'self-healing-auto-fix.yml'],
];

function isSubwayReady(root) {
  if (!fs.existsSync(root)) return false;
  return REQUIRED_SUBWAY_ARTIFACTS.every((parts) => fs.existsSync(path.join(root, ...parts)));
}

function resolveSubwayRoot() {
  const candidates = [
    path.join(__dirname, '..', '..', '..', '..', 'Subway_RN_Demo'),
    path.join(__dirname, '..', '..', '..', 'Subway_RN_Demo'),
    path.join(__dirname, '..', '..', 'Subway_RN_Demo'),
  ];
  return candidates.find((candidate) => isSubwayReady(candidate)) || candidates[0];
}

const SUBWAY_ROOT = resolveSubwayRoot();
const hasSubway = isSubwayReady(SUBWAY_ROOT);

test('subway-upgrades proof script exits 0', {
  skip: !hasSubway && 'Subway_RN_Demo repo missing required Phase-11 artifacts',
}, () => {
  const result = spawnSync('node', ['scripts/prove-subway-upgrades.js'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf-8',
    timeout: 120000,
    env: { ...process.env, SUBWAY_ROOT },
  });
  assert.equal(result.status, 0, `proof failed: ${(result.stderr || '').slice(-500)}`);
});
