#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { ensureParentDir, readJsonl } = require('./fs-utils');
const { buildLeadFromRevenueTarget, getSalesPipelinePath, loadSalesLeads } = require('./sales-pipeline');

const DEFAULT_QUEUE_PATH = path.join(__dirname, '..', 'docs', 'marketing', 'gtm-target-queue.jsonl');
const DEFAULT_REPORT_PATH = path.join(__dirname, '..', 'docs', 'marketing', 'gtm-revenue-loop.json');
const DEFAULT_DOCS_PATH = path.join(__dirname, '..', 'docs', 'OUTREACH_TARGETS.md');
const DEFAULT_CORE_LINKS = {
  sprint: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  guide: 'https://thumbgate-production.up.railway.app/guide',
  proof: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md',
  truth: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md',
};
const DEFAULT_OUTREACH_QUEUE_BASENAME = 'OUTREACH_TARGETS';
const FOLLOW_UP_STAGES = new Set([
  'contacted',
  'replied',
  'call_booked',
  'checkout_started',
  'sprint_intake',
]);
const TERMINAL_STAGES = new Set(['paid', 'lost']);
const FOLLOW_UP_PRIORITY = {
  sprint_intake: 5,
  checkout_started: 4,
  call_booked: 3,
  replied: 2,
  contacted: 1,
};
const TARGETED_STAGE = 'targeted';
const SELF_SERVE_MOTIONS = new Set(['pro']);
const SELF_SERVE_OFFERS = new Set(['pro_self_serve']);

function normalizeText(value, maxLength = 4000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

function normalizeUrl(value) {
  const normalized = normalizeText(value, 4096);
  if (!normalized) return '';
  return /^https?:\/\//i.test(normalized) ? normalized : '';
}

function dedupeContactSurfaces(surfaces = []) {
  const seen = new Set();
  const deduped = [];

  for (const surface of Array.isArray(surfaces) ? surfaces : []) {
    const label = normalizeText(surface?.label || 'Contact');
    const url = normalizeUrl(surface?.url);
    if (!url) {
      continue;
    }

    const key = `${label.toLowerCase()}::${url.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({ label, url });
  }

  return deduped;
}

function getContactSurfaces(target = {}) {
  const surfaces = dedupeContactSurfaces(target.contactSurfaces);
  if (surfaces.length > 0) {
    return surfaces;
  }

  const fallbackUrl = normalizeUrl(target.contactUrl);
  if (!fallbackUrl) {
    return [];
  }

  const fallbackRoute = inferContactRoute(target, {
    label: normalizeText(target.channel || target.source || 'Contact') || 'Contact',
    url: fallbackUrl,
  });

  return [{
    label: humanizeContactRoute(fallbackRoute),
    url: fallbackUrl,
  }];
}

function scoreContactSurface(target = {}, surface = {}) {
  const source = normalizeText(target.source).toLowerCase();
  const channel = normalizeText(target.channel).toLowerCase();
  const label = normalizeText(surface.label).toLowerCase();
  const url = normalizeUrl(surface.url).toLowerCase();

  if (source === 'reddit' || channel === 'reddit_dm') {
    if (/reddit/.test(url)) return 100;
  }

  if (source === 'github') {
    if (label === 'website') return 100;
    if (label === 'github profile') return 90;
    if (label === 'repository') return 80;
  }

  if (channel.includes('linkedin')) return 100;
  if (channel.includes('manual')) return 70;
  return 50;
}

function getPrimaryContactSurface(target = {}) {
  const surfaces = getContactSurfaces(target);
  if (surfaces.length === 0) {
    return null;
  }

  return [...surfaces].sort((left, right) => {
    return scoreContactSurface(target, right) - scoreContactSurface(target, left);
  })[0];
}

function inferContactRoute(target = {}, surface = null) {
  const source = normalizeText(target.source).toLowerCase();
  const channel = normalizeText(target.channel).toLowerCase();
  const label = normalizeText(surface?.label).toLowerCase();
  const url = normalizeUrl(surface?.url).toLowerCase();

  if (source === 'reddit' || channel === 'reddit_dm' || /reddit/.test(url)) {
    return 'reddit_dm';
  }

  if (channel.includes('linkedin')) {
    return 'linkedin';
  }

  if (label === 'website') {
    return 'website';
  }

  if (label === 'github profile' || /github\.com\/[^/]+\/?$/.test(url)) {
    return 'github_profile';
  }

  if (label === 'repository' || /github\.com\/[^/]+\/[^/]+/.test(url)) {
    return 'repository';
  }

  return channel || source || 'manual';
}

function humanizeContactRoute(route) {
  switch (normalizeText(route).toLowerCase()) {
    case 'reddit_dm':
      return 'Reddit DM';
    case 'linkedin':
      return 'LinkedIn';
    case 'website':
      return 'Website';
    case 'github_profile':
      return 'GitHub profile';
    case 'repository':
      return 'Repository';
    default:
      return normalizeText(route) || 'Manual';
  }
}

function renderContactSurfaces(surfaces = [], { excludeUrl = '' } = {}) {
  const excluded = normalizeUrl(excludeUrl).toLowerCase();
  const rendered = dedupeContactSurfaces(surfaces)
    .filter((surface) => normalizeUrl(surface.url).toLowerCase() !== excluded)
    .map((surface) => `${surface.label}: ${surface.url}`);

  return rendered.length ? rendered.join('; ') : 'n/a';
}

function getLaneName(target = {}) {
  const stage = normalizeText(target.stage);
  const temperature = normalizeText(target.temperature).toLowerCase();
  const source = normalizeText(target.source).toLowerCase();

  if (FOLLOW_UP_STAGES.has(stage)) return 'follow_up';
  if (stage === TARGETED_STAGE && temperature === 'warm') return 'warm_discovery';
  if (stage === TARGETED_STAGE && temperature !== 'warm' && source === 'github' && isSelfServeTarget(target)) {
    return 'self_serve_close';
  }
  if (stage === TARGETED_STAGE && temperature !== 'warm' && source === 'github') return 'cold_github';
  return 'targeted';
}

function csvEscape(value) {
  const normalized = normalizeText(value, 20000);
  if (!/[",\n]/.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

function deriveOutreachArtifactPaths(outPath = DEFAULT_DOCS_PATH) {
  const resolved = path.resolve(outPath || DEFAULT_DOCS_PATH);
  const dir = path.dirname(resolved);
  const ext = path.extname(resolved) || '.md';
  const basename = path.basename(resolved, ext) || DEFAULT_OUTREACH_QUEUE_BASENAME;

  return {
    markdownPath: resolved,
    csvPath: path.join(dir, `${basename}.csv`),
    jsonPath: path.join(dir, `${basename}.json`),
  };
}

function readJsonObject(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function loadQueue(queuePath = DEFAULT_QUEUE_PATH) {
  return readJsonl(queuePath)
    .filter((entry) => entry && typeof entry === 'object');
}

function buildPipelineIndex(options = {}) {
  const leads = loadSalesLeads(options);
  return new Map(leads.map((lead) => [lead.leadId, lead]));
}

function toStagePriority(stage) {
  return FOLLOW_UP_PRIORITY[normalizeText(stage)] || 0;
}

function isSelfServeTarget(target = {}) {
  const motion = normalizeText(target.motion).toLowerCase();
  const offer = normalizeText(target.offer).toLowerCase();
  return SELF_SERVE_MOTIONS.has(motion) || SELF_SERVE_OFFERS.has(offer);
}

function compareTargetPriority(left, right) {
  const leftFollowUp = toStagePriority(left.stage);
  const rightFollowUp = toStagePriority(right.stage);
  if (leftFollowUp !== rightFollowUp) {
    return rightFollowUp - leftFollowUp;
  }

  const leftScore = Number(left.evidenceScore || 0);
  const rightScore = Number(right.evidenceScore || 0);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  return normalizeText(left.username).localeCompare(normalizeText(right.username));
}

function buildTargetSummary(target = {}) {
  const username = normalizeText(target.username);
  const accountName = normalizeText(target.accountName);
  const repo = normalizeText(target.repoName);
  if (repo) {
    const owner = username || accountName || 'Unknown target';
    return `${owner} — ${repo}`;
  }
  if (username && accountName && accountName !== username) {
    return `${username} — ${accountName}`;
  }
  return username || accountName || 'Unknown target';
}

function getNextTrackingCommand(target = {}) {
  const commands = target.salesCommands || {};
  switch (normalizeText(target.stage)) {
    case TARGETED_STAGE:
      return commands.markContacted || '';
    case 'contacted':
      return commands.markReplied || '';
    case 'replied':
      return commands.markCallBooked || '';
    case 'call_booked':
      return commands.markCheckoutStarted || commands.markSprintIntake || '';
    case 'checkout_started':
      return commands.markSprintIntake || '';
    default:
      return '';
  }
}

function enrichTarget(target = {}, pipelineIndex = new Map(), queuePath = DEFAULT_QUEUE_PATH) {
  const lead = buildLeadFromRevenueTarget(target, { sourcePath: queuePath });
  const pipelineLead = pipelineIndex.get(lead.leadId);
  const stage = normalizeText(pipelineLead?.stage || target.pipelineStage || lead.stage || TARGETED_STAGE);
  const evidence = Array.isArray(target.evidence) ? target.evidence : [];
  const contactSurfaces = getContactSurfaces(target);
  const primaryContactSurface = getPrimaryContactSurface({
    ...target,
    contactSurfaces,
  });
  const contactRoute = inferContactRoute(target, primaryContactSurface);

  return {
    ...target,
    leadId: lead.leadId,
    stage: TERMINAL_STAGES.has(stage) ? stage : (stage || TARGETED_STAGE),
    queuePath,
    pipelineUpdatedAt: normalizeText(pipelineLead?.updatedAt || target.pipelineUpdatedAt || ''),
    nextTrackingCommand: getNextTrackingCommand({
      ...target,
      stage,
    }),
    summary: buildTargetSummary(target),
    contactSurface: normalizeText(primaryContactSurface?.url || target.contactUrl || lead.contact?.url || ''),
    contactSurfaces,
    primaryContactSurface,
    contactRoute,
    contactRouteLabel: humanizeContactRoute(contactRoute),
    backupContactSurfaces: contactSurfaces.filter((surface) => surface.url !== primaryContactSurface?.url),
    evidenceScore: Number(target.evidenceScore || 0),
    evidence,
  };
}

function buildOutreachTargetsReport({
  queuePath = DEFAULT_QUEUE_PATH,
  reportPath = DEFAULT_REPORT_PATH,
  statePath = null,
} = {}) {
  const revenueLoopReport = readJsonObject(reportPath);
  const pipelinePath = getSalesPipelinePath(statePath ? { statePath } : {});
  const pipelineExists = fs.existsSync(pipelinePath);
  const pipelineIndex = buildPipelineIndex(statePath ? { statePath } : {});
  const targets = loadQueue(queuePath)
    .map((target) => enrichTarget(target, pipelineIndex, queuePath))
    .filter((target) => !TERMINAL_STAGES.has(target.stage))
    .sort(compareTargetPriority);
  const followUpTargets = targets.filter((target) => FOLLOW_UP_STAGES.has(target.stage));
  const warmTargets = targets.filter((target) => target.stage === TARGETED_STAGE && normalizeText(target.temperature) === 'warm');
  const selfServeTargets = targets.filter((target) => {
    return target.stage === TARGETED_STAGE
      && normalizeText(target.temperature) !== 'warm'
      && normalizeText(target.source) === 'github'
      && isSelfServeTarget(target);
  });
  const coldTargets = targets.filter((target) => {
    return target.stage === TARGETED_STAGE
      && normalizeText(target.temperature) !== 'warm'
      && normalizeText(target.source) === 'github'
      && !isSelfServeTarget(target);
  });

  return {
    generatedAt: normalizeText(revenueLoopReport.generatedAt) || new Date().toISOString(),
    state: normalizeText(revenueLoopReport.directive?.state) || 'cold-start',
    headline: normalizeText(revenueLoopReport.directive?.headline) || 'No verified revenue and no active pipeline.',
    queuePath,
    reportPath,
    pipelinePath,
    pipelineTrackedLeadCount: pipelineIndex.size,
    pipelineExists,
    proofRule: 'Use proof links only after the buyer confirms the workflow pain.',
    qualificationRules: [
      'One workflow with business value.',
      'One buyer or champion who owns the rollout.',
      'One repeated failure pattern or rollout blocker that is expensive to repeat.',
    ],
    coreLinks: {
      sprint: normalizeText(revenueLoopReport.currentTruth?.teamPilotCta || DEFAULT_CORE_LINKS.sprint),
      guide: normalizeText(revenueLoopReport.currentTruth?.guideLink || DEFAULT_CORE_LINKS.guide),
      proof: normalizeText(revenueLoopReport.currentTruth?.verificationEvidenceLink || DEFAULT_CORE_LINKS.proof),
      truth: normalizeText(revenueLoopReport.currentTruth?.commercialTruthLink || DEFAULT_CORE_LINKS.truth),
    },
    followUpTargets,
    warmTargets,
    selfServeTargets,
    coldTargets,
    totalTargets: targets.length,
  };
}

function renderTargetMarkdown(target = {}, index = 0) {
  const lines = [
    `### ${index + 1}. ${target.summary}`,
    `- Temperature: ${normalizeText(target.temperature) || 'cold'}`,
    `- Current stage: ${target.stage || TARGETED_STAGE}`,
    `- Preferred route: ${target.contactRouteLabel || 'Manual'}`,
    `- Contact surface: ${target.contactSurface || 'n/a'}`,
    `- Backup surfaces: ${renderContactSurfaces(target.backupContactSurfaces)}`,
    `- Evidence score: ${Number(target.evidenceScore || 0)}`,
    `- Evidence: ${target.evidence.length ? target.evidence.join(', ') : 'n/a'}`,
    `- Why now: ${normalizeText(target.motionReason || target.nextOperatorAction || 'Use the current queue row before widening the search.')}`,
    `- CTA: ${normalizeText(target.cta || DEFAULT_CORE_LINKS.sprint)}`,
  ];

  if (target.firstTouchDraft) {
    lines.push('', 'First-touch draft:', `> ${target.firstTouchDraft}`);
  }

  if (target.painConfirmedFollowUpDraft) {
    lines.push('', 'Pain-confirmed follow-up:', `> ${target.painConfirmedFollowUpDraft}`);
  }

  if (target.nextTrackingCommand) {
    lines.push('', `Track next step: \`${target.nextTrackingCommand}\``);
  }

  return [...lines, ''];
}

function buildOperatorQueueRows(report = {}) {
  const orderedTargets = [
    ...(Array.isArray(report.followUpTargets) ? report.followUpTargets : []),
    ...(Array.isArray(report.warmTargets) ? report.warmTargets : []),
    ...(Array.isArray(report.selfServeTargets) ? report.selfServeTargets : []),
    ...(Array.isArray(report.coldTargets) ? report.coldTargets : []),
  ];

  return orderedTargets.map((target) => {
    return {
      lane: getLaneName(target),
      summary: normalizeText(target.summary),
      temperature: normalizeText(target.temperature),
      source: normalizeText(target.source),
      channel: normalizeText(target.channel),
      stage: normalizeText(target.stage),
      username: normalizeText(target.username),
      accountName: normalizeText(target.accountName),
      repoName: normalizeText(target.repoName),
      repoUrl: normalizeText(target.repoUrl),
      company: normalizeText(target.company),
      evidenceScore: String(Number(target.evidenceScore || 0)),
      preferredRoute: normalizeText(target.contactRoute),
      preferredRouteLabel: normalizeText(target.contactRouteLabel),
      preferredContactUrl: normalizeText(target.contactSurface),
      backupContactSurfaces: renderContactSurfaces(target.backupContactSurfaces),
      allContactSurfaces: renderContactSurfaces(target.contactSurfaces),
      motion: normalizeText(target.motion),
      offer: normalizeText(target.offer),
      cta: normalizeText(target.cta),
      nextTrackingCommand: normalizeText(target.nextTrackingCommand),
      evidence: Array.isArray(target.evidence) ? target.evidence.join('; ') : '',
      firstTouchDraft: normalizeText(target.firstTouchDraft),
      painConfirmedFollowUpDraft: normalizeText(target.painConfirmedFollowUpDraft),
    };
  });
}

function renderOperatorQueueCsv(rows = []) {
  const headers = [
    'lane',
    'summary',
    'temperature',
    'source',
    'channel',
    'stage',
    'username',
    'accountName',
    'repoName',
    'repoUrl',
    'company',
    'evidenceScore',
    'preferredRoute',
    'preferredRouteLabel',
    'preferredContactUrl',
    'backupContactSurfaces',
    'allContactSurfaces',
    'motion',
    'offer',
    'cta',
    'nextTrackingCommand',
    'evidence',
    'firstTouchDraft',
    'painConfirmedFollowUpDraft',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] || '')).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

function renderOutreachTargetsMarkdown(report = {}) {
  const followUpLines = report.followUpTargets.length
    ? report.followUpTargets.flatMap((target, index) => renderTargetMarkdown(target, index))
    : ['- No in-flight follow-ups are currently tracked.', ''];
  const warmLines = report.warmTargets.length
    ? report.warmTargets.flatMap((target, index) => renderTargetMarkdown(target, index))
    : ['- No warm discovery targets are currently ready.', ''];
  const selfServeLines = report.selfServeTargets.length
    ? report.selfServeTargets.flatMap((target, index) => renderTargetMarkdown(target, index))
    : ['- No self-serve close targets are currently ready.', ''];
  const coldLines = report.coldTargets.length
    ? report.coldTargets.flatMap((target, index) => renderTargetMarkdown(target, index))
    : ['- No cold GitHub targets are currently ready.', ''];

  return [
    '# Revenue Pipeline Outreach Targets',
    '',
    'Status: current',
    `Updated: ${report.generatedAt}`,
    '',
    'This file mirrors the evidence-backed GTM queue in `docs/marketing/gtm-target-queue.jsonl`.',
    'It is the qualification screen and send surface for the current Workflow Hardening Sprint revenue loop, not a raw GitHub scrape.',
    '',
    '## Current Queue',
    `- Revenue state: ${report.state || 'cold-start'}`,
    `- Headline: ${report.headline || 'No verified revenue and no active pipeline.'}`,
    `- Follow-ups now: ${report.followUpTargets.length}`,
    `- Warm discovery ready: ${report.warmTargets.length}`,
    `- Self-serve closes ready: ${report.selfServeTargets.length}`,
    `- Cold GitHub ready: ${report.coldTargets.length}`,
    `- Sales ledger tracked leads: ${report.pipelineTrackedLeadCount || 0}${report.pipelineExists ? '' : ' (pipeline file not created yet)'}`,
    `- Proof rule: ${report.proofRule}`,
    '',
    '## Qualification Rules',
    ...report.qualificationRules.map((rule, index) => `${index + 1}. ${rule}`),
    '',
    '## Follow Up Now',
    ...followUpLines,
    '## Warm Discovery',
    ...warmLines,
    '## Self-Serve Closes',
    ...selfServeLines,
    '## Cold GitHub',
    ...coldLines,
    '## Core Links',
    `- Sprint intake: ${report.coreLinks?.sprint || DEFAULT_CORE_LINKS.sprint}`,
    `- Proof-backed setup guide: ${report.coreLinks?.guide || DEFAULT_CORE_LINKS.guide}`,
    `- Commercial truth: ${report.coreLinks?.truth || DEFAULT_CORE_LINKS.truth}`,
    `- Verification evidence: ${report.coreLinks?.proof || DEFAULT_CORE_LINKS.proof}`,
    '',
  ].join('\n');
}

function writeOutreachTargetsArtifacts({
  markdown,
  report,
  outPath = DEFAULT_DOCS_PATH,
} = {}) {
  const paths = deriveOutreachArtifactPaths(outPath);
  const operatorQueueRows = buildOperatorQueueRows(report);
  const operatorQueueCsv = renderOperatorQueueCsv(operatorQueueRows);
  const operatorQueueJson = `${JSON.stringify({
    generatedAt: normalizeText(report?.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.state),
    headline: normalizeText(report?.headline),
    rows: operatorQueueRows,
  }, null, 2)}\n`;

  ensureParentDir(paths.markdownPath);
  fs.writeFileSync(paths.markdownPath, markdown, 'utf8');
  fs.writeFileSync(paths.csvPath, operatorQueueCsv, 'utf8');
  fs.writeFileSync(paths.jsonPath, operatorQueueJson, 'utf8');

  return paths;
}

function isCliInvocation(argv = process.argv) {
  const scriptPath = argv[1];
  if (!scriptPath) return false;
  return path.resolve(scriptPath) === path.resolve(__filename);
}

function main(options = {}) {
  const report = buildOutreachTargetsReport(options);
  const markdown = renderOutreachTargetsMarkdown(report);
  const written = writeOutreachTargetsArtifacts({
    markdown,
    report,
    outPath: options.outPath || DEFAULT_DOCS_PATH,
  });
  console.log(`Updated ${written.markdownPath} from the current evidence-backed queue.`);
  console.log(
    `Warm: ${report.warmTargets.length} | Self-serve: ${report.selfServeTargets.length} | Cold: ${report.coldTargets.length} | Follow-up: ${report.followUpTargets.length}`
  );
  return {
    docsPath: written.markdownPath,
    csvPath: written.csvPath,
    jsonPath: written.jsonPath,
    report,
  };
}

if (isCliInvocation(process.argv)) {
  try {
    main();
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_DOCS_PATH,
  DEFAULT_QUEUE_PATH,
  DEFAULT_REPORT_PATH,
  buildOutreachTargetsReport,
  buildOperatorQueueRows,
  deriveOutreachArtifactPaths,
  getPrimaryContactSurface,
  inferContactRoute,
  isCliInvocation,
  main,
  renderOperatorQueueCsv,
  renderOutreachTargetsMarkdown,
  writeOutreachTargetsArtifacts,
};
