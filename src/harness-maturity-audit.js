/**
 * Deterministic Harness Maturity Audit (L0 -> L4).
 * 
 * Inspired by Dan Kornas (Harness Score, aws-bench, VibesPlug):
 * "AI coding agents need more than prompts. Measure setup around AI coding agents
 * across six dimensions (guides, skills, guardrails, feedback, CI, hygiene)
 * using 100% deterministic filesystem facts—no LLM calls or network access."
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MATURITY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'];

class HarnessMaturityAudit {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
  }

  auditRepository(targetDir = this.rootDir) {
    const checks = {
      guides: this._auditGuides(targetDir),
      skills: this._auditSkills(targetDir),
      guardrails: this._auditGuardrails(targetDir),
      feedback: this._auditFeedback(targetDir),
      ci: this._auditCi(targetDir),
      hygiene: this._auditHygiene(targetDir),
    };

    let totalChecks = 0;
    let passedChecks = 0;
    const dimensionScores = {};

    for (const [dim, result] of Object.entries(checks)) {
      totalChecks += result.total;
      passedChecks += result.passed;
      dimensionScores[dim] = {
        score: `${result.passed}/${result.total}`,
        percentage: Math.round((result.passed / (result.total || 1)) * 100),
        checks: result.checks,
      };
    }

    const overallPercentage = Math.round((passedChecks / (totalChecks || 1)) * 100);

    // Calculate Maturity Level (L0 to L4)
    let maturity = 'L0';
    const blockingRequirements = [];

    if (checks.guides.passed >= 2 && checks.ci.passed >= 1) {
      maturity = 'L1';
    }

    if (maturity === 'L1' && checks.skills.passed >= 2 && checks.guardrails.passed >= 1 && checks.hygiene.passed >= 2) {
      maturity = 'L2';
    } else if (maturity === 'L1') {
      blockingRequirements.push('L2 requires modular skills (>=2) and pre-action guardrails.');
    }

    if (maturity === 'L2' && checks.feedback.passed >= 2 && checks.ci.passed >= 3 && checks.guardrails.passed >= 3) {
      maturity = 'L3';
    } else if (maturity === 'L2') {
      blockingRequirements.push('L3 requires active feedback telemetry and mutation/invariant verification.');
    }

    if (maturity === 'L3' && checks.hygiene.passed >= 4 && overallPercentage >= 85) {
      maturity = 'L4';
    } else if (maturity === 'L3') {
      blockingRequirements.push('L4 requires full multi-phase migration, scatter query linting, and >=85% score.');
    }

    return {
      rootDir: targetDir,
      maturity,
      overallPercentage,
      passedChecks,
      totalChecks,
      dimensionScores,
      blockingRequirements,
      isCompliant: (minLevel) => {
        if (!minLevel) return true;
        const targetIdx = MATURITY_LEVELS.indexOf(minLevel.toUpperCase());
        const currentIdx = MATURITY_LEVELS.indexOf(maturity);
        return currentIdx >= targetIdx;
      },
    };
  }

  _auditGuides(dir) {
    const checks = [
      { id: 'agents_md', name: 'AGENTS.md exists', pass: fs.existsSync(path.join(dir, 'AGENTS.md')) },
      { id: 'claude_md', name: 'CLAUDE.md exists', pass: fs.existsSync(path.join(dir, 'CLAUDE.md')) },
      { id: 'cursor_rules', name: '.cursorrules or .cursor/ exists', pass: fs.existsSync(path.join(dir, '.cursorrules')) || fs.existsSync(path.join(dir, '.cursor')) },
      { id: 'commands_dir', name: 'Slash commands directory exists', pass: fs.existsSync(path.join(dir, '.claude', 'commands')) || fs.existsSync(path.join(dir, 'commands')) },
    ];
    return this._summarizeDimension(checks);
  }

  _auditSkills(dir) {
    const checks = [
      { id: 'skills_hub', name: 'Skills hub directory exists', pass: fs.existsSync(path.join(dir, 'skills')) || fs.existsSync(path.join(dir, '.agents', 'skills')) },
      { id: 'skill_md_spec', name: 'Standard SKILL.md specs present', pass: this._findFileRecursive(dir, 'SKILL.md', 3) },
      { id: 'mcp_config', name: '.mcp.json or task MCP config exists', pass: fs.existsSync(path.join(dir, '.mcp.json')) || fs.existsSync(path.join(dir, 'mcp.json')) },
    ];
    return this._summarizeDimension(checks);
  }

  _auditGuardrails(dir) {
    const checks = [
      { id: 'pre_action_hook', name: 'PreToolUse or gate hook configured', pass: this._checkFileContains(path.join(dir, 'package.json'), 'thumbgate') || fs.existsSync(path.join(dir, '.thumbgate')) },
      { id: 'fail_closed', name: 'Fail-closed guardrail policy implemented', pass: fs.existsSync(path.join(dir, 'src', 'enterprise-lifecycle-guardrail-engine.js')) || fs.existsSync(path.join(dir, 'scripts', 'gates-engine.js')) },
      { id: 'approval_gate', name: 'Human-in-the-loop approval gate for irreversible actions', pass: fs.existsSync(path.join(dir, 'src', 'unified-agent-adapter.js')) },
    ];
    return this._summarizeDimension(checks);
  }

  _auditFeedback(dir) {
    const checks = [
      { id: 'feedback_loop', name: 'Feedback capture engine exists', pass: fs.existsSync(path.join(dir, 'scripts', 'feedback-loop.js')) || fs.existsSync(path.join(dir, '.thumbgate', 'feedback.jsonl')) },
      { id: 'memory_log', name: 'Durable memory log stored', pass: fs.existsSync(path.join(dir, '.thumbgate', 'memory.jsonl')) || fs.existsSync(path.join(dir, 'scripts', 'memory.js')) },
      { id: 'telemetry_analytics', name: 'Telemetry analytics ping logger', pass: fs.existsSync(path.join(dir, 'scripts', 'telemetry-analytics.js')) },
    ];
    return this._summarizeDimension(checks);
  }

  _auditCi(dir) {
    const checks = [
      { id: 'automated_tests', name: 'Automated test suite configured', pass: fs.existsSync(path.join(dir, 'tests')) || fs.existsSync(path.join(dir, 'test')) },
      { id: 'mutation_testing', name: 'Mutation test engine configured', pass: fs.existsSync(path.join(dir, 'src', 'mutation-test-engine.js')) },
      { id: 'lazy_ci', name: 'Lazy CI & superseded build cancellation', pass: fs.existsSync(path.join(dir, 'src', 'lazy-ci-pipeline.js')) },
      { id: 'github_actions', name: 'GitHub Actions workflow present', pass: fs.existsSync(path.join(dir, '.github', 'workflows')) },
    ];
    return this._summarizeDimension(checks);
  }

  _auditHygiene(dir) {
    const checks = [
      { id: 'secret_scanner', name: 'Deterministic secret & PII scanner', pass: fs.existsSync(path.join(dir, 'scripts', 'secret-scanner.js')) || fs.existsSync(path.join(dir, 'src', 'enterprise-lifecycle-guardrail-engine.js')) },
      { id: 'scatter_query_linter', name: 'Scatter query linter for sharded DB', pass: fs.existsSync(path.join(dir, 'src', 'scatter-query-linter.js')) },
      { id: 'zero_downtime_migration', name: 'Zero-downtime migration state machine', pass: fs.existsSync(path.join(dir, 'src', 'zero-downtime-migration-guard.js')) },
      { id: 'parallelization_guard', name: 'Amdahl workload parallelization guard', pass: fs.existsSync(path.join(dir, 'src', 'workload-parallelization-guard.js')) },
    ];
    return this._summarizeDimension(checks);
  }

  _summarizeDimension(checks) {
    const passed = checks.filter((c) => c.pass).length;
    return {
      passed,
      total: checks.length,
      checks,
    };
  }

  _checkFileContains(filePath, keyword) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes(keyword);
      }
    } catch (_) {}
    return false;
  }

  _findFileRecursive(dir, fileName, maxDepth = 2, currentDepth = 0) {
    if (currentDepth > maxDepth || !fs.existsSync(dir)) return false;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === fileName) return true;
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          if (this._findFileRecursive(path.join(dir, entry.name), fileName, maxDepth, currentDepth + 1)) {
            return true;
          }
        }
      }
    } catch (_) {}
    return false;
  }
}

module.exports = {
  HarnessMaturityAudit,
  MATURITY_LEVELS,
};
