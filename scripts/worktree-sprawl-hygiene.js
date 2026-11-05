#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ALLOWED_TOP_LEVEL_THUMBGATE_DIRS = new Set([
  'ThumbGate',
  'ThumbGate.worktrees',
  'ThumbGate-Core',
]);

function getDefaultConfig() {
  const home = os.homedir();
  return {
    workspaceDir: path.join(home, 'workspace'),
    repoDir: path.join(home, 'workspace', 'ThumbGate'),
    worktreesContainerDir: path.join(home, 'workspace', 'ThumbGate.worktrees'),
    claudeWorktreesDir: path.join(home, 'workspace', 'ThumbGate', '.claude', 'worktrees'),
    copilotWorktreesDir: path.join(home, 'papercompute-cassettes', 'copilot-worktrees', 'ThumbGate'),
    archiveRootDir: path.join(home, '.thumbgate', 'runtime', 'worktree-archive'),
    otelSpansPath: path.join(home, '.paperclip', 'operations', 'telemetry', 'otel_spans.jsonl'),
    maxInactiveHours: 24,
  };
}

function isThumbGateSiblingSprawlName(entryName = '') {
  if (ALLOWED_TOP_LEVEL_THUMBGATE_DIRS.has(entryName)) return false;
  if (entryName.startsWith('ThumbGate-Core')) return false;
  return entryName.startsWith('ThumbGate-') || entryName.startsWith('tg-');
}

function safeGit(cwd, args = []) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    }).trim();
  } catch {
    return '';
  }
}

function archiveDirtyWorktree(worktreePath, archiveRootDir) {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = path.basename(worktreePath);
  const targetDir = path.join(archiveRootDir, stamp, name);
  fs.mkdirSync(targetDir, { recursive: true });

  const statusText = safeGit(worktreePath, ['status', '--porcelain']);
  const diffText = safeGit(worktreePath, ['diff', 'HEAD']);
  fs.writeFileSync(path.join(targetDir, 'status.txt'), `${statusText}\n`, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'dirty.patch'), `${diffText}\n`, 'utf8');

  for (const line of statusText.split('\n')) {
    if (!line.startsWith('?? ')) continue;
    const relPath = line.slice(3).trim();
    if (!relPath) continue;
    const srcPath = path.join(worktreePath, relPath);
    const dstPath = path.join(targetDir, 'untracked', relPath);
    if (!fs.existsSync(srcPath)) continue;
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.cpSync(srcPath, dstPath, { recursive: true });
  }
  return targetDir;
}

function classifyCandidateWorktree(candidatePath, options = {}) {
  const maxInactiveMs = Number(options.maxInactiveHours ?? 24) * 3600 * 1000;
  const activeBranches = new Set(options.activeBranches || []);
  const isTopLevelSprawl = Boolean(options.isTopLevelSprawl);
  const nowMs = Number(options.nowMs ?? Date.now());

  if (!fs.existsSync(candidatePath)) {
    return { action: 'SKIP_MISSING', candidatePath };
  }

  const stat = fs.statSync(candidatePath);
  const ageMs = Math.max(0, nowMs - stat.mtimeMs);
  const branch = safeGit(candidatePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const statusText = safeGit(candidatePath, ['status', '--porcelain']);
  const isDirty = Boolean(statusText);

  if (!isTopLevelSprawl && activeBranches.has(branch)) {
    return {
      action: 'KEEP_ACTIVE_BRANCH',
      candidatePath,
      branch,
      isDirty,
      ageHours: Number((ageMs / 3600000).toFixed(2)),
    };
  }

  if (!isTopLevelSprawl && ageMs < maxInactiveMs) {
    return {
      action: 'KEEP_RECENT_WORKTREE',
      candidatePath,
      branch,
      isDirty,
      ageHours: Number((ageMs / 3600000).toFixed(2)),
    };
  }

  return {
    action: isDirty ? 'ARCHIVE_AND_REMOVE' : 'REMOVE_CLEAN',
    candidatePath,
    branch,
    isDirty,
    ageHours: Number((ageMs / 3600000).toFixed(2)),
  };
}

function emitOtelHygieneSpan(otelSpansPath, summary) {
  if (!otelSpansPath) return;
  try {
    fs.mkdirSync(path.dirname(otelSpansPath), { recursive: true });
    const span = {
      traceId: crypto.randomBytes(16).toString('hex'),
      spanId: crypto.randomBytes(8).toString('hex'),
      name: 'vcs.worktree.hygiene_sweep',
      timestamp: new Date().toISOString(),
      attributes: {
        'vcs.repository': 'IgorGanapolsky/ThumbGate',
        'vcs.worktree.before_count': summary.beforeTopLevelCount,
        'vcs.worktree.after_count': summary.afterTopLevelCount,
        'vcs.worktree.removed_count': summary.removedCount,
        'vcs.worktree.archived_dirty_count': summary.archivedDirtyCount,
      },
    };
    fs.appendFileSync(otelSpansPath, `${JSON.stringify(span)}\n`, 'utf8');
  } catch {
    // Non-fatal telemetry write
  }
}

function runWorktreeSprawlHygiene(options = {}) {
  const cfg = { ...getDefaultConfig(), ...options };
  const dryRun = Boolean(cfg.dryRun);
  const activeBranches = Array.isArray(cfg.activeBranches) ? cfg.activeBranches : [];

  const workspaceEntries = fs.existsSync(cfg.workspaceDir)
    ? fs.readdirSync(cfg.workspaceDir)
    : [];
  const beforeTopLevelThumbGateDirs = workspaceEntries.filter(
    (name) => name.startsWith('ThumbGate') || name.startsWith('tg-')
  );

  const candidates = [];
  for (const name of workspaceEntries) {
    if (isThumbGateSiblingSprawlName(name)) {
      candidates.push({
        candidatePath: path.join(cfg.workspaceDir, name),
        isTopLevelSprawl: true,
      });
    }
  }

  for (const container of [cfg.worktreesContainerDir, cfg.claudeWorktreesDir, cfg.copilotWorktreesDir]) {
    if (!container || !fs.existsSync(container)) continue;
    for (const child of fs.readdirSync(container)) {
      const fullPath = path.join(container, child);
      if (fs.statSync(fullPath).isDirectory()) {
        candidates.push({
          candidatePath: fullPath,
          isTopLevelSprawl: false,
        });
      }
    }
  }

  const decisions = [];
  let removedCount = 0;
  let archivedDirtyCount = 0;

  for (const item of candidates) {
    const decision = classifyCandidateWorktree(item.candidatePath, {
      maxInactiveHours: cfg.maxInactiveHours,
      activeBranches,
      isTopLevelSprawl: item.isTopLevelSprawl,
      nowMs: cfg.nowMs,
    });

    if (decision.action === 'ARCHIVE_AND_REMOVE' || decision.action === 'REMOVE_CLEAN') {
      if (!dryRun) {
        if (decision.isDirty) {
          decision.archivePath = archiveDirtyWorktree(item.candidatePath, cfg.archiveRootDir);
          archivedDirtyCount += 1;
        }
        safeGit(cfg.repoDir, ['worktree', 'remove', '--force', item.candidatePath]);
        if (fs.existsSync(item.candidatePath)) {
          fs.rmSync(item.candidatePath, { recursive: true, force: true });
        }
      }
      removedCount += 1;
    }
    decisions.push(decision);
  }

  if (!dryRun && fs.existsSync(cfg.repoDir)) {
    safeGit(cfg.repoDir, ['worktree', 'prune']);
  }

  const afterEntries = fs.existsSync(cfg.workspaceDir)
    ? fs.readdirSync(cfg.workspaceDir).filter(
      (name) => name.startsWith('ThumbGate') || name.startsWith('tg-')
    )
    : [];

  const summary = {
    verdict: 'PASS',
    dryRun,
    checkedAt: new Date().toISOString(),
    beforeTopLevelCount: beforeTopLevelThumbGateDirs.length,
    afterTopLevelCount: afterEntries.length,
    remainingTopLevelDirs: afterEntries,
    removedCount,
    archivedDirtyCount,
    decisions,
  };

  if (!dryRun) {
    emitOtelHygieneSpan(cfg.otelSpansPath, summary);
  }

  return summary;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const report = runWorktreeSprawlHygiene({ dryRun });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = {
  ALLOWED_TOP_LEVEL_THUMBGATE_DIRS,
  isThumbGateSiblingSprawlName,
  classifyCandidateWorktree,
  archiveDirtyWorktree,
  runWorktreeSprawlHygiene,
};
