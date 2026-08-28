#!/usr/bin/env node
'use strict';

/**
 * workflow-notebook.js — goal → reviewed plan → approved execution → captured
 * decisions → discoverable index, for repetitive agent workflows.
 *
 * Pattern source: "Automating repetitive work at OpenAI with Codex" (2026).
 * The four lessons encoded here:
 *
 *  1. A short goal cell, then a PLAN the human reviews BEFORE execution starts.
 *     The approval boundary is structural, not advisory: recording work before
 *     approval is rejected, fail-closed.
 *  2. The notebook captures commands, outputs, and interpretations — including
 *     dead ends — while the work happens, so documentation costs nothing extra.
 *  3. Decisions that would otherwise die in chat history get explicit records:
 *     the alternatives considered, the choice, and the reason.
 *  4. Every finished notebook emits a companion `*.index.md` (title, goal,
 *     status, decisions, outcomes) that future agent runs can discover — the
 *     context flywheel that makes the next run cheaper than the last one.
 *
 * Storage: <feedbackDir>/workflow-notebooks/<id>.json (source of truth) plus
 * <id>.index.md (discovery artifact). No server, no new infrastructure — the
 * notebook is a file, exactly like the article's static-app design.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveFeedbackDir } = require('./feedback-paths');
const { ensureDir } = require('./fs-utils');

const STATUSES = new Set(['created', 'planned', 'approved', 'running', 'completed', 'aborted']);

function getNotebooksDir(feedbackDir) {
  if (process.env.THUMBGATE_WORKFLOW_NOTEBOOKS_DIR) {
    return process.env.THUMBGATE_WORKFLOW_NOTEBOOKS_DIR;
  }
  return path.join(resolveFeedbackDir({ feedbackDir }), 'workflow-notebooks');
}

function buildNotebookId(title) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = crypto.randomBytes(3).toString('hex');
  const slug = String(title || 'workflow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workflow';
  return `${stamp}-${slug}-${suffix}`;
}

function notebookPath(notebookId, feedbackDir) {
  return path.join(getNotebooksDir(feedbackDir), `${notebookId}.json`);
}

function loadNotebook(notebookId, feedbackDir) {
  const file = notebookPath(notebookId, feedbackDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveNotebook(notebook, feedbackDir) {
  const file = notebookPath(notebook.id, feedbackDir);
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(notebook, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return notebook;
}

/**
 * Start a notebook with a goal. Status becomes 'planned' once a plan exists;
 * no steps may be recorded before an explicit approval (fail-closed).
 */
function createNotebook({ title, goal, context = [] } = {}, feedbackDir) {
  if (!title || !String(title).trim()) {
    throw new TypeError('createNotebook: title is required');
  }
  if (!goal || !String(goal).trim()) {
    throw new TypeError('createNotebook: goal is required — the goal cell is the contract');
  }
  const notebook = {
    id: buildNotebookId(title),
    title: String(title).trim(),
    goal: String(goal).trim(),
    context: Array.isArray(context) ? context.map(String) : [],
    status: 'created',
    plan: null,
    approvedBy: null,
    approvedAt: null,
    steps: [],
    decisions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return saveNotebook(notebook, feedbackDir);
}

function setPlan(notebookId, plan, feedbackDir) {
  if (!plan || !String(plan).trim()) {
    throw new TypeError('setPlan: plan text is required — approve a plan, not an impulse');
  }
  const notebook = loadNotebook(notebookId, feedbackDir);
  if (!notebook) throw new Error(`setPlan: notebook not found: ${notebookId}`);
  if (notebook.status !== 'created' && notebook.status !== 'planned') {
    throw new Error(`setPlan: notebook ${notebookId} is ${notebook.status}; plan is locked after approval`);
  }
  notebook.plan = String(plan).trim();
  notebook.status = 'planned';
  notebook.updatedAt = new Date().toISOString();
  return saveNotebook(notebook, feedbackDir);
}

/**
 * The approval boundary. Only an APPROVED notebook may record steps. The
 * approver identity is captured for audit — "who decided the plan was ready".
 */
function approveNotebook(notebookId, approver, feedbackDir) {
  if (!approver || !String(approver).trim()) {
    throw new TypeError('approveNotebook: approver identity is required');
  }
  const notebook = loadNotebook(notebookId, feedbackDir);
  if (!notebook) throw new Error(`approveNotebook: notebook not found: ${notebookId}`);
  if (notebook.status !== 'planned') {
    throw new Error(`approveNotebook: notebook ${notebookId} is ${notebook.status}; only a planned notebook can be approved`);
  }
  if (!notebook.plan) {
    throw new Error(`approveNotebook: notebook ${notebookId} has no plan to approve`);
  }
  notebook.status = 'approved';
  notebook.approvedBy = String(approver).trim();
  notebook.approvedAt = new Date().toISOString();
  notebook.updatedAt = notebook.approvedAt;
  return saveNotebook(notebook, feedbackDir);
}

function assertApproved(notebook, verb) {
  // Fail-closed: the article keeps humans deciding when a plan is ready. An
  // unapproved notebook recording execution would silently erase that boundary.
  if (!notebook) throw new Error(`${verb}: notebook not found`);
  if (notebook.status !== 'approved' && notebook.status !== 'running') {
    throw new Error(
      `${verb}: notebook ${notebook.id} is ${notebook.status}; `
      + 'record a plan and get it approved before recording execution',
    );
  }
}

/**
 * Record one unit of executed work: the command/action, its output, and the
 * human-readable interpretation. Dead ends are first-class: mark
 * outcome:'dead-end' so the NEXT run knows what not to try.
 */
function recordStep(notebookId, { action, output = '', interpretation = '', outcome = 'ok' } = {}, feedbackDir) {
  const notebook = loadNotebook(notebookId, feedbackDir);
  assertApproved(notebook, 'recordStep');
  if (!action || !String(action).trim()) {
    throw new TypeError('recordStep: action is required');
  }
  const allowedOutcomes = new Set(['ok', 'dead-end', 'blocked', 'needs-review']);
  if (!allowedOutcomes.has(outcome)) {
    throw new TypeError(`recordStep: outcome must be one of ${[...allowedOutcomes].join(', ')}`);
  }
  notebook.steps.push({
    seq: notebook.steps.length + 1,
    action: String(action).trim(),
    output: String(output).slice(0, 8000),
    interpretation: String(interpretation),
    outcome,
    at: new Date().toISOString(),
  });
  notebook.status = 'running';
  notebook.updatedAt = new Date().toISOString();
  return saveNotebook(notebook, feedbackDir);
}

/**
 * Capture a decision that would otherwise disappear into the conversation:
 * the alternatives considered, the choice, and the reason.
 */
function recordDecision(notebookId, { question, alternatives = [], choice, reason } = {}, feedbackDir) {
  const notebook = loadNotebook(notebookId, feedbackDir);
  assertApproved(notebook, 'recordDecision');
  if (!question || !String(question).trim()) {
    throw new TypeError('recordDecision: question is required');
  }
  if (!choice || !String(choice).trim()) {
    throw new TypeError('recordDecision: choice is required');
  }
  notebook.decisions.push({
    seq: notebook.decisions.length + 1,
    question: String(question).trim(),
    alternatives: Array.isArray(alternatives) ? alternatives.map(String) : [],
    choice: String(choice).trim(),
    reason: String(reason || '').trim(),
    at: new Date().toISOString(),
  });
  notebook.updatedAt = new Date().toISOString();
  return saveNotebook(notebook, feedbackDir);
}

function finishNotebook(notebookId, { summary = '', outcome = 'completed' } = {}, feedbackDir) {
  const notebook = loadNotebook(notebookId, feedbackDir);
  assertApproved(notebook, 'finishNotebook');
  if (outcome !== 'completed' && outcome !== 'aborted') {
    throw new TypeError('finishNotebook: outcome must be completed or aborted');
  }
  notebook.status = outcome;
  notebook.summary = String(summary).trim();
  notebook.finishedAt = new Date().toISOString();
  notebook.updatedAt = notebook.finishedAt;
  saveNotebook(notebook, feedbackDir);
  return writeIndex(notebook, feedbackDir);
}

/**
 * Companion discovery index (the article's `*.index.md`): a small Markdown
 * summary that future runs can grep/discover for prior context — goal, status,
 * decisions, dead ends. Markdown, not JSON, so any agent or human can read it.
 */
function writeIndex(notebook, feedbackDir) {
  const dir = getNotebooksDir(feedbackDir);
  ensureDir(dir);
  const lines = [
    `# ${notebook.title}`,
    '',
    `- notebook: ${notebook.id}`,
    `- status: ${notebook.status}`,
    `- created: ${notebook.createdAt}`,
    notebook.approvedAt ? `- approved-by: ${notebook.approvedBy} (${notebook.approvedAt})` : '- approved-by: (none)',
    '',
    '## Goal',
    '',
    notebook.goal,
    '',
  ];
  if (notebook.plan) {
    lines.push('## Plan', '', notebook.plan, '');
  }
  if (notebook.decisions.length > 0) {
    lines.push('## Decisions', '');
    for (const d of notebook.decisions) {
      lines.push(`- Q: ${d.question}`);
      lines.push(`  Chose: ${d.choice}${d.reason ? ` — ${d.reason}` : ''}`);
      if (d.alternatives.length > 0) lines.push(`  Alternatives: ${d.alternatives.join('; ')}`);
    }
    lines.push('');
  }
  const deadEnds = (notebook.steps || []).filter((s) => s.outcome === 'dead-end');
  if (deadEnds.length > 0) {
    lines.push('## Dead ends (do not repeat)', '');
    for (const s of deadEnds) lines.push(`- ${s.action}${s.interpretation ? ` — ${s.interpretation}` : ''}`);
    lines.push('');
  }
  if (notebook.summary) {
    lines.push('## Summary', '', notebook.summary, '');
  }
  const indexPath = path.join(dir, `${notebook.id}.index.md`);
  fs.writeFileSync(indexPath, `${lines.join('\n')}`);
  return indexPath;
}

/**
 * Discovery: list notebooks by reading their index files, most recent first.
 * Falls back to the JSON when the index is missing.
 */
function listNotebooks(feedbackDir) {
  const dir = getNotebooksDir(feedbackDir);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.index.md'));
  const notebooks = [];
  for (const entry of entries) {
    const id = entry.replace(/\.index\.md$/, '');
    const notebook = loadNotebook(id, feedbackDir);
    if (!notebook) continue;
    notebooks.push({
      id,
      title: notebook.title,
      goal: notebook.goal,
      status: notebook.status,
      decisions: notebook.decisions.length,
      steps: notebook.steps.length,
      createdAt: notebook.createdAt,
      updatedAt: notebook.updatedAt,
      index: path.join(dir, entry),
    });
  }
  return notebooks.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const parseJson = (raw) => {
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  };
  switch (cmd) {
    case 'create': {
      const opts = parseJson(rest[0]);
      const notebook = createNotebook(opts);
      console.log(JSON.stringify({ id: notebook.id, status: notebook.status }, null, 2));
      break;
    }
    case 'plan': {
      const [id, ...planParts] = rest;
      const notebook = setPlan(id, planParts.join(' '));
      console.log(JSON.stringify({ id: notebook.id, status: notebook.status }, null, 2));
      break;
    }
    case 'approve': {
      const [id, approver] = rest;
      const notebook = approveNotebook(id, approver);
      console.log(JSON.stringify({ id: notebook.id, status: notebook.status, approvedBy: notebook.approvedBy }, null, 2));
      break;
    }
    case 'step': {
      const [id, ...jsonRaw] = rest;
      const opts = parseJson(jsonRaw.join(' '));
      const notebook = recordStep(id, opts);
      console.log(JSON.stringify({ id: notebook.id, steps: notebook.steps.length }, null, 2));
      break;
    }
    case 'decide': {
      const [id, ...jsonRaw] = rest;
      const opts = parseJson(jsonRaw.join(' '));
      const notebook = recordDecision(id, opts);
      console.log(JSON.stringify({ id: notebook.id, decisions: notebook.decisions.length }, null, 2));
      break;
    }
    case 'finish': {
      const [id, ...jsonRaw] = rest;
      const opts = parseJson(jsonRaw.join(' '));
      const indexPath = finishNotebook(id, opts);
      console.log(JSON.stringify({ index: indexPath }, null, 2));
      break;
    }
    case 'list': {
      console.log(JSON.stringify(listNotebooks(), null, 2));
      break;
    }
    default:
      console.error('usage: workflow-notebook.js create <json> | plan <id> <plan> | approve <id> <approver> | step <id> <json> | decide <id> <json> | finish <id> <json> | list');
      process.exitCode = 2;
  }
}

module.exports = {
  STATUSES,
  getNotebooksDir,
  createNotebook,
  setPlan,
  approveNotebook,
  recordStep,
  recordDecision,
  finishNotebook,
  writeIndex,
  listNotebooks,
  loadNotebook,
};

if (require.main?.filename === module.filename) {
  main();
}
