#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveHostedBillingConfig } = require('./hosted-config');
const { getOperationalBillingSummary } = require('./operational-summary');
const { ensureDir } = require('./fs-utils');

const GITHUB_API_BASE_URL = 'https://api.github.com/';
const COMMERCIAL_TRUTH_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md';
const VERIFICATION_EVIDENCE_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';

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

function applyNamedOption(options, argv, index) {
  const arg = argv[index];
  if (arg === '--write-docs') {
    options.writeDocs = true;
    return index;
  }

  if (arg === '--report-dir') {
    const parsed = readFollowingOption(argv, index);
    options.reportDir = parsed.value || options.reportDir;
    return parsed.index;
  }

  if (arg === '--max-targets') {
    const parsed = readFollowingOption(argv, index);
    options.maxTargets = parsed.value ? clampTargetCount(parsed.value) : options.maxTargets;
    return parsed.index;
  }

  return null;
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

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function buildRevenueLinks(config = resolveHostedBillingConfig({
  requestOrigin: 'https://thumbgate-production.up.railway.app',
})) {
  const appOrigin = config.appOrigin;
  return {
    appOrigin,
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

function deriveRevenueDirective(summary = {}, motionCatalog = buildMotionCatalog()) {
  const snapshot = summarizeCommercialSnapshot(summary);

  if (snapshot.paidOrders > 0 || snapshot.bookedRevenueCents > 0) {
    return {
      state: 'post-first-dollar',
      objective: 'Scale the first-10-customers loop with direct workflow hardening and self-serve follow-up.',
      primaryMotion: motionCatalog.sprint.key,
      secondaryMotion: motionCatalog.pro.key,
      headline: 'Revenue is proven. Keep selling one concrete Workflow Hardening Sprint first, then route self-serve buyers to Pro.',
      actions: [
        'Reply to every qualified lead with one offer: "I will harden one AI-agent workflow for you."',
        'Use the proof pack after the buyer names the repeated workflow pain, not as the opener.',
        'Route buyers who only want a tool to the Pro monthly/annual checkout after the pain is qualified.',
        'Publish only booked revenue and paid-order proof from the billing summary or named pilot agreements.',
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

function buildGitHubApiHeaders(token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'thumbgate-gtm-revenue-loop',
    'x-github-api-version': '2022-11-28',
  };

  if (normalizeText(token)) {
    headers.authorization = `Bearer ${normalizeText(token)}`;
  }

  return headers;
}

async function fetchGitHubJson(endpoint, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'global fetch is unavailable', data: null };
  }

  let response;
  try {
    const requestUrl = new URL(endpoint, GITHUB_API_BASE_URL);
    response = await fetchImpl(requestUrl, {
      headers: buildGitHubApiHeaders(),
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

async function prospectTargets(maxTargets = 6, { fetchImpl = globalThis.fetch } = {}) {
  const queries = [
    'search/repositories?q=MCP+Model+Context+Protocol+sort:updated',
    'search/repositories?q=Claude+Code+MCP+sort:updated',
  ];

  const combined = [];
  const errors = [];
  for (const endpoint of queries) {
    const response = await fetchGitHubJson(endpoint, { fetchImpl });
    if (!response.ok) {
      errors.push(response.error);
      continue;
    }

    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    for (const repo of items.slice(0, maxTargets * 2)) {
      combined.push({
        username: repo.owner?.login || 'unknown',
        repoName: repo.name || 'unknown-repo',
        repoUrl: repo.html_url || '',
        description: normalizeText(repo.description) || 'No description provided.',
        stars: Number(repo.stargazers_count || 0),
        updatedAt: repo.updated_at || null,
      });
    }
  }

  return {
    targets: dedupeTargets(combined).slice(0, maxTargets),
    errors,
  };
}

function selectOutreachMotion(target, motionCatalog = buildMotionCatalog()) {
  const haystack = `${normalizeText(target.repoName)} ${normalizeText(target.description)}`.toLowerCase();
  const proOnlySignals = /(awesome|list|example|template|demo|tutorial|course|personal|dotfiles|toy)/;
  if (proOnlySignals.test(haystack)) {
    return {
      key: motionCatalog.pro.key,
      label: motionCatalog.pro.label,
      reason: 'Target looks like a low-urgency self-serve/tooling fit, so Pro is the fallback CTA.',
    };
  }

  const sprintSignals = /(agent|mcp|platform|workflow|ops|compliance|audit|enterprise|production|reliability|rollout|incident|governance|server|bridge|workspace)/;
  if (sprintSignals.test(haystack) || haystack.trim().length > 0) {
    return {
      key: motionCatalog.sprint.key,
      label: motionCatalog.sprint.label,
      reason: 'Target can be approached with one concrete workflow-hardening offer before any generic Pro pitch.',
    };
  }

  return {
    key: motionCatalog.sprint.key,
    label: motionCatalog.sprint.label,
    reason: 'Default outbound motion is the Workflow Hardening Sprint; Pro remains the self-serve follow-up.',
  };
}

function buildFallbackMessage(target, selectedMotion, motionCatalog = buildMotionCatalog()) {
  const motion = motionCatalog[selectedMotion.key];
  const repoRef = `\`${target.repoName}\``;
  if (selectedMotion.key === motionCatalog.sprint.key) {
    return [
      `Hey @${target.username}, saw you're shipping ${repoRef}. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention gate, and a proof run.`,
      `If ${repoRef} has one workflow that keeps breaking or losing context, I can harden that workflow for you: ${motion.cta}`
    ].join(' ');
  }

  return [
    `Hey @${target.username}, saw you're building around ${repoRef}. If you only want the self-serve path, ThumbGate Pro gives you compaction-safe memory and feedback-to-gate enforcement: ${motion.cta}`,
    'If you have a painful workflow instead, I can harden one concrete workflow first.'
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
      message,
    });
  }

  return results;
}

function buildRevenueLoopReport({ source, fallbackReason, summary, motionCatalog, directive, targets }) {
  const snapshot = summarizeCommercialSnapshot(summary);

  return {
    generatedAt: new Date().toISOString(),
    source,
    fallbackReason: fallbackReason || null,
    objective: 'First 10 paying customers',
    directive,
    currentTruth: {
      publicSelfServeOffer: motionCatalog.pro.label,
      teamPilotOffer: motionCatalog.sprint.label,
      commercialTruthLink: motionCatalog.pro.truth,
      verificationEvidenceLink: motionCatalog.pro.proof,
    },
    snapshot,
    targets: targets.map((target) => ({
      username: target.username,
      repoName: target.repoName,
      repoUrl: target.repoUrl,
      description: target.description,
      stars: target.stars,
      updatedAt: target.updatedAt,
      motion: target.selectedMotion.key,
      motionLabel: target.selectedMotion.label,
      motionReason: target.selectedMotion.reason,
      pipelineStage: 'targeted',
      offer: target.selectedMotion.key === motionCatalog.sprint.key ? 'workflow_hardening_sprint' : 'pro_self_serve',
      cta: motionCatalog[target.selectedMotion.key].cta,
      message: target.message,
    })),
  };
}

function renderRevenueTargetMarkdown(target) {
  return [
    `### @${target.username} — ${target.repoName}`,
    `- Pipeline stage: ${target.pipelineStage}`,
    `- Offer: ${target.offer}`,
    `- Repo: ${target.repoUrl || 'n/a'}`,
    `- Motion: ${target.motionLabel}`,
    `- Why: ${target.motionReason}`,
    `- CTA: ${target.cta}`,
    `- Outreach draft: ${target.message}`,
    '',
  ];
}

function renderRevenueLoopMarkdown(report) {
  const fallbackReason = report.fallbackReason ? ` (${report.fallbackReason})` : '';
  const targetLines = report.targets.length
    ? report.targets.flatMap(renderRevenueTargetMarkdown)
    : ['- No GitHub targets were discovered in this run. Re-run with authenticated `gh` access.'];
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
    '## Revenue Snapshot',
    `- Paid orders: ${report.snapshot.paidOrders}`,
    `- Booked revenue: $${(report.snapshot.bookedRevenueCents / 100).toFixed(2)}`,
    `- Checkout starts: ${report.snapshot.checkoutStarts}`,
    `- Unique leads: ${report.snapshot.uniqueLeads}`,
    `- Workflow sprint leads: ${report.snapshot.sprintLeads}`,
    `- Qualified sprint leads: ${report.snapshot.qualifiedSprintLeads}`,
    `- Billing source: ${report.source}${fallbackReason}`,
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
    '## Target Queue',
    ...targetLines,
  ];

  return `${lines.join('\n').trim()}\n`;
}

function writeRevenueLoopOutputs(report, options = {}) {
  const repoRoot = path.resolve(__dirname, '..');
  const defaultDocsPath = path.join(repoRoot, 'docs', 'AUTONOMOUS_GITOPS.md');
  const markdown = renderRevenueLoopMarkdown(report);
  const reportDir = normalizeText(options.reportDir)
    ? path.resolve(repoRoot, options.reportDir)
    : '';
  const shouldWriteDocs = options.writeDocs || !reportDir;

  if (reportDir) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'gtm-revenue-loop.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'gtm-revenue-loop.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (shouldWriteDocs) {
    fs.writeFileSync(defaultDocsPath, markdown, 'utf8');
  }

  return {
    markdown,
    reportDir: reportDir || null,
    docsPath: shouldWriteDocs ? defaultDocsPath : null,
  };
}

async function runRevenueLoop(options = {}) {
  const links = buildRevenueLinks();
  const motionCatalog = buildMotionCatalog(links);
  const { source, summary, fallbackReason } = await getOperationalBillingSummary();
  const directive = deriveRevenueDirective(summary, motionCatalog);
  const { targets, errors } = await prospectTargets(options.maxTargets || 6, {
    fetchImpl: options.fetchImpl || globalThis.fetch,
  });
  const enrichedTargets = await generateOutreachMessages(targets, motionCatalog);
  const report = buildRevenueLoopReport({
    source,
    fallbackReason,
    summary,
    motionCatalog,
    directive,
    targets: enrichedTargets,
  });

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
  VERIFICATION_EVIDENCE_LINK,
  buildFallbackMessage,
  buildMotionCatalog,
  buildRevenueLinks,
  buildRevenueLoopReport,
  clampTargetCount,
  deriveRevenueDirective,
  fetchGitHubJson,
  isCliInvocation,
  parseArgs,
  prospectTargets,
  renderRevenueLoopMarkdown,
  runRevenueLoop,
  selectOutreachMotion,
  summarizeCommercialSnapshot,
  writeRevenueLoopOutputs,
};
