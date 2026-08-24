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
  generateBaseFile,
  generateBasesDatabaseView,
  syncVaultDatabases
} = require('../scripts/obsidian-bases-synchronizer.js');

test('Obsidian Bases Synchronizer - Frontmatter Serialization & Parsing', () => {
  const props = {
    title: 'Test Note',
    pr_number: 3611,
    status: 'active',
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
  assert.equal(parsed.frontmatter.status, 'active');
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

test('Obsidian Bases Synchronizer - Emits real .base YAML not Dataview', () => {
  const viewContent = generateBasesDatabaseView('Agent-State', {
    title: 'Live agents',
    folder: 'Agent-State',
  });

  assert.equal(viewContent.includes('```dataview'), false);
  assert.ok(viewContent.includes('filters:'));
  assert.ok(viewContent.includes('file.inFolder("Agent-State")'));
  assert.ok(viewContent.includes('views:'));
  assert.ok(viewContent.includes('groupBy:'));

  const baseFile = generateBaseFile({ folder: 'Handoffs' });
  assert.ok(baseFile.includes('file.inFolder("Handoffs")'));
  assert.equal(baseFile.includes('```dataview'), false);
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
  assert.equal(result.usesDataview, false);
  assert.equal(result.writtenFiles, 4); // 1 .base + 2 PR notes + 1 gate note

  const basePath = path.join(tmpVault, 'Bases', 'Agent Fleet.base');
  assert.ok(fs.existsSync(basePath));
  const baseBody = fs.readFileSync(basePath, 'utf8');
  assert.equal(baseBody.includes('```dataview'), false);
  assert.ok(baseBody.includes('file.inFolder("Handoffs")'));

  const prNote = fs.readFileSync(path.join(tmpVault, 'Handoffs', 'PR-3611.md'), 'utf8');
  assert.ok(prNote.includes('status: ready'));
  assert.ok(prNote.includes('type: handoff'));
  assert.ok(fs.existsSync(path.join(tmpVault, 'Handoffs', 'gate_ai_liability_defense_2026.md')));

  fs.rmSync(tmpVault, { recursive: true, force: true });
});

test('Obsidian Bases Synchronizer - dryRun never writes', () => {
  const tmpVault = path.join(os.tmpdir(), `test-obsidian-vault-dry-${Date.now()}`);
  const result = syncVaultDatabases(tmpVault, { prs: [] }, { dryRun: true });
  assert.equal(result.synced, false);
  assert.equal(result.reason, 'DRY_RUN');
  assert.equal(fs.existsSync(tmpVault), false);
});
