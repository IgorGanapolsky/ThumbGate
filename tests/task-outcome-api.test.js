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
  const previousInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_API_KEY = 'task-outcome-api-test-key';
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

    const decided = await fetch(`${baseUrl}/v1/escalations/${encodeURIComponent(escalationId)}/decision`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'approved',
        actor: { id: 'human-reviewer', kind: 'human' },
        reason: 'Evidence reviewed',
      }),
    });
    assert.equal(decided.status, 200);
    assert.equal((await decided.json()).escalation.status, 'approved');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = previousKey;
    if (previousInsecure === undefined) delete process.env.THUMBGATE_ALLOW_INSECURE;
    else process.env.THUMBGATE_ALLOW_INSECURE = previousInsecure;
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
  }
});
