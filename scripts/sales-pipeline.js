#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getFeedbackPaths } = require('./feedback-paths');
const { appendJsonl, ensureParentDir, readJsonl } = require('./fs-utils');

const SALES_PIPELINE_FILE = 'sales-pipeline.jsonl';
const SALES_PIPELINE_PATH_ENV = 'THUMBGATE_SALES_PIPELINE_PATH';
const SALES_STAGE_FLOW = [
  'targeted',
  'contacted',
  'replied',
  'call_booked',
  'checkout_started',
  'sprint_intake',
  'paid',
  'lost',
];

const SALES_STAGE_TRANSITIONS = {
  targeted: ['contacted', 'lost'],
  contacted: ['replied', 'lost'],
  replied: ['call_booked', 'checkout_started', 'sprint_intake', 'lost'],
  call_booked: ['checkout_started', 'sprint_intake', 'paid', 'lost'],
  checkout_started: ['paid', 'lost'],
  sprint_intake: ['paid', 'lost'],
  paid: ['lost'],
  lost: [],
};

const SALES_EVIDENCE_KINDS = Object.freeze([
  'platform_send_receipt',
  'buyer_reply',
  'booking_confirmation',
  'provider_checkout_session',
  'buyer_checkout_confirmation',
  'intake_submission',
  'workflow_materials_received',
  'provider_payment',
  'provider_refund',
  'buyer_declined',
  'operator_disqualified',
  'stale_closed',
  'operator_note',
]);

const SALES_STAGE_EVIDENCE_KINDS = Object.freeze({
  targeted: [],
  contacted: ['platform_send_receipt'],
  replied: ['buyer_reply'],
  call_booked: ['booking_confirmation'],
  checkout_started: ['provider_checkout_session', 'buyer_checkout_confirmation'],
  sprint_intake: ['intake_submission', 'workflow_materials_received'],
  paid: ['provider_payment'],
  lost: ['buyer_declined', 'operator_disqualified', 'stale_closed', 'provider_refund'],
});

const VERIFIED_PAYMENT_PROVIDERS = Object.freeze(['paypal', 'stripe']);
const VERIFIED_PAYMENT_SOURCE_PATTERN = /^provider_api_live:.+/;
const VERIFIED_PAYMENT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

const LEGACY_TIMESTAMP_FALLBACK = '1970-01-01T00:00:00.000Z';

function normalizeText(value, maxLength = 1000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeUrl(value) {
  const text = normalizeText(value, 1000);
  if (!text) return null;
  try {
    return new URL(text).toString();
  } catch {
    return text;
  }
}

function normalizeSalesStage(value, fallback = null) {
  const normalized = normalizeText(value, 80);
  if (!normalized) return fallback;
  return SALES_STAGE_FLOW.includes(normalized) ? normalized : fallback;
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSalesEvidence(value = {}) {
  const evidence = value && typeof value === 'object' ? value : {};
  const normalized = {
    kind: normalizeText(evidence.kind, 80),
    provider: normalizeText(evidence.provider, 80)?.toLowerCase() || null,
    source: normalizeText(evidence.source, 160),
    reference: normalizeText(evidence.reference, 1000),
    verified: evidence.verified === true,
    digest: normalizeText(evidence.digest, 160)?.toLowerCase() || null,
  };
  const invoiceId = normalizeText(evidence.invoiceId, 127);
  if (invoiceId) normalized.invoiceId = invoiceId;
  const offerId = normalizeText(evidence.offerId, 120);
  if (offerId) normalized.offerId = offerId;
  const buyerDigest = normalizeText(evidence.buyerDigest, 80)?.toLowerCase() || null;
  if (buyerDigest) normalized.buyerDigest = buyerDigest;
  return normalized;
}

function buildSalesEvidence(payload = {}) {
  return normalizeSalesEvidence({
    kind: payload.evidenceKind || payload.evidence?.kind,
    provider: payload.evidenceProvider || payload.evidence?.provider,
    source: payload.evidenceSource || payload.evidence?.source,
    reference: payload.evidenceRef || payload.evidenceReference
      || payload.evidence?.reference,
    verified: payload.evidenceVerified === true || payload.evidence?.verified === true,
    digest: payload.evidenceDigest || payload.evidence?.digest,
    invoiceId: payload.evidenceInvoiceId || payload.evidence?.invoiceId,
    offerId: payload.evidenceOfferId || payload.evidence?.offerId,
    buyerDigest: payload.evidenceBuyerDigest || payload.evidence?.buyerDigest,
  });
}

function isVerifiedProviderFinancialEvidence(evidence = {}) {
  return ['provider_payment', 'provider_refund'].includes(evidence.kind)
    && VERIFIED_PAYMENT_PROVIDERS.includes(evidence.provider)
    && evidence.verified === true
    && VERIFIED_PAYMENT_SOURCE_PATTERN.test(evidence.source || '')
    && VERIFIED_PAYMENT_DIGEST_PATTERN.test(evidence.digest || '')
    && Boolean(evidence.offerId)
    && VERIFIED_PAYMENT_DIGEST_PATTERN.test(evidence.buyerDigest || '');
}

function evidenceSupportsStage(stage, evidence = {}) {
  if (stage === 'targeted') return true;
  const allowed = SALES_STAGE_EVIDENCE_KINDS[stage] || [];
  const containsPlaceholder = [evidence.source, evidence.reference]
    .some((value) => /^REPLACE_WITH_/i.test(String(value || '').trim()));
  const structurallySupported = allowed.includes(evidence.kind)
    && Boolean(evidence.source)
    && Boolean(evidence.reference)
    && !containsPlaceholder;
  if (!structurallySupported) return false;
  if (stage === 'paid') return evidence.kind === 'provider_payment' && isVerifiedProviderFinancialEvidence(evidence);
  if (evidence.kind === 'provider_refund') return stage === 'lost' && isVerifiedProviderFinancialEvidence(evidence);
  return true;
}

function validateKnownEvidence(evidence = {}) {
  if (!evidence.kind || !SALES_EVIDENCE_KINDS.includes(evidence.kind)) {
    throw new Error(`evidenceKind must be one of: ${SALES_EVIDENCE_KINDS.join(', ')}`);
  }
  if (!evidence.source) throw new Error('evidenceSource is required.');
  if (!evidence.reference) throw new Error('evidenceRef is required.');
  if (/^REPLACE_WITH_/i.test(evidence.source) || /^REPLACE_WITH_/i.test(evidence.reference)) {
    throw new Error('Replace evidence placeholders with an actual provider or buyer receipt before advancing.');
  }
  if (['provider_payment', 'provider_refund'].includes(evidence.kind)) {
    if (!isVerifiedProviderFinancialEvidence(evidence)) {
      throw new Error('Provider payment/refund evidence must come from provider-payment reconciliation with a supported provider, live provider API source, verified=true, and sha256 evidence digest.');
    }
  }
  return evidence;
}

function validateStageEvidence(stage, payload = {}) {
  if (stage === 'targeted') return normalizeSalesEvidence();
  const evidence = validateKnownEvidence(buildSalesEvidence(payload));
  const allowed = SALES_STAGE_EVIDENCE_KINDS[stage] || [];
  if (!allowed.includes(evidence.kind)) {
    throw new Error(`stage ${stage} requires evidenceKind: ${allowed.join(' or ')}`);
  }
  if (stage === 'paid' && normalizeInteger(payload.amountCents, 0) <= 0) {
    throw new Error('stage paid requires amountCents greater than 0.');
  }
  return evidence;
}

function slugify(value, fallback = 'lead') {
  const normalized = normalizeText(value, 320);
  if (!normalized) return fallback;
  let slug = '';
  let pendingSeparator = false;
  for (const char of normalized.toLowerCase()) {
    const code = char.codePointAt(0);
    const alphaNumeric = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (alphaNumeric) {
      if (pendingSeparator && slug) slug += '_';
      slug += char;
      pendingSeparator = false;
    } else {
      pendingSeparator = true;
    }
  }
  return slug || fallback;
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 10);
}

function buildSalesLeadId(entry = {}) {
  const explicit = normalizeText(entry.leadId, 160);
  if (explicit) return explicit;

  const source = normalizeText(entry.source, 80) || 'manual';
  const username = normalizeText(entry.contact?.username, 160)
    || normalizeText(entry.username, 160);
  const repoName = normalizeText(entry.account?.repoName, 200)
    || normalizeText(entry.repoName, 200);
  const accountName = normalizeText(entry.account?.name, 200)
    || normalizeText(entry.company, 200);
  const stableKey = [source, username, repoName || accountName].filter(Boolean).join(':');

  if (stableKey) {
    return slugify(stableKey, `lead_${shortHash(JSON.stringify(entry))}`);
  }
  return `lead_${shortHash(JSON.stringify(entry))}`;
}

function buildHistoryEntry({
  fromStage = null,
  toStage,
  at = null,
  actor = null,
  channel = null,
  note = null,
  url = null,
  timestamp = null,
  evidence = null,
} = {}) {
  const resolvedTimestamp = timestamp || at || new Date().toISOString();
  return {
    fromStage: normalizeSalesStage(fromStage, null),
    toStage: normalizeSalesStage(toStage, 'targeted'),
    at: normalizeText(resolvedTimestamp, 64) || new Date().toISOString(),
    actor: normalizeText(actor, 160),
    channel: normalizeText(channel, 80),
    note: normalizeText(note, 2000),
    url: normalizeUrl(url),
    evidence: normalizeSalesEvidence(evidence || {}),
  };
}

function normalizeLeadHistory(entry, stage, updatedAt) {
  const hasHistory = Array.isArray(entry.history) ? entry.history.length > 0 : false;
  return hasHistory
    ? entry.history.map((item) => buildHistoryEntry(item))
    : [buildHistoryEntry({
      toStage: stage,
      actor: entry.actor || 'sales-pipeline',
      channel: entry.channel || entry.source || 'manual',
      note: entry.note || 'Lead entered pipeline.',
      timestamp: updatedAt,
      evidence: entry.evidence,
    })];
}

function normalizeLeadContact(entry = {}) {
  const contact = entry.contact || {};
  return {
    username: normalizeText(contact.username, 160),
    name: normalizeText(contact.name, 160),
    email: normalizeText(contact.email, 320),
    url: normalizeUrl(contact.url),
  };
}

function normalizeLeadAccount(entry = {}) {
  const account = entry.account || {};
  return {
    name: normalizeText(account.name, 200),
    repoName: normalizeText(account.repoName, 200),
    repoUrl: normalizeUrl(account.repoUrl),
    description: normalizeText(account.description, 1000),
    stars: normalizeInteger(account.stars, 0),
    updatedAt: normalizeText(account.updatedAt, 64),
  };
}

function normalizeLeadQualification(entry = {}) {
  const qualification = entry.qualification || {};
  return {
    painHypothesis: normalizeText(qualification.painHypothesis, 1200),
    concreteOffer: normalizeText(qualification.concreteOffer, 400)
      || 'I will harden one AI-agent workflow for you.',
    proofTiming: normalizeText(qualification.proofTiming, 240)
      || 'Use proof pack only after the buyer confirms pain.',
  };
}

function normalizeLeadOutbound(entry = {}) {
  const outbound = entry.outbound || {};
  return {
    draft: normalizeText(outbound.draft, 2000),
    followUpDraft: normalizeText(outbound.followUpDraft, 2000),
    cta: normalizeUrl(outbound.cta),
    lastSentAt: normalizeText(outbound.lastSentAt, 64),
    lastSentUrl: normalizeUrl(outbound.lastSentUrl),
  };
}

function normalizeLeadRevenue(entry = {}) {
  const revenue = entry.revenue || {};
  return {
    amountCents: Math.max(0, normalizeInteger(revenue.amountCents, 0)),
    currency: normalizeText(revenue.currency, 16) || 'usd',
    paidAt: normalizeText(revenue.paidAt, 64),
  };
}

function normalizeLeadAttribution(entry = {}) {
  const attribution = entry.attribution || {};
  return {
    sourceReport: normalizeText(attribution.sourceReport, 1000),
    campaign: normalizeText(attribution.campaign, 160),
    utmSource: normalizeText(attribution.utmSource, 120),
    utmMedium: normalizeText(attribution.utmMedium, 120),
    utmCampaign: normalizeText(attribution.utmCampaign, 160),
  };
}

function sanitizeSalesLead(entry = {}) {
  const history = Array.isArray(entry.history) ? entry.history : [];
  const firstHistoryAt = normalizeText(history[0]?.at || history[0]?.timestamp, 64);
  const lastHistoryAt = normalizeText(history.at(-1)?.at || history.at(-1)?.timestamp, 64);
  const createdAt = normalizeText(entry.createdAt, 64)
    || firstHistoryAt
    || normalizeText(entry.outbound?.lastSentAt || entry.revenue?.paidAt, 64)
    || LEGACY_TIMESTAMP_FALLBACK;
  const updatedAt = normalizeText(entry.updatedAt, 64)
    || lastHistoryAt
    || normalizeText(entry.revenue?.paidAt || entry.outbound?.lastSentAt, 64)
    || createdAt;
  const stage = normalizeSalesStage(entry.stage, 'targeted');
  const source = normalizeText(entry.source, 80) || 'manual';

  return {
    leadId: buildSalesLeadId(entry),
    createdAt,
    updatedAt,
    stage,
    source,
    channel: normalizeText(entry.channel, 80) || source,
    offer: normalizeText(entry.offer, 120) || 'workflow_hardening_sprint',
    contact: normalizeLeadContact(entry),
    account: normalizeLeadAccount(entry),
    qualification: normalizeLeadQualification(entry),
    outbound: normalizeLeadOutbound(entry),
    revenue: normalizeLeadRevenue(entry),
    attribution: normalizeLeadAttribution(entry),
    history: normalizeLeadHistory(entry, stage, updatedAt),
  };
}

function findLinkedGitCommonRoot({ cwd = process.cwd() } = {}) {
  let currentDir;
  try {
    currentDir = path.resolve(cwd);
  } catch {
    return null;
  }

  while (true) {
    const dotGitPath = path.join(currentDir, '.git');
    try {
      const stat = fs.statSync(dotGitPath);
      if (stat.isDirectory()) return null;
      if (stat.isFile()) {
        const match = /^gitdir:\s*(.+)$/im.exec(fs.readFileSync(dotGitPath, 'utf8'));
        if (!match) return null;
        const gitDir = path.resolve(currentDir, match[1].trim());
        const commonDirFile = path.join(gitDir, 'commondir');
        const commonDir = fs.existsSync(commonDirFile)
          ? path.resolve(gitDir, fs.readFileSync(commonDirFile, 'utf8').trim())
          : gitDir;
        if (path.basename(commonDir) !== '.git' || !fs.existsSync(commonDir)) return null;
        const relativeGitDir = path.relative(path.join(commonDir, 'worktrees'), gitDir);
        if (
          !relativeGitDir
          || relativeGitDir.startsWith('..')
          || path.isAbsolute(relativeGitDir)
        ) return null;
        return path.dirname(commonDir);
      }
    } catch {
      // Keep walking until a repository boundary is found.
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function getSalesPipelinePath({
  statePath = null,
  feedbackDir = null,
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  if (statePath) return path.resolve(statePath);
  if (feedbackDir) return path.join(path.resolve(feedbackDir), SALES_PIPELINE_FILE);
  if (env[SALES_PIPELINE_PATH_ENV]) return path.resolve(env[SALES_PIPELINE_PATH_ENV]);

  // Explicit runtime storage always wins. In particular, hosted Railway
  // deployments must keep using their mounted feedback volume.
  if (
    env.THUMBGATE_FEEDBACK_DIR
    || env.RAILWAY_VOLUME_MOUNT_PATH
    || env.THUMBGATE_PROJECT_DIR
    || env.CLAUDE_PROJECT_DIR
  ) {
    return path.join(getFeedbackPaths({ cwd, env }).FEEDBACK_DIR, SALES_PIPELINE_FILE);
  }

  // A linked Git worktree is another view of the same commercial system, not
  // a new business. Share its pipeline with the primary checkout so a release
  // or repair worktree cannot silently report zero active buyers.
  const commonRoot = findLinkedGitCommonRoot({ cwd });
  if (commonRoot) return path.join(commonRoot, '.thumbgate', SALES_PIPELINE_FILE);

  const baseDir = getFeedbackPaths({ cwd, env }).FEEDBACK_DIR;
  return path.join(baseDir, SALES_PIPELINE_FILE);
}

function appendSalesLeadSnapshot(lead = {}, options = {}) {
  const sanitized = sanitizeSalesLead(lead);
  appendJsonl(getSalesPipelinePath(options), sanitized);
  return sanitized;
}

function loadSalesLeadSnapshots(options = {}) {
  return readJsonl(getSalesPipelinePath(options))
    .map((entry) => {
      try {
        return sanitizeSalesLead(entry);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadSalesLeads(options = {}) {
  const latestByLeadId = new Map();
  for (const snapshot of loadSalesLeadSnapshots(options)) {
    const existing = latestByLeadId.get(snapshot.leadId);
    if (!existing || String(snapshot.updatedAt || '') >= String(existing.updatedAt || '')) {
      latestByLeadId.set(snapshot.leadId, snapshot);
    }
  }
  return Array.from(latestByLeadId.values())
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
}

function buildLeadFromRevenueTarget(target = {}, { sourcePath = null } = {}) {
  const username = normalizeText(target.username, 160);
  const source = normalizeText(target.source, 80) || 'github';
  const channel = normalizeText(target.channel, 80) || source;
  const repoName = normalizeText(target.repoName, 200);
  const repoUrl = normalizeUrl(target.repoUrl);
  const contactUrl = normalizeUrl(target.contactUrl) || (username && source === 'github'
    ? `https://github.com/${username}`
    : username && source === 'reddit'
      ? `https://www.reddit.com/user/${username}/`
      : null);
  return sanitizeSalesLead({
    source,
    channel,
    stage: 'targeted',
    offer: normalizeText(target.offer, 120) || 'workflow_hardening_sprint',
    contact: {
      username,
      url: contactUrl,
    },
    account: {
      name: normalizeText(target.accountName, 200) || username,
      repoName,
      repoUrl,
      description: target.description,
      stars: target.stars,
      updatedAt: target.updatedAt,
    },
    qualification: {
      painHypothesis: target.motionReason || target.description,
      concreteOffer: 'I will harden one AI-agent workflow for you.',
      proofTiming: target.proofPackTrigger || 'Use proof pack only after the buyer confirms pain.',
    },
    outbound: {
      draft: target.firstTouchDraft || target.message,
      followUpDraft: target.painConfirmedFollowUpDraft,
      cta: target.cta,
    },
    attribution: {
      sourceReport: sourcePath,
      campaign: normalizeText(target.offer, 160) || 'workflow_hardening_sprint_outbound',
      utmSource: source,
      utmMedium: channel === 'reddit_dm' ? 'warm_outbound' : 'direct_outbound',
      utmCampaign: normalizeText(target.offer, 160) || 'workflow_hardening_sprint',
    },
  });
}

function importRevenueLoopReport(report = {}, options = {}) {
  const existing = new Map(loadSalesLeads(options).map((lead) => [lead.leadId, lead]));
  const targets = Array.isArray(report.targets) ? report.targets : [];
  const imported = [];
  const skipped = [];

  for (const target of targets) {
    const candidate = buildLeadFromRevenueTarget(target, { sourcePath: options.sourcePath || null });
    if (existing.has(candidate.leadId)) {
      skipped.push(candidate.leadId);
      continue;
    }
    imported.push(appendSalesLeadSnapshot(candidate, options));
  }

  return {
    imported,
    skipped,
  };
}

function addSalesLead(payload = {}, options = {}) {
  const initialStage = normalizeSalesStage(payload.stage, 'targeted');
  const initialEvidence = validateStageEvidence(initialStage, payload);
  const initialAt = normalizeText(payload.timestamp, 64) || new Date().toISOString();
  const lead = sanitizeSalesLead({
    leadId: payload.leadId,
    createdAt: initialAt,
    updatedAt: initialAt,
    source: payload.source || 'manual',
    channel: payload.channel || payload.source || 'manual',
    stage: initialStage,
    offer: payload.offer || 'workflow_hardening_sprint',
    contact: {
      username: payload.username,
      name: payload.name,
      email: payload.email,
      url: payload.contactUrl,
    },
    account: {
      name: payload.account,
      repoName: payload.repo,
      repoUrl: payload.repoUrl,
      description: payload.description,
      stars: payload.stars,
    },
    qualification: {
      painHypothesis: payload.pain || payload.description,
      concreteOffer: payload.concreteOffer || 'I will harden one AI-agent workflow for you.',
      proofTiming: payload.proofTiming || 'Use proof pack only after the buyer confirms pain.',
    },
    outbound: {
      draft: payload.draft,
      cta: payload.cta,
      lastSentAt: initialEvidence.kind === 'platform_send_receipt' ? initialAt : null,
      lastSentUrl: initialEvidence.kind === 'platform_send_receipt'
        ? normalizeUrl(payload.url) || initialEvidence.reference
        : null,
    },
    revenue: {
      amountCents: initialStage === 'paid' ? payload.amountCents : 0,
      currency: payload.currency,
      paidAt: initialStage === 'paid' ? initialAt : null,
    },
    attribution: {
      campaign: payload.campaign || 'workflow_hardening_sprint_outbound',
      utmSource: payload.utmSource || payload.source || 'manual',
      utmMedium: payload.utmMedium || 'direct_outbound',
      utmCampaign: payload.utmCampaign || 'workflow_hardening_sprint',
    },
    history: [buildHistoryEntry({
      toStage: initialStage,
      actor: payload.actor || 'sales-pipeline',
      channel: payload.channel || payload.source || 'manual',
      note: payload.note || 'Lead entered pipeline.',
      url: payload.url,
      timestamp: initialAt,
      evidence: initialEvidence,
    })],
  });

  const existing = loadSalesLeads(options).find((entry) => entry.leadId === lead.leadId);
  if (existing && !payload.force) {
    throw new Error(`Sales lead already exists: ${lead.leadId}`);
  }

  return appendSalesLeadSnapshot(lead, options);
}

function readRevenueLoopReport(sourcePath) {
  const resolved = path.resolve(sourcePath || '');
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return {
    report: parsed,
    sourcePath: resolved,
  };
}

function validateStageTransition(currentStage, nextStage, { force = false } = {}) {
  if (force || currentStage === nextStage) return;
  const allowed = SALES_STAGE_TRANSITIONS[currentStage] || [];
  if (!allowed.includes(nextStage)) {
    throw new Error(`Invalid sales pipeline transition: ${currentStage} -> ${nextStage}`);
  }
}

function advanceSalesLead(payload = {}, options = {}) {
  const leadId = normalizeText(payload.leadId || payload.lead, 160);
  const nextStage = normalizeSalesStage(payload.stage, null);
  if (!leadId) throw new Error('leadId is required.');
  if (!nextStage) throw new Error(`stage must be one of: ${SALES_STAGE_FLOW.join(', ')}`);

  const currentLead = loadSalesLeads(options).find((lead) => lead.leadId === leadId);
  if (!currentLead) throw new Error(`Unknown sales lead: ${leadId}`);
  validateStageTransition(currentLead.stage, nextStage, { force: Boolean(payload.force) });
  const eventAt = normalizeText(payload.timestamp, 64) || new Date().toISOString();
  const updatedAt = new Date().toISOString();

  if (currentLead.stage === nextStage) {
    const hasEventEvidence = Boolean(payload.evidenceKind || payload.evidence?.kind);
    if (hasEventEvidence) {
      const eventEvidence = validateKnownEvidence(buildSalesEvidence(payload));
      const isSendReceipt = eventEvidence.kind === 'platform_send_receipt';
      const isPaymentEvidence = eventEvidence.kind === 'provider_payment';
      const evidenceAmount = normalizeInteger(payload.amountCents, currentLead.revenue.amountCents || 0);
      if (currentLead.stage === 'paid' && isPaymentEvidence && evidenceAmount <= 0) {
        throw new Error('stage paid requires amountCents greater than 0.');
      }
      const updatedLead = appendSalesLeadSnapshot({
        ...currentLead,
        updatedAt,
        outbound: {
          ...currentLead.outbound,
          lastSentAt: isSendReceipt ? eventAt : currentLead.outbound.lastSentAt,
          lastSentUrl: isSendReceipt
            ? normalizeUrl(payload.url) || eventEvidence.reference || currentLead.outbound.lastSentUrl
            : currentLead.outbound.lastSentUrl,
        },
        revenue: {
          ...currentLead.revenue,
          amountCents: isPaymentEvidence ? evidenceAmount : currentLead.revenue.amountCents,
          currency: isPaymentEvidence
            ? normalizeText(payload.currency, 16) || currentLead.revenue.currency
            : currentLead.revenue.currency,
          paidAt: isPaymentEvidence ? (currentLead.revenue.paidAt || eventAt) : currentLead.revenue.paidAt,
        },
        history: currentLead.history.concat(buildHistoryEntry({
          fromStage: currentLead.stage,
          toStage: nextStage,
          actor: payload.actor || 'operator',
          channel: payload.channel || currentLead.channel,
          note: payload.note || 'Recorded same-stage sales evidence.',
          url: payload.url,
          timestamp: eventAt,
          evidence: eventEvidence,
        })),
      }, options);
      return {
        lead: updatedLead,
        unchanged: false,
      };
    }
    if (payload.note || payload.url || payload.evidenceSource || payload.evidenceRef) {
      throw new Error('same-stage updates require evidenceKind, evidenceSource, and evidenceRef.');
    }
    return {
      lead: currentLead,
      unchanged: true,
    };
  }

  const stageEvidence = validateStageEvidence(nextStage, payload);
  const revenueAmount = normalizeInteger(payload.amountCents, currentLead.revenue.amountCents || 0);
  const isFullRefund = nextStage === 'lost' && stageEvidence.kind === 'provider_refund';
  const updatedLead = appendSalesLeadSnapshot({
    ...currentLead,
    updatedAt,
    stage: nextStage,
    outbound: {
      ...currentLead.outbound,
      lastSentAt: nextStage === 'contacted' ? eventAt : currentLead.outbound.lastSentAt,
      lastSentUrl: nextStage === 'contacted'
        ? normalizeUrl(payload.url) || currentLead.outbound.lastSentUrl
        : currentLead.outbound.lastSentUrl,
    },
    revenue: {
      ...currentLead.revenue,
      amountCents: nextStage === 'paid' ? revenueAmount : (isFullRefund ? 0 : currentLead.revenue.amountCents),
      currency: normalizeText(payload.currency, 16) || currentLead.revenue.currency,
      paidAt: nextStage === 'paid' ? eventAt : currentLead.revenue.paidAt,
    },
    history: currentLead.history.concat(buildHistoryEntry({
      fromStage: currentLead.stage,
      toStage: nextStage,
      actor: payload.actor || 'operator',
      channel: payload.channel || currentLead.channel,
      note: payload.note,
      url: payload.url,
      timestamp: eventAt,
      evidence: stageEvidence,
    })),
  }, options);

  return {
    lead: updatedLead,
    unchanged: false,
  };
}

function evaluateLeadEvidenceAtStage(lead = {}, requestedStage = lead.stage) {
  const stage = normalizeSalesStage(requestedStage, 'targeted');
  if (stage === 'targeted') {
    return {
      stage,
      verified: true,
      evidence: null,
      reason: null,
    };
  }

  const history = Array.isArray(lead.history) ? lead.history : [];
  const supportingEvent = history
    .slice()
    .reverse()
    .find((event) => event.toStage === stage && evidenceSupportsStage(stage, event.evidence));
  if (!supportingEvent) {
    return {
      stage,
      verified: false,
      evidence: null,
      reason: `No stage-appropriate evidence for ${stage}.`,
    };
  }
  if (stage === 'paid' && normalizeInteger(lead.revenue?.amountCents, 0) <= 0) {
    return {
      stage,
      verified: false,
      evidence: supportingEvent.evidence,
      reason: 'Paid stage has no positive amountCents.',
    };
  }

  return {
    stage,
    verified: true,
    evidence: supportingEvent.evidence,
    evidenceAt: supportingEvent.at,
    reason: null,
  };
}

function evaluateLeadStageEvidence(lead = {}) {
  return evaluateLeadEvidenceAtStage(lead, lead.stage);
}

function auditSalesPipeline(leads = []) {
  const issues = [];
  let verified = 0;
  for (const lead of leads) {
    const result = evaluateLeadStageEvidence(lead);
    if (result.verified) {
      verified += 1;
      continue;
    }
    issues.push({
      leadId: lead.leadId,
      stage: lead.stage,
      code: 'unverified_stage_evidence',
      reason: result.reason,
      allowedEvidenceKinds: SALES_STAGE_EVIDENCE_KINDS[lead.stage] || [],
    });
  }
  return {
    ok: issues.length === 0,
    total: leads.length,
    verified,
    unverified: issues.length,
    issues,
  };
}

function summarizeSalesPipeline(leads = []) {
  const byStage = Object.fromEntries(SALES_STAGE_FLOW.map((stage) => [stage, 0]));
  const verifiedByStage = Object.fromEntries(SALES_STAGE_FLOW.map((stage) => [stage, 0]));
  const unverifiedByStage = Object.fromEntries(SALES_STAGE_FLOW.map((stage) => [stage, 0]));
  let bookedRevenueCents = 0;
  for (const lead of leads) {
    byStage[lead.stage] = (byStage[lead.stage] || 0) + 1;
    const stageEvidence = evaluateLeadStageEvidence(lead);
    const evidenceBucket = stageEvidence.verified ? verifiedByStage : unverifiedByStage;
    evidenceBucket[lead.stage] = (evidenceBucket[lead.stage] || 0) + 1;
    if (lead.stage === 'paid' && stageEvidence.verified) {
      bookedRevenueCents += lead.revenue.amountCents || 0;
    }
  }

  const countAtOrBeyond = (stageCounts, stage) => {
    const startIndex = SALES_STAGE_FLOW.indexOf(stage);
    return SALES_STAGE_FLOW.slice(startIndex)
      .filter((candidate) => candidate !== 'lost')
      .reduce((sum, candidate) => sum + (stageCounts[candidate] || 0), 0);
  };

  const rawContacted = countAtOrBeyond(byStage, 'contacted');
  const rawReplies = countAtOrBeyond(byStage, 'replied');
  const rawCallsBooked = countAtOrBeyond(byStage, 'call_booked');

  return {
    total: leads.length,
    byStage,
    verifiedByStage,
    unverifiedByStage,
    evidenceGapCount: Object.values(unverifiedByStage).reduce((sum, count) => sum + count, 0),
    active: leads.filter((lead) => lead.stage !== 'paid' && lead.stage !== 'lost').length,
    contacted: leads.filter((lead) => evaluateLeadEvidenceAtStage(lead, 'contacted').verified).length,
    rawContacted,
    replies: leads.filter((lead) => evaluateLeadEvidenceAtStage(lead, 'replied').verified).length,
    rawReplies,
    callsBooked: leads.filter((lead) => evaluateLeadEvidenceAtStage(lead, 'call_booked').verified).length,
    rawCallsBooked,
    paid: verifiedByStage.paid,
    rawPaid: byStage.paid,
    bookedRevenueCents,
  };
}

function formatLeadContact(contact = {}) {
  return contact.username ? `@${contact.username}` : (contact.email || 'n/a');
}

function renderLeadQueueEntry(lead) {
  const repo = lead.account.repoUrl || lead.account.repoName || lead.account.name || 'n/a';
  const stageEvidence = evaluateLeadStageEvidence(lead);
  return [
    `### ${lead.leadId}`,
    `- Stage: ${lead.stage}`,
    `- Offer: ${lead.offer}`,
    `- Repo/account: ${repo}`,
    `- Contact: ${formatLeadContact(lead.contact)}`,
    `- Stage evidence: ${stageEvidence.verified ? 'verified' : `unverified — ${stageEvidence.reason}`}`,
    `- Concrete offer: ${lead.qualification.concreteOffer}`,
    `- Proof rule: ${lead.qualification.proofTiming}`,
    `- Outreach draft: ${lead.outbound.draft || 'n/a'}`,
    `- Pain-confirmed follow-up: ${lead.outbound.followUpDraft || 'n/a'}`,
    '',
  ];
}

function renderSalesPipelineMarkdown({ leads = [], generatedAt = new Date().toISOString() } = {}) {
  const summary = summarizeSalesPipeline(leads);
  const leadQueueLines = leads.length
    ? leads.flatMap(renderLeadQueueEntry)
    : ['- No leads tracked yet. Import a GTM revenue loop JSON report first.'];
  const lines = [
    '# Sales Pipeline',
    '',
    `Updated: ${generatedAt}`,
    '',
    'This is the first-dollar truth table. Posts are not sales; only stage movement counts.',
    '',
    '## Summary',
    `- Total leads: ${summary.total}`,
    `- Active leads: ${summary.active}`,
    `- Verified contacted: ${summary.contacted} (raw stage-derived: ${summary.rawContacted})`,
    `- Verified replied: ${summary.replies} (raw stage-derived: ${summary.rawReplies})`,
    `- Verified calls booked: ${summary.callsBooked} (raw stage-derived: ${summary.rawCallsBooked})`,
    `- Verified paid: ${summary.paid} (raw stage-derived: ${summary.rawPaid})`,
    `- Verified booked revenue: $${(summary.bookedRevenueCents / 100).toFixed(2)}`,
    '',
    '## Stage Counts',
    ...SALES_STAGE_FLOW.map((stage) => `- ${stage}: ${summary.byStage[stage] || 0}`),
    '',
    '## Verified Stage Counts',
    ...SALES_STAGE_FLOW.map((stage) => `- ${stage}: ${summary.verifiedByStage[stage] || 0}`),
    `- Evidence gaps: ${summary.evidenceGapCount}`,
    '',
    '## Lead Queue',
    ...leadQueueLines,
  ];
  return `${lines.join('\n').trim()}\n`;
}

function writeSalesPipelineReport({ outPath, leads }) {
  if (!outPath) return null;
  const resolved = path.resolve(outPath);
  ensureParentDir(resolved);
  fs.writeFileSync(resolved, renderSalesPipelineMarkdown({ leads }), 'utf8');
  return resolved;
}

function parseArgs(argv = []) {
  const firstArg = argv[0];
  const hasCommand = firstArg ? !firstArg.startsWith('--') : false;
  const rawCommand = hasCommand ? firstArg : 'report';
  const command = rawCommand === 'status' || rawCommand === 'summary'
    ? 'report'
    : rawCommand;
  const args = hasCommand ? argv.slice(1) : argv;
  const options = { command };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;
    const eqIndex = arg.indexOf('=', 2);
    const rawKey = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
    const key = rawKey.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (eqIndex !== -1) {
      options[key] = arg.slice(eqIndex + 1);
      continue;
    }
    const nextArg = args[index + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      options[key] = nextArg;
      index += 1;
      continue;
    }
    options[key] = true;
  }

  return options;
}

function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const stateOptions = {
    statePath: options.state,
    feedbackDir: options.feedbackDir,
  };

  switch (options.command) {
    case 'import':
    case 'import-gtm': {
      if (!options.source) throw new Error('--source is required for import.');
      const { report, sourcePath } = readRevenueLoopReport(options.source);
      const result = importRevenueLoopReport(report, { ...stateOptions, sourcePath });
      const leads = loadSalesLeads(stateOptions);
      const reportPath = writeSalesPipelineReport({ outPath: options.out, leads });
      return {
        command: options.command,
        imported: result.imported.length,
        skipped: result.skipped.length,
        statePath: getSalesPipelinePath(stateOptions),
        reportPath,
      };
    }

    case 'advance': {
      if (!options.lead && !options.leadId) throw new Error('leadId is required.');
      if (options.stage === 'paid') {
        throw new Error('The sales:pipeline CLI cannot mark a lead paid. Use sales:reconcile-payment with a live provider payment ID.');
      }
      const result = advanceSalesLead({
        leadId: options.lead || options.leadId,
        stage: options.stage,
        actor: options.actor,
        channel: options.channel,
        note: options.note,
        url: options.url,
        amountCents: options.amountCents,
        currency: options.currency,
        evidenceKind: options.evidenceKind,
        evidenceSource: options.evidenceSource,
        evidenceRef: options.evidenceRef,
        timestamp: options.timestamp,
        force: options.force,
      }, stateOptions);
      const leads = loadSalesLeads(stateOptions);
      const reportPath = writeSalesPipelineReport({ outPath: options.out, leads });
      return {
        command: options.command,
        leadId: result.lead.leadId,
        stage: result.lead.stage,
        unchanged: result.unchanged,
        statePath: getSalesPipelinePath(stateOptions),
        reportPath,
      };
    }

    case 'add': {
      if (options.stage === 'paid') {
        throw new Error('The sales:pipeline CLI cannot add a paid lead. Add the lead first, then use sales:reconcile-payment with a live provider payment ID.');
      }
      const lead = addSalesLead({
        leadId: options.lead || options.leadId,
        source: options.source,
        channel: options.channel,
        stage: options.stage,
        offer: options.offer,
        username: options.username,
        name: options.name,
        email: options.email,
        contactUrl: options.contactUrl,
        account: options.account,
        repo: options.repo,
        repoUrl: options.repoUrl,
        description: options.description,
        stars: options.stars,
        pain: options.pain,
        concreteOffer: options.concreteOffer,
        proofTiming: options.proofTiming,
        draft: options.draft,
        cta: options.cta,
        campaign: options.campaign,
        utmSource: options.utmSource,
        utmMedium: options.utmMedium,
        utmCampaign: options.utmCampaign,
        actor: options.actor,
        note: options.note,
        url: options.url,
        evidenceKind: options.evidenceKind,
        evidenceSource: options.evidenceSource,
        evidenceRef: options.evidenceRef,
        amountCents: options.amountCents,
        currency: options.currency,
        timestamp: options.timestamp,
        force: options.force,
      }, stateOptions);
      const leads = loadSalesLeads(stateOptions);
      const reportPath = writeSalesPipelineReport({ outPath: options.out, leads });
      return {
        command: options.command,
        leadId: lead.leadId,
        stage: lead.stage,
        statePath: getSalesPipelinePath(stateOptions),
        reportPath,
      };
    }

    case 'report': {
      const leads = loadSalesLeads(stateOptions);
      const reportPath = writeSalesPipelineReport({ outPath: options.out, leads });
      return {
        command: options.command,
        summary: summarizeSalesPipeline(leads),
        statePath: getSalesPipelinePath(stateOptions),
        reportPath,
      };
    }

    case 'audit': {
      const leads = loadSalesLeads(stateOptions);
      return {
        command: options.command,
        audit: auditSalesPipeline(leads),
        statePath: getSalesPipelinePath(stateOptions),
      };
    }

    default:
      throw new Error(`Unknown sales pipeline command: ${options.command}`);
  }
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  if (!invokedPath) return false;
  try {
    return fs.realpathSync(path.resolve(invokedPath)) === fs.realpathSync(__filename);
  } catch {
    return path.resolve(invokedPath) === path.resolve(__filename);
  }
}

if (isCliInvocation()) {
  try {
    const result = runCli();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}

module.exports = {
  SALES_PIPELINE_FILE,
  SALES_PIPELINE_PATH_ENV,
  SALES_EVIDENCE_KINDS,
  SALES_STAGE_FLOW,
  SALES_STAGE_EVIDENCE_KINDS,
  SALES_STAGE_TRANSITIONS,
  VERIFIED_PAYMENT_DIGEST_PATTERN,
  VERIFIED_PAYMENT_PROVIDERS,
  VERIFIED_PAYMENT_SOURCE_PATTERN,
  LEGACY_TIMESTAMP_FALLBACK,
  addSalesLead,
  advanceSalesLead,
  appendSalesLeadSnapshot,
  auditSalesPipeline,
  buildSalesEvidence,
  buildLeadFromRevenueTarget,
  evaluateLeadStageEvidence,
  evaluateLeadEvidenceAtStage,
  findLinkedGitCommonRoot,
  getSalesPipelinePath,
  importRevenueLoopReport,
  isVerifiedProviderFinancialEvidence,
  isCliInvocation,
  loadSalesLeads,
  loadSalesLeadSnapshots,
  normalizeSalesEvidence,
  normalizeSalesStage,
  parseArgs,
  renderSalesPipelineMarkdown,
  runCli,
  sanitizeSalesLead,
  summarizeSalesPipeline,
};
