'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

if (process.env.CODEX_SANDBOX) {
  test('job API tests require socket listen permission', { skip: true }, () => {});
} else {

const SERVER_PATH = require.resolve('../src/api/server');
const RUNNER_PATH = require.resolve('../scripts/async-job-runner');
const HOSTED_JOB_LAUNCHER_PATH = require.resolve('../scripts/hosted-job-launcher');
const VERIFICATION_PATH = require.resolve('../scripts/verification-loop');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-job-api-feedback-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-job-api-proof-'));

process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env.THUMBGATE_HOSTED_JOB_LAUNCH_MODE = 'inline';
process.env.THUMBGATE_BUILD_METADATA_PATH = path.join(tmpFeedbackDir, 'build-metadata.json');
fs.writeFileSync(
  process.env.THUMBGATE_BUILD_METADATA_PATH,
  JSON.stringify({ buildSha: 'job-api-build', generatedAt: '2026-04-08T00:00:00.000Z' }, null, 2),
);

function stubModule(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

[
  SERVER_PATH,
  RUNNER_PATH,
  HOSTED_JOB_LAUNCHER_PATH,
  VERIFICATION_PATH,
].forEach((modulePath) => {
  delete require.cache[modulePath];
});

stubModule(VERIFICATION_PATH, {
  runVerificationLoop() {
    return {
      accepted: true,
      attempts: 1,
      finalVerification: {
        score: 1,
        violations: [],
      },
      partnerStrategy: {
        profile: 'strict_reviewer',
        verificationMode: 'evidence_first',
      },
      partnerReward: {
        reward: 1,
      },
    };
  },
});

const runner = require('../scripts/async-job-runner');
const { startServer } = require('../src/api/server');

let handle;
let origin = '';
const authHeader = { authorization: 'Bearer test-api-key' };

function apiUrl(pathname = '/') {
  return new URL(pathname, origin).toString();
}

test.before(async () => {
  handle = await startServer({ port: 0 });
  origin = `http://localhost:${handle.port}`;
});

test.after(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  fs.rmSync(tmpProofDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;
  delete process.env.THUMBGATE_PROOF_DIR;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_HOSTED_JOB_LAUNCH_MODE;
  delete process.env.THUMBGATE_BUILD_METADATA_PATH;
  [
    SERVER_PATH,
    RUNNER_PATH,
    HOSTED_JOB_LAUNCHER_PATH,
    VERIFICATION_PATH,
  ].forEach((modulePath) => {
    delete require.cache[modulePath];
  });
});

test('async DPO export launches as a hosted job and persists its output artifact', async () => {
  const memoryLogPath = path.join(tmpFeedbackDir, 'memory-log.jsonl');
  const outputPath = path.join(tmpFeedbackDir, 'exports', 'dpo.jsonl');
  fs.writeFileSync(memoryLogPath, [
    JSON.stringify({
      id: 'err-1',
      category: 'error',
      title: 'ERROR: force push to main',
      content: 'Force-pushed directly to main before review.',
      tags: ['git', 'workflow'],
    }),
    JSON.stringify({
      id: 'learn-1',
      category: 'learning',
      title: 'LEARNING: use PR gating',
      content: 'Open a PR and run verification before merge.',
      tags: ['git', 'workflow'],
    }),
  ].join('\n') + '\n', 'utf8');

  const launchRes = await fetch(apiUrl('/v1/dpo/export'), {
    method: 'POST',
    headers: {
      ...authHeader,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      async: true,
      memoryLogPath,
      outputPath,
    }),
  });

  assert.equal(launchRes.status, 202);
  const launchBody = await launchRes.json();
  assert.equal(launchBody.accepted, true);
  assert.equal(typeof launchBody.jobId, 'string');
  assert.match(launchBody.statusUrl, new RegExp(`/v1/jobs/${launchBody.jobId}$`));
  assert.equal(launchBody.status, 'completed');

  const stateRes = await fetch(apiUrl(`/v1/jobs/${launchBody.jobId}`), {
    headers: authHeader,
  });
  assert.equal(stateRes.status, 200);
  const stateBody = await stateRes.json();
  assert.equal(stateBody.job.status, 'completed');
  assert.equal(stateBody.job.verification, null);

  const summary = JSON.parse(stateBody.job.currentContext);
  assert.equal(summary.pairs, 1);
  assert.equal(summary.outputPath, outputPath);
  assert.equal(fs.existsSync(outputPath), true);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /"chosen"/);

  const listRes = await fetch(apiUrl('/v1/jobs?limit=5'), {
    headers: authHeader,
  });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.ok(listBody.jobs.some((job) => job.jobId === launchBody.jobId));
});

test('harness launch endpoint runs a managed verification job and exposes status', async () => {
  const res = await fetch(apiUrl('/v1/jobs/harness'), {
    method: 'POST',
    headers: {
      ...authHeader,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      harness: 'repo-full-verification',
      inputs: {
        verificationCommand: 'node -e "process.stdout.write(\'verify ok\')"',
      },
    }),
  });

  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.accepted, true);
  assert.equal(body.status, 'completed');

  const state = runner.readJobState(body.jobId);
  assert.ok(state);
  assert.equal(state.status, 'completed');
  assert.match(state.currentContext, /verify ok/);
  assert.match(state.currentContext, /Success evidence required:/);
  assert.ok(state.stageHistory.length >= 3);
});

test('job control endpoint can pause and resume queued hosted jobs', async () => {
  runner.queueJob({
    id: 'queued-hosted-job',
    verificationMode: 'none',
    recordFeedback: false,
    stages: [
      { name: 'export', context: 'queued output' },
    ],
  });

  const pauseRes = await fetch(apiUrl('/v1/jobs/queued-hosted-job/control'), {
    method: 'POST',
    headers: {
      ...authHeader,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action: 'pause',
      metadata: { reason: 'operator requested hold' },
    }),
  });
  assert.equal(pauseRes.status, 202);
  const pauseBody = await pauseRes.json();
  assert.equal(pauseBody.job.status, 'paused');

  const resumeRes = await fetch(apiUrl('/v1/jobs/queued-hosted-job/control'), {
    method: 'POST',
    headers: {
      ...authHeader,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'resume' }),
  });
  assert.equal(resumeRes.status, 202);
  const resumeBody = await resumeRes.json();
  assert.equal(resumeBody.job.status, 'completed');

  const stateRes = await fetch(apiUrl('/v1/jobs/queued-hosted-job'), {
    headers: authHeader,
  });
  assert.equal(stateRes.status, 200);
  const stateBody = await stateRes.json();
  assert.equal(stateBody.job.status, 'completed');
  assert.equal(stateBody.job.currentContext, 'queued output');
});

}
