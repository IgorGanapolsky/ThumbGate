#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { diagnoseFailure } = require('./failure-diagnostics');
const { appendDiagnosticRecord } = require('./feedback-loop');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

const DEFAULT_CHECKS = [
  { name: 'budget_status', command: ['npm', 'run', 'budget:status'], timeoutMs: 60_000 },
  { name: 'tests', command: ['npm', 'test'], timeoutMs: 15 * 60_000 },
  { name: 'prove_adapters', command: ['npm', 'run', 'prove:adapters'], timeoutMs: 10 * 60_000, useTempProofDir: true },
  { name: 'prove_automation', command: ['npm', 'run', 'prove:automation'], timeoutMs: 10 * 60_000, useTempProofDir: true },
  { name: 'prove_data_pipeline', command: ['npm', 'run', 'prove:data-pipeline'], timeoutMs: 10 * 60_000, useTempProofDir: true },
  { name: 'prove_tessl', command: ['npm', 'run', 'prove:tessl'], timeoutMs: 10 * 60_000, useTempProofDir: true },
];

function runCommand(command, {
  cwd = PROJECT_ROOT,
  timeoutMs = 5 * 60_000,
  env = process.env,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
} = {}) {
  const [cmd, ...args] = command;
  const started = Date.now();
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: maxBufferBytes,
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

function createCheckEnvironment(check) {
  const environment = { ...process.env };
  let cleanup = null;

  if (check.useTempProofDir) {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), `rlhf-${check.name}-`));
    environment.THUMBGATE_PROOF_DIR = proofDir;
    if (check.name === 'prove_automation') {
      environment.THUMBGATE_AUTOMATION_PROOF_DIR = proofDir;
    }
    cleanup = () => {
      fs.rmSync(proofDir, { recursive: true, force: true });
    };
  }

  return { env: environment, cleanup };
}

function collectHealthReport({
  checks = DEFAULT_CHECKS,
  runner = runCommand,
  cwd = PROJECT_ROOT,
  persistDiagnostics = false,
} = {}) {
  const startedAt = new Date();
  const results = checks.map((check) => {
    const { env, cleanup } = createCheckEnvironment(check);
    let run;
    try {
      run = runner(check.command, { cwd, timeoutMs: check.timeoutMs, env });
    } finally {
      if (cleanup) {
        cleanup();
      }
    }
    const diagnosis = run.exitCode === 0
      ? null
      : diagnoseFailure({
        step: check.name,
        context: check.command.join(' '),
        healthCheck: {
          name: check.name,
          exitCode: run.exitCode,
          status: 'unhealthy',
          outputTail: `${run.stdout}\n${run.stderr}`.trim().slice(-2000),
        },
        exitCode: run.exitCode,
        error: run.error,
        output: `${run.stdout}\n${run.stderr}`.trim(),
      });
    const persistedDiagnosis = persistDiagnostics && diagnosis
      ? appendDiagnosticRecord({
        source: 'self_heal_check',
        step: check.name,
        context: check.command.join(' '),
        diagnosis,
        metadata: {
          command: check.command.join(' '),
        },
      })
      : null;
    return {
      name: check.name,
      command: check.command.join(' '),
      status: run.exitCode === 0 ? 'healthy' : 'unhealthy',
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      error: run.error,
      outputTail: `${run.stdout}\n${run.stderr}`.trim().slice(-2000),
      diagnosis,
      persistedDiagnosis,
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
      if (check.diagnosis && check.diagnosis.rootCauseCategory) {
        lines.push(`   diagnosis: ${check.diagnosis.rootCauseCategory}`);
      }
    }
  });

  return `${lines.join('\n')}\n`;
}

function runCli() {
  const args = new Set(process.argv.slice(2));
  const emitJson = args.has('--json');
  const noFail = args.has('--no-fail');
  const report = collectHealthReport({ persistDiagnostics: true });

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
  DEFAULT_MAX_BUFFER_BYTES,
  runCommand,
  collectHealthReport,
  reportToText,
};

if (require.main === module) {
  runCli();
}
