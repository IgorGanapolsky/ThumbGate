'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getFeedbackPaths } = require('./feedback-loop');

const WORKFLOW_SPRINT_LEADS_FILE = 'workflow-sprint-leads.jsonl';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  return {
    leadId: `lead_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    submittedAt: new Date().toISOString(),
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
  };
}

function appendWorkflowSprintLead(payload = {}, { feedbackDir } = {}) {
  const lead = buildWorkflowSprintLead(payload);
  const leadsPath = getWorkflowSprintLeadsPath(feedbackDir);
  fs.mkdirSync(path.dirname(leadsPath), { recursive: true });
  fs.appendFileSync(leadsPath, `${JSON.stringify(lead)}\n`, 'utf8');
  return lead;
}

function loadWorkflowSprintLeads(feedbackDir) {
  const leadsPath = getWorkflowSprintLeadsPath(feedbackDir);
  if (!fs.existsSync(leadsPath)) return [];
  const raw = fs.readFileSync(leadsPath, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = {
  WORKFLOW_SPRINT_LEADS_FILE,
  buildWorkflowSprintLead,
  appendWorkflowSprintLead,
  loadWorkflowSprintLeads,
  getWorkflowSprintLeadsPath,
};
