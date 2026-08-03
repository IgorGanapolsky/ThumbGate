#!/usr/bin/env node
'use strict';

/**
 * Fail-closed A+ readiness scorecard.
 *
 * A passing unit test or a checked-in module is repository evidence, not live
 * production or commercial proof. This scorecard keeps those surfaces separate
 * and awards A+/10 only when every check in every area is verified.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCORECARD_VERSION = '2026-08-01.1';

function read(root, relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
  } catch {
    return '';
  }
}

function hasAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function safeEval(fn) {
  try {
    return fn() === true;
  } catch {
    return false;
  }
}

function collectRepositoryEvidence(root = ROOT) {
  const landing = read(root, 'public/index.html');
  const feedback = read(root, 'scripts/feedback-loop.js');
  const promotion = read(root, 'scripts/auto-promote-gates.js');
  const buyerPaths = read(root, 'scripts/buyer-paths.js');
  const hook = read(root, 'scripts/hook-pre-tool-use.js');
  const gatesEngine = read(root, 'scripts/gates-engine.js');
  const gateEvasionMatrix = read(root, 'tests/gate-evasion-matrix.test.js');
  const retrieval = read(root, 'scripts/lesson-retrieval.js');
  const crossEncoder = read(root, 'scripts/cross-encoder-reranker.js');
  const productionArchitecture = read(root, 'docs/RAG_PRODUCTION_ARCHITECTURE.md');
  const packageJson = read(root, 'package.json');

  let qualitySuitePassed = false;
  let rerankGoldenPassed = false;
  if (root === ROOT) {
    qualitySuitePassed = safeEval(() => require('./eval-quality-suite').runSuite().report.passed);
    rerankGoldenPassed = safeEval(() => require('./rerank-quality-eval').evaluate().pass);
  }

  return {
    landingVisualLoop: hasAll(landing, [
      'class="thumb-mark up"',
      'class="thumb-mark down"',
      'data-loop-step="1"',
      'data-loop-step="4"',
      'That is “self-improving”:',
    ]),
    landingBuyerRoutes: hasAll(landing, ['/checkout/pro', '/go/diagnostic-pay'])
      && hasAll(buyerPaths, ['/go/pro', '/go/sprint', '/diagnostic']),
    feedbackRewardReachable: feedback.includes('scoreFeedbackReward('),
    feedbackPromotionReachable: promotion.includes('promote') && hook.includes('retrieveWithRerankingSync'),
    preventionChangePromoted: feedback.includes('whatToChange')
      && feedback.includes('promotion'),
    architectureNamesHonest: hasAll(productionArchitecture, [
      'LLM-as-a-judge output is diagnostic',
      'A heuristic score is never',
      'does not get to override a hard gate',
    ]),
    deterministicMultiQuery: retrieval.includes('buildQueryVariants'),
    hydeExplicitAndBounded: hasAll(retrieval, ['hydeGenerator', 'hydeApplied', 'hydeProvider']),
    rerankProductionWired: crossEncoder.includes("require('./rerank-pipeline')")
      && crossEncoder.includes('rerankPipelineSync(query, candidates'),
    rerankProvenance: hasAll(crossEncoder, [
      'pairwiseHeuristicScore',
      'crossEncoderScore',
      'reranker',
    ]),
    rerankGoldenPassed,
    qualitySuitePassed,
    requestEnvelope: fs.existsSync(path.join(root, 'scripts/request-envelope.js')),
    hardBudgets: fs.existsSync(path.join(root, 'scripts/tier-budget-guard.js')),
    degradedRetrievalFlags: fs.existsSync(path.join(root, 'scripts/retrieval-quality-tier.js')),
    structuredOutputValidation: fs.existsSync(path.join(root, 'scripts/rag-structured-output.js')),
    tenantAclBeforeRetrieval: hasAll(productionArchitecture, [
      'Filtering must happen before',
      'Missing/mismatched tenant or principal',
    ]),
    commandPositionHardening: hasAll(gatesEngine, [
      'LITERAL_COMMAND_SUBSTITUTION_HEADS',
      'canonicalizeLiteralCommandSubstitutionHead',
    ]) && gateEvasionMatrix.includes('literal command substitution'),
    rawFrameworkDecisionDefended: hasAll(productionArchitecture, [
      '## Framework decision',
      'LangChain',
      'LangGraph',
      'LlamaIndex',
      '## One complete RAG request',
    ]),
    scorecardInMainTest: packageJson.includes('test:a-plus-evidence'),
  };
}

function check(id, label, passed, evidenceClass, remediation) {
  return {
    id,
    label,
    passed: passed === true,
    evidenceClass,
    remediation: passed === true ? null : remediation,
  };
}

function shaMatches(live = {}) {
  const candidate = String(live.candidateBuildSha || '').trim();
  const deployed = String(live.deployedBuildSha || '').trim();
  return candidate.length >= 7 && deployed.length >= 7 && candidate === deployed;
}

function readinessArea(id, label, checks) {
  return { id, label, checks };
}

function landingConversionArea(repo, production) {
  return readinessArea('landing_conversion', 'Landing page and conversion', [
    check('visual_loop', 'Thumb visuals and simple learning diagrams ship', repo.landingVisualLoop, 'repository', 'Ship the visual thumbs-to-gate loop.'),
    check('buyer_routes', 'First-party buyer routes are present', repo.landingBuyerRoutes, 'repository', 'Restore diagnostic, Pro, and sprint buyer routes.'),
    check('live_landing', 'Candidate landing page is verified live', production.landingVerified === true && shaMatches(production), 'production', 'Verify the exact candidate SHA on the live landing page.'),
  ]);
}

function selfImprovementArea(repo, production) {
  return readinessArea('self_improvement', 'Self-improving control loop', [
    check('reward_reachable', 'Feedback reward scoring is invoked by capture', repo.feedbackRewardReachable, 'repository', 'Wire reward scoring into the capture path.'),
    check('promotion_reachable', 'Reviewed failures reach promotion and pre-action retrieval', repo.feedbackPromotionReachable, 'repository', 'Connect feedback promotion to the pre-action hook.'),
    check('specific_change', 'Specific what-to-change guidance reaches prevention rules', repo.preventionChangePromoted, 'repository', 'Promote specific corrective instructions, not vague signals.'),
    check('live_feedback', 'Fresh production feedback closes the loop', production.feedbackLoopVerified === true, 'production', 'Capture one real reviewed outcome and prove its next-action effect.'),
  ]);
}

function architectureHonestyArea(repo, production) {
  return readinessArea('architecture_honesty', 'Judge, routing, and architecture honesty', [
    check('honest_names', 'Judge, heuristic, neural, and enforcement stages are distinct', repo.architectureNamesHonest, 'repository', 'Document stage placement and prevent misleading model-level MoE claims.'),
    check('route_trace', 'Live traces identify the provider and routed model', production.providerTraceVerified === true, 'production', 'Attach a secret-safe live route trace.'),
  ]);
}

function queryTransformationArea(repo, retrieval) {
  return readinessArea('query_transformation', 'Query transformation, multi-query, and HyDE', [
    check('multi_query', 'Bounded deterministic multi-query is implemented', repo.deterministicMultiQuery, 'repository', 'Implement bounded, inspectable query variants.'),
    check('hyde_contract', 'HyDE is explicit, bounded, and provenance-bearing', repo.hydeExplicitAndBounded, 'repository', 'Add an explicit caller-supplied HyDE contract and fallback.'),
    check('hyde_holdout', 'HyDE or multi-query improves a provider holdout', retrieval.queryTransformationHoldoutPassed === true, 'provider-holdout', 'Measure lift on a non-fixture provider holdout.'),
  ]);
}

function rerankingArea(repo, retrieval) {
  return readinessArea('reranking', 'Reranking cascade', [
    check('production_wiring', 'BM25F, local MaxSim, and pairwise fusion run in PreToolUse', repo.rerankProductionWired, 'repository', 'Wire the documented cascade into the production caller.'),
    check('provenance', 'Heuristic and neural scores cannot masquerade as each other', repo.rerankProvenance, 'repository', 'Emit per-stage provenance and explicit fallbacks.'),
    check('golden', 'Deterministic rerank golden floors pass', repo.rerankGoldenPassed, 'deterministic-eval', 'Fix rerank golden regressions.'),
    check('neural_holdout', 'True neural pair/late-interaction holdout passes', retrieval.neuralRerankHoldoutPassed === true, 'provider-holdout', 'Run a pretrained pair scorer or token embedder on an external holdout.'),
    check('llm_failures', 'LLM rerank failure modes pass live-provider tests', retrieval.llmRerankFailureModesPassed === true, 'provider-holdout', 'Test malformed, partial, injected, timed-out, and unavailable LLM reranks.'),
  ]);
}

function evaluationArea(repo, retrieval) {
  return readinessArea('evaluation', 'Retrieval and answer evaluation', [
    check('offline_suite', 'Recall, precision, MRR, nDCG, and answer proxy floors pass', repo.qualitySuitePassed, 'deterministic-eval', 'Fix the unified deterministic quality suite.'),
    check('external_cases', 'External labeled holdout has at least 100 cases', Number(retrieval.externalHoldoutCases) >= 100, 'provider-holdout', 'Label and freeze at least 100 non-fixture cases.'),
    check('judge_calibration', 'LLM judge is calibrated against human labels', retrieval.judgeCalibrationPassed === true, 'provider-holdout', 'Measure judge agreement and calibration against human-reviewed labels.'),
  ]);
}

function productionControlsArea(repo, production) {
  return readinessArea('production_controls', 'Latency, cost, and observability', [
    check('request_envelope', 'Request trace, token, cost, and retrieval envelope exists', repo.requestEnvelope, 'repository', 'Add a request envelope.'),
    check('hard_budgets', 'Per-request and daily tier budgets fail closed', repo.hardBudgets, 'repository', 'Add hard cost and tier budgets.'),
    check('degraded_flags', 'Stale or stub retrieval is labeled degraded', repo.degradedRetrievalFlags, 'repository', 'Expose retrieval quality tiers.'),
    check('live_slo', 'Production p95 and cost SLOs pass under load', production.loadTestPassed === true && Number(production.p95LatencyMs) > 0, 'production', 'Run a production-like load test and attach p95/cost evidence.'),
    check('cache_batch', 'Live cache and batching savings are measured', production.cacheAndBatchingMeasured === true, 'production', 'Measure cache hit rate and batching cost/latency lift.'),
  ]);
}

function failureSecurityArea(repo, security) {
  return readinessArea('failure_security', 'Failure modes, validation, ACL, and tenancy', [
    check('structured', 'Structured answers and citations are validated', repo.structuredOutputValidation, 'repository', 'Validate output shape and citation relationships.'),
    check('acl_order', 'Tenant/document ACL runs before retrieval and hydration', repo.tenantAclBeforeRetrieval, 'repository', 'Enforce authorization before ranking.'),
    check('command_evasion', 'Literal command-substitution evasions are canonicalized and tested', repo.commandPositionHardening, 'repository', 'Ratchet deterministic command-position substitutions in the evasion matrix.'),
    check('penetration_test', 'Tenant isolation has external penetration evidence', security.tenantPenTestPassed === true, 'security-review', 'Run a professional tenant-isolation penetration test.'),
    check('incident_drill', 'Hallucination, stale-index, miss, and leak drills pass', security.failureDrillPassed === true, 'production', 'Run and retain production-like failure drills.'),
  ]);
}

function frameworkPipelineArea(repo) {
  return readinessArea('framework_pipeline', 'Framework decision and end-to-end RAG defense', [
    check('decision', 'Raw versus LangChain/LangGraph/LlamaIndex tradeoffs are defended', repo.rawFrameworkDecisionDefended, 'repository', 'Document the complete pipeline and framework decision.'),
    check('ratchet', 'The evidence scorecard runs in the main test chain', repo.scorecardInMainTest, 'repository', 'Wire this scorecard into the test chain.'),
  ]);
}

function commercialValidationArea(commercial) {
  return readinessArea('commercial_validation', 'Value, willingness to pay, and captured money', [
    check('buyer_conversations', 'At least 10 target-buyer value conversations are evidenced', Number(commercial.buyerConversations) >= 10, 'commercial', 'Complete and retain 10 target-buyer value conversations.'),
    check('payment_asks', 'At least 3 exact-price payment asks are evidenced', Number(commercial.paymentAsks) >= 3, 'commercial', 'Make three exact-price payment asks to qualified buyers.'),
    check('external_payment', 'At least one non-owner external payment is reconciled', Number(commercial.externalPayments) >= 1, 'provider', 'Capture and reconcile one real external payment.'),
    check('provider_truth', 'Provider catalog and product attribution are verified', commercial.providerRevenueVerified === true, 'provider', 'Attach exact provider catalog and product-attributed revenue evidence.'),
  ]);
}

function gradeForScore(score) {
  if (score === 10) return 'A+';
  if (score >= 9) return 'A';
  if (score >= 8) return 'B';
  if (score >= 7) return 'C';
  if (score >= 6) return 'D';
  return 'F';
}

function statusForArea(score, passed) {
  if (score === 10) return 'verified';
  if (passed === 0) return 'blocked';
  return 'partial';
}

function buildReadinessAreas(repo, live) {
  const production = live.production || {};
  const retrieval = live.retrieval || {};
  const security = live.security || {};
  const commercial = live.commercial || {};
  return [
    landingConversionArea(repo, production),
    selfImprovementArea(repo, production),
    architectureHonestyArea(repo, production),
    queryTransformationArea(repo, retrieval),
    rerankingArea(repo, retrieval),
    evaluationArea(repo, retrieval),
    productionControlsArea(repo, production),
    failureSecurityArea(repo, security),
    frameworkPipelineArea(repo),
    commercialValidationArea(commercial),
  ];
}

function evaluateReadiness({ repo = {}, live = {} } = {}) {
  const areas = buildReadinessAreas(repo, live);

  for (const area of areas) {
    const passed = area.checks.filter((row) => row.passed).length;
    area.score = Number((10 * passed / area.checks.length).toFixed(1));
    area.grade = gradeForScore(area.score);
    area.status = statusForArea(area.score, passed);
  }

  const score = Number((areas.reduce((sum, area) => sum + area.score, 0) / areas.length).toFixed(1));
  const atTarget = areas.every((area) => area.score === 10);
  return {
    scorecardVersion: SCORECARD_VERSION,
    generatedAt: new Date().toISOString(),
    target: { score: 10, grade: 'A+' },
    atTarget,
    score,
    grade: gradeForScore(score),
    areas,
    blockers: areas.flatMap((area) => area.checks
      .filter((row) => !row.passed)
      .map((row) => ({ area: area.id, check: row.id, evidenceClass: row.evidenceClass, remediation: row.remediation }))),
  };
}

function formatMarkdown(report) {
  const lines = [
    '# ThumbGate A+ evidence scorecard',
    '',
    `Overall: **${report.score}/10 (${report.grade})**`,
    `Target verified: **${report.atTarget ? 'YES' : 'NO'}**`,
    '',
    '| Area | Score | Grade | Status |',
    '|---|---:|:---:|---|',
    ...report.areas.map((area) => `| ${area.label} | ${area.score}/10 | ${area.grade} | ${area.status} |`),
    '',
    '## Remaining evidence blockers',
    '',
    ...(report.blockers.length
      ? report.blockers.map((row) => `- **${row.area}/${row.check}** (${row.evidenceClass}): ${row.remediation}`)
      : ['- None. Every repository, production, provider, security, and commercial check is verified.']),
    '',
  ];
  return lines.join('\n');
}

function loadLiveEvidence(argv) {
  const index = argv.indexOf('--evidence');
  if (index === -1 || !argv[index + 1]) return {};
  return JSON.parse(fs.readFileSync(path.resolve(argv[index + 1]), 'utf8'));
}

function main() {
  const live = loadLiveEvidence(process.argv.slice(2));
  const repo = collectRepositoryEvidence();
  const report = evaluateReadiness({ repo, live });
  process.stdout.write(process.argv.includes('--json')
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${formatMarkdown(report)}\n`);
  if (process.argv.includes('--require-a-plus') && !report.atTarget) process.exitCode = 1;
}

function isCliEntrypoint(argv = process.argv) {
  return Boolean(argv[1]) && path.resolve(argv[1]) === path.resolve(__filename);
}

if (isCliEntrypoint()) main();

module.exports = {
  SCORECARD_VERSION,
  collectRepositoryEvidence,
  evaluateReadiness,
  formatMarkdown,
  isCliEntrypoint,
};
