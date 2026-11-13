/**
 * Cloud-to-Local Agent-to-IDE Handoff Bridge.
 * 
 * Inspired by GitHub ("Your agent may have started the work, but you can finish the task in your IDE"):
 * Enables autonomous agents running in background/cloud/containers to cleanly
 * export their execution state, worktree patch, task checklist, and decision log
 * so developers can seamlessly resume and finish the task in Cursor, VS Code, or Claude Code.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const DEFAULT_HANDOFF_DIR = path.join(os.homedir(), '.thumbgate', 'handoffs');

class AgentIdeHandoffBridge {
  constructor(options = {}) {
    this.handoffDir = options.handoffDir || DEFAULT_HANDOFF_DIR;
    this.ensureHandoffDir();
  }

  ensureHandoffDir() {
    if (!fs.existsSync(this.handoffDir)) {
      fs.mkdirSync(this.handoffDir, { recursive: true });
    }
  }

  /**
   * Captures the current agent session into an exportable handoff package.
   */
  exportSessionHandoff(params = {}) {
    const {
      sessionId = `sess_${Date.now()}`,
      taskTitle = 'Autonomous Task',
      agentName = 'poolside',
      repoPath = process.cwd(),
      checklist = [],
      decisions = [],
      remainingBlockers = [],
    } = params;

    let branch = 'unknown';
    let gitDiff = '';

    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
      gitDiff = execSync('git diff HEAD', { cwd: repoPath, encoding: 'utf8' });
    } catch (_) {
      // Non-git or detached environment
    }

    const handoffPackage = {
      version: '1.0',
      sessionId,
      taskTitle,
      exportedAt: new Date().toISOString(),
      agent: {
        name: agentName,
        platform: process.platform,
        arch: process.arch,
      },
      repo: {
        path: repoPath,
        branch,
      },
      worktree: {
        hasUncommittedChanges: Boolean(gitDiff && gitDiff.trim().length > 0),
        diffSnippet: gitDiff.slice(0, 4000),
      },
      checklist: checklist.map((item) => (typeof item === 'string' ? { title: item, done: false } : item)),
      decisions,
      remainingBlockers,
      ideLinks: {
        cursor: `cursor://file${repoPath}`,
        vscode: `vscode://file${repoPath}`,
      },
    };

    const outPath = path.join(this.handoffDir, `${sessionId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(handoffPackage, null, 2), 'utf8');

    // Also write a human-readable IDE prompt artifact
    const promptPath = path.join(this.handoffDir, `${sessionId}-RESUME.md`);
    const promptMd = this.formatResumeBriefing(handoffPackage);
    fs.writeFileSync(promptPath, promptMd, 'utf8');

    return {
      ok: true,
      sessionId,
      handoffPath: outPath,
      promptPath,
      ideLinks: handoffPackage.ideLinks,
    };
  }

  /**
   * Formats a crisp briefing that primes Cursor or Claude Code immediately upon opening.
   */
  formatResumeBriefing(pkg) {
    let md = `# 🚀 Resume Task: ${pkg.taskTitle}\n\n`;
    md += `**Origin Agent:** \`${pkg.agent.name}\` | **Branch:** \`${pkg.repo.branch}\` | **Exported:** ${pkg.exportedAt}\n\n`;

    md += `## ✅ Checklist Progress\n`;
    for (const item of pkg.checklist) {
      md += `- [${item.done ? 'x' : ' '}] ${item.title}\n`;
    }

    if (pkg.decisions && pkg.decisions.length > 0) {
      md += `\n## 🧠 Agent Architectural Decisions\n`;
      for (const d of pkg.decisions) {
        md += `- **${d.title || 'Decision'}**: ${d.reason || d.summary || JSON.stringify(d)}\n`;
      }
    }

    if (pkg.remainingBlockers && pkg.remainingBlockers.length > 0) {
      md += `\n## ⚠️ Remaining Blockers / Pending Work\n`;
      for (const b of pkg.remainingBlockers) {
        md += `- ${b}\n`;
      }
    }

    md += `\n## 💻 Finish in Your IDE\n`;
    md += `- Cursor: [Open Project in Cursor](${pkg.ideLinks.cursor})\n`;
    md += `- VS Code: [Open Project in VS Code](${pkg.ideLinks.vscode})\n`;

    return md;
  }

  loadSessionHandoff(sessionId) {
    const handoffPath = path.join(this.handoffDir, `${sessionId}.json`);
    if (!fs.existsSync(handoffPath)) {
      throw new Error(`Handoff session not found: ${sessionId}`);
    }
    return JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
  }
}

module.exports = {
  AgentIdeHandoffBridge,
};
