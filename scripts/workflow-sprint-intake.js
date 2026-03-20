'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getFeedbackPaths } = require('./feedback-loop');
const { appendWorkflowRun } = require('./workflow-runs');

const WORKFLOW_SPRINT_LEADS_FILE = 'workflow-sprint-leads.jsonl';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
    note: normalizeText(note, 1000),
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
      email: normalizeEmail(entry.contact && entry.contact.email),
      company: normalizeText(entry.contact && entry.contact.company, 160),
    },
    qualification: {
      workflow: normalizeText(entry.qualification && entry.qualification.workflow, 240),
      owner: normalizeText(entry.qualification && entry.qualification.owner, 160),
      blocker: normalizeText(entry.qualification && entry.qualification.blocker, 1000),
      runtime: normalizeText(entry.qualification && entry.qualification.runtime, 160),
      note: normalizeText(entry.qualification && entry.qualification.note, 1000),
    },
    attribution: {
      acquisitionId: normalizeText(entry.attribution && entry.attribution.acquisitionId, 160),
      visitorId: normalizeText(entry.attribution && entry.attribution.visitorId, 160),
      sessionId: normalizeText(entry.attribution && entry.attribution.sessionId, 160),
      traceId: normalizeText(entry.attribution && entry.attribution.traceId, 160),
      installId: normalizeText(entry.attribution && entry.attribution.installId, 160),
      source: normalizeText(entry.attribution && entry.attribution.source, 120),
      utmSource: normalizeText(entry.attribution && entry.attribution.utmSource, 120),
      utmMedium: normalizeText(entry.attribution && entry.attribution.utmMedium, 120),
      utmCampaign: normalizeText(entry.attribution && entry.attribution.utmCampaign, 160),
      utmContent: normalizeText(entry.attribution && entry.attribution.utmContent, 160),
      utmTerm: normalizeText(entry.attribution && entry.attribution.utmTerm, 160),
      community: normalizeText(entry.attribution && entry.attribution.community, 120),
      postId: normalizeText(entry.attribution && entry.attribution.postId, 120),
      commentId: normalizeText(entry.attribution && entry.attribution.commentId, 120),
      campaignVariant: normalizeText(entry.attribution && entry.attribution.campaignVariant, 120),
      offerCode: normalizeText(entry.attribution && entry.attribution.offerCode, 120),
      ctaId: normalizeText(entry.attribution && entry.attribution.ctaId, 120),
      ctaPlacement: normalizeText(entry.attribution && entry.attribution.ctaPlacement, 120),
      planId: normalizeText(entry.attribution && entry.attribution.planId, 120),
      page: normalizeText(entry.attribution && entry.attribution.page, 160),
      landingPath: normalizeText(entry.attribution && entry.attribution.landingPath, 160),
      referrerHost: normalizeText(entry.attribution && entry.attribution.referrerHost, 255),
      referrer: normalizeText(entry.attribution && entry.attribution.referrer, 255),
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

function buildWorkflowSprintLead(payload = {}) {
  const email = normalizeEmail(payload.email);
  const workflow = normalizeText(payload.workflow, 240);
  const owner = normalizeText(payload.owner, 160);
  const blocker = normalizeText(payload.blocker, 1000);
  const runtime = normalizeText(payload.runtime, 160);

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
  if (!owner) {
    const err = new Error('Workflow owner is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!blocker) {
    const err = new Error('Repeated failure or rollout blocker is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!runtime) {
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
    offer: 'workflow_hardening_sprint',
    contact: {
      email,
      company: normalizeText(payload.company, 160),
    },
    qualification: {
      workflow,
      owner,
      blocker,
      runtime,
      note: normalizeText(payload.note, 1000),
    },
    attribution: {
      acquisitionId: normalizeText(payload.acquisitionId, 160),
      visitorId: normalizeText(payload.visitorId, 160),
      sessionId: normalizeText(payload.sessionId, 160),
      traceId: normalizeText(payload.traceId, 160),
      installId: normalizeText(payload.installId, 160),
      source: normalizeText(payload.source, 120),
      utmSource: normalizeText(payload.utmSource, 120),
      utmMedium: normalizeText(payload.utmMedium, 120),
      utmCampaign: normalizeText(payload.utmCampaign, 160),
      utmContent: normalizeText(payload.utmContent, 160),
      utmTerm: normalizeText(payload.utmTerm, 160),
      community: normalizeText(payload.community, 120),
      postId: normalizeText(payload.postId, 120),
      commentId: normalizeText(payload.commentId, 120),
      campaignVariant: normalizeText(payload.campaignVariant, 120),
      offerCode: normalizeText(payload.offerCode, 120),
      ctaId: normalizeText(payload.ctaId, 120),
      ctaPlacement: normalizeText(payload.ctaPlacement, 120),
      planId: normalizeText(payload.planId, 120),
      page: normalizeText(payload.page, 160),
      landingPath: normalizeText(payload.landingPath, 160),
      referrerHost: normalizeText(payload.referrerHost, 255),
      referrer: normalizeText(payload.referrer, 255),
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
        note: normalizeText(payload.note, 1000),
        timestamp: submittedAt,
      }),
    ],
  };
}

function appendWorkflowSprintLead(payload = {}, { feedbackDir } = {}) {
  const lead = buildWorkflowSprintLead(payload);
  return appendWorkflowSprintLeadSnapshot(lead, feedbackDir);
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
  advanceWorkflowSprintLead,
  loadWorkflowSprintLeads,
  loadWorkflowSprintLeadSnapshots,
  getWorkflowSprintLeadById,
  getWorkflowSprintLeadsPath,
  sanitizeWorkflowSprintLead,
  normalizeWorkflowSprintStatus,
};
