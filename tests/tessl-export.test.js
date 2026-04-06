'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const {
  exportTiles,
  loadTileConfig,
  parseFrontmatter,
  verifyTiles,
} = require('../scripts/tessl-export');

test('tile config focuses on the two first-party ThumbGate skills with highest Tessl ROI', () => {
  const config = loadTileConfig();
  const tileNames = config.tiles.map((tile) => tile.tileName);

  assert.equal(config.defaultWorkspace, 'thumbgate');
  assert.deepEqual(tileNames, ['agent-memory', 'thumbgate-feedback']);
});

test('exportTiles writes publishable Tessl tile folders with manifests, docs, and copied skills', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-tessl-export-'));

  try {
    const exported = exportTiles({ outDir });
    assert.equal(exported.length, 2);

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'agent-memory', 'tile.json'), 'utf8'));
    const docs = fs.readFileSync(path.join(outDir, 'agent-memory', 'index.md'), 'utf8');
    const skill = fs.readFileSync(path.join(outDir, 'agent-memory', 'skills', 'agent-memory', 'SKILL.md'), 'utf8');

    assert.equal(manifest.name, 'thumbgate/agent-memory');
    assert.equal(manifest.version, require('../package.json').version);
    assert.equal(manifest.docs, 'index.md');
    assert.match(docs, /tessl install thumbgate\/agent-memory/);
    assert.match(docs, /VERIFICATION_EVIDENCE\.md/);
    assert.ok(parseFrontmatter(skill));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('exportTiles supports workspace overrides for publish-time targeting', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-tessl-workspace-'));

  try {
    exportTiles({ outDir, workspace: 'igorganapolsky' });
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'thumbgate-feedback', 'tile.json'), 'utf8'));
    assert.equal(manifest.name, 'igorganapolsky/thumbgate-feedback');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('exportTiles copies all files from richer skill bundles, not just SKILL.md', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-tessl-copy-'));
  const skillsDir = path.join(tempRoot, 'skills');
  const configPath = path.join(tempRoot, 'tessl-tiles.json');
  const outDir = path.join(tempRoot, 'out');

  fs.mkdirSync(path.join(skillsDir, 'solve-architecture-autonomy'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'skills', 'solve-architecture-autonomy', 'SKILL.md'),
    path.join(skillsDir, 'solve-architecture-autonomy', 'SKILL.md')
  );
  fs.copyFileSync(
    path.join(ROOT, 'skills', 'solve-architecture-autonomy', 'tool.js'),
    path.join(skillsDir, 'solve-architecture-autonomy', 'tool.js')
  );
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    defaultWorkspace: 'thumbgate',
    proofLinks: loadTileConfig().proofLinks,
    tiles: [
      {
        id: 'solve-architecture-autonomy',
        tileName: 'solve-architecture-autonomy',
        summary: 'Execution-first recovery skill for repeated autonomy failures.',
        private: true,
        sourceSkills: ['solve-architecture-autonomy'],
      },
    ],
  }, null, 2));

  try {
    exportTiles({ configPath, outDir, skillsDir });
    assert.equal(
      fs.existsSync(path.join(outDir, 'solve-architecture-autonomy', 'skills', 'solve-architecture-autonomy', 'tool.js')),
      true
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('verifyTiles succeeds against the canonical repo configuration', () => {
  const result = verifyTiles();
  assert.equal(result.ok, true);
  assert.equal(result.tileCount, 2);
  assert.deepEqual(result.tiles, ['thumbgate/agent-memory', 'thumbgate/thumbgate-feedback']);
});

test('tessl-export CLI supports verify and JSON output', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/tessl-export.js', 'verify', '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.tileCount, 2);
});
