#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const {
  ensureContextFs,
  constructContextPack,
  recordProvenance,
} = require('./contextfs');
const { planIntent } = require('./intent-router');
const { formatCodeGraphRecallSection } = require('./codegraph-context');

const KNOWN_SOURCES = new Set(['github', 'slack', 'linear', 'api', 'cli']);
const DEFAULT_SOURCE = 'api';
const DEFAULT_SANDBOX_ROOT = path.join(os.tmpdir(), 'thumbgate-internal-agent-sandboxes');

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function slugify(value) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'item';
}

function uniqueStrings(values = []) {
  return Array.from(new Set(
    values
      .map((value) => normalizeText(value))
      .filter(Boolean),
  ));
}

function hashFragment(values = []) {
  return crypto
    .createHash('sha1')
    .update(values.filter(Boolean).join('|'))
    .digest('hex')
    .slice(0, 12);
}

function ensureGitRepo(repoPath) {
  if (!repoPath) return null;
  const resolved = path.resolve(repoPath);
  const target = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
  try {
    return execFileSync('git', ['-C', target, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (err) {
    throw new Error(`repoPath must point to a git repository: ${resolved}`);
  }
}

function normalizeConversation(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      if (typeof entry === 'string') {
        return {
          author: null,
          text: normalizeText(entry),
          timestamp: null,
        };
      }
      if (!entry || typeof entry !== 'object') return null;
      return {
        author: normalizeText(entry.author || entry.user || entry.name) || null,
        text: normalizeText(entry.text || entry.body || entry.message),
        timestamp: normalizeText(entry.timestamp || entry.createdAt || entry.updatedAt) || null,
      };
    })
    .filter((entry) => entry && entry.text);
}

function inferIntentId({ task, context }) {
  const text = `${normalizeText(task.title)} ${normalizeText(task.body)} ${normalizeText(context)}`.toLowerCase();
  if (/\b(incident|postmortem|outage|retro)\b/.test(text)) {
    return 'incident_postmortem';
  }
  return 'improve_response_quality';
}

function normalizeSource(source) {
  const normalized = normalizeText(source).toLowerCase();
  return KNOWN_SOURCES.has(normalized) ? normalized : DEFAULT_SOURCE;
}

function deriveThreadId(invocation) {
  const explicit = normalizeText(invocation.thread.id)
    || normalizeText(invocation.trigger.id)
    || normalizeText(invocation.task.number)
    || normalizeText(invocation.task.title);

  if (explicit) {
    return `${invocation.source}-${slugify(explicit)}`;
  }

  return `${invocation.source}-${hashFragment([
    invocation.source,
    invocation.trigger.type,
    invocation.context,
    invocation.task.title,
    invocation.task.body,
  ])}`;
}

function normalizeInvocation(input = {}) {
  const source = normalizeSource(input.source);
  const trigger = {
    type: normalizeText(input.trigger && input.trigger.type) || `${source}_event`,
    id: normalizeText(input.trigger && input.trigger.id) || null,
    url: normalizeText(input.trigger && input.trigger.url) || null,
    actor: normalizeText(input.trigger && input.trigger.actor) || null,
  };
  const thread = {
    id: normalizeText(input.thread && input.thread.id) || null,
    title: normalizeText(input.thread && input.thread.title) || null,
    url: normalizeText(input.thread && input.thread.url) || null,
  };
  const task = {
    title: normalizeText(input.task && input.task.title) || thread.title || null,
    body: normalizeText(input.task && input.task.body) || null,
    number: normalizeText(input.task && input.task.number) || null,
    labels: uniqueStrings(Array.isArray(input.task && input.task.labels) ? input.task.labels : []),
    branch: normalizeText(input.task && input.task.branch) || null,
  };
  const context = normalizeText(input.context);
  const repoPath = input.repoPath ? ensureGitRepo(input.repoPath) : null;
  const threadId = deriveThreadId({ source, trigger, thread, task, context });
  const intentId = normalizeText(input.intentId) || inferIntentId({ task, context });
  const prepareSandbox = input.prepareSandbox !== false && Boolean(repoPath);
  const sandboxRoot = path.resolve(input.sandboxRoot || process.env.THUMBGATE_AGENT_SANDBOX_ROOT || DEFAULT_SANDBOX_ROOT);

  return {
    source,
    trigger,
    thread: {
      ...thread,
      id: thread.id || threadId,
    },
    threadId,
    task,
    comments: normalizeConversation(input.comments),
    messages: normalizeConversation(input.messages),
    context,
    repoPath,
    prepareSandbox,
    sandboxRoot,
    intentId,
    mcpProfile: normalizeText(input.mcpProfile) || undefined,
    partnerProfile: normalizeText(input.partnerProfile) || undefined,
    delegationMode: normalizeText(input.delegationMode) || 'auto',
    approved: input.approved === true,
  };
}

function buildStartupContext(invocation) {
  const sections = [];

  sections.push({
    title: 'Trigger',
    lines: [
      `Source: ${invocation.source}`,
      `Trigger type: ${invocation.trigger.type}`,
      `Thread ID: ${invocation.threadId}`,
      invocation.trigger.actor ? `Actor: ${invocation.trigger.actor}` : null,
      invocation.trigger.url ? `Trigger URL: ${invocation.trigger.url}` : null,
      invocation.thread.url ? `Thread URL: ${invocation.thread.url}` : null,
    ].filter(Boolean),
  });

  sections.push({
    title: 'Task',
    lines: [
      invocation.task.title ? `Title: ${invocation.task.title}` : null,
      invocation.task.number ? `Number: ${invocation.task.number}` : null,
      invocation.task.labels.length > 0 ? `Labels: ${invocation.task.labels.join(', ')}` : null,
      invocation.task.body ? `Body: ${invocation.task.body}` : null,
    ].filter(Boolean),
  });

  if (invocation.comments.length > 0) {
    sections.push({
      title: 'Thread History',
      lines: invocation.comments.map((entry) => {
        const prefix = entry.author ? `${entry.author}: ` : '';
        return `${prefix}${entry.text}`;
      }),
    });
  }

  if (invocation.messages.length > 0) {
    sections.push({
      title: 'Conversation',
      lines: invocation.messages.map((entry) => {
        const prefix = entry.author ? `${entry.author}: ` : '';
        return `${prefix}${entry.text}`;
      }),
    });
  }

  if (invocation.context) {
    sections.push({
      title: 'Operator Context',
      lines: [invocation.context],
    });
  }

  if (invocation.repoPath) {
    sections.push({
      title: 'Workspace',
      lines: [`Repository: ${invocation.repoPath}`],
    });
  }

  const text = sections
    .filter((section) => section.lines.length > 0)
    .map((section) => `## ${section.title}\n${section.lines.join('\n')}`)
    .join('\n\n');

  return {
    text,
    sections,
  };
}

function buildRecallQuery(invocation) {
  return [
    invocation.task.title,
    invocation.task.body,
    invocation.context,
    ...invocation.comments.slice(0, 3).map((entry) => entry.text),
    ...invocation.messages.slice(0, 3).map((entry) => entry.text),
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);
}

function ensureWorktreeSandbox({ repoPath, sandboxRoot, threadId }) {
  if (!repoPath) {
    return {
      ready: false,
      kind: 'none',
      path: null,
      reused: false,
      baseRef: null,
    };
  }

  const repoName = slugify(path.basename(repoPath));
  const sandboxPath = path.join(path.resolve(sandboxRoot), repoName, slugify(threadId));
  fs.mkdirSync(path.dirname(sandboxPath), { recursive: true });

  if (fs.existsSync(path.join(sandboxPath, '.git'))) {
    return {
      ready: true,
      kind: 'git_worktree',
      path: sandboxPath,
      reused: true,
      baseRef: 'HEAD',
    };
  }

  if (fs.existsSync(sandboxPath) && fs.readdirSync(sandboxPath).length > 0) {
    throw new Error(`Sandbox path already exists and is not a ThumbGate worktree: ${sandboxPath}`);
  }

  execFileSync('git', ['-C', repoPath, 'worktree', 'add', '--detach', sandboxPath, 'HEAD'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    ready: true,
    kind: 'git_worktree',
    path: sandboxPath,
    reused: false,
    baseRef: 'HEAD',
  };
}

function summarizePack(pack) {
  return {
    packId: pack.packId,
    itemCount: Array.isArray(pack.items) ? pack.items.length : 0,
    cache: pack.cache || { hit: false },
    visibleTitles: pack.visibility && Array.isArray(pack.visibility.visibleTitles)
      ? pack.visibility.visibleTitles.slice()
      : [],
  };
}

function buildReviewerLane(plan) {
  if (!plan) {
    return {
      enabled: false,
      delegateProfile: null,
      executionMode: null,
      verificationMode: null,
      requiredChecks: [],
      requiredEvidence: [],
    };
  }

  const requiredChecks = plan.handoffContract && Array.isArray(plan.handoffContract.requiredChecks)
    ? plan.handoffContract.requiredChecks.slice()
    : (plan.partnerStrategy && Array.isArray(plan.partnerStrategy.recommendedChecks)
      ? plan.partnerStrategy.recommendedChecks.slice()
      : []);

  const requiredEvidence = plan.handoffContract && Array.isArray(plan.handoffContract.requiredEvidence)
    ? plan.handoffContract.requiredEvidence.slice()
    : ['tests', 'proof', 'diff_review'];

  return {
    enabled: plan.delegationEligible === true,
    delegateProfile: plan.delegateProfile || null,
    executionMode: plan.executionMode || null,
    verificationMode: plan.partnerStrategy ? plan.partnerStrategy.verificationMode : null,
    requiredChecks,
    requiredEvidence,
  };
}

function buildMiddlewarePlan({ sandbox, recallPack, plan, reviewerLane }) {
  return [
    {
      step: 'trigger_normalization',
      status: 'ready',
      details: {},
    },
    {
      step: 'startup_context_hydration',
      status: 'ready',
      details: {},
    },
    {
      step: 'context_pack_construction',
      status: 'ready',
      details: summarizePack(recallPack),
    },
    {
      step: 'sandbox_preparation',
      status: sandbox.ready ? 'ready' : 'skipped',
      details: {
        kind: sandbox.kind,
        path: sandbox.path,
        reused: sandbox.reused,
      },
    },
    {
      step: 'intent_planning',
      status: 'ready',
      details: {
        intentId: plan.intent.id,
        status: plan.status,
        executionMode: plan.executionMode,
      },
    },
    {
      step: 'reviewer_lane',
      status: reviewerLane.enabled ? 'ready' : 'optional',
      details: {
        enabled: reviewerLane.enabled,
        delegateProfile: reviewerLane.delegateProfile,
        verificationMode: reviewerLane.verificationMode,
      },
    },
    {
      step: 'proof_gate',
      status: 'ready',
      details: {
        requiredChecks: reviewerLane.requiredChecks,
        requiredEvidence: reviewerLane.requiredEvidence,
      },
    },
    {
      step: 'feedback_capture',
      status: 'ready',
      details: {
        tool: 'capture_feedback',
      },
    },
  ];
}

function bootstrapInternalAgent(options = {}) {
  const invocation = normalizeInvocation(options);
  const startupContext = buildStartupContext(invocation);

  ensureContextFs();
  const recallPack = constructContextPack({
    query: buildRecallQuery(invocation),
    maxItems: 6,
    maxChars: 5000,
  });

  const sandbox = invocation.prepareSandbox
    ? ensureWorktreeSandbox({
      repoPath: invocation.repoPath,
      sandboxRoot: invocation.sandboxRoot,
      threadId: invocation.threadId,
    })
    : {
      ready: false,
      kind: 'none',
      path: null,
      reused: false,
      baseRef: null,
    };

  const plan = planIntent({
    intentId: invocation.intentId,
    context: startupContext.text,
    mcpProfile: invocation.mcpProfile,
    partnerProfile: invocation.partnerProfile,
    delegationMode: invocation.delegationMode,
    approved: invocation.approved,
    repoPath: sandbox.path || invocation.repoPath || undefined,
  });

  const reviewerLane = buildReviewerLane(plan);
  const codeGraphSection = formatCodeGraphRecallSection(plan.codegraphImpact);
  const middlewarePlan = buildMiddlewarePlan({
    sandbox,
    recallPack,
    plan,
    reviewerLane,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    invocation: {
      source: invocation.source,
      trigger: invocation.trigger,
      thread: invocation.thread,
      threadId: invocation.threadId,
      task: invocation.task,
      repoPath: invocation.repoPath,
      prepareSandbox: invocation.prepareSandbox,
      intentId: invocation.intentId,
      mcpProfile: invocation.mcpProfile || 'default',
      delegationMode: invocation.delegationMode,
    },
    startupContext,
    recallPack: summarizePack(recallPack),
    sandbox,
    intentPlan: plan,
    reviewerLane,
    middlewarePlan,
    codeGraph: {
      enabled: Boolean(codeGraphSection),
      section: codeGraphSection,
    },
  };

  recordProvenance({
    type: 'internal_agent_bootstrap_created',
    source: invocation.source,
    threadId: invocation.threadId,
    sandboxPath: sandbox.path,
    intentId: plan.intent.id,
    delegationEligible: plan.delegationEligible,
    packId: recallPack.packId,
  });

  return payload;
}

module.exports = {
  DEFAULT_SANDBOX_ROOT,
  normalizeInvocation,
  buildStartupContext,
  ensureWorktreeSandbox,
  buildMiddlewarePlan,
  bootstrapInternalAgent,
};
