'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  isThumbGateSiblingSprawlName,
  classifyCandidateWorktree,
  runWorktreeSprawlHygiene,
} = require('../scripts/worktree-sprawl-hygiene');

test('isThumbGateSiblingSprawlName allows only canonical ThumbGate, ThumbGate.worktrees, and ThumbGate-Core at top level', () => {
  assert.equal(isThumbGateSiblingSprawlName('ThumbGate'), false);
  assert.equal(isThumbGateSiblingSprawlName('ThumbGate.worktrees'), false);
  assert.equal(isThumbGateSiblingSprawlName('ThumbGate-Core'), false);
  assert.equal(isThumbGateSiblingSprawlName('ThumbGate-Core.worktrees'), false);
  assert.equal(isThumbGateSiblingSprawlName('ThumbGate-a2ui-fast-ui'), true);
  assert.equal(isThumbGateSiblingSprawlName('tg-worker-graph'), true);
});

test('runWorktreeSprawlHygiene removes top-level sibling sprawl and preserves recent worktrees inside ThumbGate.worktrees', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hygiene-test-'));
  const workspaceDir = path.join(tmpRoot, 'workspace');
  const repoDir = path.join(workspaceDir, 'ThumbGate');
  const worktreesContainerDir = path.join(workspaceDir, 'ThumbGate.worktrees');
  const sprawlDir = path.join(workspaceDir, 'ThumbGate-stale-feature');
  const recentWtDir = path.join(worktreesContainerDir, 'agent-active-work');

  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(sprawlDir, { recursive: true });
  fs.mkdirSync(recentWtDir, { recursive: true });

  const report = runWorktreeSprawlHygiene({
    workspaceDir,
    repoDir,
    worktreesContainerDir,
    claudeWorktreesDir: path.join(tmpRoot, 'none1'),
    copilotWorktreesDir: path.join(tmpRoot, 'none2'),
    archiveRootDir: path.join(tmpRoot, 'archive'),
    otelSpansPath: path.join(tmpRoot, 'otel.jsonl'),
    maxInactiveHours: 24,
  });

  assert.equal(report.verdict, 'PASS');
  assert.equal(report.beforeTopLevelCount, 3);
  assert.equal(report.afterTopLevelCount, 2);
  assert.deepEqual(report.remainingTopLevelDirs.sort(), ['ThumbGate', 'ThumbGate.worktrees']);
  assert.equal(fs.existsSync(sprawlDir), false);
  assert.equal(fs.existsSync(recentWtDir), true);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('classifyCandidateWorktree keeps active branch worktrees inside ThumbGate.worktrees and flags top-level sprawl', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-classify-'));
  const topDecision = classifyCandidateWorktree(tmpDir, {
    isTopLevelSprawl: true,
    maxInactiveHours: 24,
  });
  assert.equal(topDecision.action, 'REMOVE_CLEAN');

  const recentDecision = classifyCandidateWorktree(tmpDir, {
    isTopLevelSprawl: false,
    maxInactiveHours: 24,
  });
  assert.equal(recentDecision.action, 'KEEP_RECENT_WORKTREE');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
