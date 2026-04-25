#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getFeedbackPaths } = require('./feedback-paths');
const { appendJsonl, ensureParentDir, readJsonl } = require('./fs-utils');

const SALES_PIPELINE_FILE = 'sales-pipeline.jsonl';
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
  paid: [],
  lost: [],
};

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
  actor = null,
  channel = null,
  note = null,
  url = null,
  timestamp = new Date().toISOString(),
} = {}) {
  return {
    fromStage: normalizeSalesStage(fromStage, null),
    toStage: normalizeSalesStage(toStage, 'targeted'),
    at: normalizeText(timestamp, 64) || new Date().toISOString(),
    actor: normalizeText(actor, 160),
    channel: normalizeText(channel, 80),
    note: normalizeText(note, 2000),
    url: normalizeUrl(url),
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
  const createdAt = normalizeText(entry.createdAt, 64) || new Date().toISOString();
  const updatedAt = normalizeText(entry.updatedAt, 64) || createdAt;
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

function getSalesPipelinePath({ statePath = null, feedbackDir = null } = {}) {
  if (statePath) return path.resolve(statePath);
  const baseDir = feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
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
  const repoName = normalizeText(target.repoName, 200);
  const repoUrl = normalizeUrl(target.repoUrl);
  return sanitizeSalesLead({
    source: 'github',
    channel: 'github',
    stage: 'targeted',
    offer: 'workflow_hardening_sprint',
    contact: {
      username,
      url: username ? `https://github.com/${username}` : null,
    },
    account: {
      name: username,
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
      campaign: 'workflow_hardening_sprint_outbound',
      utmSource: 'github',
      utmMedium: 'direct_outbound',
      utmCampaign: 'workflow_hardening_sprint',
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
  const lead = sanitizeSalesLead({
    leadId: payload.leadId,
    source: payload.source || 'manual',
    channel: payload.channel || payload.source || 'manual',
    stage: payload.stage || 'targeted',
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
    },
    attribution: {
      campaign: payload.campaign || 'workflow_hardening_sprint_outbound',
      utmSource: payload.utmSource || payload.source || 'manual',
      utmMedium: payload.utmMedium || 'direct_outbound',
      utmCampaign: payload.utmCampaign || 'workflow_hardening_sprint',
    },
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

  if (currentLead.stage === nextStage) {
    return {
      lead: currentLead,
      unchanged: true,
    };
  }

  const updatedAt = normalizeText(payload.timestamp, 64) || new Date().toISOString();
  const revenueAmount = normalizeInteger(payload.amountCents, currentLead.revenue.amountCents || 0);
  const updatedLead = appendSalesLeadSnapshot({
    ...currentLead,
    updatedAt,
    stage: nextStage,
    outbound: {
      ...currentLead.outbound,
      lastSentAt: nextStage === 'contacted' ? updatedAt : currentLead.outbound.lastSentAt,
      lastSentUrl: nextStage === 'contacted'
        ? normalizeUrl(payload.url) || currentLead.outbound.lastSentUrl
        : currentLead.outbound.lastSentUrl,
    },
    revenue: {
      ...currentLead.revenue,
      amountCents: nextStage === 'paid' ? revenueAmount : currentLead.revenue.amountCents,
      currency: normalizeText(payload.currency, 16) || currentLead.revenue.currency,
      paidAt: nextStage === 'paid' ? updatedAt : currentLead.revenue.paidAt,
    },
    history: currentLead.history.concat(buildHistoryEntry({
      fromStage: currentLead.stage,
      toStage: nextStage,
      actor: payload.actor || 'operator',
      channel: payload.channel || currentLead.channel,
      note: payload.note,
      url: payload.url,
      timestamp: updatedAt,
    })),
  }, options);

  return {
    lead: updatedLead,
    unchanged: false,
  };
}

function summarizeSalesPipeline(leads = []) {
  const byStage = Object.fromEntries(SALES_STAGE_FLOW.map((stage) => [stage, 0]));
  let bookedRevenueCents = 0;
  for (const lead of leads) {
    byStage[lead.stage] = (byStage[lead.stage] || 0) + 1;
    if (lead.stage === 'paid') {
      bookedRevenueCents += lead.revenue.amountCents || 0;
    }
  }

  return {
    total: leads.length,
    byStage,
    active: leads.filter((lead) => lead.stage !== 'paid' && lead.stage !== 'lost').length,
    contacted: byStage.contacted + byStage.replied + byStage.call_booked
      + byStage.checkout_started + byStage.sprint_intake + byStage.paid,
    replies: byStage.replied + byStage.call_booked + byStage.checkout_started + byStage.sprint_intake + byStage.paid,
    callsBooked: byStage.call_booked + byStage.checkout_started + byStage.sprint_intake + byStage.paid,
    paid: byStage.paid,
    bookedRevenueCents,
  };
}

function formatLeadContact(contact = {}) {
  return contact.username ? `@${contact.username}` : (contact.email || 'n/a');
}

function renderLeadQueueEntry(lead) {
  const repo = lead.account.repoUrl || lead.account.repoName || lead.account.name || 'n/a';
  return [
    `### ${lead.leadId}`,
    `- Stage: ${lead.stage}`,
    `- Offer: ${lead.offer}`,
    `- Repo/account: ${repo}`,
    `- Contact: ${formatLeadContact(lead.contact)}`,
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
    `- Contacted: ${summary.contacted}`,
    `- Replied: ${summary.replies}`,
    `- Calls booked: ${summary.callsBooked}`,
    `- Paid: ${summary.paid}`,
    `- Booked revenue: $${(summary.bookedRevenueCents / 100).toFixed(2)}`,
    '',
    '## Stage Counts',
    ...SALES_STAGE_FLOW.map((stage) => `- ${stage}: ${summary.byStage[stage] || 0}`),
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
  const command = hasCommand ? firstArg : 'report';
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
      const result = advanceSalesLead({
        leadId: options.lead || options.leadId,
        stage: options.stage,
        actor: options.actor,
        channel: options.channel,
        note: options.note,
        url: options.url,
        amountCents: options.amountCents,
        currency: options.currency,
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

    default:
      throw new Error(`Unknown sales pipeline command: ${options.command}`);
  }
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return Boolean(invokedPath) && !path.relative(path.resolve(invokedPath), __filename);
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
  SALES_STAGE_FLOW,
  SALES_STAGE_TRANSITIONS,
  addSalesLead,
  advanceSalesLead,
  appendSalesLeadSnapshot,
  buildLeadFromRevenueTarget,
  getSalesPipelinePath,
  importRevenueLoopReport,
  isCliInvocation,
  loadSalesLeads,
  loadSalesLeadSnapshots,
  normalizeSalesStage,
  parseArgs,
  renderSalesPipelineMarkdown,
  runCli,
  sanitizeSalesLead,
  summarizeSalesPipeline,
};
