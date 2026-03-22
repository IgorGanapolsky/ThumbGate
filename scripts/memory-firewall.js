#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { scanText, buildSafeSummary, redactText } = require('./secret-scanner');

const SHIELDCORTEX_RUNNER_PATH = path.join(__dirname, 'shieldcortex-memory-firewall-runner.mjs');
const VALID_PROVIDERS = new Set(['auto', 'shieldcortex', 'local', 'off']);
const VALID_MODES = new Set(['strict', 'balanced', 'permissive']);

function resolveMemoryFirewallProvider(provider) {
  const configured = String(
    provider || process.env.RLHF_MEMORY_FIREWALL_PROVIDER || 'auto'
  ).trim().toLowerCase();
  return VALID_PROVIDERS.has(configured) ? configured : 'auto';
}

function resolveMemoryFirewallMode(mode) {
  const configured = String(
    mode || process.env.RLHF_MEMORY_FIREWALL_MODE || 'strict'
  ).trim().toLowerCase();
  return VALID_MODES.has(configured) ? configured : 'strict';
}

function canResolveShieldCortex() {
  try {
    require.resolve('shieldcortex/package.json');
    return true;
  } catch {
    return false;
  }
}

function buildIngressRecord(feedbackEvent = {}, memoryRecord = null) {
  const feedbackPayload = {
    signal: feedbackEvent.signal || null,
    context: feedbackEvent.context || '',
    whatWentWrong: feedbackEvent.whatWentWrong || null,
    whatToChange: feedbackEvent.whatToChange || null,
    whatWorked: feedbackEvent.whatWorked || null,
    reasoning: feedbackEvent.reasoning || null,
    visualEvidence: feedbackEvent.visualEvidence || null,
    tags: Array.isArray(feedbackEvent.tags) ? feedbackEvent.tags : [],
    skill: feedbackEvent.skill || null,
    actionType: feedbackEvent.actionType || null,
    actionReason: feedbackEvent.actionReason || null,
  };

  const memoryPayload = memoryRecord
    ? {
        category: memoryRecord.category || null,
        title: memoryRecord.title || null,
        pattern: memoryRecord.pattern || null,
        solution: memoryRecord.solution || null,
        tags: Array.isArray(memoryRecord.tags) ? memoryRecord.tags : [],
      }
    : null;

  const tags = new Set([
    ...(Array.isArray(feedbackPayload.tags) ? feedbackPayload.tags : []),
    ...(memoryPayload && Array.isArray(memoryPayload.tags) ? memoryPayload.tags : []),
  ]);

  return {
    title: memoryPayload && memoryPayload.title
      ? memoryPayload.title
      : `feedback_ingress:${feedbackPayload.signal || 'unknown'}`,
    content: JSON.stringify(
      {
        feedback: feedbackPayload,
        promotedMemory: memoryPayload,
      },
      null,
      2
    ),
    tags: [...tags],
    metadata: {
      project: 'mcp-memory-gateway',
      feedbackSignal: feedbackPayload.signal || null,
      memoryCategory: memoryPayload ? memoryPayload.category : null,
    },
  };
}

function buildLocalFirewallDecision(record, options = {}) {
  const scanResult = scanText(record.content, {
    provider: options.secretProvider,
    source: 'memory_ingress',
  });

  if (!scanResult.detected) {
    return {
      allowed: true,
      provider: 'local',
      mode: options.mode,
      reason: 'Local memory-ingress scan passed.',
      threatIndicators: [],
      findings: [],
      redactedPreview: redactText(record.content).slice(0, 400),
    };
  }

  return {
    allowed: false,
    provider: 'local',
    mode: options.mode,
    reason: buildSafeSummary(
      scanResult.findings,
      'Memory ingestion blocked because it appears to contain secret material'
    ),
    threatIndicators: ['credential_leak'],
    findings: scanResult.findings,
    redactedPreview: redactText(record.content).slice(0, 400),
  };
}

function runShieldCortexFirewall(record, options = {}) {
  const child = spawnSync(
    process.execPath,
    [SHIELDCORTEX_RUNNER_PATH],
    {
      input: JSON.stringify({
        record,
        options: {
          mode: options.mode,
          sourceType: options.sourceType || 'hook',
          sourceIdentifier: options.sourceIdentifier || 'feedback-loop',
        },
      }),
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    }
  );

  if (child.error) {
    return {
      available: false,
      error: child.error.message,
    };
  }

  const output = String(child.stdout || '').trim();
  if (!output) {
    return {
      available: false,
      error: child.stderr || `ShieldCortex runner exited with code ${child.status}`,
    };
  }

  try {
    return JSON.parse(output);
  } catch (error) {
    return {
      available: false,
      error: `Invalid ShieldCortex runner output: ${error.message}`,
    };
  }
}

function evaluateMemoryIngress({
  feedbackEvent,
  memoryRecord = null,
  provider,
  mode,
  sourceType = 'hook',
  sourceIdentifier = 'feedback-loop',
  secretProvider,
} = {}) {
  const resolvedProvider = resolveMemoryFirewallProvider(provider);
  const resolvedMode = resolveMemoryFirewallMode(mode);
  const record = buildIngressRecord(feedbackEvent, memoryRecord);

  if (resolvedProvider === 'off') {
    return {
      allowed: true,
      provider: 'off',
      mode: resolvedMode,
      reason: 'Memory-ingress firewall disabled.',
      threatIndicators: [],
      findings: [],
      redactedPreview: redactText(record.content).slice(0, 400),
    };
  }

  const wantsShieldCortex = resolvedProvider === 'shieldcortex' || resolvedProvider === 'auto';
  if (wantsShieldCortex && canResolveShieldCortex()) {
    const decision = runShieldCortexFirewall(record, {
      mode: resolvedMode,
      sourceType,
      sourceIdentifier,
    });
    if (decision && decision.available) {
      return decision;
    }
  }

  const localDecision = buildLocalFirewallDecision(record, {
    mode: resolvedMode,
    secretProvider,
  });

  if (resolvedProvider === 'shieldcortex') {
    return {
      ...localDecision,
      degraded: true,
      requestedProvider: 'shieldcortex',
      reason: `ShieldCortex unavailable; ${localDecision.reason}`,
    };
  }

  return localDecision;
}

module.exports = {
  buildIngressRecord,
  buildLocalFirewallDecision,
  evaluateMemoryIngress,
  resolveMemoryFirewallMode,
  resolveMemoryFirewallProvider,
};
