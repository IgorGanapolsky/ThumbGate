#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');

const DEFAULT_CHECKS = [
  { name: 'budget_status', command: ['npm', 'run', 'budget:status'], timeoutMs: 60_000 },
  { name: 'tests', command: ['npm', 'test'], timeoutMs: 15 * 60_000 },
  { name: 'prove_adapters', command: ['npm', 'run', 'prove:adapters'], timeoutMs: 10 * 60_000 },
  { name: 'prove_automation', command: ['npm', 'run', 'prove:automation'], timeoutMs: 10 * 60_000 },
];

function runCommand(command, { cwd = PROJECT_ROOT, timeoutMs = 5 * 60_000 } = {}) {
  const [cmd, ...args] = command;
  const started = Date.now();
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
    shell: false,
  });

  const durationMs = Date.now() - started;
  const status = Number.isInteger(result.status) ? result.status : 1;
  return {
    exitCode: status,
    durationMs,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null,
  };
}

function collectHealthReport({ checks = DEFAULT_CHECKS, runner = runCommand, cwd = PROJECT_ROOT } = {}) {
  const startedAt = new Date();
  const results = checks.map((check) => {
    const run = runner(check.command, { cwd, timeoutMs: check.timeoutMs });
    return {
      name: check.name,
      command: check.command.join(' '),
      status: run.exitCode === 0 ? 'healthy' : 'unhealthy',
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      error: run.error,
      outputTail: `${run.stdout}\n${run.stderr}`.trim().slice(-2000),
    };
  });

  const healthyCount = results.filter((x) => x.status === 'healthy').length;
  const unhealthyCount = results.length - healthyCount;

  return {
    generatedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    overall_status: unhealthyCount === 0 ? 'healthy' : 'unhealthy',
    summary: {
      total: results.length,
      healthy: healthyCount,
      unhealthy: unhealthyCount,
    },
    checks: results,
  };
}

function reportToText(report) {
  const lines = [];
  lines.push(`Self-Healing Health Check @ ${report.generatedAt}`);
  lines.push(`Overall: ${report.overall_status.toUpperCase()}`);
  lines.push(`Checks: ${report.summary.healthy}/${report.summary.total} healthy`);
  lines.push('');

  report.checks.forEach((check) => {
    const icon = check.status === 'healthy' ? '✅' : '❌';
    lines.push(`${icon} ${check.name} (${check.durationMs}ms)`);
    if (check.status !== 'healthy') {
      lines.push(`   command: ${check.command}`);
      if (check.error) lines.push(`   error: ${check.error}`);
    }
  });

  return `${lines.join('\n')}\n`;
}

function runCli() {
  const args = new Set(process.argv.slice(2));
  const emitJson = args.has('--json');
  const noFail = args.has('--no-fail');
  const report = collectHealthReport();

  if (emitJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(reportToText(report));
  }

  if (!noFail && report.overall_status !== 'healthy') {
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_CHECKS,
  runCommand,
  collectHealthReport,
  reportToText,
};

if (require.main === module) {
  runCli();
}
