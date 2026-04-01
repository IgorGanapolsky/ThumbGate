#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { GoogleGenAI } = require('@google/genai');
const { resolveHostedBillingConfig } = require('./hosted-config');
const { getOperationalBillingSummary } = require('./operational-summary');

const COMMERCIAL_TRUTH_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md';
const VERIFICATION_EVIDENCE_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';

function parseArgs(argv = []) {
  const options = {
    maxTargets: 6,
    reportDir: '',
    writeDocs: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write-docs') {
      options.writeDocs = true;
      continue;
    }

    if (arg === '--report-dir' && argv[index + 1]) {
      options.reportDir = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg.startsWith('--report-dir=')) {
      options.reportDir = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg === '--max-targets' && argv[index + 1]) {
      options.maxTargets = clampTargetCount(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith('--max-targets=')) {
      options.maxTargets = clampTargetCount(arg.split('=').slice(1).join('='));
    }
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

function ensureDir(dirPath) {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function buildRevenueLinks(config = resolveHostedBillingConfig({
  requestOrigin: 'https://rlhf-feedback-loop-production.up.railway.app',
})) {
  const appOrigin = config.appOrigin;
  return {
    appOrigin,
    proCheckoutLink: `${appOrigin}/checkout/pro?packId=mistake-free-starter`,
    sprintLink: `${appOrigin}/#workflow-sprint-intake`,
    commercialTruthLink: COMMERCIAL_TRUTH_LINK,
    verificationEvidenceLink: VERIFICATION_EVIDENCE_LINK,
    proPriceLabel: '$19/mo',
    proOfferLabel: `Pro at $19/mo`,
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
      objective: 'Scale the first-10-customers loop with proof-backed self-serve follow-up.',
      primaryMotion: motionCatalog.pro.key,
      secondaryMotion: motionCatalog.sprint.key,
      headline: 'Revenue is proven. Double down on the self-serve Pro CTA and use the sprint motion for expansion deals.',
      actions: [
        'Reply to every qualified builder lead with the Pro checkout path and the proof pack.',
        'Use the Workflow Hardening Sprint only when a team already has one workflow owner and a rollout blocker.',
        'Publish only booked revenue and paid-order proof from the billing summary or named pilot agreements.',
      ],
    };
  }

  if (snapshot.checkoutStarts > 0 || snapshot.uniqueLeads > 0 || snapshot.sprintLeads > 0) {
    return {
      state: 'pipeline-active-no-revenue',
      objective: 'Convert existing interest into the first paid orders without inventing traction.',
      primaryMotion: motionCatalog.pro.key,
      secondaryMotion: motionCatalog.sprint.key,
      headline: 'Interest exists but paid conversion is still zero. Push the $19/mo Pro CTA to builders and reserve sprint outreach for team workflows.',
      actions: [
        'Follow up on every checkout start or lead within one business day.',
        'Use the Pro self-serve path as the default CTA unless the target clearly has team-level rollout pain.',
        'Attach Commercial Truth and Verification Evidence in every outbound thread so the offer stays defensible.',
      ],
    };
  }

  return {
    state: 'cold-start',
    objective: 'Land the first 10 paying customers with a founder-led, proof-backed dual motion.',
    primaryMotion: motionCatalog.pro.key,
    secondaryMotion: motionCatalog.sprint.key,
    headline: 'No verified revenue and no active pipeline. Run dual motion: Pro for individual builders, sprint for teams with one workflow problem.',
    actions: [
      'Lead builder outreach with Pro at $19/mo and the direct checkout link.',
      'Route platform or ops teams to the Workflow Hardening Sprint intake only when they fit the qualification bar.',
      'Treat stars, traffic, and model praise as noise until they become paid orders or named pilot agreements.',
    ],
  };
}

function runGhJson(endpoint) {
  const result = spawnSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    env: process.env,
  });

  if (result.status !== 0) {
    const detail = normalizeText(result.stderr) || normalizeText(result.stdout) || 'unknown gh api failure';
    return { ok: false, error: detail, data: null };
  }

  try {
    return { ok: true, error: '', data: JSON.parse(result.stdout) };
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

function prospectTargets(maxTargets = 6) {
  const queries = [
    'search/repositories?q=MCP+Model+Context+Protocol+sort:updated',
    'search/repositories?q=Claude+Code+MCP+sort:updated',
  ];

  const combined = [];
  const errors = [];
  for (const endpoint of queries) {
    const response = runGhJson(endpoint);
    if (!response.ok) {
      errors.push(response.error);
      continue;
    }

    const items = response.data && Array.isArray(response.data.items) ? response.data.items : [];
    for (const repo of items.slice(0, maxTargets * 2)) {
      combined.push({
        username: repo.owner && repo.owner.login ? repo.owner.login : 'unknown',
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
  const sprintSignals = /(platform|workflow|ops|compliance|audit|enterprise|production|reliability|rollout|incident|governance)/;
  if (sprintSignals.test(haystack)) {
    return {
      key: motionCatalog.sprint.key,
      label: motionCatalog.sprint.label,
      reason: 'Target language suggests a team workflow or production rollout problem.',
    };
  }

  return {
    key: motionCatalog.pro.key,
    label: motionCatalog.pro.label,
    reason: 'Target looks builder-led, so the self-serve Pro CTA is the lowest-friction path.',
  };
}

function buildFallbackMessage(target, selectedMotion, motionCatalog = buildMotionCatalog()) {
  const motion = motionCatalog[selectedMotion.key];
  const repoRef = `\`${target.repoName}\``;
  if (selectedMotion.key === motionCatalog.sprint.key) {
    return [
      `Hey @${target.username}, saw you're shipping ${repoRef}. If your production workflows are losing critical architectural context to auto-compaction, I am pitching a Workflow Hardening Sprint for one workflow, one owner, and one proof review: ${motion.cta}`,
      `Commercial truth: ${motion.truth}. Proof pack: ${motion.proof}.`
    ].join(' ');
  }

  return [
    `Hey @${target.username}, saw you're building around ${repoRef}. If you're hitting "Claude amnesia" or losing architectural constraints to auto-compaction between sessions, the self-serve path is compaction-safe memory with ThumbGate ${motionCatalog.pro.label}: ${motion.cta}`,
    `Commercial truth: ${motion.truth}. Proof pack: ${motion.proof}.`
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
      cta: motionCatalog[target.selectedMotion.key].cta,
      message: target.message,
    })),
  };
}

function renderRevenueLoopMarkdown(report) {
  const lines = [];
  lines.push('# GSD Revenue Loop');
  lines.push('');
  lines.push(`Status: ${report.directive.state}`);
  lines.push(`Updated: ${report.generatedAt}`);
  lines.push('');
  lines.push('This report is an operator artifact for landing the first 10 paying customers. It is not proof of sent messages or booked revenue by itself.');
  lines.push('');
  lines.push('## Current Truth');
  lines.push(`- Public self-serve offer: ${report.currentTruth.publicSelfServeOffer}`);
  lines.push(`- Team/pilot motion: ${report.currentTruth.teamPilotOffer}`);
  lines.push(`- Commercial truth: ${report.currentTruth.commercialTruthLink}`);
  lines.push(`- Verification evidence: ${report.currentTruth.verificationEvidenceLink}`);
  lines.push('');
  lines.push('## Revenue Snapshot');
  lines.push(`- Paid orders: ${report.snapshot.paidOrders}`);
  lines.push(`- Booked revenue: $${(report.snapshot.bookedRevenueCents / 100).toFixed(2)}`);
  lines.push(`- Checkout starts: ${report.snapshot.checkoutStarts}`);
  lines.push(`- Unique leads: ${report.snapshot.uniqueLeads}`);
  lines.push(`- Workflow sprint leads: ${report.snapshot.sprintLeads}`);
  lines.push(`- Qualified sprint leads: ${report.snapshot.qualifiedSprintLeads}`);
  lines.push(`- Billing source: ${report.source}${report.fallbackReason ? ` (${report.fallbackReason})` : ''}`);
  lines.push('');
  lines.push('## GSD Directive');
  lines.push(`- Objective: ${report.directive.objective}`);
  lines.push(`- Headline: ${report.directive.headline}`);
  lines.push(`- Primary motion: ${report.directive.primaryMotion}`);
  lines.push(`- Secondary motion: ${report.directive.secondaryMotion}`);
  lines.push('');
  lines.push('## Immediate Actions');
  report.directive.actions.forEach((action) => lines.push(`- ${action}`));
  lines.push('');
  lines.push('## Target Queue');
  if (report.targets.length === 0) {
    lines.push('- No GitHub targets were discovered in this run. Re-run with authenticated `gh` access.');
  } else {
    report.targets.forEach((target) => {
      lines.push(`### @${target.username} — ${target.repoName}`);
      lines.push(`- Repo: ${target.repoUrl || 'n/a'}`);
      lines.push(`- Motion: ${target.motionLabel}`);
      lines.push(`- Why: ${target.motionReason}`);
      lines.push(`- CTA: ${target.cta}`);
      lines.push(`- Outreach draft: ${target.message}`);
      lines.push('');
    });
  }

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
  const { targets, errors } = prospectTargets(options.maxTargets || 6);
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
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
  parseArgs,
  prospectTargets,
  renderRevenueLoopMarkdown,
  runRevenueLoop,
  selectOutreachMotion,
  summarizeCommercialSnapshot,
  writeRevenueLoopOutputs,
};
