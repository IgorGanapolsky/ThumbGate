#!/usr/bin/env node
'use strict';

const path = require('node:path');
const scheduleManager = require('../schedule-manager');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GROWTH_REPORT_DIR = path.join(REPO_ROOT, '.thumbgate', 'reports', 'gtm-revenue-loop');

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
      id: 'thumbgate-growth-schedule-campaign',
      name: 'ThumbGate Growth Campaign Scheduler',
      description: 'Schedules the next day of tracked Zernio launch posts.',
      schedule: 'daily 21:15',
      command: buildNodeEvalCommand(path.join(__dirname, 'schedule-thumbgate-campaign.js')),
      workingDirectory: REPO_ROOT,
    },
    {
      id: 'thumbgate-growth-poll-zernio',
      name: 'ThumbGate Growth Poll Zernio',
      description: 'Polls Zernio analytics into the local engagement store every hour.',
      schedule: 'hourly',
      command: buildNodeEvalCommand(path.join(__dirname, 'pollers', 'zernio.js')),
      workingDirectory: REPO_ROOT,
    },
    {
      id: 'thumbgate-growth-sync-launch-assets',
      name: 'ThumbGate Growth Sync Launch Assets',
      description: 'Syncs published and scheduled launch assets from Zernio into a durable local registry.',
      schedule: 'hourly',
      command: buildNodeEvalCommand(path.join(__dirname, 'sync-launch-assets.js')),
      workingDirectory: REPO_ROOT,
    },
    {
      id: 'thumbgate-growth-reply-monitor',
      name: 'ThumbGate Growth Reply Monitor',
      description: 'Checks social replies and posts supported follow-ups or drafts them for review.',
      schedule: 'hourly',
      command: buildNodeEvalCommand(path.join(REPO_ROOT, 'scripts', 'social-reply-monitor.js')),
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

  const installed = schedules.map((schedule) => manager.createSchedule(schedule));
  return {
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
  buildNodeEvalCommand,
  buildGrowthSchedules,
  installGrowthAutomation,
};
