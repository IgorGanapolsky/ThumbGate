#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { resolveHostedBillingConfig } = require('./hosted-config');
const { getOperationalBillingSummary } = require('./operational-summary');
const { generateRevenueStatusReport } = require('./revenue-status');
const { ensureDir } = require('./fs-utils');
const { buildLeadFromRevenueTarget, loadSalesLeads } = require('./sales-pipeline');
const { getWarmOutboundTargets } = require('./warm-outreach-targets');

const GITHUB_API_BASE_URL = 'https://api.github.com/';
const COMMERCIAL_TRUTH_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md';
const VERIFICATION_EVIDENCE_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';
const TARGET_SEARCH_QUERIES = [
  'search/repositories?q=Model+Context+Protocol+workflow+automation+sort:updated',
  'search/repositories?q=Model+Context+Protocol+approval+workflow+sort:updated',
  'search/repositories?q=ServiceNow+MCP+workflow+sort:updated',
  'search/repositories?q=Claude+Code+review+automation+sort:updated',
  'search/repositories?q=GitLab+review+automation+agent+sort:updated',
  'search/repositories?q=github+review+automation+agent+sort:updated',
  'search/repositories?q=review+workflow+automation+agent+sort:updated',
  'search/repositories?q=approval+workflow+github+agent+sort:updated',
  'search/repositories?q=incident+workflow+automation+agent+sort:updated',
  'search/repositories?q=jira+approval+workflow+agent+sort:updated',
  'search/repositories?q=Claude+Code+hooks+stars:>=3+sort:updated',
  'search/repositories?q=Claude+Code+plugin+stars:>=3+sort:updated',
  'search/repositories?q=Codex+plugin+stars:>=3+sort:updated',
  'search/repositories?q=OpenCode+plugin+stars:>=3+sort:updated',
  'search/repositories?q=MCP+plugin+setup+stars:>=3+sort:updated',
  'search/repositories?q=Cursor+rules+stars:>=3+sort:updated',
];
const SELF_SERVE_ONLY_SIGNALS = /\b(awesome|list|example|template|demo|tutorial|course|personal|dotfiles|toy|boilerplate|learn|learning|playground|starter|sample|sandbox|quickstart|lab)\b/;
const LOW_BUYER_INTENT_SIGNALS = /\b(learn|learning|tutorial|course|playground|starter|sample|sandbox|quickstart|boilerplate|template|demo|example|lab|portfolio|showcase|case study)\b/;
const SELF_SERVE_TOOLING_SIGNALS = /\b(plugin|plugins|extension|extensions|hook|hooks|statusline|status line|config|profile|installer|install|setup|rule pack|ruleset|local-first|local first|workspace rules)\b/;
const MAX_CREDIBLE_DESCRIPTION_LENGTH = 500;
const SUSPICIOUS_REPO_DESCRIPTION_PATTERNS = [
  /^\s*skip to content\b/i,
  /\bshowing \d+ changed files\b/i,
  /\bbinary file not shown\b/i,
  /\bdiff not rendered\b/i,
  /\b\.github\/workflows\//i,
  /@@ -\d+,\d+ \+\d+,\d+ @@/,
];
const TARGET_SIGNAL_RULES = [
  {
    label: 'workflow control surface',
    pattern: /\b(workflow|approval|review|handoff|governance|gate|guardrail|policy|audit|proof)\b/,
    weight: 4,
  },
  {
    label: 'production or platform workflow',
    pattern: /\b(production|platform|deploy|deployment|incident|sre|ci|cd|release|security|compliance)\b/,
    weight: 4,
  },
  {
    label: 'business-system integration',
    pattern: /\b(jira|github|gitlab|microsoft ?365|office|google drive|calendar|slack|salesforce|crm|analytics)\b/,
    weight: 3,
  },
  {
    label: 'agent infrastructure',
    pattern: /\b(mcp|model context protocol|agent|automation|memory|context|tool use|orchestrator)\b/,
    weight: 2,
  },
  {
    label: 'self-serve agent tooling',
    pattern: SELF_SERVE_TOOLING_SIGNALS,
    weight: 2,
  },
];
const MARKETPLACE_SIGNAL_THEMES = [
  {
    key: 'warm_discovery',
    label: 'Warm discovery workflows',
    summary: 'Warm inbound engagers already named rollback risk, brittle guardrails, or review-boundary pain.',
    listingAngle: 'Lead with one repeated workflow failure and a founder-led diagnostic before any generic tool pitch.',
    match: (target) => normalizeText(target.temperature).toLowerCase() === 'warm',
  },
  {
    key: 'business_system_workflows',
    label: 'Business-system workflow approvals',
    summary: 'Targets wiring agents into Jira, GitHub, ServiceNow, Slack, or CRM systems need approval boundaries, rollback safety, and proof.',
    listingAngle: 'Lead with approval boundaries, rollback safety, and proof for one workflow.',
    match: (target) => hasEvidenceLabel(target, 'business-system integration'),
  },
  {
    key: 'production_rollout',
    label: 'Production rollout proof',
    summary: 'Platform and production workflows need proof before agents touch releases, incidents, or compliance-sensitive systems.',
    listingAngle: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
    match: (target) => hasEvidenceLabel(target, 'production or platform workflow'),
  },
  {
    key: 'workflow_control',
    label: 'Workflow control surfaces',
    summary: 'The strongest cold targets expose workflow control surfaces where repeated failures and bad handoffs are visible and expensive.',
    listingAngle: 'Lead with one repeated workflow failure, then show how ThumbGate turns it into an enforceable pre-action gate.',
    match: (target) => hasEvidenceLabel(target, 'workflow control surface'),
  },
  {
    key: 'self_serve_tooling',
    label: 'Self-serve agent tooling',
    summary: 'Some buyers are closer to local hook, plugin, and config adoption than a services sprint, so the guide-to-Pro lane should stay visible.',
    listingAngle: 'Lead with the proof-backed setup guide first, then convert proven local usage into Pro.',
    match: (target) => hasEvidenceLabel(target, 'self-serve agent tooling'),
  },
];
const MARKETPLACE_VARIANT_TEMPLATES = {
  warm_discovery: {
    audience: 'Warm buyers who already named a repeated workflow failure.',
    headline: 'Turn one repeated AI-agent workflow failure into a proof-backed sprint.',
    shortDescription: 'Lead with one concrete workflow failure, then offer a founder-led hardening diagnostic before any generic tool pitch.',
    primaryMotion: 'sprint',
    secondaryMotion: 'guide',
  },
  business_system_workflows: {
    audience: 'Teams wiring agents into approval-heavy business systems.',
    headline: 'Add approval boundaries and rollback safety to one agent workflow.',
    shortDescription: 'Lead with one workflow in Jira, GitHub, ServiceNow, Slack, or CRM systems that needs proof before wider rollout.',
    primaryMotion: 'sprint',
    secondaryMotion: 'guide',
  },
  production_rollout: {
    audience: 'Platform teams protecting production, release, incident, or compliance workflows.',
    headline: 'Prove one production agent workflow is safe before the next rollout.',
    shortDescription: 'Lead with one production workflow where repeated mistakes, rollback risk, or audit pressure already make the pain expensive.',
    primaryMotion: 'sprint',
    secondaryMotion: 'guide',
  },
  workflow_control: {
    audience: 'Operators with visible workflow-control surfaces and repeated handoff failures.',
    headline: 'Harden one workflow control surface before the next agent rollout.',
    shortDescription: 'Lead with one repeated approval, review, or handoff failure and show how ThumbGate turns it into an enforceable pre-action gate.',
    primaryMotion: 'sprint',
    secondaryMotion: 'guide',
  },
  self_serve_tooling: {
    audience: 'Plugin, hook, and local-rule buyers who want the fastest self-serve proof path first.',
    headline: 'Block repeated agent mistakes before the next install or config rollout.',
    shortDescription: 'Lead with the proof-backed setup guide first, then route install-intent buyers to Pro after one blocked repeat or explicit self-serve intent.',
    primaryMotion: 'guide',
    secondaryMotion: 'pro',
  },
};
const CLAIM_GUARDRAILS = [
  'Do not claim revenue, installs, or marketplace approval without direct command evidence.',
  'Do not lead with proof links before the buyer confirms pain.',
  'Keep public pricing and traction claims aligned with COMMERCIAL_TRUTH.md.',
  'Keep proof and quality claims aligned with VERIFICATION_EVIDENCE.md.',
];
const OFFER_SPLIT_RULE = 'Use Pro after one blocked repeat or explicit self-serve install intent. Use the Workflow Hardening Sprint when one workflow owner needs approval boundaries, rollback safety, and proof before wider rollout.';
const TERMINAL_PIPELINE_STAGES = new Set(['paid', 'lost']);
const PIPELINE_STAGE_PRIORITY = {
  sprint_intake: 6,
  checkout_started: 5,
  call_booked: 4,
  replied: 3,
  contacted: 2,
  targeted: 1,
};

function getGoogleGenAI() {
  try {
    return require('@google/genai').GoogleGenAI;
  } catch {
    return null;
  }
}

function readInlineOption(arg, name) {
  const prefix = `${name}=`;
  return arg.startsWith(prefix) ? arg.slice(prefix.length).trim() : null;
}

function readFollowingOption(argv, index) {
  const nextArg = argv[index + 1];
  if (!nextArg || nextArg.startsWith('--')) {
    return { value: null, index };
  }
  return { value: String(nextArg).trim(), index: index + 1 };
}

function applyInlineOption(options, arg) {
  const reportDir = readInlineOption(arg, '--report-dir');
  if (reportDir !== null) {
    options.reportDir = reportDir;
    return true;
  }

  const maxTargets = readInlineOption(arg, '--max-targets');
  if (maxTargets !== null) {
    options.maxTargets = clampTargetCount(maxTargets);
    return true;
  }

  return false;
}

const NAMED_OPTION_HANDLERS = {
  '--write-docs': (options, _argv, index) => {
    options.writeDocs = true;
    return index;
  },
  '--report-dir': (options, argv, index) => {
    const parsed = readFollowingOption(argv, index);
    options.reportDir = parsed.value || options.reportDir;
    return parsed.index;
  },
  '--max-targets': (options, argv, index) => {
    const parsed = readFollowingOption(argv, index);
    options.maxTargets = parsed.value ? clampTargetCount(parsed.value) : options.maxTargets;
    return parsed.index;
  },
};

function applyNamedOption(options, argv, index) {
  const handler = NAMED_OPTION_HANDLERS[argv[index]];
  return handler ? handler(options, argv, index) : null;
}

function parseArgs(argv = []) {
  const options = {
    maxTargets: 6,
    reportDir: '',
    writeDocs: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const namedOptionIndex = applyNamedOption(options, argv, index);
    if (namedOptionIndex !== null) {
      index = namedOptionIndex;
      continue;
    }
    applyInlineOption(options, arg);
  }

  return options;
}

function clampTargetCount(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 6;
  }
  return Math.max(1, Math.min(parsed, 12));
}

function normalizeText(value, maxLength = Number.POSITIVE_INFINITY) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  return Number.isFinite(maxLength)
    ? normalized.slice(0, maxLength)
    : normalized;
}

function hasEvidenceLabel(target, label) {
  const targetLabels = Array.isArray(target?.evidence) ? target.evidence : [];
  const needle = normalizeText(label).toLowerCase();
  return targetLabels.some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function dedupeList(values = []) {
  const seen = new Set();
  const deduped = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function normalizeUrlLikeValue(value) {
  const normalized = normalizeText(value, 2000);
  if (!normalized) return '';
  const looksLikeDomain = /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(normalized);
  const candidate = /^https?:\/\//i.test(normalized)
    ? normalized
    : (normalized.startsWith('www.') || looksLikeDomain)
      ? `https://${normalized}`
      : '';
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function dedupeContactSurfaces(surfaces = []) {
  const seen = new Set();
  const deduped = [];

  for (const surface of surfaces) {
    const label = normalizeText(surface?.label, 120);
    const url = normalizeUrlLikeValue(surface?.url);
    if (!label || !url) continue;
    const key = `${label.toLowerCase()}::${url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ label, url });
  }

  return deduped;
}

function renderContactSurfaces(surfaces = []) {
  const normalized = dedupeContactSurfaces(surfaces);
  if (!normalized.length) {
    return 'n/a';
  }
  return normalized.map((surface) => `${surface.label}: ${surface.url}`).join('; ');
}

function buildClaimGuardrails() {
  return [...CLAIM_GUARDRAILS];
}

function buildEvidenceSources(target, motionCatalog = buildMotionCatalog()) {
  const motionKey = normalizeText(target?.selectedMotion?.key || target?.motion).toLowerCase();
  const motion = motionCatalog[motionKey] || motionCatalog.sprint;
  const sources = [
    {
      label: 'Target signal',
      url: normalizeText(target?.repoUrl) || normalizeText(target?.contactUrl) || '',
      reason: 'Source of the workflow or buyer signal behind this outreach row.',
    },
    {
      label: 'Commercial truth',
      url: normalizeText(motion?.truth),
      reason: 'Current pricing, traction, and offer guardrail.',
    },
    {
      label: 'Verification evidence',
      url: normalizeText(motion?.proof),
      reason: 'Current engineering proof pack and verification artifact.',
    },
  ];

  const seen = new Set();
  return sources.filter((source) => {
    const url = normalizeText(source.url);
    if (!url) return false;
    const key = `${normalizeText(source.label).toLowerCase()}::${url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEvidenceBackstop(currentTruth = {}) {
  return {
    proofLinks: dedupeList([
      currentTruth.commercialTruthLink,
      currentTruth.verificationEvidenceLink,
    ]),
    claimGuardrails: buildClaimGuardrails(),
    sourceRule: 'Every listing, queue row, and pain-confirmed follow-up must inherit these sources before it is treated as operator-ready.',
  };
}

function renderEvidenceSources(sources = []) {
  if (!Array.isArray(sources) || !sources.length) {
    return 'n/a';
  }
  return sources
    .map((source) => `${source.label}: ${source.url}`)
    .join('; ');
}

function normalizePipelineStage(stage) {
  const normalized = normalizeText(stage).toLowerCase();
  return normalized || 'targeted';
}

function buildNextOperatorAction(stage) {
  switch (normalizePipelineStage(stage)) {
    case 'contacted':
      return 'Send the pain-confirmation follow-up and ask for the repeated workflow blocker.';
    case 'replied':
      return 'Convert the reply into a 15-minute diagnostic or sprint intake.';
    case 'call_booked':
      return 'Confirm the diagnostic agenda and capture the exact repeated failure to harden.';
    case 'checkout_started':
      return 'Close the self-serve checkout and keep proof links ready for objections.';
    case 'sprint_intake':
      return 'Review the sprint intake, scope the workflow, and close the paid sprint.';
    default:
      return 'Send the first-touch draft and log the outreach in the sales pipeline.';
  }
}

function quoteShellArg(value) {
  const normalized = normalizeText(value, 4000);
  if (!normalized) {
    return "''";
  }
  return `'${normalized.replace(/'/g, `'\"'\"'`)}'`;
}

function buildTargetPainHypothesis(target = {}) {
  const sanitizePain = (value) => {
    const normalized = normalizeText(value, 240);
    if (!normalized) return null;
    const stripped = normalized.replace(/^Lead with\s+/i, '');
    let end = stripped.length;
    while (end > 0) {
      const char = stripped[end - 1];
      if (char !== '.' && char !== '!' && char !== '?' && !/\s/.test(char)) {
        break;
      }
      end -= 1;
    }
    return stripped.slice(0, end) || null;
  };
  const extractSuffix = (entry, prefix) => {
    const normalized = normalizeText(entry, 400);
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    return lower.startsWith(prefix)
      ? sanitizePain(normalized.slice(prefix.length))
      : null;
  };
  const evidenceEntries = Array.isArray(target.evidence)
    ? target.evidence
    : Array.isArray(target.evidence?.evidence)
      ? target.evidence.evidence
      : [];
  for (const entry of evidenceEntries) {
    const workflowPain = extractSuffix(entry, 'workflow pain named:');
    if (workflowPain) return workflowPain;
    const repeatedFailure = extractSuffix(entry, 'repeated workflow failure:');
    if (repeatedFailure) return repeatedFailure;
  }

  const outreachAngle = normalizeText(target.outreachAngle || target.evidence?.outreachAngle, 240);
  const motionReason = normalizeText(target.motionReason || target.selectedMotion?.reason, 240);
  const motionKey = normalizeText(target.motion || target.selectedMotion?.key).toLowerCase();
  const sanitizedMotionReason = sanitizePain(motionReason);
  const sanitizedOutreachAngle = sanitizePain(outreachAngle);

  if (motionKey === 'pro' && sanitizedOutreachAngle) {
    return sanitizedOutreachAngle;
  }

  return sanitizedMotionReason
    || sanitizedOutreachAngle
    || 'one repeated workflow failure';
}

function buildSalesPipelineCommand(command, args = {}) {
  const parts = ['npm', 'run', 'sales:pipeline', '--', command];
  for (const [key, rawValue] of Object.entries(args)) {
    const value = normalizeText(rawValue, 4000);
    if (!value) continue;
    parts.push(`--${key}`);
    parts.push(quoteShellArg(value));
  }
  return parts.join(' ');
}

function buildTargetSalesCommands(target = {}) {
  const leadId = normalizeText(target.pipelineLeadId) || buildLeadFromRevenueTarget(target).leadId;
  const channel = normalizeText(target.channel) || normalizeText(target.source) || 'manual';
  const pain = buildTargetPainHypothesis(target);
  const motionKey = normalizeText(target.motion) || normalizeText(target.selectedMotion?.key);
  const motionLabel = normalizeText(target.motionLabel) || normalizeText(target.selectedMotion?.label) || 'Workflow Hardening Sprint';
  const commandBase = { lead: leadId, channel };
  const isProMotion = motionKey === 'pro';

  return {
    markContacted: buildSalesPipelineCommand('advance', {
      ...commandBase,
      stage: 'contacted',
      note: isProMotion
        ? `Sent ${motionLabel} self-serve first touch focused on ${pain}.`
        : `Sent ${motionLabel} first touch focused on ${pain}.`,
    }),
    markReplied: buildSalesPipelineCommand('advance', {
      ...commandBase,
      stage: 'replied',
      note: `Buyer confirmed pain around ${pain}.`,
    }),
    markCallBooked: buildSalesPipelineCommand('advance', {
      ...commandBase,
      stage: 'call_booked',
      note: isProMotion
        ? `Booked a 15-minute diagnostic after the self-serve conversation exposed repeated pain around ${pain}.`
        : `Booked a 15-minute workflow hardening diagnostic for ${pain}.`,
    }),
    markCheckoutStarted: buildSalesPipelineCommand('advance', {
      ...commandBase,
      stage: 'checkout_started',
      note: `Buyer started the self-serve checkout after discussing ${pain}.`,
    }),
    markSprintIntake: buildSalesPipelineCommand('advance', {
      ...commandBase,
      stage: 'sprint_intake',
      note: isProMotion
        ? `Buyer escalated from the self-serve lane into Workflow Hardening Sprint intake for ${pain}.`
        : `Buyer moved into Workflow Hardening Sprint intake for ${pain}.`,
    }),
    markPaid: buildSalesPipelineCommand('advance', {
      ...commandBase,
      stage: 'paid',
      note: `Closed ${motionLabel} and booked revenue after resolving ${pain}.`,
    }),
  };
}

function resolveSelectedMotion(target = {}, motionCatalog = buildMotionCatalog()) {
  const motionKey = normalizeText(target.motion) || normalizeText(target.selectedMotion?.key);
  if (motionKey === motionCatalog.pro.key) {
    return {
      key: motionCatalog.pro.key,
      label: normalizeText(target.motionLabel) || motionCatalog.pro.label,
      reason: normalizeText(target.motionReason) || normalizeText(target.selectedMotion?.reason),
    };
  }

  return {
    key: motionCatalog.sprint.key,
    label: normalizeText(target.motionLabel) || motionCatalog.sprint.label,
    reason: normalizeText(target.motionReason) || normalizeText(target.selectedMotion?.reason),
  };
}

function enrichRenderableTarget(target = {}) {
  const motionCatalog = buildMotionCatalog();
  const selectedMotion = resolveSelectedMotion(target, motionCatalog);
  const pipelineLeadId = normalizeText(target.pipelineLeadId) || buildLeadFromRevenueTarget(target).leadId;
  const pipelineStage = normalizePipelineStage(target.pipelineStage);
  return {
    ...target,
    motion: normalizeText(target.motion) || selectedMotion.key,
    motionLabel: normalizeText(target.motionLabel) || selectedMotion.label,
    motionReason: normalizeText(target.motionReason) || selectedMotion.reason,
    selfServeFollowUpDraft: normalizeText(target.selfServeFollowUpDraft)
      || buildSelfServeFollowUp(target, selectedMotion, motionCatalog),
    checkoutCloseDraft: normalizeText(target.checkoutCloseDraft)
      || buildCheckoutCloseDraft(target, selectedMotion, motionCatalog),
    pipelineLeadId,
    pipelineStage,
    nextOperatorAction: normalizeText(target.nextOperatorAction) || buildNextOperatorAction(pipelineStage),
    salesCommands: target.salesCommands || buildTargetSalesCommands({
      ...target,
      motion: normalizeText(target.motion) || selectedMotion.key,
      motionLabel: normalizeText(target.motionLabel) || selectedMotion.label,
      pipelineLeadId,
      pipelineStage,
    }),
  };
}

function applyPipelineStateToTargets(targets = [], { salesStatePath = null } = {}) {
  const leads = loadSalesLeads({ statePath: salesStatePath });
  const leadMap = new Map(leads.map((lead) => [lead.leadId, lead]));

  return targets
    .map((target) => {
      const candidateLead = buildLeadFromRevenueTarget(target);
      const existingLead = leadMap.get(candidateLead.leadId);
      const pipelineStage = normalizePipelineStage(existingLead?.stage || target.pipelineStage);
      const pipelineLeadId = existingLead?.leadId || candidateLead.leadId;

      return {
        ...target,
        pipelineLeadId,
        pipelineStage,
        pipelineUpdatedAt: normalizeText(existingLead?.updatedAt),
        nextOperatorAction: buildNextOperatorAction(pipelineStage),
        salesCommands: buildTargetSalesCommands({
          ...target,
          pipelineLeadId,
          pipelineStage,
        }),
      };
    })
    .filter((target) => !TERMINAL_PIPELINE_STAGES.has(normalizePipelineStage(target.pipelineStage)));
}

function buildRevenueLinks(config = resolveHostedBillingConfig({
  requestOrigin: 'https://thumbgate-production.up.railway.app',
})) {
  const appOrigin = config.appOrigin;
  return {
    appOrigin,
    guideLink: `${appOrigin}/guide`,
    proCheckoutLink: `${appOrigin}/checkout/pro`,
    sprintLink: `${appOrigin}/#workflow-sprint-intake`,
    commercialTruthLink: COMMERCIAL_TRUTH_LINK,
    verificationEvidenceLink: VERIFICATION_EVIDENCE_LINK,
    proPriceLabel: '$19/mo or $149/yr',
    proOfferLabel: 'Pro at $19/mo or $149/yr',
  };
}

function buildMotionCatalog(links = buildRevenueLinks()) {
  return {
    pro: {
      key: 'pro',
      label: links.proOfferLabel,
      audience: 'Solo builders and small teams who need synced memory, gates, and usage analytics without a services engagement.',
      cta: links.proCheckoutLink,
      proof: links.verificationEvidenceLink,
      truth: links.commercialTruthLink,
    },
    sprint: {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      audience: 'Teams with one production workflow, one owner, and one repeated failure pattern blocking rollout.',
      cta: links.sprintLink,
      proof: links.verificationEvidenceLink,
      truth: links.commercialTruthLink,
    },
  };
}

function summarizeCommercialSnapshot(summary = {}) {
  const revenue = summary.revenue || {};
  const trafficMetrics = summary.trafficMetrics || {};
  const signups = summary.signups || {};
  const pipeline = summary.pipeline || {};
  const workflowSprintLeads = pipeline.workflowSprintLeads || {};
  const qualifiedWorkflowSprintLeads = pipeline.qualifiedWorkflowSprintLeads || {};

  return {
    paidOrders: revenue.paidOrders || 0,
    bookedRevenueCents: revenue.bookedRevenueCents || 0,
    checkoutStarts: trafficMetrics.checkoutStarts || 0,
    ctaClicks: trafficMetrics.ctaClicks || 0,
    visitors: trafficMetrics.visitors || 0,
    uniqueLeads: signups.uniqueLeads || 0,
    sprintLeads: workflowSprintLeads.total || 0,
    qualifiedSprintLeads: qualifiedWorkflowSprintLeads.total || 0,
    latestPaidAt: revenue.latestPaidAt || null,
  };
}

function normalizeRevenueWindowSummary(summary = {}) {
  return {
    trafficMetrics: summary.trafficMetrics || {},
    signups: summary.signups || {},
    revenue: summary.revenue || {},
    pipeline: summary.pipeline || {},
    dataQuality: summary.dataQuality || {},
  };
}

function hasRevenueLoopCommercialSignal(summary = {}) {
  const snapshot = summarizeCommercialSnapshot(summary);
  return snapshot.paidOrders > 0
    || snapshot.bookedRevenueCents > 0
    || snapshot.checkoutStarts > 0
    || snapshot.uniqueLeads > 0
    || snapshot.sprintLeads > 0
    || snapshot.qualifiedSprintLeads > 0;
}

function hasRevenueLoopBookedRevenue(summary = {}) {
  const snapshot = summarizeCommercialSnapshot(summary);
  return snapshot.paidOrders > 0 || snapshot.bookedRevenueCents > 0;
}

function selectHostedRevenueWindow(summaries = {}) {
  const candidateOrder = ['today', '30d', 'lifetime'];

  for (const windowName of candidateOrder) {
    const candidate = summaries?.[windowName];
    if (Number(candidate?.status) === 200 && hasRevenueLoopBookedRevenue(candidate)) {
      return {
        window: windowName,
        summary: candidate,
      };
    }
  }

  for (const windowName of candidateOrder) {
    const candidate = summaries?.[windowName];
    if (Number(candidate?.status) === 200 && hasRevenueLoopCommercialSignal(candidate)) {
      return {
        window: windowName,
        summary: candidate,
      };
    }
  }

  for (const windowName of candidateOrder) {
    const candidate = summaries?.[windowName];
    if (Number(candidate?.status) === 200) {
      return {
        window: windowName,
        summary: candidate,
      };
    }
  }

  return {
    window: 'today',
    summary: summaries?.today || {},
  };
}

function isHostedRevenueSource(source = '') {
  return normalizeText(source).toLowerCase().startsWith('hosted');
}

function buildBillingVerification({ source, fallbackReason, snapshot = {} } = {}) {
  const normalizedSource = normalizeText(source);
  const normalizedFallback = normalizeText(fallbackReason);
  const hasHistoricalRevenue = Number(snapshot.paidOrders || 0) > 0
    || Number(snapshot.bookedRevenueCents || 0) > 0;

  if (isHostedRevenueSource(normalizedSource)) {
    return {
      mode: 'live-hosted',
      label: 'Live hosted billing summary verified for this run.',
      source: normalizedSource || 'hosted',
      fallbackReason: normalizedFallback || null,
    };
  }

  if (normalizedSource === 'local-unverified') {
    return {
      mode: 'local-unverified',
      label: 'Hosted billing could not be verified in this run; local fallback is not safe for fresh traction claims.',
      source: normalizedSource,
      fallbackReason: normalizedFallback || null,
    };
  }

  if (hasHistoricalRevenue) {
    return {
      mode: 'historical-local',
      label: 'Historical booked revenue is verified, but the current hosted billing summary was not verified in this run.',
      source: normalizedSource || 'local',
      fallbackReason: normalizedFallback || null,
    };
  }

  if (normalizedFallback) {
    return {
      mode: 'local-fallback',
      label: 'Current run is using local billing context because the hosted billing summary is unavailable.',
      source: normalizedSource || 'local',
      fallbackReason: normalizedFallback,
    };
  }

  return {
    mode: 'local',
    label: 'Current run is using local billing context.',
    source: normalizedSource || 'local',
    fallbackReason: null,
  };
}

async function resolveRevenueLoopSummary(options = {}) {
  const {
    getOperationalBillingSummaryFn = getOperationalBillingSummary,
    generateRevenueStatusReportFn = generateRevenueStatusReport,
    revenueStatusOptions = {},
    hostedStatusRetries = 1,
    hostedRetryDelayMs = 1000,
    waitForRetryFn = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = options;

  const localResult = await getOperationalBillingSummaryFn();
  if (localResult.source === 'hosted') {
    return localResult;
  }

  if (
    localResult.source === 'local' &&
    /hosted operational summary is disabled/i.test(normalizeText(localResult.fallbackReason))
  ) {
    return localResult;
  }

  let hostedFailure = null;
  const retryCount = Math.max(0, Number.parseInt(hostedStatusRetries, 10) || 0);

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const hostedReport = await generateRevenueStatusReportFn(revenueStatusOptions);
      const selectedHostedWindow = selectHostedRevenueWindow(hostedReport?.hostedAudit?.summaries);
      if (hostedReport?.source !== 'local-fallback' && Number(selectedHostedWindow.summary?.status) === 200) {
        return {
          source: hostedReport.source,
          summary: normalizeRevenueWindowSummary(selectedHostedWindow.summary),
          fallbackReason: null,
          hostedStatus: selectedHostedWindow.summary.status,
          summaryWindow: selectedHostedWindow.window,
        };
      }
      hostedFailure = new Error(
        `Hosted revenue summary unavailable: ${normalizeText(hostedReport?.source) || 'unknown source'}`
      );
    } catch (error) {
      hostedFailure = error;
    }

    if (attempt < retryCount) {
      await waitForRetryFn(hostedRetryDelayMs);
    }
  }

  void hostedFailure;
  return localResult;
}

function deriveRevenueDirective(
  summary = {},
  motionCatalog = buildMotionCatalog(),
  verification = { mode: 'live-hosted' }
) {
  const snapshot = summarizeCommercialSnapshot(summary);

  if (snapshot.paidOrders > 0 || snapshot.bookedRevenueCents > 0) {
    const liveHostedRevenue = verification?.mode === 'live-hosted';
    return {
      state: 'post-first-dollar',
      objective: 'Scale the first-10-customers loop with direct workflow hardening and self-serve follow-up.',
      primaryMotion: motionCatalog.sprint.key,
      secondaryMotion: motionCatalog.pro.key,
      headline: liveHostedRevenue
        ? 'Verified booked revenue exists. Keep selling one concrete Workflow Hardening Sprint first, then route self-serve buyers to Pro.'
        : 'Historical booked revenue is verified, but the current hosted billing summary is unavailable in this run. Keep selling one concrete Workflow Hardening Sprint first, then route self-serve buyers to Pro.',
      actions: [
        'Reply to every qualified lead with one offer: "I will harden one AI-agent workflow for you."',
        'Use the proof pack after the buyer names the repeated workflow pain, not as the opener.',
        'Route buyers who only want a tool to the Pro monthly/annual checkout after the pain is qualified.',
        'Publish only booked revenue and paid-order proof from the billing summary or named pilot agreements.',
        ...(!liveHostedRevenue ? [
          'When asked for current live revenue, cite the historical commercial proof and disclose that hosted billing was not verified in this run.',
        ] : []),
      ],
    };
  }

  if (snapshot.checkoutStarts > 0 || snapshot.uniqueLeads > 0 || snapshot.sprintLeads > 0) {
    return {
      state: 'pipeline-active-no-revenue',
      objective: 'Convert existing interest into the first paid orders without inventing traction.',
      primaryMotion: motionCatalog.sprint.key,
      secondaryMotion: motionCatalog.pro.key,
      headline: 'Interest exists but paid conversion is still zero. Sell the Workflow Hardening Sprint first; Pro is self-serve follow-up.',
      actions: [
        'Follow up on every checkout start or lead within one business day with one concrete workflow-hardening offer.',
        'Track every lead as contacted -> replied -> call booked -> checkout or sprint intake -> paid.',
        'Use Commercial Truth and Verification Evidence only after pain is confirmed to reduce buyer risk.',
      ],
    };
  }

  return {
    state: 'cold-start',
    objective: 'Land the first 10 paying customers with founder-led workflow hardening.',
    primaryMotion: motionCatalog.sprint.key,
    secondaryMotion: motionCatalog.pro.key,
    headline: 'No verified revenue and no active pipeline. Stop treating posts as sales; directly sell one Workflow Hardening Sprint.',
    actions: [
      'Directly contact qualified buyers with: "I will harden one AI-agent workflow for you."',
      'Use Pro at $19/mo or $149/yr only as the self-serve follow-up after the buyer asks for the tool path.',
      'Track every lead as contacted -> replied -> call booked -> checkout or sprint intake -> paid.',
      'Treat stars, traffic, and model praise as noise until they become paid orders or named pilot agreements.',
    ],
  };
}

function resolveGitHubApiToken(explicitToken = '', { execFileSyncImpl = execFileSync } = {}) {
  const envToken = normalizeText(
    explicitToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GH_PAT,
    4000
  );
  if (envToken) {
    return envToken;
  }

  if (typeof execFileSyncImpl !== 'function') {
    return '';
  }

  try {
    const ghToken = execFileSyncImpl('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return normalizeText(ghToken, 4000) || '';
  } catch {
    return '';
  }
}

function buildGitHubApiHeaders(token = '') {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'thumbgate-gtm-revenue-loop',
    'x-github-api-version': '2022-11-28',
  };

  const resolvedToken = normalizeText(token, 4000);
  if (resolvedToken) {
    headers.authorization = `Bearer ${resolvedToken}`;
  }

  return headers;
}

async function fetchGitHubJson(endpoint, {
  fetchImpl = globalThis.fetch,
  githubToken = '',
  execFileSyncImpl = execFileSync,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'global fetch is unavailable', data: null };
  }

  const resolvedToken = resolveGitHubApiToken(githubToken, { execFileSyncImpl });
  let response;
  try {
    const requestUrl = new URL(endpoint, GITHUB_API_BASE_URL);
    response = await fetchImpl(requestUrl, {
      headers: buildGitHubApiHeaders(resolvedToken),
    });
  } catch (err) {
    return { ok: false, error: err?.message || String(err), data: null };
  }

  const responseText = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeText(responseText) || `GitHub API request failed with ${response.status}`,
      data: null,
    };
  }

  try {
    return { ok: true, error: '', data: JSON.parse(responseText) };
  } catch (err) {
    return { ok: false, error: err.message, data: null };
  }
}

async function enrichGitHubTarget(target, {
  fetchImpl = globalThis.fetch,
  githubToken = '',
  execFileSyncImpl = execFileSync,
} = {}) {
  const username = normalizeText(target?.username);
  if (!username) {
    return {
      ...target,
      company: normalizeText(target?.company),
      websiteUrl: normalizeUrlLikeValue(target?.websiteUrl),
      contactSurfaces: dedupeContactSurfaces(target?.contactSurfaces),
    };
  }

  const fallbackContactSurfaces = dedupeContactSurfaces([
    ...(Array.isArray(target?.contactSurfaces) ? target.contactSurfaces : []),
    { label: 'GitHub profile', url: target?.contactUrl },
    { label: 'Repository', url: target?.repoUrl },
  ]);
  const response = await fetchGitHubJson(`users/${encodeURIComponent(username)}`, {
    fetchImpl,
    githubToken,
    execFileSyncImpl,
  });
  if (!response.ok) {
    return {
      ...target,
      company: normalizeText(target?.company),
      websiteUrl: normalizeUrlLikeValue(target?.websiteUrl),
      contactSurfaces: fallbackContactSurfaces,
    };
  }

  const profile = response.data || {};
  const websiteUrl = normalizeUrlLikeValue(profile.blog) || normalizeUrlLikeValue(target?.websiteUrl);
  const contactSurfaces = dedupeContactSurfaces([
    websiteUrl ? { label: 'Website', url: websiteUrl } : null,
    { label: 'GitHub profile', url: profile.html_url || target?.contactUrl },
    { label: 'Repository', url: target?.repoUrl },
  ]);

  return {
    ...target,
    company: normalizeText(profile.company || target?.company),
    websiteUrl,
    contactSurfaces,
    contactUrl: websiteUrl || normalizeText(profile.html_url || target?.contactUrl),
  };
}

function dedupeTargets(targets) {
  const seen = new Set();
  const unique = [];

  for (const target of targets) {
    const key = `${target.username}/${target.repoName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }

  return unique;
}

function hasCredibleRepoIdentity(target) {
  const repoName = normalizeText(target.repoName);
  const normalized = repoName.replace(/[^a-z0-9]/gi, '');
  return normalized.length >= 4;
}

function hasCredibleRepoDescription(target) {
  const description = normalizeText(target.description);
  if (!description) return false;
  if (description.length > MAX_CREDIBLE_DESCRIPTION_LENGTH) return false;
  return !SUSPICIOUS_REPO_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description));
}

function hasLowBuyerIntentSignals(target) {
  const haystack = `${normalizeText(target.repoName)} ${normalizeText(target.description)}`.toLowerCase();
  return LOW_BUYER_INTENT_SIGNALS.test(haystack);
}

function hasSelfServeToolingSignals(target) {
  const haystack = `${normalizeText(target.repoName)} ${normalizeText(target.description)}`.toLowerCase();
  return SELF_SERVE_TOOLING_SIGNALS.test(haystack);
}

function isSelfServeToolingProspect(target) {
  if (!hasSelfServeToolingSignals(target)) {
    return false;
  }

  const haystack = `${normalizeText(target.repoName)} ${normalizeText(target.description)}`.toLowerCase();
  return !/\b(jira|gitlab|servicenow|salesforce|slack|crm|calendar|office|google drive|analytics|production|deploy|deployment|incident|sre|release|security|compliance)\b/.test(haystack);
}

function analyzeTargetEvidence(target) {
  const haystack = `${normalizeText(target.repoName)} ${normalizeText(target.description)}`.toLowerCase();
  const evidence = [];
  let score = 0;

  for (const rule of TARGET_SIGNAL_RULES) {
    if (!rule.pattern.test(haystack)) continue;
    score += rule.weight;
    evidence.push(rule.label);
  }

  if (target.stars >= 100) {
    score += 4;
    evidence.push(`${target.stars} GitHub stars`);
  } else if (target.stars >= 25) {
    score += 3;
    evidence.push(`${target.stars} GitHub stars`);
  } else if (target.stars >= 5) {
    score += 2;
    evidence.push(`${target.stars} GitHub stars`);
  }

  const updatedAt = normalizeText(target.updatedAt);
  if (updatedAt) {
    const ageMs = Date.now() - Date.parse(updatedAt);
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      if (ageDays <= 7) {
        score += 2;
        evidence.push('updated in the last 7 days');
      } else if (ageDays <= 30) {
        score += 1;
        evidence.push('updated in the last 30 days');
      }
    }
  }

  if (hasLowBuyerIntentSignals(target)) {
    score = Math.max(0, score - 4);
  }

  let outreachAngle = 'Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.';
  if (/\b(jira|github|gitlab|microsoft ?365|office|google drive|calendar|slack|salesforce|crm|analytics)\b/.test(haystack)) {
    outreachAngle = 'Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.';
  } else if (isSelfServeToolingProspect(target)) {
    outreachAngle = 'Lead with the proof-backed setup guide and local-first enforcement before any team-motion pitch.';
  } else if (/\b(production|platform|deploy|deployment|incident|sre|ci|cd|release|security|compliance)\b/.test(haystack)) {
    outreachAngle = 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.';
  } else if (/\b(memory|context|agent|orchestrator|tool use)\b/.test(haystack)) {
    outreachAngle = 'Lead with context-drift hardening for one workflow before proposing any broader agent platform story.';
  }

  return {
    score,
    evidence: dedupeList(evidence),
    outreachAngle,
  };
}

function diversifyRankedTargets(ranked = [], maxTargets = 6) {
  const targetCount = clampTargetCount(maxTargets);
  const selfServeTargets = ranked.filter(isSelfServeToolingProspect);
  const strongSelfServeTargets = selfServeTargets.filter((target) => (
    Number(target.evidence?.score || 0) >= 8 || Number(target.stars || 0) >= 5
  ));
  const reservedSelfServeSlots = strongSelfServeTargets.length >= 3 && targetCount >= 6
    ? 3
    : Math.min(2, Math.floor(targetCount / 3));
  const coreTargets = ranked.filter((target) => !isSelfServeToolingProspect(target));
  const selected = [];
  const seen = new Set();

  const pushTargets = (targets, limit = targets.length) => {
    for (const target of targets) {
      if (selected.length >= targetCount || limit <= 0) {
        break;
      }
      const key = `${normalizeText(target.username)}/${normalizeText(target.repoName)}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      selected.push(target);
      limit -= 1;
    }
  };

  pushTargets(coreTargets, Math.max(0, targetCount - reservedSelfServeSlots));
  pushTargets(strongSelfServeTargets, reservedSelfServeSlots);
  pushTargets(selfServeTargets, reservedSelfServeSlots);
  pushTargets(ranked, targetCount);
  return selected.slice(0, targetCount);
}

async function prospectTargets(maxTargets = 6, {
  fetchImpl = globalThis.fetch,
  githubToken = '',
  execFileSyncImpl = execFileSync,
} = {}) {
  const combined = [];
  const errors = [];
  for (const endpoint of TARGET_SEARCH_QUERIES) {
    const response = await fetchGitHubJson(endpoint, {
      fetchImpl,
      githubToken,
      execFileSyncImpl,
    });
    if (!response.ok) {
      errors.push(response.error);
      continue;
    }

    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    for (const repo of items.slice(0, maxTargets * 2)) {
      combined.push({
        username: repo.owner?.login || 'unknown',
        accountName: repo.owner?.login || 'unknown',
        contactUrl: repo.owner?.html_url || '',
        repoName: repo.name || 'unknown-repo',
        repoUrl: repo.html_url || '',
        description: normalizeText(repo.description) || 'No description provided.',
        stars: Number(repo.stargazers_count || 0),
        updatedAt: repo.updated_at || null,
      });
    }
  }

  const ranked = dedupeTargets(combined)
    .filter(hasCredibleRepoIdentity)
    .filter(hasCredibleRepoDescription)
    .map((target) => {
      const evidence = analyzeTargetEvidence(target);
      return {
        ...target,
        evidence,
      };
    })
    .filter((target) => {
      if (hasLowBuyerIntentSignals(target)) {
        return target.evidence.score >= 9;
      }
      if (SELF_SERVE_ONLY_SIGNALS.test(`${target.repoName} ${target.description}`.toLowerCase())) {
        return target.evidence.score >= 6;
      }
      if (isSelfServeToolingProspect(target)) {
        return target.evidence.score >= 4;
      }
      return target.evidence.score >= 5;
    })
    .sort((left, right) => {
      if (right.evidence.score !== left.evidence.score) {
        return right.evidence.score - left.evidence.score;
      }
      if (right.stars !== left.stars) {
        return right.stars - left.stars;
      }
      return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
    });

  const topTargets = diversifyRankedTargets(ranked, maxTargets);
  const enrichedTargets = [];
  for (const target of topTargets) {
    enrichedTargets.push(await enrichGitHubTarget(target, {
      fetchImpl,
      githubToken,
      execFileSyncImpl,
    }));
  }

  return {
    targets: enrichedTargets,
    errors,
  };
}

function selectOutreachMotion(target, motionCatalog = buildMotionCatalog()) {
  const haystack = `${normalizeText(target.repoName)} ${normalizeText(target.description)}`.toLowerCase();
  if (SELF_SERVE_ONLY_SIGNALS.test(haystack)) {
    return {
      key: motionCatalog.pro.key,
      label: motionCatalog.pro.label,
      reason: 'Target looks like a self-serve tooling surface, so Pro is the cleaner CTA unless a concrete workflow pain is confirmed.',
    };
  }

  if (isSelfServeToolingProspect(target)) {
    return {
      key: motionCatalog.pro.key,
      label: motionCatalog.pro.label,
      reason: 'Target looks like a local hook, plugin, or config surface, so start with the setup guide and Pro follow-on before pitching a sprint.',
    };
  }

  if ((target.evidence?.score || 0) >= 8) {
    return {
      key: motionCatalog.sprint.key,
      label: motionCatalog.sprint.label,
      reason: target.evidence.outreachAngle,
    };
  }

  return {
    key: motionCatalog.sprint.key,
    label: motionCatalog.sprint.label,
    reason: target.evidence?.outreachAngle
      || 'Target can be approached with one concrete workflow-hardening offer before any generic Pro pitch.',
  };
}

function buildTargetReference(target) {
  const repoName = normalizeText(target.repoName);
  if (repoName) {
    return `\`${repoName}\``;
  }
  const accountName = normalizeText(target.accountName);
  if (accountName) {
    return accountName.startsWith('@') ? accountName : `@${accountName}`;
  }
  return 'your workflow';
}

function buildSprintProblemHook(target) {
  const haystack = `${normalizeText(target.repoName)} ${normalizeText(target.description)}`.toLowerCase();
  if (/\b(jira|github|gitlab|microsoft ?365|office|google drive|calendar|slack|salesforce|crm|analytics)\b/.test(haystack)) {
    return 'If one approval, handoff, or rollback step keeps creating trouble';
  }
  if (/\b(production|platform|deploy|deployment|incident|sre|ci|cd|release|security|compliance)\b/.test(haystack)) {
    return 'If one deploy, release, or incident workflow keeps needing extra guardrails';
  }
  if (/\b(memory|context|agent|orchestrator|tool use)\b/.test(haystack)) {
    return 'If one context, memory, or tool-use failure keeps repeating';
  }
  return 'If one workflow keeps repeating the same mistake';
}

function buildFallbackMessage(target, selectedMotion, motionCatalog = buildMotionCatalog()) {
  const motion = motionCatalog[selectedMotion.key];
  const targetRef = buildTargetReference(target);
  if (selectedMotion.key === motionCatalog.sprint.key) {
    return [
      `Hey @${target.username}, saw you're shipping ${targetRef}.`,
      `${buildSprintProblemHook(target)}, I can harden that workflow for you with a prevention gate and proof run: ${motion.cta}`,
    ].join(' ');
  }

  const guideLink = buildRevenueLinks().guideLink;
  return [
    `Hey @${target.username}, saw you're building around ${targetRef}.`,
    `If you want the clean self-serve tool path first, start with the proof-backed setup guide: ${guideLink}. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.`,
  ].join(' ');
}

function buildPainConfirmedFollowUp(target, selectedMotion, motionCatalog = buildMotionCatalog()) {
  const motion = motionCatalog[selectedMotion.key];
  const repoName = normalizeText(target.repoName);
  const repoRef = repoName ? `\`${repoName}\`` : 'your workflow';
  const proRef = repoName ? ` for ${repoRef}` : '';
  if (selectedMotion.key === motionCatalog.sprint.key) {
    return [
      `If ${repoRef} really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: ${motion.cta}`,
      `Commercial truth: ${motion.truth} Verification evidence: ${motion.proof}`,
    ].join(' ');
  }

  return [
    `If you want the self-serve path${proRef}, here is the live Pro checkout: ${motion.cta}`,
    `Commercial truth: ${motion.truth} Verification evidence: ${motion.proof}`,
  ].join(' ');
}

function buildSelfServeFollowUp(target, selectedMotion, motionCatalog = buildMotionCatalog()) {
  const links = buildRevenueLinks();
  const repoName = normalizeText(target.repoName);
  const repoRef = repoName ? `\`${repoName}\`` : 'your workflow';

  if (selectedMotion.key === motionCatalog.pro.key) {
    return [
      `If you want the self-serve path for ${repoRef}, start with the proof-backed setup guide: ${links.guideLink}`,
      `If the install path looks right and you want the dashboard plus export-ready evidence, the live Pro checkout is ${motionCatalog.pro.cta}`,
    ].join(' ');
  }

  return [
    `If you want to inspect the self-serve path while you evaluate ${repoRef}, start with the proof-backed setup guide: ${links.guideLink}`,
    `If you decide the tool path is enough, the live Pro checkout is ${motionCatalog.pro.cta}. If the blocker needs hands-on workflow hardening, keep the sprint intake here: ${motionCatalog.sprint.cta}`,
  ].join(' ');
}

function buildCheckoutCloseDraft(target, selectedMotion, motionCatalog = buildMotionCatalog()) {
  const repoName = normalizeText(target.repoName);
  const repoRef = repoName ? `\`${repoName}\`` : 'your workflow';
  const primaryLabel = selectedMotion.key === motionCatalog.pro.key
    ? motionCatalog.pro.label
    : motionCatalog.sprint.label;
  const primaryCta = selectedMotion.key === motionCatalog.pro.key
    ? motionCatalog.pro.cta
    : motionCatalog.sprint.cta;

  return [
    `If you are already comparing close options for ${repoRef}, the primary path is ${primaryLabel}: ${primaryCta}`,
    `Self-serve Pro: ${motionCatalog.pro.cta} Commercial truth: ${motionCatalog.pro.truth} Verification evidence: ${motionCatalog.pro.proof}`,
  ].join(' ');
}

function buildGeminiPrompt(target, selectedMotion, motionCatalog = buildMotionCatalog()) {
  const motion = motionCatalog[selectedMotion.key];
  return `
You are a highly technical founder doing outbound for ThumbGate.
Stay inside current commercial truth. Never invent traction, partners, or scarcity.

Current public self-serve offer: ${motionCatalog.pro.label}
Public self-serve checkout: ${motionCatalog.pro.cta}
Workflow Hardening Sprint intake: ${motionCatalog.sprint.cta}
Commercial truth: ${motionCatalog.pro.truth}
Verification evidence: ${motionCatalog.pro.proof}

Target developer: @${target.username}
Target repository: ${target.repoName}
Repository URL: ${target.repoUrl}
Repository description: ${target.description}
Recommended motion: ${motion.label}
Reason: ${selectedMotion.reason}

Write a short founder-style outreach note in 2 sentences max.
Sound like a senior engineer, not a marketer.
Use the recommended motion only.
Do not lead with proof links. Proof is for after the buyer confirms pain.
For sprint outreach, make the offer concrete: "I will harden one AI-agent workflow for you."
`;
}

async function generateOutreachMessages(targets, motionCatalog = buildMotionCatalog()) {
  const apiKey = normalizeText(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    return targets.map((target) => {
      const selectedMotion = selectOutreachMotion(target, motionCatalog);
      return {
        ...target,
        selectedMotion,
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        followUpMessage: buildPainConfirmedFollowUp(target, selectedMotion, motionCatalog),
        message: buildFallbackMessage(target, selectedMotion, motionCatalog),
      };
    });
  }

  const GoogleGenAI = getGoogleGenAI();
  if (!GoogleGenAI) {
    return targets.map((target) => {
      const selectedMotion = selectOutreachMotion(target, motionCatalog);
      return {
        ...target,
        selectedMotion,
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        followUpMessage: buildPainConfirmedFollowUp(target, selectedMotion, motionCatalog),
        message: buildFallbackMessage(target, selectedMotion, motionCatalog),
      };
    });
  }

  const ai = new GoogleGenAI({ apiKey });
  const results = [];

  for (const target of targets) {
    const selectedMotion = selectOutreachMotion(target, motionCatalog);
    let message = buildFallbackMessage(target, selectedMotion, motionCatalog);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: buildGeminiPrompt(target, selectedMotion, motionCatalog),
      });
      const candidate = normalizeText(response.text);
      if (candidate) {
        message = candidate;
      }
    } catch (err) {
      void err;
    }

    results.push({
      ...target,
      selectedMotion,
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      followUpMessage: buildPainConfirmedFollowUp(target, selectedMotion, motionCatalog),
      message,
    });
  }

  return results;
}

function buildRevenueLoopReport({ source, fallbackReason, summary, motionCatalog, directive, targets }) {
  const snapshot = summarizeCommercialSnapshot(summary);
  const verification = buildBillingVerification({
    source,
    fallbackReason,
    snapshot,
  });
  const currentTruth = {
    publicSelfServeOffer: motionCatalog.pro.label,
    publicSelfServeCta: motionCatalog.pro.cta,
    teamPilotOffer: motionCatalog.sprint.label,
    teamPilotCta: motionCatalog.sprint.cta,
    guideLink: buildRevenueLinks().guideLink,
    commercialTruthLink: motionCatalog.pro.truth,
    verificationEvidenceLink: motionCatalog.pro.proof,
  };

  return {
    generatedAt: new Date().toISOString(),
    source,
    fallbackReason: fallbackReason || null,
    verification,
    objective: 'First 10 paying customers',
    directive,
    currentTruth,
    evidenceBackstop: buildEvidenceBackstop(currentTruth),
    snapshot,
    targets: targets.map((target) => {
      const followUpMessage = target.followUpMessage
        || buildPainConfirmedFollowUp(target, target.selectedMotion, motionCatalog);
      const selfServeFollowUpDraft = target.selfServeFollowUpDraft
        || buildSelfServeFollowUp(target, target.selectedMotion, motionCatalog);
      const checkoutCloseDraft = target.checkoutCloseDraft
        || buildCheckoutCloseDraft(target, target.selectedMotion, motionCatalog);
      const evidenceSources = buildEvidenceSources(target, motionCatalog);
      const pipelineLeadId = normalizeText(target.pipelineLeadId) || buildLeadFromRevenueTarget(target).leadId;
      const pipelineStage = normalizePipelineStage(target.pipelineStage);
      const salesCommands = target.salesCommands || buildTargetSalesCommands({
        ...target,
        pipelineLeadId,
        pipelineStage,
      });

      return {
        temperature: normalizeText(target.temperature) || 'cold',
        source: normalizeText(target.source) || 'github',
        channel: normalizeText(target.channel) || normalizeText(target.source) || 'github',
        username: target.username,
        accountName: normalizeText(target.accountName) || normalizeText(target.username) || '',
        company: normalizeText(target.company),
        contactUrl: normalizeText(target.contactUrl) || '',
        contactSurfaces: dedupeContactSurfaces(target.contactSurfaces),
        websiteUrl: normalizeUrlLikeValue(target.websiteUrl),
        repoName: target.repoName,
        repoUrl: target.repoUrl,
        description: target.description,
        stars: target.stars,
        updatedAt: target.updatedAt,
        evidenceScore: target.evidence?.score || 0,
        evidence: target.evidence?.evidence || [],
        outreachAngle: target.evidence?.outreachAngle || '',
        evidenceSource: target.repoUrl || '',
        evidenceSources,
        claimGuardrails: buildClaimGuardrails(),
        motion: target.selectedMotion.key,
        motionLabel: target.selectedMotion.label,
        motionReason: target.selectedMotion.reason,
        pipelineLeadId,
        pipelineStage,
        pipelineUpdatedAt: normalizeText(target.pipelineUpdatedAt),
        nextOperatorAction: normalizeText(target.nextOperatorAction) || buildNextOperatorAction(pipelineStage),
        offer: target.selectedMotion.key === motionCatalog.sprint.key ? 'workflow_hardening_sprint' : 'pro_self_serve',
        cta: target.selectedMotion.key === motionCatalog.sprint.key
          ? motionCatalog.sprint.cta
          : currentTruth.guideLink,
        proofPackTrigger: target.proofPackTrigger || 'Use proof pack only after the buyer confirms pain.',
        firstTouchDraft: target.message,
        painConfirmedFollowUpDraft: followUpMessage,
        selfServeFollowUpDraft,
        checkoutCloseDraft,
        salesCommands,
        message: target.message,
      };
    }),
  };
}

function resolveMotionLabel(report, motionKey) {
  return motionKey === 'pro'
    ? report.currentTruth.publicSelfServeOffer
    : report.currentTruth.teamPilotOffer;
}

function resolveMotionCta(report, motionKey) {
  const links = buildRevenueLinks();
  if (motionKey === 'guide') {
    return normalizeText(report.currentTruth?.guideLink) || links.guideLink;
  }
  if (motionKey === 'pro') {
    return normalizeText(report.currentTruth?.publicSelfServeCta) || links.proCheckoutLink;
  }
  if (motionKey === 'sprint') {
    return normalizeText(report.currentTruth?.teamPilotCta) || links.sprintLink;
  }
  const matchingTarget = Array.isArray(report.targets)
    ? report.targets.find((target) => normalizeText(target.motion) === normalizeText(motionKey) && normalizeText(target.cta))
    : null;
  if (matchingTarget) {
    return matchingTarget.cta;
  }
  return '';
}

function resolveMarketplaceVariantLabel(report, motionKey) {
  if (motionKey === 'guide') {
    return 'Proof-backed setup guide';
  }
  return resolveMotionLabel(report, motionKey);
}

function buildMarketplaceListingVariants(report, signalThemes = []) {
  return signalThemes.map((theme) => {
    const template = MARKETPLACE_VARIANT_TEMPLATES[theme.key] || {};
    const primaryMotion = normalizeText(template.primaryMotion) || 'sprint';
    const secondaryMotion = normalizeText(template.secondaryMotion) || 'guide';

    return {
      key: theme.key,
      label: theme.label,
      audience: template.audience || 'Buyers already showing evidence for this workflow theme.',
      headline: template.headline || 'Harden one AI-agent workflow before you roll it out.',
      shortDescription: template.shortDescription || theme.summary,
      evidenceSummary: theme.summary,
      listingAngle: theme.listingAngle,
      primaryCta: {
        motion: primaryMotion,
        label: resolveMarketplaceVariantLabel(report, primaryMotion),
        cta: resolveMotionCta(report, primaryMotion),
      },
      secondaryCta: {
        motion: secondaryMotion,
        label: resolveMarketplaceVariantLabel(report, secondaryMotion),
        cta: resolveMotionCta(report, secondaryMotion),
      },
      sampleTargets: Array.isArray(theme.examples) ? theme.examples : [],
    };
  });
}

function buildMarketplaceCopy(report) {
  const targets = Array.isArray(report?.targets) ? report.targets : [];
  const rankedSignalThemes = MARKETPLACE_SIGNAL_THEMES
    .map((theme) => {
      const matches = targets.filter((target) => theme.match(target));
      return {
        key: theme.key,
        label: theme.label,
        summary: theme.summary,
        listingAngle: theme.listingAngle,
        count: matches.length,
        examples: matches.slice(0, 3).map((target) => (
          normalizeText(target.repoName)
            ? `${target.username}/${target.repoName}`
            : `@${target.username}`
        )),
      };
    })
    .filter((theme) => theme.count > 0)
    .sort((left, right) => right.count - left.count);
  const signalThemes = rankedSignalThemes.slice(0, 3);
  const selfServeSignal = rankedSignalThemes.find((theme) => theme.key === 'self_serve_tooling');
  if (selfServeSignal && !signalThemes.some((theme) => theme.key === selfServeSignal.key)) {
    signalThemes.push(selfServeSignal);
  }
  const topTheme = signalThemes[0];
  const primaryMotion = normalizeText(report.directive?.primaryMotion) || 'sprint';
  const secondaryMotion = normalizeText(report.directive?.secondaryMotion) || 'pro';
  const headline = primaryMotion === 'sprint'
    ? 'Harden one AI-agent workflow before you roll it out.'
    : 'Turn repeated AI-agent mistakes into pre-action checks before the next tool call.';
  const signalSentence = signalThemes.length
    ? signalThemes.map((theme) => theme.summary).join(' ')
    : 'Current target evidence still points to workflow hardening and proof-first positioning.';
  const shortDescription = [
    report.verification?.mode === 'live-hosted'
      ? (report.directive?.headline || headline)
      : headline,
    signalSentence,
  ].join(' ');
  const longDescription = [
    'ThumbGate is a reliability gateway for AI coding workflows.',
    'It captures repeated failures, regenerates pre-action gates, and keeps approval boundaries, rollback safety, and proof attached to the workflow before the next risky tool call.',
    signalSentence,
    `Primary motion: ${resolveMotionLabel(report, primaryMotion)}.`,
    `Secondary motion: ${resolveMotionLabel(report, secondaryMotion)} after the buyer asks for the self-serve path.`,
  ].join(' ');
  const featuredTargets = [];
  const featuredKeys = new Set();
  const featureTarget = (predicate) => {
    const match = targets.find((target) => predicate(target));
    if (!match) return;
    const key = `${normalizeText(match.username)}::${normalizeText(match.repoName)}::${normalizeText(match.contactUrl)}`;
    if (featuredKeys.has(key)) return;
    featuredKeys.add(key);
    featuredTargets.push(match);
  };

  featureTarget((target) => normalizeText(target.temperature).toLowerCase() === 'warm');
  featureTarget((target) => normalizeText(target.motion).toLowerCase() === 'pro' && hasEvidenceLabel(target, 'self-serve agent tooling'));
  featureTarget((target) => normalizeText(target.motion).toLowerCase() === 'sprint' && normalizeText(target.temperature).toLowerCase() !== 'warm');

  for (const target of targets) {
    if (featuredTargets.length >= 5) break;
    const key = `${normalizeText(target.username)}::${normalizeText(target.repoName)}::${normalizeText(target.contactUrl)}`;
    if (featuredKeys.has(key)) continue;
    featuredKeys.add(key);
    featuredTargets.push(target);
  }

  const sampleTargets = featuredTargets
    .map((target) => ({
      account: normalizeText(target.repoName)
        ? `${target.username}/${target.repoName}`
        : `@${target.username}`,
      temperature: target.temperature || 'cold',
      motion: target.motionLabel || resolveMotionLabel(report, target.motion),
      why: target.motionReason || target.outreachAngle || '',
    }));
  const listingVariants = buildMarketplaceListingVariants(report, signalThemes);

  return {
    generatedAt: report.generatedAt,
    state: report.directive?.state || 'cold-start',
    headline,
    shortDescription,
    longDescription,
    proofPolicy: 'Do not lead with proof links. Use Commercial Truth and Verification Evidence only after the buyer confirms pain.',
    recommendedCtas: [
      {
        motion: 'guide',
        label: 'Proof-backed setup guide',
        cta: normalizeText(report.currentTruth?.guideLink),
      },
      {
        motion: primaryMotion,
        label: resolveMotionLabel(report, primaryMotion),
        cta: resolveMotionCta(report, primaryMotion),
      },
      {
        motion: secondaryMotion,
        label: resolveMotionLabel(report, secondaryMotion),
        cta: resolveMotionCta(report, secondaryMotion),
      },
    ],
    listingBullets: dedupeList([
      'Turn repeated AI-agent mistakes into enforceable pre-action gates.',
      topTheme ? topTheme.listingAngle : '',
      'Route install-intent buyers through the proof-backed setup guide before direct checkout.',
      selfServeSignal ? selfServeSignal.listingAngle : '',
      OFFER_SPLIT_RULE,
      `Primary offer: ${resolveMotionLabel(report, primaryMotion)}.`,
      `Secondary offer: ${resolveMotionLabel(report, secondaryMotion)} after the buyer asks for the tool path.`,
      'Keep approval boundaries, rollback safety, and proof attached to the workflow before rollout.',
    ]),
    topSignals: signalThemes,
    listingVariants,
    sampleTargets,
    evidenceBackstop: buildEvidenceBackstop(report.currentTruth || {}),
    proofLinks: [
      report.currentTruth?.commercialTruthLink || '',
      report.currentTruth?.verificationEvidenceLink || '',
    ].filter(Boolean),
  };
}

function renderRevenueTargetMarkdown(target) {
  return [
    `### @${target.username} — ${target.repoName || target.accountName || 'warm discovery lead'}`,
    `- Temperature: ${target.temperature || 'cold'}`,
    `- Source: ${target.source || 'github'} / ${target.channel || target.source || 'github'}`,
    `- Pipeline stage: ${target.pipelineStage}`,
    `- Next operator step: ${target.nextOperatorAction || buildNextOperatorAction(target.pipelineStage)}`,
    `- Pipeline last updated: ${target.pipelineUpdatedAt || 'n/a'}`,
    `- Offer: ${target.offer}`,
    `- Contact: ${target.contactUrl || 'n/a'}`,
    `- Contact surfaces: ${renderContactSurfaces(target.contactSurfaces)}`,
    `- Company: ${target.company || 'n/a'}`,
    `- Repo: ${target.repoUrl || 'n/a'}`,
    `- Repo last updated: ${target.updatedAt || 'n/a'}`,
    `- Evidence score: ${target.evidenceScore}`,
    `- Evidence: ${target.evidence.length ? target.evidence.join(', ') : 'n/a'}`,
    `- Evidence sources: ${renderEvidenceSources(target.evidenceSources)}`,
    `- Outreach angle: ${target.outreachAngle || 'n/a'}`,
    `- Motion: ${target.motionLabel}`,
    `- Why: ${target.motionReason}`,
    `- Proof timing: ${target.proofPackTrigger || 'Use proof pack only after the buyer confirms pain.'}`,
    `- CTA: ${target.cta}`,
    `- First-touch draft: ${target.firstTouchDraft || target.message}`,
    `- Pain-confirmed follow-up: ${target.painConfirmedFollowUpDraft || 'n/a'}`,
    `- Tool-path follow-up: ${target.selfServeFollowUpDraft || 'n/a'}`,
    `- Checkout close draft: ${target.checkoutCloseDraft || 'n/a'}`,
    '',
  ];
}

function renderRevenueLoopMarkdown(report) {
  const fallbackReason = report.fallbackReason ? ` (${report.fallbackReason})` : '';
  const targets = Array.isArray(report.targets) ? report.targets.map(enrichRenderableTarget) : [];
  const warmTargets = targets.filter((target) => target.temperature === 'warm');
  const coldTargets = targets.filter((target) => target.temperature !== 'warm');
  const warmTargetLines = warmTargets.length
    ? warmTargets.flatMap(renderRevenueTargetMarkdown)
    : ['- No warm discovery targets were loaded for this run.'];
  const coldTargetLines = coldTargets.length
    ? coldTargets.flatMap(renderRevenueTargetMarkdown)
    : ['- No cold GitHub targets were discovered in this run. Re-run with authenticated `gh` access.'];
  const lines = [
    '# GSD Revenue Loop',
    '',
    `Status: ${report.directive.state}`,
    `Updated: ${report.generatedAt}`,
    '',
    'This report is an operator artifact for landing the first 10 paying customers. It is not proof of sent messages or booked revenue by itself.',
    'Outbound rule: do not treat posts as sales. A lead only moves when it is tracked as contacted, replied, call booked, checkout/sprint, or paid.',
    '',
    '## Current Truth',
    `- Public self-serve offer: ${report.currentTruth.publicSelfServeOffer}`,
    `- Team/pilot motion: ${report.currentTruth.teamPilotOffer}`,
    `- Commercial truth: ${report.currentTruth.commercialTruthLink}`,
    `- Verification evidence: ${report.currentTruth.verificationEvidenceLink}`,
    '',
    '## Evidence Backstop',
    `- Source rule: ${report.evidenceBackstop?.sourceRule || 'Every listing, queue row, and pain-confirmed follow-up must inherit truth and proof links.'}`,
    ...((report.evidenceBackstop?.claimGuardrails || []).map((guardrail) => `- ${guardrail}`)),
    ...((report.evidenceBackstop?.proofLinks || []).map((link) => `- Proof link: ${link}`)),
    '',
    '## Revenue Snapshot',
    `- Revenue window: ${report.snapshotWindow || 'today'}`,
    `- Paid orders: ${report.snapshot.paidOrders}`,
    `- Booked revenue: $${(report.snapshot.bookedRevenueCents / 100).toFixed(2)}`,
    `- Checkout starts: ${report.snapshot.checkoutStarts}`,
    `- Unique leads: ${report.snapshot.uniqueLeads}`,
    `- Workflow sprint leads: ${report.snapshot.sprintLeads}`,
    `- Qualified sprint leads: ${report.snapshot.qualifiedSprintLeads}`,
    `- Billing source: ${report.source}${fallbackReason}`,
    `- Billing verification: ${report.verification?.label || 'n/a'}`,
    '',
    '## GSD Directive',
    `- Objective: ${report.directive.objective}`,
    `- Headline: ${report.directive.headline}`,
    `- Primary motion: ${report.directive.primaryMotion}`,
    `- Secondary motion: ${report.directive.secondaryMotion}`,
    '',
    '## Immediate Actions',
    ...report.directive.actions.map((action) => `- ${action}`),
    '',
    '## Warm Discovery Queue',
    ...warmTargetLines,
    '',
    '## Cold GitHub Queue',
    ...coldTargetLines,
  ];

  return `${lines.join('\n').trim()}\n`;
}

function renderQuotedText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return ['> n/a'];
  }
  return normalized.split('\n').map((line) => `> ${line}`);
}

function renderWarmTargetOutreachMarkdown(target, index) {
  const enrichedTarget = enrichRenderableTarget(target);
  const salesCommands = enrichedTarget.salesCommands;
  return [
    `## ${index + 1}. ${enrichedTarget.username} (${enrichedTarget.accountName || enrichedTarget.source || 'warm lead'})`,
    `- Source: ${enrichedTarget.source || 'github'} / ${enrichedTarget.channel || enrichedTarget.source || 'github'}`,
    `- Contact: ${enrichedTarget.contactUrl || 'n/a'}`,
    `- Contact surfaces: ${renderContactSurfaces(enrichedTarget.contactSurfaces)}`,
    `- Company: ${enrichedTarget.company || 'n/a'}`,
    `- Evidence score: ${enrichedTarget.evidenceScore}`,
    `- Evidence: ${enrichedTarget.evidence.length ? enrichedTarget.evidence.join(', ') : 'n/a'}`,
    `- Evidence sources: ${renderEvidenceSources(enrichedTarget.evidenceSources)}`,
    `- Outreach angle: ${enrichedTarget.outreachAngle || 'n/a'}`,
    `- Motion: ${enrichedTarget.motionLabel}`,
    `- Why: ${enrichedTarget.motionReason}`,
    `- Proof timing: ${enrichedTarget.proofPackTrigger || 'Use proof pack only after the buyer confirms pain.'}`,
    `- CTA: ${enrichedTarget.cta}`,
    `- Log after send: \`${salesCommands.markContacted || 'n/a'}\``,
    `- Log after pain-confirmed reply: \`${salesCommands.markReplied || 'n/a'}\``,
    `- Log after checkout started: \`${salesCommands.markCheckoutStarted || 'n/a'}\``,
    `- Log after paid: \`${salesCommands.markPaid || 'n/a'}\``,
    '',
    'First-touch draft:',
    ...renderQuotedText(enrichedTarget.firstTouchDraft || enrichedTarget.message),
    '',
    'Pain-confirmed follow-up:',
    ...renderQuotedText(enrichedTarget.painConfirmedFollowUpDraft),
    '',
    'Tool-path follow-up:',
    ...renderQuotedText(enrichedTarget.selfServeFollowUpDraft),
    '',
    'Checkout close draft:',
    ...renderQuotedText(enrichedTarget.checkoutCloseDraft),
    '',
  ];
}

function rankOperatorTargets(targets = []) {
  return [...targets].sort((left, right) => {
    const leftStagePriority = PIPELINE_STAGE_PRIORITY[normalizePipelineStage(left.pipelineStage)] || 0;
    const rightStagePriority = PIPELINE_STAGE_PRIORITY[normalizePipelineStage(right.pipelineStage)] || 0;
    if (rightStagePriority !== leftStagePriority) {
      return rightStagePriority - leftStagePriority;
    }

    const leftWarm = normalizeText(left.temperature).toLowerCase() === 'warm' ? 1 : 0;
    const rightWarm = normalizeText(right.temperature).toLowerCase() === 'warm' ? 1 : 0;
    if (rightWarm !== leftWarm) {
      return rightWarm - leftWarm;
    }

    const leftScore = Number(left.evidenceScore || 0);
    const rightScore = Number(right.evidenceScore || 0);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    const leftSprint = normalizeText(left.motion).toLowerCase() === 'sprint' ? 1 : 0;
    const rightSprint = normalizeText(right.motion).toLowerCase() === 'sprint' ? 1 : 0;
    if (rightSprint !== leftSprint) {
      return rightSprint - leftSprint;
    }

    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  });
}

function renderOperatorPriorityTargetMarkdown(target, index) {
  const enrichedTarget = enrichRenderableTarget(target);
  const label = normalizeText(enrichedTarget.repoName)
    ? `@${enrichedTarget.username} — ${enrichedTarget.repoName}`
    : `@${enrichedTarget.username} — ${enrichedTarget.accountName || enrichedTarget.source || 'discovery lead'}`;
  const contactSurface = enrichedTarget.contactSurface || enrichedTarget.contactUrl || enrichedTarget.repoUrl || 'n/a';
  const contactSurfaces = renderContactSurfaces(enrichedTarget.contactSurfaces);
  const salesCommands = enrichedTarget.salesCommands;
  const whyNow = enrichedTarget.whyNow || enrichedTarget.motionReason || enrichedTarget.outreachAngle || 'n/a';
  return [
    `## ${index + 1}. ${label}`,
    `- Temperature: ${enrichedTarget.temperature || 'cold'}`,
    `- Source: ${enrichedTarget.source || 'github'} / ${enrichedTarget.channel || enrichedTarget.source || 'github'}`,
    `- Pipeline stage: ${enrichedTarget.pipelineStage || 'targeted'}`,
    `- Pipeline lead id: ${enrichedTarget.pipelineLeadId || 'n/a'}`,
    `- Next operator step: ${enrichedTarget.nextOperatorAction || buildNextOperatorAction(enrichedTarget.pipelineStage)}`,
    `- Pipeline last updated: ${enrichedTarget.pipelineUpdatedAt || 'n/a'}`,
    `- Log after send: \`${salesCommands.markContacted || 'n/a'}\``,
    `- Log after pain-confirmed reply: \`${salesCommands.markReplied || 'n/a'}\``,
    `- Log after call booked: \`${salesCommands.markCallBooked || 'n/a'}\``,
    `- Log after checkout started: \`${salesCommands.markCheckoutStarted || 'n/a'}\``,
    `- Log after sprint intake: \`${salesCommands.markSprintIntake || 'n/a'}\``,
    `- Log after paid: \`${salesCommands.markPaid || 'n/a'}\``,
    `- Contact surface: ${contactSurface}`,
    `- Contact surfaces: ${contactSurfaces}`,
    `- Company: ${enrichedTarget.company || 'n/a'}`,
    `- Evidence score: ${enrichedTarget.evidenceScore}`,
    `- Evidence: ${enrichedTarget.evidence.length ? enrichedTarget.evidence.join(', ') : 'n/a'}`,
    `- Evidence sources: ${renderEvidenceSources(enrichedTarget.evidenceSources)}`,
    `- Motion: ${enrichedTarget.motionLabel}`,
    `- Why now: ${whyNow}`,
    `- Proof rule: ${enrichedTarget.proofPackTrigger || 'Use proof pack only after the buyer confirms pain.'}`,
    `- Claim guardrails: ${(enrichedTarget.claimGuardrails || []).join('; ') || 'n/a'}`,
    `- CTA: ${enrichedTarget.cta}`,
    '',
    'First-touch draft:',
    ...renderQuotedText(enrichedTarget.firstTouchDraft || enrichedTarget.message),
    '',
    'Pain-confirmed follow-up:',
    ...renderQuotedText(enrichedTarget.painConfirmedFollowUpDraft),
    '',
    'Tool-path follow-up:',
    ...renderQuotedText(enrichedTarget.selfServeFollowUpDraft),
    '',
    'Checkout close draft:',
    ...renderQuotedText(enrichedTarget.checkoutCloseDraft),
    '',
  ];
}

function buildOperatorPriorityTargetSummary(target, index) {
  const enrichedTarget = enrichRenderableTarget(target);
  const label = normalizeText(enrichedTarget.repoName)
    ? `@${enrichedTarget.username} - ${enrichedTarget.repoName}`
    : `@${enrichedTarget.username} - ${enrichedTarget.accountName || enrichedTarget.source || 'discovery lead'}`;
  return {
    rank: index + 1,
    label,
    username: normalizeText(enrichedTarget.username),
    accountName: normalizeText(enrichedTarget.accountName),
    repoName: normalizeText(enrichedTarget.repoName),
    repoUrl: normalizeText(enrichedTarget.repoUrl),
    temperature: normalizeText(enrichedTarget.temperature) || 'cold',
    source: normalizeText(enrichedTarget.source) || 'github',
    channel: normalizeText(enrichedTarget.channel) || normalizeText(enrichedTarget.source) || 'github',
    pipelineStage: normalizeText(enrichedTarget.pipelineStage) || 'targeted',
    pipelineLeadId: normalizeText(enrichedTarget.pipelineLeadId) || 'n/a',
    nextOperatorStep: normalizeText(enrichedTarget.nextOperatorAction) || buildNextOperatorAction(enrichedTarget.pipelineStage),
    pipelineUpdatedAt: normalizeText(enrichedTarget.pipelineUpdatedAt),
    contactSurface: normalizeText(enrichedTarget.contactSurface)
      || normalizeText(enrichedTarget.contactUrl)
      || normalizeText(enrichedTarget.repoUrl)
      || 'n/a',
    contactSurfaces: dedupeContactSurfaces(enrichedTarget.contactSurfaces),
    company: normalizeText(enrichedTarget.company),
    evidenceScore: Number(enrichedTarget.evidenceScore || 0),
    evidence: Array.isArray(enrichedTarget.evidence) ? enrichedTarget.evidence : [],
    evidenceSources: Array.isArray(enrichedTarget.evidenceSources) ? enrichedTarget.evidenceSources : [],
    claimGuardrails: Array.isArray(enrichedTarget.claimGuardrails) ? enrichedTarget.claimGuardrails : [],
    motionLabel: normalizeText(enrichedTarget.motionLabel),
    whyNow: normalizeText(enrichedTarget.whyNow)
      || normalizeText(enrichedTarget.motionReason)
      || normalizeText(enrichedTarget.outreachAngle),
    proofRule: normalizeText(enrichedTarget.proofPackTrigger) || 'Use proof pack only after the buyer confirms pain.',
    cta: normalizeText(enrichedTarget.cta),
    firstTouchDraft: normalizeText(enrichedTarget.firstTouchDraft || enrichedTarget.message),
    painConfirmedFollowUpDraft: normalizeText(enrichedTarget.painConfirmedFollowUpDraft),
    selfServeFollowUpDraft: normalizeText(enrichedTarget.selfServeFollowUpDraft),
    checkoutCloseDraft: normalizeText(enrichedTarget.checkoutCloseDraft),
    salesCommands: enrichedTarget.salesCommands || {},
  };
}

function isProductionRolloutTarget(target) {
  return hasEvidenceLabel(target, 'production or platform workflow')
    && normalizeText(target.motion).toLowerCase() !== 'pro'
    && normalizeText(target.temperature).toLowerCase() !== 'warm';
}

function buildOperatorHandoffPayload(report) {
  const rankedTargets = rankOperatorTargets(Array.isArray(report?.targets) ? report.targets.map(enrichRenderableTarget) : []);
  const followUpTargets = rankedTargets.filter((target) => normalizePipelineStage(target.pipelineStage) !== 'targeted');
  const freshTargets = rankedTargets.filter((target) => normalizePipelineStage(target.pipelineStage) === 'targeted');
  const selfServeTargets = freshTargets.filter((target) => normalizeText(target.motion).toLowerCase() === 'pro');
  const warmTargets = freshTargets.filter((target) => (
    normalizeText(target.temperature).toLowerCase() === 'warm'
      && normalizeText(target.motion).toLowerCase() !== 'pro'
  ));
  const productionTargets = freshTargets.filter(isProductionRolloutTarget);
  const coldTargets = freshTargets.filter((target) => (
    normalizeText(target.temperature).toLowerCase() !== 'warm'
      && normalizeText(target.motion).toLowerCase() !== 'pro'
      && !isProductionRolloutTarget(target)
  ));
  const sections = [
    {
      key: 'follow_up_now',
      label: 'Follow Up Now',
      targets: followUpTargets,
    },
    {
      key: 'send_now_warm_discovery',
      label: 'Send Now: Warm Discovery',
      targets: warmTargets,
    },
    {
      key: 'close_now_self_serve_pro',
      label: 'Close Now: Self-Serve Pro',
      targets: selfServeTargets,
    },
    {
      key: 'send_next_production_rollout',
      label: 'Send Next: Production Rollout',
      targets: productionTargets,
    },
    {
      key: 'seed_next_cold_github',
      label: 'Seed Next: Cold GitHub',
      targets: coldTargets,
    },
  ];

  return {
    generatedAt: report?.generatedAt || new Date().toISOString(),
    summary: {
      revenueState: normalizeText(report?.directive?.state) || 'cold-start',
      headline: normalizeText(report?.directive?.headline) || 'No verified revenue and no active pipeline.',
      billingVerification: normalizeText(report?.verification?.label) || 'n/a',
      paidOrders: Number(report?.snapshot?.paidOrders || 0),
      checkoutStarts: Number(report?.snapshot?.checkoutStarts || 0),
      activeFollowUps: followUpTargets.length,
      warmTargetsReadyNow: warmTargets.length,
      selfServeTargetsReadyNow: selfServeTargets.length,
      productionRolloutTargetsReadyNow: productionTargets.length,
      coldGitHubTargetsReadyNext: coldTargets.length,
    },
    operatorRules: [
      'Import the queue into the sales ledger before sending anything.',
      'Follow the row motion: sprint rows get one workflow-hardening offer; self-serve rows get the guide-to-Pro lane unless pain is confirmed.',
      `Qualify the offer split: ${OFFER_SPLIT_RULE}`,
      'Use VERIFICATION_EVIDENCE.md and COMMERCIAL_TRUTH.md only after the buyer confirms pain.',
    ],
    importCommand: 'npm run sales:pipeline -- import --source docs/marketing/gtm-revenue-loop.json',
    sections: sections.map((section) => ({
      key: section.key,
      label: section.label,
      targets: section.targets.map((target, index) => buildOperatorPriorityTargetSummary(target, index)),
    })),
  };
}

function renderOperatorHandoffMarkdown(report) {
  const handoff = buildOperatorHandoffPayload(report);
  const followUpTargets = handoff.sections.find((section) => section.key === 'follow_up_now')?.targets || [];
  const warmTargets = handoff.sections.find((section) => section.key === 'send_now_warm_discovery')?.targets || [];
  const selfServeTargets = handoff.sections.find((section) => section.key === 'close_now_self_serve_pro')?.targets || [];
  const productionTargets = handoff.sections.find((section) => section.key === 'send_next_production_rollout')?.targets || [];
  const coldTargets = handoff.sections.find((section) => section.key === 'seed_next_cold_github')?.targets || [];
  const followUpLines = followUpTargets.length
    ? followUpTargets.flatMap((target, index) => renderOperatorPriorityTargetMarkdown(target, index))
    : ['- No in-flight follow-ups are currently tracked.', ''];
  const warmLines = warmTargets.length
    ? warmTargets.flatMap((target, index) => renderOperatorPriorityTargetMarkdown(target, index + followUpTargets.length))
    : ['- No warm discovery targets are available for this run.', ''];
  const selfServeLines = selfServeTargets.length
    ? selfServeTargets.flatMap((target, index) => renderOperatorPriorityTargetMarkdown(target, index + followUpTargets.length + warmTargets.length))
    : ['- No self-serve close targets are available for this run.', ''];
  const productionLines = productionTargets.length
    ? productionTargets.flatMap((target, index) => renderOperatorPriorityTargetMarkdown(target, index + followUpTargets.length + warmTargets.length + selfServeTargets.length))
    : ['- No production-rollout targets are available for this run.', ''];
  const coldLines = coldTargets.length
    ? coldTargets.flatMap((target, index) => renderOperatorPriorityTargetMarkdown(target, index + followUpTargets.length + warmTargets.length + selfServeTargets.length + productionTargets.length))
    : ['- No cold GitHub targets are available for this run.', ''];

  return [
    '# Revenue Operator Priority Handoff',
    '',
    `Updated: ${handoff.generatedAt}`,
    '',
    'This is the ranked send order for the current zero-to-one revenue loop. Work follow-ups first, then warm discovery, then self-serve closes, then production-rollout buyers, then expand into the remaining cold GitHub targets with the same proof discipline.',
    '',
    'This handoff sits on top of `gtm-revenue-loop.md`, `gtm-target-queue.csv`, and `team-outreach-messages.md` so an operator can decide who to contact next without re-ranking the queue manually.',
    '',
    '## Current Snapshot',
    `- Revenue state: ${handoff.summary.revenueState}`,
    `- Headline: ${handoff.summary.headline}`,
    `- Billing verification: ${handoff.summary.billingVerification}`,
    `- Paid orders: ${handoff.summary.paidOrders}`,
    `- Checkout starts: ${handoff.summary.checkoutStarts}`,
    `- Active follow-ups: ${handoff.summary.activeFollowUps}`,
    `- Warm targets ready now: ${handoff.summary.warmTargetsReadyNow}`,
    `- Self-serve closes ready now: ${handoff.summary.selfServeTargetsReadyNow}`,
    `- Production-rollout targets ready now: ${handoff.summary.productionRolloutTargetsReadyNow}`,
    `- Cold GitHub targets ready next: ${handoff.summary.coldGitHubTargetsReadyNext}`,
    '',
    '## Operator Rules',
    ...handoff.operatorRules.map((rule) => {
      if (/VERIFICATION_EVIDENCE\.md/.test(rule) && /COMMERCIAL_TRUTH\.md/.test(rule)) {
        return '- Use [VERIFICATION_EVIDENCE.md](../VERIFICATION_EVIDENCE.md) and [COMMERCIAL_TRUTH.md](../COMMERCIAL_TRUTH.md) only after the buyer confirms pain.';
      }
      return `- ${rule}`;
    }),
    '',
    '```bash',
    handoff.importCommand,
    '```',
    '',
    '## Follow Up Now',
    ...followUpLines,
    '## Send Now: Warm Discovery',
    ...warmLines,
    '## Close Now: Self-Serve Pro',
    ...selfServeLines,
    '## Send Next: Production Rollout',
    ...productionLines,
    '## Seed Next: Cold GitHub',
    ...coldLines,
  ].join('\n');
}

function buildOperatorSendNowPayload(report) {
  const handoff = buildOperatorHandoffPayload(report);
  const rows = handoff.sections.flatMap((section) => (
    section.targets.map((target) => ({
      rank: Number(target.rank || 0),
      sectionKey: section.key,
      sectionLabel: section.label,
      temperature: normalizeText(target.temperature) || 'cold',
      source: normalizeText(target.source) || 'github',
      channel: normalizeText(target.channel) || normalizeText(target.source) || 'github',
      pipelineStage: normalizeText(target.pipelineStage) || 'targeted',
      pipelineLeadId: normalizeText(target.pipelineLeadId) || 'n/a',
      username: normalizeText(target.username),
      accountName: normalizeText(target.accountName),
      company: normalizeText(target.company),
      repoName: normalizeText(target.repoName),
      repoUrl: normalizeText(target.repoUrl),
      contactSurface: normalizeText(target.contactSurface),
      contactSurfaces: dedupeContactSurfaces(target.contactSurfaces),
      pipelineUpdatedAt: normalizeText(target.pipelineUpdatedAt),
      nextOperatorStep: normalizeText(target.nextOperatorStep),
      evidenceScore: Number(target.evidenceScore || 0),
      evidence: Array.isArray(target.evidence) ? target.evidence : [],
      evidenceSources: Array.isArray(target.evidenceSources) ? target.evidenceSources : [],
      claimGuardrails: Array.isArray(target.claimGuardrails) ? target.claimGuardrails : [],
      motionLabel: normalizeText(target.motionLabel),
      whyNow: normalizeText(target.whyNow),
      proofRule: normalizeText(target.proofRule),
      cta: normalizeText(target.cta),
      firstTouchDraft: normalizeText(target.firstTouchDraft),
      painConfirmedFollowUpDraft: normalizeText(target.painConfirmedFollowUpDraft),
      selfServeFollowUpDraft: normalizeText(target.selfServeFollowUpDraft),
      checkoutCloseDraft: normalizeText(target.checkoutCloseDraft),
      markContactedCommand: normalizeText(target.salesCommands?.markContacted),
      markRepliedCommand: normalizeText(target.salesCommands?.markReplied),
      markCallBookedCommand: normalizeText(target.salesCommands?.markCallBooked),
      markCheckoutStartedCommand: normalizeText(target.salesCommands?.markCheckoutStarted),
      markSprintIntakeCommand: normalizeText(target.salesCommands?.markSprintIntake),
      markPaidCommand: normalizeText(target.salesCommands?.markPaid),
    }))
  ));

  return {
    generatedAt: handoff.generatedAt,
    summary: handoff.summary,
    rows,
  };
}

function renderOperatorSendNowCsv(report) {
  const payload = buildOperatorSendNowPayload(report);
  const rows = [
    [
      'rank',
      'sectionKey',
      'sectionLabel',
      'temperature',
      'source',
      'channel',
      'pipelineStage',
      'pipelineLeadId',
      'username',
      'accountName',
      'company',
      'repoName',
      'repoUrl',
      'contactSurface',
      'contactSurfaces',
      'pipelineUpdatedAt',
      'nextOperatorStep',
      'evidenceScore',
      'evidence',
      'evidenceLinks',
      'claimGuardrails',
      'motionLabel',
      'whyNow',
      'proofRule',
      'cta',
      'firstTouchDraft',
      'painConfirmedFollowUpDraft',
      'selfServeFollowUpDraft',
      'checkoutCloseDraft',
      'markContactedCommand',
      'markRepliedCommand',
      'markCallBookedCommand',
      'markCheckoutStartedCommand',
      'markSprintIntakeCommand',
      'markPaidCommand',
    ],
    ...payload.rows.map((row) => [
      String(row.rank || 0),
      row.sectionKey,
      row.sectionLabel,
      row.temperature,
      row.source,
      row.channel,
      row.pipelineStage,
      row.pipelineLeadId,
      row.username,
      row.accountName,
      row.company,
      row.repoName,
      row.repoUrl,
      row.contactSurface,
      renderContactSurfaces(row.contactSurfaces),
      row.pipelineUpdatedAt,
      row.nextOperatorStep,
      String(row.evidenceScore || 0),
      row.evidence.join('; '),
      renderEvidenceSources(row.evidenceSources),
      row.claimGuardrails.join('; '),
      row.motionLabel,
      row.whyNow,
      row.proofRule,
      row.cta,
      row.firstTouchDraft,
      row.painConfirmedFollowUpDraft,
      row.selfServeFollowUpDraft,
      row.checkoutCloseDraft,
      row.markContactedCommand,
      row.markRepliedCommand,
      row.markCallBookedCommand,
      row.markCheckoutStartedCommand,
      row.markSprintIntakeCommand,
      row.markPaidCommand,
    ]),
  ];

  return `${rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')}\n`;
}

function renderOperatorSendNowMarkdown(report) {
  const payload = buildOperatorSendNowPayload(report);
  const sectionOrder = [];
  const sections = new Map();

  for (const row of payload.rows) {
    if (!sections.has(row.sectionKey)) {
      sections.set(row.sectionKey, {
        label: row.sectionLabel,
        rows: [],
      });
      sectionOrder.push(row.sectionKey);
    }
    sections.get(row.sectionKey).rows.push(row);
  }

  const sectionLines = sectionOrder.length
    ? sectionOrder.flatMap((sectionKey) => {
      const section = sections.get(sectionKey);
      return [
        `## ${section.label}`,
        '',
        ...section.rows.flatMap((row) => {
          const label = normalizeText(row.repoName)
            ? `@${row.username} - ${row.repoName}`
            : `@${row.username} - ${row.accountName || row.source || 'discovery lead'}`;
          const whyNow = normalizeText(row.whyNow) || 'n/a';
          return [
            `### ${row.rank}. ${label}`,
            `- Channel: ${row.source || 'github'} / ${row.channel || row.source || 'github'}`,
            `- Pipeline stage: ${row.pipelineStage || 'targeted'}`,
            `- Pipeline lead id: ${row.pipelineLeadId || 'n/a'}`,
            `- Next operator step: ${row.nextOperatorStep || 'Send the first-touch draft and log it.'}`,
            `- Evidence score: ${Number(row.evidenceScore || 0)}`,
            `- Motion: ${row.motionLabel || 'n/a'}`,
            `- Why now: ${whyNow}`,
            `- Proof rule: ${row.proofRule || 'Use proof pack only after the buyer confirms pain.'}`,
            `- CTA: ${row.cta || 'n/a'}`,
            `- Log after send: \`${row.markContactedCommand || 'n/a'}\``,
            `- Log after pain-confirmed reply: \`${row.markRepliedCommand || 'n/a'}\``,
            `- Log after checkout started: \`${row.markCheckoutStartedCommand || 'n/a'}\``,
            '',
            'First-touch draft:',
            ...renderQuotedText(row.firstTouchDraft),
            '',
            'Pain-confirmed follow-up:',
            ...renderQuotedText(row.painConfirmedFollowUpDraft),
            '',
            'Tool-path follow-up:',
            ...renderQuotedText(row.selfServeFollowUpDraft),
            '',
            'Checkout close draft:',
            ...renderQuotedText(row.checkoutCloseDraft),
            '',
          ];
        }),
      ];
    })
    : ['## Send Now', '', '- No ready-now targets are available for this run.', ''];

  return [
    '# Revenue Operator Send-Now Sheet',
    '',
    `Updated: ${payload.generatedAt}`,
    '',
    'This is the flat batch-send layer for the current revenue loop. Use it when you want the message, CTA, and logging commands in one place without re-reading the full GTM report.',
    '',
    'Pair this file with `operator-priority-handoff.md` when you need deeper account context or the full ranked rationale.',
    '',
    '## Current Snapshot',
    `- Revenue state: ${payload.summary.revenueState}`,
    `- Headline: ${payload.summary.headline}`,
    `- Billing verification: ${payload.summary.billingVerification}`,
    `- Paid orders: ${payload.summary.paidOrders}`,
    `- Checkout starts: ${payload.summary.checkoutStarts}`,
    `- Active follow-ups: ${payload.summary.activeFollowUps}`,
    `- Warm targets ready now: ${payload.summary.warmTargetsReadyNow}`,
    `- Self-serve closes ready now: ${payload.summary.selfServeTargetsReadyNow}`,
    `- Production-rollout targets ready now: ${payload.summary.productionRolloutTargetsReadyNow}`,
    `- Cold GitHub targets ready next: ${payload.summary.coldGitHubTargetsReadyNext}`,
    '',
    '## Batch Rules',
    '- Import the queue into the sales ledger before sending anything.',
    '- Keep the offer split honest: sprint rows get one workflow-hardening offer; self-serve rows get the guide-to-Pro lane unless pain is confirmed.',
    `- Qualify the offer split: ${OFFER_SPLIT_RULE}`,
    '- Use [VERIFICATION_EVIDENCE.md](../VERIFICATION_EVIDENCE.md) and [COMMERCIAL_TRUTH.md](../COMMERCIAL_TRUTH.md) only after the buyer confirms pain.',
    '',
    '```bash',
    'npm run sales:pipeline -- import --source docs/marketing/gtm-revenue-loop.json',
    '```',
    '',
    ...sectionLines,
  ].join('\n');
}

function renderTeamOutreachMessagesMarkdown(report) {
  const warmTargets = Array.isArray(report?.targets)
    ? report.targets.map(enrichRenderableTarget).filter((target) => target.temperature === 'warm')
    : [];
  const warmTargetLines = warmTargets.length
    ? warmTargets.flatMap(renderWarmTargetOutreachMarkdown)
    : ['- No warm discovery targets were loaded for this run.', ''];

  return [
    '# Workflow Hardening Sprint Outreach Messages',
    '',
    `Updated: ${report.generatedAt}`,
    '',
    'These drafts are generated from the same evidence-backed revenue-loop report as `gtm-revenue-loop.md`, `gtm-target-queue.csv`, and `gtm-marketplace-copy.md`.',
    'Use `operator-priority-handoff.md` for the ranked send order; this file is the copy layer for warm outreach only.',
    '',
    'Track each lead in the sales ledger before sending anything:',
    '',
    '```bash',
    'npm run sales:pipeline -- add --source reddit --channel reddit_dm --username <name> --pain "<specific pain hypothesis>"',
    '```',
    '',
    'Use them as part of the one-week discovery loop in [CUSTOMER_DISCOVERY_SPRINT.md](../CUSTOMER_DISCOVERY_SPRINT.md). The goal is not to sell on first touch. The goal is to learn whether the real buyer problem is team agent governance, approval boundaries, and rollout proof.',
    '',
    'First-touch rule: lead with one concrete offer, not generic Pro and not the proof pack.',
    '',
    '> I will harden one AI-agent workflow for you.',
    '',
    'Use [VERIFICATION_EVIDENCE.md](../VERIFICATION_EVIDENCE.md) and [COMMERCIAL_TRUTH.md](../COMMERCIAL_TRUTH.md) only after the buyer confirms the workflow pain.',
    '',
    ...warmTargetLines,
  ].join('\n');
}

function renderMarketplaceCopyMarkdown(pack) {
  const signalLines = pack.topSignals.length
    ? pack.topSignals.map((signal) => `- ${signal.label} (${signal.count}): ${signal.summary}${signal.examples.length ? ` Examples: ${signal.examples.join(', ')}` : ''}`)
    : ['- No target evidence was available for this run.'];
  const variantLines = Array.isArray(pack.listingVariants) && pack.listingVariants.length
    ? pack.listingVariants.flatMap((variant) => [
      `### ${variant.label}`,
      `- Audience: ${variant.audience}`,
      `- Headline: ${variant.headline}`,
      `- Short description: ${variant.shortDescription}`,
      `- Evidence: ${variant.evidenceSummary}`,
      `- Listing angle: ${variant.listingAngle}`,
      `- Primary CTA: ${variant.primaryCta?.label || 'cta unavailable in this run'}${variant.primaryCta?.cta ? `: ${variant.primaryCta.cta}` : ''}`,
      `- Secondary CTA: ${variant.secondaryCta?.label || 'cta unavailable in this run'}${variant.secondaryCta?.cta ? `: ${variant.secondaryCta.cta}` : ''}`,
      `- Sample targets: ${(variant.sampleTargets || []).join(', ') || 'n/a'}`,
      '',
    ])
    : ['- No listing variants available in this run.'];
  const ctaLines = pack.recommendedCtas
    .filter((entry) => entry.label || entry.cta)
    .map((entry) => `- ${entry.label}: ${entry.cta || 'cta unavailable in this run'}`);
  const sampleTargetLines = pack.sampleTargets.length
    ? pack.sampleTargets.map((target) => `- ${target.account} (${target.temperature}): ${target.why}`)
    : ['- No sample targets available in this run.'];
  const proofLines = pack.proofLinks.length
    ? pack.proofLinks.map((link) => `- ${link}`)
    : ['- No proof links available in this run.'];
  const evidenceBackstopLines = [
    `- Source rule: ${pack.evidenceBackstop?.sourceRule || 'Every listing should inherit truth and proof links.'}`,
    ...((pack.evidenceBackstop?.claimGuardrails || []).map((guardrail) => `- ${guardrail}`)),
  ];

  return [
    '# Marketplace Copy Pack',
    '',
    'This pack is operator-ready listing copy derived from the current GTM revenue loop. It is not proof of sent outreach, installs, or revenue by itself.',
    '',
    '## Listing Headline',
    pack.headline,
    '',
    '## Short Description',
    pack.shortDescription,
    '',
    '## Long Description',
    pack.longDescription,
    '',
    '## Listing Bullets',
    ...pack.listingBullets.map((bullet) => `- ${bullet}`),
    '',
    '## Recommended CTAs',
    ...ctaLines,
    '',
    '## Evidence-Backed Buyer Signals',
    ...signalLines,
    '',
    '## Listing Variants',
    ...variantLines,
    '## Proof Policy',
    `- ${pack.proofPolicy}`,
    '',
    '## Evidence Backstop',
    ...evidenceBackstopLines,
    '',
    '## Sample Targets Behind This Copy',
    ...sampleTargetLines,
    '',
    '## Proof Links',
    ...proofLines,
    '',
  ].join('\n');
}

function escapeCsvValue(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const escaped = text.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function renderRevenueLoopCsv(report) {
  const targets = Array.isArray(report.targets) ? report.targets.map(enrichRenderableTarget) : [];
  const rows = [
    [
      'temperature',
      'source',
      'channel',
      'username',
      'accountName',
      'company',
      'contactUrl',
      'contactSurfaces',
      'repoName',
      'repoUrl',
      'updatedAt',
      'offer',
      'pipelineStage',
      'pipelineLeadId',
      'nextOperatorAction',
      'pipelineUpdatedAt',
      'evidenceScore',
      'evidence',
      'evidenceSource',
      'evidenceLinks',
      'claimGuardrails',
      'outreachAngle',
      'motionLabel',
      'motionReason',
      'proofPackTrigger',
      'cta',
      'firstTouchDraft',
      'painConfirmedFollowUpDraft',
      'selfServeFollowUpDraft',
      'checkoutCloseDraft',
      'markContactedCommand',
      'markRepliedCommand',
      'markCallBookedCommand',
      'markCheckoutStartedCommand',
      'markSprintIntakeCommand',
      'markPaidCommand',
    ],
    ...targets.map((target) => {
      const salesCommands = target.salesCommands;
      return [
        target.temperature || 'cold',
        target.source || 'github',
        target.channel || target.source || 'github',
        target.username,
        target.accountName || '',
        target.company || '',
        target.contactUrl || '',
        renderContactSurfaces(target.contactSurfaces),
        target.repoName,
        target.repoUrl,
        target.updatedAt,
        target.offer,
        target.pipelineStage,
        target.pipelineLeadId,
        target.nextOperatorAction,
        target.pipelineUpdatedAt,
        String(target.evidenceScore),
        target.evidence.join('; '),
        target.evidenceSource,
        renderEvidenceSources(target.evidenceSources),
        (target.claimGuardrails || []).join('; '),
        target.outreachAngle,
        target.motionLabel,
        target.motionReason,
        target.proofPackTrigger,
        target.cta,
        target.firstTouchDraft || target.message,
        target.painConfirmedFollowUpDraft,
        target.selfServeFollowUpDraft,
        target.checkoutCloseDraft,
        salesCommands.markContacted,
        salesCommands.markReplied,
        salesCommands.markCallBooked,
        salesCommands.markCheckoutStarted,
        salesCommands.markSprintIntake,
        salesCommands.markPaid,
      ];
    }),
  ];

  return `${rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')}\n`;
}

function renderRevenueLoopJsonl(report) {
  const targets = Array.isArray(report.targets) ? report.targets.map(enrichRenderableTarget) : [];
  return `${targets.map((target) => JSON.stringify(target)).join('\n')}\n`;
}

function writeRevenueLoopOutputs(report, options = {}) {
  const repoRoot = options.repoRoot
    ? path.resolve(options.repoRoot)
    : path.resolve(__dirname, '..');
  const docsDir = path.join(repoRoot, 'docs', 'marketing');
  const defaultDocsPath = path.join(docsDir, 'gtm-revenue-loop.md');
  const reportJsonDocsPath = path.join(docsDir, 'gtm-revenue-loop.json');
  const marketplaceDocsPath = path.join(docsDir, 'gtm-marketplace-copy.md');
  const marketplaceJsonDocsPath = path.join(docsDir, 'gtm-marketplace-copy.json');
  const queueCsvDocsPath = path.join(docsDir, 'gtm-target-queue.csv');
  const queueJsonlDocsPath = path.join(docsDir, 'gtm-target-queue.jsonl');
  const teamOutreachDocsPath = path.join(docsDir, 'team-outreach-messages.md');
  const operatorHandoffDocsPath = path.join(docsDir, 'operator-priority-handoff.md');
  const operatorHandoffJsonDocsPath = path.join(docsDir, 'operator-priority-handoff.json');
  const operatorSendNowMarkdownDocsPath = path.join(docsDir, 'operator-send-now.md');
  const operatorSendNowCsvDocsPath = path.join(docsDir, 'operator-send-now.csv');
  const operatorSendNowJsonDocsPath = path.join(docsDir, 'operator-send-now.json');
  const markdown = renderRevenueLoopMarkdown(report);
  const marketplaceCopy = report.marketplaceCopy || buildMarketplaceCopy(report);
  const marketplaceMarkdown = renderMarketplaceCopyMarkdown(marketplaceCopy);
  const csv = renderRevenueLoopCsv(report);
  const jsonl = renderRevenueLoopJsonl(report);
  const teamOutreachMarkdown = renderTeamOutreachMessagesMarkdown(report);
  const operatorHandoff = buildOperatorHandoffPayload(report);
  const operatorHandoffMarkdown = renderOperatorHandoffMarkdown(report);
  const operatorSendNow = buildOperatorSendNowPayload(report);
  const operatorSendNowMarkdown = renderOperatorSendNowMarkdown(report);
  const operatorSendNowCsv = renderOperatorSendNowCsv(report);
  const reportDir = normalizeText(options.reportDir)
    ? path.resolve(repoRoot, options.reportDir)
    : '';
  const shouldWriteDocs = options.writeDocs || !reportDir;

  if (reportDir) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'gtm-revenue-loop.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'gtm-revenue-loop.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'gtm-marketplace-copy.md'), marketplaceMarkdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'gtm-marketplace-copy.json'), `${JSON.stringify(marketplaceCopy, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'gtm-target-queue.csv'), csv, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'gtm-target-queue.jsonl'), jsonl, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'team-outreach-messages.md'), teamOutreachMarkdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'operator-priority-handoff.md'), operatorHandoffMarkdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'operator-priority-handoff.json'), `${JSON.stringify(operatorHandoff, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'operator-send-now.md'), operatorSendNowMarkdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'operator-send-now.csv'), operatorSendNowCsv, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'operator-send-now.json'), `${JSON.stringify(operatorSendNow, null, 2)}\n`, 'utf8');
  }

  if (shouldWriteDocs) {
    ensureDir(docsDir);
    fs.writeFileSync(defaultDocsPath, markdown, 'utf8');
    fs.writeFileSync(reportJsonDocsPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(marketplaceDocsPath, marketplaceMarkdown, 'utf8');
    fs.writeFileSync(marketplaceJsonDocsPath, `${JSON.stringify(marketplaceCopy, null, 2)}\n`, 'utf8');
    fs.writeFileSync(queueCsvDocsPath, csv, 'utf8');
    fs.writeFileSync(queueJsonlDocsPath, jsonl, 'utf8');
    fs.writeFileSync(teamOutreachDocsPath, teamOutreachMarkdown, 'utf8');
    fs.writeFileSync(operatorHandoffDocsPath, operatorHandoffMarkdown, 'utf8');
    fs.writeFileSync(operatorHandoffJsonDocsPath, `${JSON.stringify(operatorHandoff, null, 2)}\n`, 'utf8');
    fs.writeFileSync(operatorSendNowMarkdownDocsPath, operatorSendNowMarkdown, 'utf8');
    fs.writeFileSync(operatorSendNowCsvDocsPath, operatorSendNowCsv, 'utf8');
    fs.writeFileSync(operatorSendNowJsonDocsPath, `${JSON.stringify(operatorSendNow, null, 2)}\n`, 'utf8');
  }

  return {
    markdown,
    marketplaceMarkdown,
    teamOutreachMarkdown,
    operatorHandoffMarkdown,
    operatorSendNowMarkdown,
    reportDir: reportDir || null,
    docsPath: shouldWriteDocs ? defaultDocsPath : null,
  };
}

async function runRevenueLoop(options = {}) {
  const links = buildRevenueLinks();
  const motionCatalog = buildMotionCatalog(links);
  const warmTargets = getWarmOutboundTargets(motionCatalog.sprint.cta);
  const { source, summary, fallbackReason, summaryWindow } = await resolveRevenueLoopSummary(options);
  const directive = deriveRevenueDirective(
    summary,
    motionCatalog,
    buildBillingVerification({
      source,
      fallbackReason,
      snapshot: summarizeCommercialSnapshot(summary),
    })
  );
  const { targets, errors } = await prospectTargets(options.maxTargets || 6, {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    githubToken: options.githubToken || '',
    execFileSyncImpl: options.execFileSyncImpl || execFileSync,
  });
  const enrichedTargets = await generateOutreachMessages(targets, motionCatalog);
  const pipelineAwareTargets = applyPipelineStateToTargets(
    warmTargets.concat(enrichedTargets),
    { salesStatePath: options.salesStatePath || null }
  );
  const report = buildRevenueLoopReport({
    source,
    fallbackReason,
    summary,
    motionCatalog,
    directive,
    targets: pipelineAwareTargets,
  });
  report.snapshotWindow = summaryWindow || 'today';
  report.marketplaceCopy = buildMarketplaceCopy(report);

  if (errors.length) {
    report.discoveryWarnings = errors;
  }

  const written = writeRevenueLoopOutputs(report, options);
  return {
    report,
    written,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { report, written } = await runRevenueLoop(options);
  console.log('✅ GSD revenue loop complete.');
  if (written.docsPath) {
    console.log(`Human report: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifact reports: ${written.reportDir}`);
  }
  console.log(JSON.stringify({
    state: report.directive.state,
    paidOrders: report.snapshot.paidOrders,
    bookedRevenueCents: report.snapshot.bookedRevenueCents,
    targets: report.targets.length,
  }, null, 2));
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  COMMERCIAL_TRUTH_LINK,
  TARGET_SEARCH_QUERIES,
  VERIFICATION_EVIDENCE_LINK,
  buildFallbackMessage,
  buildPainConfirmedFollowUp,
  buildSelfServeFollowUp,
  buildCheckoutCloseDraft,
  analyzeTargetEvidence,
  buildMotionCatalog,
  buildRevenueLinks,
  buildRevenueLoopReport,
  clampTargetCount,
  deriveRevenueDirective,
  fetchGitHubJson,
  hasCredibleRepoDescription,
  hasCredibleRepoIdentity,
  hasLowBuyerIntentSignals,
  resolveGitHubApiToken,
  isCliInvocation,
  parseArgs,
  prospectTargets,
  applyPipelineStateToTargets,
  renderRevenueLoopMarkdown,
  renderMarketplaceCopyMarkdown,
  buildOperatorHandoffPayload,
  buildOperatorSendNowPayload,
  renderOperatorHandoffMarkdown,
  renderOperatorSendNowCsv,
  renderTeamOutreachMessagesMarkdown,
  resolveRevenueLoopSummary,
  runRevenueLoop,
  selectOutreachMotion,
  summarizeCommercialSnapshot,
  writeRevenueLoopOutputs,
  buildMarketplaceCopy,
  enrichGitHubTarget,
  renderContactSurfaces,
};
