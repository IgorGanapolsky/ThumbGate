#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function runTests() {
  try {
    return execSync(
      'node --test tests/local-model-profile.test.js tests/model-tier-router.test.js tests/profile-router.test.js tests/risk-scorer.test.js tests/vector-store.test.js tests/feedback-sequences.test.js tests/feedback-history-distiller.test.js tests/feedback-loop.test.js',
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err) {
    return err.stdout || err.stderr || String(err);
  }
}

function parseTestOutput(output) {
  const passMatch = output.match(/ℹ pass (\d+)/);
  const failMatch = output.match(/ℹ fail (\d+)/);
  return {
    passed: passMatch ? Number(passMatch[1]) : 0,
    failed: failMatch ? Number(failMatch[1]) : 0,
  };
}

async function main() {
  const output = runTests();
  const testResults = parseTestOutput(output);
  const proofDir = DEFAULT_PROOF_DIR;
  ensureDir(proofDir);

  const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-local-intel-'));
  const report = {
    generatedAt: new Date().toISOString(),
    checks: [],
    summary: { passed: 0, failed: 0 },
    testResults,
  };

  function addResult(id, passed, evidence) {
    report.checks.push({ id, passed, evidence });
    if (passed) report.summary.passed += 1;
    else report.summary.failed += 1;
  }

  try {
    const {
      writeModelFitReport,
      detectInferenceBackend,
      recommendInferenceBackend,
    } = require('./local-model-profile');
    const { recommendExecutionPlan } = require('./model-tier-router');
    const { routeInference } = require('./profile-router');
    const { reportPath, report: modelFitReport } = writeModelFitReport(tmpFeedbackDir, {
      resolved: require('./local-model-profile').resolveEmbeddingProfile({
        THUMBGATE_RAM_BYTES_OVERRIDE: String(4 * 1024 ** 3),
        THUMBGATE_CPU_COUNT_OVERRIDE: '4',
      }),
    });
    addResult(
      'FIT-01',
      fs.existsSync(reportPath) && modelFitReport.selectedProfile.id === 'compact',
      `model-fit report written; selected profile=${modelFitReport.selectedProfile.id}; maxChars=${modelFitReport.selectedProfile.maxChars}`
    );

    process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
    process.env.THUMBGATE_MODEL_FIT_PROFILE = 'quality';
    process.env.THUMBGATE_VECTOR_FORCE_PRIMARY_FAILURE = 'true';
    delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
    delete require.cache[require.resolve('./vector-store')];
    const vectorStore = require('./vector-store');
    vectorStore.setLanceLoaderForTests(async () => {
      const tables = new Map();
      return {
        connect: async () => ({
          tableNames: async () => [...tables.keys()],
          openTable: async (name) => {
            const rows = tables.get(name) || [];
            return {
              add: async (records) => {
                rows.push(...records);
                tables.set(name, rows);
              },
              search: () => ({
                limit: (limit) => ({
                  toArray: async () => rows.slice(0, limit),
                }),
              }),
            };
          },
          createTable: async (name, records) => {
            tables.set(name, [...records]);
            return {
              add: async (more) => {
                const rows = tables.get(name) || [];
                rows.push(...more);
                tables.set(name, rows);
              },
            };
          },
        }),
      };
    });
    vectorStore.setPipelineLoaderForTests(async (_task, model, opts) => async () => ({
      data: Float32Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0)),
      model,
      opts,
    }));
    await vectorStore.upsertFeedback({
      id: 'proof-local-intel',
      signal: 'positive',
      context: 'vector fallback proof',
      tags: ['proof'],
      timestamp: new Date().toISOString(),
    });
    const fallbackProfile = vectorStore.getLastEmbeddingProfile();
    addResult(
      'FIT-02',
      Boolean(fallbackProfile && fallbackProfile.fallbackUsed),
      `vector-store active profile=${fallbackProfile && fallbackProfile.activeProfile ? fallbackProfile.activeProfile.id : 'none'}; fallbackUsed=${fallbackProfile ? fallbackProfile.fallbackUsed : false}; reason=${fallbackProfile ? fallbackProfile.fallbackReason : 'n/a'}`
    );

    const sparseBackend = detectInferenceBackend({
      THUMBGATE_PROVIDER_MODE: 'local',
      THUMBGATE_LOCAL_MODEL_FAMILY: 'deepseek-r1',
      THUMBGATE_LOCAL_MODEL_SERVER: 'sglang',
      THUMBGATE_INDEXCACHE_ENABLED: 'true',
    });
    addResult(
      'IDX-01',
      sparseBackend.indexCacheEligible && sparseBackend.indexCacheEnabled,
      `backend=${sparseBackend.id}; server=${sparseBackend.serverEngine}; eligible=${sparseBackend.indexCacheEligible}; enabled=${sparseBackend.indexCacheEnabled}`
    );

    const recommendation = recommendInferenceBackend({
      type: 'large-context',
      contextTokens: 240000,
      tags: ['xmemory'],
    }, {
      THUMBGATE_PROVIDER_MODE: 'local',
      THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-4.5',
      THUMBGATE_LOCAL_MODEL_SERVER: 'vllm',
    });
    addResult(
      'IDX-02',
      recommendation.recommendationClass === 'indexcache_eligible',
      `class=${recommendation.recommendationClass}; backend=${recommendation.backend.id}; reason=${recommendation.reason}`
    );

    const executionPlan = recommendExecutionPlan({
      type: 'code-edit',
      contextTokens: 260000,
      tags: ['retrieval-heavy'],
    }, {
      THUMBGATE_PROVIDER_MODE: 'local',
      THUMBGATE_LOCAL_MODEL_FAMILY: 'deepseek-v3',
      THUMBGATE_LOCAL_MODEL_SERVER: 'sglang',
      THUMBGATE_INDEXCACHE_ENABLED: 'true',
    });
    addResult(
      'IDX-03',
      executionPlan.tier === 'frontier' && executionPlan.recommendationClass === 'indexcache_active',
      `tier=${executionPlan.tier}; backend=${executionPlan.backendId}; class=${executionPlan.recommendationClass}`
    );

    const routed = routeInference({
      toolName: 'verify_claim',
      toolInput: { claim: 'long-context repo audit' },
      taskType: 'large-context',
      contextTokens: 220000,
      tags: ['xmemory'],
      env: {
        THUMBGATE_PROVIDER_MODE: 'managed',
      },
    });
    addResult(
      'IDX-04',
      routed.route === 'local' && routed.privacy.route === 'local',
      `route=${routed.route}; privacy=${routed.privacy.route}; class=${routed.recommendationClass}`
    );

    delete require.cache[require.resolve('./feedback-loop')];
    const { captureFeedback, analyzeFeedback } = require('./feedback-loop');
    const { recordConversationEntry } = require('./feedback-history-distiller');
    captureFeedback({
      signal: 'up',
      context: 'ran tests and included logs',
      whatWorked: 'verification complete',
      tags: ['testing', 'verification'],
    });
    captureFeedback({
      signal: 'down',
      context: 'skipped tests and missing logs caused failure',
      whatWentWrong: 'verification skipped',
      whatToChange: 'always run tests',
      tags: ['debugging', 'verification'],
    });
    captureFeedback({
      signal: 'up',
      context: 'proof attached and verification complete',
      whatWorked: 'full evidence',
      tags: ['testing', 'verification'],
    });
    captureFeedback({
      signal: 'down',
      context: 'unsafe path and security risk caused rejection',
      whatWentWrong: 'unsafe path',
      whatToChange: 'validate paths',
      tags: ['security'],
    });
    const clarification = captureFeedback({
      signal: 'up',
      context: 'thumbs up',
      tags: ['verification'],
    });
    addResult(
      'VETO-01',
      clarification.status === 'clarification_required' && clarification.needsClarification === true,
      `vague feedback status=${clarification.status}; prompt=${clarification.prompt || 'n/a'}`
    );
    captureFeedback({
      signal: 'positive',
      context: 'claimed success without logs',
      whatWorked: 'Reviewer approved despite missing logs',
      tags: ['verification'],
      rubricScores: [
        { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
        { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing logs' },
      ],
      guardrails: {
        testsPassed: false,
        pathSafety: true,
        budgetCompliant: true,
      },
    });
    captureFeedback({
      signal: 'down',
      context: 'regression due to skipped verification',
      whatWentWrong: 'regression shipped',
      whatToChange: 'add regression tests',
      tags: ['debugging', 'verification'],
    });

    const riskModelPath = path.join(tmpFeedbackDir, 'risk-model.json');
    const analysis = analyzeFeedback();
    addResult(
      'RISK-01',
      fs.existsSync(riskModelPath),
      'risk-model artifact written'
    );
    addResult(
      'RISK-02',
      Boolean(analysis.boostedRisk && analysis.boostedRisk.exampleCount >= 6),
      `boostedRisk exampleCount=${analysis.boostedRisk ? analysis.boostedRisk.exampleCount : 0}; mode=${analysis.boostedRisk ? analysis.boostedRisk.mode : 'none'}; topDomain=${analysis.boostedRisk && analysis.boostedRisk.highRiskDomains[0] ? analysis.boostedRisk.highRiskDomains[0].key : 'none'}`
    );

    const distilled = captureFeedback({
      signal: 'down',
      context: 'thumbs down',
      chatHistory: [
        { author: 'user', text: 'Do not use Tailwind in this repo.' },
        { author: 'assistant', text: 'I used Tailwind classes in the hero rewrite.' },
      ],
      tags: ['ui'],
    });
    addResult(
      'DISTILL-01',
      distilled.accepted === true && /ignored a prior instruction/i.test(distilled.feedbackEvent.whatWentWrong || ''),
      `accepted=${distilled.accepted}; whatWentWrong=${distilled.feedbackEvent.whatWentWrong || 'n/a'}`
    );

    recordConversationEntry({
      author: 'assistant',
      text: 'Ran npm test and attached the output before closing the task.',
      source: 'proof',
    }, { feedbackDir: tmpFeedbackDir });
    const fallback = captureFeedback({
      signal: 'up',
      context: 'thumbs up',
      allowLocalConversationFallback: true,
      tags: ['verification'],
    });
    addResult(
      'DISTILL-02',
      fallback.accepted === true && /successful pattern/i.test(fallback.feedbackEvent.whatWorked || ''),
      `accepted=${fallback.accepted}; whatWorked=${fallback.feedbackEvent.whatWorked || 'n/a'}`
    );
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_MODEL_FIT_PROFILE;
    delete process.env.THUMBGATE_VECTOR_FORCE_PRIMARY_FAILURE;
    delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  }

  const passed = report.summary.failed === 0 && report.testResults.failed === 0;
  const jsonPath = path.join(proofDir, 'local-intelligence-report.json');
  const mdPath = path.join(proofDir, 'local-intelligence-report.md');

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    '# Local Intelligence Proof Report',
    '',
    `Status: ${passed ? 'PASSED' : 'FAILED'}`,
    `Generated: ${report.generatedAt}`,
    '',
    '## Test Results',
    '',
    `- Passed: ${report.testResults.passed}`,
    `- Failed: ${report.testResults.failed}`,
    '',
    '## Checks',
    '',
  ];

  report.checks.forEach((check) => {
    lines.push(`- ${check.id}: ${check.passed ? 'PASS' : 'FAIL'} — ${check.evidence}`);
  });

  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);

  process.stdout.write(`Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
  process.stdout.write(`JSON report: ${jsonPath}\n`);
  process.stdout.write(`Markdown report: ${mdPath}\n`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(`prove-local-intelligence failed: ${err.message}`);
  process.exit(1);
});
