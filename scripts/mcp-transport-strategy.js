'use strict';

function scoreTransportNeed(service = {}) {
  let score = 0;
  if ((service.callsPerMinute || 0) >= 120) score += 30;
  if ((service.concurrentAgents || 0) >= 10) score += 20;
  if (service.streaming) score += 20;
  if (service.existingGrpc) score += 15;
  if (service.doubleStackedJsonShim) score += 15;
  if (service.inferenceDominated) score -= 25;
  return Math.max(0, Math.min(100, score));
}

function recommendMcpTransport(service = {}) {
  const score = scoreTransportNeed(service);
  const reasons = [];

  if ((service.callsPerMinute || 0) >= 120) reasons.push('high_frequency_tool_calls');
  if ((service.concurrentAgents || 0) >= 10) reasons.push('many_concurrent_agents');
  if (service.streaming) reasons.push('streaming_or_long_running_flow');
  if (service.existingGrpc) reasons.push('backend_already_grpc');
  if (service.doubleStackedJsonShim) reasons.push('json_shim_exists_only_for_agents');
  if (service.inferenceDominated) reasons.push('llm_latency_dominates_transport');

  const transport = score >= 50 ? 'grpc' : 'json_rpc_http';
  return {
    service: service.name || 'unnamed-service',
    score,
    transport,
    reasons,
    rollout: transport === 'grpc'
      ? [
        'pilot pluggable transport behind config',
        'reuse protobuf contracts where present',
        'add contract tests and stream retry policy',
        'compare latency throughput and error rate against JSON-RPC baseline',
        'deprecate redundant JSON shim only after soak evidence',
      ]
      : [
        'keep JSON-RPC over HTTP',
        'avoid transport churn until tool-call volume or streaming pressure changes',
        'continue validating payloads at MCP boundary',
      ],
  };
}

function buildMcpTransportMigrationPlan(services = []) {
  const recommendations = services.map(recommendMcpTransport);
  return {
    recommendations,
    pilots: recommendations.filter((item) => item.transport === 'grpc').slice(0, 1),
    guardrails: [
      'tool definitions remain transport agnostic',
      'wire protocol lives behind adapters',
      'semantic tool descriptions stay available to the LLM',
      'no JSON shim removal before contract tests and soak metrics pass',
    ],
    metrics: ['p95_tool_latency_ms', 'tool_error_rate', 'stream_reconnects', 'payload_validation_failures'],
  };
}

module.exports = {
  buildMcpTransportMigrationPlan,
  recommendMcpTransport,
  scoreTransportNeed,
};
