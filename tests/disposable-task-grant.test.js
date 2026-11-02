'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  issueDisposableTaskGrant,
  authorizeDisposableTool,
  readDisposableWorkingScratch,
  spawnDisposableChild,
  extractAndRetireDisposableGrant,
  loadAgentRegistry,
  DISPOSABLE_GRANT_FILENAME,
} = require('../scripts/audit-trail');

function withTempDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-grant-'));
  const origDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  try {
    return fn(tmpDir);
  } finally {
    if (origDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = origDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function grantLines(tmpDir) {
  const grantPath = path.join(tmpDir, DISPOSABLE_GRANT_FILENAME);
  if (!fs.existsSync(grantPath)) return [];
  return fs.readFileSync(grantPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function lastRow(tmpDir, grantId) {
  return grantLines(tmpDir).filter((row) => row.grantId === grantId).pop() || null;
}

function issueAudit(nowMs) {
  return issueDisposableTaskGrant({
    agentId: 'audit-agent',
    taskId: 'audit-task',
    allowedTools: ['Read'],
    allowedChildRoles: ['challenge'],
    ttlMs: 10_000,
    nowMs,
    scratch: { note: 'working draft', attempt: 'first pass' },
  });
}

test('a grant without a deadline is refused and nothing is stored', () => {
  withTempDir((tmpDir) => {
    const result = issueDisposableTaskGrant({
      agentId: 'audit-agent',
      taskId: 'audit-task',
      allowedTools: ['Read'],
      nowMs: 1_000,
    });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, 'ttl_required');
    assert.equal(grantLines(tmpDir).length, 0);
    assert.equal(loadAgentRegistry().length, 0);
  });
});

test('a listed tool works until the deadline, then the same call is denied', () => {
  withTempDir(() => {
    const issued = issueAudit(5_000);
    assert.equal(issued.decision, 'allow');
    assert.match(issued.grant.grantId, /^grant_[0-9a-f-]{36}$/);
    assert.equal(Object.hasOwn(issued.grant, 'scratch'), false);

    const during = authorizeDisposableTool({
      grantId: issued.grant.grantId,
      tool: 'Read',
      nowMs: 6_000,
    });
    assert.equal(during.decision, 'allow');
    assert.equal(during.reason, 'in_grant');

    const outside = authorizeDisposableTool({
      grantId: issued.grant.grantId,
      tool: 'Bash',
      nowMs: 6_000,
    });
    assert.equal(outside.reason, 'tool_not_in_grant');

    const late = authorizeDisposableTool({
      grantId: issued.grant.grantId,
      tool: 'Read',
      nowMs: 15_000,
    });
    assert.equal(late.reason, 'expired');
    assert.equal(readDisposableWorkingScratch(issued.grant.grantId, 6_000).note, 'working draft');
    assert.equal(readDisposableWorkingScratch(issued.grant.grantId, 15_000), null);
  });
});

test('retirement keeps the lesson, drops the working notes, and denies the agent', () => {
  withTempDir((tmpDir) => {
    const issued = issueAudit(5_000);
    const retired = extractAndRetireDisposableGrant({
      grantId: issued.grant.grantId,
      lesson: 'The audit found one unlocked path.',
      evidence: 'Read src/api/server.js',
      nowMs: 7_000,
    });
    assert.equal(retired.reason, 'extracted');
    assert.equal(retired.extracted.lesson, 'The audit found one unlocked path.');
    assert.equal(Object.hasOwn(retired.grant, 'scratch'), false);

    const row = lastRow(tmpDir, issued.grant.grantId);
    assert.equal(row.status, 'retired');
    assert.equal(Object.hasOwn(row, 'scratch'), false);
    assert.equal(readDisposableWorkingScratch(issued.grant.grantId, 6_000), null);

    const again = authorizeDisposableTool({
      grantId: issued.grant.grantId,
      tool: 'Read',
      nowMs: 6_000,
    });
    assert.equal(again.reason, 'retired');

    const identities = loadAgentRegistry().filter((agent) => agent.id === 'audit-agent');
    assert.ok(identities.length > 0);
    assert.ok(identities.every((agent) => agent.metadata.lifecycleStatus === 'retired'));

    const repeat = extractAndRetireDisposableGrant({
      grantId: issued.grant.grantId,
      nowMs: 8_000,
    });
    assert.equal(repeat.reason, 'already_retired');
    assert.equal(repeat.extracted.lesson, 'The audit found one unlocked path.');
  });
});

test('a raw transcript is not stored as the lesson and the grant stays active', () => {
  withTempDir((tmpDir) => {
    const issued = issueAudit(5_000);
    const transcript = ['user: one', 'assistant: two', 'user: three'].join('\n');
    const refused = extractAndRetireDisposableGrant({
      grantId: issued.grant.grantId,
      lesson: transcript,
      nowMs: 6_000,
    });
    assert.equal(refused.reason, 'transcript_not_a_lesson');
    assert.equal(lastRow(tmpDir, issued.grant.grantId).status, 'active');
    assert.equal(readDisposableWorkingScratch(issued.grant.grantId, 6_000).note, 'working draft');
    const still = authorizeDisposableTool({
      grantId: issued.grant.grantId,
      tool: 'Read',
      nowMs: 6_000,
    });
    assert.equal(still.decision, 'allow');
  });
});

test('an explicit discard drops the notes without inventing a lesson', () => {
  withTempDir((tmpDir) => {
    const issued = issueAudit(5_000);
    const retired = extractAndRetireDisposableGrant({
      grantId: issued.grant.grantId,
      discard: true,
      nowMs: 6_000,
    });
    assert.equal(retired.extracted.lesson, null);
    assert.equal(retired.extracted.discarded, true);
    assert.equal(Object.hasOwn(lastRow(tmpDir, issued.grant.grantId), 'scratch'), false);
    assert.equal(authorizeDisposableTool({
      grantId: issued.grant.grantId,
      tool: 'Read',
      nowMs: 6_000,
    }).reason, 'retired');
  });
});

test('a child dies with the parent clock and cannot gain a tool or a role', () => {
  withTempDir((tmpDir) => {
    const parent = issueAudit(1_000_000);
    const clamped = spawnDisposableChild({
      parentGrantId: parent.grant.grantId,
      role: 'challenge',
      allowedTools: ['Read'],
      ttlMs: 50_000,
      nowMs: 1_000_000,
      scratch: { note: 'child notes' },
    });
    assert.equal(clamped.decision, 'allow');
    assert.equal(clamped.grant.expiresAtMs, parent.grant.expiresAtMs);
    assert.notEqual(clamped.grant.agentId, parent.grant.agentId);

    const shorter = spawnDisposableChild({
      parentGrantId: parent.grant.grantId,
      role: 'challenge',
      agentId: 'short-child',
      allowedTools: ['Read'],
      ttlMs: 1_000,
      nowMs: 1_000_000,
    });
    assert.equal(shorter.grant.expiresAtMs, 1_001_000);
    assert.equal(authorizeDisposableTool({
      grantId: shorter.grant.grantId,
      tool: 'Read',
      nowMs: 1_001_000,
    }).reason, 'expired');
    assert.equal(authorizeDisposableTool({
      grantId: parent.grant.grantId,
      tool: 'Read',
      nowMs: 1_001_000,
    }).decision, 'allow');

    const extraTool = spawnDisposableChild({
      parentGrantId: parent.grant.grantId,
      role: 'challenge',
      allowedTools: ['Read', 'Bash'],
      ttlMs: 100,
      nowMs: 1_000_000,
    });
    assert.equal(extraTool.reason, 'child_tools_exceed_parent');

    const extraRole = spawnDisposableChild({
      parentGrantId: parent.grant.grantId,
      role: 'reader',
      allowedTools: ['Read'],
      ttlMs: 100,
      nowMs: 1_000_000,
    });
    assert.equal(extraRole.reason, 'role_not_allowed');
    assert.equal(grantLines(tmpDir).filter((row) => row.parentGrantId === parent.grant.grantId).length, 2);
  });
});

test('retiring the parent drops a child that has not extracted, and keeps one that has', () => {
  withTempDir((tmpDir) => {
    const parent = issueAudit(1_000_000);
    const pending = spawnDisposableChild({
      parentGrantId: parent.grant.grantId,
      role: 'challenge',
      agentId: 'pending-child',
      allowedTools: ['Read'],
      ttlMs: 5_000,
      nowMs: 1_000_000,
      scratch: { note: 'drop me' },
    });
    const finished = spawnDisposableChild({
      parentGrantId: parent.grant.grantId,
      role: 'challenge',
      agentId: 'finished-child',
      allowedTools: ['Read'],
      ttlMs: 5_000,
      nowMs: 1_000_000,
      scratch: { note: 'already distilled' },
    });
    const childLesson = extractAndRetireDisposableGrant({
      grantId: finished.grant.grantId,
      lesson: 'The challenge stood.',
      nowMs: 1_001_000,
    });
    assert.equal(childLesson.extracted.lesson, 'The challenge stood.');

    const parentRetired = extractAndRetireDisposableGrant({
      grantId: parent.grant.grantId,
      lesson: 'Parent audit closed.',
      nowMs: 1_002_000,
    });
    assert.equal(parentRetired.reason, 'extracted');

    const pendingRow = lastRow(tmpDir, pending.grant.grantId);
    assert.equal(pendingRow.status, 'retired');
    assert.equal(pendingRow.extracted.lesson, null);
    assert.equal(pendingRow.extracted.discarded, true);
    assert.equal(Object.hasOwn(pendingRow, 'scratch'), false);
    assert.equal(readDisposableWorkingScratch(pending.grant.grantId, 1_002_000), null);
    assert.equal(authorizeDisposableTool({
      grantId: pending.grant.grantId,
      tool: 'Read',
      nowMs: 1_002_000,
    }).reason, 'retired');

    const finishedRow = lastRow(tmpDir, finished.grant.grantId);
    assert.equal(finishedRow.extracted.lesson, 'The challenge stood.');
    assert.equal(Object.hasOwn(finishedRow, 'scratch'), false);

    const pendingIdentity = loadAgentRegistry().filter((agent) => agent.id === 'pending-child');
    assert.ok(pendingIdentity.every((agent) => agent.metadata.lifecycleStatus === 'retired'));
  });
});
