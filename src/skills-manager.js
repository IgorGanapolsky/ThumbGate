/**
 * Skills Manager & Context-Cost Ledger for ThumbGate.
 * 
 * Inspired by Dan Kornas (@DanKornas) and Agents of Dev Ep 44:
 * - Single central skill hub (~/.agents/skills or project-local)
 * - Multi-agent distribution via symlinks/copies (Claude, Codex, Cursor, Antigravity, Poolside)
 * - Git tree SHA update checks (directory-level SHA so unrelated repo changes don't trigger notices)
 * - Context-Cost Ledger: audits approximate resident token cost per agent runtime path.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const DEFAULT_HUB_DIR = path.join(os.homedir(), '.agents', 'skills');

const AGENT_SKILL_TARGETS = {
  claude: path.join(os.homedir(), '.claude', 'skills'),
  codex: path.join(os.homedir(), '.codex', 'skills'),
  cursor: path.join(os.homedir(), '.cursor', 'skills'),
  antigravity: path.join(os.homedir(), '.antigravitycli', 'skills'),
  poolside: path.join(os.homedir(), '.agents', 'skills'),
};

class SkillsManager {
  constructor(options = {}) {
    this.hubDir = options.hubDir || DEFAULT_HUB_DIR;
    this.agentTargets = options.agentTargets || AGENT_SKILL_TARGETS;
    this.ledgerPath = options.ledgerPath || path.join(this.hubDir, '.skills-ledger.json');
  }

  ensureHub() {
    if (!fs.existsSync(this.hubDir)) {
      fs.mkdirSync(this.hubDir, { recursive: true });
    }
  }

  computeDirectorySha(dirPath) {
    if (!fs.existsSync(dirPath)) return null;
    const files = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const hash = crypto.createHash('sha1');

    for (const f of files) {
      const fullPath = path.join(dirPath, f.name);
      if (f.isDirectory()) {
        hash.update(`dir:${f.name}:${this.computeDirectorySha(fullPath)}`);
      } else {
        const content = fs.readFileSync(fullPath);
        hash.update(`file:${f.name}:${crypto.createHash('sha1').update(content).digest('hex')}`);
      }
    }
    return hash.digest('hex');
  }

  listHubSkills() {
    this.ensureHub();
    const entries = fs.readdirSync(this.hubDir, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(this.hubDir, entry.name);
      const skillMd = path.join(skillPath, 'SKILL.md');
      const hasSkillMd = fs.existsSync(skillMd);
      const sha = this.computeDirectorySha(skillPath);

      let tokenEstimate = 0;
      if (hasSkillMd) {
        const content = fs.readFileSync(skillMd, 'utf8');
        tokenEstimate = Math.ceil(content.length / 4.0);
      }

      skills.push({
        name: entry.name,
        path: skillPath,
        hasSkillMd,
        treeSha: sha,
        estimatedTokens: tokenEstimate,
      });
    }

    return skills;
  }

  distributeSkill(skillName, agents = ['claude', 'codex', 'cursor'], mode = 'symlink') {
    this.ensureHub();
    const sourceDir = path.join(this.hubDir, skillName);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Skill '${skillName}' does not exist in hub: ${sourceDir}`);
    }

    const results = {};
    for (const agent of agents) {
      const targetBase = this.agentTargets[agent];
      if (!targetBase) {
        results[agent] = { ok: false, error: `Unknown agent target '${agent}'` };
        continue;
      }

      if (!fs.existsSync(targetBase)) {
        fs.mkdirSync(targetBase, { recursive: true });
      }

      const destPath = path.join(targetBase, skillName);

      try {
        if (fs.existsSync(destPath)) {
          // If already pointing to source, skip
          try {
            const currentTarget = fs.readlinkSync(destPath);
            if (path.resolve(targetBase, currentTarget) === path.resolve(sourceDir)) {
              results[agent] = { ok: true, action: 'already_linked', path: destPath };
              continue;
            }
          } catch (_) {
            // Not a symlink, might be directory
          }
          fs.rmSync(destPath, { recursive: true, force: true });
        }

        if (mode === 'symlink') {
          fs.symlinkSync(sourceDir, destPath, 'junction');
          results[agent] = { ok: true, action: 'symlinked', path: destPath };
        } else {
          fs.cpSync(sourceDir, destPath, { recursive: true });
          results[agent] = { ok: true, action: 'copied', path: destPath };
        }
      } catch (err) {
        results[agent] = { ok: false, error: err.message };
      }
    }

    return results;
  }

  generateContextCostLedger(options = {}) {
    const budgetPerAgentTokens = options.budgetPerAgentTokens || 8000;
    const ledger = {
      timestamp: new Date().toISOString(),
      budgetPerAgentTokens,
      agents: {},
      hubTotalTokens: 0,
      warnings: [],
    };

    const hubSkills = this.listHubSkills();
    ledger.hubTotalTokens = hubSkills.reduce((sum, s) => sum + s.estimatedTokens, 0);

    for (const [agentName, agentDir] of Object.entries(this.agentTargets)) {
      if (!fs.existsSync(agentDir)) {
        ledger.agents[agentName] = { installedCount: 0, totalTokens: 0, skills: [] };
        continue;
      }

      const entries = fs.readdirSync(agentDir, { withFileTypes: true });
      const installed = [];
      let totalTokens = 0;

      for (const entry of entries) {
        const fullPath = path.join(agentDir, entry.name);
        const skillMd = path.join(fullPath, 'SKILL.md');
        let tokens = 0;
        let isSymlink = false;

        try {
          isSymlink = fs.lstatSync(fullPath).isSymbolicLink();
        } catch (_) {}

        if (fs.existsSync(skillMd)) {
          try {
            const content = fs.readFileSync(skillMd, 'utf8');
            tokens = Math.ceil(content.length / 4.0);
          } catch (_) {}
        }

        totalTokens += tokens;
        installed.push({
          name: entry.name,
          tokens,
          isSymlink,
        });
      }

      ledger.agents[agentName] = {
        installedCount: installed.length,
        totalTokens,
        skills: installed,
      };

      if (totalTokens > budgetPerAgentTokens) {
        ledger.warnings.push({
          agent: agentName,
          totalTokens,
          budget: budgetPerAgentTokens,
          message: `Resident skill context (${totalTokens} tokens) exceeds budget of ${budgetPerAgentTokens} tokens. Consider unloading or lazy-loading low-frequency skills.`,
        });
      }
    }

    return ledger;
  }
}

module.exports = {
  SkillsManager,
  DEFAULT_HUB_DIR,
  AGENT_SKILL_TARGETS,
};
