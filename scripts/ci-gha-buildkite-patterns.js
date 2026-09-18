#!/usr/bin/env node
'use strict';

/**
 * Buildkite pipeline FORMAT steal onto GitHub Actions — not a clone.
 *
 * Sources (public docs, 2026-09):
 *   https://buildkite.com/docs/pipelines/best-practices/pipeline-design-and-structure
 *   https://buildkite.com/docs/pipelines/configure/annotations
 *   https://buildkite.com/docs/pipelines/configure/dependencies
 *
 * Transfers onto existing GHA rails:
 *   1. first-fail step identity — name the first failed job/step before logs
 *   2. fail-fast / cancel-in-progress — PR concurrency; never cancel main
 *   3. depends_on honesty — `needs:` is wait; continue-on-error only on non-required
 *   4. skip conditions — path/event filters must not skip merge_group required checks
 *   5. annotations — GITHUB_STEP_SUMMARY, not Buildkite annotation APIs
 *
 * Does NOT add Buildkite Pipelines, agents, Test Engine, auto-quarantine,
 * Package Registries, or a second required CI vendor.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_DESIGN = 'https://buildkite.com/docs/pipelines/best-practices/pipeline-design-and-structure';
const SOURCE_ANNOTATIONS = 'https://buildkite.com/docs/pipelines/configure/annotations';

const REQUIRED_GHA_CONTEXTS = Object.freeze([
  'test',
  'audit',
  'Verify changeset',
  'Analyze JavaScript',
  'CodeQL',
  'Socket Security: Project Report',
  'Socket Security: Pull Request Alerts',
  'GitGuardian Security Checks',
]);

const CLONE_RE = /\b(buildkite\.yml|buildkite-agent|test engine auto-?quarantine|pipelines saas|hosted mac agents|buildkite mcp)\b/i;
const MIGRATE_RE = /\b(migrate (this )?(repo )?to buildkite|replace github actions with buildkite|add buildkite as (a )?required check)\b/i;

const RAIL_MAP = Object.freeze([
  {
    buildkite: 'Step is the diagnosis unit; first failed step before logs',
    githubActions: 'gh run view --json jobs → first failed job.steps[].name; never --log-failed first',
  },
  {
    buildkite: 'fail-fast cancels remaining jobs; fast checks before slow suites',
    githubActions: 'concurrency cancel-in-progress on PRs; never cancel main; ci-scope deps/web/full',
  },
  {
    buildkite: 'depends_on / wait; continue_on_failure only for annotations after a fail',
    githubActions: 'jobs.<id>.needs; continue-on-error only on non-required drift monitors',
  },
  {
    buildkite: 'skip / if / branches skip unnecessary work',
    githubActions: 'paths: + ci-scope; merge_group and main stay full required checks',
  },
  {
    buildkite: 'build annotations summarize failures',
    githubActions: 'GITHUB_STEP_SUMMARY from --annotate; no Buildkite annotation API',
  },
  {
    buildkite: 'control plane vs compute (SaaS schedules, you run agents)',
    githubActions: 'GitHub is the control plane; ubuntu-latest is compute; do not add Buildkite agents',
  },
]);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    strict: false,
    mapOnly: false,
    annotate: false,
    cloneBuildkite: false,
    migrate: false,
    rerunQueued: false,
    quarantine: false,
    jobsJson: '',
    workflow: '',
    required: REQUIRED_GHA_CONTEXTS.slice(),
  };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--map-only') options.mapOnly = true;
    else if (arg === '--annotate' || arg === '--annotate-job') options.annotate = true;
    else if (arg === '--clone-buildkite') options.cloneBuildkite = true;
    else if (arg === '--migrate' || arg === '--migrate-to-buildkite') options.migrate = true;
    else if (arg === '--rerun-queued') options.rerunQueued = true;
    else if (arg === '--quarantine') options.quarantine = true;
    else if (arg.startsWith('--jobs-json=')) options.jobsJson = arg.slice('--jobs-json='.length);
    else if (arg.startsWith('--workflow=')) options.workflow = arg.slice('--workflow='.length);
    else if (arg.startsWith('--required=')) {
      options.required = arg.slice('--required='.length).split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return options;
}

function loadJson(filePath) {
  if (!filePath) return null;
  const abs = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function firstFailedStep(jobs = []) {
  const list = Array.isArray(jobs) ? jobs : [];
  for (const job of list) {
    const jobConclusion = String(job.conclusion || job.status || '').toLowerCase();
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const step of steps) {
      const stepConclusion = String(step.conclusion || '').toLowerCase();
      if (stepConclusion === 'failure' || stepConclusion === 'timed_out' || stepConclusion === 'cancelled') {
        return {
          job: job.name || job.id || 'unknown-job',
          step: step.name || 'unknown-step',
          conclusion: step.conclusion,
          number: step.number == null ? null : step.number,
        };
      }
    }
    if (jobConclusion === 'failure' || jobConclusion === 'timed_out') {
      return {
        job: job.name || job.id || 'unknown-job',
        step: null,
        conclusion: job.conclusion,
        number: null,
      };
    }
  }
  return null;
}

function missingRequiredContexts(jobs = [], required = REQUIRED_GHA_CONTEXTS) {
  const names = new Set();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const n = String(job.name || '');
    if (n) names.add(n);
    const ctx = String(job.context || '');
    if (ctx) names.add(ctx);
  }
  return required.filter((need) => {
    const needle = need.toLowerCase();
    for (const have of names) {
      if (have.toLowerCase() === needle || have.toLowerCase().startsWith(needle.toLowerCase())) {
        return false;
      }
    }
    return true;
  });
}

function auditWorkflowText(yaml = '') {
  const text = String(yaml || '');
  const findings = [];
  if (!/^\s*concurrency:\s*$/m.test(text) && !/\nconcurrency:\s*\n/.test(text)) {
    findings.push({
      id: 'missing_concurrency',
      message: 'Workflow has no concurrency group (Buildkite concurrency_group analog).',
    });
  }
  if (/cancel-in-progress:\s*true\s*$/m.test(text) && !/refs\/heads\/main/.test(text)) {
    findings.push({
      id: 'cancel_main',
      message: 'cancel-in-progress: true without excluding main — Buildkite fail-fast must not cancel the trunk build.',
    });
  }
  if (CLONE_RE.test(text) || /uses:\s*buildkite\//i.test(text)) {
    findings.push({
      id: 'clone_buildkite',
      message: 'Workflow vendors Buildkite agents/actions. Keep GitHub Actions native.',
    });
  }
  return findings;
}

function auditWorkflowFile(filePath) {
  if (!filePath) return [];
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    return [{ id: 'workflow_missing', message: `Workflow not found: ${filePath}` }];
  }
  return auditWorkflowText(fs.readFileSync(abs, 'utf8'));
}

function renderAnnotation(firstFail, extraLines = []) {
  const lines = [
    '## First failed step (Buildkite FORMAT on GitHub Actions)',
    '',
    'Do not dump logs first. Name the red step, then re-run that command locally.',
    'Do not `gh run rerun` a queued job. Do not add Buildkite as a required check.',
    '',
  ];
  if (firstFail) {
    lines.push(`- Job: \`${firstFail.job}\``);
    if (firstFail.step) lines.push(`- Step: \`${firstFail.step}\``);
    if (firstFail.conclusion) lines.push(`- Conclusion: \`${firstFail.conclusion}\``);
  } else {
    lines.push('- No failed step in the provided jobs JSON (scroll the Actions UI for the first red step).');
  }
  for (const line of extraLines) lines.push(line);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function writeStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return false;
  fs.appendFileSync(summaryPath, markdown);
  return true;
}

function buildCiGhaBuildkitePatternsReport(args = {}) {
  if (args.mapOnly) {
    return {
      name: 'thumbgate-ci-gha-buildkite-patterns',
      ok: true,
      status: 'ready',
      source: { design: SOURCE_DESIGN, annotations: SOURCE_ANNOTATIONS },
      clone: false,
      vendor: 'github-actions',
      requiredContexts: REQUIRED_GHA_CONTEXTS,
      firstFail: null,
      missingRequired: [],
      findings: [],
      railMap: RAIL_MAP,
      annotationWritten: false,
      note: 'FORMAT steal only. Not affiliated with Buildkite. Public repo stays on GHA.',
    };
  }
  const findings = [];
  const jobsPayload = args.jobsJson ? loadJson(args.jobsJson) : null;
  const jobs = Array.isArray(jobsPayload)
    ? jobsPayload
    : (jobsPayload && Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : []);

  if (args.cloneBuildkite) {
    findings.push({
      id: 'clone_buildkite',
      message: 'Refuse Buildkite Pipelines / agents / Test Engine SKU. Steal FORMAT onto GitHub Actions only.',
    });
  }
  if (args.migrate || MIGRATE_RE.test(String(args.claim || ''))) {
    findings.push({
      id: 'migrate_vendor',
      message: 'This public repo stays on GitHub-hosted ubuntu-latest. Do not migrate to Buildkite.',
    });
  }
  if (args.rerunQueued) {
    findings.push({
      id: 'rerun_queued',
      message: 'Never gh run rerun a queued job (no-op / burns minutes). Wait for Actions to drain.',
    });
  }
  if (args.quarantine) {
    findings.push({
      id: 'auto_quarantine',
      message: 'Refuse Test Engine auto-quarantine. First fail is a real regression until proven otherwise.',
    });
  }

  const firstFail = jobs.length ? firstFailedStep(jobs) : null;
  const missing = jobs.length ? missingRequiredContexts(jobs, args.required || REQUIRED_GHA_CONTEXTS) : [];
  if (missing.length) {
    findings.push({
      id: 'missing_required',
      message: `Required GHA contexts absent: ${missing.join(', ')}. Check githubstatus.com Actions before blaming code.`,
      missing,
    });
  }

  const workflowFindings = args.workflow ? auditWorkflowFile(args.workflow) : [];
  findings.push(...workflowFindings);

  let annotationWritten = false;
  let annotation = '';
  if (args.annotate) {
    annotation = renderAnnotation(firstFail);
    annotationWritten = writeStepSummary(annotation);
  }

  const ok = findings.length === 0;
  return {
    name: 'thumbgate-ci-gha-buildkite-patterns',
    ok,
    status: ok ? 'ready' : 'fail',
    source: { design: SOURCE_DESIGN, annotations: SOURCE_ANNOTATIONS },
    clone: false,
    vendor: 'github-actions',
    requiredContexts: args.required || REQUIRED_GHA_CONTEXTS,
    firstFail,
    missingRequired: missing,
    findings,
    railMap: RAIL_MAP,
    annotationWritten,
    annotation: args.annotate ? annotation : undefined,
    note: 'FORMAT steal only. Not affiliated with Buildkite. Public repo stays on GHA.',
  };
}

function formatCiGhaBuildkitePatternsReport(report) {
  const lines = [];
  lines.push(`# ${report.name}  status=${report.status}`);
  lines.push(`vendor: ${report.vendor}  clone: ${report.clone}`);
  if (report.firstFail) {
    lines.push(`first_fail: job=${report.firstFail.job} step=${report.firstFail.step || '(job)'} conclusion=${report.firstFail.conclusion}`);
  } else {
    lines.push('first_fail: (none)');
  }
  if (report.missingRequired && report.missingRequired.length) {
    lines.push(`missing_required: ${report.missingRequired.join(', ')}`);
  }
  if (report.findings.length) {
    lines.push('findings:');
    for (const f of report.findings) lines.push(`- ${f.id}: ${f.message}`);
  } else {
    lines.push('findings: (none)');
  }
  lines.push('rail_map:');
  for (const row of report.railMap) {
    lines.push(`- BK: ${row.buildkite}`);
    lines.push(`  GHA: ${row.githubActions}`);
  }
  lines.push(report.note);
  return `${lines.join('\n')}\n`;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/ci-gha-buildkite-patterns.js [flags]

Buildkite pipeline FORMAT on GitHub Actions. Does not add Buildkite.

  --json                 JSON report
  --map-only             Rail map only (always ok)
  --jobs-json=path       Parse gh run view --json jobs (or {jobs:[...]})
  --workflow=path        Audit a workflow YAML
  --annotate             Append first-fail block to GITHUB_STEP_SUMMARY
  --strict               Exit 1 unless ready
  --clone-buildkite      Refuse SKU clone
  --migrate              Refuse vendor migration
  --rerun-queued         Refuse gh run rerun of queued jobs
  --quarantine           Refuse Test Engine auto-quarantine
`);
}

function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const args = parseArgs(argv);
  const report = args.mapOnly
    ? {
      name: 'thumbgate-ci-gha-buildkite-patterns',
      ok: true,
      status: 'ready',
      source: { design: SOURCE_DESIGN, annotations: SOURCE_ANNOTATIONS },
      clone: false,
      vendor: 'github-actions',
      requiredContexts: REQUIRED_GHA_CONTEXTS,
      firstFail: null,
      missingRequired: [],
      findings: [],
      railMap: RAIL_MAP,
      annotationWritten: false,
      note: 'FORMAT steal only. Not affiliated with Buildkite. Public repo stays on GHA.',
    }
    : buildCiGhaBuildkitePatternsReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatCiGhaBuildkitePatternsReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  REQUIRED_GHA_CONTEXTS,
  RAIL_MAP,
  parseArgs,
  firstFailedStep,
  missingRequiredContexts,
  auditWorkflowText,
  renderAnnotation,
  buildCiGhaBuildkitePatternsReport,
  formatCiGhaBuildkitePatternsReport,
  runCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = runCli();
}
