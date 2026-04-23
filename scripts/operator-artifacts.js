#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 30;
const ARTIFACT_TYPES = [
  'pr-pulse',
  'reliability-pulse',
  'revenue-pulse',
  'release-readiness',
];

function normalizeWindowHours(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_WINDOW_HOURS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_HOURS;
  if (parsed < 1) return 1;
  if (parsed > MAX_WINDOW_HOURS) return MAX_WINDOW_HOURS;
  return Math.floor(parsed);
}

function normalizeArtifactType(type) {
  const normalized = String(type || 'reliability-pulse').trim().toLowerCase();
  const aliases = {
    pr: 'pr-pulse',
    prs: 'pr-pulse',
    pull_requests: 'pr-pulse',
    pullrequests: 'pr-pulse',
    reliability: 'reliability-pulse',
    gates: 'reliability-pulse',
    revenue: 'revenue-pulse',
    growth: 'revenue-pulse',
    acquisition: 'revenue-pulse',
    release: 'release-readiness',
    readiness: 'release-readiness',
  };
  const resolved = aliases[normalized] || normalized;
  if (!ARTIFACT_TYPES.includes(resolved)) {
    throw new Error(`Unknown operator artifact type: ${type}`);
  }
  return resolved;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPath(source, parts, fallback = undefined) {
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return fallback;
    cursor = cursor[part];
  }
  return cursor === undefined ? fallback : cursor;
}

function formatCurrency(cents) {
  return `$${(safeNumber(cents) / 100).toFixed(2)}`;
}

function compactList(items, limit = 5) {
  return (Array.isArray(items) ? items : []).filter(Boolean).slice(0, limit);
}

function getErrorMessage(error) {
  return String(error?.message || error);
}

function artifactBase(type, options = {}) {
  const generatedAt = options.now instanceof Date
    ? options.now.toISOString()
    : options.now || new Date().toISOString();
  return {
    schemaVersion: 1,
    type,
    generatedAt,
    windowHours: normalizeWindowHours(options.windowHours),
    status: 'watch',
    summary: '',
    decision: {
      label: 'Review',
      rationale: '',
      nextActions: [],
    },
    metrics: {},
    sections: [],
    evidence: [],
  };
}

function buildEvidence(label, value, extra = {}) {
  return {
    label,
    value: value === undefined || value === null ? 'unknown' : value,
    ...extra,
  };
}

function buildReliabilityPulseArtifact(options = {}) {
  const type = 'reliability-pulse';
  const artifact = artifactBase(type, options);
  const dashboard = options.dashboardData || {};
  const session = options.sessionReport || {};
  const gateStats = dashboard.gateStats || {};
  const health = dashboard.health || {};
  const diagnostics = dashboard.diagnostics || {};
  const reviewDelta = dashboard.reviewDelta || {};
  const lessonPipeline = dashboard.lessonPipeline || {};

  const blocked = safeNumber(gateStats.blocked, safeNumber(getPath(session, ['gates', 'blocked'])));
  const warned = safeNumber(gateStats.warned, safeNumber(getPath(session, ['gates', 'warned'])));
  const feedbackCount = safeNumber(health.feedbackCount);
  const memoryCount = safeNumber(health.memoryCount);
  const negativeAdded = safeNumber(reviewDelta.negativeAdded);
  const staleLessons = safeNumber(lessonPipeline.staleLessons);
  const topDiagnostic = getPath(diagnostics, ['categories', 0, 'key'], null);

  artifact.title = 'Reliability Pulse';
  artifact.metrics = {
    blocked,
    warned,
    feedbackCount,
    memoryCount,
    negativeAdded,
    staleLessons,
  };

  if (negativeAdded > 0 || staleLessons > 0 || blocked > 0) {
    artifact.status = 'actionable';
    artifact.decision.label = 'Regenerate and inspect gates';
    artifact.decision.rationale = 'Recent negative signal or check activity means the prevention layer has learnable work to absorb.';
    artifact.decision.nextActions = compactList([
      negativeAdded > 0 ? `Promote ${negativeAdded} new negative signal(s) into prevention rules.` : null,
      staleLessons > 0 ? `Review ${staleLessons} stale lesson(s) before they age out of useful recall.` : null,
      blocked > 0 ? `Inspect the top blocked gate path before the next risky operation.` : null,
      topDiagnostic ? `Address top diagnostic category: ${topDiagnostic}.` : null,
    ], 4);
  } else {
    artifact.status = 'healthy';
    artifact.decision.label = 'Keep shipping';
    artifact.decision.rationale = 'No fresh reliability pressure is visible in the current window.';
    artifact.decision.nextActions = ['Keep the Reliability Gateway enabled during PR and release work.'];
  }

  artifact.summary = `${blocked} blocked, ${warned} warned, ${feedbackCount} feedback events, ${memoryCount} memories.`;
  artifact.sections = [
    {
      title: 'Gate Load',
      bullets: [
        `${blocked} blocked actions`,
        `${warned} warnings`,
        `${safeNumber(getPath(session, ['gates', 'pendingApproval']))} pending approvals`,
      ],
    },
    {
      title: 'Learning Queue',
      bullets: compactList([
        `${negativeAdded} new negative signal(s)`,
        `${staleLessons} stale lesson(s)`,
        topDiagnostic ? `Top diagnostic: ${topDiagnostic}` : null,
      ]),
    },
  ];
  artifact.evidence = [
    buildEvidence('dashboard.health.feedbackCount', feedbackCount),
    buildEvidence('dashboard.gateStats.blocked', blocked),
    buildEvidence('session_report.windowHours', artifact.windowHours),
  ];
  return artifact;
}

function buildRevenuePulseArtifact(options = {}) {
  const type = 'revenue-pulse';
  const artifact = artifactBase(type, options);
  const dashboard = options.dashboardData || {};
  const analytics = dashboard.analytics || {};
  const funnel = analytics.funnel || {};
  const revenue = analytics.revenue || {};
  const seo = analytics.seo || {};
  const attribution = analytics.attribution || {};

  const visitors = safeNumber(funnel.visitors);
  const ctaClicks = safeNumber(funnel.ctaClicks);
  const checkoutStarts = safeNumber(funnel.checkoutStarts);
  const acquisitionLeads = safeNumber(funnel.acquisitionLeads);
  const paidOrders = safeNumber(revenue.paidOrders, safeNumber(funnel.paidOrders));
  const bookedRevenueCents = safeNumber(revenue.bookedRevenueCents);
  const topTrafficChannel = funnel.topTrafficChannel || getPath(seo, ['topSurface', 'key'], null);
  const topPaidSource = Object.entries(attribution.paidBySource || {})
    .sort((a, b) => safeNumber(b[1]) - safeNumber(a[1]))[0];

  artifact.title = 'Revenue Pulse';
  artifact.metrics = {
    visitors,
    ctaClicks,
    checkoutStarts,
    acquisitionLeads,
    paidOrders,
    bookedRevenueCents,
    bookedRevenue: formatCurrency(bookedRevenueCents),
    visitorToPaidRate: safeNumber(funnel.visitorToPaidRate),
  };

  if (paidOrders > 0) {
    artifact.status = 'actionable';
    artifact.decision.label = 'Double down on converting source';
    artifact.decision.rationale = 'Revenue is visible; the highest-ROI move is to reuse the source and copy that already converted.';
    artifact.decision.nextActions = compactList([
      topPaidSource ? `Create another offer using the paid source: ${topPaidSource[0]}.` : null,
      topTrafficChannel ? `Fan out the winning acquisition angle on ${topTrafficChannel}.` : null,
      'Keep checkout proof and pricing copy unchanged until the next conversion batch is measured.',
    ], 3);
  } else if (checkoutStarts > 0 || ctaClicks > 0) {
    artifact.status = 'blocked';
    artifact.decision.label = 'Fix checkout conversion';
    artifact.decision.rationale = 'Intent exists, but the journey is not turning into paid orders.';
    artifact.decision.nextActions = compactList([
      `${checkoutStarts} checkout start(s) and ${ctaClicks} CTA click(s) need buyer-loss review.`,
      'Audit checkout redirects, pricing objections, and proof placement before adding more traffic.',
      topTrafficChannel ? `Inspect source-specific copy for ${topTrafficChannel}.` : null,
    ], 4);
  } else {
    artifact.status = 'actionable';
    artifact.decision.label = 'Create more acquisition surface';
    artifact.decision.rationale = 'No paid orders or checkout intent are visible, so traffic and discovery injection beat infrastructure work.';
    artifact.decision.nextActions = compactList([
      'Publish one high-intent ThumbGate proof chunk with DPO, Pre-Action Checks, and Reliability Gateway terms.',
      'Add one outreach or community distribution action tied to the latest verification evidence.',
      topTrafficChannel ? `Reuse current top channel: ${topTrafficChannel}.` : 'Seed a first measurable traffic channel.',
    ], 3);
  }

  artifact.summary = `${paidOrders} paid order(s), ${formatCurrency(bookedRevenueCents)} booked, ${visitors} visitors, ${checkoutStarts} checkout starts.`;
  artifact.sections = [
    {
      title: 'Funnel',
      bullets: [
        `${visitors} visitors`,
        `${ctaClicks} CTA clicks`,
        `${checkoutStarts} checkout starts`,
        `${paidOrders} paid orders`,
      ],
    },
    {
      title: 'Acquisition',
      bullets: compactList([
        topTrafficChannel ? `Top traffic channel: ${topTrafficChannel}` : 'No top traffic channel yet',
        `${safeNumber(seo.landingViews)} SEO landing views`,
        `${acquisitionLeads} acquisition leads`,
      ]),
    },
  ];
  artifact.evidence = [
    buildEvidence('analytics.revenue.paidOrders', paidOrders),
    buildEvidence('analytics.revenue.bookedRevenueCents', bookedRevenueCents),
    buildEvidence('analytics.funnel.checkoutStarts', checkoutStarts),
  ];
  return artifact;
}

function classifyPr(pr, checks) {
  const { summarizeChecks } = require('./pr-manager');
  const summary = summarizeChecks(checks || []);
  const mergeState = String(pr.mergeStateStatus || 'UNKNOWN').toUpperCase();
  const mergeable = String(pr.mergeable || 'UNKNOWN').toUpperCase();
  const reviewDecision = String(pr.reviewDecision || '').toUpperCase();
  if (pr.isDraft) return { state: 'draft', blockers: ['draft'] };
  if (mergeState === 'BEHIND') return { state: 'blocked', blockers: ['BEHIND'] };
  if (mergeState === 'DIRTY' || mergeable === 'CONFLICTING') {
    return { state: 'blocked', blockers: ['conflicts'] };
  }
  if (summary.failing.length > 0) return { state: 'blocked', blockers: summary.failing };
  if (summary.pending.length > 0) return { state: 'pending', blockers: summary.pending };
  if (reviewDecision === 'CHANGES_REQUESTED') {
    return { state: 'blocked', blockers: ['changes_requested'] };
  }
  if (reviewDecision === 'REVIEW_REQUIRED') {
    return { state: 'blocked', blockers: ['review_required'] };
  }
  if (['CLEAN', 'HAS_HOOKS'].includes(mergeState) && ['MERGEABLE', 'UNKNOWN'].includes(mergeable)) {
    return { state: 'ready', blockers: [] };
  }
  return { state: 'pending', blockers: [pr.mergeStateStatus || 'unknown_state'] };
}

function createPrRow(pr, checks, classification) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    draft: Boolean(pr.isDraft),
    mergeStateStatus: pr.mergeStateStatus || null,
    reviewDecision: pr.reviewDecision || null,
    state: classification.state,
    blockers: classification.blockers,
    checkCount: checks.length,
  };
}

function groupPrRows(rows) {
  return {
    ready: rows.filter((row) => row.state === 'ready'),
    blocked: rows.filter((row) => row.state === 'blocked'),
    pending: rows.filter((row) => row.state === 'pending'),
    drafts: rows.filter((row) => row.state === 'draft'),
  };
}

function getPrPulseStatus(groups) {
  if (groups.blocked.length > 0) return 'blocked';
  if (groups.ready.length > 0) return 'actionable';
  if (groups.pending.length > 0) return 'watch';
  return 'healthy';
}

function getPrPulseDecision(groups) {
  if (groups.ready.length > 0) {
    return {
      label: 'Submit ready PRs through protected merge path',
      rationale: 'Terminal checks and merge state are clean for at least one open PR.',
    };
  }
  if (groups.blocked.length > 0) {
    return {
      label: 'Fix PR blockers',
      rationale: 'One or more PRs have failing checks, draft state, or merge-state blockers.',
    };
  }
  if (groups.pending.length > 0) {
    return {
      label: 'Wait for terminal checks',
      rationale: 'Checks are still running; merging now would violate the protected path.',
    };
  }
  return {
    label: 'No PR action',
    rationale: 'No open PRs require operator action.',
  };
}

function formatPrNumbers(rows) {
  return rows.map((row) => `#${row.number}`).join(', ');
}

function formatBlockedPrs(rows) {
  return rows.map((row) => {
    const blocker = row.blockers[0] || 'blocked';
    return `#${row.number} (${blocker})`;
  }).join(', ');
}

function buildPrNextActions(groups) {
  return compactList([
    groups.ready.length > 0 ? `Run npm run pr:manage for PR(s): ${formatPrNumbers(groups.ready)}.` : null,
    groups.blocked.length > 0 ? `Unblock PR(s): ${formatBlockedPrs(groups.blocked)}.` : null,
    groups.pending.length > 0 ? `Recheck pending PR(s): ${formatPrNumbers(groups.pending)}.` : null,
    groups.drafts.length > 0 ? `Leave draft PR(s) alone until marked ready: ${formatPrNumbers(groups.drafts)}.` : null,
  ], 4);
}

async function buildPrPulseArtifact(options = {}) {
  const type = 'pr-pulse';
  const artifact = artifactBase(type, options);
  artifact.title = 'PR Pulse';

  const prClient = options.prClient || require('./pr-manager');
  const prs = Array.isArray(options.prs) ? options.prs : await prClient.listOpenPrs();
  const checksByPr = options.checksByPr || {};
  const rows = [];

  for (const pr of prs) {
    const number = pr.number;
    let checks = checksByPr[number];
    let checkError = null;
    if (!Array.isArray(checks)) {
      try {
        checks = await prClient.getPrChecks(number);
      } catch (err) {
        checks = [];
        checkError = getErrorMessage(err);
      }
    }
    const classification = checkError
      ? { state: 'blocked', blockers: [checkError] }
      : classifyPr(pr, checks);
    rows.push(createPrRow(pr, checks, classification));
  }

  const groups = groupPrRows(rows);
  const decision = getPrPulseDecision(groups);

  artifact.metrics = {
    open: rows.length,
    ready: groups.ready.length,
    blocked: groups.blocked.length,
    pending: groups.pending.length,
    draft: groups.drafts.length,
  };
  artifact.status = getPrPulseStatus(groups);
  artifact.summary = `${rows.length} open PR(s): ${groups.ready.length} ready, ${groups.blocked.length} blocked, ${groups.pending.length} pending, ${groups.drafts.length} draft.`;
  artifact.decision.label = decision.label;
  artifact.decision.rationale = decision.rationale;
  artifact.decision.nextActions = buildPrNextActions(groups);
  artifact.sections = [
    {
      title: 'Open PRs',
      bullets: rows.map((row) => `#${row.number} ${row.state}: ${row.title || 'untitled'}`),
      data: rows,
    },
  ];
  artifact.evidence = [
    buildEvidence('openPrs', rows.length),
    buildEvidence('readyPrs', formatPrNumbers(groups.ready) || 'none'),
    buildEvidence('blockedPrs', formatPrNumbers(groups.blocked) || 'none'),
  ];
  return artifact;
}

function buildReleaseReadinessArtifact(options = {}) {
  const type = 'release-readiness';
  const artifact = artifactBase(type, options);
  const dashboard = options.dashboardData || {};
  const packageInfo = options.packageInfo || readPackageInfo(options.packageRoot);
  const health = dashboard.health || {};
  const readiness = dashboard.readiness || {};
  const gateAudit = dashboard.gateAudit || {};

  const feedbackCount = safeNumber(health.feedbackCount);
  const gateCount = safeNumber(health.gateCount);
  const gateConfigLoaded = health.gateConfigLoaded !== false;
  const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
  const auditWarnings = safeNumber(gateAudit.warnings);
  const version = packageInfo.version || 'unknown';

  artifact.title = 'Release Readiness';
  artifact.metrics = {
    version,
    feedbackCount,
    gateCount,
    gateConfigLoaded,
    readinessWarnings: warnings.length,
    gateAuditWarnings: auditWarnings,
  };

  if (!gateConfigLoaded || warnings.length > 0 || auditWarnings > 0) {
    artifact.status = 'blocked';
    artifact.decision.label = 'Hold release until readiness blockers are cleared';
    artifact.decision.rationale = 'Release work needs a loaded gate config and no unresolved readiness warnings.';
    artifact.decision.nextActions = compactList([
      gateConfigLoaded ? null : 'Restore the gate config before release work.',
      warnings[0] ? `Resolve readiness warning: ${warnings[0]}` : null,
      auditWarnings > 0 ? `Clear ${auditWarnings} gate audit warning(s).` : null,
      'Run the clean-worktree verification suite before publishing.',
    ], 4);
  } else {
    artifact.status = 'actionable';
    artifact.decision.label = 'Verify in a clean worktree';
    artifact.decision.rationale = 'Local readiness inputs look sane; the next gate is exact-commit verification.';
    artifact.decision.nextActions = [
      'Run npm ci in a dedicated clean verification worktree.',
      'Run npm test, npm run test:coverage, npm run prove:adapters, npm run prove:automation, and npm run self-heal:check.',
      'Submit release PRs through npm run pr:manage after checks are terminal.',
    ];
  }

  artifact.summary = `ThumbGate ${version}: ${gateCount} gates, ${feedbackCount} feedback events, ${warnings.length + auditWarnings} readiness warning(s).`;
  artifact.sections = [
    {
      title: 'Release Inputs',
      bullets: [
        `Package version: ${version}`,
        `Gate config: ${gateConfigLoaded ? 'loaded' : 'missing'}`,
        `${gateCount} configured gates`,
        `${feedbackCount} feedback events`,
      ],
    },
    {
      title: 'Verification',
      bullets: artifact.decision.nextActions,
    },
  ];
  artifact.evidence = [
    buildEvidence('package.version', version, { path: 'package.json' }),
    buildEvidence('dashboard.health.gateConfigLoaded', gateConfigLoaded),
    buildEvidence('dashboard.readiness.warnings', warnings.length),
  ];
  return artifact;
}

function readPackageInfo(packageRoot) {
  const root = packageRoot || path.join(__dirname, '..');
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function resolveDashboardData(options) {
  if (options.dashboardData) return options.dashboardData;
  const { generateDashboard } = require('./dashboard');
  const { getFeedbackPaths } = require('./feedback-loop');
  return generateDashboard(options.feedbackDir || getFeedbackPaths().FEEDBACK_DIR, {
    now: options.now,
  });
}

function resolveSessionReport(options) {
  if (options.sessionReport) return options.sessionReport;
  const { buildSessionReport } = require('./session-report');
  return buildSessionReport({ windowHours: options.windowHours });
}

async function generateOperatorArtifact(options = {}) {
  const type = normalizeArtifactType(options.type);
  const windowHours = normalizeWindowHours(options.windowHours);
  const sharedOptions = { ...options, type, windowHours };

  if (type === 'pr-pulse') {
    return buildPrPulseArtifact(sharedOptions);
  }

  const dashboardData = await resolveDashboardData(sharedOptions);
  if (type === 'reliability-pulse') {
    const sessionReport = resolveSessionReport(sharedOptions);
    return buildReliabilityPulseArtifact({ ...sharedOptions, dashboardData, sessionReport });
  }
  if (type === 'revenue-pulse') {
    return buildRevenuePulseArtifact({ ...sharedOptions, dashboardData });
  }
  return buildReleaseReadinessArtifact({ ...sharedOptions, dashboardData });
}

function formatArtifactMarkdown(artifact) {
  const lines = [
    `# ${artifact.title || artifact.type}`,
    '',
    `Status: ${artifact.status}`,
    `Window: ${artifact.windowHours}h`,
    `Generated: ${artifact.generatedAt}`,
    '',
    `Summary: ${artifact.summary}`,
    '',
    `Decision: ${artifact.decision.label}`,
    '',
    artifact.decision.rationale,
    '',
    'Next actions:',
  ];
  for (const action of artifact.decision.nextActions || []) {
    lines.push(`- ${action}`);
  }
  for (const section of artifact.sections || []) {
    lines.push('', `## ${section.title}`);
    for (const bullet of section.bullets || []) {
      lines.push(`- ${bullet}`);
    }
  }
  if (Array.isArray(artifact.evidence) && artifact.evidence.length > 0) {
    lines.push('', '## Evidence');
    for (const item of artifact.evidence) {
      lines.push(`- ${item.label}: ${item.value}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  ARTIFACT_TYPES,
  DEFAULT_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
  buildPrPulseArtifact,
  buildReliabilityPulseArtifact,
  buildRevenuePulseArtifact,
  buildReleaseReadinessArtifact,
  formatArtifactMarkdown,
  generateOperatorArtifact,
  normalizeArtifactType,
  normalizeWindowHours,
};

function isDirectCli() {
  return Boolean(process.argv[1] && path.resolve(process.argv[1]) === __filename);
}

if (isDirectCli()) {
  const args = process.argv.slice(2);
  const typeArg = args.find((arg) => arg.startsWith('--type='));
  const windowArg = args.find((arg) => arg.startsWith('--window-hours='));
  const format = args.includes('--markdown') ? 'markdown' : 'json';
  generateOperatorArtifact({
    type: typeArg ? typeArg.slice('--type='.length) : args.find((arg) => !arg.startsWith('--')),
    windowHours: windowArg ? windowArg.slice('--window-hours='.length) : undefined,
  }).then((artifact) => {
    if (format === 'markdown') {
      process.stdout.write(formatArtifactMarkdown(artifact));
      return;
    }
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  }).catch((err) => {
    console.error(getErrorMessage(err));
    process.exit(1);
  });
}
