'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateSpotifyConfidenceMetricsAndFactTablesSteal,
  CANONICAL_THUMBGATE_FACT_TABLES,
  DEFAULT_CONFIDENCE_CORE_METRICS,
} = require('../src/cloud-token-firewall');

const {
  evaluateConfidenceAction,
  auditConfidenceDiodes,
  DIODES,
} = require('../scripts/spotify-confidence-diode');

const {
  classifyStrategyAndAction,
} = require('../scripts/thumbgate-email-steal-engine');

test('Spotify Confidence Steal — Default Fact Tables and Core 3-5 Metrics pass cleanly', () => {
  const result = evaluateSpotifyConfidenceMetricsAndFactTablesSteal();
  assert.equal(result.ok, true);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.emailAuthor, 'Johan Söderholm (Spotify Confidence)');
  assert.equal(result.emailSubject, 'Define a metric once, trust it everywhere');
  assert.equal(result.bestPractices.userIdAlignment.aligned, true);
  assert.equal(result.bestPractices.coreMetricsStructure.validStructure, true);
  assert.equal(result.bestPractices.coreMetricsStructure.northStarCount, 1);
  assert.equal(result.bestPractices.coreMetricsStructure.driverCount, 2);
  assert.equal(result.bestPractices.coreMetricsStructure.guardrailCount, 2);
  assert.equal(result.bestPractices.outcomeNotProxyIntegrity.allMetricsTrackRealOutcomes, true);
  assert.equal(result.twoBuildingBlocks.reusedMetrics.count, 5);
  assert.ok(result.twoBuildingBlocks.factTables.availableCanonicalTables.includes('fact_purchases'));
  assert.ok(result.twoBuildingBlocks.factTables.availableCanonicalTables.includes('fact_tool_interceptions'));
});

test('Spotify Confidence Steal — User ID alignment mismatch triggers fail-closed blocker', () => {
  const result = evaluateSpotifyConfidenceMetricsAndFactTablesSteal({
    factTableEntityId: 'anonymous_cookie_id',
    flagAssignmentEntityId: 'authenticated_user_id',
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('confidence_user_id_flag_assignment_mismatch'));
  assert.equal(result.bestPractices.userIdAlignment.aligned, false);
});

test('Spotify Confidence Steal — 3-5 Core Metrics contract enforcement', () => {
  // Case A: Missing single north star (2 north stars provided)
  const twoNorthStars = evaluateSpotifyConfidenceMetricsAndFactTablesSteal({
    coreMetrics: [
      { name: 'revenue', type: 'north_star', factTable: 'fact_purchases' },
      { name: 'gross_margin', type: 'north_star', factTable: 'fact_purchases' },
      { name: 'p95_lat', type: 'guardrail', factTable: 'fact_tool_interceptions' },
      { name: 'blocks', type: 'driver', factTable: 'fact_tool_interceptions' },
    ],
  });
  assert.equal(twoNorthStars.ok, false);
  assert.ok(twoNorthStars.blockers.includes('confidence_core_metrics_missing_single_north_star'));

  // Case B: Too few metrics (< 3)
  const tooFew = evaluateSpotifyConfidenceMetricsAndFactTablesSteal({
    coreMetrics: [
      { name: 'revenue', type: 'north_star', factTable: 'fact_purchases' },
      { name: 'p95_lat', type: 'guardrail', factTable: 'fact_tool_interceptions' },
    ],
  });
  assert.equal(tooFew.ok, false);
  assert.ok(tooFew.blockers.includes('confidence_core_metrics_count_out_of_bounds'));

  // Case C: Missing guardrails
  const noGuardrails = evaluateSpotifyConfidenceMetricsAndFactTablesSteal({
    coreMetrics: [
      { name: 'revenue', type: 'north_star', factTable: 'fact_purchases' },
      { name: 'blocks', type: 'driver', factTable: 'fact_tool_interceptions' },
      { name: 'clicks', type: 'driver', factTable: 'fact_tool_interceptions' },
    ],
  });
  assert.equal(noGuardrails.ok, false);
  assert.ok(noGuardrails.blockers.includes('confidence_core_metrics_guardrail_count_invalid'));
});

test('Spotify Confidence Steal — Misleading easy proxies (stars, views, raw tokens) are blocked', () => {
  const proxyStar = evaluateSpotifyConfidenceMetricsAndFactTablesSteal({
    coreMetrics: [
      { name: 'github_stars_growth', type: 'north_star', factTable: 'fact_purchases' },
      { name: 'driver_a', type: 'driver', factTable: 'fact_tool_interceptions' },
      { name: 'guardrail_a', type: 'guardrail', factTable: 'fact_tool_interceptions' },
    ],
  });
  assert.equal(proxyStar.ok, false);
  assert.ok(proxyStar.blockers.includes('confidence_misleading_proxy_metric_blocked'));

  const explicitProxy = evaluateSpotifyConfidenceMetricsAndFactTablesSteal({
    coreMetrics: [
      { name: 'arbitrary_kpi', type: 'north_star', factTable: 'fact_purchases', isRealOutcome: false },
      { name: 'driver_a', type: 'driver', factTable: 'fact_tool_interceptions' },
      { name: 'guardrail_a', type: 'guardrail', factTable: 'fact_tool_interceptions' },
    ],
  });
  assert.equal(explicitProxy.ok, false);
  assert.ok(explicitProxy.blockers.includes('confidence_misleading_proxy_metric_blocked'));
});

test('Spotify Confidence Diode — Pre-Action evaluation of new diodes', () => {
  // Diode 11: Metric must be grounded in a fact table
  const ungrounded = evaluateConfidenceAction({
    tool: 'create_metric',
    flag: 'conversion-rate',
    metricName: 'conversion_rate',
  });
  assert.equal(ungrounded.decision, 'block');
  assert.equal(ungrounded.gateId, 'gate:confidence:metric_fact_table_grounded');

  const grounded = evaluateConfidenceAction({
    tool: 'create_metric',
    flag: 'conversion-rate',
    metricName: 'conversion_rate',
    factTable: 'fact_purchases',
  });
  assert.equal(grounded.decision, 'allow');

  // Diode 12: User ID alignment
  const mismatchedIds = evaluateConfidenceAction({
    tool: 'launch_experiment',
    flag: 'checkout-modal',
    factTableEntityId: 'device_id',
    assignmentEntityId: 'user_id',
  });
  assert.equal(mismatchedIds.decision, 'block');
  assert.equal(mismatchedIds.gateId, 'gate:confidence:user_id_flag_assignment_alignment');

  // Diode 13: Core metrics structure
  const invalidStructure = evaluateConfidenceAction({
    tool: 'register_metric_suite',
    flag: 'pricing-grid',
    metrics: [{ name: 'm1', type: 'driver', factTable: 'fact_purchases' }],
  });
  assert.equal(invalidStructure.decision, 'block');
  assert.equal(invalidStructure.gateId, 'gate:confidence:core_metrics_structure_enforced');

  // Diode 14: Outcome not proxy
  const forbiddenProxy = evaluateConfidenceAction({
    tool: 'create_metric',
    flag: 'social-proof',
    metricName: 'github_stars_total',
    factTable: 'fact_stars',
  });
  assert.equal(forbiddenProxy.decision, 'block');
  assert.equal(forbiddenProxy.gateId, 'gate:confidence:outcome_not_proxy_integrity');

  // Diode 15: Project context required for Confidence Agent
  const missingProject = evaluateConfidenceAction({
    tool: 'invoke_confidence_agent',
    flag: 'thumbgate-direct-checkout',
    prompt: 'Summarise the checkout test and flag any guardrail regressions.',
  });
  assert.equal(missingProject.decision, 'block');
  assert.equal(missingProject.gateId, 'gate:confidence:project_context_required');

  // Diode 16: Clear outcome prompt required for Confidence Agent
  const vaguePrompt = evaluateConfidenceAction({
    tool: 'invoke_confidence_agent',
    flag: 'thumbgate-direct-checkout',
    projectId: 'bmvb3c1s5uxdnbgxmg3q',
    linkedSurfaces: ['thumbgate-checkout'],
    prompt: 'check this',
  });
  assert.equal(vaguePrompt.decision, 'block');
  assert.equal(vaguePrompt.gateId, 'gate:confidence:clear_outcome_prompt_required');

  // Diode 17: Review before you act (sharp teammate, not autopilot)
  const autopilotMutation = evaluateConfidenceAction({
    tool: 'apply_agent_recommendation',
    flag: 'thumbgate-direct-checkout',
    reviewedByTeammate: false,
  });
  assert.equal(autopilotMutation.decision, 'block');
  assert.equal(autopilotMutation.gateId, 'gate:confidence:review_before_act_guard');
});

test('Spotify Confidence Diode — Audit report returns PASS and includes all 11 checks', () => {
  const report = auditConfidenceDiodes();
  assert.equal(report.status, 'PASS');
  assert.ok(report.checks.length >= 11);
  for (const c of report.checks) {
    assert.equal(c.ok, true, `Audit check ${c.id} failed: ${c.message}`);
  }
});

test('ThumbGate Email Steal Engine — Recognizes Johan Söderholm "Define a metric once" email', () => {
  const analysis = classifyStrategyAndAction({
    from: 'Johan Söderholm <jsoderholm@confidence.spotify.com>',
    subject: 'Define a metric once, trust it everywhere',
    body: 'Fact tables point to the events in your warehouse (purchases, sessions, errors) and how they connect to users. One fact table can power many metrics. A single purchases table gives you revenue, conversion and order frequency. Make sure the user ID in your fact table matches the one you use for flag assignment. Start with 3–5 core metrics: a north star, a couple of drivers and a couple of guardrails. Choose metrics that track real outcomes. Easy proxies can mislead you.',
  });

  assert.equal(analysis.category, 'spotify_confidence_metrics_and_fact_tables_steal');
  assert.equal(analysis.domainTag, 'spotify-confidence-fact-tables-and-metrics');
  assert.ok(analysis.summary.includes('Define a metric once, trust it everywhere'));
  assert.equal(analysis.gateOrModule, 'src/cloud-token-firewall.js#evaluateSpotifyConfidenceMetricsAndFactTablesSteal');
  assert.ok(analysis.entities.includes('Fact-Tables'));
  assert.ok(analysis.entities.includes('North-Star-Metric'));
  assert.ok(analysis.entities.includes('Outcome-Not-Proxy'));
});
