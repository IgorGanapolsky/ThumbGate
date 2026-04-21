#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildEngagementAudit,
  DEFAULT_DRAFTS_PATH,
  DEFAULT_LAUNCH_ASSETS_PATH,
  DEFAULT_REPLY_STATE_PATH,
  DEFAULT_TIMEZONE,
} = require('./social-analytics/engagement-audit');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ARTIFACT_DIR = path.join(REPO_ROOT, '.artifacts', 'ralph-loop');
const VALID_MODES = new Set(['all', 'engage', 'poll', 'audit', 'post']);
const RALPH_STATE_PATHS = [
  path.relative(REPO_ROOT, DEFAULT_REPLY_STATE_PATH),
  path.relative(REPO_ROOT, DEFAULT_DRAFTS_PATH),
  path.relative(REPO_ROOT, DEFAULT_LAUNCH_ASSETS_PATH),
];
const VALUE_OPTIONS = new Map([
  ['--artifact-dir', 'artifactDir'],
  ['--date', 'date'],
  ['--mode', 'mode'],
  ['--timezone', 'timezone'],
]);

function parseArgs(argv = []) {
  const options = {
    artifactDir: DEFAULT_ARTIFACT_DIR,
    date: '',
    dryRun: false,
    mode: 'all',
    timezone: DEFAULT_TIMEZONE,
    replyStatePath: DEFAULT_REPLY_STATE_PATH,
    draftsPath: DEFAULT_DRAFTS_PATH,
    launchAssetsPath: DEFAULT_LAUNCH_ASSETS_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    index = consumeArg(options, argv, index);
  }

  options.mode = normalizeMode(options.mode);
  return options;
}

function consumeArg(options, argv, index) {
  const token = String(argv[index] || '').trim();
  if (token === '--dry-run') {
    options.dryRun = true;
    return index;
  }

  const inline = token.match(/^(--[^=]+)=(.*)$/);
  if (inline && VALUE_OPTIONS.has(inline[1])) {
    setOption(options, VALUE_OPTIONS.get(inline[1]), inline[2]);
    return index;
  }

  if (VALUE_OPTIONS.has(token) && argv[index + 1]) {
    setOption(options, VALUE_OPTIONS.get(token), argv[index + 1]);
    return index + 1;
  }

  return index;
}

function setOption(options, name, value) {
  const trimmed = String(value || '').trim();
  if (name === 'artifactDir') {
    options.artifactDir = path.resolve(trimmed || DEFAULT_ARTIFACT_DIR);
    return;
  }
  if (name === 'timezone') {
    options.timezone = trimmed || DEFAULT_TIMEZONE;
    return;
  }
  options[name] = trimmed || options[name];
}

function normalizeMode(mode) {
  const normalized = String(mode || 'all').trim().toLowerCase();
  if (!VALID_MODES.has(normalized)) {
    throw new Error(`Invalid Ralph mode: ${mode}. Expected one of: ${[...VALID_MODES].join(', ')}`);
  }
  return normalized;
}

function hasAnyEnv(env, keys = []) {
  return keys.some((key) => Boolean(env[key]));
}

function hasAllEnv(env, keys = []) {
  return keys.every((key) => Boolean(env[key]));
}

function makeNodeStep(id, scriptPath, args = [], extra = {}) {
  return {
    id,
    command: process.execPath,
    args: [path.join(REPO_ROOT, scriptPath), ...args],
    scriptPath,
    type: 'node',
    ...extra,
  };
}

function withSkipReason(step, env) {
  if (step.requiredEnvAll && !hasAllEnv(env, step.requiredEnvAll)) {
    return {
      ...step,
      skipReason: `missing env: ${step.requiredEnvAll.filter((key) => !env[key]).join(', ')}`,
    };
  }
  if (step.requiredEnvAny && !hasAnyEnv(env, step.requiredEnvAny)) {
    return {
      ...step,
      skipReason: `missing one of: ${step.requiredEnvAny.join(', ')}`,
    };
  }
  return step;
}

function wants(mode, names) {
  return mode === 'all' || names.includes(mode);
}

function buildRalphSteps(options = {}, env = process.env) {
  const mode = normalizeMode(options.mode || 'all');
  const dryRun = Boolean(options.dryRun);
  const steps = [];

  if (wants(mode, ['poll'])) {
    steps.push(makeNodeStep(
      'poll-analytics',
      'scripts/social-analytics/poll-all.js',
      [],
      {
        stage: 'sense',
        description: 'Polls configured social analytics for audience and attribution signals.',
      }
    ));
  }

  if (wants(mode, ['engage'])) {
    steps.push(withSkipReason(makeNodeStep(
      'sync-launch-assets',
      'scripts/social-analytics/sync-launch-assets.js',
      ['--limit=50', `--state-path=${options.launchAssetsPath || DEFAULT_LAUNCH_ASSETS_PATH}`],
      {
        stage: 'sense',
        description: 'Syncs owned Zernio launch assets so reply monitoring anchors on current campaign posts.',
        requiredEnvAll: ['ZERNIO_API_KEY'],
      }
    ), env));

    const replyArgs = [];
    if (dryRun) {
      replyArgs.push('--dry-run');
    }
    // Bluesky reply monitor: Zernio has no inbound/comments API, so we poll AT
    // Protocol directly. This only queues drafts to .thumbgate/reply-drafts.jsonl
    // — never auto-posts. Human review required before send.
    steps.push(
      makeNodeStep(
        'reply-monitor',
        'scripts/social-reply-monitor.js',
        replyArgs,
        {
          stage: 'engage',
          description: 'Checks Reddit, X, and LinkedIn reply surfaces with platform-safe posting and draft rules.',
        }
      ),
      makeNodeStep(
        'reply-monitor-bluesky',
        'scripts/social-reply-monitor-bluesky.js',
        replyArgs,
        {
          stage: 'engage',
          description: 'Polls Bluesky notifications via AT Protocol and queues draft replies for human review (never auto-posts).',
          requiredEnvAll: ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'],
        }
      ),
    );
  }

  if (mode === 'post') {
    const postArgs = [];
    if (dryRun) {
      postArgs.push('--dry-run');
    }
    steps.push(makeNodeStep(
      'daily-social-post',
      'scripts/social-post-hourly.js',
      postArgs,
      {
        stage: 'publish',
        description: 'Runs the one-quality-post lane on demand. Ralph hourly mode does not call this step.',
        requiredEnvAll: ['ZERNIO_API_KEY'],
      }
    ));
  }

  steps.push({
    id: 'engagement-audit',
    stage: 'prove',
    type: 'internal',
    description: 'Builds a machine-readable Ralph Loop audit from reply state, drafts, and launch assets.',
  });

  return steps.map((step) => withSkipReason(step, env));
}

function runExternalStep(step, env = process.env) {
  const result = spawnSync(step.command, step.args, {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : '',
  };
}

function runAuditStep(options = {}) {
  return buildEngagementAudit({
    date: options.date,
    timezone: options.timezone || DEFAULT_TIMEZONE,
    replyStatePath: options.replyStatePath || DEFAULT_REPLY_STATE_PATH,
    draftsPath: options.draftsPath || DEFAULT_DRAFTS_PATH,
    launchAssetsPath: options.launchAssetsPath || DEFAULT_LAUNCH_ASSETS_PATH,
  });
}

function runStep(step, options = {}, deps = {}) {
  const startedAt = new Date().toISOString();

  if (step.skipReason) {
    return {
      id: step.id,
      stage: step.stage,
      status: 'skipped',
      skipReason: step.skipReason,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  if (step.type === 'internal') {
    const audit = runAuditStep(options);
    return {
      id: step.id,
      stage: step.stage,
      status: 'passed',
      audit,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const runner = deps.runner || runExternalStep;
  const result = runner(step, deps.env || process.env);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return {
    id: step.id,
    stage: step.stage,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    exitCode: result.exitCode,
    error: result.error || '',
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function tail(text, maxChars = 4000) {
  const value = String(text || '');
  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}

function renderMarkdownReport(report) {
  const lines = [
    '# Ralph Loop Audience Engagement Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Dry run: ${report.dryRun ? 'yes' : 'no'}`,
    '',
    'Ralph Mode keeps the Reliability Gateway pointed at acquisition: sense audience signals, engage safely, and preserve proof for Pre-Action Gates, DPO, and Thompson Sampling review.',
    '',
    '## Steps',
    '',
    '| Step | Stage | Status | Evidence |',
    '|------|-------|--------|----------|',
  ];

  for (const step of report.steps) {
    const evidence = step.skipReason || step.error || `exit ${step.exitCode ?? 0}`;
    lines.push(`| ${step.id} | ${step.stage} | ${step.status} | ${String(evidence).replaceAll('|', '/')} |`);
  }

  lines.push(
    '',
    '## Audit',
    '',
    `- Checked: ${report.audit.totals.checked}`,
    `- Replied: ${report.audit.totals.replied}`,
    `- Drafted: ${report.audit.totals.drafted}`,
    `- Skipped: ${report.audit.totals.skipped}`,
    '',
    'Authority evidence: docs/VERIFICATION_EVIDENCE.md',
    ''
  );

  return `${lines.join('\n')}\n`;
}

function writeReports(report, artifactDir = DEFAULT_ARTIFACT_DIR) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const jsonPath = path.join(artifactDir, 'ralph-loop-report.json');
  const markdownPath = path.join(artifactDir, 'ralph-loop-report.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, renderMarkdownReport(report), 'utf8');
  return { jsonPath, markdownPath };
}

function runRalphLoop(options = {}, deps = {}) {
  const normalized = {
    ...parseArgs([]),
    ...options,
    mode: normalizeMode(options.mode || 'all'),
  };
  const env = deps.env || process.env;
  const steps = buildRalphSteps(normalized, env);
  const results = steps.map((step) => runStep(step, normalized, { ...deps, env }));
  const auditStep = results.find((step) => step.id === 'engagement-audit');
  const audit = auditStep?.audit ? auditStep.audit : runAuditStep(normalized);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: normalized.mode,
    dryRun: Boolean(normalized.dryRun),
    cadence: 'hourly_ci',
    statePaths: RALPH_STATE_PATHS,
    steps: results,
    audit,
  };
  report.artifacts = writeReports(report, normalized.artifactDir || DEFAULT_ARTIFACT_DIR);
  return report;
}

function isCliEntrypoint(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

if (isCliEntrypoint()) {
  try {
    const report = runRalphLoop(parseArgs(process.argv.slice(2)));
    process.stdout.write(`\n[ralph-loop] Report: ${report.artifacts.jsonPath}\n`);
    if (report.steps.some((step) => step.status === 'failed')) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[ralph-loop] Fatal: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_ARTIFACT_DIR,
  RALPH_STATE_PATHS,
  VALID_MODES,
  buildRalphSteps,
  isCliEntrypoint,
  normalizeMode,
  parseArgs,
  renderMarkdownReport,
  runRalphLoop,
  runStep,
  writeReports,
};
