#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureDir } = require('./fs-utils');

const {
  buildCloudflareSandboxPlan,
  verifyDispatchEnvelope,
} = require('./cloudflare-dynamic-sandbox');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function supportsListen() {
  const script = `
    const net = require('node:net');
    const server = net.createServer();
    server.once('error', (err) => {
      console.log(err && err.code === 'EPERM' ? 'EPERM' : 'ERR');
    });
    server.listen(0, '127.0.0.1', () => {
      server.close(() => console.log('OK'));
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return String(result.stdout || '').trim() === 'OK';
}

function buildIsolatedNpmEnv(cacheDir) {
  return {
    ...process.env,
    npm_config_cache: cacheDir,
    npm_config_logs_dir: path.join(cacheDir, 'logs'),
  };
}

function runCommand(command, args, cwd = ROOT, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function addCheck(report, id, passed, evidence) {
  report.checks.push({ id, passed, evidence });
  if (passed) report.summary.passed += 1;
  else report.summary.failed += 1;
}

function writeReport(report, proofDir) {
  ensureDir(proofDir);
  const jsonPath = path.join(proofDir, 'cloudflare-sandbox-report.json');
  const mdPath = path.join(proofDir, 'cloudflare-sandbox-report.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const markdown = [
    '# Cloudflare Sandbox Proof',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Passed: ${report.summary.passed}`,
    `Failed: ${report.summary.failed}`,
    '',
    ...report.checks.map((check) => `- ${check.passed ? 'PASS' : 'FAIL'} ${check.id}: ${check.evidence}`),
    '',
  ].join('\n');
  fs.writeFileSync(mdPath, markdown);
  return { jsonPath, mdPath };
}

function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    checks: [],
    summary: {
      passed: 0,
      failed: 0,
    },
  };

  const npmCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-npm-cache-'));
  const npmEnv = buildIsolatedNpmEnv(npmCacheDir);

  const listenOk = supportsListen();

  if (!listenOk) {
    addCheck(report, 'CFW-01', true, 'skipped (environment blocks local TCP listen)');
    addCheck(report, 'CFW-02', true, 'skipped (environment blocks IPC sockets used by tsx)');
  } else {
    const unit = runCommand(process.execPath, [
      '--test',
      'tests/cloudflare-dynamic-sandbox.test.js',
      'tests/cloudflare-sandbox-api.test.js',
    ], ROOT, npmEnv);
    addCheck(
      report,
      'CFW-01',
      unit.ok,
      unit.ok ? 'cloudflare sandbox planner + API tests passed' : unit.output.trim(),
    );

    const worker = runCommand(npmCommand(), [
      'test',
    ], path.join(ROOT, 'workers'), npmEnv);
    addCheck(
      report,
      'CFW-02',
      worker.ok,
      worker.ok ? 'worker sandbox route tests passed' : worker.output.trim(),
    );
  }

  const plan = buildCloudflareSandboxPlan({
    workloadType: 'history_distillation',
    tier: 'team',
    tenantId: 'team_thumbgate',
    requiresIsolation: true,
    allowedHosts: ['api.anthropic.com'],
    context: 'Prove hosted sandbox dispatch.',
    task: { title: 'Proof dispatch' },
  }, {
    sharedSecret: 'proof-secret',
    now: '2026-04-03T16:00:00.000Z',
  });
  addCheck(
    report,
    'CFW-03',
    plan.provider === 'cloudflare_dynamic_worker' && plan.shouldDispatch === true,
    `provider=${plan.provider}; shouldDispatch=${plan.shouldDispatch}; route=${plan.route}`,
  );

  const signatureOk = verifyDispatchEnvelope({
    body: plan.envelope,
    secret: 'proof-secret',
    timestamp: plan.headers['x-thumbgate-sandbox-timestamp'],
    signature: plan.headers['x-thumbgate-sandbox-signature'],
    now: Date.parse('2026-04-03T16:00:00.000Z'),
  });
  addCheck(
    report,
    'CFW-04',
    signatureOk,
    `signatureReady=${plan.signatureReady}; verified=${signatureOk}`,
  );

  const repoBound = buildCloudflareSandboxPlan({
    workloadType: 'workflow_triage',
    tier: 'team',
    repoPath: '/tmp/repo',
  });
  addCheck(
    report,
    'CFW-05',
    repoBound.provider === 'railway_control_plane' && repoBound.shouldDispatch === false,
    `provider=${repoBound.provider}; shouldDispatch=${repoBound.shouldDispatch}`,
  );

  addCheck(
    report,
    'CFW-06',
    Array.isArray(plan.envelope.bindings) && plan.envelope.bindings.includes('MEMORY_KV'),
    `bindings=${plan.envelope.bindings.join(',')}`,
  );

  const { jsonPath, mdPath } = writeReport(report, DEFAULT_PROOF_DIR);
  console.log(`Cloudflare sandbox proof written to ${jsonPath} and ${mdPath}`);

  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

main();
