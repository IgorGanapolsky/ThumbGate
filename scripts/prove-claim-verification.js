'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GATES_ENGINE_PATH = require.resolve('./gates-engine');
const MCP_SERVER_PATH = require.resolve('../adapters/mcp/server-stdio');
const VERIFY_RUN_PATH = require.resolve('./verify-run');

function resolveProofPaths() {
  const proofDir = process.env.THUMBGATE_CLAIM_VERIFICATION_PROOF_DIR
    || process.env.THUMBGATE_PROOF_DIR
    || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'claim-verification-report.json'),
    reportMd: path.join(proofDir, 'claim-verification-report.md'),
  };
}

function resetModules() {
  [GATES_ENGINE_PATH, MCP_SERVER_PATH, VERIFY_RUN_PATH].forEach((modulePath) => {
    delete require.cache[modulePath];
  });
}

async function withIsolatedRuntime(fn) {
  const previousHome = process.env.HOME;
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const previousNoRateLimit = process.env.THUMBGATE_NO_RATE_LIMIT;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-claim-home-'));
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-claim-feedback-'));

  process.env.HOME = homeDir;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_NO_RATE_LIMIT = '1';
  resetModules();

  try {
    const gatesEngine = require('./gates-engine');
    const mcpServer = require('../adapters/mcp/server-stdio');
    const verifyRun = require('./verify-run');
    return await fn({ gatesEngine, mcpServer, verifyRun, homeDir, feedbackDir });
  } finally {
    resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
    if (previousNoRateLimit === undefined) delete process.env.THUMBGATE_NO_RATE_LIMIT;
    else process.env.THUMBGATE_NO_RATE_LIMIT = previousNoRateLimit;
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
}

async function run() {
  const results = { passed: 0, failed: 0, requirements: {} };
  const { proofDir, reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'CLAIM-01',
      desc: 'default claim gates ship with the expected evidence-backed assertions',
      fn: async () => {
        await withIsolatedRuntime(async ({ gatesEngine }) => {
          const config = gatesEngine.loadClaimGates();
          const patterns = config.claims.map((claim) => claim.pattern);
          if (!patterns.some((pattern) => pattern.includes('figma'))) {
            throw new Error('Missing Figma claim gate');
          }
          if (!patterns.some((pattern) => pattern.includes('tests? pass'))) {
            throw new Error('Missing tests-pass claim gate');
          }
          if (!patterns.some((pattern) => pattern.includes('ready to merge'))) {
            throw new Error('Missing PR readiness claim gate');
          }
        });
      },
    },
    {
      id: 'CLAIM-02',
      desc: 'tracked evidence verifies shipped default claims',
      fn: async () => {
        await withIsolatedRuntime(async ({ gatesEngine }) => {
          gatesEngine.trackAction('figma_verified', { tool: 'mcp__figma__get_design_context' });
          const result = gatesEngine.verifyClaimEvidence('colors match Figma design');
          if (!result.verified) {
            throw new Error(`Expected verified claim, got ${JSON.stringify(result)}`);
          }
        });
      },
    },
    {
      id: 'CLAIM-03',
      desc: 'missing evidence blocks claims with actionable missing actions',
      fn: async () => {
        await withIsolatedRuntime(async ({ gatesEngine }) => {
          const result = gatesEngine.verifyClaimEvidence('tests pass');
          if (result.verified) {
            throw new Error('Expected unverified tests-pass claim');
          }
          if (!result.checks[0] || !result.checks[0].missing.includes('tests_passed')) {
            throw new Error(`Expected missing tests_passed action, got ${JSON.stringify(result)}`);
          }
        });
      },
    },
    {
      id: 'CLAIM-04',
      desc: 'custom claim gates persist only to local runtime state',
      fn: async () => {
        await withIsolatedRuntime(async ({ gatesEngine }) => {
          const baseline = fs.readFileSync(gatesEngine.DEFAULT_CLAIM_GATES_PATH, 'utf8');
          gatesEngine.registerClaimGate('ready to demo', ['tests_passed'], 'Run tests before demo claims');

          if (!fs.existsSync(gatesEngine.CUSTOM_CLAIM_GATES_PATH)) {
            throw new Error('Expected runtime custom claim gate file');
          }
          if (fs.readFileSync(gatesEngine.DEFAULT_CLAIM_GATES_PATH, 'utf8') !== baseline) {
            throw new Error('Default claim gates file was mutated');
          }
        });
      },
    },
    {
      id: 'CLAIM-05',
      desc: 'MCP tools expose track_action, verify_claim, and register_claim_gate end to end',
      fn: async () => {
        await withIsolatedRuntime(async ({ mcpServer }) => {
          await mcpServer.handleRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'track_action',
              arguments: {
                actionId: 'tests_passed',
                metadata: { source: 'npm test' },
              },
            },
          });

          const verifyResponse = await mcpServer.handleRequest({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'verify_claim',
              arguments: {
                claim: 'tests pass',
              },
            },
          });
          const verifyPayload = JSON.parse(verifyResponse.content[0].text);
          if (!verifyPayload.verified) {
            throw new Error(`Expected verified MCP claim, got ${verifyResponse.content[0].text}`);
          }

          const registerResponse = await mcpServer.handleRequest({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: 'register_claim_gate',
              arguments: {
                claimPattern: 'ready to demo',
                requiredActions: ['tests_passed'],
              },
            },
          });
          const registerPayload = JSON.parse(registerResponse.content[0].text);
          if (registerPayload.pattern !== 'ready to demo') {
            throw new Error(`Unexpected custom gate response: ${registerResponse.content[0].text}`);
          }
        });
      },
    },
    {
      id: 'CLAIM-06',
      desc: 'verify:full includes the claim-verification proof lane and artifact',
      fn: async () => {
        await withIsolatedRuntime(async ({ verifyRun, feedbackDir }) => {
          const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-claim-proof-cwd-'));
          try {
            const plan = verifyRun.buildVerifyPlan('full');
            const commands = plan.map((step) => [step.command, ...(step.args || [])].join(' ')).join('\n');
            if (!commands.includes('prove:claim-verification')) {
              throw new Error('verify:full is missing prove:claim-verification');
            }

            const entry = verifyRun.recordVerifyWorkflowRun('full', cwd, feedbackDir);
            const hasArtifact = entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'claim-verification-report.json')));
            if (!hasArtifact) {
              throw new Error('verify workflow run is missing claim verification proof artifact');
            }
          } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
          }
        });
      },
    },
  ];

  console.log('Claim Verification Gates - Proof Gate\n');
  console.log('Checking requirements:\n');

  for (const check of checks) {
    try {
      await check.fn();
      results.passed += 1;
      results.requirements[check.id] = { status: 'pass', desc: check.desc };
      console.log(`  PASS  ${check.id}: ${check.desc}`);
    } catch (error) {
      results.failed += 1;
      results.requirements[check.id] = {
        status: 'fail',
        desc: check.desc,
        error: error.message,
      };
      console.error(`  FAIL  ${check.id}: ${error.message}`);
    }
  }

  fs.mkdirSync(proofDir, { recursive: true });

  const report = {
    phase: '13-claim-verification',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    total: checks.length,
    requirements: results.requirements,
  };

  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);

  const markdown = [
    '# Claim Verification Proof Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Result: ${results.passed}/${checks.length} passed`,
    '',
    '## Requirements',
    '',
    ...Object.entries(results.requirements).map(([id, requirement]) => {
      const checkbox = requirement.status === 'pass' ? '[x]' : '[ ]';
      const errorLine = requirement.error ? `\n  - Error: \`${requirement.error}\`` : '';
      return `- ${checkbox} **${id}**: ${requirement.desc}${errorLine}`;
    }),
    '',
    `${results.passed} passed, ${results.failed} failed`,
    '',
  ].join('\n');
  fs.writeFileSync(reportMd, `${markdown}\n`);

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  console.log(`Report: ${reportJson}`);

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  resolveProofPaths,
  run,
};
