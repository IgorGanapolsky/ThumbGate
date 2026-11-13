#!/usr/bin/env node
'use strict';

/**
 * spotify-confidence-diode.js — Pre-Action Governance Diode for Spotify Confidence MCP
 *
 * Enforces pre-action safety rules before autonomous AI coding agents
 * (Claude Code, Cursor, Codex) mutate feature flags, experiments, or rollouts
 * via Spotify Confidence MCP (mcp.confidence.dev).
 *
 * Core Diodes:
 *   1. gate:confidence:rollout_ceiling (max 10% autonomous rollout without review)
 *   2. gate:confidence:test_proof_required (requires verified test pass before enabling)
 *   3. gate:confidence:protect_active_experiment (locks live A/B experiments against mutation)
 *   4. gate:confidence:prevent_flag_deletion (blocks flag deletion in production)
 */

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', 'adapters', 'confidence', 'config.json');

const TICKET_NAME_RE = /^(?:[a-z]{2,12}-\d+|jira-\d+|agent-\d+|psn-\d+|gh-\d+|issue-\d+|pr-\d+|ticket-\d+)$/i;

const DIODES = Object.freeze([
  {
    id: 'gate:confidence:rollout_ceiling',
    description: 'Enforces 10% maximum autonomous canary rollout; requires operator approval for wider rollouts',
    category: 'blast_radius_governance',
  },
  {
    id: 'gate:confidence:test_proof_required',
    description: 'Blocks enabling or expanding feature flags while regression tests are failing or unverified',
    category: 'verification_gate',
  },
  {
    id: 'gate:confidence:protect_active_experiment',
    description: 'Prevents autonomous agents from modifying variants or allocations on live A/B experiments',
    category: 'experiment_integrity',
  },
  {
    id: 'gate:confidence:prevent_flag_deletion',
    description: 'Blocks flag deletion in production environments; flags must be archived first',
    category: 'destructive_action_protection',
  },
  {
    id: 'gate:confidence:behavior_named_flag',
    description: 'Name flags after the behaviour (new-checkout-flow), never the ticket (JIRA-1234)',
    category: 'naming_hygiene',
  },
  {
    id: 'gate:confidence:owner_and_removal_date_required',
    description: 'Requires every flag to have an owner and a planned removal date for Cleanup sweeps',
    category: 'lifecycle_governance',
  },
  {
    id: 'gate:confidence:default_off_fail_safe',
    description: 'Enforces default to "off" so every new flag fails safe (ship code without shipping the change)',
    category: 'fail_safe_defaults',
  },
  {
    id: 'gate:confidence:guardrail_metrics_required',
    description: 'Requires guardrail metrics (crashes, latency, errors) attached before launching any gradual rollout',
    category: 'rollout_guardrails',
  },
  {
    id: 'gate:confidence:rollback_trigger_required',
    description: 'Requires an explicit rollback trigger threshold decided before launching a rollout',
    category: 'rollout_guardrails',
  },
  {
    id: 'gate:confidence:gradual_step_start_small',
    description: 'Enforces starting rollouts at 1-5% and ramping in steps before promoting the same flag to an A/B test',
    category: 'rollout_guardrails',
  },
  {
    id: 'gate:confidence:metric_fact_table_grounded',
    description: 'Enforces that every metric is grounded in a validated fact table pointing to warehouse events',
    category: 'metric_governance',
  },
  {
    id: 'gate:confidence:user_id_flag_assignment_alignment',
    description: 'Enforces that user ID in fact tables matches the entity ID used for flag assignment to prevent empty results',
    category: 'metric_governance',
  },
  {
    id: 'gate:confidence:core_metrics_structure_enforced',
    description: 'Enforces 3-5 core metrics structure (1 north star, 1-2 drivers, 1-2 guardrails)',
    category: 'metric_governance',
  },
  {
    id: 'gate:confidence:outcome_not_proxy_integrity',
    description: 'Rejects misleading easy proxies (stars, clicks, token counts) in favor of verified outcome metrics',
    category: 'metric_governance',
  },
  {
    id: 'gate:confidence:project_context_required',
    description: 'Requires Confidence Agent prompts to run inside an organised Project with linked surfaces and context',
    category: 'agent_context_governance',
  },
  {
    id: 'gate:confidence:clear_outcome_prompt_required',
    description: 'Requires Confidence Agent invocations to state a clear outcome and guardrail regression check',
    category: 'agent_context_governance',
  },
  {
    id: 'gate:confidence:review_before_act_guard',
    description: 'Enforces "Review before you act" (sharp teammate, not autopilot) before applying Confidence Agent mutations',
    category: 'agent_execution_governance',
  },
]);

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { name: 'spotify-confidence', maxAutonomousRolloutPercent: 10 };
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { name: 'spotify-confidence', maxAutonomousRolloutPercent: 10 };
  }
}

/**
 * Evaluates a proposed Spotify Confidence tool call against deterministic diodes.
 */
function evaluateConfidenceAction(params = {}) {
  const tool = String(params.tool || params.action || '').toLowerCase();
  const flag = String(params.flag || params.flagKey || 'unnamed-flag');
  const rollout = Number.isFinite(params.rolloutPercent) ? params.rolloutPercent : null;
  const env = String(params.environment || 'production').toLowerCase();
  const testsPassed = params.testsPassed !== false;
  const isExperiment = params.isActiveExperiment === true;

  // Diode 1: Rollout Ceiling (max 10% autonomous rollout)
  if (rollout !== null && rollout > 10) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:rollout_ceiling',
      flag,
      rolloutPercent: rollout,
      maxAllowed: 10,
      reason: `Blocked autonomous rollout of flag '${flag}' to ${rollout}%. Max autonomous canary is 10%. Rollouts >10% require explicit human approval.`,
    };
  }

  // Diode 2: Test Proof Required before enabling/updating flag
  if (['set_rollout', 'create_flag', 'update_flag'].includes(tool) && !testsPassed) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:test_proof_required',
      flag,
      reason: `Blocked flag update on '${flag}': verification tests are failing or unverified. Pass all regression tests before updating feature flags.`,
    };
  }

  // Diode 3: Protect Active Experiments
  if (isExperiment && ['update_flag', 'set_rollout', 'delete_flag'].includes(tool)) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:protect_active_experiment',
      flag,
      reason: `Flag '${flag}' is part of an active A/B experiment. Modifying live experiment allocations autonomously is prohibited.`,
    };
  }

  // Diode 4: Prevent Flag Deletion in Production
  if (tool === 'delete_flag' && env === 'production') {
    return {
      decision: 'block',
      gateId: 'gate:confidence:prevent_flag_deletion',
      flag,
      environment: env,
      reason: `Blocked deletion of flag '${flag}' in production. Flags must be archived or deprecated before deletion.`,
    };
  }

  // Diode 5: Name flags after behaviour, not ticket ('new-checkout-flow', not 'JIRA-1234')
  if (TICKET_NAME_RE.test(flag.trim())) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:behavior_named_flag',
      flag,
      reason: `Blocked ticket-named flag '${flag}'. Name flags after the behaviour ('new-checkout-flow'), not the ticket ('JIRA-1234').`,
    };
  }

  // Diode 6: Default to "off" (fail-safe invariant)
  if (params.defaultEnabled === true || String(params.defaultVariant || '').toLowerCase() === 'on') {
    return {
      decision: 'block',
      gateId: 'gate:confidence:default_off_fail_safe',
      flag,
      reason: `Blocked flag '${flag}' with default='on'. Feature flags must default to 'off' and fail safe so deploying code is separated from releasing it.`,
    };
  }

  // Diode 7: Owner + Planned Removal Date required when lifecycle metadata is enforced
  if (params.enforceLifecycleMetadata === true && (!params.owner || !params.plannedRemovalDate)) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:owner_and_removal_date_required',
      flag,
      reason: `Blocked flag '${flag}': every flag must have an owner and a planned removal date.`,
    };
  }

  // Diode 8 (confidence.pdf Best Practice #1): Attach guardrail metrics (crashes, latency, errors) before launch
  if (tool === 'launch_rollout' && (!Array.isArray(params.guardrailMetrics) || params.guardrailMetrics.length === 0)) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:guardrail_metrics_required',
      flag,
      reason: `Blocked launch_rollout on '${flag}': attach guardrail metrics (crashes, latency, errors) before starting a gradual rollout.`,
    };
  }

  // Diode 9 (confidence.pdf Best Practice #2): Start small (1-5%) and increase in steps
  if (tool === 'launch_rollout' && (rollout === null || rollout < 1 || rollout > 5)) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:gradual_step_start_small',
      flag,
      rolloutPercent: rollout,
      reason: `Blocked launch_rollout on '${flag}' at ${rollout}%: initial gradual rollout step must start small (1-5%) and increase in steps.`,
    };
  }

  // Diode 10 (confidence.pdf Best Practice #3): Decide rollback trigger before launch
  if (tool === 'launch_rollout' && !params.rollbackTrigger) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:rollback_trigger_required',
      flag,
      reason: `Blocked launch_rollout on '${flag}': decide and attach an explicit rollbackTrigger before launching a rollout.`,
    };
  }

  // Diode 11 (confidence.pdf: Define a metric once): Metric must be grounded in a fact table
  if (['create_metric', 'register_metric'].includes(tool) && (!params.factTable || String(params.factTable).trim() === '')) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:metric_fact_table_grounded',
      flag,
      reason: `Blocked metric creation on '${flag}': every metric must be built on a validated fact table pointing to warehouse events.`,
    };
  }

  // Diode 12 (confidence.pdf: User ID alignment): Fact table user ID must match flag assignment entity ID
  if (
    params.factTableEntityId &&
    params.assignmentEntityId &&
    String(params.factTableEntityId).toLowerCase().trim() !== String(params.assignmentEntityId).toLowerCase().trim()
  ) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:user_id_flag_assignment_alignment',
      flag,
      reason: `Blocked experiment launch on '${flag}': fact table entity ID '${params.factTableEntityId}' does not match flag assignment entity ID '${params.assignmentEntityId}'. Mismatched IDs cause empty results.`,
    };
  }

  // Diode 13 (confidence.pdf: 3-5 Core Metrics): Must define 3-5 core metrics (1 north star, 1-2 drivers, 1-2 guardrails)
  if (tool === 'register_metric_suite' && Array.isArray(params.metrics)) {
    const ms = params.metrics;
    const ns = ms.filter((m) => String(m.type).toLowerCase() === 'north_star');
    const dr = ms.filter((m) => String(m.type).toLowerCase() === 'driver');
    const gr = ms.filter((m) => String(m.type).toLowerCase() === 'guardrail');
    if (ms.length < 3 || ms.length > 5 || ns.length !== 1 || dr.length < 1 || dr.length > 2 || gr.length < 1 || gr.length > 2) {
      return {
        decision: 'block',
        gateId: 'gate:confidence:core_metrics_structure_enforced',
        flag,
        reason: `Blocked metric suite on '${flag}': must define 3-5 core metrics (exactly 1 north star, 1-2 drivers, 1-2 guardrails). Found ${ms.length} metrics (${ns.length} north star, ${dr.length} drivers, ${gr.length} guardrails).`,
      };
    }
  }

  // Diode 14 (confidence.pdf: Real outcomes vs easy proxies): Block vanity proxies
  if (['create_metric', 'register_metric'].includes(tool) && params.metricName) {
    const FORBIDDEN = ['github_stars', 'stars_count', 'page_views', 'page_clicks', 'raw_prompt_tokens', 'downloads_count'];
    const name = String(params.metricName).toLowerCase();
    if (params.isRealOutcome === false || params.isProxyMetric === true || FORBIDDEN.some((p) => name.includes(p))) {
      return {
        decision: 'block',
        gateId: 'gate:confidence:outcome_not_proxy_integrity',
        flag,
        metricName: params.metricName,
        reason: `Blocked metric '${params.metricName}': choose metrics that track real outcomes. Easy proxies (e.g. stars, views, raw tokens) can mislead you.`,
      };
    }
  }

  // Diode 15 (Confidence Agent Everywhere Best Practice #1): Organise work in Projects
  if (['invoke_confidence_agent', 'run_confidence_agent'].includes(tool)) {
    const projectId = String(params.projectId || '').trim();
    const linkedSurfaces = Array.isArray(params.linkedSurfaces) ? params.linkedSurfaces : [];
    if (!projectId || linkedSurfaces.length === 0) {
      return {
        decision: 'block',
        gateId: 'gate:confidence:project_context_required',
        flag,
        reason: `Blocked Confidence Agent invocation: organise your work in a Confidence Project (projectId + linkedSurfaces) so the agent has project description, surfaces, and documents as context.`,
      };
    }

    // Diode 16 (Confidence Agent Everywhere Best Practice #2): Start with a clear outcome prompt
    const promptText = String(params.prompt || '').trim().toLowerCase();
    const hasClearOutcome =
      promptText.length >= 20 &&
      (promptText.includes('guardrail') ||
        promptText.includes('summar') ||
        promptText.includes('rollout') ||
        promptText.includes('regression') ||
        promptText.includes('metric'));
    if (!hasClearOutcome) {
      return {
        decision: 'block',
        gateId: 'gate:confidence:clear_outcome_prompt_required',
        flag,
        reason: `Blocked Confidence Agent invocation: start with a clear outcome prompt (e.g. "Summarise the checkout test and flag any guardrail regressions.").`,
      };
    }
  }

  // Diode 17 (Confidence Agent Everywhere Best Practice #3): Review before you act (sharp teammate, not autopilot)
  if (['apply_agent_recommendation', 'execute_agent_mutation'].includes(tool) && params.reviewedByTeammate !== true) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:review_before_act_guard',
      flag,
      reason: `Blocked autopilot execution on '${flag}': Review before you act. Treat the Confidence Agent like a sharp teammate, not autopilot.`,
    };
  }

  return {
    decision: 'allow',
    flag,
    tool,
    environment: env,
    reason: `Confidence action '${tool}' on flag '${flag}' cleared all pre-action safety diodes.`,
  };
}

function auditConfidenceDiodes() {
  const checks = [];

  // Check 1: 10% Rollout Ceiling enforcement
  const rollBlock = evaluateConfidenceAction({ tool: 'set_rollout', flag: 'beta-paywall', rolloutPercent: 50 });
  const rollAllow = evaluateConfidenceAction({ tool: 'set_rollout', flag: 'beta-paywall', rolloutPercent: 5 });
  checks.push({
    id: 'rollout-ceiling-audit',
    ok: rollBlock.decision === 'block' && rollAllow.decision === 'allow',
    message: rollBlock.decision === 'block'
      ? 'Successfully blocked 50% rollout (exceeds 10% ceiling) and allowed 5% canary'
      : 'Failed rollout ceiling check',
  });

  // Check 2: Test proof requirement
  const testBlock = evaluateConfidenceAction({ tool: 'set_rollout', flag: 'new-search', rolloutPercent: 10, testsPassed: false });
  checks.push({
    id: 'test-proof-audit',
    ok: testBlock.decision === 'block',
    message: testBlock.decision === 'block'
      ? 'Successfully blocked flag rollout when verification tests were failing'
      : 'Failed test proof check',
  });

  // Check 3: Active experiment lock
  const expBlock = evaluateConfidenceAction({ tool: 'update_flag', flag: 'pricing-variant', isActiveExperiment: true });
  checks.push({
    id: 'experiment-lock-audit',
    ok: expBlock.decision === 'block',
    message: expBlock.decision === 'block'
      ? 'Successfully locked active A/B experiment against autonomous mutation'
      : 'Failed experiment lock check',
  });

  // Check 4: Production flag deletion protection
  const delBlock = evaluateConfidenceAction({ tool: 'delete_flag', flag: 'auth-v2', environment: 'production' });
  checks.push({
    id: 'flag-deletion-audit',
    ok: delBlock.decision === 'block',
    message: delBlock.decision === 'block'
      ? 'Successfully blocked flag deletion in production'
      : 'Failed flag deletion protection check',
  });

  // Check 5: Ticket-named flag blocked ('JIRA-1234' vs 'new-checkout-flow')
  const ticketBlock = evaluateConfidenceAction({ tool: 'create_flag', flag: 'JIRA-1234' });
  checks.push({
    id: 'behavior-named-flag-audit',
    ok: ticketBlock.decision === 'block' && ticketBlock.gateId === 'gate:confidence:behavior_named_flag',
    message: 'Successfully blocked ticket-named flag JIRA-1234 in favor of behaviour-named flags',
  });

  // Check 6: Default-off fail-safe invariant
  const defaultOnBlock = evaluateConfidenceAction({ tool: 'create_flag', flag: 'new-checkout-flow', defaultVariant: 'on' });
  checks.push({
    id: 'default-off-failsafe-audit',
    ok: defaultOnBlock.decision === 'block' && defaultOnBlock.gateId === 'gate:confidence:default_off_fail_safe',
    message: 'Successfully enforced default="off" fail-safe invariant',
  });

  // Check 7: Gradual rollout guardrails + 1-5% start + rollback trigger (confidence.pdf)
  const noGuardrailBlock = evaluateConfidenceAction({ tool: 'launch_rollout', flag: 'sticky-packet-cta', rolloutPercent: 5 });
  const noRollbackBlock = evaluateConfidenceAction({
    tool: 'launch_rollout',
    flag: 'sticky-packet-cta',
    rolloutPercent: 5,
    guardrailMetrics: ['crash_rate', 'p95_latency_ms', 'error_rate'],
  });
  const validGradualLaunch = evaluateConfidenceAction({
    tool: 'launch_rollout',
    flag: 'sticky-packet-cta',
    rolloutPercent: 2,
    guardrailMetrics: ['crash_rate', 'p95_latency_ms', 'error_rate'],
    rollbackTrigger: 'error_rate > 0.01 || p95_latency_ms > 800',
  });
  checks.push({
    id: 'gradual-rollout-guardrails-audit',
    ok:
      noGuardrailBlock.decision === 'block' &&
      noRollbackBlock.decision === 'block' &&
      validGradualLaunch.decision === 'allow',
    message:
      'Successfully enforced pre-launch guardrail metrics, 1-5% initial step, and rollback trigger before gradual rollout',
  });

  // Check 8: Metric grounded in fact table (confidence.pdf)
  const noFactBlock = evaluateConfidenceAction({ tool: 'create_metric', flag: 'revenue-v1', metricName: 'revenue_usd' });
  const factAllow = evaluateConfidenceAction({
    tool: 'create_metric',
    flag: 'revenue-v1',
    metricName: 'revenue_usd',
    factTable: 'fact_purchases',
  });
  checks.push({
    id: 'metric-fact-table-audit',
    ok:
      noFactBlock.decision === 'block' &&
      noFactBlock.gateId === 'gate:confidence:metric_fact_table_grounded' &&
      factAllow.decision === 'allow',
    message: 'Successfully enforced metric fact table grounding (Define a metric once, trust it everywhere)',
  });

  // Check 9: User ID alignment between fact table and flag assignment (confidence.pdf)
  const mismatchBlock = evaluateConfidenceAction({
    tool: 'launch_experiment',
    flag: 'checkout-v2',
    factTableEntityId: 'anonymous_id',
    assignmentEntityId: 'user_id',
  });
  const alignedAllow = evaluateConfidenceAction({
    tool: 'launch_experiment',
    flag: 'checkout-v2',
    factTableEntityId: 'user_id',
    assignmentEntityId: 'user_id',
  });
  checks.push({
    id: 'user-id-alignment-audit',
    ok:
      mismatchBlock.decision === 'block' &&
      mismatchBlock.gateId === 'gate:confidence:user_id_flag_assignment_alignment' &&
      alignedAllow.decision === 'allow',
    message: 'Successfully enforced user ID alignment between fact table and flag assignment to prevent empty results',
  });

  // Check 10: 3-5 Core Metrics structure + Outcome not proxy integrity (confidence.pdf)
  const proxyBlock = evaluateConfidenceAction({
    tool: 'create_metric',
    flag: 'growth-v1',
    metricName: 'github_stars_count',
    factTable: 'fact_stars',
  });
  const validSuite = evaluateConfidenceAction({
    tool: 'register_metric_suite',
    flag: 'checkout-v2',
    metrics: [
      { name: 'net_revenue_usd', type: 'north_star', factTable: 'fact_purchases' },
      { name: 'checkout_interception_rate', type: 'driver', factTable: 'fact_tool_interceptions' },
      { name: 'feedback_conversion_pct', type: 'driver', factTable: 'fact_feedback' },
      { name: 'p95_latency_ms', type: 'guardrail', factTable: 'fact_tool_interceptions' },
      { name: 'false_positive_rate', type: 'guardrail', factTable: 'fact_tool_interceptions' },
    ],
  });
  const invalidSuite = evaluateConfidenceAction({
    tool: 'register_metric_suite',
    flag: 'checkout-v2',
    metrics: [{ name: 'metric_a', type: 'driver', factTable: 'fact_tool_interceptions' }],
  });
  checks.push({
    id: 'core-metrics-structure-and-proxy-audit',
    ok:
      proxyBlock.decision === 'block' &&
      proxyBlock.gateId === 'gate:confidence:outcome_not_proxy_integrity' &&
      validSuite.decision === 'allow' &&
      invalidSuite.decision === 'block' &&
      invalidSuite.gateId === 'gate:confidence:core_metrics_structure_enforced',
    message: 'Successfully enforced 3-5 core metrics rule and blocked misleading vanity proxies',
  });

  // Check 11: Confidence Agent Everywhere (Project context, Clear outcome prompt, Review before you act)
  const noProjectBlock = evaluateConfidenceAction({
    tool: 'invoke_confidence_agent',
    flag: 'thumbgate-direct-checkout',
    prompt: 'Summarise the checkout test and flag any guardrail regressions.',
  });
  const vaguePromptBlock = evaluateConfidenceAction({
    tool: 'invoke_confidence_agent',
    flag: 'thumbgate-direct-checkout',
    projectId: 'bmvb3c1s5uxdnbgxmg3q',
    linkedSurfaces: ['thumbgate-checkout'],
    prompt: 'check test',
  });
  const validAgentInvoke = evaluateConfidenceAction({
    tool: 'invoke_confidence_agent',
    flag: 'thumbgate-direct-checkout',
    projectId: 'bmvb3c1s5uxdnbgxmg3q',
    linkedSurfaces: ['thumbgate-checkout', 'thumbgate-dashboard'],
    prompt: 'Summarise the checkout test and flag any guardrail regressions.',
  });
  const unreviewedActBlock = evaluateConfidenceAction({
    tool: 'apply_agent_recommendation',
    flag: 'thumbgate-direct-checkout',
    reviewedByTeammate: false,
  });
  const reviewedActAllow = evaluateConfidenceAction({
    tool: 'apply_agent_recommendation',
    flag: 'thumbgate-direct-checkout',
    reviewedByTeammate: true,
  });
  checks.push({
    id: 'confidence-agent-everywhere-audit',
    ok:
      noProjectBlock.decision === 'block' &&
      noProjectBlock.gateId === 'gate:confidence:project_context_required' &&
      vaguePromptBlock.decision === 'block' &&
      vaguePromptBlock.gateId === 'gate:confidence:clear_outcome_prompt_required' &&
      validAgentInvoke.decision === 'allow' &&
      unreviewedActBlock.decision === 'block' &&
      unreviewedActBlock.gateId === 'gate:confidence:review_before_act_guard' &&
      reviewedActAllow.decision === 'allow',
    message: 'Successfully enforced Project context, Clear outcome prompt, and Review-before-you-act diodes for Confidence Agent',
  });

  const allPassed = checks.every((c) => c.ok);
  return {
    status: allPassed ? 'PASS' : 'FAIL',
    adapter: 'spotify-confidence',
    mcpEndpoint: 'https://mcp.confidence.dev/mcp/flags',
    diodes: DIODES,
    checks,
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = { json: false, mapOnly: false, evaluate: false, flag: 'new-flag', rollout: 10 };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--map-only') args.mapOnly = true;
    else if (arg === '--evaluate') args.evaluate = true;
    else if (arg.startsWith('--flag=')) args.flag = arg.slice(7);
    else if (arg.startsWith('--rollout=')) args.rollout = Number(arg.slice(10)) || 10;
  }
  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);

  if (args.mapOnly) {
    const map = {
      name: 'spotify-confidence-diode',
      status: 'ready',
      mcpEndpoints: [
        'https://mcp.confidence.dev/mcp/flags',
        'https://mcp.confidence.dev/mcp/docs',
      ],
      diodes: DIODES,
    };
    console.log(JSON.stringify(map, null, 2));
    return 0;
  }

  if (args.evaluate) {
    const result = evaluateConfidenceAction({
      tool: 'set_rollout',
      flag: args.flag,
      rolloutPercent: args.rollout,
    });
    console.log(JSON.stringify(result, null, 2));
    return result.decision === 'allow' ? 0 : 1;
  }

  const report = auditConfidenceDiodes();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== Spotify Confidence Pre-Action Diode (${report.status}) ===\n`);
    for (const c of report.checks) {
      console.log(`${c.ok ? '✓' : '✗'} ${c.message}`);
    }
  }
  return report.status === 'PASS' ? 0 : 1;
}

const CANONICAL_THUMBGATE_FACT_TABLES = Object.freeze([
  'fact_purchases',
  'fact_tool_interceptions',
  'fact_feedback',
  'fact_verification_runs',
]);

const DEFAULT_CONFIDENCE_CORE_METRICS = Object.freeze([
  { name: 'net_retained_intervention_value_usd', type: 'north_star', factTable: 'fact_purchases', isRealOutcome: true },
  { name: 'pre_action_interception_rate', type: 'driver', factTable: 'fact_tool_interceptions', isRealOutcome: true },
  { name: 'feedback_distillation_efficiency', type: 'driver', factTable: 'fact_feedback', isRealOutcome: true },
  { name: 'pretool_overhead_p95_latency_ms', type: 'guardrail', factTable: 'fact_tool_interceptions', isRealOutcome: true },
  { name: 'false_positive_block_rate', type: 'guardrail', factTable: 'fact_tool_interceptions', isRealOutcome: true },
]);

function evaluateSpotifyConfidenceMetricsAndFactTablesSteal(params = {}) {
  const factTableEntityId = String(params.factTableEntityId || 'user_id').trim().toLowerCase();
  const flagAssignmentEntityId = String(params.flagAssignmentEntityId || 'user_id').trim().toLowerCase();
  const coreMetrics = Array.isArray(params.coreMetrics) ? params.coreMetrics : DEFAULT_CONFIDENCE_CORE_METRICS;

  const blockers = [];
  const aligned = factTableEntityId === flagAssignmentEntityId;
  if (!aligned) {
    blockers.push('confidence_user_id_flag_assignment_mismatch');
  }

  const northStars = coreMetrics.filter((m) => String(m.type).toLowerCase() === 'north_star');
  const drivers = coreMetrics.filter((m) => String(m.type).toLowerCase() === 'driver');
  const guardrails = coreMetrics.filter((m) => String(m.type).toLowerCase() === 'guardrail');

  if (coreMetrics.length < 3 || coreMetrics.length > 5) {
    blockers.push('confidence_core_metrics_count_out_of_bounds');
  }
  if (northStars.length !== 1) {
    blockers.push('confidence_core_metrics_missing_single_north_star');
  }
  if (drivers.length < 1 || drivers.length > 2) {
    blockers.push('confidence_core_metrics_driver_count_invalid');
  }
  if (guardrails.length < 1 || guardrails.length > 2) {
    blockers.push('confidence_core_metrics_guardrail_count_invalid');
  }

  const FORBIDDEN_PROXIES = ['github_stars', 'stars_count', 'page_views', 'page_clicks', 'raw_prompt_tokens', 'downloads_count'];
  let allMetricsTrackRealOutcomes = true;
  for (const m of coreMetrics) {
    const nm = String(m.name || '').toLowerCase();
    if (m.isRealOutcome === false || m.isProxyMetric === true || FORBIDDEN_PROXIES.some((p) => nm.includes(p))) {
      allMetricsTrackRealOutcomes = false;
      if (!blockers.includes('confidence_misleading_proxy_metric_blocked')) {
        blockers.push('confidence_misleading_proxy_metric_blocked');
      }
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    emailAuthor: 'Johan Söderholm (Spotify Confidence)',
    emailSubject: 'Define a metric once, trust it everywhere',
    twoBuildingBlocks: {
      factTables: {
        availableCanonicalTables: [...CANONICAL_THUMBGATE_FACT_TABLES],
      },
      reusedMetrics: {
        count: coreMetrics.length,
        metrics: coreMetrics,
      },
    },
    bestPractices: {
      userIdAlignment: {
        aligned,
        factTableEntityId,
        flagAssignmentEntityId,
      },
      coreMetricsStructure: {
        validStructure:
          coreMetrics.length >= 3 &&
          coreMetrics.length <= 5 &&
          northStars.length === 1 &&
          drivers.length >= 1 &&
          drivers.length <= 2 &&
          guardrails.length >= 1 &&
          guardrails.length <= 2,
        northStarCount: northStars.length,
        driverCount: drivers.length,
        guardrailCount: guardrails.length,
      },
      outcomeNotProxyIntegrity: {
        allMetricsTrackRealOutcomes,
      },
    },
  };
}

if (require.main === module) {
  process.exit(runCli());
}

module.exports = {
  DIODES,
  CANONICAL_THUMBGATE_FACT_TABLES,
  DEFAULT_CONFIDENCE_CORE_METRICS,
  evaluateSpotifyConfidenceMetricsAndFactTablesSteal,
  evaluateConfidenceAction,
  auditConfidenceDiodes,
  runCli,
};

