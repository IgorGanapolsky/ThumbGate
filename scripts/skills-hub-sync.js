'use strict';

/**
 * ThumbGate Skills Hub Sync Engine
 *
 * Architectural Steal: Dan Kornas (@DanKornas Skills Manager) & Agents of Dev Ep 44
 * "Stop copying the same skills into every coding agent. Skills Manager is a CLI-first
 * tool for builders managing agent skills across Claude Code, Codex, Cursor, and other
 * skill-loading agents. Keep one central library instead of scattered copies by importing
 * existing skills into a central hub, then distributing selected skills to each agent
 * through symlinks or governed copies."
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const AGENT_SKILL_DIRECTORIES = {
  claude: path.join(os.homedir(), '.claude', 'skills'),
  cursor: path.join(process.cwd(), '.cursor', 'rules'),
  codex: path.join(os.homedir(), '.codex', 'skills'),
  opencode: path.join(os.homedir(), '.opencode', 'skills'),
  antigravity: path.join(os.homedir(), '.gemini', 'skills'),
  poolside: path.join(process.cwd(), '.agent', 'skills'),
};

class SkillsHub {
  constructor(hubDir = path.join(process.cwd(), '.thumbgate', 'skills-hub')) {
    this.hubDir = hubDir;
    this._ensureHubDir();
  }

  _ensureHubDir() {
    if (!fs.existsSync(this.hubDir)) {
      fs.mkdirSync(this.hubDir, { recursive: true });
    }
  }

  /**
   * Registers or updates a skill in the centralized hub.
   */
  registerSkill(skillName, skillContent, metadata = {}) {
    this._ensureHubDir();
    const skillPath = path.join(this.hubDir, `${skillName}.md`);
    const fileContent = typeof skillContent === 'string'
      ? skillContent
      : JSON.stringify(skillContent, null, 2);

    fs.writeFileSync(skillPath, fileContent, 'utf8');

    const manifestPath = path.join(this.hubDir, 'skills-manifest.json');
    let manifest = {};
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        manifest = {};
      }
    }

    manifest[skillName] = {
      name: skillName,
      updatedAt: new Date().toISOString(),
      metadata,
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { name: skillName, path: skillPath };
  }

  /**
   * Lists all skills stored in the central hub.
   */
  listSkills() {
    this._ensureHubDir();
    const manifestPath = path.join(this.hubDir, 'skills-manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  /**
   * Distributes / syncs skills from central hub to target agents.
   */
  distributeSkills(targetAgents = Object.keys(AGENT_SKILL_DIRECTORIES), method = 'copy') {
    const hubSkills = this.listSkills();
    const syncResults = [];

    for (const agentKey of targetAgents) {
      const destDir = AGENT_SKILL_DIRECTORIES[agentKey];
      if (!destDir) continue;

      try {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        let syncedCount = 0;
        for (const skillName of Object.keys(hubSkills)) {
          const sourcePath = path.join(this.hubDir, `${skillName}.md`);
          const destPath = path.join(destDir, `${skillName}.md`);

          if (fs.existsSync(sourcePath)) {
            if (method === 'symlink') {
              try {
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                fs.symlinkSync(sourcePath, destPath);
              } catch {
                fs.copyFileSync(sourcePath, destPath);
              }
            } else {
              fs.copyFileSync(sourcePath, destPath);
            }
            syncedCount++;
          }
        }

        syncResults.push({
          agent: agentKey,
          targetDirectory: destDir,
          syncedSkills: syncedCount,
          status: 'synced',
        });
      } catch (err) {
        syncResults.push({
          agent: agentKey,
          targetDirectory: destDir,
          status: 'failed',
          error: err.message,
        });
      }
    }

    return syncResults;
  }
}

module.exports = {
  SkillsHub,
  AGENT_SKILL_DIRECTORIES,
};
