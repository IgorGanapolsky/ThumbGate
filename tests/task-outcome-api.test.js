'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApiServer } = require('../src/api/server');

test('task outcome and human escalation APIs preserve verification and identity controls', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-outcome-api-'));
  const previousKey = process.env.THUMBGATE_API_KEY;
  const previousOperatorKey = process.env.THUMBGATE_OPERATOR_KEY;
  const previousHumanReviewerKey = process.env.THUMBGATE_HUMAN_REVIEWER_KEY;
  const previousHumanReviewerId = process.env.THUMBGATE_HUMAN_REVIEWER_ID;
  const previousInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_API_KEY = 'task-outcome-api-test-key';
  process.env.THUMBGATE_OPERATOR_KEY = 'task-outcome-operator-test-key';
  process.env.THUMBGATE_HUMAN_REVIEWER_KEY = 'task-outcome-human-reviewer-test-key';
  process.env.THUMBGATE_HUMAN_REVIEWER_ID = 'reviewer-from-server-config';
  delete process.env.THUMBGATE_ALLOW_INSECURE;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;

  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = {
    Authorization: 'Bearer task-outcome-api-test-key',
    'Content-Type': 'application/json',
  };

  try {
    const recorded = await fetch(`${baseUrl}/v1/task-outcomes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        taskId: 'api-task-1',
        taskType: 'api-test',
        goal: 'Verify the task outcome API',
        status: 'completed',
        verification: {
          performed: true,
          passed: true,
          evidence: ['API regression passed'],
          unsupportedClaims: 0,
        },
        toolCalls: [],
        policy: {
          violations: 0,
          unsafeEscapes: 0,
          falseBlocks: 0,
        },
        efficiency: {
          latencyMs: 10,
          costUsd: 0,
          firstAttempt: true,
        },
        idempotencyKey: 'api-task-1',
      }),
    });
    assert.equal(recorded.status, 201);
    assert.equal((await recorded.json()).receipt.working, true);

    const metrics = await fetch(`${baseUrl}/v1/task-outcomes/metrics`, { headers });
    assert.equal(metrics.status, 200);
    const metricsBody = await metrics.json();
    assert.equal(metricsBody.sampleSize, 1);
    assert.equal(metricsBody.task.verifiedCompletionRate, 1);

    const operatorMonitor = await fetch(`${baseUrl}/v1/task-outcomes/monitor`, {
      headers: {
        Authorization: 'Bearer task-outcome-operator-test-key',
      },
    });
    assert.equal(operatorMonitor.status, 200);
    const monitorBody = await operatorMonitor.json();
    assert.equal(monitorBody.verdict, 'insufficient_evidence');
    assert.equal(monitorBody.observability.evidenceStatus, 'insufficient_evidence');
    assert.equal(monitorBody.observability.minimumToolCalls, 20);

    const requested = await fetch(`${baseUrl}/v1/escalations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        taskId: 'api-risk-1',
        reason: 'Human review required',
        requester: { id: 'agent-api', kind: 'agent' },
        evidence: ['policy match'],
        idempotencyKey: 'api-risk-1',
      }),
    });
    assert.equal(requested.status, 201);
    const escalationId = (await requested.json()).escalation.escalationId;

    const missingReviewerCredential = await fetch(`${baseUrl}/v1/escalations/${encodeURIComponent(escalationId)}/decision`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'approved',
        reason: 'Evidence reviewed',
      }),
    });
    assert.equal(missingReviewerCredential.status, 403);

    const reviewerHeaders = {
      ...headers,
      'X-ThumbGate-Human-Reviewer-Key': 'task-outcome-human-reviewer-test-key',
    };
    const forgedActor = await fetch(`${baseUrl}/v1/escalations/${encodeURIComponent(escalationId)}/decision`, {
      method: 'POST',
      headers: reviewerHeaders,
      body: JSON.stringify({
        decision: 'approved',
        actor: { id: 'fabricated-reviewer', kind: 'human' },
        reason: 'Caller tried to choose the reviewer identity',
      }),
    });
    assert.equal(forgedActor.status, 400);

    const decided = await fetch(`${baseUrl}/v1/escalations/${encodeURIComponent(escalationId)}/decision`, {
      method: 'POST',
      headers: reviewerHeaders,
      body: JSON.stringify({
        decision: 'approved',
        reason: 'Evidence reviewed',
      }),
    });
    assert.equal(decided.status, 200);
    const decidedBody = await decided.json();
    assert.equal(decidedBody.escalation.status, 'approved');
    assert.deepEqual(decidedBody.escalation.actor, {
      id: 'reviewer-from-server-config',
      kind: 'human',
      role: 'admin',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = previousKey;
    if (previousOperatorKey === undefined) delete process.env.THUMBGATE_OPERATOR_KEY;
    else process.env.THUMBGATE_OPERATOR_KEY = previousOperatorKey;
    if (previousHumanReviewerKey === undefined) delete process.env.THUMBGATE_HUMAN_REVIEWER_KEY;
    else process.env.THUMBGATE_HUMAN_REVIEWER_KEY = previousHumanReviewerKey;
    if (previousHumanReviewerId === undefined) delete process.env.THUMBGATE_HUMAN_REVIEWER_ID;
    else process.env.THUMBGATE_HUMAN_REVIEWER_ID = previousHumanReviewerId;
    if (previousInsecure === undefined) delete process.env.THUMBGATE_ALLOW_INSECURE;
    else process.env.THUMBGATE_ALLOW_INSECURE = previousInsecure;
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
  }
});

test('human escalation decision API rejects a reviewer key reused as the admin key', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reviewer-key-api-'));
  const previous = {
    adminCredential: process.env.THUMBGATE_API_KEY,
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    reviewerCredential: process.env.THUMBGATE_HUMAN_REVIEWER_KEY,
    humanReviewerId: process.env.THUMBGATE_HUMAN_REVIEWER_ID,
    insecure: process.env.THUMBGATE_ALLOW_INSECURE,
    operatorCredential: process.env.THUMBGATE_OPERATOR_KEY,
  };
  process.env.THUMBGATE_API_KEY = 'shared-admin-and-reviewer-test-key';
  process.env.THUMBGATE_HUMAN_REVIEWER_KEY = 'shared-admin-and-reviewer-test-key';
  process.env.THUMBGATE_HUMAN_REVIEWER_ID = 'configured-human';
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  delete process.env.THUMBGATE_ALLOW_INSECURE;
  delete process.env.THUMBGATE_OPERATOR_KEY;

  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: 'Bearer shared-admin-and-reviewer-test-key',
    'Content-Type': 'application/json',
  };

  try {
    const requested = await fetch(`${baseUrl}/v1/escalations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        taskId: 'reused-key-risk',
        reason: 'Verify credential independence',
        requester: { id: 'agent-api', kind: 'agent' },
        evidence: ['security regression'],
      }),
    });
    const escalationId = (await requested.json()).escalation.escalationId;
    const decision = await fetch(`${baseUrl}/v1/escalations/${encodeURIComponent(escalationId)}/decision`, {
      method: 'POST',
      headers: {
        ...headers,
        'X-ThumbGate-Human-Reviewer-Key': 'shared-admin-and-reviewer-test-key',
      },
      body: JSON.stringify({
        decision: 'approved',
        reason: 'This must not be accepted',
      }),
    });

    assert.equal(decision.status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    restoreEnv('THUMBGATE_API_KEY', previous.adminCredential);
    restoreEnv('THUMBGATE_FEEDBACK_DIR', previous.feedbackDir);
    restoreEnv('THUMBGATE_HUMAN_REVIEWER_KEY', previous.reviewerCredential);
    restoreEnv('THUMBGATE_HUMAN_REVIEWER_ID', previous.humanReviewerId);
    restoreEnv('THUMBGATE_ALLOW_INSECURE', previous.insecure);
    restoreEnv('THUMBGATE_OPERATOR_KEY', previous.operatorCredential);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
