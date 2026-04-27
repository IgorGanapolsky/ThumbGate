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
  'search/repositories?q=Model+Context+Protocol+approval+workflow+sort:updated',
  'search/repositories?q=ServiceNow+MCP+workflow+sort:updated',
  'search/repositories?q=Claude+Code+review+automation+sort:updated',
  'search/repositories?q=github+review+automation+agent+sort:updated',
];
const SELF_SERVE_ONLY_SIGNALS = /\b(awesome|list|example|template|demo|tutorial|course|personal|dotfiles|toy|boilerplate|learn|learning|playground|starter|sample|sandbox|quickstart|lab)\b/;
const LOW_BUYER_INTENT_SIGNALS = /\b(learn|learning|tutorial|course|playground|starter|sample|sandbox|quickstart|boilerplate|template|demo|example|lab)\b/;
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
];
const CLAIM_GUARDRAILS = [
  'Do not claim revenue, installs, or marketplace approval without direct command evidence.',
  'Do not lead with proof links before the buyer confirms pain.',
  'Keep public pricing and traction claims aligned with COMMERCIAL_TRUTH.md.',
  'Keep proof and quality claims aligned with VERIFICATION_EVIDENCE.md.',
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

function hasLowBuyerIntentSignals(target) {
  const haystack = `${normalizeText(target.repoName)} ${normalizeText(target.description)}`.toLowerCase();
  return LOW_BUYER_INTENT_SIGNALS.test(haystack);
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

  return [
    `Hey @${target.username}, saw you're building around ${targetRef}.`,
    'If one repeated agent mistake or brittle handoff is slowing adoption, I can harden that workflow first. If you only want the self-serve tool path after that, I can point you there.',
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
  const currentTruth = {
    publicSelfServeOffer: motionCatalog.pro.label,
    teamPilotOffer: motionCatalog.sprint.label,
    guideLink: buildRevenueLinks().guideLink,
    commercialTruthLink: motionCatalog.pro.truth,
    verificationEvidenceLink: motionCatalog.pro.proof,
  };

  return {
    generatedAt: new Date().toISOString(),
    source,
    fallbackReason: fallbackReason || null,
    objective: 'First 10 paying customers',
    directive,
    currentTruth,
    evidenceBackstop: buildEvidenceBackstop(currentTruth),
    snapshot,
    targets: targets.map((target) => {
      const followUpMessage = target.followUpMessage
        || buildPainConfirmedFollowUp(target, target.selectedMotion, motionCatalog);
      const evidenceSources = buildEvidenceSources(target, motionCatalog);

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
        evidenceSources,
        claimGuardrails: buildClaimGuardrails(),
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

function resolveMotionLabel(report, motionKey) {
  return motionKey === 'pro'
    ? report.currentTruth.publicSelfServeOffer
    : report.currentTruth.teamPilotOffer;
}

function resolveMotionCta(report, motionKey) {
  const matchingTarget = Array.isArray(report.targets)
    ? report.targets.find((target) => normalizeText(target.motion) === normalizeText(motionKey) && normalizeText(target.cta))
    : null;
  return matchingTarget ? matchingTarget.cta : '';
}

function buildMarketplaceCopy(report) {
  const targets = Array.isArray(report?.targets) ? report.targets : [];
  const signalThemes = MARKETPLACE_SIGNAL_THEMES
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
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
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
    report.directive?.headline || headline,
    signalSentence,
  ].join(' ');
  const longDescription = [
    'ThumbGate is a reliability gateway for AI coding workflows.',
    'It captures repeated failures, regenerates pre-action gates, and keeps approval boundaries, rollback safety, and proof attached to the workflow before the next risky tool call.',
    signalSentence,
    `Primary motion: ${resolveMotionLabel(report, primaryMotion)}.`,
    `Secondary motion: ${resolveMotionLabel(report, secondaryMotion)} after the buyer asks for the self-serve path.`,
  ].join(' ');
  const sampleTargets = targets
    .slice(0, 5)
    .map((target) => ({
      account: normalizeText(target.repoName)
        ? `${target.username}/${target.repoName}`
        : `@${target.username}`,
      temperature: target.temperature || 'cold',
      motion: target.motionLabel || resolveMotionLabel(report, target.motion),
      why: target.motionReason || target.outreachAngle || '',
    }));

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
      `Primary offer: ${resolveMotionLabel(report, primaryMotion)}.`,
      `Secondary offer: ${resolveMotionLabel(report, secondaryMotion)} after the buyer asks for the tool path.`,
      'Keep approval boundaries, rollback safety, and proof attached to the workflow before rollout.',
    ]),
    topSignals: signalThemes,
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
    `- Offer: ${target.offer}`,
    `- Contact: ${target.contactUrl || 'n/a'}`,
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
    '## Evidence Backstop',
    `- Source rule: ${report.evidenceBackstop?.sourceRule || 'Every listing, queue row, and pain-confirmed follow-up must inherit truth and proof links.'}`,
    ...((report.evidenceBackstop?.claimGuardrails || []).map((guardrail) => `- ${guardrail}`)),
    ...((report.evidenceBackstop?.proofLinks || []).map((link) => `- Proof link: ${link}`)),
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

function renderQuotedText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return ['> n/a'];
  }
  return normalized.split('\n').map((line) => `> ${line}`);
}

function renderWarmTargetOutreachMarkdown(target, index) {
  return [
    `## ${index + 1}. ${target.username} (${target.accountName || target.source || 'warm lead'})`,
    `- Source: ${target.source || 'github'} / ${target.channel || target.source || 'github'}`,
    `- Contact: ${target.contactUrl || 'n/a'}`,
    `- Evidence score: ${target.evidenceScore}`,
    `- Evidence: ${target.evidence.length ? target.evidence.join(', ') : 'n/a'}`,
    `- Evidence sources: ${renderEvidenceSources(target.evidenceSources)}`,
    `- Outreach angle: ${target.outreachAngle || 'n/a'}`,
    `- Motion: ${target.motionLabel}`,
    `- Why: ${target.motionReason}`,
    `- Proof timing: ${target.proofPackTrigger || 'Use proof pack only after the buyer confirms pain.'}`,
    `- CTA: ${target.cta}`,
    '',
    'First-touch draft:',
    ...renderQuotedText(target.firstTouchDraft || target.message),
    '',
    'Pain-confirmed follow-up:',
    ...renderQuotedText(target.painConfirmedFollowUpDraft),
    '',
  ];
}

function rankOperatorTargets(targets = []) {
  return [...targets].sort((left, right) => {
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
  const label = normalizeText(target.repoName)
    ? `@${target.username} — ${target.repoName}`
    : `@${target.username} — ${target.accountName || target.source || 'discovery lead'}`;
  const contactSurface = target.contactUrl || target.repoUrl || 'n/a';
  return [
    `## ${index + 1}. ${label}`,
    `- Temperature: ${target.temperature || 'cold'}`,
    `- Source: ${target.source || 'github'} / ${target.channel || target.source || 'github'}`,
    `- Contact surface: ${contactSurface}`,
    `- Evidence score: ${target.evidenceScore}`,
    `- Evidence: ${target.evidence.length ? target.evidence.join(', ') : 'n/a'}`,
    `- Motion: ${target.motionLabel}`,
    `- Why now: ${target.motionReason || target.outreachAngle || 'n/a'}`,
    `- Proof rule: ${target.proofPackTrigger || 'Use proof pack only after the buyer confirms pain.'}`,
    `- CTA: ${target.cta}`,
    '',
    'First-touch draft:',
    ...renderQuotedText(target.firstTouchDraft || target.message),
    '',
    'Pain-confirmed follow-up:',
    ...renderQuotedText(target.painConfirmedFollowUpDraft),
    '',
  ];
}

function renderOperatorHandoffMarkdown(report) {
  const rankedTargets = rankOperatorTargets(Array.isArray(report?.targets) ? report.targets : []);
  const warmTargets = rankedTargets.filter((target) => normalizeText(target.temperature).toLowerCase() === 'warm');
  const coldTargets = rankedTargets.filter((target) => normalizeText(target.temperature).toLowerCase() !== 'warm');
  const warmLines = warmTargets.length
    ? warmTargets.flatMap((target, index) => renderOperatorPriorityTargetMarkdown(target, index))
    : ['- No warm discovery targets are available for this run.', ''];
  const coldLines = coldTargets.length
    ? coldTargets.flatMap((target, index) => renderOperatorPriorityTargetMarkdown(target, index + warmTargets.length))
    : ['- No cold GitHub targets are available for this run.', ''];

  return [
    '# Revenue Operator Priority Handoff',
    '',
    `Updated: ${report.generatedAt}`,
    '',
    'This is the ranked send order for the current zero-to-one revenue loop. Work warm discovery targets first, then expand into cold GitHub targets with the same proof discipline.',
    '',
    'This handoff sits on top of `gtm-revenue-loop.md`, `gtm-target-queue.csv`, and `team-outreach-messages.md` so an operator can decide who to contact next without re-ranking the queue manually.',
    '',
    '## Current Snapshot',
    `- Revenue state: ${report.directive?.state || 'cold-start'}`,
    `- Headline: ${report.directive?.headline || 'No verified revenue and no active pipeline.'}`,
    `- Paid orders: ${report.snapshot?.paidOrders || 0}`,
    `- Checkout starts: ${report.snapshot?.checkoutStarts || 0}`,
    `- Warm targets ready now: ${warmTargets.length}`,
    `- Cold GitHub targets ready next: ${coldTargets.length}`,
    '',
    '## Operator Rules',
    '- Import the queue into the sales ledger before sending anything.',
    '- Lead with one concrete workflow-hardening offer, not generic Pro and not the proof pack.',
    '- Use [VERIFICATION_EVIDENCE.md](../VERIFICATION_EVIDENCE.md) and [COMMERCIAL_TRUTH.md](../COMMERCIAL_TRUTH.md) only after the buyer confirms pain.',
    '',
    '```bash',
    'npm run sales:pipeline -- import --source docs/marketing/gtm-revenue-loop.json',
    '```',
    '',
    '## Send Now: Warm Discovery',
    ...warmLines,
    '## Seed Next: Cold GitHub',
    ...coldLines,
  ].join('\n');
}

function renderTeamOutreachMessagesMarkdown(report) {
  const warmTargets = Array.isArray(report?.targets)
    ? report.targets.filter((target) => target.temperature === 'warm')
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
      'evidenceLinks',
      'claimGuardrails',
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
      renderEvidenceSources(target.evidenceSources),
      (target.claimGuardrails || []).join('; '),
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
  const markdown = renderRevenueLoopMarkdown(report);
  const marketplaceCopy = report.marketplaceCopy || buildMarketplaceCopy(report);
  const marketplaceMarkdown = renderMarketplaceCopyMarkdown(marketplaceCopy);
  const csv = renderRevenueLoopCsv(report);
  const jsonl = renderRevenueLoopJsonl(report);
  const teamOutreachMarkdown = renderTeamOutreachMessagesMarkdown(report);
  const operatorHandoffMarkdown = renderOperatorHandoffMarkdown(report);
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
  }

  return {
    markdown,
    marketplaceMarkdown,
    teamOutreachMarkdown,
    operatorHandoffMarkdown,
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
  hasLowBuyerIntentSignals,
  isCliInvocation,
  parseArgs,
  prospectTargets,
  renderRevenueLoopMarkdown,
  renderMarketplaceCopyMarkdown,
  renderOperatorHandoffMarkdown,
  renderTeamOutreachMessagesMarkdown,
  runRevenueLoop,
  selectOutreachMotion,
  summarizeCommercialSnapshot,
  writeRevenueLoopOutputs,
  buildMarketplaceCopy,
};
