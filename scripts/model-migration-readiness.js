'use strict';

function buildModelMigrationPlan(options = {}) {
  const targetModel = options.targetModel || 'gpt-5.5';
  const currentModel = options.currentModel || 'current-codex-default';

  return {
    targetModel,
    currentModel,
    migrationReason: options.migrationReason || 'better agentic coding, lower token use, and longer research loops',
    benchmarkSuites: [
      'npm run test:high-roi',
      'npm run prove:adapters',
      'npm run prove:automation',
      'npm run self-heal:check',
    ],
    evalDimensions: [
      'unsupported_completion_claim_rate',
      'tool_call_accuracy',
      'token_cost_per_verified_task',
      'regression_rate',
      'computer_use_error_rate',
      'research_loop_persistence',
    ],
    routingPolicy: {
      lowRisk: 'allow_after_smoke_pass',
      highRisk: 'allow_after_holdout_and_proof_pass',
      destructiveActions: 'human_review_plus_evidence_gate',
    },
  };
}

function evaluateModelMigrationResult(result = {}) {
  const issues = [];
  if (!result.targetModel) issues.push('missing_target_model');
  if (!result.baselineModel) issues.push('missing_baseline_model');
  if (!result.highRoiTestsPass) issues.push('high_roi_tests_must_pass');
  if (!result.adapterProofPass) issues.push('adapter_proof_must_pass');
  if (!result.automationProofPass) issues.push('automation_proof_must_pass');
  if (!result.selfHealPass) issues.push('self_heal_must_pass');
  if (!Number.isFinite(result.tokenDeltaPercent)) issues.push('missing_token_delta');
  if (Number(result.regressionCount || 0) > 0) issues.push('model_regressions_present');
  if (result.routeHighRisk && !result.holdoutEvalPass) issues.push('holdout_required_for_high_risk_routing');

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    canRouteHighRisk: issues.length === 0 && Boolean(result.routeHighRisk),
  };
}

module.exports = {
  buildModelMigrationPlan,
  evaluateModelMigrationResult,
};
