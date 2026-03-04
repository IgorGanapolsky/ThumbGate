#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { startServer } = require('../src/api/server');
const { handleRequest } = require('../adapters/mcp/server-stdio');
const { validateSubagentProfiles, listSubagentProfiles } = require('./subagent-profiles');
const { getAllowedTools } = require('./mcp-policy');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = path.join(ROOT, 'proof', 'compatibility');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runProof(options = {}) {
  const proofDir = options.proofDir || process.env.RLHF_PROOF_DIR || DEFAULT_PROOF_DIR;
  const writeArtifacts = options.writeArtifacts !== false;
  const proofPort = options.port ?? 0;

  if (writeArtifacts) {
    ensureDir(proofDir);
  }

  const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-proof-'));
  process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;
  process.env.RLHF_API_KEY = 'proof-key';
  process.env.RLHF_MCP_PROFILE = 'default';

  const report = {
    generatedAt: new Date().toISOString(),
    checks: [],
    summary: { passed: 0, failed: 0 },
  };

  function addResult(name, passed, details) {
    report.checks.push({ name, passed, details });
    if (passed) report.summary.passed += 1;
    else report.summary.failed += 1;
  }

  const { server, port } = await startServer({ port: proofPort });

  try {
    // API checks
    {
      const res = await fetch(`http://localhost:${port}/healthz`, {
        headers: { Authorization: 'Bearer proof-key' },
      });
      check(res.status === 200, `health expected 200, got ${res.status}`);
      addResult('api.healthz', true, { status: res.status });
    }

    {
      const res = await fetch(`http://localhost:${port}/v1/feedback/stats`);
      check(res.status === 401, `stats unauthorized expected 401, got ${res.status}`);
      addResult('api.auth.required', true, { status: res.status });
    }

    {
      const res = await fetch(`http://localhost:${port}/v1/intents/catalog?mcpProfile=locked`, {
        headers: { Authorization: 'Bearer proof-key' },
      });
      check(res.status === 200, `intents catalog expected 200, got ${res.status}`);
      const body = await res.json();
      check(Array.isArray(body.intents), 'intents catalog should return intents array');
      addResult('api.intents.catalog', true, { intents: body.intents.length, profile: body.mcpProfile });
    }

    {
      const res = await fetch(`http://localhost:${port}/v1/intents/plan`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intentId: 'publish_dpo_training_data',
          mcpProfile: 'default',
          approved: false,
        }),
      });
      check(res.status === 200, `intent plan expected 200, got ${res.status}`);
      const body = await res.json();
      check(body.status === 'checkpoint_required', 'intent plan should require checkpoint when not approved');
      addResult('api.intents.plan', true, { status: body.status, risk: body.intent.risk });
    }

    {
      const res = await fetch(`http://localhost:${port}/v1/feedback/capture`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signal: 'up',
          context: 'adapter proof harness',
          whatWorked: 'end-to-end verification flow',
          tags: ['verification', 'proof'],
        }),
      });
      check(res.status === 200, `capture expected 200, got ${res.status}`);
      const body = await res.json();
      check(body.accepted === true, 'capture should be accepted');
      addResult('api.capture_feedback', true, { accepted: body.accepted });
    }

    {
      const res = await fetch(`http://localhost:${port}/v1/feedback/capture`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signal: 'up',
          context: 'unsafe approval attempt',
          whatWorked: 'claimed success',
          rubricScores: [
            { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
            { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing logs' },
          ],
          guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
          tags: ['verification'],
        }),
      });
      check(res.status === 422, `rubric-gated capture expected 422, got ${res.status}`);
      const body = await res.json();
      check(body.accepted === false, 'rubric-gated capture should not be accepted');
      addResult('api.capture_feedback.rubric_gate', true, { accepted: body.accepted });
    }

    {
      const construct = await fetch(`http://localhost:${port}/v1/context/construct`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'verification', maxItems: 5, maxChars: 5000 }),
      });
      check(construct.status === 200, `context construct expected 200, got ${construct.status}`);
      const pack = await construct.json();
      check(Boolean(pack.packId), 'context packId missing');
      addResult('api.context.construct', true, { packId: pack.packId, items: pack.items.length });

      const evaluate = await fetch(`http://localhost:${port}/v1/context/evaluate`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          packId: pack.packId,
          outcome: 'useful',
          signal: 'positive',
          rubricScores: [
            { criterion: 'correctness', score: 4, evidence: 'tests pass', judge: 'judge-a' },
            { criterion: 'verification_evidence', score: 4, evidence: 'logs attached', judge: 'judge-a' },
          ],
          guardrails: { testsPassed: true, pathSafety: true, budgetCompliant: true },
        }),
      });
      check(evaluate.status === 200, `context evaluate expected 200, got ${evaluate.status}`);
      const evalBody = await evaluate.json();
      check(Boolean(evalBody.rubricEvaluation), 'context evaluate should include rubricEvaluation');
      addResult('api.context.evaluate', true, { status: evaluate.status, rubric: evalBody.rubricEvaluation.rubricId });
    }

    // MCP checks
    {
      const init = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      check(Boolean(init.serverInfo && init.serverInfo.name), 'mcp initialize missing serverInfo');
      addResult('mcp.initialize', true, { server: init.serverInfo.name });
    }

    {
      const list = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      check(Array.isArray(list.tools) && list.tools.length > 0, 'mcp tools/list empty');
      addResult('mcp.tools.list', true, { tools: list.tools.length });
    }

    {
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'feedback_summary',
          arguments: { recent: 5 },
        },
      });
      check(Array.isArray(call.content), 'mcp feedback_summary should return content[]');
      addResult('mcp.tools.call.feedback_summary', true, { contentLength: call.content[0].text.length });
    }

    {
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: {
          name: 'plan_intent',
          arguments: {
            intentId: 'publish_dpo_training_data',
            mcpProfile: 'default',
          },
        },
      });
      const plan = JSON.parse(call.content[0].text);
      check(plan.status === 'checkpoint_required', 'mcp plan_intent should return checkpoint_required by default');
      addResult('mcp.tools.call.plan_intent', true, { status: plan.status });
    }

    {
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 32,
        method: 'tools/call',
        params: {
          name: 'capture_feedback',
          arguments: {
            signal: 'up',
            context: 'unsafe approval attempt',
            whatWorked: 'claimed success',
            rubricScores: [
              { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
              { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing logs' },
            ],
            guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
          },
        },
      });
      const payload = JSON.parse(call.content[0].text);
      check(payload.accepted === false, 'mcp capture_feedback should apply rubric gating');
      addResult('mcp.tools.call.capture_feedback.rubric_gate', true, { accepted: payload.accepted });
    }

    {
      process.env.RLHF_MCP_PROFILE = 'locked';
      let denied = false;
      try {
        await handleRequest({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'capture_feedback',
            arguments: { signal: 'up', context: 'should be denied' },
          },
        });
      } catch (err) {
        denied = /not allowed/i.test(String(err.message));
      }
      process.env.RLHF_MCP_PROFILE = 'default';
      check(denied, 'locked profile should deny capture_feedback');
      addResult('mcp.policy.locked_profile_denies_write_tool', true, { denied });
    }

    // Spec and adapter files checks
    {
      const canonical = fs.readFileSync(path.join(ROOT, 'openapi/openapi.yaml'), 'utf-8');
      const chatgpt = fs.readFileSync(path.join(ROOT, 'adapters/chatgpt/openapi.yaml'), 'utf-8');
      check(canonical === chatgpt, 'chatgpt openapi not in sync with canonical openapi');

      ['/v1/feedback/capture', '/v1/dpo/export', '/v1/context/construct', '/v1/intents/plan'].forEach((route) => {
        check(new RegExp(escapeRegExp(route)).test(canonical), `route missing from openapi: ${route}`);
      });
      addResult('adapter.chatgpt.openapi.parity', true, { byteEqual: true });
    }

    {
      const gemini = JSON.parse(fs.readFileSync(path.join(ROOT, 'adapters/gemini/function-declarations.json'), 'utf-8'));
      check(Array.isArray(gemini.tools), 'gemini tools missing');
      check(gemini.tools.length >= 3, 'gemini tools should have at least 3 entries');
      addResult('adapter.gemini.declarations', true, { tools: gemini.tools.length });
    }

    {
      const mustExist = [
        'adapters/claude/.mcp.json',
        'adapters/codex/config.toml',
        'adapters/amp/skills/rlhf-feedback/SKILL.md',
      ];
      mustExist.forEach((file) => {
        check(fs.existsSync(path.join(ROOT, file)), `missing adapter file: ${file}`);
      });
      addResult('adapter.files.present', true, { files: mustExist.length });
    }

    // Profiles and policy checks
    {
      const validation = validateSubagentProfiles();
      check(validation.valid, `subagent profiles invalid: ${validation.issues.join('; ')}`);
      const names = listSubagentProfiles();
      check(names.length >= 2, 'expected at least 2 subagent profiles');
      addResult('subagent.profiles.valid', true, { profiles: names });
    }

    {
      const defaultTools = getAllowedTools('default');
      const lockedTools = getAllowedTools('locked');
      check(defaultTools.length > lockedTools.length, 'default profile should expose more tools than locked');
      addResult('mcp.policy.profile_differentiation', true, {
        defaultTools: defaultTools.length,
        lockedTools: lockedTools.length,
      });
    }
  } catch (err) {
    addResult('fatal', false, { error: err.message });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  }

  if (writeArtifacts) {
    const reportPath = path.join(proofDir, 'report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    const mdLines = [
      '# Adapter Compatibility Proof',
      '',
      `Generated: ${report.generatedAt}`,
      '',
      `Passed: ${report.summary.passed}`,
      `Failed: ${report.summary.failed}`,
      '',
      '## Checks',
      ...report.checks.map((checkItem) => `- ${checkItem.passed ? 'PASS' : 'FAIL'} ${checkItem.name}`),
      '',
    ];
    fs.writeFileSync(path.join(proofDir, 'report.md'), `${mdLines.join('\n')}\n`);
  }

  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }

  return report;
}

module.exports = {
  runProof,
};

if (require.main === module) {
  runProof().then((report) => {
    console.log(JSON.stringify(report.summary, null, 2));
  });
}
