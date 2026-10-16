#!/usr/bin/env node
'use strict';

/**
 * scripts/openrouter-armor-partnership-diode.js
 *
 * Bidirectional Integration & Co-Sell Bridge between OpenRouter Armor
 * (`https://openrouter.ai/docs/guides/features/plugins/armor`) and ThumbGate (`PreToolUse`).
 */

const DEFAULT_ARMOR_THRESHOLDS = {
  deny: 0.6,
  allow: 0.7,
};

function compileThumbGateToArmorPlugin({
  trustedRepo = 'github.com/IgorGanapolsky/ThumbGate',
  currentBranch = 'main',
  isProtectedBranch = true,
  deployTarget = 'staging only',
  userRole = 'operator',
  outputMode = 'custom_item',
  mode = 'enforce',
  onError = 'block',
  useCcStyleDefaultRules = true,
  customHardDeny = [],
  customSoftDeny = [],
  customAllow = [],
} = {}) {
  const environment = [
    `Trusted repository: ${trustedRepo}`,
    { name: 'Current branch', value: `${currentBranch} (protected=${Boolean(isProtectedBranch)})` },
    { name: 'Deploy target', value: deployTarget },
    { name: 'Operator role', value: userRole },
  ];

  const hard_deny = [
    {
      id: 'exfil-secrets-and-env',
      name: 'Secret & Credential Exfiltration',
      instructions: 'Sending files, environment variables, .env contents, API keys, or credentials to any destination outside the trusted repository.',
      threshold: DEFAULT_ARMOR_THRESHOLDS.deny,
    },
    {
      id: 'corp-email-boundary',
      name: 'Corporate Email Boundary',
      instructions: 'Sending, drafting, replying to, or referencing @ecisolutions.com or @ecinexus.com addresses from personal or ThumbGate workflows.',
      threshold: DEFAULT_ARMOR_THRESHOLDS.deny,
    },
    {
      id: 'git-force-push-protected',
      name: 'Force Push Protected Branch',
      instructions: 'Rewriting git history that has been pushed or force-pushing to main or any protected branch.',
      threshold: DEFAULT_ARMOR_THRESHOLDS.deny,
    },
    ...customHardDeny,
  ];

  const soft_deny = [
    {
      id: 'destructive-fs-or-sql',
      name: 'Destructive Filesystem or SQL Mutation',
      instructions: 'Deleting directories, running rm -rf, or executing unbounded DROP/DELETE/TRUNCATE SQL statements.',
      threshold: DEFAULT_ARMOR_THRESHOLDS.deny,
    },
    {
      id: 'credential-file-reads',
      name: 'Credential File Reads',
      instructions: 'Reading credential files such as .env, ~/.aws/credentials, or ~/.mirror/reflection_api_key.',
      threshold: DEFAULT_ARMOR_THRESHOLDS.deny,
    },
    ...customSoftDeny,
  ];

  const allow = [
    {
      id: 'project-test-suite',
      name: 'Project Test Suite Cleanup',
      instructions: 'Running the project test suite (node --test, npm test), including its cleanup of temporary mkdtemp directories.',
      threshold: DEFAULT_ARMOR_THRESHOLDS.allow,
    },
    ...customAllow,
  ];

  return {
    id: 'armor',
    enabled: true,
    mode,
    on_error: onError,
    use_cc_style_default_rules: useCcStyleDefaultRules,
    output_mode: outputMode,
    classifier_context: {
      v: 1,
      auto_mode: {
        environment,
        hard_deny,
        soft_deny,
        allow,
      },
    },
  };
}

/**
 * Check if every `rm -rf` invocation in a command string strictly targets a temporary test directory
 * (`/tmp/mkdtemp*`, `/tmp/tg-*`, `/var/folders/*`) and no credential files or SQL drops are present.
 */
function isScopedTempCleanupOnly(blob) {
  if (/(?:\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\.env\b|\.aws\/credentials|\.mirror\/reflection_api_key)/i.test(blob)) {
    return false;
  }
  const rmMatches = Array.from(String(blob).matchAll(/\brm\s+-rf\s+([^\s;&|"']+)/gi));
  if (rmMatches.length === 0) return false;
  return rmMatches.every((m) => /^\/(?:private\/)?tmp\/(?:mkdtemp|tg-)[a-zA-Z0-9._-]+$/.test(m[1]));
}

/**
 * Evaluate a tool call by combining OpenRouter Armor's `safeguard_results` (or HTTP 403 rejection
 * under HIPAA/ZDR/data-region restrictions) with ThumbGate's <0.2ms local deterministic evaluation.
 */
function evaluateArmorWithThumbGateFallback({
  callId = 'call_1',
  toolName = 'bash',
  toolArguments = {},
  safeguardResults = [],
  armorHttpStatus = 200,
  complianceContext = { hipaa: false, zeroDataRetention: false, dataRegionRestricted: false },
  userExplicitlyConsented = false,
} = {}) {
  const startNs = process.hrtime.bigint();
  const argStr = typeof toolArguments === 'string' ? toolArguments : JSON.stringify(toolArguments || {});
  const blob = `${toolName} ${argStr}`;

  let armorOutcome = armorHttpStatus === 403 ? 'rejected_403_compliance_context' : null;
  let armorExplanation = null;
  for (const sr of Array.isArray(safeguardResults) ? safeguardResults : []) {
    const tu = sr?.status?.tool_uses?.[callId];
    if (tu) {
      armorOutcome = tu.outcome || tu.type;
      armorExplanation = tu.explanation || tu.reason || null;
      break;
    }
  }

  // 1. If OpenRouter Armor flagged the call, return a block decision for the caller/hook to enforce
  if (armorOutcome === 'flagged') {
    const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
    return {
      decision: 'block',
      allowed: false,
      enforcedBy: 'openrouter_armor_plus_thumbgate_client',
      armorOutcome,
      explanation: armorExplanation || '[Armor Rule]',
      latencyMs,
      customItem: {
        type: 'openrouter:armor_blocked',
        call_id: callId,
        name: toolName,
        arguments: argStr,
        reason: `Tool call "${toolName}" was blocked by OpenRouter Armor (${armorExplanation || 'rule match'}) and reported as a block verdict for client enforcement.`,
        explanation: armorExplanation || '[Armor Rule]',
      },
    };
  }

  const isFallbackRequired =
    armorHttpStatus === 403 ||
    armorOutcome === 'unavailable' ||
    armorOutcome === 'skipped' ||
    armorOutcome === null ||
    Boolean(complianceContext.hipaa || complianceContext.zeroDataRetention || complianceContext.dataRegionRestricted);

  // 2. Hard-deny matchers (catches --force, --force-with-lease, -f, and +refspec forms; never cleared)
  const hardDenyPattern =
    /(?:\bgit\s+push\b[^\n;&|]*(?:\s--force(?:-with-lease)?\b|\s-f\b|\s\+[a-zA-Z0-9_./-]+)|\bgit\s+reset\s+--hard\b|@(?:ecisolutions|ecinexus|eci)\.com\b|\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})\b)/i;

  if (hardDenyPattern.test(blob)) {
    const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
    return {
      decision: 'block',
      allowed: false,
      enforcedBy: isFallbackRequired ? 'thumbgate_local_zdr_hipaa_fallback' : 'thumbgate_local_hard_deny',
      tier: 'hard_deny',
      armorOutcome: armorOutcome || 'unavailable',
      latencyMs,
      explanation: '[ThumbGate Local Hard-Deny]',
    };
  }

  // 3. Soft-deny matchers (cleared only when every rm -rf target is a scoped /tmp/mkdtemp* path, or user consented)
  const isSoftDenyMatch = /(?:\brm\s+-rf\b|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\.env\b|\.aws\/credentials|\.mirror\/reflection_api_key)/i.test(blob);
  const clearedByScopedTempAllow = isScopedTempCleanupOnly(blob);

  if (isSoftDenyMatch && !clearedByScopedTempAllow && !userExplicitlyConsented) {
    const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
    return {
      decision: 'block',
      allowed: false,
      enforcedBy: isFallbackRequired ? 'thumbgate_local_zdr_hipaa_fallback' : 'thumbgate_local_soft_deny',
      tier: 'soft_deny',
      armorOutcome: armorOutcome || 'unavailable',
      latencyMs,
      explanation: '[ThumbGate Local Soft-Deny]',
    };
  }

  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
  return {
    decision: 'allow',
    allowed: true,
    enforcedBy: isFallbackRequired ? 'thumbgate_local_zdr_hipaa_fallback' : 'openrouter_armor_and_thumbgate',
    armorOutcome: armorOutcome || 'not_flagged',
    latencyMs,
  };
}

if (require.main === module) {
  const plugin = compileThumbGateToArmorPlugin();
  const sample = evaluateArmorWithThumbGateFallback({
    callId: 'call_hipaa_1',
    toolName: 'bash',
    toolArguments: { command: 'git push -f origin main' },
    armorHttpStatus: 403,
    complianceContext: { hipaa: true, zeroDataRetention: true },
  });
  console.log(JSON.stringify({ plugin, sample }, null, 2));
}

module.exports = {
  DEFAULT_ARMOR_THRESHOLDS,
  compileThumbGateToArmorPlugin,
  isScopedTempCleanupOnly,
  evaluateArmorWithThumbGateFallback,
};
