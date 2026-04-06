#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  captureFeedback,
  analyzeFeedback,
  buildPreventionRules,
  getFeedbackPaths,
  readJSONL,
  waitForBackgroundSideEffects,
} = require('./feedback-loop');
const { exportDpoFromMemories } = require('./export-dpo-pairs');
const { planIntent } = require('./intent-router');
const { startHandoff, completeHandoff } = require('./delegation-runtime');
const { startServer } = require('../src/api/server');
const { handleRequest } = require('../adapters/mcp/server-stdio');
const { collectHealthReport } = require('./self-healing-check');
const { runSelfHeal } = require('./self-heal');
const { CONTEXTFS_ROOT, NAMESPACES } = require('./contextfs');
const { traceForProofCheck, aggregateTraces } = require('./code-reasoning');
const { runVerificationLoop } = require('./verification-loop');
const { run: runGateCheck } = require('./gates-engine');
const { evaluatePromptGuard } = require('./prompt-guard');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = path.join(ROOT, 'proof', 'automation');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchWithRetry(url, options, { retries = 5, delayMs = 100 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt === retries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  throw lastError;
}

async function runAutomationProof(options = {}) {
  const proofDir = options.proofDir || process.env.THUMBGATE_AUTOMATION_PROOF_DIR || DEFAULT_PROOF_DIR;
  const writeArtifacts = options.writeArtifacts !== false;
  const proofPort = options.port ?? 0;

  if (writeArtifacts) ensureDir(proofDir);

  const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-automation-proof-'));
  const previousCodegraphStub = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
  process.env.THUMBGATE_API_KEY = 'automation-proof-key';
  process.env.THUMBGATE_MCP_PROFILE = 'default';
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
    source: 'stub',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent', 'adapters/mcp/server-stdio.js -> planIntent'],
    callees: ['rankActions', 'decomposeActions'],
    deadCode: ['legacyIntentPlanner'],
  });

  const report = {
    generatedAt: new Date().toISOString(),
    checks: [],
    summary: { passed: 0, failed: 0 },
  };

  function addResult(name, passed, details) {
    report.checks.push({ name, passed, details });
    if (passed) report.summary.passed += 1;
    else report.summary.failed += 1;
  }

  const { server, port } = await startServer({ port: proofPort });
  const baseUrl = `http://127.0.0.1:${port}`;
  let currentCheck = 'bootstrap';
  try {
    // 1) Positive with valid rubric -> accepted
    {
      const result = captureFeedback({
        signal: 'up',
        context: 'Implemented with tests and evidence',
        whatWorked: 'Used proof harness and verification logs',
        tags: ['verification', 'automation'],
        rubricScores: [
          { criterion: 'correctness', score: 4, evidence: 'all tests pass', judge: 'judge-a' },
          { criterion: 'verification_evidence', score: 4, evidence: 'proof attached', judge: 'judge-a' },
          { criterion: 'safety', score: 4, evidence: 'path checks enabled', judge: 'judge-a' },
        ],
        guardrails: {
          testsPassed: true,
          pathSafety: true,
          budgetCompliant: true,
        },
      });
      check(result.accepted === true, 'expected rubric-valid positive feedback to be accepted');
      check(Boolean(result.memoryRecord && result.memoryRecord.rubricSummary), 'accepted learning should include rubricSummary');
      addResult('feedback.capture.rubric_pass', true, {
        accepted: result.accepted,
        weightedScore: result.memoryRecord.rubricSummary.weightedScore,
      });
    }

    // 2) Positive with failed guardrail/disagreement -> blocked
    {
      const result = captureFeedback({
        signal: 'up',
        context: 'Claimed done without logs',
        whatWorked: 'Reviewer approved despite missing logs',
        tags: ['verification', 'automation'],
        rubricScores: [
          { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
          { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'logs missing' },
        ],
        guardrails: {
          testsPassed: false,
          pathSafety: true,
          budgetCompliant: true,
        },
      });
      check(result.accepted === false, 'expected rubric-gated positive feedback to be rejected');
      check(/Rubric gate prevented promotion/i.test(String(result.reason)), 'expected rubric gate reason');
      addResult('feedback.capture.rubric_block', true, { accepted: result.accepted, reason: result.reason });
    }

    // 3) Negative with rubric failures -> accepted mistake memory with rubric tags
    {
      const result = captureFeedback({
        signal: 'down',
        context: 'Skipped verification before completion claim',
        whatWentWrong: 'No test evidence',
        whatToChange: 'Always include test output',
        tags: ['verification', 'automation'],
        rubricScores: [
          { criterion: 'verification_evidence', score: 1, evidence: 'no logs', judge: 'judge-a' },
          { criterion: 'correctness', score: 2, evidence: 'regression detected', judge: 'judge-a' },
        ],
        guardrails: {
          testsPassed: false,
          pathSafety: true,
          budgetCompliant: true,
        },
      });
      check(result.accepted === true, 'expected negative feedback to be accepted as mistake memory');
      check(result.memoryRecord.tags.includes('rubric-verification_evidence'), 'expected rubric failure tags');
      addResult('feedback.capture.negative_with_rubric', true, {
        accepted: result.accepted,
        tags: result.memoryRecord.tags,
      });
    }

    // 4) analytics tracks rubric blocks/failures
    {
      const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
      const stats = analyzeFeedback(FEEDBACK_LOG_PATH);
      check(stats.rubric.samples >= 3, 'expected rubric samples to be tracked');
      check(stats.rubric.blockedPromotions >= 1, 'expected blocked rubric promotions to be tracked');
      check(stats.diagnostics.totalDiagnosed >= 2, 'expected diagnostic counts for failed/suspect feedback');
      addResult('analytics.rubric_tracking', true, stats.rubric);
    }

    // 5) failed verification emits structured diagnosis and critical step
    {
      currentCheck = 'verification.failure_diagnostics';
      const { MEMORY_LOG_PATH } = getFeedbackPaths();
      fs.appendFileSync(MEMORY_LOG_PATH, `${JSON.stringify({
        id: 'mem_verification_failure',
        category: 'error',
        title: 'MISTAKE: agent claimed done without running tests',
        content: 'How to avoid: Run npm test before claiming completion',
      })}\n`);
      const verification = runVerificationLoop({
        context: 'Agent claimed done without running tests or verification',
        tags: ['verification', 'testing'],
        maxRetries: 0,
        modelPath: path.join(tmpFeedbackDir, 'verification-model.json'),
      });
      check(verification.accepted === false, 'expected failed verification for unverified completion claim');
      check(Boolean(verification.finalVerification && verification.finalVerification.diagnosis), 'failed verification should include diagnosis');
      check(verification.finalVerification.diagnosis.rootCauseCategory === 'tool_output_misread', 'verification diagnosis should classify output misread');
      addResult('verification.failure_diagnostics', true, {
        rootCauseCategory: verification.finalVerification.diagnosis.rootCauseCategory,
        criticalFailureStep: verification.finalVerification.diagnosis.criticalFailureStep,
      });
    }

    // 6) prevention rules include rubric dimensions and root causes
    {
      const markdown = buildPreventionRules(1);
      check(markdown.includes('Rubric Failure Dimensions'), 'expected rubric section in prevention rules');
      check(markdown.includes('verification_evidence'), 'expected criterion in prevention rules');
      check(markdown.includes('Root Cause Categories'), 'expected diagnosis section in prevention rules');
      addResult('prevention_rules.rubric_dimensions', true, { hasRubricSection: true });
    }

    // 7) DPO export includes rubric delta metadata
    {
      const { MEMORY_LOG_PATH } = getFeedbackPaths();
      const memories = readJSONL(MEMORY_LOG_PATH);
      const result = exportDpoFromMemories(memories);
      check(result.pairs.length >= 1, 'expected at least one DPO pair');
      const first = result.pairs[0];
      check(Boolean(first.metadata && first.metadata.rubric), 'expected rubric metadata in DPO pair');
      addResult('dpo_export.rubric_metadata', true, first.metadata.rubric);
    }

    // 8) API rubric gate returns 422
    {
      currentCheck = 'api.rubric_gate';
      const res = await fetchWithRetry(`${baseUrl}/v1/feedback/capture`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer automation-proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signal: 'up',
          context: 'unsafe api approval attempt',
          whatWorked: 'claimed success',
          tags: ['verification', 'automation'],
          rubricScores: [
            { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
            { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing logs' },
          ],
          guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
        }),
      });
      check(res.status === 422, `expected 422 from API rubric gate, got ${res.status}`);
      const body = await res.json();
      check(body.accepted === false, 'API rubric-gated capture must be rejected');
      addResult('api.rubric_gate', true, { status: res.status });
    }

    // 9) MCP rubric gate returns accepted=false
    {
      currentCheck = 'mcp.rubric_gate';
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 91,
        method: 'tools/call',
        params: {
          name: 'capture_feedback',
          arguments: {
            signal: 'up',
            context: 'unsafe mcp approval attempt',
            whatWorked: 'claimed success',
            rubricScores: [
              { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
              { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing logs' },
            ],
            guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
          },
        },
      });
      const payload = JSON.parse(call.content[0].text);
      check(payload.accepted === false, 'MCP rubric-gated capture must be rejected');
      addResult('mcp.rubric_gate', true, { accepted: payload.accepted });
    }

    // 10) PreToolUse blocks reads of secret-bearing files
    {
      currentCheck = 'secret_guard.read_block';
      const secretPath = path.join(tmpFeedbackDir, '.env');
      const stripeKey = ['sk', '_live_', '1234567890abcdefghijklmnopqrstuvwxyz'].join('');
      fs.writeFileSync(secretPath, `STRIPE_SECRET_KEY=${stripeKey}\n`);
      const gateOutput = JSON.parse(runGateCheck({
        tool_name: 'Read',
        tool_input: { file_path: secretPath },
        cwd: tmpFeedbackDir,
      }));
      check(gateOutput.hookSpecificOutput.permissionDecision === 'deny', 'expected secret file read to be blocked');
      addResult('secret_guard.read_block', true, {
        decision: gateOutput.hookSpecificOutput.permissionDecision,
        reason: gateOutput.hookSpecificOutput.permissionDecisionReason,
      });
    }

    // 11) UserPromptSubmit blocks prompts with inline secrets
    {
      currentCheck = 'secret_guard.prompt_block';
      const gitHubPat = ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz1234'].join('');
      const result = evaluatePromptGuard(`Ship this token to support: ${gitHubPat}`);
      check(result && result.continue === false, 'expected prompt guard to block secret-bearing prompt');
      addResult('secret_guard.prompt_block', true, {
        continue: result.continue,
        stopReason: result.stopReason,
      });
    }

    // 12) MCP failure diagnostics compile schema and approval constraints
    {
      currentCheck = 'mcp.failure_diagnostics';
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 92,
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
      const payload = JSON.parse(call.content[0].text);
      check(payload.rootCauseCategory === 'intent_plan_misalignment', 'diagnose_failure should classify approval mismatch');
      check(payload.compiledConstraints.summary.toolSchemaCount >= 1, 'diagnose_failure should include MCP schema constraints');
      addResult('mcp.failure_diagnostics', true, {
        rootCauseCategory: payload.rootCauseCategory,
        toolSchemaCount: payload.compiledConstraints.summary.toolSchemaCount,
      });
    }

    // 13) intent checkpoints still enforced
    {
      currentCheck = 'intent.checkpoint_enforcement';
      const planBlocked = planIntent({
        intentId: 'publish_dpo_training_data',
        mcpProfile: 'default',
        approved: false,
      });
      check(planBlocked.status === 'checkpoint_required', 'expected checkpoint_required for high-risk intent');

      const planApproved = planIntent({
        intentId: 'publish_dpo_training_data',
        mcpProfile: 'default',
        approved: true,
      });
      check(planApproved.status === 'ready', 'expected ready when approved');
      addResult('intent.checkpoint_enforcement', true, {
        blocked: planBlocked.status,
        approved: planApproved.status,
      });
    }

    // 14) partner-aware planning returns execution strategy
    {
      currentCheck = 'intent.partner_strategy';
      const partnerPlan = planIntent({
        intentId: 'incident_postmortem',
        mcpProfile: 'default',
        partnerProfile: 'strict-reviewer',
      });
      check(partnerPlan.partnerProfile === 'strict_reviewer', 'expected normalized strict_reviewer partner profile');
      check(Boolean(partnerPlan.partnerStrategy), 'expected partner strategy metadata');
      check(partnerPlan.partnerStrategy.verificationMode === 'evidence_first', 'expected evidence_first verification mode');
      check(partnerPlan.tokenBudget.contextPack > 6000, 'expected boosted contextPack budget for strict reviewer');
      check(Array.isArray(partnerPlan.actionScores), 'expected action scores for partner-aware plan');
      addResult('intent.partner_strategy', true, {
        partnerProfile: partnerPlan.partnerProfile,
        verificationMode: partnerPlan.partnerStrategy.verificationMode,
        contextPack: partnerPlan.tokenBudget.contextPack,
      });
    }

    // 15) coding workflows include structural impact evidence and dead-code checks
    {
      currentCheck = 'intent.delegation_decision';
      const plan = planIntent({
        intentId: 'improve_response_quality',
        context: 'Improve the response with evidence and prevention rules',
        mcpProfile: 'default',
        delegationMode: 'auto',
      });
      check(plan.executionMode === 'sequential_delegate', 'expected delegation decision for eligible multi-phase task');
      check(plan.delegateProfile === 'pr_workflow', 'expected pr_workflow delegate profile');
      check(Boolean(plan.handoffContract), 'expected handoff contract on delegated plan');
      addResult('intent.delegation_decision', true, {
        executionMode: plan.executionMode,
        delegateProfile: plan.delegateProfile,
        delegationScore: plan.delegationScore,
      });
    }

    // 16) sequential handoff contract is explicit and blocks duplicate starts
    {
      currentCheck = 'handoff.contract_shape';
      const plan = planIntent({
        intentId: 'improve_response_quality',
        context: 'Improve the response with evidence and prevention rules',
        mcpProfile: 'default',
        delegationMode: 'auto',
      });
      const started = startHandoff({
        plan,
        context: plan.context,
        mcpProfile: plan.mcpProfile,
        partnerProfile: plan.partnerProfile,
      });
      check(Boolean(started.handoffContract), 'expected handoff contract');
      check(Array.isArray(started.handoffContract.scopeIn), 'handoff contract should include scopeIn');
      check(Array.isArray(started.handoffContract.requiredEvidence), 'handoff contract should include requiredEvidence');
      check(Array.isArray(started.handoffContract.requiredChecks), 'handoff contract should include requiredChecks');
      addResult('handoff.contract_shape', true, {
        handoffId: started.handoffId,
        requiredEvidence: started.handoffContract.requiredEvidence,
        requiredChecks: started.handoffContract.requiredChecks,
      });

      currentCheck = 'handoff.sequential_guard';
      let guardErr = null;
      try {
        startHandoff({
          plan,
          context: plan.context,
          mcpProfile: plan.mcpProfile,
          partnerProfile: plan.partnerProfile,
        });
      } catch (err) {
        guardErr = err;
      }
      check(Boolean(guardErr), 'expected duplicate handoff start to fail');
      check(/unresolved handoff/i.test(guardErr.message), 'expected unresolved handoff guard');
      addResult('handoff.sequential_guard', true, {
        statusCode: guardErr.statusCode,
        message: guardErr.message,
      });

      currentCheck = 'handoff.failure_diagnostics';
      const completed = completeHandoff({
        handoffId: started.handoffId,
        outcome: 'accepted',
        attempts: 1,
        violationCount: 1,
        summary: 'Returned without test evidence.',
        resultContext: 'Agent claimed done without running tests or verification',
      });
      check(completed.verificationAccepted === false, 'expected handoff verification to fail');
      check(Boolean(completed.diagnosis), 'expected handoff completion diagnosis');
      addResult('handoff.failure_diagnostics', true, {
        verificationAccepted: completed.verificationAccepted,
        rootCauseCategory: completed.diagnosis.rootCauseCategory,
      });
    }

    // 17) coding workflows include structural impact evidence and dead-code checks
    {
      currentCheck = 'intent.codegraph_impact';
      const plan = planIntent({
        intentId: 'incident_postmortem',
        context: 'Refactor `planIntent` in scripts/intent-router.js',
        mcpProfile: 'default',
        repoPath: ROOT,
      });
      check(plan.codegraphImpact.enabled === true, 'expected codegraph impact to be enabled');
      check(plan.codegraphImpact.evidence.deadCodeCount >= 1, 'expected dead-code candidates in codegraph evidence');
      check(
        plan.partnerStrategy.recommendedChecks.some((item) => /dead code/i.test(item)),
        'expected structural verification checks to be appended',
      );
      addResult('intent.codegraph_impact', true, {
        source: plan.codegraphImpact.source,
        impactScore: plan.codegraphImpact.evidence.impactScore,
        deadCodeCount: plan.codegraphImpact.evidence.deadCodeCount,
      });
    }

    // 18) context evaluate stores rubric evaluation
    {
      currentCheck = 'context.evaluate.construct';
      const construct = await fetchWithRetry(`${baseUrl}/v1/context/construct`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer automation-proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'verification automation', maxItems: 5, maxChars: 5000 }),
      });
      check(construct.status === 200, `context construct expected 200, got ${construct.status}`);
      const pack = await construct.json();

      currentCheck = 'context.evaluate.rubric';
      const evaluate = await fetchWithRetry(`${baseUrl}/v1/context/evaluate`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer automation-proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          packId: pack.packId,
          outcome: 'useful',
          signal: 'positive',
          rubricScores: [
            { criterion: 'correctness', score: 4, evidence: 'tests pass', judge: 'judge-a' },
            { criterion: 'verification_evidence', score: 4, evidence: 'logs attached', judge: 'judge-a' },
          ],
          guardrails: { testsPassed: true, pathSafety: true, budgetCompliant: true },
        }),
      });
      check(evaluate.status === 200, `context evaluate expected 200, got ${evaluate.status}`);
      const evalBody = await evaluate.json();
      check(Boolean(evalBody.rubricEvaluation), 'expected rubricEvaluation on context evaluate result');
      addResult('context.evaluate.rubric', true, { rubricId: evalBody.rubricEvaluation.rubricId });
    }

    // 19) semantic cache hit on equivalent query
    {
      currentCheck = 'context.semantic_cache.hit.first';
      fs.rmSync(path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'semantic-cache.jsonl'), { force: true });
      const first = await fetchWithRetry(`${baseUrl}/v1/context/construct`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer automation-proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'verification testing evidence', maxItems: 5, maxChars: 5000 }),
      });
      check(first.status === 200, `first context construct expected 200, got ${first.status}`);
      const firstPack = await first.json();

      currentCheck = 'context.semantic_cache.hit.second';
      const second = await fetchWithRetry(`${baseUrl}/v1/context/construct`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer automation-proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'testing verification evidence', maxItems: 5, maxChars: 5000 }),
      });
      check(second.status === 200, `second context construct expected 200, got ${second.status}`);
      const secondPack = await second.json();
      check(firstPack.cache && firstPack.cache.hit === false, 'first pack expected cache miss');
      check(secondPack.cache && secondPack.cache.hit === true, 'second pack expected cache hit');
      addResult('context.semantic_cache.hit', true, {
        firstHit: firstPack.cache.hit,
        secondHit: secondPack.cache.hit,
        similarity: secondPack.cache.similarity,
      });
    }

    // 20) self-healing helpers produce healthy reports in baseline state
    {
      const health = collectHealthReport({
        checks: [
          { name: 'noop', command: ['node', '-e', 'process.exit(0)'] },
        ],
      });
      check(health.overall_status === 'healthy', 'health report expected healthy for noop check');
      const unhealthy = collectHealthReport({
        checks: [
          { name: 'explode', command: ['node', '-e', 'process.exit(2)'] },
        ],
      });
      check(unhealthy.checks[0].diagnosis.rootCauseCategory === 'system_failure', 'unhealthy self-heal check should include system_failure diagnosis');

      const heal = runSelfHeal({ reason: 'automation-proof', cwd: ROOT });
      check(heal.healthy === true, 'self-heal expected healthy execution');
      check(Boolean(heal.reasoning), 'self-heal must include reasoning traces');
      check(heal.traces.length === heal.plan.length, 'self-heal traces count must match plan length');
      addResult('self_healing.helpers', true, {
        healthStatus: health.overall_status,
        changed: heal.changed,
        reasoning: heal.reasoning,
      });
    }

    // 21) code reasoning traces verify DPO pair quality
    {
      const { MEMORY_LOG_PATH } = getFeedbackPaths();
      const memories = readJSONL(MEMORY_LOG_PATH);
      const result = exportDpoFromMemories(memories);
      if (result.pairs.length >= 1) {
        const first = result.pairs[0];
        check(Boolean(first.metadata.reasoningTrace), 'DPO pair must include reasoningTrace metadata');
        check(typeof first.metadata.reasoningTrace.confidence === 'number', 'reasoningTrace must have confidence score');
        check(typeof first.metadata.reasoningTrace.traceId === 'string', 'reasoningTrace must have traceId');
        check(Boolean(result.reasoning), 'DPO export must include aggregate reasoning summary');
        addResult('code_reasoning.dpo_traces', true, {
          traceId: first.metadata.reasoningTrace.traceId,
          confidence: first.metadata.reasoningTrace.confidence,
          aggregateConfidence: result.reasoning.averageConfidence,
        });
      } else {
        addResult('code_reasoning.dpo_traces', true, { skipped: true, reason: 'no DPO pairs to trace' });
      }
    }

    // 22) code reasoning traces attached to proof checks
    {
      const proofTraces = report.checks.map((chk) => traceForProofCheck(chk));
      const aggregate = aggregateTraces(proofTraces);
      check(aggregate.totalTraces === report.checks.length, 'proof trace count must match check count');
      check(aggregate.refuted === 0, 'no proof check should have refuted steps');
      check(aggregate.averageConfidence > 0, 'proof traces must have positive confidence');
      report.reasoning = aggregate;
      report.proofTraces = proofTraces;
      addResult('code_reasoning.proof_gate', true, {
        totalTraces: aggregate.totalTraces,
        averageConfidence: aggregate.averageConfidence,
        allPassed: aggregate.allPassed,
      });
    }
  } catch (err) {
    addResult('fatal', false, {
      check: currentCheck,
      error: err.message,
      cause: err.cause && err.cause.message ? err.cause.message : null,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await waitForBackgroundSideEffects();
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (previousCodegraphStub === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previousCodegraphStub;
  }

  if (writeArtifacts) {
    fs.writeFileSync(path.join(proofDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const mdLines = [
      '# Automation Proof',
      '',
      `Generated: ${report.generatedAt}`,
      '',
      `Passed: ${report.summary.passed}`,
      `Failed: ${report.summary.failed}`,
      '',
      '## Checks',
      ...report.checks.map((checkItem) => `- ${checkItem.passed ? 'PASS' : 'FAIL'} ${checkItem.name}`),
      '',
    ];
    fs.writeFileSync(path.join(proofDir, 'report.md'), `${mdLines.join('\n')}\n`);
  }

  if (report.summary.failed > 0) process.exitCode = 1;
  return report;
}

module.exports = {
  runAutomationProof,
};

if (require.main === module) {
  runAutomationProof().then((report) => {
    console.log(JSON.stringify(report.summary, null, 2));
  });
}
