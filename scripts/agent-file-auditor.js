#!/usr/bin/env node
/**
 * agent-file-auditor.js — Audit CLAUDE.md, AGENTS.md, GEMINI.md, and Agent Skills
 * based on Addy Osmani's "Audit Your Agent Files" & Anthropic Context Engineering guidance.
 *
 * Checks:
 *   1. Line count vs 200-line recommended ceiling (Anthropic target).
 *   2. Context bloat & estimated token footprint.
 *   3. Configuration smells: lint leakage, generic prose, unenforced rules.
 *   4. Skill quality scoring: YAML frontmatter, trigger keywords, step guidance, examples.
 *   5. Actionable pruning and gate conversion recommendations.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RECOMMENDED_LINE_CEILING = 200;
const CRITICAL_LINE_CEILING = 500;

const LINT_LEAKAGE_PATTERNS = [
  /eslint\b/i,
  /prettier\b/i,
  /flake8\b/i,
  /rubocop\b/i,
  /cargo clippy\b/i,
  /black --check\b/i,
];

const GENERIC_PROSE_PATTERNS = [
  /\bwrite clean code\b/i,
  /\balways write maintainable\b/i,
  /\bbe helpful\b/i,
  /\bthink step by step\b/i,
  /\bensure code is bug-free\b/i,
  /\bfollow best practices\b/i,
];

const UNENFORCED_CRITICAL_PATTERNS = [
  /\bnever\s+[a-z\s]+(unless|without|bypass)\b/i,
  /\bdo not\s+[a-z\s]+(under any circumstances|without approval)\b/i,
  /\bstrictly prohibited\b/i,
  /\bmust always follow\b/i,
];

/**
 * Audits a single context markdown file (e.g. CLAUDE.md, AGENTS.md, GEMINI.md)
 */
function auditContextFile(filePath, rawContent = null) {
  let content = rawContent;
  if (content === null && fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  } else if (content === null) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const charCount = content.length;
  const estimatedTokens = Math.ceil(charCount / 4);

  const smells = [];
  const suggestions = [];

  // 1. Line ceiling audit
  if (lineCount > CRITICAL_LINE_CEILING) {
    smells.push({
      type: 'critical_bloat',
      message: `File has ${lineCount} lines (exceeds critical ceiling of ${CRITICAL_LINE_CEILING} lines). Heavy token waste and prompt rot risk.`,
    });
    suggestions.push(`Prune file down towards the Anthropic 200-line target by moving specialized instructions into on-demand skills or deterministic gates.`);
  } else if (lineCount > RECOMMENDED_LINE_CEILING) {
    smells.push({
      type: 'context_bloat',
      message: `File has ${lineCount} lines (exceeds recommended target of ${RECOMMENDED_LINE_CEILING} lines).`,
    });
    suggestions.push(`Consider compressing examples or archiving obsolete instructions.`);
  }

  // 2. Lint leakage smell
  const lintMatches = [];
  for (const pattern of LINT_LEAKAGE_PATTERNS) {
    if (pattern.test(content)) {
      lintMatches.push(pattern.source);
    }
  }
  if (lintMatches.length > 0) {
    smells.push({
      type: 'lint_leakage',
      message: `Detected hardcoded linter/formatter directives. These should be enforced by pre-commit hooks or npm scripts instead of prose.`,
    });
    suggestions.push(`Move linter instructions into pre-commit hooks or automated CI checks.`);
  }

  // 3. Generic prose smell
  const genericMatches = [];
  for (const pattern of GENERIC_PROSE_PATTERNS) {
    if (pattern.test(content)) {
      genericMatches.push(pattern.source);
    }
  }
  if (genericMatches.length > 0) {
    smells.push({
      type: 'generic_prose',
      message: `Detected generic advice (${genericMatches.length} match(es)). LLMs already follow these baseline principles without wasting prompt tokens.`,
    });
    suggestions.push(`Remove generic "clean code" prose and focus only on repository-specific constraints and unusual conventions.`);
  }

  // 4. Critical rules that should be deterministic gates
  const criticalRuleMatches = [];
  for (const pattern of UNENFORCED_CRITICAL_PATTERNS) {
    if (pattern.test(content)) {
      criticalRuleMatches.push(pattern.source);
    }
  }
  if (criticalRuleMatches.length > 0) {
    smells.push({
      type: 'unenforced_critical_rules',
      message: `Detected absolute negative constraints ("NEVER", "STRICTLY PROHIBITED"). If a rule must always hold, encode it in a test, pre-commit hook, or gate rather than leaving it solely as prose.`,
    });
    suggestions.push(`Verify that all absolute prohibitions have corresponding pre-action gates in config/gates/ or git hooks.`);
  }

  // Calculate Health Score (0 - 100)
  let healthScore = 100;
  if (lineCount > CRITICAL_LINE_CEILING) healthScore -= 35;
  else if (lineCount > RECOMMENDED_LINE_CEILING) healthScore -= 15;

  healthScore -= lintMatches.length * 5;
  healthScore -= genericMatches.length * 10;
  healthScore = Math.max(0, Math.min(100, healthScore));

  return {
    filePath: path.basename(filePath),
    fullPath: filePath,
    lineCount,
    wordCount,
    charCount,
    estimatedTokens,
    healthScore,
    smellCount: smells.length,
    smells,
    suggestions,
  };
}

/**
 * Audits a single agent skill file (SKILL.md)
 */
function auditSkillFile(filePath, rawContent = null) {
  let content = rawContent;
  if (content === null && fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  } else if (content === null) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;
  const charCount = content.length;
  const estimatedTokens = Math.ceil(charCount / 4);

  const smells = [];
  const strengths = [];
  let score = 100;

  // 1. YAML frontmatter verification
  const hasYamlFrontmatter = content.startsWith('---') && content.indexOf('\n---', 3) !== -1;
  if (!hasYamlFrontmatter) {
    smells.push({ type: 'missing_frontmatter', message: 'Missing YAML frontmatter with name and description.' });
    score -= 25;
  } else {
    strengths.push('Valid YAML frontmatter');
    const frontmatter = content.slice(3, content.indexOf('\n---', 3));
    if (!/name:\s*[a-z0-9-_.]+/i.test(frontmatter)) {
      smells.push({ type: 'invalid_name', message: 'Frontmatter missing valid name field.' });
      score -= 15;
    }
    if (!/description:\s*.+/i.test(frontmatter)) {
      smells.push({ type: 'invalid_description', message: 'Frontmatter missing actionable description field.' });
      score -= 15;
    }
  }

  // 2. Trigger keywords or "When to use"
  const hasTriggers = /when to use|triggers?|trigger words?|use this skill when|activation/i.test(content);
  if (!hasTriggers) {
    smells.push({ type: 'missing_triggers', message: 'Lacks explicit "When to use" or trigger criteria, leading to skill misfiring or underutilization.' });
    score -= 15;
  } else {
    strengths.push('Explicit activation triggers');
  }

  // 3. Concrete examples or runnable commands
  const hasExamples = /```(bash|sh|javascript|js|python|json|yaml)/i.test(content) || /example[s]?:/i.test(content);
  if (!hasExamples) {
    smells.push({ type: 'missing_examples', message: 'Lacks concrete code examples or runnable CLI snippets.' });
    score -= 15;
  } else {
    strengths.push('Concrete code/CLI examples');
  }

  // 4. Line length check
  if (lineCount > 300) {
    smells.push({ type: 'oversized_skill', message: `Skill is ${lineCount} lines. Consider decomposing into targeted sub-skills or helper scripts.` });
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  return {
    skillName: path.basename(path.dirname(filePath)),
    filePath: path.basename(filePath),
    fullPath: filePath,
    lineCount,
    charCount,
    estimatedTokens,
    qualityScore: score,
    strengths,
    smells,
    isHighQuality: score >= 70,
  };
}

/**
 * Audits repository agent files and local skills
 */
function auditAgentFiles(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const contextFiles = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules', '.windsurfrules'];

  const auditedContextFiles = [];
  for (const filename of contextFiles) {
    const fullPath = path.join(repoRoot, filename);
    if (fs.existsSync(fullPath)) {
      const audited = auditContextFile(fullPath);
      if (audited) auditedContextFiles.push(audited);
    }
  }

  // Search for skill files
  const skillDirectories = [
    path.join(repoRoot, '.agents', 'skills'),
    path.join(repoRoot, '.claude', 'skills'),
    path.join(process.env.HOME || '', '.agents', 'skills'),
    path.join(process.env.HOME || '', '.gemini', 'config', 'skills'),
  ];

  const auditedSkills = [];
  for (const skillDir of skillDirectories) {
    if (fs.existsSync(skillDir)) {
      try {
        const subdirs = fs.readdirSync(skillDir, { withFileTypes: true });
        for (const subdir of subdirs) {
          if (subdir.isDirectory()) {
            const skillMd = path.join(skillDir, subdir.name, 'SKILL.md');
            if (fs.existsSync(skillMd)) {
              const res = auditSkillFile(skillMd);
              if (res) auditedSkills.push(res);
            }
          }
        }
      } catch (err) {
        // Ignore unreadable dirs
      }
    }
  }

  const totalTokens = auditedContextFiles.reduce((sum, f) => sum + f.estimatedTokens, 0);
  const avgContextHealth = auditedContextFiles.length > 0
    ? Number((auditedContextFiles.reduce((sum, f) => sum + f.healthScore, 0) / auditedContextFiles.length).toFixed(1))
    : 100;

  const avgSkillQuality = auditedSkills.length > 0
    ? Number((auditedSkills.reduce((sum, s) => sum + s.qualityScore, 0) / auditedSkills.length).toFixed(1))
    : 100;

  const overallScore = Number(((avgContextHealth * 0.6) + (avgSkillQuality * 0.4)).toFixed(1));

  return {
    timestamp: new Date().toISOString(),
    overallScore,
    totalContextEstimatedTokens: totalTokens,
    contextFilesCount: auditedContextFiles.length,
    skillsCount: auditedSkills.length,
    contextFiles: auditedContextFiles,
    skills: auditedSkills,
    summary: {
      avgContextHealth,
      avgSkillQuality,
      bloatedContextFiles: auditedContextFiles.filter((f) => f.lineCount > RECOMMENDED_LINE_CEILING).length,
      highQualitySkills: auditedSkills.filter((s) => s.isHighQuality).length,
      skillsNeedingAttention: auditedSkills.filter((s) => !s.isHighQuality).length,
    },
  };
}

/**
 * Renders a clean markdown report of the audit
 */
function formatAgentAuditReport(report) {
  const lines = [
    '# 🔍 Agent Configuration & Skills Hygiene Audit',
    `*Based on Addy Osmani's "Audit Your Agent Files" & Anthropic Context Engineering guidance.*`,
    '',
    `- **Overall Environment Score**: **${report.overallScore}/100**`,
    `- **Total Context Files Token Overhead**: ~${report.totalContextEstimatedTokens.toLocaleString()} tokens`,
    `- **Context Files Audited**: ${report.contextFilesCount}`,
    `- **Skills Audited**: ${report.skillsCount}`,
    '',
    '## 📄 Context Files (CLAUDE.md, AGENTS.md, GEMINI.md)',
  ];

  for (const file of report.contextFiles) {
    const badge = file.healthScore >= 80 ? '🟢' : file.healthScore >= 60 ? '🟡' : '🔴';
    lines.push(`### ${badge} \`${file.filePath}\` (Score: ${file.healthScore}/100)`);
    lines.push(`- **Lines**: ${file.lineCount} / ${RECOMMENDED_LINE_CEILING} target`);
    lines.push(`- **Estimated Tokens**: ~${file.estimatedTokens}`);
    if (file.smells.length > 0) {
      lines.push('- **Smells Detected**:');
      for (const smell of file.smells) {
        lines.push(`  - ⚠️ *${smell.type}*: ${smell.message}`);
      }
    }
    if (file.suggestions.length > 0) {
      lines.push('- **Actionable Advice**:');
      for (const sug of file.suggestions) {
        lines.push(`  - 💡 ${sug}`);
      }
    }
    lines.push('');
  }

  if (report.skills.length > 0) {
    lines.push('## 🛠️ Agent Skills Quality Overview');
    lines.push(`- **Average Quality**: ${report.summary.avgSkillQuality}/100`);
    lines.push(`- **High Quality**: ${report.summary.highQualitySkills} | **Needing Attention**: ${report.summary.skillsNeedingAttention}`);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  RECOMMENDED_LINE_CEILING,
  CRITICAL_LINE_CEILING,
  auditContextFile,
  auditSkillFile,
  auditAgentFiles,
  formatAgentAuditReport,
};
