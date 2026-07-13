'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getFeedbackPaths } = require('./feedback-loop');
const { redactSecrets } = require('./secret-redaction');
const { appendWorkflowRun } = require('./workflow-runs');

const WORKFLOW_SPRINT_LEADS_FILE = 'workflow-sprint-leads.jsonl';
const WORKFLOW_SPRINT_INTAKE_LIMITS_FILE = 'workflow-sprint-intake-limits.json';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_OPERATOR_ALERT_EMAIL = 'igor.ganapolsky@gmail.com';
const INTAKE_ALERT_WINDOW_MS = 60 * 60 * 1000;
const MAX_INTAKE_ALERTS_PER_WINDOW = 5;
const MAX_ALERT_RATE_KEYS = 10000;
const MAX_INTAKES_PER_CLIENT_HOUR = 10;
const MAX_PERSISTED_INTAKE_KEYS = 10000;
const DUPLICATE_INTAKE_WINDOW_MS = 15 * 60 * 1000;
const intakeAlertTimesByKey = new Map();
const intakeAlertDedupByKey = new Map();
const WORKFLOW_SPRINT_STATUS_FLOW = [
  'new',
  'qualified',
  'named_pilot',
  'proof_backed_run',
  'paid_team',
];

function normalizeText(value, maxLength = 280) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeSafeText(value, maxLength = 280) {
  const text = normalizeText(value, maxLength);
  return text ? redactSecrets(text) : null;
}

function normalizeEmail(value) {
  const email = normalizeText(value, 320);
  if (!email) return null;
  const normalized = email.toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

function normalizeProofArtifacts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeText(entry, 512))
    .filter(Boolean);
}

function normalizeWorkflowSprintStatus(value, fallback = null) {
  const normalized = normalizeText(value, 64);
  if (!normalized) return fallback;
  if (WORKFLOW_SPRINT_STATUS_FLOW.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function isDiagnosticIntake(payload = {}) {
  const planId = String(normalizeText(payload.planId, 120) || '').toLowerCase();
  const ctaId = String(normalizeText(payload.ctaId, 120) || '').toLowerCase();
  return planId === 'diagnostic'
    || planId === 'sprint_diagnostic'
    || Boolean(ctaId && ctaId.startsWith('diagnostic_'));
}

function slugify(value, fallback = 'workflow_sprint') {
  const normalized = normalizeText(value, 120);
  if (!normalized) return fallback;
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function buildStatusHistoryEntry({
  fromStatus = null,
  toStatus,
  actor = null,
  note = null,
  reviewedBy = null,
  proofArtifacts = [],
  timestamp = new Date().toISOString(),
} = {}) {
  return {
    fromStatus: normalizeWorkflowSprintStatus(fromStatus, null),
    toStatus: normalizeWorkflowSprintStatus(toStatus, 'new'),
    at: normalizeText(timestamp, 64) || new Date().toISOString(),
    actor: normalizeText(actor, 160),
    note: normalizeSafeText(note, 1000),
    reviewedBy: normalizeText(reviewedBy, 160),
    proofArtifacts: normalizeProofArtifacts(proofArtifacts),
  };
}

function sanitizeWorkflowSprintLead(entry = {}) {
  const submittedAt = normalizeText(entry.submittedAt, 64) || new Date().toISOString();
  const updatedAt = normalizeText(entry.updatedAt, 64) || submittedAt;
  const status = normalizeWorkflowSprintStatus(entry.status, 'new');
  const proofArtifacts = normalizeProofArtifacts(entry.proof && entry.proof.artifacts);
  const reviewedBy = normalizeText(entry.proof && entry.proof.reviewedBy, 160);
  const history = Array.isArray(entry.statusHistory) && entry.statusHistory.length
    ? entry.statusHistory
      .map((item) => buildStatusHistoryEntry(item))
      .filter(Boolean)
    : [buildStatusHistoryEntry({
      fromStatus: null,
      toStatus: status,
      timestamp: updatedAt,
      actor: entry.actor || null,
      note: entry.statusNote || null,
      reviewedBy,
      proofArtifacts,
    })];

  return {
    leadId: normalizeText(entry.leadId, 160) || `lead_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    submittedAt,
    updatedAt,
    status,
    offer: normalizeText(entry.offer, 120) || 'workflow_hardening_sprint',
    contact: {
      name: normalizeSafeText(entry.contact && entry.contact.name, 160),
      email: normalizeEmail(entry.contact && entry.contact.email),
      company: normalizeSafeText(entry.contact && entry.contact.company, 160),
    },
    qualification: {
      workflow: normalizeSafeText(entry.qualification && entry.qualification.workflow, 240),
      owner: normalizeSafeText(entry.qualification && entry.qualification.owner, 160),
      blocker: normalizeSafeText(entry.qualification && entry.qualification.blocker, 1000),
      runtime: normalizeSafeText(entry.qualification && entry.qualification.runtime, 160),
      urgency: normalizeSafeText(entry.qualification && entry.qualification.urgency, 1000),
      note: normalizeSafeText(entry.qualification && entry.qualification.note, 1000),
    },
    attribution: {
      acquisitionId: normalizeSafeText(entry.attribution && entry.attribution.acquisitionId, 160),
      visitorId: normalizeSafeText(entry.attribution && entry.attribution.visitorId, 160),
      sessionId: normalizeSafeText(entry.attribution && entry.attribution.sessionId, 160),
      traceId: normalizeSafeText(entry.attribution && entry.attribution.traceId, 160),
      installId: normalizeSafeText(entry.attribution && entry.attribution.installId, 160),
      source: normalizeSafeText(entry.attribution && entry.attribution.source, 120),
      utmSource: normalizeSafeText(entry.attribution && entry.attribution.utmSource, 120),
      utmMedium: normalizeSafeText(entry.attribution && entry.attribution.utmMedium, 120),
      utmCampaign: normalizeSafeText(entry.attribution && entry.attribution.utmCampaign, 160),
      utmContent: normalizeSafeText(entry.attribution && entry.attribution.utmContent, 160),
      utmTerm: normalizeSafeText(entry.attribution && entry.attribution.utmTerm, 160),
      creator: normalizeSafeText(entry.attribution && entry.attribution.creator, 120),
      community: normalizeSafeText(entry.attribution && entry.attribution.community, 120),
      postId: normalizeSafeText(entry.attribution && entry.attribution.postId, 120),
      commentId: normalizeSafeText(entry.attribution && entry.attribution.commentId, 120),
      campaignVariant: normalizeSafeText(entry.attribution && entry.attribution.campaignVariant, 120),
      offerCode: normalizeSafeText(entry.attribution && entry.attribution.offerCode, 120),
      ctaId: normalizeSafeText(entry.attribution && entry.attribution.ctaId, 120),
      ctaPlacement: normalizeSafeText(entry.attribution && entry.attribution.ctaPlacement, 120),
      planId: normalizeSafeText(entry.attribution && entry.attribution.planId, 120),
      page: normalizeSafeText(entry.attribution && entry.attribution.page, 160),
      landingPath: normalizeSafeText(entry.attribution && entry.attribution.landingPath, 160),
      referrerHost: normalizeSafeText(entry.attribution && entry.attribution.referrerHost, 255),
      referrer: normalizeSafeText(entry.attribution && entry.attribution.referrer, 255),
    },
    workflowProgress: {
      qualifiedAt: normalizeText(entry.workflowProgress && entry.workflowProgress.qualifiedAt, 64),
      namedPilotAt: normalizeText(entry.workflowProgress && entry.workflowProgress.namedPilotAt, 64),
      proofBackedRunAt: normalizeText(entry.workflowProgress && entry.workflowProgress.proofBackedRunAt, 64),
      paidTeamAt: normalizeText(entry.workflowProgress && entry.workflowProgress.paidTeamAt, 64),
    },
    proof: {
      artifacts: proofArtifacts,
      reviewedBy,
      lastWorkflowRunKey: normalizeText(entry.proof && entry.proof.lastWorkflowRunKey, 240),
    },
    statusHistory: history,
  };
}

function appendWorkflowSprintLeadSnapshot(lead = {}, feedbackDir) {
  const sanitized = sanitizeWorkflowSprintLead(lead);
  const leadsPath = getWorkflowSprintLeadsPath(feedbackDir);
  fs.mkdirSync(path.dirname(leadsPath), { recursive: true });
  fs.appendFileSync(leadsPath, `${JSON.stringify(sanitized)}\n`, 'utf8');
  return sanitized;
}

function getWorkflowSprintLeadsPath(feedbackDir) {
  const baseDir = feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  return path.join(baseDir, WORKFLOW_SPRINT_LEADS_FILE);
}

function getWorkflowSprintIntakeLimitsPath(feedbackDir) {
  const baseDir = feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  return path.join(baseDir, WORKFLOW_SPRINT_INTAKE_LIMITS_FILE);
}

function loadWorkflowSprintIntakeLimits(feedbackDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(getWorkflowSprintIntakeLimitsPath(feedbackDir), 'utf8'));
    return parsed && typeof parsed === 'object'
      ? parsed
      : { clients: {}, dedupe: {} };
  } catch {
    return { clients: {}, dedupe: {} };
  }
}

function saveWorkflowSprintIntakeLimits(state, feedbackDir) {
  const target = getWorkflowSprintIntakeLimitsPath(feedbackDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, 'utf8');
  fs.renameSync(temp, target);
}

function withWorkflowSprintIntakeLimitLock(feedbackDir, operation) {
  const target = getWorkflowSprintIntakeLimitsPath(feedbackDir);
  const lockPath = `${target}.lock`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 20 && !acquired; attempt += 1) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 10 * 1000) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  if (!acquired) return { allowed: false, reason: 'intake_limiter_busy', statusCode: 503 };
  try {
    return operation();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function newestIntakeTimestamp(value) {
  const timestamps = Array.isArray(value) ? value : [value];
  return timestamps.reduce((newest, timestamp) => {
    const numeric = Number(timestamp);
    return Number.isFinite(numeric) ? Math.max(newest, numeric) : newest;
  }, 0);
}

function retainNewestIntakeEntries(record, requiredKey) {
  const entries = Object.entries(record);
  if (entries.length <= MAX_PERSISTED_INTAKE_KEYS) return record;
  entries.sort((left, right) => {
    if (left[0] === requiredKey) return -1;
    if (right[0] === requiredKey) return 1;
    return newestIntakeTimestamp(right[1]) - newestIntakeTimestamp(left[1]);
  });
  return Object.fromEntries(entries.slice(0, MAX_PERSISTED_INTAKE_KEYS));
}

function reserveWorkflowSprintIntake(payload = {}, {
  feedbackDir,
  rateLimitKey,
  now = Date.now(),
} = {}) {
  const validatedLead = buildWorkflowSprintLead(payload);
  return withWorkflowSprintIntakeLimitLock(feedbackDir, () => {
    const state = loadWorkflowSprintIntakeLimits(feedbackDir);
    const hourFloor = now - INTAKE_ALERT_WINDOW_MS;
    const duplicateFloor = now - DUPLICATE_INTAKE_WINDOW_MS;
    const clients = {};
    for (const [key, timestamps] of Object.entries(state.clients || {})) {
      const active = Array.isArray(timestamps)
        ? timestamps.filter((timestamp) => Number(timestamp) > hourFloor)
        : [];
      if (active.length) clients[key] = active;
    }
    const dedupe = {};
    for (const [key, timestamp] of Object.entries(state.dedupe || {})) {
      if (Number(timestamp) > duplicateFloor) dedupe[key] = Number(timestamp);
    }

    const clientKey = alertFingerprint(rateLimitKey || 'unknown-client');
    const duplicateKey = alertFingerprint([
      validatedLead.contact.email,
      validatedLead.qualification.workflow,
    ].join('|'));
    const clientEvents = clients[clientKey] || [];
    if (dedupe[duplicateKey]) {
      return { allowed: false, reason: 'duplicate_intake', statusCode: 429 };
    }
    if (clientEvents.length >= MAX_INTAKES_PER_CLIENT_HOUR) {
      return { allowed: false, reason: 'client_intake_rate_limited', statusCode: 429 };
    }

    clientEvents.push(now);
    clients[clientKey] = clientEvents;
    dedupe[duplicateKey] = now;
    saveWorkflowSprintIntakeLimits({
      updatedAt: new Date(now).toISOString(),
      clients: retainNewestIntakeEntries(clients, clientKey),
      dedupe: retainNewestIntakeEntries(dedupe, duplicateKey),
    }, feedbackDir);
    return { allowed: true };
  });
}

function buildWorkflowSprintLead(payload = {}) {
  const diagnosticIntake = isDiagnosticIntake(payload);
  const name = normalizeSafeText(payload.name, 160);
  const urgency = normalizeSafeText(payload.urgency, 1000);
  const email = normalizeEmail(payload.email);
  const workflow = normalizeSafeText(payload.workflow, 240);
  const owner = normalizeSafeText(payload.owner, 160);
  const blocker = normalizeSafeText(payload.blocker, 1000);
  const runtime = normalizeSafeText(payload.runtime, 160);

  if (!email) {
    const err = new Error('A valid email address is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!workflow) {
    const err = new Error('Workflow is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!diagnosticIntake && !owner) {
    const err = new Error('Workflow owner is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!diagnosticIntake && !blocker) {
    const err = new Error('Repeated failure or rollout blocker is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!diagnosticIntake && !runtime) {
    const err = new Error('Current agent or runtime is required.');
    err.statusCode = 400;
    throw err;
  }

  const submittedAt = normalizeText(payload.submittedAt, 64) || new Date().toISOString();

  return {
    leadId: `lead_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    submittedAt,
    updatedAt: submittedAt,
    status: 'new',
    offer: diagnosticIntake ? 'workflow_hardening_diagnostic' : 'workflow_hardening_sprint',
    contact: {
      name,
      email,
      company: normalizeSafeText(payload.company, 160),
    },
    qualification: {
      workflow,
      owner,
      blocker,
      runtime,
      urgency,
      note: normalizeSafeText(payload.note, 1000),
    },
    attribution: {
      acquisitionId: normalizeSafeText(payload.acquisitionId, 160),
      visitorId: normalizeSafeText(payload.visitorId, 160),
      sessionId: normalizeSafeText(payload.sessionId, 160),
      traceId: normalizeSafeText(payload.traceId, 160),
      installId: normalizeSafeText(payload.installId, 160),
      source: normalizeSafeText(payload.source, 120),
      utmSource: normalizeSafeText(payload.utmSource, 120),
      utmMedium: normalizeSafeText(payload.utmMedium, 120),
      utmCampaign: normalizeSafeText(payload.utmCampaign, 160),
      utmContent: normalizeSafeText(payload.utmContent, 160),
      utmTerm: normalizeSafeText(payload.utmTerm, 160),
      creator: normalizeSafeText(payload.creator, 120),
      community: normalizeSafeText(payload.community, 120),
      postId: normalizeSafeText(payload.postId, 120),
      commentId: normalizeSafeText(payload.commentId, 120),
      campaignVariant: normalizeSafeText(payload.campaignVariant, 120),
      offerCode: normalizeSafeText(payload.offerCode, 120),
      ctaId: normalizeSafeText(payload.ctaId, 120),
      ctaPlacement: normalizeSafeText(payload.ctaPlacement, 120),
      planId: normalizeSafeText(payload.planId, 120),
      page: normalizeSafeText(payload.page, 160),
      landingPath: normalizeSafeText(payload.landingPath, 160),
      referrerHost: normalizeSafeText(payload.referrerHost, 255),
      referrer: normalizeSafeText(payload.referrer, 255),
    },
    workflowProgress: {
      qualifiedAt: null,
      namedPilotAt: null,
      proofBackedRunAt: null,
      paidTeamAt: null,
    },
    proof: {
      artifacts: [],
      reviewedBy: null,
      lastWorkflowRunKey: null,
    },
    statusHistory: [
      buildStatusHistoryEntry({
        fromStatus: null,
        toStatus: 'new',
        actor: normalizeText(payload.actor, 160) || 'website',
        note: normalizeSafeText(payload.note, 1000),
        timestamp: submittedAt,
      }),
    ],
  };
}

function appendWorkflowSprintLead(payload = {}, { feedbackDir } = {}) {
  const lead = buildWorkflowSprintLead(payload);
  return appendWorkflowSprintLeadSnapshot(lead, feedbackDir);
}

function resolveWorkflowSprintAlertRecipient(env = process.env) {
  return normalizeEmail(
    env.THUMBGATE_OPERATOR_ALERT_EMAIL
    || env.THUMBGATE_PRO_ACTIVATION_ALERT_EMAIL
    || env.THUMBGATE_SUPPORT_EMAIL
    || DEFAULT_OPERATOR_ALERT_EMAIL
  );
}

function renderWorkflowSprintLeadAlert(lead = {}) {
  const attribution = lead.attribution || {};
  const contact = lead.contact || {};
  const qualification = lead.qualification || {};
  const text = [
    'New ThumbGate workflow intake.',
    '',
    `Lead ID: ${lead.leadId || 'unknown'}`,
    `Plan: ${attribution.planId || 'unknown'}`,
    `Name: ${contact.name || 'not provided'}`,
    `Email: ${contact.email || 'not provided'}`,
    `Company: ${contact.company || 'not provided'}`,
    `Workflow: ${qualification.workflow || 'not provided'}`,
    `Owner: ${qualification.owner || 'not provided'}`,
    `Blocker: ${qualification.blocker || 'not provided'}`,
    `Runtime: ${qualification.runtime || 'not provided'}`,
    `Urgency: ${qualification.urgency || 'not provided'}`,
    `Source: ${attribution.utmSource || attribution.source || 'unknown'}`,
  ].join('\n');
  return {
    subject: `ThumbGate intake: ${contact.company || contact.email || lead.leadId || 'new lead'}`,
    text,
  };
}

function alertFingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function pruneAlertState(now) {
  for (const [key, timestamp] of intakeAlertDedupByKey) {
    if (now - timestamp >= INTAKE_ALERT_WINDOW_MS) intakeAlertDedupByKey.delete(key);
  }
  for (const [key, timestamps] of intakeAlertTimesByKey) {
    const active = timestamps.filter((timestamp) => now - timestamp < INTAKE_ALERT_WINDOW_MS);
    if (active.length) intakeAlertTimesByKey.set(key, active);
    else intakeAlertTimesByKey.delete(key);
  }
  while (intakeAlertTimesByKey.size > MAX_ALERT_RATE_KEYS) {
    intakeAlertTimesByKey.delete(intakeAlertTimesByKey.keys().next().value);
  }
}

function reserveIntakeAlert({ lead, rateLimitKey, now = Date.now() } = {}) {
  pruneAlertState(now);
  const dedupeKey = alertFingerprint([
    lead && lead.contact && lead.contact.email,
    lead && lead.qualification && lead.qualification.workflow,
  ].join('|'));
  if (intakeAlertDedupByKey.has(dedupeKey)) {
    return { allowed: false, reason: 'duplicate_intake_alert', dedupeKey };
  }

  const normalizedRateKey = normalizeText(rateLimitKey, 160);
  if (normalizedRateKey) {
    const key = alertFingerprint(normalizedRateKey);
    const timestamps = intakeAlertTimesByKey.get(key) || [];
    if (timestamps.length >= MAX_INTAKE_ALERTS_PER_WINDOW) {
      return { allowed: false, reason: 'intake_alert_rate_limited', dedupeKey };
    }
    timestamps.push(now);
    intakeAlertTimesByKey.set(key, timestamps);
  }
  return { allowed: true, dedupeKey };
}

async function notifyWorkflowSprintLead(lead = {}, {
  env = process.env,
  sendEmailImpl,
  rateLimitKey,
  now,
} = {}) {
  const to = resolveWorkflowSprintAlertRecipient(env);
  if (!to) return { sent: false, reason: 'missing_operator_alert_email' };
  const sender = sendEmailImpl || require('./mailer').sendEmail;
  if (typeof sender !== 'function') return { sent: false, reason: 'missing_mailer' };
  const reservation = reserveIntakeAlert({ lead, rateLimitKey, now });
  if (!reservation.allowed) return { sent: false, reason: reservation.reason };
  const message = renderWorkflowSprintLeadAlert(lead);
  try {
    const result = await sender({
      to,
      ...message,
      idempotencyKey: `intake-${reservation.dedupeKey}`,
    });
    if (result && result.sent === true) {
      intakeAlertDedupByKey.set(reservation.dedupeKey, Number.isFinite(now) ? now : Date.now());
    }
    return result;
  } catch (error) {
    return {
      sent: false,
      reason: 'exception',
      error: error && error.message ? error.message : String(error),
    };
  }
}

function loadWorkflowSprintLeadSnapshots(feedbackDir) {
  const leadsPath = getWorkflowSprintLeadsPath(feedbackDir);
  if (!fs.existsSync(leadsPath)) return [];
  const raw = fs.readFileSync(leadsPath, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return sanitizeWorkflowSprintLead(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadWorkflowSprintLeads(feedbackDir) {
  const latestByLeadId = new Map();
  for (const snapshot of loadWorkflowSprintLeadSnapshots(feedbackDir)) {
    const existing = latestByLeadId.get(snapshot.leadId);
    if (!existing || String(snapshot.updatedAt || '') >= String(existing.updatedAt || '')) {
      latestByLeadId.set(snapshot.leadId, snapshot);
    }
  }
  return Array.from(latestByLeadId.values())
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
}

function getWorkflowSprintLeadById(leadId, feedbackDir) {
  const normalizedLeadId = normalizeText(leadId, 160);
  if (!normalizedLeadId) return null;
  return loadWorkflowSprintLeads(feedbackDir)
    .find((entry) => entry.leadId === normalizedLeadId) || null;
}

function resolveLeadTeamId(lead = {}, overrideTeamId = null) {
  const explicitTeamId = normalizeText(overrideTeamId, 160);
  if (explicitTeamId) return explicitTeamId;
  const companySlug = slugify(lead.contact && lead.contact.company, '');
  if (companySlug) return companySlug;
  const email = normalizeEmail(lead.contact && lead.contact.email);
  if (email && email.includes('@')) {
    return slugify(email.split('@')[1], 'workflow_sprint_team');
  }
  return slugify(lead.qualification && lead.qualification.owner, 'workflow_sprint_team');
}

function appendWorkflowRunForSprintTransition(lead, {
  status,
  reviewedBy,
  proofArtifacts,
  workflowId,
  teamId,
  timestamp,
} = {}, feedbackDir) {
  if (status !== 'named_pilot' && status !== 'proof_backed_run' && status !== 'paid_team') {
    return null;
  }
  const normalizedArtifacts = normalizeProofArtifacts(proofArtifacts);
  const normalizedReviewedBy = normalizeText(reviewedBy, 160);
  const workflowRun = appendWorkflowRun({
    timestamp: normalizeText(timestamp, 64) || new Date().toISOString(),
    workflowId: normalizeText(workflowId, 160) || slugify(lead.qualification.workflow, 'workflow_hardening_sprint'),
    workflowName: lead.qualification.workflow,
    owner: lead.qualification.owner,
    runtime: lead.qualification.runtime,
    status: status === 'named_pilot' ? 'in_progress' : 'passed',
    customerType: status === 'paid_team' ? 'paid_team' : 'named_pilot',
    teamId: resolveLeadTeamId(lead, teamId),
    reviewed: Boolean(normalizedReviewedBy || normalizedArtifacts.length > 0),
    reviewedBy: normalizedReviewedBy,
    proofBacked: status === 'proof_backed_run' || status === 'paid_team',
    proofArtifacts: normalizedArtifacts,
    source: `workflow_sprint:${status}`,
    metadata: {
      leadId: lead.leadId,
      pipelineStatus: status,
      offer: lead.offer,
      company: lead.contact && lead.contact.company ? lead.contact.company : null,
    },
  }, feedbackDir);
  return {
    ...workflowRun,
    workflowRunKey: `${workflowRun.workflowId}@${workflowRun.timestamp}`,
  };
}

function advanceWorkflowSprintLead(payload = {}, { feedbackDir } = {}) {
  const leadId = normalizeText(payload.leadId, 160);
  const nextStatus = normalizeWorkflowSprintStatus(payload.status, null);
  const actor = normalizeText(payload.actor, 160) || 'admin';
  const note = normalizeText(payload.note, 1000);
  const reviewedBy = normalizeText(payload.reviewedBy, 160);
  const proofArtifacts = normalizeProofArtifacts(payload.proofArtifacts);
  const workflowId = normalizeText(payload.workflowId, 160);
  const teamId = normalizeText(payload.teamId, 160);

  if (!leadId) {
    const err = new Error('leadId is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!nextStatus) {
    const err = new Error(`status must be one of: ${WORKFLOW_SPRINT_STATUS_FLOW.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const currentLead = getWorkflowSprintLeadById(leadId, feedbackDir);
  if (!currentLead) {
    const err = new Error(`Unknown workflow sprint lead: ${leadId}`);
    err.statusCode = 404;
    throw err;
  }

  if (currentLead.status === nextStatus) {
    return {
      lead: currentLead,
      workflowRun: null,
      unchanged: true,
    };
  }

  const currentIndex = WORKFLOW_SPRINT_STATUS_FLOW.indexOf(currentLead.status);
  const nextIndex = WORKFLOW_SPRINT_STATUS_FLOW.indexOf(nextStatus);
  if (nextIndex !== currentIndex + 1) {
    const err = new Error(`Invalid workflow sprint transition: ${currentLead.status} -> ${nextStatus}`);
    err.statusCode = 400;
    throw err;
  }
  if (nextStatus === 'proof_backed_run' && !reviewedBy && proofArtifacts.length === 0) {
    const err = new Error('proof_backed_run requires reviewedBy or proofArtifacts.');
    err.statusCode = 400;
    throw err;
  }

  const transitionAt = new Date().toISOString();
  const workflowProgress = {
    ...currentLead.workflowProgress,
  };
  if (nextStatus === 'qualified') workflowProgress.qualifiedAt = transitionAt;
  if (nextStatus === 'named_pilot') workflowProgress.namedPilotAt = transitionAt;
  if (nextStatus === 'proof_backed_run') workflowProgress.proofBackedRunAt = transitionAt;
  if (nextStatus === 'paid_team') workflowProgress.paidTeamAt = transitionAt;

  const workflowRun = appendWorkflowRunForSprintTransition(currentLead, {
    status: nextStatus,
    reviewedBy,
    proofArtifacts,
    workflowId,
    teamId,
    timestamp: transitionAt,
  }, feedbackDir);

  const updatedLead = appendWorkflowSprintLeadSnapshot({
    ...currentLead,
    updatedAt: transitionAt,
    status: nextStatus,
    workflowProgress,
    proof: {
      artifacts: proofArtifacts.length ? proofArtifacts : currentLead.proof.artifacts,
      reviewedBy: reviewedBy || currentLead.proof.reviewedBy,
      lastWorkflowRunKey: workflowRun ? workflowRun.workflowRunKey : currentLead.proof.lastWorkflowRunKey,
    },
    statusHistory: currentLead.statusHistory.concat(buildStatusHistoryEntry({
      fromStatus: currentLead.status,
      toStatus: nextStatus,
      actor,
      note,
      reviewedBy,
      proofArtifacts,
      timestamp: transitionAt,
    })),
  }, feedbackDir);

  return {
    lead: updatedLead,
    workflowRun,
    unchanged: false,
  };
}

module.exports = {
  WORKFLOW_SPRINT_LEADS_FILE,
  WORKFLOW_SPRINT_STATUS_FLOW,
  buildWorkflowSprintLead,
  appendWorkflowSprintLead,
  appendWorkflowSprintLeadSnapshot,
  notifyWorkflowSprintLead,
  renderWorkflowSprintLeadAlert,
  resolveWorkflowSprintAlertRecipient,
  advanceWorkflowSprintLead,
  loadWorkflowSprintLeads,
  loadWorkflowSprintLeadSnapshots,
  getWorkflowSprintLeadById,
  getWorkflowSprintLeadsPath,
  getWorkflowSprintIntakeLimitsPath,
  reserveWorkflowSprintIntake,
  sanitizeWorkflowSprintLead,
  normalizeWorkflowSprintStatus,
};
