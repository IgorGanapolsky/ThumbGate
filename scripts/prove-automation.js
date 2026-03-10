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
const { startServer } = require('../src/api/server');
const { handleRequest } = require('../adapters/mcp/server-stdio');
const { collectHealthReport } = require('./self-healing-check');
const { runSelfHeal } = require('./self-heal');
const { CONTEXTFS_ROOT, NAMESPACES } = require('./contextfs');
const { traceForProofCheck, aggregateTraces } = require('./code-reasoning');

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
  const proofDir = options.proofDir || process.env.RLHF_AUTOMATION_PROOF_DIR || DEFAULT_PROOF_DIR;
  const writeArtifacts = options.writeArtifacts !== false;
  const proofPort = options.port ?? 0;

  if (writeArtifacts) ensureDir(proofDir);

  const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-automation-proof-'));
  process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;
  process.env.RLHF_API_KEY = 'automation-proof-key';
  process.env.RLHF_MCP_PROFILE = 'default';

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
      addResult('analytics.rubric_tracking', true, stats.rubric);
    }

    // 5) prevention rules include rubric dimensions
    {
      const markdown = buildPreventionRules(1);
      check(markdown.includes('Rubric Failure Dimensions'), 'expected rubric section in prevention rules');
      check(markdown.includes('verification_evidence'), 'expected criterion in prevention rules');
      addResult('prevention_rules.rubric_dimensions', true, { hasRubricSection: true });
    }

    // 6) DPO export includes rubric delta metadata
    {
      const { MEMORY_LOG_PATH } = getFeedbackPaths();
      const memories = readJSONL(MEMORY_LOG_PATH);
      const result = exportDpoFromMemories(memories);
      check(result.pairs.length >= 1, 'expected at least one DPO pair');
      const first = result.pairs[0];
      check(Boolean(first.metadata && first.metadata.rubric), 'expected rubric metadata in DPO pair');
      addResult('dpo_export.rubric_metadata', true, first.metadata.rubric);
    }

    // 7) API rubric gate returns 422
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

    // 8) MCP rubric gate returns accepted=false
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

    // 9) intent checkpoints still enforced
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

    // 10) context evaluate stores rubric evaluation
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

    // 11) semantic cache hit on equivalent query
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

    // 12) self-healing helpers produce healthy reports in baseline state
    {
      const health = collectHealthReport({
        checks: [
          { name: 'noop', command: ['node', '-e', 'process.exit(0)'] },
        ],
      });
      check(health.overall_status === 'healthy', 'health report expected healthy for noop check');

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

    // 13) code reasoning traces verify DPO pair quality
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

    // 14) code reasoning traces attached to proof checks
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
