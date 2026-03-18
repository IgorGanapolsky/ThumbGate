'use strict';

const fs = require('fs');
const path = require('path');

const { getFeedbackPaths } = require('./feedback-loop');

const WORKFLOW_RUNS_FILE_NAME = 'workflow-runs.jsonl';
const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

function getWorkflowRunsPath(feedbackDir = getFeedbackPaths().FEEDBACK_DIR) {
  return path.join(feedbackDir, WORKFLOW_RUNS_FILE_NAME);
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeTimestamp(value) {
  const text = normalizeText(value);
  if (!text) return new Date().toISOString();
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function normalizeProofArtifacts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function sanitizeWorkflowRun(entry = {}) {
  const proofArtifacts = normalizeProofArtifacts(entry.proofArtifacts);
  const proofBacked = Boolean(entry.proofBacked);
  const reviewed = typeof entry.reviewed === 'boolean'
    ? entry.reviewed
    : Boolean(entry.reviewedBy || proofArtifacts.length > 0);

  return {
    timestamp: normalizeTimestamp(entry.timestamp),
    workflowId: normalizeText(entry.workflowId) || 'unknown_workflow',
    workflowName: normalizeText(entry.workflowName) || 'Unknown workflow',
    owner: normalizeText(entry.owner) || 'unknown_owner',
    runtime: normalizeText(entry.runtime) || 'unknown_runtime',
    status: normalizeText(entry.status) || 'passed',
    customerType: normalizeText(entry.customerType) || 'internal_dogfood',
    teamId: normalizeText(entry.teamId),
    reviewed,
    reviewedBy: normalizeText(entry.reviewedBy),
    proofBacked,
    proofArtifacts,
    source: normalizeText(entry.source),
    metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
  };
}

function appendWorkflowRun(entry = {}, feedbackDir = getFeedbackPaths().FEEDBACK_DIR) {
  const target = getWorkflowRunsPath(feedbackDir);
  const sanitized = sanitizeWorkflowRun(entry);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(sanitized)}\n`, 'utf-8');
  return sanitized;
}

function loadWorkflowRuns(feedbackDir = getFeedbackPaths().FEEDBACK_DIR) {
  const target = getWorkflowRunsPath(feedbackDir);
  if (!fs.existsSync(target)) return [];
  const raw = fs.readFileSync(target, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return sanitizeWorkflowRun(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

function summarizeWorkflowRuns(feedbackDir = getFeedbackPaths().FEEDBACK_DIR, now = new Date()) {
  const entries = loadWorkflowRuns(feedbackDir);
  const windowStart = new Date(now.getTime() - WEEK_IN_MS).toISOString();
  const proofBackedEntries = entries.filter((entry) => entry.proofBacked);
  const recentProofBackedEntries = proofBackedEntries.filter((entry) => String(entry.timestamp) >= windowStart);
  const weeklyWorkflowIds = new Set(recentProofBackedEntries.map((entry) => entry.workflowId).filter(Boolean));
  const weeklyTeamKeys = new Set(
    recentProofBackedEntries
      .map((entry) => entry.teamId || `${entry.customerType}:${entry.workflowId}`)
      .filter(Boolean)
  );
  const namedPilotAgreements = entries.filter((entry) => entry.customerType === 'named_pilot').length;
  const paidTeamRuns = entries.filter((entry) => entry.customerType === 'paid_team').length;
  const latestRun = entries.length ? entries[entries.length - 1] : null;

  return {
    totalRuns: entries.length,
    proofBackedRuns: proofBackedEntries.length,
    reviewedRuns: entries.filter((entry) => entry.reviewed).length,
    weeklyActiveProofBackedWorkflowRuns: weeklyWorkflowIds.size,
    weeklyTeamsRunningProofBackedWorkflows: weeklyTeamKeys.size,
    namedPilotAgreements,
    paidTeamRuns,
    northStarReached: weeklyWorkflowIds.size > 0,
    customerProofReached: namedPilotAgreements > 0 || paidTeamRuns > 0,
    latestRun,
  };
}

module.exports = {
  WORKFLOW_RUNS_FILE_NAME,
  appendWorkflowRun,
  getWorkflowRunsPath,
  loadWorkflowRuns,
  sanitizeWorkflowRun,
  summarizeWorkflowRuns,
};
