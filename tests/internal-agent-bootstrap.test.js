const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bootstrap-feedback-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;

const {
  normalizeInvocation,
  buildStartupContext,
  ensureWorktreeSandbox,
  bootstrapInternalAgent,
} = require('../scripts/internal-agent-bootstrap');

function initGitRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bootstrap-repo-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ThumbGate Test'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'thumbgate@example.com'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoPath, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# temp repo\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoPath, stdio: 'ignore' });
  return repoPath;
}

function removeWorktree(repoPath, worktreePath) {
  if (!repoPath || !worktreePath || !fs.existsSync(worktreePath)) return;
  execFileSync('git', ['-C', repoPath, 'worktree', 'remove', '--force', worktreePath], {
    stdio: 'ignore',
  });
}

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
});

test('normalizeInvocation derives stable thread and intent defaults', () => {
  const invocation = normalizeInvocation({
    source: 'github',
    trigger: { type: 'issue_comment', id: '123', actor: 'octocat' },
    task: {
      title: 'Fix flaky MCP proof',
      body: 'Refactor scripts/intent-router.js and show evidence.',
      labels: ['infra', 'proof'],
    },
    comments: [{ author: 'octocat', text: 'Please harden the proof flow.' }],
  });

  assert.equal(invocation.source, 'github');
  assert.equal(invocation.threadId, 'github-123');
  assert.equal(invocation.intentId, 'improve_response_quality');
  assert.deepEqual(invocation.task.labels, ['infra', 'proof']);
  assert.equal(invocation.comments.length, 1);
});

test('buildStartupContext assembles trigger, task, and history sections', () => {
  const invocation = normalizeInvocation({
    source: 'slack',
    trigger: { type: 'mention', actor: 'operator' },
    task: { title: 'Investigate proof drift', body: 'Summarize the failing signals.' },
    messages: [{ author: 'operator', text: 'Need a verified answer.' }],
    context: 'Treat this like a production escalation.',
  });

  const startup = buildStartupContext(invocation);
  assert.match(startup.text, /## Trigger/);
  assert.match(startup.text, /## Task/);
  assert.match(startup.text, /## Conversation/);
  assert.match(startup.text, /Treat this like a production escalation/);
});

test('ensureWorktreeSandbox creates and reuses a git worktree sandbox', () => {
  const repoPath = initGitRepo();
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bootstrap-sandbox-'));

  try {
    const first = ensureWorktreeSandbox({
      repoPath,
      sandboxRoot,
      threadId: 'github-proof-123',
    });
    assert.equal(first.ready, true);
    assert.equal(first.reused, false);
    assert.equal(fs.existsSync(path.join(first.path, '.git')), true);

    const second = ensureWorktreeSandbox({
      repoPath,
      sandboxRoot,
      threadId: 'github-proof-123',
    });
    assert.equal(second.ready, true);
    assert.equal(second.reused, true);
    assert.equal(second.path, first.path);

    removeWorktree(repoPath, first.path);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

test('bootstrapInternalAgent returns recall, sandbox, and reviewer-lane plan', () => {
  const repoPath = initGitRepo();
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bootstrap-agent-'));
  const previousStub = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
    source: 'stub',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent'],
    callees: ['rankActions'],
    deadCode: ['legacyIntentPlanner'],
  });

  let payload;
  try {
    payload = bootstrapInternalAgent({
      source: 'github',
      repoPath,
      sandboxRoot,
      context: 'Improve the response with evidence and prevention rules',
      trigger: { type: 'pull_request_comment', id: '77', actor: 'octocat' },
      thread: { title: 'PR #77' },
      task: {
        title: 'Harden MCP proof flow',
        body: 'Refactor scripts/intent-router.js and provide verification evidence.',
        labels: ['proof', 'adapter'],
      },
      comments: [
        { author: 'octocat', text: 'Please make the adapter proof deterministic.' },
      ],
    });

    assert.equal(payload.sandbox.ready, true);
    assert.ok(payload.recallPack.packId);
    assert.equal(payload.intentPlan.executionMode, 'sequential_delegate');
    assert.equal(payload.reviewerLane.enabled, true);
    assert.equal(payload.codeGraph.enabled, true);
    assert.ok(payload.middlewarePlan.some((step) => step.step === 'proof_gate'));

    removeWorktree(repoPath, payload.sandbox.path);
  } finally {
    if (previousStub === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previousStub;
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
});
