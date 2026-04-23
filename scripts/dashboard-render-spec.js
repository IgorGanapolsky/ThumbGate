'use strict';

const ALLOWED_COMPONENT_TYPES = Object.freeze([
  'hero',
  'stat_grid',
  'list',
  'callout',
]);

const DASHBOARD_VIEWS = Object.freeze({
  TEAM_REVIEW: 'team-review',
  INCIDENT_REVIEW: 'incident-review',
  WORKFLOW_ROLLOUT: 'workflow-rollout',
});

const VIEW_ORDER = Object.freeze([
  DASHBOARD_VIEWS.TEAM_REVIEW,
  DASHBOARD_VIEWS.INCIDENT_REVIEW,
  DASHBOARD_VIEWS.WORKFLOW_ROLLOUT,
]);

function formatUsdCents(value) {
  const cents = Number(value) || 0;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return '0%';
  return `${Number(value)}%`;
}

function formatCount(value) {
  if (!Number.isFinite(Number(value))) return '0';
  return String(Number(value));
}

function topMapEntries(map, limit) {
  return Object.entries(map || {})
    .map(([key, value]) => ({ key, value: Number(value) || 0 }))
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
}

function normalizeView(view) {
  if (!view) return DASHBOARD_VIEWS.TEAM_REVIEW;
  if (VIEW_ORDER.includes(view)) return view;
  throw new Error(`Unsupported dashboard render view: ${view}`);
}

function buildHero(title, description) {
  return {
    type: 'hero',
    title,
    description,
  };
}

function buildStatGrid(title, items, columns = 4) {
  return {
    type: 'stat_grid',
    title,
    columns,
    items,
  };
}

function buildList(title, items, emptyMessage) {
  return {
    type: 'list',
    title,
    items,
    emptyMessage,
  };
}

function buildCallout(tone, title, body) {
  return {
    type: 'callout',
    tone,
    title,
    body,
  };
}

function summarizeAnomalyTone(anomalySummary) {
  const severity = String(anomalySummary && anomalySummary.severity || '').toLowerCase();
  if (severity === 'critical' || severity === 'error') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'success';
}

function buildTeamReviewSpec(data) {
  const team = data.team || {};
  const predictive = data.predictive || {};
  const analytics = data.analytics || {};
  const pro = predictive.upgradePropensity ? predictive.upgradePropensity.pro || {} : {};
  const teamPropensity = predictive.upgradePropensity ? predictive.upgradePropensity.team || {} : {};
  const anomalies = Array.isArray(predictive.anomalies) ? predictive.anomalies : [];
  const topRiskAgents = Array.isArray(team.riskAgents) ? team.riskAgents.slice(0, 5) : [];
  const topBlockedGates = Array.isArray(team.topBlockedGates) ? team.topBlockedGates.slice(0, 5) : [];
  const watchlistItems = anomalies.slice(0, 5).map((anomaly) => ({
    title: anomaly.type || 'predictive_alert',
    subtitle: anomaly.message || 'No message available.',
    badge: anomaly.severity || 'info',
    tone: summarizeAnomalyTone({ severity: anomaly.severity }),
  }));

  return [
    buildHero(
      'Generated Team Reliability Review',
      'A constrained hosted view assembled from approved dashboard components. Use it to brief operators on agent drift, gate pressure, and upgrade/conversion risk without hand-building a custom page.'
    ),
    buildStatGrid('Team snapshot', [
      {
        label: 'Active agents',
        value: formatCount(team.activeAgents),
        note: `of ${formatCount(team.totalAgents)} registered agents`,
        tone: 'info',
      },
      {
        label: 'Org adherence',
        value: formatPercent(team.orgAdherenceRate),
        note: `rolling ${formatCount(team.windowHours || 24)}h view`,
        tone: 'success',
      },
      {
        label: 'Team propensity',
        value: teamPropensity.band || 'very_low',
        note: `score ${teamPropensity.score || 0}`,
        tone: 'info',
      },
      {
        label: 'Forecast revenue',
        value: formatUsdCents(predictive.revenueForecast && predictive.revenueForecast.predictedBookedRevenueCents),
        note: `opportunity ${formatUsdCents(predictive.revenueForecast && predictive.revenueForecast.incrementalOpportunityCents)}`,
        tone: 'info',
      },
    ]),
    buildList(
      'Highest-risk agents',
      topRiskAgents.map((agent) => ({
        title: agent.id || 'agent',
        subtitle: `${agent.project || 'unknown project'}${agent.branch ? ` · ${agent.branch}` : ''}`,
        badge: `${formatPercent(agent.adherenceRate)} adherence`,
        tone: 'warning',
      })),
      'No risky agents detected in this window.'
    ),
    buildList(
      'Top blocked gates',
      topBlockedGates.map((gate) => ({
        title: gate.gateId || 'gate',
        subtitle: `${formatCount(gate.warned)} warns`,
        badge: `${formatCount(gate.blocked)} blocks`,
        tone: 'warning',
      })),
      'No blocked gates recorded yet.'
    ),
    buildList(
      'Predictive watchlist',
      watchlistItems,
      'No predictive anomalies detected. Team reliability is stable.'
    ),
    buildCallout(
      pro.band === 'high' || teamPropensity.band === 'high' ? 'warning' : 'success',
      'Commercial signal',
      `Pro propensity is ${pro.band || 'very_low'} and Team propensity is ${teamPropensity.band || 'very_low'}. Workflow sprint leads currently total ${formatCount(analytics.pipeline && analytics.pipeline.workflowSprintLeads && analytics.pipeline.workflowSprintLeads.total)}.`
    ),
  ];
}

function buildIncidentReviewSpec(data) {
  const gateStats = data.gateStats || {};
  const diagnostics = data.diagnostics || {};
  const liveMetrics = data.liveMetrics || {};
  const predictive = data.predictive || {};
  const gates = Array.isArray(data.gates) ? data.gates.slice(0, 6) : [];
  const diagnosticCategories = Array.isArray(diagnostics.categories) ? diagnostics.categories.slice(0, 5) : [];
  const anomalies = Array.isArray(predictive.anomalies) ? predictive.anomalies.slice(0, 5) : [];
  const recommendations = [];

  if (gateStats.topBlocked) {
    recommendations.push({
      title: `Audit ${gateStats.topBlocked}`,
      subtitle: 'Confirm the pattern and severity still match the failure mode causing the most blocks.',
      badge: `${formatCount(gateStats.topBlockedCount)} blocks`,
      tone: 'warning',
    });
  }
  if (diagnosticCategories[0]) {
    recommendations.push({
      title: `Investigate ${diagnosticCategories[0].key}`,
      subtitle: 'Use the failure diagnostic log to trace the most common root cause before widening any gate.',
      badge: `${formatCount(diagnosticCategories[0].count)} diagnoses`,
      tone: 'warning',
    });
  }
  if (anomalies[0]) {
    recommendations.push({
      title: `Resolve ${anomalies[0].type || 'predictive_alert'}`,
      subtitle: anomalies[0].message || 'Review the predictive watchlist for the next mitigation.',
      badge: anomalies[0].severity || 'info',
      tone: summarizeAnomalyTone({ severity: anomalies[0].severity }),
    });
  }

  return [
    buildHero(
      'Generated Incident Review',
      'A constrained post-mortem view for the current reliability posture. It prioritizes blocked gates, root causes, and recommended next actions without exposing arbitrary HTML or model-generated code.'
    ),
    buildStatGrid('Incident snapshot', [
      {
        label: 'Active gates',
        value: formatCount(gates.length || gateStats.totalGates),
        note: `${formatCount(gateStats.manualCount)} manual / ${formatCount(gateStats.autoCount)} auto-promoted`,
        tone: 'info',
      },
      {
        label: 'Blocks per day',
        value: String(liveMetrics.gateHitRate && liveMetrics.gateHitRate.blockedPerDay || 0),
        note: `warns/day ${String(liveMetrics.gateHitRate && liveMetrics.gateHitRate.warnedPerDay || 0)}`,
        tone: 'warning',
      },
      {
        label: 'Predictive alerts',
        value: formatCount(predictive.anomalySummary && predictive.anomalySummary.count),
        note: predictive.anomalySummary && predictive.anomalySummary.severity || 'healthy',
        tone: summarizeAnomalyTone(predictive.anomalySummary || {}),
      },
      {
        label: 'Buyer loss signals',
        value: formatCount(data.analytics && data.analytics.buyerLoss && data.analytics.buyerLoss.totalSignals),
        note: 'reasons captured in telemetry',
        tone: 'warning',
      },
    ]),
    buildList(
      'Active gate pressure',
      gates.map((gate) => ({
        title: gate.name || gate.id || 'gate',
        subtitle: gate.pattern || '',
        badge: String(gate.action || 'block').toUpperCase(),
        tone: gate.action === 'warn' ? 'info' : 'warning',
      })),
      'No active checks configured.'
    ),
    buildList(
      'Root cause clusters',
      diagnosticCategories.map((category) => ({
        title: category.key || 'root_cause',
        subtitle: category.examples && category.examples[0] ? category.examples[0] : 'No example captured.',
        badge: `${formatCount(category.count)} cases`,
        tone: 'warning',
      })),
      'No diagnostic clusters recorded yet.'
    ),
    buildList(
      'Recommended next actions',
      recommendations,
      'No active incidents detected. Current reliability posture is healthy.'
    ),
  ];
}

function buildWorkflowRolloutSpec(data) {
  const analytics = data.analytics || {};
  const predictive = data.predictive || {};
  const topSources = topMapEntries(analytics.attribution && analytics.attribution.acquisitionBySource, 5);
  const topCreators = Array.isArray(predictive.topCreators) ? predictive.topCreators.slice(0, 5) : [];
  const topChannels = Array.isArray(predictive.topSources) ? predictive.topSources.slice(0, 5) : [];
  const pipeline = analytics.pipeline || {};
  const revenue = analytics.revenue || {};
  const rolloutMoves = [];

  if (topCreators[0]) {
    rolloutMoves.push({
      title: `Double down on ${topCreators[0].key}`,
      subtitle: 'Best creator opportunity based on predicted incremental revenue.',
      badge: formatUsdCents(topCreators[0].opportunityRevenueCents),
      tone: 'success',
    });
  }
  if (topChannels[0]) {
    rolloutMoves.push({
      title: `Expand ${topChannels[0].key}`,
      subtitle: 'Top channel opportunity from the predictive layer.',
      badge: formatUsdCents(topChannels[0].opportunityRevenueCents),
      tone: 'success',
    });
  }
  if ((pipeline.workflowSprintLeads && pipeline.workflowSprintLeads.total) > (pipeline.qualifiedWorkflowSprintLeads && pipeline.qualifiedWorkflowSprintLeads.total)) {
    rolloutMoves.push({
      title: 'Qualify pending workflow sprint leads',
      subtitle: 'There is lead volume waiting to move into proof-backed rollout.',
      badge: `${formatCount(pipeline.workflowSprintLeads.total)} total`,
      tone: 'warning',
    });
  }

  return [
    buildHero(
      'Generated Workflow Rollout View',
      'A constrained GTM and team-rollout dashboard. It turns analytics and predictive data into an operator-safe view for qualification, creator prioritization, and proof-backed expansion.'
    ),
    buildStatGrid('Rollout pipeline', [
      {
        label: 'Workflow sprint leads',
        value: formatCount(pipeline.workflowSprintLeads && pipeline.workflowSprintLeads.total),
        note: 'intake-first hosted team funnel',
        tone: 'info',
      },
      {
        label: 'Qualified leads',
        value: formatCount(pipeline.qualifiedWorkflowSprintLeads && pipeline.qualifiedWorkflowSprintLeads.total),
        note: 'ready for proof-backed rollout',
        tone: 'success',
      },
      {
        label: 'Booked revenue',
        value: formatUsdCents(revenue.bookedRevenueCents),
        note: `${formatCount(revenue.paidOrders)} paid orders`,
        tone: 'success',
      },
      {
        label: 'Team propensity',
        value: predictive.upgradePropensity && predictive.upgradePropensity.team ? predictive.upgradePropensity.team.band : 'very_low',
        note: `score ${predictive.upgradePropensity && predictive.upgradePropensity.team ? predictive.upgradePropensity.team.score : 0}`,
        tone: 'info',
      },
    ]),
    buildList(
      'Top acquisition sources',
      topSources.map((entry) => ({
        title: entry.key || 'source',
        subtitle: 'captured acquisition source',
        badge: `${formatCount(entry.value)} leads`,
        tone: 'info',
      })),
      'No attributed acquisition sources yet.'
    ),
    buildList(
      'Creator revenue opportunities',
      topCreators.map((entry) => ({
        title: entry.key || 'creator',
        subtitle: 'predicted incremental revenue opportunity',
        badge: formatUsdCents(entry.opportunityRevenueCents),
        tone: 'success',
      })),
      'No creator opportunities detected yet.'
    ),
    buildList(
      'Next rollout moves',
      rolloutMoves,
      'No rollout recommendations yet. Capture more attribution and workflow sprint activity first.'
    ),
  ];
}

function buildDashboardRenderSpec(dashboardData, options = {}) {
  const view = normalizeView(options.view);
  let components;

  if (view === DASHBOARD_VIEWS.TEAM_REVIEW) {
    components = buildTeamReviewSpec(dashboardData);
  } else if (view === DASHBOARD_VIEWS.INCIDENT_REVIEW) {
    components = buildIncidentReviewSpec(dashboardData);
  } else {
    components = buildWorkflowRolloutSpec(dashboardData);
  }

  return {
    version: '1.0.0',
    catalog: 'thumbgate-dashboard-render-spec',
    generatedAt: new Date(options.now || Date.now()).toISOString(),
    view,
    availableViews: VIEW_ORDER.map((value) => ({
      id: value,
      label: value === DASHBOARD_VIEWS.TEAM_REVIEW
        ? 'Team review'
        : value === DASHBOARD_VIEWS.INCIDENT_REVIEW
          ? 'Incident review'
          : 'Workflow rollout',
    })),
    allowedComponentTypes: [...ALLOWED_COMPONENT_TYPES],
    components,
  };
}

module.exports = {
  ALLOWED_COMPONENT_TYPES,
  DASHBOARD_VIEWS,
  buildDashboardRenderSpec,
  normalizeView,
};
