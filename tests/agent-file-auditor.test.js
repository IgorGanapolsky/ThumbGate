'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  RECOMMENDED_LINE_CEILING,
  CRITICAL_LINE_CEILING,
  auditContextFile,
  auditSkillFile,
  auditAgentFiles,
  formatAgentAuditReport,
} = require('../scripts/agent-file-auditor');

describe('Agent File & Skill Auditor', () => {
  test('auditContextFile detects line count, token estimation, and health score', () => {
    const sampleClaudeMd = `
# Guidelines
- Rule 1: do this
- Rule 2: do that
    `.trim();

    const res = auditContextFile('CLAUDE.md', sampleClaudeMd);
    assert.equal(res.filePath, 'CLAUDE.md');
    assert.equal(res.lineCount, 3);
    assert.ok(res.estimatedTokens > 0);
    assert.equal(res.healthScore, 100);
    assert.equal(res.smellCount, 0);
  });

  test('auditContextFile flags context bloat, lint leakage, and generic advice', () => {
    const bloatedContent = Array(250).fill('line of instruction').join('\n') + '\nwrite clean code\nrun eslint --fix\nNEVER bypass branch protection without approval';

    const res = auditContextFile('AGENTS.md', bloatedContent);
    assert.equal(res.filePath, 'AGENTS.md');
    assert.ok(res.lineCount > 200);
    assert.ok(res.smells.some((s) => s.type === 'context_bloat'));
    assert.ok(res.smells.some((s) => s.type === 'lint_leakage'));
    assert.ok(res.smells.some((s) => s.type === 'generic_prose'));
    assert.ok(res.smells.some((s) => s.type === 'unenforced_critical_rules'));
    assert.ok(res.healthScore < 100);
  });

  test('auditSkillFile validates YAML frontmatter, triggers, and examples', () => {
    const validSkill = `---
name: test-skill
description: A useful test skill for verification.
---

# Test Skill

Use this skill when running test automations.

## Examples
\`\`\`bash
node run.js
\`\`\`
    `.trim();

    const res = auditSkillFile('skills/test-skill/SKILL.md', validSkill);
    assert.equal(res.skillName, 'test-skill');
    assert.equal(res.isHighQuality, true);
    assert.ok(res.qualityScore >= 80);
    assert.equal(res.smells.length, 0);
  });

  test('auditSkillFile penalizes missing frontmatter or lack of triggers/examples', () => {
    const poorSkill = `
# Just a random markdown file without frontmatter or examples
Do something here.
    `.trim();

    const res = auditSkillFile('skills/bad-skill/SKILL.md', poorSkill);
    assert.equal(res.skillName, 'bad-skill');
    assert.equal(res.isHighQuality, false);
    assert.ok(res.qualityScore < 60);
    assert.ok(res.smells.some((s) => s.type === 'missing_frontmatter'));
    assert.ok(res.smells.some((s) => s.type === 'missing_triggers'));
    assert.ok(res.smells.some((s) => s.type === 'missing_examples'));
  });

  test('auditAgentFiles runs full workspace scan and generates clean report', () => {
    const repoRoot = __dirname + '/..';
    const audit = auditAgentFiles({ repoRoot });

    assert.ok(audit.overallScore > 0);
    assert.ok(audit.contextFilesCount > 0);
    assert.ok(audit.contextFiles.some((f) => f.filePath === 'CLAUDE.md'));

    const report = formatAgentAuditReport(audit);
    assert.match(report, /Agent Configuration & Skills Hygiene Audit/);
    assert.match(report, /Overall Environment Score/);
  });
});
