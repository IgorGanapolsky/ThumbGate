#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const { bootstrapInternalAgent } = require('./internal-agent-bootstrap');

const DYNAMIC_WORKLOADS = new Set([
  'analytics_transform',
  'code_mode',
  'creator_analytics',
  'history_distillation',
  'lesson_synthesis',
  'workflow_triage',
]);

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_SANDBOX_ROUTE = '/sandbox/execute';

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const normalized = normalizeText(value).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStringArray(values = []) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean),
  ));
}

function normalizeTier(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ['free', 'pro', 'team', 'enterprise'].includes(normalized)
    ? normalized
    : 'pro';
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildExecutionId() {
  return `cfw_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function buildNetworkPolicy(request) {
  const allowedHosts = normalizeStringArray(request.allowedHosts);
  if (!request.requiresNetwork) {
    return {
      mode: 'deny_all',
      allowedHosts: [],
    };
  }
  return {
    mode: allowedHosts.length > 0 ? 'allow_list' : 'egress_enabled',
    allowedHosts,
  };
}

function buildBindings(request) {
  const bindings = ['MEMORY_KV'];
  if (
    request.workloadType === 'history_distillation' ||
    request.workloadType === 'lesson_synthesis' ||
    request.workloadType === 'workflow_triage'
  ) {
    bindings.push('GATES_KV');
  }
  return bindings;
}

function summarizeRequest(request) {
  return {
    workloadType: request.workloadType,
    tier: request.tier,
    tenantId: request.tenantId,
    requiresIsolation: request.requiresIsolation,
    requiresNetwork: request.requiresNetwork,
    requiresRepoAccess: request.requiresRepoAccess,
    contextTokens: request.contextTokens,
  };
}

function normalizeRequest(input = {}) {
  const workloadType = normalizeText(input.workloadType || input.taskType || input.kind)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'generic_automation';
  const providerPreference = normalizeText(input.providerPreference).toLowerCase() || 'auto';
  const repoPath = normalizeText(input.repoPath) || '';
  const requiresRepoAccess = normalizeBoolean(input.requiresRepoAccess)
    || normalizeBoolean(input.localFileAccess)
    || Boolean(repoPath);
  const untrustedCode = normalizeBoolean(input.untrustedCode);
  const tier = normalizeTier(input.tier);
  const tenantId = normalizeText(input.tenantId || input.teamId || input.customerId) || null;
  const requiresIsolation = normalizeBoolean(input.requiresIsolation)
    || untrustedCode
    || tier === 'team'
    || tier === 'enterprise'
    || Boolean(tenantId);
  const contextTokens = normalizeNumber(input.contextTokens, 0);

  return {
    source: normalizeText(input.source) || 'api',
    workloadType,
    providerPreference,
    tier,
    tenantId,
    repoPath,
    requiresRepoAccess,
    requiresIsolation,
    requiresNetwork: normalizeBoolean(input.requiresNetwork),
    untrustedCode,
    contextTokens,
    allowedHosts: normalizeStringArray(input.allowedHosts || input.egressAllowlist),
    traceId: normalizeText(input.traceId) || null,
    context: normalizeText(input.context) || '',
    intentId: normalizeText(input.intentId) || '',
    mcpProfile: normalizeText(input.mcpProfile) || undefined,
    partnerProfile: normalizeText(input.partnerProfile) || undefined,
    delegationMode: normalizeText(input.delegationMode) || 'auto',
    approved: input.approved === true,
    trigger: input.trigger || undefined,
    thread: input.thread || undefined,
    task: input.task || undefined,
    comments: Array.isArray(input.comments) ? input.comments : undefined,
    messages: Array.isArray(input.messages) ? input.messages : undefined,
  };
}

function classifyHostedExecution(input = {}) {
  const request = normalizeRequest(input);

  if (request.providerPreference === 'railway') {
    return {
      provider: 'railway_control_plane',
      reason: 'provider preference pinned to Railway control plane',
      request,
    };
  }

  if (request.requiresRepoAccess) {
    return {
      provider: 'railway_control_plane',
      reason: 'task requires repo or local filesystem access',
      request,
    };
  }

  if (
    request.providerPreference === 'cloudflare'
    || request.requiresIsolation
    || DYNAMIC_WORKLOADS.has(request.workloadType)
    || request.contextTokens >= 120000
  ) {
    return {
      provider: 'cloudflare_dynamic_worker',
      reason: request.providerPreference === 'cloudflare'
        ? 'provider preference explicitly requested Cloudflare dynamic workers'
        : 'hosted isolated workload benefits from edge sandbox execution',
      request,
    };
  }

  return {
    provider: 'railway_control_plane',
    reason: 'standard hosted workload remains on the Railway control plane',
    request,
  };
}

function signDispatchEnvelope(bodyText, secret, timestamp) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(`${timestamp}.${bodyText}`)
    .digest('hex');
}

function verifyDispatchEnvelope({
  body,
  secret,
  timestamp,
  signature,
  now = Date.now(),
  maxSkewMs = DEFAULT_MAX_SKEW_MS,
}) {
  if (!secret || !timestamp || !signature) return false;
  const issuedAt = Date.parse(timestamp);
  if (!Number.isFinite(issuedAt)) return false;
  if (Math.abs(Number(now) - issuedAt) > maxSkewMs) return false;
  const bodyText = typeof body === 'string' ? body : stableStringify(body);
  const expected = signDispatchEnvelope(bodyText, secret, timestamp);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(String(signature), 'hex');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function buildCloudflareSandboxPlan(input = {}, options = {}) {
  const classification = classifyHostedExecution(input);
  const request = classification.request;

  if (classification.provider !== 'cloudflare_dynamic_worker') {
    return {
      provider: 'railway_control_plane',
      shouldDispatch: false,
      reason: classification.reason,
      route: null,
      request: summarizeRequest(request),
    };
  }

  const timestamp = options.now instanceof Date
    ? options.now.toISOString()
    : (normalizeText(options.now) || new Date().toISOString());
  const executionId = normalizeText(options.executionId) || buildExecutionId();
  const secret = options.sharedSecret
    || process.env.CLOUDFLARE_SANDBOX_SHARED_SECRET
    || process.env.THUMBGATE_CLOUDFLARE_SANDBOX_SECRET
    || '';
  const networkPolicy = buildNetworkPolicy(request);
  const bindings = buildBindings(request);
  const bootstrap = options.includeBootstrap === false
    ? null
    : bootstrapInternalAgent({
      source: request.source,
      prepareSandbox: false,
      intentId: request.intentId,
      context: request.context,
      mcpProfile: request.mcpProfile,
      partnerProfile: request.partnerProfile,
      delegationMode: request.delegationMode,
      approved: request.approved,
      trigger: request.trigger,
      thread: request.thread,
      task: request.task,
      comments: request.comments,
      messages: request.messages,
    });

  const envelope = {
    executionId,
    provider: 'cloudflare_dynamic_worker',
    workloadType: request.workloadType,
    tier: request.tier,
    tenantId: request.tenantId,
    traceId: request.traceId || executionId,
    requestedAt: timestamp,
    networkPolicy,
    bindings,
    limits: {
      maxRuntimeMs: request.requiresNetwork ? 60000 : 30000,
      maxContextTokens: request.contextTokens || null,
    },
    bootstrap: bootstrap ? {
      invocation: bootstrap.invocation,
      startupContext: bootstrap.startupContext,
      reviewerLane: bootstrap.reviewerLane,
      middlewarePlan: bootstrap.middlewarePlan,
      intentPlan: bootstrap.intentPlan,
    } : null,
  };

  const bodyText = stableStringify(envelope);
  const signature = secret ? signDispatchEnvelope(bodyText, secret, timestamp) : '';

  return {
    provider: 'cloudflare_dynamic_worker',
    shouldDispatch: true,
    reason: classification.reason,
    route: normalizeText(options.route) || DEFAULT_SANDBOX_ROUTE,
    request: summarizeRequest(request),
    executionId,
    envelope,
    headers: {
      'x-thumbgate-sandbox-timestamp': timestamp,
      'x-thumbgate-sandbox-signature': signature,
    },
    signatureReady: Boolean(signature),
  };
}

module.exports = {
  DEFAULT_MAX_SKEW_MS,
  DEFAULT_SANDBOX_ROUTE,
  DYNAMIC_WORKLOADS,
  stableStringify,
  normalizeRequest,
  classifyHostedExecution,
  buildCloudflareSandboxPlan,
  signDispatchEnvelope,
  verifyDispatchEnvelope,
};
