#!/usr/bin/env node
'use strict';

/**
 * Siren MCP Marketing Diode & Autonomous Campaign Governance.
 *
 * Source: Hexahedral Inc. / Siren
 *   - MCP Server: https://github.com/Hexahedral-Inc/siren-mcp
 *   - MCP Documentation: https://mcp.mysiren.ai/skill.md
 *   - Platform: https://mysiren.ai
 *
 * Purpose:
 *   Autonomous marketing and social media agents running Siren MCP tools
 *   (`post_run`, `schedule_post`, `create_campaign`) have direct outbound write access
 *   to brand social channels (X/Twitter, LinkedIn, TikTok, Instagram, YouTube).
 *
 *   Unchecked, autonomous marketing agents introduce high-severity risks:
 *     1. Brand Safety: Hallucinated discounts, defamatory claims, or unapproved commitments.
 *     2. Compliance & Attribution: Violating attribution contracts ("Video made with Siren" -> https://mysiren.ai).
 *     3. Immediate Dispatch Accidents: Posting half-baked drafts directly to live production audiences.
 *     4. Runaway Spend: Generating unbudgeted ad campaigns or exceeding daily marketing limits.
 *     5. Scheduling Stampedes: Scheduling hundreds of posts in tiny windows triggering spam bans.
 *
 * Transfers (Process only):
 *   1. PreToolUse Marketing Diode:
 *      Interdicts calls to Siren tools before execution.
 *   2. Attribution Verification:
 *      Enforces mandatory backlink attribution ("Video made with Siren" / https://mysiren.ai)
 *      on generated video content.
 *   3. Scheduling Safety Buffer:
 *      `schedule_post` requires `scheduled_at` to be at least 5 minutes in the future to allow
 *      human review and emergency cancellation.
 *   4. Immediate Dispatch Review Diode:
 *      `post_run` requires verified human review approval or dry-run validation.
 *   5. Campaign Budget & Brand Safety Guardrails:
 *      Ceilings on campaign budgets ($500 ceiling without executive override) and
 *      regex filtering of deceptive or predatory claims.
 *
 * Maps onto existing ThumbGate rails:
 *   - PreToolUse gate: Evaluates Siren MCP calls before dispatch.
 *   - Gate template: gate-siren-mcp-marketing-diode.
 *   - Verification evidence: Cryptographic attestation of reviewed campaign payloads.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPORT_SOURCE_URL = 'https://github.com/Hexahedral-Inc/siren-mcp';

const SIREN_MCP_TOOLS = Object.freeze({
  post_run: {
    name: 'post_run',
    description: 'Immediately publishes a marketing post to live social channels',
    mutating: true,
    requiresApproval: true,
  },
  schedule_post: {
    name: 'schedule_post',
    description: 'Schedules a marketing post for future publication at scheduled_at',
    mutating: true,
    requiresApproval: false,
    minBufferSeconds: 300, // 5 minutes
  },
  create_campaign: {
    name: 'create_campaign',
    description: 'Creates a multi-channel autonomous marketing campaign',
    mutating: true,
    requiresApproval: true,
    maxDailyBudgetUsd: 500,
  },
});

const BRAND_SAFETY_PATTERNS = Object.freeze([
  {
    id: 'guaranteed_returns',
    regex: /(?:100%|guaranteed|risk-?free)\s+(?:profit|returns|gains|roi)/i,
    severity: 'critical',
    description: 'Deceptive investment or profit claims prohibited by FTC/SEC regulations.',
  },
  {
    id: 'unlimited_free_bait',
    regex: /unlimited\s+free\s+(?:credits|tokens|cash|money)/i,
    severity: 'high',
    description: 'Deceptive promotional claims offering unlimited free compute/tokens.',
  },
  {
    id: 'competitor_defamation',
    regex: /(?:scam|fraud|illegal|crooks)\s+like\s+[a-z0-9_-]+/i,
    severity: 'critical',
    description: 'Defamatory attacks against competitor platforms or individuals.',
  },
  {
    id: 'credential_leak_sample',
    regex: /(?:ghp_[a-z0-9]{30,}|sk-[a-z0-9]{32,}|siren_[a-z0-9]{24,})/i,
    severity: 'critical',
    description: 'Accidental inclusion of API keys or access tokens in public marketing copy.',
  },
]);

const FORMAT_MAPPING = Object.freeze([
  {
    sirenFeature: 'post_run tool call',
    thumbgateRail: 'PreToolUse Diode & Human-in-the-Loop review floor',
    action: 'Requires dry_run:true or humanReviewApproval token before live broadcast',
  },
  {
    sirenFeature: 'schedule_post tool call',
    thumbgateRail: 'Scheduling window buffer guard',
    action: 'Enforces >= 300s window buffer from current timestamp',
  },
  {
    sirenFeature: 'create_campaign tool call',
    thumbgateRail: 'Budget ceiling & multi-asset safety validation',
    action: 'Restricts campaign budget to <= $500 without executive override',
  },
  {
    sirenFeature: 'Video asset publication',
    thumbgateRail: 'Attribution diode',
    action: 'Verifies presence of "Video made with Siren" or https://mysiren.ai link',
  },
]);

/**
 * Checks whether content contains valid Siren attribution.
 */
function verifySirenAttribution(content) {
  if (!content || typeof content !== 'string') {
    return { hasAttribution: false, reason: 'missing_content' };
  }
  const hasTextAttribution = /video\s+made\s+with\s+siren/i.test(content);
  const hasUrlAttribution = /https?:\/\/(?:www\.)?mysiren\.ai/i.test(content);
  const hasAttribution = hasTextAttribution || hasUrlAttribution;

  return {
    hasAttribution,
    hasTextAttribution,
    hasUrlAttribution,
    reason: hasAttribution ? 'valid' : 'missing_siren_attribution',
  };
}

/**
 * Evaluates scheduling window for schedule_post tool call.
 */
function evaluateSchedulingWindow(scheduledAt, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const minBufferSeconds = options.minBufferSeconds || 300;

  if (!scheduledAt) {
    return {
      valid: false,
      reason: 'missing_scheduled_at',
      message: 'schedule_post requires a valid ISO-8601 scheduled_at timestamp.',
    };
  }

  const targetDate = new Date(scheduledAt);
  if (Number.isNaN(targetDate.getTime())) {
    return {
      valid: false,
      reason: 'invalid_timestamp_format',
      message: `Invalid timestamp format for scheduled_at: "${scheduledAt}".`,
    };
  }

  const deltaMs = targetDate.getTime() - now.getTime();
  const deltaSeconds = Math.floor(deltaMs / 1000);

  if (deltaSeconds < 0) {
    return {
      valid: false,
      reason: 'timestamp_in_past',
      deltaSeconds,
      message: `scheduled_at is in the past (${Math.abs(deltaSeconds)}s ago).`,
    };
  }

  if (deltaSeconds < minBufferSeconds) {
    return {
      valid: false,
      reason: 'buffer_too_small',
      deltaSeconds,
      minBufferSeconds,
      message: `scheduled_at buffer (${deltaSeconds}s) is smaller than required safety window (${minBufferSeconds}s).`,
    };
  }

  return {
    valid: true,
    deltaSeconds,
    reason: 'valid_window',
    message: `Scheduled ${deltaSeconds}s in the future (meets >= ${minBufferSeconds}s buffer requirement).`,
  };
}

/**
 * Scans marketing content for brand safety violations.
 */
function scanBrandSafety(text) {
  if (!text || typeof text !== 'string') {
    return { safe: true, violations: [] };
  }

  const violations = [];
  for (const pattern of BRAND_SAFETY_PATTERNS) {
    if (pattern.regex.test(text)) {
      violations.push({
        id: pattern.id,
        severity: pattern.severity,
        description: pattern.description,
      });
    }
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/**
 * Evaluates budget for campaign creation.
 */
function evaluateCampaignBudget(budgetUsd, options = {}) {
  const maxBudget = options.maxDailyBudgetUsd || SIREN_MCP_TOOLS.create_campaign.maxDailyBudgetUsd;
  const executiveOverride = Boolean(options.executiveOverride);

  if (budgetUsd === undefined || budgetUsd === null) {
    return {
      valid: true,
      budgetUsd: 0,
      reason: 'zero_or_unspecified_budget',
    };
  }

  const numBudget = Number(budgetUsd);
  if (Number.isNaN(numBudget) || numBudget < 0) {
    return {
      valid: false,
      reason: 'invalid_budget_value',
      message: `Campaign budget must be a positive number: "${budgetUsd}".`,
    };
  }

  if (numBudget > maxBudget && !executiveOverride) {
    return {
      valid: false,
      budgetUsd: numBudget,
      maxBudget,
      reason: 'budget_limit_exceeded',
      message: `Campaign budget ($${numBudget}) exceeds standard ceiling ($${maxBudget}) without executive override.`,
    };
  }

  return {
    valid: true,
    budgetUsd: numBudget,
    maxBudget,
    reason: 'within_budget',
  };
}

/**
 * Evaluates a proposed Siren MCP tool call against ThumbGate governance rules.
 *
 * @param {string} toolName - One of post_run, schedule_post, create_campaign
 * @param {object} args - Tool arguments payload
 * @param {object} [options] - Configuration & context options
 * @returns {object} Evaluation verdict: { allowed, action, reasons, details }
 */
function evaluateSirenToolCall(toolName, args = {}, options = {}) {
  const strict = Boolean(options.strict);
  const tool = SIREN_MCP_TOOLS[toolName];

  if (!tool) {
    return {
      allowed: false,
      action: 'block',
      reasons: [`unknown_siren_tool: "${toolName}" is not an allowlisted Siren MCP tool.`],
      details: {
        toolName,
        allowlistedTools: Object.keys(SIREN_MCP_TOOLS),
      },
    };
  }

  const reasons = [];
  let requiresReview = false;
  let blocked = false;

  // 1. Content Brand Safety Scan
  const textContent = [
    args.content,
    args.caption,
    args.description,
    args.text,
    args.title,
    args.campaign_name,
  ].filter(Boolean).join(' ');

  const safetyResult = scanBrandSafety(textContent);
  if (!safetyResult.safe) {
    blocked = true;
    for (const v of safetyResult.violations) {
      reasons.push(`brand_safety_violation (${v.id}): ${v.description}`);
    }
  }

  // 2. Attribution Diode Check
  // Enforced if video is present or if content explicitly describes generated video
  const hasVideoPayload = Boolean(
    args.video_url ||
    args.video ||
    args.media_url ||
    (args.media_type && args.media_type.includes('video')) ||
    /video|clip|reel|short|mp4/i.test(textContent)
  );

  const attributionResult = verifySirenAttribution(textContent);
  if (hasVideoPayload && !attributionResult.hasAttribution) {
    if (strict) {
      blocked = true;
      reasons.push('missing_siren_attribution: Video marketing content requires "Video made with Siren" or https://mysiren.ai link attribution.');
    } else {
      requiresReview = true;
      reasons.push('missing_siren_attribution: Video marketing content lacks "Video made with Siren" or https://mysiren.ai link attribution.');
    }
  }

  // 3. Tool-Specific Diodes
  if (toolName === 'post_run') {
    const isDryRun = Boolean(args.dry_run || options.dryRun);
    const hasHumanApproval = Boolean(args.reviewed || args.approval_id || options.humanApproval);

    if (!isDryRun && !hasHumanApproval) {
      if (strict) {
        blocked = true;
        reasons.push('unreviewed_immediate_dispatch: Immediate live social broadcast requires humanReview approval or dry_run:true.');
      } else {
        requiresReview = true;
        reasons.push('unreviewed_immediate_dispatch: Immediate live social broadcast requires human review confirmation before publication.');
      }
    }
  } else if (toolName === 'schedule_post') {
    const windowResult = evaluateSchedulingWindow(args.scheduled_at, {
      now: options.now,
      minBufferSeconds: options.minBufferSeconds || tool.minBufferSeconds,
    });
    if (!windowResult.valid) {
      blocked = true;
      reasons.push(`invalid_scheduling_window: ${windowResult.message}`);
    }
  } else if (toolName === 'create_campaign') {
    const budgetResult = evaluateCampaignBudget(args.budget || args.daily_budget, {
      maxDailyBudgetUsd: options.maxDailyBudgetUsd || tool.maxDailyBudgetUsd,
      executiveOverride: args.executive_override || options.executiveOverride,
    });
    if (!budgetResult.valid) {
      blocked = true;
      reasons.push(`budget_limit_exceeded: ${budgetResult.message}`);
    }
  }

  let action = 'allow';
  if (blocked) {
    action = 'block';
  } else if (requiresReview) {
    action = 'review';
  }

  return {
    allowed: action === 'allow',
    action,
    reasons,
    details: {
      toolName,
      safetyResult,
      attributionResult,
      isStrict: strict,
    },
  };
}

/**
 * Builds the comprehensive governance report for CLI/diagnostic invocation.
 */
function buildSirenGovernanceReport(options = {}) {
  const mapOnly = Boolean(options.mapOnly || options['map-only']);
  const strict = Boolean(options.strict);
  const toolName = options.tool || options['tool-name'];
  const rawArgs = options.args || options.payload;

  if (mapOnly) {
    return {
      status: 'pass',
      mode: 'map-only',
      sourceUrl: REPORT_SOURCE_URL,
      mapping: FORMAT_MAPPING,
      tools: SIREN_MCP_TOOLS,
      brandSafetyRulesCount: BRAND_SAFETY_PATTERNS.length,
    };
  }

  let evaluation = null;
  if (toolName) {
    let parsedArgs = {};
    if (typeof rawArgs === 'string') {
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch (err) {
        return {
          status: 'fail',
          error: `Failed to parse --args as JSON: ${err.message}`,
        };
      }
    } else if (typeof rawArgs === 'object' && rawArgs !== null) {
      parsedArgs = rawArgs;
    }

    evaluation = evaluateSirenToolCall(toolName, parsedArgs, { strict });
  }

  return {
    status: evaluation ? (evaluation.allowed ? 'pass' : 'fail') : 'pass',
    toolName: toolName || null,
    evaluation,
    sourceUrl: REPORT_SOURCE_URL,
    strict,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Formats the governance report into clean human-readable text.
 */
function formatSirenGovernanceReport(report) {
  const lines = [];
  lines.push('=== Siren MCP Autonomous Marketing Governance ===');
  lines.push(`Source: ${report.sourceUrl || REPORT_SOURCE_URL}`);
  lines.push(`Status: ${(report.status || 'pass').toUpperCase()}`);

  if (report.mode === 'map-only') {
    lines.push('\n--- FORMAT Transfers ---');
    for (const item of report.mapping) {
      lines.push(`  • ${item.sirenFeature} -> ${item.thumbgateRail}`);
      lines.push(`    Action: ${item.action}`);
    }
    lines.push('\n--- Allowlisted Siren MCP Tools ---');
    for (const [name, meta] of Object.entries(report.tools)) {
      lines.push(`  • ${name}: ${meta.description}`);
    }
    return lines.join('\n');
  }

  if (report.evaluation) {
    const ev = report.evaluation;
    lines.push(`Tool: ${ev.details.toolName}`);
    lines.push(`Action: ${ev.action.toUpperCase()}`);
    lines.push(`Allowed: ${ev.allowed ? 'YES' : 'NO'}`);
    if (ev.reasons.length > 0) {
      lines.push('Reasons:');
      for (const r of ev.reasons) {
        lines.push(`  - ${r}`);
      }
    } else {
      lines.push('Result: All marketing diodes and attribution rules passed.');
    }
  } else {
    lines.push('No tool call specified. Run with --tool <toolName> --args <json> to evaluate a tool call, or --map-only for architectural rails.');
  }

  return lines.join('\n');
}

function parseCliArgs(args) {
  const options = {
    json: args.includes('--json'),
    mapOnly: args.includes('--map-only'),
    strict: args.includes('--strict'),
    tool: null,
    args: null,
  };

  const toolIdx = args.indexOf('--tool');
  if (toolIdx !== -1 && args[toolIdx + 1]) {
    options.tool = args[toolIdx + 1];
  }

  const argsIdx = args.indexOf('--args');
  if (argsIdx !== -1 && args[argsIdx + 1]) {
    options.args = args[argsIdx + 1];
  }

  return options;
}

function main() {
  const args = process.argv.slice(2);
  const options = parseCliArgs(args);

  const report = buildSirenGovernanceReport(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatSirenGovernanceReport(report));
  }

  if (report.status === 'fail' || (report.evaluation && !report.evaluation.allowed)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  REPORT_SOURCE_URL,
  SIREN_MCP_TOOLS,
  BRAND_SAFETY_PATTERNS,
  FORMAT_MAPPING,
  verifySirenAttribution,
  evaluateSchedulingWindow,
  scanBrandSafety,
  evaluateCampaignBudget,
  evaluateSirenToolCall,
  buildSirenGovernanceReport,
  formatSirenGovernanceReport,
  parseCliArgs,
};
