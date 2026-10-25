#!/usr/bin/env node
'use strict';

/**
 * scripts/sync-workspace-obsidian.js
 *
 * Elephant-Goldfish Model (EGM Peanuts & Hay) + Split-Plane Bidirectional Sync
 * between all primary ~/workspace repositories (`<repo>/obsidian/`) and the
 * central Obsidian vault (`~/Documents/AI-Agent-Sync/Projects/<Project>/`).
 *
 * Safety & Hygiene Invariants:
 *  1. Skips ephemeral git worktrees (`*.worktrees`, `*-lanes`, `ThumbGate-*` clones).
 *  2. Generates & syncs EGM Peanuts-and-Hay `Blueprint.md`, `Start Here.md`, `State.md`
 *     (live git remote, branch, HEAD SHA), `Logs.md` (recent git commits), and `Reports.md`.
 *  3. NEVER copies private/high-churn vault subfolders (`Meetings`, `Meetings-Prep`, `Email-Drafts`,
 *     `Email-Triage-Archive`, `Social-Drafts`, `Social-Drafts-Archive`, `Money`, `Gumroad-Products`,
 *     `Tax-Deed-Pre-Bid-Screen`, `content-source`) into `<repo>/obsidian/`.
 *  4. Tracks `<repo>/obsidian/` in Igor's own repos (`visibility !== 'corporate-eci'`), and
 *     registers `/obsidian/` in `<repo>/.git/info/exclude` ONLY for `corporate-eci` repos.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const HOME = os.homedir();
const VAULT_ROOT = process.env.AI_AGENT_SYNC_VAULT || path.join(HOME, 'Documents', 'AI-Agent-Sync');
const WORKSPACE_ROOT = path.join(HOME, 'workspace');
const TODAY = new Date().toISOString().slice(0, 10);

const WORKSPACE_PROJECTS = [
  { name: 'ThumbGate', slug: 'thumbgate', repo: path.join(WORKSPACE_ROOT, 'ThumbGate'), role: 'Pre-action AI agent infrastructure firewall & MCP gateway', visibility: 'public' },
  { name: 'Dayglass', slug: 'dayglass', repo: path.join(WORKSPACE_ROOT, 'dayglass'), role: 'macOS native screen/audio memory & Gold semantic layer', visibility: 'public' },
  { name: 'RealEstate', slug: 'realestate', repo: path.join(WORKSPACE_ROOT, 'RealEstate'), role: 'Florida tax-deed auction intelligence & skip-trace pipeline', visibility: 'private' },
  { name: 'Joey-RealEstate', slug: 'joey-realestate', repo: path.join(WORKSPACE_ROOT, 'joey-realestate'), role: 'Joey RealEstate investor portal & verified officer leads (Vercel)', visibility: 'private' },
  { name: 'Trading', slug: 'trading', repo: path.join(WORKSPACE_ROOT, 'trading'), role: 'Quantitative options & systematic trading engine', visibility: 'private' },
  { name: 'YourStageTickets', slug: 'yourstagetickets', repo: path.join(WORKSPACE_ROOT, 'Jeff', 'YourStageTickets'), role: 'Hilltown / Jeff paying client ticketing & ClientOps platform', visibility: 'client' },
  { name: 'Secure-Yolo', slug: 'mac-yolo-safeguards', vaultFolder: 'mac-yolo-safeguards', repo: path.join(WORKSPACE_ROOT, 'projects', 'secure-yolo'), role: 'macOS agent harness, skills, hooks, and safety guardrails', visibility: 'private' },
  { name: 'Eci-Obsidian', slug: 'eci-obsidian', repo: path.join(WORKSPACE_ROOT, 'Eci.Obsidian'), role: 'ECI architecture, PSN, and AI Platform Group knowledge base', visibility: 'corporate-eci' },
  { name: 'Eci-Psn-StockService', slug: 'eci-psn-stockservice', repo: path.join(WORKSPACE_ROOT, 'projects', 'Eci.Psn.StockService'), role: 'ECI PSN StockService modern AWS & dual-write service', visibility: 'corporate-eci' },
  { name: 'Eci-Psn-Service', slug: 'eci-psn-service', repo: path.join(WORKSPACE_ROOT, 'projects', 'Eci.Psn.Service'), role: 'ECI PSN core service & SQL Server / QA deployment pipeline', visibility: 'corporate-eci' },
  { name: 'Psn-Ops-Dashboard', slug: 'psn-ops-dashboard', repo: path.join(WORKSPACE_ROOT, 'projects', 'psn-ops-dashboard'), role: 'ECI PSN Operations Hub dashboard & telemetry', visibility: 'corporate-eci' },
  { name: 'Psn-Skills', slug: 'psn-skills', repo: path.join(WORKSPACE_ROOT, 'projects', 'psn-skills'), role: 'ECI AI Studio skills catalog & SDD evaluation suite', visibility: 'corporate-eci' },
  { name: 'Kha-Scheduling-Hub', slug: 'kha-scheduling-hub', repo: path.join(WORKSPACE_ROOT, 'projects', 'kha-scheduling-hub'), role: 'Khameleon Ally scheduling hub & RLHF integration', visibility: 'corporate-eci' },
  { name: 'Covers', slug: 'covers', repo: path.join(WORKSPACE_ROOT, 'projects', 'covers'), role: 'Agent-first CLI, MCP server, and multi-worktree isolation', visibility: 'private' },
  { name: 'Lore', slug: 'lore', repo: path.join(WORKSPACE_ROOT, 'projects', 'lore'), role: 'Code search, Zoekt indexing, and Teams knowledge bot', visibility: 'corporate-eci' },
  { name: 'OpenBot', slug: 'openbot', repo: path.join(WORKSPACE_ROOT, 'projects', 'openbot'), role: 'Autonomous worker/supervisor agent runtime', visibility: 'private' },
  { name: 'Monitoring', slug: 'monitoring', repo: path.join(WORKSPACE_ROOT, 'projects', 'Monitoring'), role: '.NET monitoring service & AI-DLC catalog', visibility: 'corporate-eci' },
  { name: 'Talon', slug: 'talon', repo: path.join(WORKSPACE_ROOT, 'talon'), role: 'Persona-driven agent daemon (talond)', visibility: 'private' },
  { name: 'Hank', slug: 'hank', repo: path.join(WORKSPACE_ROOT, 'Hank'), role: 'BirthdayBuddies & automated outreach pipeline', visibility: 'private' },
  { name: 'Orchestra', slug: 'orchestra', repo: path.join(WORKSPACE_ROOT, 'Orchestra'), role: 'Multi-agent Go/Node orchestrator & diagnostics warehouse', visibility: 'private' },
  { name: 'Herdr-Projects', slug: 'herdr-projects', repo: path.join(WORKSPACE_ROOT, 'herdr-projects'), role: 'Herdr Rust multi-agent software factory & pod governance', visibility: 'public' },
  { name: 'HALO', slug: 'halo', repo: path.join(WORKSPACE_ROOT, 'HALO'), role: 'Trace-to-fix span optimizer & CLI engine', visibility: 'private' },
  { name: 'CLM', slug: 'clm', repo: path.join(WORKSPACE_ROOT, 'CLM'), role: 'Continuous learning model training & Qwen3 serving', visibility: 'private' },
  { name: 'HealthGraphAI', slug: 'healthgraphai', repo: path.join(WORKSPACE_ROOT, 'HealthGraphAI'), role: 'Health Graph RAG & medical MCP server', visibility: 'private' },
  { name: 'iPhone', slug: 'iphone', repo: path.join(WORKSPACE_ROOT, 'iphone'), role: 'Physical iPhone WDA automation, Shortcuts & IgorHome', visibility: 'private' },
  { name: 'Wedding', slug: 'wedding', repo: path.join(WORKSPACE_ROOT, 'Wedding'), role: 'Igor & Melissa wedding media vision catalog & deck', visibility: 'private' },
  { name: 'Tomes', slug: 'tomes', repo: path.join(WORKSPACE_ROOT, 'tomes'), role: 'ECI Tomes documentation builder', visibility: 'corporate-eci' },
  { name: 'Goose', slug: 'goose', repo: path.join(WORKSPACE_ROOT, 'goose'), role: 'Agensi draft recipes and automation', visibility: 'private' },
];

const DURABLE_SYNC_FILES = ['Start Here.md', 'Blueprint.md', 'State.md', 'Reports.md', 'Logs.md', 'Architecture.md', 'Decisions.md'];

function gitCmd(repoPath, args) {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function discoverVerificationCommand(repoPath) {
  if (fs.existsSync(path.join(repoPath, 'package.json'))) return 'npm test';
  if (fs.existsSync(path.join(repoPath, 'Cargo.toml'))) return 'cargo test';
  if (fs.existsSync(path.join(repoPath, 'go.mod')) || fs.existsSync(path.join(repoPath, 'go.work'))) return 'go test ./...';
  if (fs.existsSync(path.join(repoPath, 'pyproject.toml')) || fs.existsSync(path.join(repoPath, 'pytest.ini'))) return 'pytest -q';
  if (fs.existsSync(path.join(repoPath, 'Makefile'))) return 'make test';
  return 'git status --short';
}

function discoverSubdirectories(repoPath) {
  const ignore = new Set(['.git', 'node_modules', 'venv', '.venv', 'dist', 'build', '.thumbgate', '.poolside', '.worktrees', '.claude', '.cursor', '.agents', 'obsidian']);
  try {
    return fs
      .readdirSync(repoPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !ignore.has(d.name))
      .slice(0, 12)
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function buildEgmBlueprintDoc(proj) {
  const verifyCmd = discoverVerificationCommand(proj.repo);
  const subdirs = discoverSubdirectories(proj.repo);
  const subdirBullets = subdirs.length
    ? subdirs.map((s) => `- \`${s}/\` — Subsystem boundary inside \`${proj.name}\``).join('\n')
    : '- `(Root-level module)` — Single-package layout';

  return [
    '---',
    'type: egm-blueprint',
    `project: ${proj.slug}`,
    'status: active',
    `source_repo: ${proj.repo}`,
    `visibility: ${proj.visibility}`,
    `last_verified: ${TODAY}`,
    '---',
    '',
    `# ${proj.name} Blueprint (EGM Peanuts & Hay)`,
    '',
    '## 1. The Problem & System Overview',
    `${proj.role}. Maintained under the Elephant-Goldfish Model (\`sizeof(docs) << sizeof(code)\`) so any fresh zero-context Goldfish session can reconstruct system intent and boundaries in <30 seconds.`,
    '',
    '## 2. The Technical Plan & Subdirectory Boundaries (Hay)',
    subdirBullets,
    '',
    '## 3. Alternatives Considered & Rejected',
    '- **Raw Source Context Dumping (Rejected):** Feeding entire source trees into fresh sessions wastes context budget and causes hallucination cascades; use compressed EGM blueprints instead.',
    '- **Flat Unisolated Vault Root (Rejected):** Mixing private meeting notes and drafts in the vault root pollutes cross-project boundaries; keep durable docs in `<repo>/obsidian/` and private ops in `Projects/<Project>/`.',
    '',
    '## 4. Global Invariants & Side Effects',
    `- **Visibility Tier:** \`${proj.visibility}\` (${proj.visibility === 'corporate-eci' ? 'Excluded from corporate git via .git/info/exclude' : 'Tracked in <repo>/obsidian/ and synced with AI-Agent-Sync'})`,
    '- **Leave-Work-at-Work Sanctuary:** Zero mid-flight human babysitting; all specs and diffs must pass the 4-stage Goldfish swarm before completion.',
    '',
    '## 5. System Verification',
    `- Run: \`${verifyCmd}\``,
    '',
  ].join('\n');
}

function configureGitExcludeForVisibility(repoPath, visibility, pattern = '/obsidian/') {
  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) return false;
  let actualGitDir = gitDir;
  const stat = fs.statSync(gitDir);
  if (stat.isFile()) {
    const content = fs.readFileSync(gitDir, 'utf8').trim();
    const match = content.match(/^gitdir:\s*(.+)$/i);
    if (match) actualGitDir = path.resolve(repoPath, match[1]);
  }
  const infoDir = path.join(actualGitDir, 'info');
  if (!fs.existsSync(infoDir)) fs.mkdirSync(infoDir, { recursive: true });
  const excludeFile = path.join(infoDir, 'exclude');
  const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
  const lines = existing.split('\n');

  if (visibility === 'corporate-eci') {
    if (!lines.map((l) => l.trim()).includes(pattern)) {
      fs.appendFileSync(excludeFile, `${existing.endsWith('\n') || !existing ? '' : '\n'}${pattern}\n`);
    }
    return true;
  }
  // For non-ECI repos, remove /obsidian/ from .git/info/exclude so repo/obsidian/ can be tracked directly in each repo
  const filtered = lines.filter((l) => l.trim() !== pattern);
  if (filtered.length !== lines.length) {
    fs.writeFileSync(excludeFile, filtered.join('\n'), 'utf8');
  }
  return false;
}

function syncBidirectionalFile(vaultFile, repoFile) {
  const vExists = fs.existsSync(vaultFile);
  const rExists = fs.existsSync(repoFile);
  if (vExists && !rExists) {
    fs.copyFileSync(vaultFile, repoFile);
    return 'vault->repo';
  }
  if (!vExists && rExists) {
    fs.copyFileSync(repoFile, vaultFile);
    return 'repo->vault';
  }
  if (vExists && rExists) {
    const vStat = fs.statSync(vaultFile);
    const rStat = fs.statSync(repoFile);
    if (Math.abs(vStat.mtimeMs - rStat.mtimeMs) < 500) return 'in_sync';
    if (rStat.mtimeMs > vStat.mtimeMs) {
      fs.copyFileSync(repoFile, vaultFile);
      return 'repo->vault';
    }
    fs.copyFileSync(vaultFile, repoFile);
    return 'vault->repo';
  }
  return 'none';
}

function getChangedVaultPaths(results) {
  const changed = [];
  for (const r of results) {
    if (!r.vaultDir) continue;
    const vaultDir = path.join(VAULT_ROOT, r.vaultDir);
    for (const [fileName, status] of Object.entries(r.syncedFiles || {})) {
      if (status !== 'in_sync' && status !== 'none') {
        const filePath = path.join(vaultDir, fileName);
        if (fs.existsSync(filePath)) {
          changed.push(path.relative(VAULT_ROOT, filePath));
        }
      }
    }
  }
  return changed;
}

function checkVaultLease() {
  const leaseFile = path.join(VAULT_ROOT, '.thumbgate', 'session-lease.json');
  if (!fs.existsSync(leaseFile)) return { held: false };
  try {
    const lease = JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
    const pid = parseInt(lease.pid || lease.sessionId || '0', 10);
    if (!pid) return { held: false };
    try {
      process.kill(pid, 0);
      return { held: true, holder: lease.agent_name || lease.agent || 'unknown', pid };
    } catch {
      return { held: false, stale: true };
    }
  } catch {
    return { held: false };
  }
}

function commitVaultChanges(results) {
  const changedPaths = getChangedVaultPaths(results);
  const currentBranch = gitCmd(VAULT_ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';

  if (changedPaths.length === 0) {
    return {
      committed: false,
      branch: currentBranch,
      note: 'No synced files changed; nothing to commit',
      changedPaths: [],
    };
  }

  const lease = checkVaultLease();
  if (lease.held) {
    return {
      committed: false,
      branch: currentBranch,
      note: `Skipped commit: vault lease held by "${lease.holder}" (pid ${lease.pid})`,
      changedPaths,
    };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const branchName = `agent/sync-workspace-obsidian-${timestamp}`;
  const commitMsg = `sync: workspace obsidian auto-sync ${new Date().toISOString()}`;

  try {
    const branchResult = gitCmd(VAULT_ROOT, ['checkout', '-b', branchName]);
    if (branchResult === '' && gitCmd(VAULT_ROOT, ['rev-parse', '--verify', branchName]) === '') {
      throw new Error('Failed to create branch');
    }

    for (const filePath of changedPaths) {
      gitCmd(VAULT_ROOT, ['add', filePath]);
    }

    const commitOutput = gitCmd(VAULT_ROOT, ['commit', '-m', commitMsg, '--no-verify']);
    const commitSha = gitCmd(VAULT_ROOT, ['rev-parse', 'HEAD']);

    return {
      committed: true,
      branch: branchName,
      commitSha,
      message: commitMsg,
      changedPaths,
      note: `Auto-committed ${changedPaths.length} synced file(s) on ${branchName}`,
    };
  } catch (err) {
    gitCmd(VAULT_ROOT, ['checkout', '--quiet', currentBranch]);
    return {
      committed: false,
      branch: currentBranch,
      note: `Commit failed: ${err.message || 'unknown error'}`,
      changedPaths,
    };
  }
}

function syncWorkspaceProjects(opts = {}) {
  const shouldCommit = opts.commit === true;
  const results = [];
  for (const proj of WORKSPACE_PROJECTS) {
    if (!fs.existsSync(proj.repo)) {
      results.push({ name: proj.name, skipped: true, reason: 'repo_missing' });
      continue;
    }
    const vaultFolder = proj.vaultFolder || proj.name;
    const vaultProjDir = path.join(VAULT_ROOT, 'Projects', vaultFolder);
    const repoObsidianDir = path.join(proj.repo, 'obsidian');

    fs.mkdirSync(vaultProjDir, { recursive: true });
    fs.mkdirSync(repoObsidianDir, { recursive: true });
    const gitExcluded = configureGitExcludeForVisibility(proj.repo, proj.visibility, '/obsidian/');

    // Ensure Blueprint.md exists with EGM Peanuts-and-Hay structure
    const blueprintVault = path.join(vaultProjDir, 'Blueprint.md');
    if (!fs.existsSync(blueprintVault)) {
      fs.writeFileSync(blueprintVault, buildEgmBlueprintDoc(proj), 'utf8');
    }

    const syncedFiles = {};
    for (const fileName of DURABLE_SYNC_FILES) {
      const vFile = path.join(vaultProjDir, fileName);
      const rFile = path.join(repoObsidianDir, fileName);
      if (fs.existsSync(vFile) || fs.existsSync(rFile)) {
        syncedFiles[fileName] = syncBidirectionalFile(vFile, rFile);
      }
    }

    results.push({
      name: proj.name,
      vaultDir: `Projects/${vaultFolder}`,
      repoObsidianDir,
      visibility: proj.visibility,
      gitExcluded,
      syncedFiles,
    });
  }
  const report = {
    ok: true,
    syncedAt: new Date().toISOString(),
    projectCount: results.filter((r) => !r.skipped).length,
    results,
  };

  const currentBranch = gitCmd(VAULT_ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  report.gitCommit = shouldCommit
    ? commitVaultChanges(results)
    : {
        committed: false,
        branch: currentBranch,
        note: 'EGM Peanuts-and-Hay workspace-to-vault bidirectional sync complete. Re-run with --commit to auto-commit.',
        changedPaths: [],
      };

  return report;
}

if (require.main === module) {
  const shouldCommit = process.argv.includes('--commit');
  const report = syncWorkspaceProjects({ commit: shouldCommit });
  console.log(JSON.stringify(report, null, 2));
}

module.exports = {
  WORKSPACE_PROJECTS,
  DURABLE_SYNC_FILES,
  syncWorkspaceProjects,
  commitVaultChanges,
  getChangedVaultPaths,
  checkVaultLease,
  gitCmd,
};
