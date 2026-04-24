'use strict';

function estimateToolSchemaTokens(endpointCount, tokensPerEndpoint = 450) {
  return Math.max(0, Number(endpointCount || 0) * Number(tokensPerEndpoint || 0));
}

function buildCodeModeMcpPlan(options = {}) {
  const endpointCount = Number(options.endpointCount || 0);
  const traditionalTokens = estimateToolSchemaTokens(endpointCount, options.tokensPerEndpoint);
  const codeModeTokens = Number(options.codeModeTokens || 1000);

  return {
    pattern: 'code_mode_mcp',
    endpointCount,
    traditionalTokens,
    codeModeTokens,
    tokenReductionPercent: traditionalTokens > 0
      ? Number((((traditionalTokens - codeModeTokens) / traditionalTokens) * 100).toFixed(2))
      : 0,
    tools: [
      {
        name: 'search',
        purpose: 'Find the relevant API area, path, operation, or type without loading the whole schema into context.',
      },
      {
        name: 'execute',
        purpose: 'Run a bounded code snippet against typed API helpers inside a sandbox.',
      },
    ],
    sandbox: {
      filesystem: 'none',
      environmentVariables: 'not_exposed',
      outboundRequests: 'explicit_handlers_only',
      maxExecutionMs: Number(options.maxExecutionMs || 10000),
    },
    gates: [
      'search before execute',
      'execute only against typed helper SDK',
      'block raw credential access',
      'record code snippet and API calls in audit log',
      'require idempotency key for write operations',
    ],
  };
}

function evaluateCodeModeMcpPlan(plan = {}) {
  const issues = [];
  if (Number(plan.endpointCount || 0) < 100) issues.push('api_surface_too_small_for_code_mode');
  if (!Array.isArray(plan.tools) || plan.tools.length !== 2) issues.push('expected_search_and_execute_only');
  if (plan.sandbox?.filesystem !== 'none') issues.push('filesystem_must_be_disabled');
  if (plan.sandbox?.environmentVariables !== 'not_exposed') issues.push('env_vars_must_not_be_exposed');
  if (plan.sandbox?.outboundRequests !== 'explicit_handlers_only') issues.push('outbound_requests_need_handlers');
  if (!Array.isArray(plan.gates) || !plan.gates.includes('search before execute')) {
    issues.push('search_before_execute_required');
  }
  if (!Array.isArray(plan.gates) || !plan.gates.includes('require idempotency key for write operations')) {
    issues.push('write_idempotency_required');
  }

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    tokenReductionPercent: plan.tokenReductionPercent || 0,
  };
}

module.exports = {
  buildCodeModeMcpPlan,
  estimateToolSchemaTokens,
  evaluateCodeModeMcpPlan,
};
