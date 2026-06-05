const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const serial = { concurrency: false };

test('sync-version --check reports no drift on main', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(result.version, 'version should be defined');
  assert.ok(result.targets.length > 10, `expected >10 sync targets, got ${result.targets.length}`);
  assert.deepEqual(result.drifted, [], `expected no drift, found: ${JSON.stringify(result.drifted)}`);
  assert.equal(result.allInSync, true);
});

test('sync-version covers mcpize.yaml', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(result.targets.includes('mcpize.yaml'), 'mcpize.yaml should be a sync target');
});

test('sync-version covers package-lock.json', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  const hasPackageLock = result.targets.some(t => t.includes('package-lock.json'));
  assert.ok(hasPackageLock, 'package-lock.json should be a sync target');
});

test('sync-version covers the Claude adapter launcher manifest', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(
    result.targets.includes('adapters/claude/.mcp.json'),
    'adapters/claude/.mcp.json should be a sync target'
  );
});

test('sync-version detects Claude marketplace nested plugin version drift', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const marketplacePath = path.join(ROOT, '.claude-plugin', 'marketplace.json');
  const original = fs.readFileSync(marketplacePath, 'utf8');
  const marketplace = JSON.parse(original);

  try {
    marketplace.plugins[0].version = '0.0.1';
    fs.writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n');
    const result = syncVersion({ checkOnly: true });
    assert.ok(
      result.drifted.some((entry) => entry.file === '.claude-plugin/marketplace.json' && entry.field === 'plugins[0].version'),
      `expected Claude marketplace nested plugin version drift, found: ${JSON.stringify(result.drifted)}`
    );
  } finally {
    fs.writeFileSync(marketplacePath, original);
  }
});

test('sync-version covers the MCP stdio server metadata file', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(
    result.targets.includes('adapters/mcp/server-stdio.js'),
    'adapters/mcp/server-stdio.js should be a sync target'
  );
});

test('sync-version covers public MCP discovery manifests', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(
    result.targets.includes('.well-known/mcp/server-card.json'),
    '.well-known/mcp/server-card.json should be a sync target'
  );
});

test('sync-version covers the generated numbers page version markers', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(
    result.targets.includes('public/numbers.html'),
    'public/numbers.html should be a sync target'
  );
});

test('sync-version no longer tracks an embedded pro package manifest', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.equal(result.targets.includes('pro/package.json'), false);
});

test('sync-version covers codex plugin manifests', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(
    result.targets.includes('plugins/codex-profile/.codex-plugin/plugin.json'),
    'plugins/codex-profile/.codex-plugin/plugin.json should be a sync target'
  );
  assert.ok(
    result.targets.includes('plugins/codex-profile/.mcp.json'),
    'plugins/codex-profile/.mcp.json should be a sync target'
  );
  assert.ok(
    result.targets.includes('plugins/claude-codex-bridge/.claude-plugin/plugin.json'),
    'plugins/claude-codex-bridge/.claude-plugin/plugin.json should be a sync target'
  );
  assert.ok(
    result.targets.includes('plugins/claude-codex-bridge/.mcp.json'),
    'plugins/claude-codex-bridge/.mcp.json should be a sync target'
  );
});

test('sync-version detects and repairs Codex marketplace pack versioned bundle URLs', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const { version } = require('../package.json');
  const markdownPath = path.join(ROOT, 'docs', 'marketing', 'codex-marketplace-revenue-pack.md');
  const jsonPath = path.join(ROOT, 'docs', 'marketing', 'codex-marketplace-revenue-pack.json');
  const originalMarkdown = fs.readFileSync(markdownPath, 'utf8');
  const originalJson = fs.readFileSync(jsonPath, 'utf8');
  const driftedUrl = 'https://github.com/IgorGanapolsky/ThumbGate/releases/download/v0.0.1/thumbgate-codex-plugin-v0.0.1.zip';
  const expectedUrl = `https://github.com/IgorGanapolsky/ThumbGate/releases/download/v${version}/thumbgate-codex-plugin-v${version}.zip`;

  try {
    fs.writeFileSync(
      markdownPath,
      originalMarkdown.replace(/https:\/\/github\.com\/IgorGanapolsky\/ThumbGate\/releases\/download\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/thumbgate-codex-plugin-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.zip/g, driftedUrl)
    );
    fs.writeFileSync(
      jsonPath,
      originalJson.replace(/https:\/\/github\.com\/IgorGanapolsky\/ThumbGate\/releases\/download\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/thumbgate-codex-plugin-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.zip/g, driftedUrl)
    );

    const checkResult = syncVersion({ checkOnly: true });
    assert.ok(
      checkResult.targets.includes('docs/marketing/codex-marketplace-revenue-pack.md'),
      'Codex marketplace markdown pack should be a sync target'
    );
    assert.ok(
      checkResult.targets.includes('docs/marketing/codex-marketplace-revenue-pack.json'),
      'Codex marketplace JSON pack should be a sync target'
    );
    assert.ok(
      checkResult.drifted.some((entry) => entry.file === 'docs/marketing/codex-marketplace-revenue-pack.md' && entry.field === 'codex-versioned-bundle-url'),
      `expected markdown Codex bundle URL drift, found: ${JSON.stringify(checkResult.drifted)}`
    );
    assert.ok(
      checkResult.drifted.some((entry) => entry.file === 'docs/marketing/codex-marketplace-revenue-pack.json' && entry.field === 'codex-versioned-bundle-url'),
      `expected JSON Codex bundle URL drift, found: ${JSON.stringify(checkResult.drifted)}`
    );

    const repairResult = syncVersion({ checkOnly: false });
    assert.ok(
      repairResult.drifted.some((entry) => entry.file === 'docs/marketing/codex-marketplace-revenue-pack.md' && entry.field === 'codex-versioned-bundle-url'),
      `expected markdown repair drift, found: ${JSON.stringify(repairResult.drifted)}`
    );
    assert.ok(
      repairResult.drifted.some((entry) => entry.file === 'docs/marketing/codex-marketplace-revenue-pack.json' && entry.field === 'codex-versioned-bundle-url'),
      `expected JSON repair drift, found: ${JSON.stringify(repairResult.drifted)}`
    );

    assert.ok(fs.readFileSync(markdownPath, 'utf8').includes(expectedUrl), 'markdown pack should use the package version');
    assert.ok(fs.readFileSync(jsonPath, 'utf8').includes(expectedUrl), 'JSON pack should use the package version');
  } finally {
    fs.writeFileSync(markdownPath, originalMarkdown);
    fs.writeFileSync(jsonPath, originalJson);
  }
});

test('sync-version detects landing page hero badge drift without relying on trailing punctuation', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const landingPath = path.join(ROOT, 'public', 'index.html');
  const original = fs.readFileSync(landingPath, 'utf8');

  try {
    fs.writeFileSync(landingPath, original.replace(/<meta name="thumbgate-version" content="\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?">/, '<meta name="thumbgate-version" content="0.0.1">'));
    const result = syncVersion({ checkOnly: true });
    assert.ok(
      result.drifted.some((entry) => entry.file === 'public/index.html' && entry.field === 'hero-release-note'),
      `expected hero badge drift, found: ${JSON.stringify(result.drifted)}`
    );
  } finally {
    fs.writeFileSync(landingPath, original);
  }
});

test('sync-version detects public landing footer drift', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const publicIndexPath = path.join(ROOT, 'public', 'index.html');
  const original = fs.readFileSync(publicIndexPath, 'utf8');

  try {
    fs.writeFileSync(
      publicIndexPath,
      original.replace(/MIT License · (?:npm )?v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/, 'MIT License · npm v0.0.1')
    );
    const result = syncVersion({ checkOnly: true });
    assert.ok(
      result.drifted.some((entry) => entry.file === 'public/index.html' && entry.field === 'footer-version'),
      `expected footer drift, found: ${JSON.stringify(result.drifted)}`
    );
  } finally {
    fs.writeFileSync(publicIndexPath, original);
  }
});

test('sync-version updates multiple public landing markers in one pass', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const { version } = require('../package.json');
  const publicIndexPath = path.join(ROOT, 'public', 'index.html');
  const original = fs.readFileSync(publicIndexPath, 'utf8');
  const drifted = original
    .replace(/<meta name="thumbgate-version" content="\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?">/, '<meta name="thumbgate-version" content="0.0.1">')
    .replace(/MIT License · (?:npm )?v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/, 'MIT License · npm v0.0.1');

  try {
    fs.writeFileSync(publicIndexPath, drifted);
    const result = syncVersion({ checkOnly: false });
    assert.ok(
      result.drifted.some((entry) => entry.file === 'public/index.html' && entry.field === 'hero-release-note'),
      `expected hero drift, found: ${JSON.stringify(result.drifted)}`
    );
    assert.ok(
      result.drifted.some((entry) => entry.file === 'public/index.html' && entry.field === 'footer-version'),
      `expected footer drift, found: ${JSON.stringify(result.drifted)}`
    );

    const synced = fs.readFileSync(publicIndexPath, 'utf8');
    assert.ok(synced.includes(`<meta name="thumbgate-version" content="${version}">`), 'hero marker should be synced');
    assert.ok(synced.includes(`MIT License · npm v${version}`), 'footer marker should be synced');
  } finally {
    fs.writeFileSync(publicIndexPath, original);
  }
});

test('sync-version detects and repairs public numbers page version drift', serial, () => {
  const { syncVersion } = require('../scripts/sync-version');
  const { version } = require('../package.json');
  const numbersPath = path.join(ROOT, 'public', 'numbers.html');
  const original = fs.readFileSync(numbersPath, 'utf8');
  const drifted = original
    .replace(/"softwareVersion": "\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?"/, '"softwareVersion": "0.0.1"')
    .replace(/Updated:\s*\d{4}-\d{2}-\d{2}\s*·\s*Version\s+\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/, 'Updated: 2026-05-07 · Version 0.0.1');

  try {
    fs.writeFileSync(numbersPath, drifted);
    const result = syncVersion({ checkOnly: false });
    assert.ok(
      result.drifted.some((entry) => entry.file === 'public/numbers.html' && entry.field === 'softwareVersion'),
      `expected softwareVersion drift, found: ${JSON.stringify(result.drifted)}`
    );
    assert.ok(
      result.drifted.some((entry) => entry.file === 'public/numbers.html' && entry.field === 'freshness-version'),
      `expected freshness version drift, found: ${JSON.stringify(result.drifted)}`
    );

    const synced = fs.readFileSync(numbersPath, 'utf8');
    assert.ok(synced.includes(`"softwareVersion": "${version}"`), 'softwareVersion should be synced');
    assert.match(synced, new RegExp(`Updated:\\s*\\d{4}-\\d{2}-\\d{2}\\s*·\\s*Version\\s+${version.replaceAll('.', '\\.')}`));
  } finally {
    fs.writeFileSync(numbersPath, original);
  }
});
