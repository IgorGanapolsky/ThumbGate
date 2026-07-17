#!/usr/bin/env node
'use strict';

const path = require('node:path');
const scheduleManager = require('./schedule-manager');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEDULE_ID = 'thumbgate-revenue-truth-hourly';

function buildNodeEvalCommand(scriptPath, args = []) {
  const absolutePath = path.resolve(scriptPath);
  return [
    'const { spawnSync } = require(\'node:child_process\');',
    `process.chdir(${JSON.stringify(REPO_ROOT)});`,
    `const result = spawnSync(process.execPath, [${JSON.stringify(absolutePath)}, ...${JSON.stringify(args)}], {`,
    '  cwd: process.cwd(),',
    '  env: process.env,',
    '  stdio: \'inherit\',',
    '});',
    'if (result.error) throw result.error;',
    'process.exit(typeof result.status === \'number\' ? result.status : 1);',
  ].join(' ');
}

function buildRevenueTruthSchedule() {
  return {
    id: SCHEDULE_ID,
    name: 'ThumbGate Exact Revenue Truth Watch',
    description: 'Read-only hourly hosted and exact product-attributed payment audit. No posting, messaging, billing mutation, or paid lead access.',
    schedule: 'hourly',
    command: buildNodeEvalCommand(path.join(REPO_ROOT, 'scripts', 'money-watcher.js'), ['--once']),
    workingDirectory: REPO_ROOT,
  };
}

function installRevenueTruthAutomation(manager = scheduleManager) {
  const schedule = buildRevenueTruthSchedule();
  const installed = manager.createSchedule(schedule);
  return {
    installed,
    schedule: manager.listSchedules().find((entry) => entry.id === SCHEDULE_ID) || null,
    externalActionAuthorized: false,
    zeroSpendStatus: 'proceed_zero_cost_local_existing_machine',
  };
}

if (require.main === module) { // NOSONAR
  const result = installRevenueTruthAutomation();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.installed?.success) process.exitCode = 1;
}

module.exports = {
  REPO_ROOT,
  SCHEDULE_ID,
  buildNodeEvalCommand,
  buildRevenueTruthSchedule,
  installRevenueTruthAutomation,
};
