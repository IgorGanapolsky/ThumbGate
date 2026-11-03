'use strict'

/**
 * Ambient Agent — LangChain "70% of runs are scheduled" steal.
 *
 * Runs ThumbGate health checks, verification, and memory cleanup
 * on a schedule (like a cron job). Mirrors LangChain's ambient agents
 * that monitor email, send daily briefs, run code review.
 *
 * Stolen from: Harrison Chase's "company harness" blog
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SCHEDULE = '0 9 * * *'; // daily at 9 AM

const AMBIENT_TASKS = [
  { name: 'health_check', command: 'bin/agent-loop --health --json', schedule: '0 8 * * *' },
  { name: 'verification', command: 'npm run verify:isolated', schedule: '0 9 * * *' },
  { name: 'memory_cleanup', command: 'node scripts/institutional-memory.js cleanup', schedule: '0 3 * * *' },
  { name: 'test_suite', command: 'npm test', schedule: '0 10 * * *' },
  { name: 'eval_suite', command: 'node scripts/verify-eval-set.js', schedule: '*/30 * * * *' },
];

let running = false;

function scheduleAmbientTasks(schedule = DEFAULT_SCHEDULE) {
  console.log(`# Ambient Agent Started`);
  console.log(`Schedule: ${schedule}`);
  console.log(`Tasks: ${AMBIENT_TASKS.length}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'production'}`);

  for (const task of AMBIENT_TASKS) {
    console.log(`  ${task.name} → ${task.schedule} (${task.command})`);
  }

  // In production, schedule each task with native timer (no external deps)
  // For now, just run the daily check
  if (process.env.AMBIENT_RUN_ONCE) {
    runAllTasks();
    return;
  }

  // Use setInterval for simple scheduling (no cron dependency)
  const dailyMs = 24 * 60 * 60 * 1000;
  const hourlyMs = 60 * 60 * 1000;

  // Health check every hour
  setInterval(() => runTask(AMBIENT_TASKS[0]), hourlyMs);
  // Verification daily
  setInterval(() => runTask(AMBIENT_TASKS[1]), dailyMs);
  // Memory cleanup daily at 3am
  setInterval(() => runTask(AMBIENT_TASKS[2]), dailyMs);
  // Test suite daily
  setInterval(() => runTask(AMBIENT_TASKS[3]), dailyMs);
  // Evals every 30 min
  setInterval(() => runTask(AMBIENT_TASKS[4]), 30 * 60 * 1000);

  console.log('\nAll ambient tasks scheduled. Running continuously...\n');
}

function runAllTasks() {
  console.log('\n=== Running All Ambient Tasks ===\n');
  for (const task of AMBIENT_TASKS) {
    console.log(`[${new Date().toISOString()}] Running: ${task.name}`);
    try {
      const result = execSync(task.command, { timeout: 300000, encoding: 'utf-8' });
      console.log(`  ✅ ${task.name} completed`);
    } catch (e) {
      console.log(`  ❌ ${task.name} failed: ${e.message.slice(0, 100)}`);
    }
  }
  console.log('\n=== All Tasks Complete ===\n');
}

function runTask(task) {
  console.log(`[${new Date().toISOString()}] Running: ${task.name}`);
  try {
    const result = execSync(task.command, { timeout: 300000, encoding: 'utf-8' });
    console.log(`  ✅ ${task.name} completed`);
    return { success: true, output: result };
  } catch (e) {
    console.log(`  ❌ ${task.name} failed: ${e.message.slice(0, 100)}`);
    return { success: false, error: e.message };
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--once')) {
    process.env.AMBIENT_RUN_ONCE = '1';
    runAllTasks();
  } else {
    scheduleAmbientTasks(args[0] || DEFAULT_SCHEDULE);
  }
}

module.exports = {
  AMBIENT_TASKS,
  scheduleAmbientTasks,
  runAllTasks,
  runTask,
};
