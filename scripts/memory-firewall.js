#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { scanText, buildSafeSummary, redactText } = require('./secret-scanner');

const SHIELDCORTEX_RUNNER_PATH = path.join(__dirname, 'shieldcortex-memory-firewall-runner.mjs');
const VALID_PROVIDERS = new Set(['auto', 'shieldcortex', 'local', 'off']);
const VALID_MODES = new Set(['strict', 'balanced', 'permissive']);
const UNTRUSTED_SOURCE_TYPES = new Set([
  'browser',
  'document',
  'email',
  'external',
  'file',
  'imap',
  'third-party',
  'tool-output',
  'web',
  'webhook',
]);
const MEMORY_WRITE_PATTERNS = [
  /\b(?:add|commit|persist|record|remember|save|store|write)\b.{0,60}\b(?:memory|memories|preference|profile|workspace)\b/i,
  /\b(?:update|change|replace|set)\b.{0,50}\b(?:memory|preference|policy|rule|profile)\b/i,
  /\b(?:from now on|going forward|in future sessions?)\b/i,
  /\b(?:always|never)\b.{0,50}\b(?:use|allow|approve|block|prefer|trust|verify)\b/i,
];
const STEALTH_PATTERNS = [
  /\b(?:do not|don't|never)\b.{0,40}\b(?:disclose|mention|notify|reveal|say|show|tell|warn)\b/i,
  /\b(?:hide|silently|stealthily|without (?:alerting|mentioning|notifying|telling|warning))\b/i,
  /\bno need to (?:mention|notify|tell|warn)\b/i,
];
const OVERRIDE_PATTERNS = [
  /\bignore (?:all |any )?(?:earlier|previous|prior|system) instructions?\b/i,
  /\b(?:developer|system) message\b/i,
  /\b(?:administrator|admin|security team) (?:approved|requires|says)\b/i,
];
const DELAYED_INFLUENCE_PATTERNS = [
  /\b(?:later|next time|subsequent|future)\b.{0,45}\b(?:action|behavior|decision|request|session|task)\b/i,
  /\b(?:when|whenever)\b.{0,80}\b(?:approve|buy|deploy|install|login|merge|pay|publish|release|send|transfer)\b/i,
];

function resolveMemoryFirewallProvider(provider) {
  const configured = String(
    provider || process.env.THUMBGATE_MEMORY_FIREWALL_PROVIDER || 'auto'
  ).trim().toLowerCase();
  return VALID_PROVIDERS.has(configured) ? configured : 'auto';
}

function resolveMemoryFirewallMode(mode) {
  const configured = String(
    mode || process.env.THUMBGATE_MEMORY_FIREWALL_MODE || 'strict'
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
  const memorySource = feedbackEvent.memorySource && typeof feedbackEvent.memorySource === 'object'
    ? feedbackEvent.memorySource
    : {};
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
      project: 'thumbgate',
      feedbackSignal: feedbackPayload.signal || null,
      memoryCategory: memoryPayload ? memoryPayload.category : null,
      sourceType: memorySource.type || feedbackEvent.sourceType || null,
      sourceIdentifier: memorySource.identifier || feedbackEvent.sourceIdentifier || null,
      sourceTrust: memorySource.trust || feedbackEvent.sourceTrust || null,
    },
  };
}

function normalizeSourceType(value) {
  return String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function assessStealthMemoryInjection(record, options = {}) {
  const text = String(record && record.content || '');
  const sourceType = normalizeSourceType(
    options.sourceType || (record && record.metadata && record.metadata.sourceType)
  );
  const sourceTrust = String(
    options.sourceTrust || (record && record.metadata && record.metadata.sourceTrust) || ''
  ).trim().toLowerCase();
  const untrusted = sourceTrust === 'untrusted' || UNTRUSTED_SOURCE_TYPES.has(sourceType);
  const indicators = [];

  if (MEMORY_WRITE_PATTERNS.some((pattern) => pattern.test(text))) indicators.push('memory_write_instruction');
  if (STEALTH_PATTERNS.some((pattern) => pattern.test(text))) indicators.push('conversational_stealth');
  if (OVERRIDE_PATTERNS.some((pattern) => pattern.test(text))) indicators.push('instruction_override');
  if (DELAYED_INFLUENCE_PATTERNS.some((pattern) => pattern.test(text))) indicators.push('delayed_influence');

  const highConfidence = indicators.includes('memory_write_instruction')
    && indicators.includes('conversational_stealth');
  const mode = resolveMemoryFirewallMode(options.mode);
  const blocked = untrusted && (
    (mode === 'strict' && indicators.includes('memory_write_instruction'))
    || (mode === 'balanced' && highConfidence)
  );

  return {
    blocked,
    highConfidence,
    untrusted,
    sourceType: sourceType || 'unknown',
    sourceTrust: sourceTrust || 'unknown',
    indicators,
  };
}

function buildMemoryInjectionTelemetry(assessment) {
  const indicators = Array.isArray(assessment && assessment.indicators)
    ? assessment.indicators
    : [];
  return {
    'gen_ai.security.memory_injection.detected': indicators.length > 0,
    'gen_ai.security.memory_injection.blocked': Boolean(assessment && assessment.blocked),
    'gen_ai.security.memory_injection.high_confidence': Boolean(assessment && assessment.highConfidence),
    'gen_ai.security.memory_injection.indicators': indicators,
    'gen_ai.security.memory_source.type': assessment && assessment.sourceType || 'unknown',
    'gen_ai.security.memory_source.trust': assessment && assessment.sourceTrust || 'unknown',
  };
}

function buildLocalFirewallDecision(record, options = {}) {
  const injectionAssessment = assessStealthMemoryInjection(record, options);
  const scanResult = scanText(record.content, {
    provider: options.secretProvider,
    source: 'memory_ingress',
  });

  if (injectionAssessment.blocked) {
    return {
      allowed: false,
      provider: 'local',
      mode: options.mode,
      reason: `Stealth memory injection blocked from untrusted ${injectionAssessment.sourceType} content.`,
      threatIndicators: ['stealth_memory_injection', ...injectionAssessment.indicators],
      findings: [],
      provenance: injectionAssessment,
      telemetry: buildMemoryInjectionTelemetry(injectionAssessment),
      redactedPreview: redactText(record.content).slice(0, 400),
    };
  }

  if (!scanResult.detected) {
    return {
      allowed: true,
      provider: 'local',
      mode: options.mode,
      reason: 'Local memory-ingress scan passed.',
      threatIndicators: injectionAssessment.untrusted ? injectionAssessment.indicators : [],
      findings: [],
      provenance: injectionAssessment,
      telemetry: buildMemoryInjectionTelemetry(injectionAssessment),
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
  sourceType,
  sourceIdentifier = 'feedback-loop',
  sourceTrust,
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
    sourceType,
    sourceTrust,
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
  assessStealthMemoryInjection,
  buildMemoryInjectionTelemetry,
  evaluateMemoryIngress,
  resolveMemoryFirewallMode,
  resolveMemoryFirewallProvider,
};
