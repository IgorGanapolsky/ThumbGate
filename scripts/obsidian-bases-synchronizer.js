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
 * Generate an Obsidian Bases / Dataview database hub note.
 *
 * @param {string} category - Database category name
 * @param {Object} config - { title, folder, columns, sort, filter }
 * @returns {string} Complete Markdown document with Dataview query & Bases metadata
 */
function generateBasesDatabaseView(category = '', config = {}) {
  const title = config.title || `${category} Database`;
  const folder = config.folder || category;
  const columns = config.columns || ['file.link AS "Name"', 'status AS "Status"', 'last_updated AS "Updated"'];
  const sort = config.sort || 'last_updated DESC';
  const filter = config.filter ? `WHERE ${config.filter}` : '';

  const frontmatter = generateFrontmatter({
    database_type: 'obsidian_bases_v1',
    category,
    generated_at: new Date().toISOString(),
    managed_by: 'ThumbGate-Obsidian-Bases-Sync',
    tags: ['database', 'obsidian-bases', category.toLowerCase()]
  });

  return `${frontmatter}

# 🗄️ ${title}

> Auto-managed by **ThumbGate Obsidian Bases Synchronizer**.
> Powered by Obsidian Properties & Dataview database queries.

\`\`\`dataview
TABLE ${columns.join(', ')}
FROM "${folder}"
${filter}
SORT ${sort}
\`\`\`

---
*Last synchronized: ${new Date().toISOString()}*
`;
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
  if (!fs.existsSync(vaultPath)) {
    if (options.dryRun) {
      return { synced: false, reason: 'VAULT_DIRECTORY_NOT_FOUND', writtenFiles: 0 };
    }
    fs.mkdirSync(vaultPath, { recursive: true });
  }

  const dbDir = path.join(vaultPath, '00-Databases');
  const prsDir = path.join(vaultPath, 'Pull-Requests');
  const gatesDir = path.join(vaultPath, 'Security-Gates');
  const tasksDir = path.join(vaultPath, 'Agent-Tasks');
  const auditsDir = path.join(vaultPath, 'Supply-Chain-Audits');

  [dbDir, prsDir, gatesDir, tasksDir, auditsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  let writtenFiles = 0;

  // 1. Sync Active PRs Database
  const prDbContent = generateBasesDatabaseView('Pull-Requests', {
    title: 'Active Pull Requests & Merge Queue',
    folder: 'Pull-Requests',
    columns: ['file.link AS "PR"', 'pr_number AS "#"', 'status AS "Status"', 'ci_state AS "CI"', 'assigned_agent AS "Agent"', 'risk_rating AS "Risk"'],
    sort: 'pr_number DESC'
  });
  fs.writeFileSync(path.join(dbDir, 'Active-PRs.md'), prDbContent, 'utf8');
  writtenFiles++;

  if (Array.isArray(data.prs)) {
    for (const pr of data.prs) {
      const prFrontmatter = generateFrontmatter({
        id: `pr-${pr.number}`,
        pr_number: pr.number,
        title: pr.title,
        branch: pr.branch,
        status: pr.status || 'OPEN',
        ci_state: pr.ciState || 'PENDING',
        assigned_agent: pr.assignedAgent || 'CTO-Agent',
        risk_rating: pr.riskRating || 'LOW',
        last_updated: new Date().toISOString(),
        tags: ['pr', pr.status?.toLowerCase() || 'open']
      });
      const noteContent = `${prFrontmatter}\n\n# PR #${pr.number}: ${pr.title}\n\n- **Branch**: \`${pr.branch}\`\n- **CI State**: ${pr.ciState || 'PENDING'}\n- **Summary**: ${pr.summary || 'In-flight PR tracking.'}\n`;
      fs.writeFileSync(path.join(prsDir, `PR-${pr.number}.md`), noteContent, 'utf8');
      writtenFiles++;
    }
  }

  // 2. Sync Security Gates Database
  const gatesDbContent = generateBasesDatabaseView('Security-Gates', {
    title: 'Security Gates & Liability Enforcers',
    folder: 'Security-Gates',
    columns: ['file.link AS "Gate"', 'gate_id AS "ID"', 'enforcement_mode AS "Mode"', 'framework AS "Framework"', 'severity AS "Severity"'],
    sort: 'file.name ASC'
  });
  fs.writeFileSync(path.join(dbDir, 'Security-Gates.md'), gatesDbContent, 'utf8');
  writtenFiles++;

  if (Array.isArray(data.gates)) {
    for (const gate of data.gates) {
      const gateFrontmatter = generateFrontmatter({
        id: gate.gateId,
        gate_id: gate.gateId,
        name: gate.name,
        framework: gate.framework,
        enforcement_mode: gate.enforcementMode || 'fail_closed',
        severity: gate.severity || 'CRITICAL',
        last_evaluated: new Date().toISOString(),
        tags: ['security-gate', 'liability-defense']
      });
      const noteContent = `${gateFrontmatter}\n\n# Gate: ${gate.name}\n\n- **Gate ID**: \`${gate.gateId}\`\n- **Framework**: ${gate.framework}\n- **Mode**: \`${gate.enforcementMode}\`\n`;
      fs.writeFileSync(path.join(gatesDir, `${gate.gateId}.md`), noteContent, 'utf8');
      writtenFiles++;
    }
  }

  return {
    synced: true,
    vaultPath,
    writtenFiles,
    timestamp: new Date().toISOString()
  };
}

if (require.main === module) {
  const vault = process.argv[2] || DEFAULT_VAULT_PATH;
  const result = syncVaultDatabases(vault, {
    prs: [{ number: 3611, title: 'Sentinel Classifier Fix', branch: 'fix/resolve-issue-3595-3593-sentinel-and-hermes-hosted', status: 'READY', ciState: 'PASS' }],
    gates: [{ gateId: 'gate_ai_liability_defense_2026', name: 'AI Liability Defense Gate', framework: 'ImmuniWeb / EU AI Act', enforcementMode: 'fail_closed', severity: 'CRITICAL' }]
  });
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  generateFrontmatter,
  parseFrontmatter,
  validateNoteFrontmatter,
  generateBasesDatabaseView,
  syncVaultDatabases
};
