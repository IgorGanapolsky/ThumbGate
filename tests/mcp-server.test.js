const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-mcp-test-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-mcp-proof-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
process.env.THUMBGATE_NO_RATE_LIMIT = '1'; // bypass free-tier rate limits during tests

const RUNNER_PATH = require.resolve('../scripts/async-job-runner');
const HARNESS_PATH = require.resolve('../scripts/natural-language-harness');
const VERIFICATION_PATH = require.resolve('../scripts/verification-loop');

const { handleRequest, TOOLS, SAFE_DATA_DIR } = require('../adapters/mcp/server-stdio');

function initGitRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-mcp-repo-'));
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

function stubModule(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

function makeAcceptedVerification() {
  return {
    accepted: true,
    attempts: 1,
    finalVerification: {
      score: 1,
      violations: [],
    },
    partnerStrategy: {
      profile: 'strict_reviewer',
      verificationMode: 'evidence_first',
    },
    partnerReward: {
      reward: 1,
    },
  };
}

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  fs.rmSync(tmpProofDir, { recursive: true, force: true });
});

test('tools/list returns all configured tools', async () => {
  const result = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(Array.isArray(result.tools), true);
  assert.equal(result.tools.length, TOOLS.length);
  for (const tool of result.tools) {
    const annotations = tool.annotations || {};
    const hasReadOnlyHint = annotations.readOnlyHint === true;
    const hasDestructiveHint = annotations.destructiveHint === true;
    assert.equal(hasReadOnlyHint || hasDestructiveHint, true, `${tool.name} must declare a safety annotation`);
    assert.equal(hasReadOnlyHint && hasDestructiveHint, false, `${tool.name} must not claim both readOnlyHint and destructiveHint`);
  }
});

test('list_harnesses tool returns the natural-language harness catalog', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 29,
    method: 'tools/call',
    params: {
      name: 'list_harnesses',
      arguments: {
        tag: 'verification',
      },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.harnesses.length, 1);
  assert.equal(payload.harnesses[0].id, 'repo-full-verification');
});

test('settings_status tool returns resolved settings with origin metadata', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 28,
    method: 'tools/call',
    params: {
      name: 'settings_status',
      arguments: {},
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.ok(payload.resolvedSettings);
  assert.ok(Array.isArray(payload.origins));
  assert.ok(payload.origins.some((entry) => entry.path === 'mcp.defaultProfile'));
});

test('run_harness tool executes a natural-language harness over MCP', async () => {
  delete require.cache[RUNNER_PATH];
  delete require.cache[HARNESS_PATH];
  delete require.cache[VERIFICATION_PATH];
  stubModule(VERIFICATION_PATH, {
    runVerificationLoop: () => makeAcceptedVerification(),
  });

  try {
    const result = await handleRequest({
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'run_harness',
        arguments: {
          harness: 'repo-full-verification',
          jobId: 'mcp-run-harness-job',
          inputs: {
            verificationCommand: 'node -e "process.stdout.write(\'verify ok\')"',
          },
        },
      },
    });

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.status, 'completed');
    assert.equal(payload.jobId, 'mcp-run-harness-job');
    assert.equal(payload.phases.verification.accepted, true);
  } finally {
    delete require.cache[RUNNER_PATH];
    delete require.cache[HARNESS_PATH];
    delete require.cache[VERIFICATION_PATH];
  }
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

test('capture_feedback can promote a vague negative signal from chatHistory over MCP', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 31,
    method: 'tools/call',
    params: {
      name: 'capture_feedback',
      arguments: {
        signal: 'down',
        context: 'thumbs down',
        chatHistory: [
          { author: 'user', text: 'Do not use Tailwind in this repo.' },
          { author: 'assistant', text: 'I used Tailwind classes in the hero rewrite.' },
        ],
        tags: ['ui'],
      },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.accepted, true);
  assert.match(payload.feedbackEvent.whatWentWrong, /ignored a prior instruction/i);
  assert.equal(payload.feedbackEvent.conversationWindow.length, 2);
});

test('retrieve_lessons returns relevant lessons for the current tool context', async () => {
  await handleRequest({
    jsonrpc: '2.0',
    id: 32,
    method: 'tools/call',
    params: {
      name: 'capture_feedback',
      arguments: {
        signal: 'down',
        context: 'Bash pushed directly to main without verification',
        whatWentWrong: 'Pushed to main before running tests',
        whatToChange: 'Run tests before any push to main',
        tags: ['git-workflow', 'verification'],
      },
    },
  });

  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 33,
    method: 'tools/call',
    params: {
      name: 'retrieve_lessons',
      arguments: {
        toolName: 'Bash',
        actionContext: 'git push origin main after editing src/api/server.js',
        maxResults: 1,
      },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(Array.isArray(payload), true);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].signal, 'negative');
  assert.ok(payload[0].relevanceScore > 0);
});

test('reflect_on_feedback returns a proposed rule from the conversation window', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 34,
    method: 'tools/call',
    params: {
      name: 'reflect_on_feedback',
      arguments: {
        context: 'editing auth files',
        whatWentWrong: 'Edited .env directly',
        conversationWindow: [
          { role: 'user', content: 'Do not edit the .env file directly.' },
          { role: 'assistant', content: 'Edit(.env) removed the token.' },
          { role: 'user', content: 'Wrong, never do that here.' },
        ],
      },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.status, 'reflection_complete');
  assert.equal(payload.proposedRule.source, 'user-correction');
  assert.match(payload.message, /Correct\?/);
});

test('report_product_issue logs local product feedback over MCP', async () => {
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  try {
    const result = await handleRequest({
      jsonrpc: '2.0',
      id: 34.5,
      method: 'tools/call',
      params: {
        name: 'report_product_issue',
        arguments: {
          title: 'Lessons tab keeps resetting',
          body: 'The lessons tab resets every time I switch back from the dashboard.',
          category: 'bug',
        },
      },
    });

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.success, true);
    assert.equal(payload.issueNumber, null);
    assert.match(payload.note, /logged locally/);

    const feedbackLogPath = path.join(tmpFeedbackDir, 'user-feedback.jsonl');
    const entries = fs.readFileSync(feedbackLogPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const latest = entries.at(-1);
    assert.equal(latest.title, 'Lessons tab keeps resetting');
    assert.equal(latest.category, 'bug');
    assert.equal(latest.source, 'mcp tool');
  } finally {
    if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGithubToken;
    if (originalGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGhToken;
  }
});

test('feedback session tools support follow-up capture and finalization over MCP', async () => {
  const opened = await handleRequest({
    jsonrpc: '2.0',
    id: 35,
    method: 'tools/call',
    params: {
      name: 'open_feedback_session',
      arguments: {
        feedbackEventId: 'fb_session_test',
        signal: 'down',
        initialContext: 'thumbs down',
      },
    },
  });

  const openedPayload = JSON.parse(opened.content[0].text);
  assert.equal(openedPayload.status, 'open');
  assert.ok(openedPayload.sessionId);

  const appended = await handleRequest({
    jsonrpc: '2.0',
    id: 36,
    method: 'tools/call',
    params: {
      name: 'append_feedback_context',
      arguments: {
        sessionId: openedPayload.sessionId,
        message: 'you lied about the tests passing',
      },
    },
  });

  const appendedPayload = JSON.parse(appended.content[0].text);
  assert.equal(appendedPayload.status, 'appended');
  assert.equal(appendedPayload.messageCount, 1);

  const finalized = await handleRequest({
    jsonrpc: '2.0',
    id: 37,
    method: 'tools/call',
    params: {
      name: 'finalize_feedback_session',
      arguments: {
        sessionId: openedPayload.sessionId,
      },
    },
  });

  const finalizedPayload = JSON.parse(finalized.content[0].text);
  assert.equal(finalizedPayload.status, 'finalized');
  assert.equal(finalizedPayload.followUpCount, 1);
  assert.equal(finalizedPayload.complaints[0].type, 'dishonesty');
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
  assert.equal(plan.executionMode, 'single_agent');
  assert.equal(plan.delegationEligible, false);
  assert.equal(plan.delegationScore, 0);
  assert.equal(plan.delegateProfile, null);
  assert.equal(plan.handoffContract, null);
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

test('start_handoff and complete_handoff expose sequential delegation over MCP', async () => {
  const planResult = await handleRequest({
    jsonrpc: '2.0',
    id: 26,
    method: 'tools/call',
    params: {
      name: 'plan_intent',
      arguments: {
        intentId: 'improve_response_quality',
        context: 'Improve the response with evidence and prevention rules',
        mcpProfile: 'default',
        delegationMode: 'auto',
      },
    },
  });
  const plan = JSON.parse(planResult.content[0].text);
  assert.equal(plan.executionMode, 'sequential_delegate');
  assert.equal(plan.delegateProfile, 'pr_workflow');
  assert.ok(plan.handoffContract);

  const startResult = await handleRequest({
    jsonrpc: '2.0',
    id: 27,
    method: 'tools/call',
    params: {
      name: 'start_handoff',
      arguments: {
        intentId: 'improve_response_quality',
        context: 'Improve the response with evidence and prevention rules',
        mcpProfile: 'default',
      },
    },
  });
  const started = JSON.parse(startResult.content[0].text);
  assert.equal(started.status, 'started');
  assert.equal(started.executionMode, 'sequential_delegate');
  assert.equal(started.delegateProfile, 'pr_workflow');
  assert.ok(started.handoffContract);
  assert.ok(Array.isArray(started.handoffContract.requiredChecks));

  const completeResult = await handleRequest({
    jsonrpc: '2.0',
    id: 28,
    method: 'tools/call',
    params: {
      name: 'complete_handoff',
      arguments: {
        handoffId: started.handoffId,
        outcome: 'accepted',
        summary: 'Accepted after evidence review.',
        resultContext: 'Returned a verified result context with explicit evidence and clean checks.',
        attempts: 2,
        violationCount: 0,
      },
    },
  });
  const completed = JSON.parse(completeResult.content[0].text);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.outcome, 'accepted');
  assert.equal(completed.verificationAccepted, true);
});

test('bootstrap_internal_agent creates a sandbox and reviewer plan over MCP', async () => {
  const repoPath = initGitRepo();
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-mcp-bootstrap-'));
  const previous = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
    source: 'stub',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent'],
    callees: ['rankActions'],
    deadCode: ['legacyIntentPlanner'],
  });

  try {
    const result = await handleRequest({
      jsonrpc: '2.0',
      id: 281,
      method: 'tools/call',
      params: {
        name: 'bootstrap_internal_agent',
        arguments: {
          source: 'github',
          repoPath,
          sandboxRoot,
          context: 'Improve the response with evidence and prevention rules',
          trigger: { type: 'pull_request_comment', id: '42', actor: 'octocat' },
          thread: { title: 'PR #42' },
          task: {
            title: 'Harden the MCP adapter',
            body: 'Refactor scripts/intent-router.js and show proof.',
          },
          comments: [
            { author: 'octocat', text: 'Need a verified bootstrap flow.' },
          ],
        },
      },
    });

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.sandbox.ready, true);
    assert.equal(payload.reviewerLane.enabled, true);
    assert.ok(payload.recallPack.packId);
    assert.equal(payload.codeGraph.enabled, true);
    assert.ok(payload.middlewarePlan.some((step) => step.step === 'proof_gate'));

    removeWorktree(repoPath, payload.sandbox.path);
  } finally {
    if (previous === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previous;
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
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
  const previous = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
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
    if (previous === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previous;
  }
});

test('recall includes code graph impact section for coding workflows', async () => {
  const previous = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
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
    if (previous === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previous;
  }
});

test('search_lessons returns promoted lessons with corrective actions over MCP', async () => {
  const feedbackLogPath = path.join(tmpFeedbackDir, 'feedback-log.jsonl');
  const memoryLogPath = path.join(tmpFeedbackDir, 'memory-log.jsonl');
  const rulesPath = path.join(tmpFeedbackDir, 'prevention-rules.md');
  const autoGatesPath = path.join(tmpFeedbackDir, 'auto-promoted-gates.json');
  const backups = [
    [feedbackLogPath, fs.existsSync(feedbackLogPath) ? fs.readFileSync(feedbackLogPath, 'utf8') : null],
    [memoryLogPath, fs.existsSync(memoryLogPath) ? fs.readFileSync(memoryLogPath, 'utf8') : null],
    [rulesPath, fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null],
    [autoGatesPath, fs.existsSync(autoGatesPath) ? fs.readFileSync(autoGatesPath, 'utf8') : null],
  ];

  try {
    fs.writeFileSync(feedbackLogPath, `${JSON.stringify({
      id: 'fb_mcp_lesson',
      signal: 'negative',
      context: 'Skipped release verification proof',
      tags: ['release', 'verification'],
      timestamp: '2026-03-23T16:00:00.000Z',
    })}\n`);
    fs.writeFileSync(memoryLogPath, `${JSON.stringify({
      id: 'mem_mcp_lesson',
      title: 'MISTAKE: Skipped release verification proof',
      content: 'What went wrong: Skipped release verification proof\nHow to avoid: Run the release checklist before publishing',
      category: 'error',
      importance: 'high',
      tags: ['feedback', 'negative', 'release', 'verification'],
      sourceFeedbackId: 'fb_mcp_lesson',
      timestamp: '2026-03-23T16:00:01.000Z',
    })}\n`);
    fs.writeFileSync(rulesPath, '# Release checklist\nAlways run the release checklist before publishing.\n');
    fs.writeFileSync(autoGatesPath, JSON.stringify({
      version: 1,
      gates: [{
        id: 'auto-release-checklist',
        action: 'block',
        pattern: 'release+verification',
        message: 'Block publish flows without the release checklist',
        occurrences: 6,
        promotedAt: '2026-03-23T16:10:00.000Z',
      }],
      promotionLog: [],
    }, null, 2));

    const result = await handleRequest({
      jsonrpc: '2.0',
      id: 311,
      method: 'tools/call',
      params: {
        name: 'search_lessons',
        arguments: {
          query: 'release checklist',
          limit: 5,
        },
      },
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.returned, 1);
    assert.equal(payload.results[0].id, 'mem_mcp_lesson');
    assert.equal(payload.results[0].systemResponse.linkedAutoGates[0].id, 'auto-release-checklist');
    assert.ok(payload.results[0].systemResponse.correctiveActions.some((action) => action.type === 'pre_action_block'));
  } finally {
    backups.forEach(([filePath, content]) => {
      if (content === null) {
        fs.rmSync(filePath, { force: true });
      } else {
        fs.writeFileSync(filePath, content);
      }
    });
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

test('export_databricks_bundle writes manifest and sql template over MCP', async () => {
  fs.mkdirSync(path.join(tmpProofDir, 'automation'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpProofDir, 'automation', 'report.json'),
    JSON.stringify({ checks: [{ id: 'AUTO-01', passed: true }] }, null, 2)
  );

  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 29,
    method: 'tools/call',
    params: {
      name: 'export_databricks_bundle',
      arguments: {
        outputPath: path.join(SAFE_DATA_DIR, 'analytics', 'bundle-mcp'),
      },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(fs.existsSync(path.join(payload.bundlePath, 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(payload.bundlePath, 'load_databricks.sql')), true);
  assert.ok(payload.tables.some((table) => table.tableName === 'proof_reports'));
});

test('export_databricks_bundle defaults bundle path inside SAFE_DATA_DIR', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 30,
    method: 'tools/call',
    params: {
      name: 'export_databricks_bundle',
      arguments: {},
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.match(payload.bundlePath, new RegExp(`^${path.join(SAFE_DATA_DIR, 'analytics').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(fs.existsSync(path.join(payload.bundlePath, 'manifest.json')), true);
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
