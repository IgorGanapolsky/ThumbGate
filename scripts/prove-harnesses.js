#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HARNESS_PATH = require.resolve('./natural-language-harness');
const RUNNER_PATH = require.resolve('./async-job-runner');
const VERIFICATION_PATH = require.resolve('./verification-loop');
const VERIFY_RUN_PATH = require.resolve('./verify-run');
const SERVER_STDIO_PATH = require.resolve('../adapters/mcp/server-stdio');

function resolveProofPaths() {
  const proofDir = process.env.THUMBGATE_HARNESSES_PROOF_DIR || process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'harnesses-report.json'),
    reportMd: path.join(proofDir, 'harnesses-report.md'),
  };
}

function resetModules() {
  [
    HARNESS_PATH,
    RUNNER_PATH,
    VERIFICATION_PATH,
    VERIFY_RUN_PATH,
    SERVER_STDIO_PATH,
  ].forEach((modulePath) => {
    delete require.cache[modulePath];
  });
}

function stubModule(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

function makeAcceptedVerification() {
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
}

async function withHarnessRuntime(callback) {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-harness-proof-'));
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  try {
    resetModules();
    stubModule(VERIFICATION_PATH, {
      runVerificationLoop: () => makeAcceptedVerification(),
    });
    return await callback({
      harnesses: require('./natural-language-harness'),
      runner: require('./async-job-runner'),
      verifyRun: require('./verify-run'),
      server: require('../adapters/mcp/server-stdio'),
    });
  } finally {
    resetModules();
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
}

function writeReports(results, reportJson, reportMd) {
  fs.mkdirSync(path.dirname(reportJson), { recursive: true });
  fs.writeFileSync(reportJson, JSON.stringify(results, null, 2));

  const lines = [
    '# Natural-Language Harness Proof',
    '',
    `- Phase: ${results.phase}`,
    `- Timestamp: ${results.timestamp}`,
    `- ${results.passed} passed, ${results.failed} failed`,
    '',
    '## Requirements',
    '',
  ];

  for (const requirement of Object.values(results.requirements)) {
    lines.push(`- [${requirement.passed ? 'x' : ' '}] **${requirement.id}** ${requirement.desc}`);
  }

  fs.writeFileSync(reportMd, `${lines.join('\n')}\n`);
}

async function run() {
  const results = {
    phase: '23-natural-language-harnesses',
    timestamp: new Date().toISOString(),
    passed: 0,
    failed: 0,
    requirements: {},
  };
  const { reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'HARNESS-01',
      desc: 'natural-language harness specs load and validate with required sections',
      fn: async () => {
        const { harnesses } = await withHarnessRuntime((context) => context);
        const listed = harnesses.listHarnesses();
        if (listed.length < 3) {
          throw new Error(`Expected at least 3 harnesses, found ${listed.length}`);
        }
        if (!listed.some((entry) => entry.id === 'repo-full-verification')) {
          throw new Error('repo-full-verification harness is missing');
        }
      },
    },
    {
      id: 'HARNESS-02',
      desc: 'rendered harness plans substitute inputs into natural-language steps',
      fn: async () => {
        await withHarnessRuntime(({ harnesses }) => {
          const plan = harnesses.renderHarnessPlan('creator-partnership-review', {
            creatorHandle: 'agentbuilder',
          });
          if (!plan.steps.some((step) => step.includes('agentbuilder'))) {
            throw new Error('Expected rendered steps to include the input override');
          }
          if (!plan.successEvidence.some((line) => line.includes('agentbuilder'))) {
            throw new Error('Expected rendered evidence to include the input override');
          }
        });
      },
    },
    {
      id: 'HARNESS-03',
      desc: 'harness plans compile into executable async-job-runner stages',
      fn: async () => {
        await withHarnessRuntime(({ harnesses }) => {
          const job = harnesses.buildHarnessJob('repo-full-verification', {
            verificationCommand: 'node -e "process.stdout.write(\'verify ok\')"',
          }, { jobId: 'proof-harness-job' });
          const commandStage = job.stages.find((stage) => stage.command);
          if (!commandStage || !commandStage.command.includes('verify ok')) {
            throw new Error('Expected a command stage with the rendered verification command');
          }
          if (!job.tags.includes('natural-language-harness')) {
            throw new Error('Expected natural-language-harness tag on compiled job');
          }
        });
      },
    },
    {
      id: 'HARNESS-04',
      desc: 'runHarness executes a harness through the runtime with checkpoints and verification',
      fn: async () => {
        await withHarnessRuntime(({ harnesses, runner }) => {
          const result = harnesses.runHarness('repo-full-verification', {
            verificationCommand: 'node -e "process.stdout.write(\'verify ok\')"',
          }, {
            jobId: 'proof-run-harness',
          });
          const state = runner.readJobState('proof-run-harness');
          if (result.status !== 'completed') {
            throw new Error(`Expected completed harness result, got ${result.status}`);
          }
          if (!state || state.stageHistory.length < 3) {
            throw new Error('Expected persisted stage history for executed harness');
          }
          if (!String(state.currentContext || '').includes('Success evidence required:')) {
            throw new Error('Expected final context to include success evidence summary');
          }
        });
      },
    },
    {
      id: 'HARNESS-05',
      desc: 'MCP surfaces expose list_harnesses and run_harness operations',
      fn: () => {
        return withHarnessRuntime(async ({ server }) => {
          const listed = await server.handleRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'list_harnesses',
              arguments: { tag: 'verification' },
            },
          });
          const catalog = JSON.parse(listed.content[0].text);
          if (!catalog.harnesses.some((entry) => entry.id === 'repo-full-verification')) {
            throw new Error('Expected repo-full-verification in MCP harness catalog');
          }

          const executed = await server.handleRequest({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'run_harness',
              arguments: {
                harness: 'repo-full-verification',
                jobId: 'mcp-proof-harness',
                inputs: {
                  verificationCommand: 'node -e "process.stdout.write(\'verify ok\')"',
                },
              },
            },
          });
          const payload = JSON.parse(executed.content[0].text);
          if (payload.status !== 'completed') {
            throw new Error(`Expected run_harness MCP result to complete, got ${payload.status}`);
          }
        });
      },
    },
    {
      id: 'HARNESS-06',
      desc: 'full verification includes the harness proof lane and artifact',
      fn: async () => {
        await withHarnessRuntime(({ verifyRun }) => {
          const plan = verifyRun.buildVerifyPlan('full');
          const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-harness-run-'));
          try {
            const workflowRun = verifyRun.recordVerifyWorkflowRun('full', ROOT, feedbackDir);
            if (!plan.some((step) => Array.isArray(step.args) && step.args.includes('prove:harnesses'))) {
              throw new Error('verify:full is missing prove:harnesses');
            }
            if (!workflowRun.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'harnesses-report.json')))) {
              throw new Error('Workflow run is missing harness proof artifact');
            }
          } finally {
            fs.rmSync(feedbackDir, { recursive: true, force: true });
          }
        });
      },
    },
  ];

  for (const check of checks) {
    try {
      await check.fn();
      results.passed += 1;
      results.requirements[check.id] = { id: check.id, desc: check.desc, passed: true };
    } catch (error) {
      results.failed += 1;
      results.requirements[check.id] = {
        id: check.id,
        desc: check.desc,
        passed: false,
        error: error.message,
      };
    }
  }

  writeReports(results, reportJson, reportMd);

  console.log(`${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  resolveProofPaths,
  run,
};
