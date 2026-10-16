#!/usr/bin/env node
'use strict';

/**
 * scripts/openrouter-armor-partnership-diode.js
 *
 * Bidirectional Integration & Co-Sell Bridge between OpenRouter Armor
 * (`https://openrouter.ai/docs/guides/features/plugins/armor`) and ThumbGate (`PreToolUse`).
 *
 * Solves the 3 architectural gaps documented in OpenRouter Armor's official spec:
 *   1. HIPAA / Zero Data Retention (ZDR) / Data-Region & `unavailable` Fallback (<0.2ms Local CPU):
 *      OpenRouter docs state: "Armor evaluation is not yet supported for requests under HIPAA,
 *      Zero Data Retention or a data-region restriction... A Claude Code request is not rejected:
 *      the call is released with an `unavailable` verdict and Claude Code falls back to its own
 *      local auto-mode evaluation." ThumbGate executes deterministically in <0.2ms on the local
 *      client machine whenever Armor returns `unavailable` or when HIPAA/ZDR is active.
 *   2. Feedback-to-`classifier_context` Compiler (`compileThumbGateToArmorPlugin`):
 *      Compiles ThumbGate prevention rules + live repo/branch/scope facts into OpenRouter Armor's
 *      exact `v: 1` `classifier_context` schema (`environment`, `hard_deny` @ 0.6, `soft_deny` @ 0.6,
 *      `allow` @ 0.7).
 *   3. `claude_code_compatibility` Client-Side Enforcer (`enforceArmorSafeguardResults`):
 *      Under Messages API `claude_code_compatibility`, OpenRouter keeps the flagged `tool_use` in
 *      `content[]` and relies on the client application to block execution. ThumbGate enforces
 *      that block at the local `PreToolUse` boundary.
 */

const DEFAULT_ARMOR_THRESHOLDS = {
  deny: 0.6,
  allow: 0.7,
};

/**
 * Compile ThumbGate repo/branch/scope state and prevention rules into OpenRouter Armor's
 * `plugins: [{ id: "armor", ... }]` configuration object.
 */
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
 * Evaluate a tool call by combining OpenRouter Armor's `safeguard_results` with ThumbGate's
 * <0.2ms local deterministic `PreToolUse` fallback (for HIPAA, ZDR, data-region, timeouts,
 * and `claude_code_compatibility` client-side enforcement).
 */
function evaluateArmorWithThumbGateFallback({
  callId = 'call_1',
  toolName = 'bash',
  toolArguments = {},
  safeguardResults = [],
  complianceContext = { hipaa: false, zeroDataRetention: false, dataRegionRestricted: false },
  userExplicitlyConsented = false,
} = {}) {
  const startNs = process.hrtime.bigint();
  const argStr = typeof toolArguments === 'string' ? toolArguments : JSON.stringify(toolArguments || {});
  const blob = `${toolName} ${argStr}`;

  // Extract Armor verdict for `callId` if present
  let armorOutcome = null;
  let armorExplanation = null;
  for (const sr of Array.isArray(safeguardResults) ? safeguardResults : []) {
    const tu = sr?.status?.tool_uses?.[callId];
    if (tu) {
      armorOutcome = tu.outcome || tu.type;
      armorExplanation = tu.explanation || tu.reason || null;
      break;
    }
  }

  // 1. If OpenRouter Armor already flagged the call (including under claude_code_compatibility), enforce the block locally
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
        reason: `Tool call "${toolName}" was blocked by OpenRouter Armor (${armorExplanation || 'rule match'}) and enforced locally by ThumbGate PreToolUse.`,
        explanation: armorExplanation || '[Armor Rule]',
      },
    };
  }

  // 2. Local deterministic tier evaluation (always runs in <0.2ms; acts as primary gate under HIPAA/ZDR/unavailable)
  const isFallbackRequired =
    armorOutcome === 'unavailable' ||
    armorOutcome === 'skipped' ||
    armorOutcome === null ||
    Boolean(complianceContext.hipaa || complianceContext.zeroDataRetention || complianceContext.dataRegionRestricted);

  // Hard-deny matchers (nothing clears a hard_deny: neither allow rules nor user consent)
  if (
    /(?:\bgit\s+push\s+--force\b|\bgit\s+reset\s+--hard\b|@(?:ecisolutions|ecinexus|eci)\.com\b|\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})\b)/i.test(blob)
  ) {
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

  // Soft-deny matchers (cleared by allow rule e.g. test suite mkdtemp cleanup, or explicit user consent)
  const isTestSuiteCleanup = /\b(?:node\s+--test|npm\s+test|mkdtemp|tg-live-hotdata-)/i.test(blob);
  const isSoftDenyMatch = /(?:\brm\s+-rf\b|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\.env\b|\.aws\/credentials|\.mirror\/reflection_api_key)/i.test(blob);

  if (isSoftDenyMatch && !isTestSuiteCleanup && !userExplicitlyConsented) {
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
    toolArguments: { command: 'git push --force origin main' },
    safeguardResults: [{ status: { tool_uses: { call_hipaa_1: { type: 'unavailable', reason: 'zdr_hipaa_restricted' } } } }],
    complianceContext: { hipaa: true, zeroDataRetention: true },
  });
  console.log(JSON.stringify({ plugin, sample }, null, 2));
}

module.exports = {
  DEFAULT_ARMOR_THRESHOLDS,
  compileThumbGateToArmorPlugin,
  evaluateArmorWithThumbGateFallback,
};
