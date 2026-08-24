'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  generateFrontmatter,
  parseFrontmatter,
  validateNoteFrontmatter,
  generateBasesDatabaseView,
  syncVaultDatabases
} = require('../scripts/obsidian-bases-synchronizer.js');

test('Obsidian Bases Synchronizer - Frontmatter Serialization & Parsing', () => {
  const props = {
    title: 'Test Note',
    pr_number: 3611,
    status: 'ACTIVE',
    tags: ['ai-agent', 'pr-tracking'],
    nested_config: { strict: true }
  };

  const yamlStr = generateFrontmatter(props);
  assert.ok(yamlStr.startsWith('---'));
  assert.ok(yamlStr.endsWith('---'));
  assert.ok(yamlStr.includes('pr_number: 3611'));
  assert.ok(yamlStr.includes('- "ai-agent"'));

  const parsed = parseFrontmatter(`${yamlStr}\n\n# Main Note Heading\nBody content.`);
  assert.equal(parsed.frontmatter.title, 'Test Note');
  assert.equal(parsed.frontmatter.pr_number, 3611);
  assert.equal(parsed.frontmatter.status, 'ACTIVE');
  assert.deepEqual(parsed.frontmatter.tags, ['ai-agent', 'pr-tracking']);
  assert.ok(parsed.body.includes('# Main Note Heading'));
});

test('Obsidian Bases Synchronizer - Schema & Property Validation', () => {
  const validNote = `---
id: "task-1"
status: "DONE"
assigned_agent: "CTO-Agent"
---
# Content`;

  const validationSuccess = validateNoteFrontmatter(validNote, ['id', 'status', 'assigned_agent']);
  assert.equal(validationSuccess.valid, true);
  assert.equal(validationSuccess.missing.length, 0);

  const invalidNote = `---
id: "task-1"
---
# Content`;

  const validationFailure = validateNoteFrontmatter(invalidNote, ['id', 'status', 'assigned_agent']);
  assert.equal(validationFailure.valid, false);
  assert.deepEqual(validationFailure.missing, ['status', 'assigned_agent']);
});

test('Obsidian Bases Synchronizer - Generates Dataview Database Views', () => {
  const viewContent = generateBasesDatabaseView('Pull-Requests', {
    title: 'Active Pull Requests',
    folder: 'Pull-Requests',
    columns: ['file.link AS "PR"', 'status AS "Status"'],
    sort: 'pr_number DESC'
  });

  assert.ok(viewContent.includes('# 🗄️ Active Pull Requests'));
  assert.ok(viewContent.includes('```dataview'));
  assert.ok(viewContent.includes('TABLE file.link AS "PR", status AS "Status"'));
  assert.ok(viewContent.includes('FROM "Pull-Requests"'));
});

test('Obsidian Bases Synchronizer - Synchronizes Vault Structure to Temp Directory', () => {
  const tmpVault = path.join(os.tmpdir(), `test-obsidian-vault-${Date.now()}`);
  
  const sampleData = {
    prs: [
      { number: 3611, title: 'Sentinel Fix', branch: 'fix/sentinel', status: 'READY', ciState: 'PASS' },
      { number: 3612, title: 'OneLeet Pentest', branch: 'feat/oneleet', status: 'READY', ciState: 'PASS' }
    ],
    gates: [
      { gateId: 'gate_ai_liability_defense_2026', name: 'AI Liability Gate', framework: 'EU AI Act', enforcementMode: 'fail_closed' }
    ]
  };

  const result = syncVaultDatabases(tmpVault, sampleData);
  assert.equal(result.synced, true);
  assert.equal(result.writtenFiles, 5); // 2 DB views + 2 PR notes + 1 Gate note

  // Check generated files
  assert.ok(fs.existsSync(path.join(tmpVault, '00-Databases', 'Active-PRs.md')));
  assert.ok(fs.existsSync(path.join(tmpVault, '00-Databases', 'Security-Gates.md')));
  assert.ok(fs.existsSync(path.join(tmpVault, 'Pull-Requests', 'PR-3611.md')));
  assert.ok(fs.existsSync(path.join(tmpVault, 'Security-Gates', 'gate_ai_liability_defense_2026.md')));

  // Clean up
  fs.rmSync(tmpVault, { recursive: true, force: true });
});
