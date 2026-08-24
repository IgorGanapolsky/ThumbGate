'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_VAULT_PATH = path.join(process.env.HOME || '', 'Documents', 'AI-Agent-Sync');

/**
 * Serialize JavaScript properties into Obsidian YAML Frontmatter.
 * Adheres to Obsidian Properties / Bases spec.
 *
 * @param {Object} props - Key/value dictionary of properties
 * @returns {string} Formatted YAML frontmatter string with --- fences
 */
function generateFrontmatter(props = {}) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${JSON.stringify(item)}`);
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === 'string') {
      if (value.includes('\n') || value.includes(':') || value.includes('"')) {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Parse Obsidian YAML Frontmatter from a Markdown note.
 *
 * @param {string} content - Full markdown note content
 * @returns {Object} { frontmatter: Object, body: string }
 */
function parseFrontmatter(content = '') {
  const text = String(content || '').trimStart();
  if (!text.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = text.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const rawYaml = text.slice(3, endIndex).trim();
  const body = text.slice(endIndex + 4).trimStart();
  const frontmatter = {};

  const lines = rawYaml.split('\n');
  let currentKey = null;
  let inArray = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (line.startsWith('  - ') && currentKey && inArray) {
      const valStr = line.slice(4).trim();
      try {
        frontmatter[currentKey].push(JSON.parse(valStr));
      } catch (e) {
        frontmatter[currentKey].push(valStr.replace(/^["']|["']$/g, ''));
      }
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const valStr = line.slice(colonIdx + 1).trim();

      if (!valStr) {
        currentKey = key;
        inArray = true;
        frontmatter[key] = [];
      } else {
        currentKey = null;
        inArray = false;
        try {
          frontmatter[key] = JSON.parse(valStr);
        } catch (e) {
          frontmatter[key] = valStr.replace(/^["']|["']$/g, '');
        }
      }
    }
  }

  return { frontmatter, body };
}

/**
 * Validate note frontmatter against required schema keys and types.
 *
 * @param {string} content - Markdown file content
 * @param {Array<string>} requiredProperties - Required frontmatter keys
 * @returns {Object} { valid: boolean, missing: Array<string>, properties: Object }
 */
function validateNoteFrontmatter(content = '', requiredProperties = []) {
  const { frontmatter } = parseFrontmatter(content);
  const missing = [];

  for (const req of requiredProperties) {
    if (frontmatter[req] === undefined || frontmatter[req] === null || frontmatter[req] === '') {
      missing.push(req);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    properties: frontmatter
  };
}

/**
 * Generate a real Obsidian Bases (core plugin, 1.9+) `.base` file.
 * MakeUseOf 2026-08-18: Bases reads YAML properties into an editable table.
 * Dataview is the old workaround — do not emit ```dataview fences.
 *
 * @param {Object} config - { folder, properties, views, extraFilters }
 * @returns {string} YAML matching vault Bases/*.base (filters/properties/views)
 */
function generateBaseFile(config = {}) {
  const folder = config.folder || 'Agent-State';
  const extraFilters = Array.isArray(config.extraFilters) ? config.extraFilters : [];
  const properties = config.properties || {
    'file.name': { displayName: 'Note' },
    type: { displayName: 'Type' },
    status: { displayName: 'Status' },
    last_verified: { displayName: 'Verified' },
  };
  const views = config.views || [
    { type: 'table', name: 'All', order: ['file.name', 'status', 'last_verified'] },
  ];

  const lines = [
    'filters:',
    '  and:',
    '    - file.ext == "md"',
    `    - file.inFolder(${JSON.stringify(folder)})`,
  ];
  for (const extra of extraFilters) {
    lines.push(`    - ${extra}`);
  }
  lines.push('properties:');
  for (const [key, meta] of Object.entries(properties)) {
    lines.push(`  ${key}:`);
    lines.push(`    displayName: ${meta.displayName || key}`);
  }
  lines.push('views:');
  for (const view of views) {
    lines.push(`  - type: ${view.type || 'table'}`);
    lines.push(`    name: ${view.name || 'Table'}`);
    if (Array.isArray(view.order) && view.order.length > 0) {
      lines.push('    order:');
      for (const col of view.order) {
        lines.push(`      - ${col}`);
      }
    }
    if (view.groupBy) {
      lines.push('    groupBy:');
      lines.push(`      property: ${view.groupBy.property || 'status'}`);
      lines.push(`      direction: ${view.groupBy.direction || 'ASC'}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * @deprecated Dataview is not how this vault uses Bases. Prefer generateBaseFile.
 * Kept as an alias that emits a real `.base` document, never a Dataview query.
 */
function generateBasesDatabaseView(category = '', config = {}) {
  return generateBaseFile({
    folder: config.folder || category,
    properties: {
      'file.name': { displayName: 'Note' },
      status: { displayName: 'Status' },
      last_verified: { displayName: 'Verified' },
    },
    views: [
      {
        type: 'table',
        name: config.title || category || 'Table',
        order: ['file.name', 'status', 'last_verified'],
        groupBy: { property: 'status', direction: 'ASC' },
      },
    ],
  });
}

/**
 * Synchronize repository data into Obsidian vault with full Bases / Notion-like database views.
 *
 * @param {string} vaultPath - Path to Obsidian vault
 * @param {Object} data - { prs: Array, gates: Array, tasks: Array, supplyAudits: Array }
 * @param {Object} options - Sync options
 * @returns {Object} Sync statistics
 */
function syncVaultDatabases(vaultPath = DEFAULT_VAULT_PATH, data = {}, options = {}) {
  if (options.dryRun) {
    return { synced: false, reason: 'DRY_RUN', writtenFiles: 0, vaultPath };
  }

  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }

  const basesDir = path.join(vaultPath, 'Bases');
  const notesDir = path.join(vaultPath, 'Handoffs');
  if (!fs.existsSync(basesDir)) fs.mkdirSync(basesDir, { recursive: true });
  if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });

  let writtenFiles = 0;

  const fleetBase = generateBaseFile({
    folder: 'Agent-State',
    properties: {
      'file.name': { displayName: 'Agent' },
      status: { displayName: 'Status' },
      repo: { displayName: 'Repo' },
      github_pr: { displayName: 'PR' },
      last_verified: { displayName: 'Verified' },
      type: { displayName: 'Type' },
    },
    views: [
      {
        type: 'table',
        name: 'Live agents',
        order: ['file.name', 'status', 'repo', 'github_pr', 'last_verified'],
        groupBy: { property: 'status', direction: 'ASC' },
      },
    ],
  });
  fs.writeFileSync(path.join(basesDir, 'Agent Fleet.base'), fleetBase, 'utf8');
  writtenFiles++;

  if (Array.isArray(data.prs)) {
    for (const pr of data.prs) {
      const status = String(pr.status || 'open').toLowerCase();
      const prFrontmatter = generateFrontmatter({
        type: 'handoff',
        agent: String(pr.assignedAgent || 'grok').toLowerCase(),
        status,
        github_pr: pr.url || `https://github.com/IgorGanapolsky/ThumbGate/pull/${pr.number}`,
        last_verified: new Date().toISOString(),
        pr_number: pr.number,
        title: pr.title,
        branch: pr.branch,
      });
      const noteContent = `${prFrontmatter}\n\n# PR #${pr.number}: ${pr.title}\n`;
      fs.writeFileSync(path.join(notesDir, `PR-${pr.number}.md`), noteContent, 'utf8');
      writtenFiles++;
    }
  }

  if (Array.isArray(data.gates)) {
    for (const gate of data.gates) {
      const gateFrontmatter = generateFrontmatter({
        type: 'handoff',
        agent: 'grok',
        status: 'active',
        last_verified: new Date().toISOString(),
        gate_id: gate.gateId,
        name: gate.name,
        certified: false,
      });
      const noteContent = `${gateFrontmatter}\n\n# Gate: ${gate.name}\n`;
      fs.writeFileSync(path.join(notesDir, `${gate.gateId}.md`), noteContent, 'utf8');
      writtenFiles++;
    }
  }

  return {
    synced: true,
    vaultPath,
    writtenFiles,
    usesDataview: false,
    timestamp: new Date().toISOString()
  };
}

function canonicalPath(candidate) {
  const resolved = path.resolve(candidate);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isDirectInvocation() {
  const entryPoint = process.argv[1];
  if (!entryPoint) return false;
  return canonicalPath(entryPoint) === canonicalPath(__filename);
}

if (isDirectInvocation()) {
  const write = process.argv.includes('--write');
  const vaultArg = process.argv.slice(2).find((a) => a !== '--write');
  const vault = vaultArg || DEFAULT_VAULT_PATH;
  if (!write) {
    console.log(JSON.stringify({
      synced: false,
      reason: 'DRY_RUN',
      hint: 'Pass --write and an explicit vault path. Never dumps dummy PRs into ~/Documents/AI-Agent-Sync.',
      vaultPath: vault,
    }, null, 2));
    process.exitCode = 0;
  } else {
    const result = syncVaultDatabases(vault, {}, { dryRun: false });
    console.log(JSON.stringify(result, null, 2));
  }
}

module.exports = {
  generateFrontmatter,
  parseFrontmatter,
  validateNoteFrontmatter,
  generateBaseFile,
  generateBasesDatabaseView,
  syncVaultDatabases
};
