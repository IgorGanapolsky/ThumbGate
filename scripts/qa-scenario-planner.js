#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const RUNTIME_PATTERNS = [
  { pattern: /^public\/.*\.(html|css|js)$/i, surface: 'browser', reason: 'public UI asset changed' },
  { pattern: /^src\/api\//i, surface: 'api', reason: 'API route or server behavior changed' },
  { pattern: /^bin\//i, surface: 'cli', reason: 'CLI entrypoint changed' },
  { pattern: /^scripts\/(dashboard|pro-local-dashboard|.*gate|.*scanner|.*reward|.*routing).*\.js$/i, surface: 'agent-runtime', reason: 'agent runtime or gate behavior changed' },
  { pattern: /^adapters\//i, surface: 'agent-adapter', reason: 'agent adapter changed' },
  { pattern: /^plugins\//i, surface: 'plugin', reason: 'plugin install path changed' },
  { pattern: /^package\.json$/i, surface: 'package', reason: 'package manifest changed' },
];

const SKIP_PATTERNS = [
  /^README\.md$/i,
  /^docs\//i,
  /^reports\//i,
  /^proof\//i,
  /^tests\/.*\.test\.js$/i,
  /^\.claude\/implementation-notes\//i,
];

function normalizeFiles(files = []) {
  return Array.from(new Set(files
    .map((file) => String(file || '').trim().replace(/^\.?\//, ''))
    .filter(Boolean)));
}

function classifyFile(file) {
  for (const entry of RUNTIME_PATTERNS) {
    if (entry.pattern.test(file)) return { ...entry, file };
  }
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(file)) return { surface: 'skip', reason: 'no runtime impact', file };
  }
  return { surface: 'focused', reason: 'unknown runtime impact; run focused checks', file };
}

function parseChangedFilesFromDiff(diff = '') {
  const files = [];
  for (const line of String(diff || '').split('\n')) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) files.push(match[2]);
  }
  return normalizeFiles(files);
}

function planQaScenario(input = {}) {
  const files = normalizeFiles(input.files || parseChangedFilesFromDiff(input.diff || ''));
  const classifications = files.map(classifyFile);
  const surfaces = Array.from(new Set(classifications.map((entry) => entry.surface)));
  const runtimeChanges = classifications.filter((entry) => entry.surface !== 'skip');
  const skipOnly = files.length > 0 && runtimeChanges.length === 0;

  const recommendedRunner = chooseRunner(surfaces, input);
  const userScenario = buildUserScenario(runtimeChanges, input);
  return {
    name: 'thumbgate-user-impact-qa-scenario',
    status: skipOnly ? 'skip' : 'actionable',
    files,
    classifications,
    recommendedRunner,
    userScenario,
    commands: buildCommands(recommendedRunner, runtimeChanges),
    regressionPolicy: skipOnly
      ? 'skip durable QA; no runtime-impact files changed'
      : 'if the QA agent finds a deterministic failure, convert it into a focused regression test before opening a fix PR',
    transientFailurePolicy: 'doctor the browser/computer-use runner once, retry once, then label as infrastructure-flaky instead of product-regression',
  };
}

function chooseRunner(surfaces, input = {}) {
  if (input.forceComputerUse || surfaces.includes('plugin') || surfaces.includes('agent-adapter')) return 'computer-use-qa';
  if (surfaces.includes('browser') || surfaces.includes('api')) return 'browser-qa';
  if (surfaces.includes('cli') || surfaces.includes('agent-runtime') || surfaces.includes('package')) return 'focused-node-qa';
  if (surfaces.every((surface) => surface === 'skip')) return 'skip';
  return 'focused-node-qa';
}

function buildUserScenario(runtimeChanges, input = {}) {
  if (runtimeChanges.length === 0) return 'No user-impact scenario required; changed files are docs, tests, reports, or proof artifacts only.';
  const surfaces = Array.from(new Set(runtimeChanges.map((entry) => entry.surface)));
  if (surfaces.includes('browser') || surfaces.includes('api')) {
    return 'Open the affected page as a user, perform the primary CTA or dashboard action, verify visible state changes, then check the related API response.';
  }
  if (surfaces.includes('plugin') || surfaces.includes('agent-adapter')) {
    return 'Install or reload the affected agent integration, run one thumbs-up and one thumbs-down capture, then verify the next risky action is gated.';
  }
  if (surfaces.includes('cli')) {
    return 'Run the changed CLI command with --help and one realistic command path, then verify exit code, JSON output, and no stale command copy.';
  }
  return input.scenario || 'Run the focused test for the changed runtime surface, then verify the behavior with one realistic operator workflow.';
}

function buildCommands(runner, runtimeChanges) {
  if (runner === 'skip') return [];
  const commands = ['npm test -- --test-concurrency=1'];
  if (runner === 'browser-qa') commands.push('npx playwright test tests/e2e --project=chromium');
  if (runner === 'computer-use-qa') commands.push('node scripts/qa-scenario-planner.js --doctor-runner');
  if (runtimeChanges.some((entry) => entry.surface === 'package')) commands.push('npm pack --dry-run');
  return commands;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--doctor-runner') args.doctorRunner = true;
    else if (arg.startsWith('--files=')) args.files = arg.slice('--files='.length).split(',');
    else if (arg.startsWith('--diff-file=')) args.diff = fs.readFileSync(arg.slice('--diff-file='.length), 'utf8');
    else if (arg.startsWith('--scenario=')) args.scenario = arg.slice('--scenario='.length);
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs();
  if (args.doctorRunner) {
    console.log('QA runner doctor: verify browser/computer-use target, screenshot capture, and network reachability before blaming product code.');
    process.exit(0);
  }
  const report = planQaScenario(args);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.status.toUpperCase()}: ${report.userScenario}`);
    for (const command of report.commands) console.log(`- ${command}`);
  }
}

module.exports = {
  classifyFile,
  parseChangedFilesFromDiff,
  planQaScenario,
};
