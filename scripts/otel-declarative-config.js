#!/usr/bin/env node
'use strict';

function buildOtelDeclarativeConfig(input = {}) {
  const serviceName = input.serviceName || 'thumbgate-agent-harness';
  const environment = input.environment || 'production';
  return {
    file: 'otel.yaml',
    envVar: 'OTEL_CONFIG_FILE',
    config: {
      resource: {
        attributes: {
          'service.name': serviceName,
          'deployment.environment': environment,
        },
      },
      traces: {
        sampler: input.sampler || 'parentbased_traceidratio',
        ratio: Number.isFinite(Number(input.ratio)) ? Number(input.ratio) : 0.25,
        dropAttributes: ['authorization', 'cookie', 'x-api-key'],
      },
      metrics: {
        exportIntervalMs: Number.isFinite(Number(input.exportIntervalMs)) ? Number(input.exportIntervalMs) : 60000,
      },
      logs: {
        redactAttributes: ['prompt', 'toolInput', 'secret', 'token'],
      },
    },
    policy: {
      versionControlled: true,
      reviewedBeforeProduction: true,
      dynamicReloadAllowed: input.dynamicReloadAllowed === true,
    },
  };
}

function evaluateOtelConfig(config = {}) {
  const issues = [];
  const payload = config.config || config;
  if (!payload.resource?.attributes?.['service.name']) issues.push('missing_service_name');
  if (!payload.traces) issues.push('missing_trace_pipeline');
  if (!payload.metrics) issues.push('missing_metric_pipeline');
  if (!payload.logs) issues.push('missing_log_pipeline');
  if (!Array.isArray(payload.traces?.dropAttributes) || !payload.traces.dropAttributes.includes('authorization')) {
    issues.push('missing_sensitive_trace_attribute_drop');
  }
  return {
    decision: issues.length === 0 ? 'allow' : 'warn',
    issues,
  };
}

module.exports = {
  buildOtelDeclarativeConfig,
  evaluateOtelConfig,
};
