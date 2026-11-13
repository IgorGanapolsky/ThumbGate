'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { SkillsManager } = require('../src/skills-manager');

test('SkillsManager lists hub skills and calculates context-cost ledger', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-manager-test-'));
  const hubDir = path.join(tmpDir, 'hub');
  const agentClaude = path.join(tmpDir, 'claude-skills');
  const agentCursor = path.join(tmpDir, 'cursor-skills');

  fs.mkdirSync(path.join(hubDir, 'git-hygiene'), { recursive: true });
  fs.writeFileSync(path.join(hubDir, 'git-hygiene', 'SKILL.md'), '# Git Hygiene\nEnsure clean commits and no force push.');

  fs.mkdirSync(path.join(hubDir, 'db-migrator'), { recursive: true });
  fs.writeFileSync(path.join(hubDir, 'db-migrator', 'SKILL.md'), '# DB Migrator\nZero-downtime double-write and shadow-read.');

  const manager = new SkillsManager({
    hubDir,
    agentTargets: {
      claude: agentClaude,
      cursor: agentCursor,
    },
  });

  const skills = manager.listHubSkills();
  assert.equal(skills.length, 2);
  const gitSkill = skills.find((s) => s.name === 'git-hygiene');
  assert.ok(gitSkill);
  assert.ok(gitSkill.treeSha);
  assert.ok(gitSkill.estimatedTokens > 0);

  // Distribute skill via symlink
  const dist = manager.distributeSkill('git-hygiene', ['claude', 'cursor'], 'symlink');
  assert.ok(dist.claude.ok);
  assert.ok(dist.cursor.ok);
  assert.ok(fs.existsSync(path.join(agentClaude, 'git-hygiene', 'SKILL.md')));

  // Generate context cost ledger
  const ledger = manager.generateContextCostLedger({ budgetPerAgentTokens: 1000 });
  assert.equal(ledger.agents.claude.installedCount, 1);
  assert.equal(ledger.warnings.length, 0);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
