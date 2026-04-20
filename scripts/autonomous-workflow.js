#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { ensureDir } = require('./fs-utils');
const {
  executeJob,
  readJobState,
  resumeJob,
} = require('./async-job-runner');
const {
  createCheckpoint,
  advanceCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
} = require('./workflow-gate-checkpoint');
const { appendWorkflowRun } = require('./workflow-runs');

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function slugify(value, fallback = 'workflow') {
  // Avoid any `-+` quantifier in an edge-anchored regex (Sonar javascript:S5852
  // still flags even the anchored form). Strip edge dashes with a linear scan.
  const collapsed = normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed.charCodeAt(start) === 45) start += 1;
  while (end > start && collapsed.charCodeAt(end - 1) === 45) end -= 1;
  const normalized = collapsed.slice(start, end);
  return normalized || fallback;
}

function getWorkflowPaths(workflowId, cwd = process.cwd()) {
  const rootDir = path.join(cwd, '.thumbgate', 'autonomous-workflows', workflowId);
  return {
    rootDir,
    checkpointPath: path.join(rootDir, 'checkpoint.json'),
    reportJsonPath: path.join(rootDir, 'report.json'),
    reportMdPath: path.join(rootDir, 'report.md'),
    planPath: path.join(rootDir, 'plan.json'),
  };
}

function normalizePlan(input, workflowId) {
  if (Array.isArray(input)) {
    return {
      workflowId,
      summary: input.map((step) => normalizeText(step)).filter(Boolean).join(' | ') || 'Execution plan ready',
      steps: input
        .map((step, index) => ({
          id: `step_${index + 1}`,
          description: normalizeText(step),
        }))
        .filter((step) => step.description),
    };
  }

  if (input && typeof input === 'object') {
    const steps = Array.isArray(input.steps)
      ? input.steps
        .map((step, index) => {
          if (typeof step === 'string') {
            return {
              id: `step_${index + 1}`,
              description: normalizeText(step),
            };
          }

          if (step && typeof step === 'object') {
            return {
              id: normalizeText(step.id) || `step_${index + 1}`,
              description: normalizeText(step.description || step.summary || step.name),
            };
          }

          return null;
        })
        .filter(Boolean)
      : [];

    return {
      workflowId,
      summary: normalizeText(input.summary) || steps.map((step) => step.description).join(' | ') || 'Execution plan ready',
      steps,
    };
  }

  const summary = normalizeText(input) || 'Execution plan ready';
  return {
    workflowId,
    summary,
    steps: summary ? [{ id: 'step_1', description: summary }] : [],
  };
}

function buildDefaultPlan(spec, workflowId) {
  const executionSteps = Array.isArray(spec.stages)
    ? spec.stages.map((stage, index) => normalizeText(stage && (stage.name || stage.context || stage.command)) || `Stage ${index + 1}`)
    : [];

  return normalizePlan({
    summary: normalizeText(spec.planSummary) || `Run ${executionSteps.length || 0} execution stage(s) and verify output`,
    steps: [
      { id: 'intent', description: normalizeText(spec.intent) || 'Intent captured' },
      { id: 'plan', description: 'Execution plan generated' },
      ...executionSteps.map((description, index) => ({
        id: `execute_${index + 1}`,
        description,
      })),
      { id: 'verify', description: 'Verification loop completed' },
      { id: 'report', description: 'Evidence-backed report recorded' },
    ],
    workflowId,
  }, workflowId);
}

function resolvePlan(spec, workflowId) {
  if (typeof spec.plan === 'function') {
    return normalizePlan(spec.plan(spec), workflowId);
  }

  if (spec.plan) {
    return normalizePlan(spec.plan, workflowId);
  }

  return buildDefaultPlan(spec, workflowId);
}

function buildExecutionJob(spec, workflowId, paths, plan) {
  return {
    id: spec.jobId || `${workflowId}-execution`,
    tags: Array.isArray(spec.tags) ? spec.tags : [],
    skill: spec.skill || 'autonomous-workflow',
    partnerProfile: spec.partnerProfile || null,
    verificationMode: spec.verificationMode === 'none' ? 'none' : 'standard',
    autoImprove: spec.autoImprove !== false,
    recordFeedback: spec.recordFeedback !== false,
    stages: Array.isArray(spec.stages) ? spec.stages : [],
    metadata: {
      workflowId,
      planSummary: plan.summary,
      workflowRoot: paths.rootDir,
    },
  };
}

function writeWorkflowPlan(paths, plan) {
  ensureDir(paths.rootDir);
  fs.writeFileSync(paths.planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return paths.planPath;
}

function collectEvidenceArtifacts(paths, executionResult, extraArtifacts = []) {
  return [
    paths.checkpointPath,
    paths.planPath,
    paths.reportJsonPath,
    paths.reportMdPath,
    executionResult && executionResult.jobStatePath ? executionResult.jobStatePath : null,
    ...extraArtifacts,
  ].filter(Boolean);
}

function writeWorkflowReport(paths, report) {
  ensureDir(paths.rootDir);
  fs.writeFileSync(paths.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const markdown = [
    `# ${report.workflowName}`,
    '',
    `- Workflow ID: ${report.workflowId}`,
    `- Status: ${report.status}`,
    `- Intent: ${report.intent}`,
    `- Verification accepted: ${report.verification ? String(report.verification.accepted) : 'skipped'}`,
    `- Evidence artifacts: ${report.evidenceArtifacts.length}`,
    '',
    '## Plan',
    '',
    report.plan.summary,
    '',
    ...report.plan.steps.map((step) => `- ${step.id}: ${step.description}`),
    '',
    '## Execution',
    '',
    ...report.execution.stageHistory.map((stage) => `- ${stage.name} @ ${stage.completedAt}`),
    '',
    '## Evidence Artifacts',
    '',
    ...report.evidenceArtifacts.map((artifact) => `- ${artifact}`),
  ].join('\n');

  fs.writeFileSync(paths.reportMdPath, `${markdown}\n`, 'utf8');
  return {
    json: paths.reportJsonPath,
    markdown: paths.reportMdPath,
  };
}

function recordAutonomousWorkflowRun(spec, report, evidenceArtifacts, feedbackDir) {
  const proofBacked = report.status === 'completed'
    && (!report.verification || report.verification.accepted)
    && evidenceArtifacts.length > 0;

  return appendWorkflowRun({
    workflowId: report.workflowId,
    workflowName: report.workflowName,
    owner: spec.owner || 'automation',
    runtime: 'node',
    status: report.status,
    customerType: spec.customerType || 'internal_dogfood',
    teamId: spec.teamId || null,
    reviewed: proofBacked,
    reviewedBy: proofBacked ? (spec.reviewedBy || 'automation') : null,
    proofBacked,
    proofArtifacts: evidenceArtifacts,
    source: spec.source || 'autonomous-workflow',
    metadata: {
      intent: report.intent,
      planSummary: report.plan.summary,
      verificationAttempts: report.verification ? report.verification.attempts : 0,
      executionJobId: report.execution.jobId,
    },
  }, feedbackDir);
}

function runAutonomousWorkflow(spec = {}, options = {}) {
  const cwd = options.cwd || process.cwd();
  const workflowId = normalizeText(spec.workflowId) || slugify(spec.name || spec.intent, 'autonomous-workflow');
  const workflowName = normalizeText(spec.name) || `Autonomous workflow ${workflowId}`;
  const intent = normalizeText(spec.intent) || 'Intent not provided';
  const paths = getWorkflowPaths(workflowId, cwd);
  const plan = resolvePlan(spec, workflowId);

  writeWorkflowPlan(paths, plan);

  let checkpoint = createCheckpoint({
    workflowId,
    phase: 'intent',
    status: 'running',
    intent: { summary: intent },
    plan,
    evidence: [paths.planPath],
    metadata: {
      workflowName,
    },
  });
  saveCheckpoint(checkpoint, paths.checkpointPath);

  checkpoint = advanceCheckpoint(checkpoint, {
    phase: 'plan',
    status: 'running',
    plan,
    evidence: [paths.planPath],
  });
  saveCheckpoint(checkpoint, paths.checkpointPath);

  const job = buildExecutionJob(spec, workflowId, paths, plan);
  const executionResult = options.resume === true
    ? resumeJob(job.id, job)
    : executeJob(job);
  const jobState = readJobState(job.id);

  checkpoint = advanceCheckpoint(checkpoint, {
    phase: 'verify',
    status: executionResult.status,
    evidence: jobState && jobState.verification ? [paths.checkpointPath] : [],
    metadata: {
      executionJobId: job.id,
      executionStatus: executionResult.status,
    },
  });
  saveCheckpoint(checkpoint, paths.checkpointPath);

  const report = {
    workflowId,
    workflowName,
    status: executionResult.status,
    intent,
    plan,
    execution: {
      jobId: job.id,
      status: executionResult.status,
      stageHistory: Array.isArray(jobState && jobState.stageHistory) ? jobState.stageHistory : [],
      checkpointCount: Array.isArray(jobState && jobState.checkpoints) ? jobState.checkpoints.length : 0,
      currentContext: jobState && jobState.currentContext ? jobState.currentContext : '',
      jobStatePath: jobState ? path.join(getFeedbackDir(options.feedbackDir), 'jobs', job.id, 'state.json') : null,
    },
    verification: executionResult.phases ? executionResult.phases.verification : null,
    phases: executionResult.phases || null,
    timestamp: new Date().toISOString(),
    evidenceArtifacts: [],
  };

  const evidenceArtifacts = collectEvidenceArtifacts(paths, report.execution, spec.proofArtifacts);
  report.evidenceArtifacts = evidenceArtifacts;

  checkpoint = advanceCheckpoint(checkpoint, {
    phase: 'report',
    status: executionResult.status,
    report: {
      status: report.status,
      generatedAt: report.timestamp,
    },
    evidence: evidenceArtifacts,
  });
  saveCheckpoint(checkpoint, paths.checkpointPath);

  writeWorkflowReport(paths, report);
  report.workflowRun = recordAutonomousWorkflowRun(spec, report, evidenceArtifacts, options.feedbackDir);
  fs.writeFileSync(paths.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return report;
}

function getFeedbackDir(feedbackDir) {
  if (feedbackDir) return feedbackDir;
  return process.env.THUMBGATE_FEEDBACK_DIR || path.join(process.cwd(), '.thumbgate');
}

function resumeAutonomousWorkflow(spec = {}, options = {}) {
  return runAutonomousWorkflow(spec, { ...options, resume: true });
}

function readWorkflowReport(workflowId, options = {}) {
  const paths = getWorkflowPaths(workflowId, options.cwd || process.cwd());
  if (!fs.existsSync(paths.reportJsonPath)) return null;
  return JSON.parse(fs.readFileSync(paths.reportJsonPath, 'utf8'));
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  }
  return args;
}

if (isCliInvocation()) {
  const args = parseArgs();
  if (!args.file) {
    console.error('Usage: node scripts/autonomous-workflow.js --file=workflow.json [--resume]');
    process.exit(1);
  }

  const specPath = path.resolve(args.file);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const report = args.resume ? resumeAutonomousWorkflow(spec) : runAutonomousWorkflow(spec);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === 'completed' ? 0 : 1);
}

module.exports = {
  buildDefaultPlan,
  collectEvidenceArtifacts,
  getWorkflowPaths,
  normalizePlan,
  parseArgs,
  readWorkflowReport,
  recordAutonomousWorkflowRun,
  resumeAutonomousWorkflow,
  runAutonomousWorkflow,
  slugify,
  writeWorkflowPlan,
  writeWorkflowReport,
};
