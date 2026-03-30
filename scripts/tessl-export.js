#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config', 'tessl-tiles.json');
const DEFAULT_OUT_DIR = path.join(ROOT, '.artifacts', 'tessl');
const DEFAULT_SKILLS_DIR = path.join(ROOT, 'skills');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
}

function stripQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split('\n');
  const frontmatter = {};

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const rawValue = keyMatch[2];

    if (rawValue === '>' || rawValue === '|') {
      const folded = rawValue === '>';
      const chunks = [];
      let nextIndex = index + 1;

      while (nextIndex < lines.length) {
        const continuation = lines[nextIndex];
        if (/^[A-Za-z0-9_-]+:\s*/.test(continuation)) break;
        if (!continuation.startsWith('  ')) break;
        chunks.push(continuation.trim());
        nextIndex++;
      }

      frontmatter[key] = folded ? chunks.join(' ').trim() : chunks.join('\n').trim();
      index = nextIndex - 1;
      continue;
    }

    if (rawValue === '') {
      const values = [];
      let nextIndex = index + 1;

      while (nextIndex < lines.length) {
        const continuation = lines[nextIndex];
        if (!continuation.startsWith('  - ')) break;
        values.push(stripQuotes(continuation.slice(4)));
        nextIndex++;
      }

      frontmatter[key] = values;
      index = nextIndex - 1;
      continue;
    }

    frontmatter[key] = stripQuotes(rawValue);
  }

  return frontmatter;
}

function parseSkillMetadata(skillDir) {
  const skillPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Missing SKILL.md in ${skillDir}`);
  }

  const content = fs.readFileSync(skillPath, 'utf8');
  const frontmatter = parseFrontmatter(content);

  if (!frontmatter || !frontmatter.name || !frontmatter.description) {
    throw new Error(`Invalid SKILL frontmatter in ${skillPath}`);
  }

  return {
    dirName: path.basename(skillDir),
    skillPath,
    frontmatter,
  };
}

function loadTileConfig(configPath = DEFAULT_CONFIG_PATH) {
  const config = readJson(configPath);

  if (!Array.isArray(config.tiles) || config.tiles.length === 0) {
    throw new Error('config/tessl-tiles.json must declare at least one tile');
  }

  return config;
}

function resolveWorkspace(config, overrideWorkspace) {
  return overrideWorkspace || process.env.TESSL_WORKSPACE || config.defaultWorkspace || 'thumbgate';
}

function buildTileManifest(tile, workspace, packageVersion, skillEntries) {
  const skills = {};

  for (const skill of skillEntries) {
    skills[skill.dirName] = {
      path: `skills/${skill.dirName}/SKILL.md`,
    };
  }

  return {
    name: `${workspace}/${tile.tileName}`,
    version: packageVersion,
    summary: tile.summary,
    private: Boolean(tile.private),
    docs: 'index.md',
    skills,
  };
}

function renderTileDocs(tile, manifest, skillEntries, proofLinks) {
  const skillNames = skillEntries.map((entry) => `\`${entry.frontmatter.name}\``).join(', ');
  const installCommand = `tessl install ${manifest.name}`;

  return [
    `# ${manifest.name}`,
    '',
    tile.summary,
    '',
    '## Included skills',
    '',
    `- ${skillNames}`,
    '',
    '## Install',
    '',
    '```bash',
    installCommand,
    '```',
    '',
    '## Why this tile exists',
    '',
    'ThumbGate uses thumbs up and thumbs down feedback to build structured memory, generate prevention rules, and block repeated agent mistakes before execution.',
    '',
    '## Proof',
    '',
    `- Verification evidence: ${proofLinks.verificationEvidence}`,
    `- Compatibility report: ${proofLinks.compatibilityReport}`,
    `- Automation report: ${proofLinks.automationReport}`,
    '',
    '## Source of truth',
    '',
    ...skillEntries.map((entry) => `- Generated from \`skills/${entry.dirName}/SKILL.md\``),
    '',
  ].join('\n');
}

function exportTiles({
  configPath = DEFAULT_CONFIG_PATH,
  outDir = DEFAULT_OUT_DIR,
  workspace,
  clean = true,
  skillsDir = DEFAULT_SKILLS_DIR,
} = {}) {
  const config = loadTileConfig(configPath);
  const packageJson = readJson(path.join(ROOT, 'package.json'));
  const activeWorkspace = resolveWorkspace(config, workspace);

  if (clean) {
    cleanDir(outDir);
  } else {
    ensureDir(outDir);
  }

  const results = [];

  for (const tile of config.tiles) {
    if (!Array.isArray(tile.sourceSkills) || tile.sourceSkills.length === 0) {
      throw new Error(`Tile ${tile.id || tile.tileName} must declare sourceSkills`);
    }

    const tileDir = path.join(outDir, tile.tileName);
    const tileSkillsDir = path.join(tileDir, 'skills');
    ensureDir(tileSkillsDir);

    const skillEntries = tile.sourceSkills.map((skillName) => {
      const sourceDir = path.join(skillsDir, skillName);
      const destinationDir = path.join(tileSkillsDir, skillName);
      const metadata = parseSkillMetadata(sourceDir);

      fs.cpSync(sourceDir, destinationDir, { recursive: true });
      return metadata;
    });

    const manifest = buildTileManifest(tile, activeWorkspace, packageJson.version, skillEntries);
    const docs = renderTileDocs(tile, manifest, skillEntries, config.proofLinks);

    fs.writeFileSync(path.join(tileDir, 'tile.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(tileDir, 'index.md'), `${docs}\n`);

    results.push({
      id: tile.id,
      tileName: tile.tileName,
      manifestName: manifest.name,
      directory: tileDir,
      skillCount: skillEntries.length,
      skills: skillEntries.map((entry) => entry.dirName),
    });
  }

  return results;
}

function verifyTiles(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-tessl-verify-'));

  try {
    const results = exportTiles({
      ...options,
      outDir: tempDir,
      clean: true,
    });

    for (const result of results) {
      const tileDir = path.join(tempDir, result.tileName);
      const manifestPath = path.join(tileDir, 'tile.json');
      const docsPath = path.join(tileDir, 'index.md');
      const manifest = readJson(manifestPath);
      const docs = fs.readFileSync(docsPath, 'utf8');

      if (!manifest.name.includes('/')) {
        throw new Error(`${result.tileName} manifest must use workspace/tile format`);
      }
      if (!manifest.version) {
        throw new Error(`${result.tileName} manifest is missing version`);
      }
      if (manifest.docs !== 'index.md') {
        throw new Error(`${result.tileName} manifest must point docs to index.md`);
      }
      if (!manifest.skills || Object.keys(manifest.skills).length === 0) {
        throw new Error(`${result.tileName} manifest must declare skills`);
      }
      if (!docs.includes('Verification evidence')) {
        throw new Error(`${result.tileName} docs are missing proof links`);
      }

      for (const [skillName, spec] of Object.entries(manifest.skills)) {
        const exportedSkillPath = path.join(tileDir, spec.path);
        if (!fs.existsSync(exportedSkillPath)) {
          throw new Error(`${result.tileName} is missing exported skill ${skillName}`);
        }

        const skillFrontmatter = parseFrontmatter(fs.readFileSync(exportedSkillPath, 'utf8'));
        if (!skillFrontmatter || !skillFrontmatter.name || !skillFrontmatter.description) {
          throw new Error(`${result.tileName} exported skill ${skillName} has invalid frontmatter`);
        }
      }
    }

    return {
      ok: true,
      tileCount: results.length,
      tiles: results.map((result) => result.manifestName),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = {
    command: 'export',
    outDir: DEFAULT_OUT_DIR,
    workspace: null,
    clean: true,
    json: false,
  };

  for (const token of argv) {
    if (token === 'export' || token === 'verify') {
      args.command = token;
    } else if (token === '--json') {
      args.json = true;
    } else if (token === '--no-clean') {
      args.clean = false;
    } else if (token.startsWith('--out-dir=')) {
      args.outDir = path.resolve(token.slice('--out-dir='.length));
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else {
      throw new Error(`Unsupported argument: ${token}`);
    }
  }

  return args;
}

function printResults(result, emitJson) {
  if (emitJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (Array.isArray(result)) {
    console.log(`Exported ${result.length} Tessl tile(s):`);
    for (const tile of result) {
      console.log(`- ${tile.manifestName} -> ${tile.directory}`);
    }
    return;
  }

  console.log(`Verified ${result.tileCount} Tessl tile(s): ${result.tiles.join(', ')}`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const action = args.command === 'verify' ? verifyTiles : exportTiles;
  const result = action({
    outDir: args.outDir,
    workspace: args.workspace,
    clean: args.clean,
  });
  printResults(result, args.json);
  return result;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_OUT_DIR,
  buildTileManifest,
  exportTiles,
  loadTileConfig,
  parseFrontmatter,
  parseSkillMetadata,
  renderTileDocs,
  resolveWorkspace,
  runCli,
  verifyTiles,
};
