const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-mcp-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;
process.env.RLHF_NO_RATE_LIMIT = '1'; // bypass free-tier rate limits during tests

const { handleRequest, TOOLS, SAFE_DATA_DIR } = require('../adapters/mcp/server-stdio');

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
});

test('tools/list returns all configured tools', async () => {
  const result = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(Array.isArray(result.tools), true);
  assert.equal(result.tools.length, TOOLS.length);
});

test('capture_feedback tool can be called', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'capture_feedback',
      arguments: {
        signal: 'up',
        context: 'Verified with tests',
        whatWorked: 'Evidence first',
        tags: ['verification'],
      },
    },
  });

  assert.equal(Array.isArray(result.content), true);
  assert.match(result.content[0].text, /accepted|Feedback/i);
});

test('capture_feedback applies rubric anti-hacking gate', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 23,
    method: 'tools/call',
    params: {
      name: 'capture_feedback',
      arguments: {
        signal: 'up',
        context: 'Looks right',
        whatWorked: 'No proof',
        rubricScores: [
          { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
          { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing test output' },
        ],
        guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
        tags: ['verification'],
      },
    },
  });
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.accepted, false);
  assert.match(payload.reason, /Rubric gate prevented promotion/);
});

test('capture_feedback returns clarification_required for vague positive feedback', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 24,
    method: 'tools/call',
    params: {
      name: 'capture_feedback',
      arguments: {
        signal: 'up',
        context: 'thumbs up',
        tags: ['verification'],
      },
    },
  });
  
  const text = result.content[0].text;
  assert.equal(result.isError, undefined);
  assert.match(text, /"accepted":\s*false/);
  assert.match(text, /"status":\s*"clarification_required"/);
  assert.match(text, /"needsClarification":\s*true/);
  assert.match(text, /What specifically worked that should be repeated/);
});

test('intent tools list and plan enforce checkpoint flow', async () => {
  const listResult = await handleRequest({
    jsonrpc: '2.0',
    id: 21,
    method: 'tools/call',
    params: {
      name: 'list_intents',
      arguments: { mcpProfile: 'default' },
    },
  });
  const catalog = JSON.parse(listResult.content[0].text);
  assert.ok(Array.isArray(catalog.intents));
  assert.ok(catalog.intents.length >= 3);

  const planResult = await handleRequest({
    jsonrpc: '2.0',
    id: 22,
    method: 'tools/call',
    params: {
      name: 'plan_intent',
      arguments: {
        intentId: 'publish_dpo_training_data',
        mcpProfile: 'default',
      },
    },
  });
  const plan = JSON.parse(planResult.content[0].text);
  assert.equal(plan.status, 'checkpoint_required');
  assert.equal(plan.requiresApproval, true);
});

test('plan_intent exposes partner-aware strategy over MCP', async () => {
  const planResult = await handleRequest({
    jsonrpc: '2.0',
    id: 25,
    method: 'tools/call',
    params: {
      name: 'plan_intent',
      arguments: {
        intentId: 'incident_postmortem',
        mcpProfile: 'default',
        partnerProfile: 'strict-reviewer',
      },
    },
  });
  const plan = JSON.parse(planResult.content[0].text);
  assert.equal(plan.partnerProfile, 'strict_reviewer');
  assert.equal(plan.partnerStrategy.verificationMode, 'evidence_first');
  assert.ok(Array.isArray(plan.actionScores));
});

test('diagnose_failure exposes compiled constraints and root cause over MCP', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 251,
    method: 'tools/call',
    params: {
      name: 'diagnose_failure',
      arguments: {
        step: 'capture_feedback',
        context: 'Attempted to approve publish flow without required approval',
        toolName: 'capture_feedback',
        toolArgs: {},
        intentId: 'publish_dpo_training_data',
        mcpProfile: 'default',
      },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.rootCauseCategory, 'intent_plan_misalignment');
  assert.ok(payload.compiledConstraints.summary.toolSchemaCount >= 1);
});

test('diagnose_failure honors MCP profile allowlists', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 252,
    method: 'tools/call',
    params: {
      name: 'diagnose_failure',
      arguments: {
        step: 'capture_feedback',
        context: 'Attempted write tool from locked profile',
        toolName: 'capture_feedback',
        toolArgs: {
          signal: 'down',
        },
        mcpProfile: 'locked',
      },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.rootCauseCategory, 'invalid_invocation');
  assert.ok(payload.violations.some((violation) => violation.source === 'mcp_policy'));
  assert.ok(payload.compiledConstraints.summary.toolSchemaCount < TOOLS.length);
});

test('plan_intent includes codegraph impact for coding workflows', async () => {
  const previous = process.env.RLHF_CODEGRAPH_STUB_RESPONSE;
  process.env.RLHF_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
    source: 'stub',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent'],
    callees: ['rankActions'],
    deadCode: ['legacyIntentPlanner'],
  });

  try {
    const planResult = await handleRequest({
      jsonrpc: '2.0',
      id: 26,
      method: 'tools/call',
      params: {
        name: 'plan_intent',
        arguments: {
          intentId: 'incident_postmortem',
          context: 'Refactor `planIntent` in scripts/intent-router.js',
          mcpProfile: 'default',
        },
      },
    });
    const plan = JSON.parse(planResult.content[0].text);
    assert.equal(plan.codegraphImpact.enabled, true);
    assert.equal(plan.codegraphImpact.evidence.deadCodeCount, 1);
    assert.ok(plan.partnerStrategy.recommendedChecks.some((check) => /dead code/i.test(check)));
  } finally {
    if (previous === undefined) delete process.env.RLHF_CODEGRAPH_STUB_RESPONSE;
    else process.env.RLHF_CODEGRAPH_STUB_RESPONSE = previous;
  }
});

test('recall includes code graph impact section for coding workflows', async () => {
  const previous = process.env.RLHF_CODEGRAPH_STUB_RESPONSE;
  process.env.RLHF_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
    source: 'stub',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent'],
    callees: ['rankActions'],
    deadCode: ['legacyIntentPlanner'],
  });

  try {
    const result = await handleRequest({
      jsonrpc: '2.0',
      id: 27,
      method: 'tools/call',
      params: {
        name: 'recall',
        arguments: {
          query: 'Refactor `planIntent` in scripts/intent-router.js',
        },
      },
    });

    assert.match(result.content[0].text, /## Code Graph Impact/);
    assert.match(result.content[0].text, /Potential dead code/);
  } finally {
    if (previous === undefined) delete process.env.RLHF_CODEGRAPH_STUB_RESPONSE;
    else process.env.RLHF_CODEGRAPH_STUB_RESPONSE = previous;
  }
});

test('prevention_rules blocks external output paths', async () => {
  await assert.rejects(async () => {
    await handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'prevention_rules',
        arguments: {
          outputPath: '/tmp/forbidden-outside-safe-root.md',
        },
      },
    });
  }, /Path must stay within/);
});

test('construct/evaluate context pack tools work', async () => {
  const construct = await handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'construct_context_pack',
      arguments: {
        query: 'verification',
        maxItems: 5,
      },
    },
  });

  assert.equal(Array.isArray(construct.content), true);
  const payload = JSON.parse(construct.content[0].text);
  assert.ok(payload.packId);

  const evaluate = await handleRequest({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'evaluate_context_pack',
      arguments: {
        packId: payload.packId,
        outcome: 'useful',
        signal: 'positive',
        rubricScores: [
          { criterion: 'correctness', score: 4, evidence: 'tests pass', judge: 'judge-a' },
          { criterion: 'verification_evidence', score: 4, evidence: 'logs attached', judge: 'judge-a' },
        ],
        guardrails: { testsPassed: true, pathSafety: true, budgetCompliant: true },
      },
    },
  });
  assert.match(evaluate.content[0].text, /rubricEvaluation/);

  const prov = await handleRequest({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'context_provenance',
      arguments: { limit: 5 },
    },
  });
  assert.ok(prov.content[0].text.length > 0);
});

test('construct_context_pack rejects invalid namespaces', async () => {
  await assert.rejects(async () => {
    await handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'construct_context_pack',
        arguments: {
          query: 'verification',
          namespaces: ['../..'],
        },
      },
    });
  }, /Unsupported namespace/);
});

test('safe data dir resolves inside test feedback root', () => {
  assert.equal(SAFE_DATA_DIR.startsWith(tmpFeedbackDir), true);
});
