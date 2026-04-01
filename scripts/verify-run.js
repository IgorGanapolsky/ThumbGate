#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { appendWorkflowRun } = require('./workflow-runs');

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function buildVerifyPlan(mode = 'quick') {
  if (mode === 'quick') {
    return [
      { command: 'node', args: ['--test', 'tests/verify-run.test.js'] },
      { command: npmCommand(), args: ['run', 'test:cli'] },
    ];
  }

  if (mode === 'full') {
    return [
      { command: npmCommand(), args: ['test'] },
      { command: npmCommand(), args: ['run', 'test:coverage'] },
      { command: npmCommand(), args: ['run', 'prove:adapters'] },
      { command: npmCommand(), args: ['run', 'prove:automation'] },
      { command: npmCommand(), args: ['run', 'prove:claim-verification'] },
      { command: npmCommand(), args: ['run', 'prove:data-pipeline'] },
      { command: npmCommand(), args: ['run', 'prove:evolution'] },
      { command: npmCommand(), args: ['run', 'prove:runtime'] },
      { command: npmCommand(), args: ['run', 'prove:seo-gsd'] },
      { command: npmCommand(), args: ['run', 'prove:tessl'] },
      { command: npmCommand(), args: ['run', 'prove:xmemory'] },
      { command: npmCommand(), args: ['run', 'self-heal:check'] },
    ];
  }

  throw new Error(`Unsupported verify mode: ${mode}`);
}

function runPlan(plan, env = process.env, cwd = process.cwd()) {
  for (const step of plan) {
    console.log(`$ ${step.command} ${step.args.join(' ')}`.trim());
    const result = spawnSync(step.command, step.args, {
      cwd,
      env,
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      const joined = [step.command, ...step.args].join(' ');
      throw new Error(`Verification failed: ${joined}`);
    }
  }
}

function copyArtifactIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function materializeProofArtifacts(tempRoot, cwd = process.cwd()) {
  const artifacts = [
    {
      source: path.join(tempRoot, 'proof-adapters', 'report.json'),
      target: path.join(cwd, 'proof', 'compatibility', 'report.json'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'report.md'),
      target: path.join(cwd, 'proof', 'compatibility', 'report.md'),
    },
    {
      source: path.join(tempRoot, 'proof-automation', 'report.json'),
      target: path.join(cwd, 'proof', 'automation', 'report.json'),
    },
    {
      source: path.join(tempRoot, 'proof-automation', 'report.md'),
      target: path.join(cwd, 'proof', 'automation', 'report.md'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'claim-verification-report.json'),
      target: path.join(cwd, 'proof', 'claim-verification-report.json'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'claim-verification-report.md'),
      target: path.join(cwd, 'proof', 'claim-verification-report.md'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'data-pipeline-report.json'),
      target: path.join(cwd, 'proof', 'data-pipeline-report.json'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'data-pipeline-report.md'),
      target: path.join(cwd, 'proof', 'data-pipeline-report.md'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'evolution-report.json'),
      target: path.join(cwd, 'proof', 'evolution-report.json'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'evolution-report.md'),
      target: path.join(cwd, 'proof', 'evolution-report.md'),
    },
    {
      source: path.join(tempRoot, 'proof-runtime', 'runtime-report.json'),
      target: path.join(cwd, 'proof', 'runtime-report.json'),
    },
    {
      source: path.join(tempRoot, 'proof-runtime', 'runtime-report.md'),
      target: path.join(cwd, 'proof', 'runtime-report.md'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'seo-gsd-report.json'),
      target: path.join(cwd, 'proof', 'seo-gsd-report.json'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'seo-gsd-report.md'),
      target: path.join(cwd, 'proof', 'seo-gsd-report.md'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'tessl-report.json'),
      target: path.join(cwd, 'proof', 'tessl-report.json'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'tessl-report.md'),
      target: path.join(cwd, 'proof', 'tessl-report.md'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'xmemory-report.json'),
      target: path.join(cwd, 'proof', 'xmemory-report.json'),
    },
    {
      source: path.join(tempRoot, 'proof-adapters', 'xmemory-report.md'),
      target: path.join(cwd, 'proof', 'xmemory-report.md'),
    },
  ];

  return artifacts
    .filter(({ source, target }) => copyArtifactIfPresent(source, target))
    .map(({ target }) => target);
}

function recordVerifyWorkflowRun(mode = 'quick', cwd = process.cwd(), feedbackDir = undefined) {
  if (mode !== 'full') return null;
  return appendWorkflowRun({
    workflowId: 'repo_self_dogfood_full_verify',
    workflowName: 'Repo self dogfood full verification',
    owner: 'cto',
    runtime: 'node',
    status: 'passed',
    customerType: 'internal_dogfood',
    teamId: 'internal_repo',
    reviewed: true,
    reviewedBy: 'automation',
    proofBacked: true,
    source: 'verify:full',
    proofArtifacts: [
      path.join(cwd, 'docs', 'VERIFICATION_EVIDENCE.md'),
      path.join(cwd, 'proof', 'compatibility', 'report.json'),
      path.join(cwd, 'proof', 'automation', 'report.json'),
      path.join(cwd, 'proof', 'claim-verification-report.json'),
      path.join(cwd, 'proof', 'data-pipeline-report.json'),
      path.join(cwd, 'proof', 'evolution-report.json'),
      path.join(cwd, 'proof', 'runtime-report.json'),
      path.join(cwd, 'proof', 'seo-gsd-report.json'),
      path.join(cwd, 'proof', 'tessl-report.json'),
      path.join(cwd, 'proof', 'xmemory-report.json'),
    ],
    metadata: {
      suite: 'repo_verify_full',
    },
  }, feedbackDir);
}

function runVerify(mode = 'quick', baseEnv = process.env, cwd = process.cwd()) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-verify-'));
  const env = {
    ...baseEnv,
    RLHF_PROOF_DIR: path.join(tempRoot, 'proof-adapters'),
    RLHF_AUTOMATION_PROOF_DIR: path.join(tempRoot, 'proof-automation'),
    RLHF_RUNTIME_PROOF_DIR: path.join(tempRoot, 'proof-runtime'),
  };

  runPlan(buildVerifyPlan(mode), env, cwd);
  materializeProofArtifacts(tempRoot, cwd);
  const workflowRun = recordVerifyWorkflowRun(mode, cwd);

  return {
    mode,
    tempRoot,
    workflowRun,
  };
}

if (require.main === module) {
  try {
    runVerify(process.argv[2] || 'quick');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  buildVerifyPlan,
  materializeProofArtifacts,
  recordVerifyWorkflowRun,
  runPlan,
  runVerify,
};
