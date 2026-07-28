#!/usr/bin/env node
'use strict';

const path = require('node:path');
const scheduleManager = require('../schedule-manager');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GROWTH_REPORT_DIR = path.join(REPO_ROOT, '.thumbgate', 'reports', 'gtm-revenue-loop');
const CAMPAIGN_REPORT_PATH = path.join(
  REPO_ROOT,
  '.thumbgate',
  'reports',
  'marketing-agent-campaign',
  'latest.json'
);
const RETIRED_GROWTH_SCHEDULE_IDS = Object.freeze([
  'thumbgate-growth-schedule-campaign',
  'thumbgate-growth-poll-zernio',
  'thumbgate-growth-sync-launch-assets',
]);

function buildNodeEvalCommand(scriptPath, args = []) {
  const absolutePath = path.resolve(scriptPath);
  const serializedArgs = JSON.stringify(args);
  return [
    'const { spawnSync } = require(\'node:child_process\');',
    `process.chdir(${JSON.stringify(REPO_ROOT)});`,
    `const result = spawnSync(process.execPath, [${JSON.stringify(absolutePath)}, ...${serializedArgs}], {`,
    '  cwd: process.cwd(),',
    '  env: process.env,',
    '  stdio: \'inherit\',',
    '});',
    'if (result.error) throw result.error;',
    'process.exit(typeof result.status === \'number\' ? result.status : 0);',
  ].join(' ');
}

function buildGrowthSchedules() {
  return [
    {
      id: 'thumbgate-growth-reply-monitor',
      name: 'ThumbGate Growth Reply Monitor',
      description: 'Checks social replies and posts supported follow-ups or drafts them for review.',
      schedule: 'hourly',
      command: buildNodeEvalCommand(path.join(REPO_ROOT, 'scripts', 'social-reply-monitor.js')),
      workingDirectory: REPO_ROOT,
    },
    {
      id: 'thumbgate-growth-campaign-conversion',
      name: 'ThumbGate Marketing-Agent Campaign Conversion Monitor',
      description: 'Verifies all seven tracked buyer routes and records campaign-specific hosted outcome truth without creating provider sessions.',
      schedule: 'hourly',
      command: buildNodeEvalCommand(path.join(
        REPO_ROOT,
        'scripts',
        'social-analytics',
        'verify-marketing-agent-campaign.js'
      ), [
        '--json',
        '--window=lifetime',
        `--out=${CAMPAIGN_REPORT_PATH}`,
      ]),
      workingDirectory: REPO_ROOT,
    },
    {
      id: 'thumbgate-growth-money-watch',
      name: 'ThumbGate Growth Money Watch',
      description: 'Persists hourly commercial-change checks so the first paid event is captured immediately.',
      schedule: 'hourly',
      command: buildNodeEvalCommand(path.join(REPO_ROOT, 'scripts', 'money-watcher.js'), [
        '--once',
      ]),
      workingDirectory: REPO_ROOT,
    },
    {
      id: 'thumbgate-growth-revenue-loop',
      name: 'ThumbGate Growth Revenue Loop',
      description: 'Refreshes the local-first target queue and outreach artifact for the first paid customers.',
      schedule: 'daily 08:20',
      command: buildNodeEvalCommand(path.join(REPO_ROOT, 'scripts', 'autonomous-sales-agent.js'), [
        `--report-dir=${GROWTH_REPORT_DIR}`,
        '--max-targets=8',
      ]),
      workingDirectory: REPO_ROOT,
    },
    {
      id: 'thumbgate-growth-social-digest',
      name: 'ThumbGate Growth Social Digest',
      description: 'Builds the daily social analytics digest after the day closes.',
      schedule: 'daily 22:15',
      command: buildNodeEvalCommand(path.join(__dirname, 'run-digest.js'), ['--days=7']),
      workingDirectory: REPO_ROOT,
    },
  ];
}

function installGrowthAutomation(manager = scheduleManager) {
  const schedules = buildGrowthSchedules();
  const retired = RETIRED_GROWTH_SCHEDULE_IDS.map((id) => (
    manager.deleteSchedule(id)
  ));
  const installed = schedules.map((schedule) => manager.createSchedule(schedule));
  return {
    retired,
    installed,
    schedules: manager.listSchedules().filter((schedule) => schedule.id.startsWith('thumbgate-growth-')),
  };
}

if (require.main === module) {
  const result = installGrowthAutomation();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.installed.some((entry) => !entry.success)) {
    process.exitCode = 1;
  }
}

module.exports = {
  CAMPAIGN_REPORT_PATH,
  RETIRED_GROWTH_SCHEDULE_IDS,
  buildNodeEvalCommand,
  buildGrowthSchedules,
  installGrowthAutomation,
};
