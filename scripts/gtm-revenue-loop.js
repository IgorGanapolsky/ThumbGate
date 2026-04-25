#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveHostedBillingConfig } = require('./hosted-config');
const { getOperationalBillingSummary } = require('./operational-summary');
const { ensureDir } = require('./fs-utils');
const { getWarmOutboundTargets } = require('./warm-outreach-targets');

const GITHUB_API_BASE_URL = 'https://api.github.com/';
const COMMERCIAL_TRUTH_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md';
const VERIFICATION_EVIDENCE_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';
const TARGET_SEARCH_QUERIES = [
  'search/repositories?q=Model+Context+Protocol+workflow+automation+sort:updated',
  'search/repositories?q=Model+Context+Protocol+production+security+sort:stars',
  'search/repositories?q=Claude+Code+review+automation+sort:updated',
];
const SELF_SERVE_ONLY_SIGNALS = /\b(awesome|list|example|template|demo|tutorial|course|personal|dotfiles|toy|boilerplate)\b/;
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
];

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

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
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

  let outreachAngle = 'Pitch one repeated workflow failure, then offer proof-backed hardening instead of a generic tool trial.';
  if (/\b(jira|github|gitlab|microsoft ?365|office|google drive|calendar|slack|salesforce|crm|analytics)\b/.test(haystack)) {
    outreachAngle = 'Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.';
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

async function prospectTargets(maxTargets = 6, { fetchImpl = globalThis.fetch } = {}) {
  const combined = [];
  const errors = [];
  for (const endpoint of TARGET_SEARCH_QUERIES) {
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
      if (SELF_SERVE_ONLY_SIGNALS.test(`${target.repoName} ${target.description}`.toLowerCase())) {
        return target.evidence.score >= 6;
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

  return {
    targets: ranked.slice(0, maxTargets),
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

function buildFallbackMessage(target, selectedMotion, motionCatalog = buildMotionCatalog()) {
  const motion = motionCatalog[selectedMotion.key];
  const repoRef = `\`${target.repoName}\``;
  const angle = normalizeText(target.evidence?.outreachAngle);
  if (selectedMotion.key === motionCatalog.sprint.key) {
    return [
      `Hey @${target.username}, saw you're shipping ${repoRef}. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention gate, and a proof run.`,
      angle ? `${angle}` : '',
      `If ${repoRef} has one workflow that keeps breaking or losing context, I can harden that workflow for you: ${motion.cta}`
    ].join(' ');
  }

  return [
    `Hey @${target.username}, saw you're building around ${repoRef}. If you only want the self-serve path, ThumbGate Pro gives you compaction-safe memory and feedback-to-gate enforcement: ${motion.cta}`,
    'If you have a painful workflow instead, I can harden one concrete workflow first.'
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
    targets: targets.map((target) => {
      const followUpMessage = target.followUpMessage
        || buildPainConfirmedFollowUp(target, target.selectedMotion, motionCatalog);

      return {
        temperature: normalizeText(target.temperature) || 'cold',
        source: normalizeText(target.source) || 'github',
        channel: normalizeText(target.channel) || normalizeText(target.source) || 'github',
        username: target.username,
        accountName: normalizeText(target.accountName) || normalizeText(target.username) || '',
        contactUrl: normalizeText(target.contactUrl) || '',
        repoName: target.repoName,
        repoUrl: target.repoUrl,
        description: target.description,
        stars: target.stars,
        updatedAt: target.updatedAt,
        evidenceScore: target.evidence?.score || 0,
        evidence: target.evidence?.evidence || [],
        outreachAngle: target.evidence?.outreachAngle || '',
        evidenceSource: target.repoUrl || '',
        motion: target.selectedMotion.key,
        motionLabel: target.selectedMotion.label,
        motionReason: target.selectedMotion.reason,
        pipelineStage: 'targeted',
        offer: target.selectedMotion.key === motionCatalog.sprint.key ? 'workflow_hardening_sprint' : 'pro_self_serve',
        cta: motionCatalog[target.selectedMotion.key].cta,
        proofPackTrigger: target.proofPackTrigger || 'Use proof pack only after the buyer confirms pain.',
        firstTouchDraft: target.message,
        painConfirmedFollowUpDraft: followUpMessage,
        message: target.message,
      };
    }),
  };
}

function renderRevenueTargetMarkdown(target) {
  return [
    `### @${target.username} — ${target.repoName || target.accountName || 'warm discovery lead'}`,
    `- Temperature: ${target.temperature || 'cold'}`,
    `- Source: ${target.source || 'github'} / ${target.channel || target.source || 'github'}`,
    `- Pipeline stage: ${target.pipelineStage}`,
    `- Offer: ${target.offer}`,
    `- Contact: ${target.contactUrl || 'n/a'}`,
    `- Repo: ${target.repoUrl || 'n/a'}`,
    `- Repo last updated: ${target.updatedAt || 'n/a'}`,
    `- Evidence score: ${target.evidenceScore}`,
    `- Evidence: ${target.evidence.length ? target.evidence.join(', ') : 'n/a'}`,
    `- Outreach angle: ${target.outreachAngle || 'n/a'}`,
    `- Motion: ${target.motionLabel}`,
    `- Why: ${target.motionReason}`,
    `- Proof timing: ${target.proofPackTrigger || 'Use proof pack only after the buyer confirms pain.'}`,
    `- CTA: ${target.cta}`,
    `- First-touch draft: ${target.firstTouchDraft || target.message}`,
    `- Pain-confirmed follow-up: ${target.painConfirmedFollowUpDraft || 'n/a'}`,
    '',
  ];
}

function renderRevenueLoopMarkdown(report) {
  const fallbackReason = report.fallbackReason ? ` (${report.fallbackReason})` : '';
  const warmTargets = report.targets.filter((target) => target.temperature === 'warm');
  const coldTargets = report.targets.filter((target) => target.temperature !== 'warm');
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
    '## Warm Discovery Queue',
    ...warmTargetLines,
    '',
    '## Cold GitHub Queue',
    ...coldTargetLines,
  ];

  return `${lines.join('\n').trim()}\n`;
}

function escapeCsvValue(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const escaped = text.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function renderRevenueLoopCsv(report) {
  const rows = [
    [
      'temperature',
      'source',
      'channel',
      'username',
      'accountName',
      'contactUrl',
      'repoName',
      'repoUrl',
      'updatedAt',
      'offer',
      'pipelineStage',
      'evidenceScore',
      'evidence',
      'evidenceSource',
      'outreachAngle',
      'motionLabel',
      'motionReason',
      'proofPackTrigger',
      'cta',
      'firstTouchDraft',
      'painConfirmedFollowUpDraft',
    ],
    ...report.targets.map((target) => ([
      target.temperature || 'cold',
      target.source || 'github',
      target.channel || target.source || 'github',
      target.username,
      target.accountName || '',
      target.contactUrl || '',
      target.repoName,
      target.repoUrl,
      target.updatedAt,
      target.offer,
      target.pipelineStage,
      String(target.evidenceScore),
      target.evidence.join('; '),
      target.evidenceSource,
      target.outreachAngle,
      target.motionLabel,
      target.motionReason,
      target.proofPackTrigger,
      target.cta,
      target.firstTouchDraft || target.message,
      target.painConfirmedFollowUpDraft,
    ])),
  ];

  return `${rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')}\n`;
}

function renderRevenueLoopJsonl(report) {
  return `${report.targets.map((target) => JSON.stringify(target)).join('\n')}\n`;
}

function writeRevenueLoopOutputs(report, options = {}) {
  const repoRoot = path.resolve(__dirname, '..');
  const defaultDocsPath = path.join(repoRoot, 'docs', 'AUTONOMOUS_GITOPS.md');
  const markdown = renderRevenueLoopMarkdown(report);
  const csv = renderRevenueLoopCsv(report);
  const jsonl = renderRevenueLoopJsonl(report);
  const reportDir = normalizeText(options.reportDir)
    ? path.resolve(repoRoot, options.reportDir)
    : '';
  const shouldWriteDocs = options.writeDocs || !reportDir;

  if (reportDir) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'gtm-revenue-loop.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'gtm-revenue-loop.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'gtm-target-queue.csv'), csv, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'gtm-target-queue.jsonl'), jsonl, 'utf8');
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
  const warmTargets = getWarmOutboundTargets(motionCatalog.sprint.cta);
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
    targets: warmTargets.concat(enrichedTargets),
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
  buildPainConfirmedFollowUp,
  analyzeTargetEvidence,
  buildMotionCatalog,
  buildRevenueLinks,
  buildRevenueLoopReport,
  clampTargetCount,
  deriveRevenueDirective,
  fetchGitHubJson,
  hasCredibleRepoDescription,
  hasCredibleRepoIdentity,
  isCliInvocation,
  parseArgs,
  prospectTargets,
  renderRevenueLoopMarkdown,
  runRevenueLoop,
  selectOutreachMotion,
  summarizeCommercialSnapshot,
  writeRevenueLoopOutputs,
};
