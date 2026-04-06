#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { waitForBackgroundSideEffects } = require('./feedback-loop');
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

function parseLeadingJson(text) {
  const raw = String(text || '');
  const marker = '\n\n---';
  const boundary = raw.indexOf(marker);
  const jsonSegment = boundary === -1 ? raw : raw.slice(0, boundary);
  return JSON.parse(jsonSegment.trim());
}

function initGitRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-proof-repo-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ThumbGate Proof'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'proof@example.com'], { cwd: repoPath, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# proof repo\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoPath, stdio: 'ignore' });
  return repoPath;
}

function removeWorktree(repoPath, worktreePath) {
  if (!repoPath || !worktreePath || !fs.existsSync(worktreePath)) return;
  execFileSync('git', ['-C', repoPath, 'worktree', 'remove', '--force', worktreePath], {
    stdio: 'ignore',
  });
}

async function fetchWithRetry(url, options, { retries = 5, delayMs = 100 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt === retries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  throw lastError;
}

async function proveMcpStdioTransport({
  root,
  transport = 'ndjson',
  timeoutMs = 10000,
  cwd = root,
  env = process.env,
}) {
  const cliPath = path.join(root, 'bin', 'cli.js');
  const child = spawn(process.execPath, [cliPath, 'serve'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  let stdoutBuffer = Buffer.alloc(0);
  let stderrBuffer = '';

  function parseResponse() {
    const headerEnd = stdoutBuffer.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const header = stdoutBuffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) return null;
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (stdoutBuffer.length < bodyEnd) return null;
      return stdoutBuffer.slice(bodyStart, bodyEnd).toString('utf8');
    }

    const newlineIndex = stdoutBuffer.indexOf('\n');
    if (newlineIndex === -1) return null;
    const line = stdoutBuffer.slice(0, newlineIndex).toString('utf8').trim();
    if (!line) return null;
    return line;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch (_) {
        // no-op
      }
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      done(new Error(`stdio ${transport} initialize timeout; stderr=${stderrBuffer}`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      done(err);
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      clearTimeout(timer);
      done(new Error(`stdio ${transport} exited early (code=${code}, signal=${signal}); stderr=${stderrBuffer}`));
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += String(chunk || '');
    });

    child.stdout.on('data', (chunk) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
      const body = parseResponse();
      if (!body) return;

      clearTimeout(timer);
      try {
        const parsed = JSON.parse(body);
        done(null, parsed);
      } catch (err) {
        done(err);
      }
    });

    const initialize = {
      jsonrpc: '2.0',
      id: 777,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {
          name: 'prove-adapters',
          version: '1.0.0',
        },
      },
    };

    if (transport === 'framed') {
      const body = JSON.stringify(initialize);
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
      return;
    }

    child.stdin.write(`${JSON.stringify(initialize)}\n`);
  });
}

async function runProof(options = {}) {
  const proofDir = options.proofDir || process.env.THUMBGATE_PROOF_DIR || DEFAULT_PROOF_DIR;
  const writeArtifacts = options.writeArtifacts !== false;
  const proofPort = options.port ?? 0;

  if (writeArtifacts) {
    ensureDir(proofDir);
  }

  const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-proof-'));
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const previousApiKey = process.env.THUMBGATE_API_KEY;
  const previousMcpProfile = process.env.THUMBGATE_MCP_PROFILE;
  const previousCodegraphStub = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
  process.env.THUMBGATE_API_KEY = 'proof-key';
  process.env.THUMBGATE_MCP_PROFILE = 'default';
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
    source: 'stub',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent', 'adapters/mcp/server-stdio.js -> planIntent'],
    callees: ['rankActions', 'decomposeActions'],
    deadCode: ['legacyIntentPlanner'],
  });

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
  const baseUrl = `http://127.0.0.1:${port}`;
  let currentCheck = 'bootstrap';

  try {
    // API checks
    {
      currentCheck = 'api.healthz';
      const res = await fetchWithRetry(`${baseUrl}/healthz`, {
        headers: { Authorization: 'Bearer proof-key' },
      });
      check(res.status === 200, `health expected 200, got ${res.status}`);
      addResult('api.healthz', true, { status: res.status });
    }

    {
      currentCheck = 'api.auth.required';
      const res = await fetchWithRetry(`${baseUrl}/v1/feedback/stats`);
      check(res.status === 401, `stats unauthorized expected 401, got ${res.status}`);
      addResult('api.auth.required', true, { status: res.status });
    }

    {
      currentCheck = 'api.intents.catalog';
      const res = await fetchWithRetry(`${baseUrl}/v1/intents/catalog?mcpProfile=locked`, {
        headers: { Authorization: 'Bearer proof-key' },
      });
      check(res.status === 200, `intents catalog expected 200, got ${res.status}`);
      const body = await res.json();
      check(Array.isArray(body.intents), 'intents catalog should return intents array');
      addResult('api.intents.catalog', true, { intents: body.intents.length, profile: body.mcpProfile });
    }

    {
      currentCheck = 'api.intents.plan';
      const res = await fetchWithRetry(`${baseUrl}/v1/intents/plan`, {
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
      currentCheck = 'api.intents.plan.codegraph';
      const res = await fetchWithRetry(`${baseUrl}/v1/intents/plan`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intentId: 'incident_postmortem',
          context: 'Refactor `planIntent` in scripts/intent-router.js',
          mcpProfile: 'default',
          repoPath: ROOT,
        }),
      });
      check(res.status === 200, `intent plan with codegraph expected 200, got ${res.status}`);
      const body = await res.json();
      check(body.codegraphImpact && body.codegraphImpact.enabled === true, 'api intent plan should include codegraph impact');
      check(body.codegraphImpact.evidence.deadCodeCount >= 1, 'api intent plan should carry dead-code evidence');
      addResult('api.intents.plan.codegraph', true, {
        source: body.codegraphImpact.source,
        impactScore: body.codegraphImpact.evidence.impactScore,
      });
    }

    {
      currentCheck = 'api.internal_agent.bootstrap';
      const repoPath = initGitRepo();
      const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-proof-bootstrap-'));
      let sandboxPath = null;

      try {
        const res = await fetchWithRetry(`${baseUrl}/v1/internal-agent/bootstrap`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer proof-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source: 'github',
            repoPath,
            sandboxRoot,
            context: 'Improve the response with evidence and prevention rules',
            trigger: { type: 'pull_request_comment', id: '17', actor: 'octocat' },
            task: {
              title: 'Harden bootstrap plan',
              body: 'Refactor scripts/intent-router.js and provide proof.',
            },
          }),
        });
        check(res.status === 200, `internal agent bootstrap expected 200, got ${res.status}`);
        const body = await res.json();
        sandboxPath = body.sandbox && body.sandbox.path;
        check(body.sandbox && body.sandbox.ready === true, 'api bootstrap should prepare a sandbox');
        check(body.reviewerLane && body.reviewerLane.enabled === true, 'api bootstrap should recommend a reviewer lane');
        addResult('api.internal_agent.bootstrap', true, {
          sandboxReady: body.sandbox.ready,
          executionMode: body.intentPlan.executionMode,
        });
      } finally {
        removeWorktree(repoPath, sandboxPath);
        fs.rmSync(repoPath, { recursive: true, force: true });
        fs.rmSync(sandboxRoot, { recursive: true, force: true });
      }
    }

    {
      currentCheck = 'api.capture_feedback';
      const res = await fetchWithRetry(`${baseUrl}/v1/feedback/capture`, {
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
      currentCheck = 'api.capture_feedback.clarification';
      const res = await fetchWithRetry(`${baseUrl}/v1/feedback/capture`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proof-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signal: 'up',
          context: 'thumbs up',
          tags: ['verification'],
        }),
      });
      check(res.status === 422, `clarification capture expected 422, got ${res.status}`);
      const body = await res.json();
      check(body.status === 'clarification_required', 'vague capture should require clarification');
      check(body.needsClarification === true, 'vague capture should set needsClarification');
      addResult('api.capture_feedback.clarification', true, { status: body.status, prompt: body.prompt });
    }

    {
      currentCheck = 'api.capture_feedback.rubric_gate';
      const res = await fetchWithRetry(`${baseUrl}/v1/feedback/capture`, {
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
      currentCheck = 'api.context.construct';
      const construct = await fetchWithRetry(`${baseUrl}/v1/context/construct`, {
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

      currentCheck = 'api.context.evaluate';
      const evaluate = await fetchWithRetry(`${baseUrl}/v1/context/evaluate`, {
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
      currentCheck = 'mcp.initialize';
      const init = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      check(Boolean(init.serverInfo && init.serverInfo.name), 'mcp initialize missing serverInfo');
      addResult('mcp.initialize', true, { server: init.serverInfo.name });
    }

    {
      currentCheck = 'mcp.stdio.framed.initialize';
      const framedResponse = await proveMcpStdioTransport({ root: ROOT, transport: 'framed' });
      check(framedResponse.id === 777, 'stdio framed initialize returned wrong id');
      check(Boolean(framedResponse.result && framedResponse.result.serverInfo), 'stdio framed initialize missing serverInfo');
      addResult('mcp.stdio.framed.initialize', true, { server: framedResponse.result.serverInfo.name });
    }

    {
      currentCheck = 'mcp.stdio.ndjson.initialize';
      const ndjsonResponse = await proveMcpStdioTransport({ root: ROOT, transport: 'ndjson' });
      check(ndjsonResponse.id === 777, 'stdio ndjson initialize returned wrong id');
      check(Boolean(ndjsonResponse.result && ndjsonResponse.result.serverInfo), 'stdio ndjson initialize missing serverInfo');
      addResult('mcp.stdio.ndjson.initialize', true, { server: ndjsonResponse.result.serverInfo.name });
    }

    {
      currentCheck = 'mcp.cli.serve.bad_home.initialize';
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-proof-cli-serve-'));
      const badHomePath = path.join(isolatedDir, 'invalid-home');
      fs.writeFileSync(badHomePath, 'not-a-directory\n');

      try {
        const response = await proveMcpStdioTransport({
          root: ROOT,
          transport: 'ndjson',
          cwd: isolatedDir,
          env: {
            ...process.env,
            HOME: badHomePath,
            USERPROFILE: badHomePath,
          },
        });
        check(response.id === 777, 'cli serve bad HOME initialize returned wrong id');
        check(Boolean(response.result && response.result.serverInfo), 'cli serve bad HOME initialize missing serverInfo');
        addResult('mcp.cli.serve.bad_home.initialize', true, { server: response.result.serverInfo.name });
      } finally {
        fs.rmSync(isolatedDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }

    {
      currentCheck = 'mcp.tools.list';
      const list = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      check(Array.isArray(list.tools) && list.tools.length > 0, 'mcp tools/list empty');
      addResult('mcp.tools.list', true, { tools: list.tools.length });
    }

    {
      currentCheck = 'mcp.tools.call.feedback_summary';
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
      currentCheck = 'mcp.tools.call.diagnose_failure';
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 36,
        method: 'tools/call',
        params: {
          name: 'diagnose_failure',
          arguments: {
            step: 'capture_feedback',
            context: 'Attempted to approve publish flow without required approval',
            toolName: 'capture_feedback',
            toolArgs: {},
            intentId: 'publish_dpo_training_data',
            mcpProfile: 'default',
          },
        },
      });
      const diagnosis = JSON.parse(call.content[0].text);
      check(diagnosis.rootCauseCategory === 'intent_plan_misalignment', 'mcp diagnose_failure should classify approval mismatch');
      check(diagnosis.compiledConstraints.summary.toolSchemaCount >= 1, 'mcp diagnose_failure should include compiled constraints');
      addResult('mcp.tools.call.diagnose_failure', true, {
        rootCauseCategory: diagnosis.rootCauseCategory,
        toolSchemaCount: diagnosis.compiledConstraints.summary.toolSchemaCount,
      });
    }

    {
      currentCheck = 'mcp.tools.call.plan_intent';
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
      currentCheck = 'mcp.tools.call.plan_intent.codegraph';
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 34,
        method: 'tools/call',
        params: {
          name: 'plan_intent',
          arguments: {
            intentId: 'incident_postmortem',
            context: 'Refactor `planIntent` in scripts/intent-router.js',
            mcpProfile: 'default',
            repoPath: ROOT,
          },
        },
      });
      const plan = JSON.parse(call.content[0].text);
      check(plan.codegraphImpact && plan.codegraphImpact.enabled === true, 'mcp plan_intent should include codegraph impact');
      check(plan.codegraphImpact.evidence.deadCodeCount >= 1, 'mcp plan_intent should include dead-code evidence');
      addResult('mcp.tools.call.plan_intent.codegraph', true, {
        impactScore: plan.codegraphImpact.evidence.impactScore,
      });
    }

    {
      currentCheck = 'mcp.tools.call.get_business_metrics';
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: {
          name: 'get_business_metrics',
          arguments: { window: 'lifetime' },
        },
      });
      const metrics = JSON.parse(call.content[0].text);
      check(metrics.metrics && typeof metrics.metrics.bookedRevenueCents === 'number', 'get_business_metrics should return numeric revenue');
      addResult('mcp.tools.call.get_business_metrics', true, { generatedAt: metrics.generatedAt });
    }

    {
      currentCheck = 'mcp.tools.call.describe_semantic_entity';
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: {
          name: 'describe_semantic_entity',
          arguments: { type: 'Customer' },
        },
      });
      const entity = JSON.parse(call.content[0].text);
      check(entity.description && entity.tiers, 'describe_semantic_entity should return Customer definition');
      addResult('mcp.tools.call.describe_semantic_entity', true, { type: 'Customer' });
    }

    {
      currentCheck = 'mcp.tools.call.recall.codegraph';
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 35,
        method: 'tools/call',
        params: {
          name: 'recall',
          arguments: {
            query: 'Refactor `planIntent` in scripts/intent-router.js',
            repoPath: ROOT,
          },
        },
      });
      check(/## Code Graph Impact/.test(call.content[0].text), 'mcp recall should include code graph impact section');
      check(/Potential dead code/.test(call.content[0].text), 'mcp recall should include dead-code evidence');
      addResult('mcp.tools.call.recall.codegraph', true, {
        contentLength: call.content[0].text.length,
      });
    }

    {
      currentCheck = 'mcp.tools.call.bootstrap_internal_agent';
      const repoPath = initGitRepo();
      const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-proof-mcp-bootstrap-'));
      let sandboxPath = null;

      try {
        const call = await handleRequest({
          jsonrpc: '2.0',
          id: 37,
          method: 'tools/call',
          params: {
            name: 'bootstrap_internal_agent',
            arguments: {
              source: 'github',
              repoPath,
              sandboxRoot,
              context: 'Improve the response with evidence and prevention rules',
              trigger: { type: 'pull_request_comment', id: '18', actor: 'octocat' },
              task: {
                title: 'Harden bootstrap plan',
                body: 'Refactor scripts/intent-router.js and provide proof.',
              },
            },
          },
        });
        const payload = JSON.parse(call.content[0].text);
        sandboxPath = payload.sandbox && payload.sandbox.path;
        check(payload.sandbox && payload.sandbox.ready === true, 'mcp bootstrap should prepare a sandbox');
        check(payload.reviewerLane && payload.reviewerLane.enabled === true, 'mcp bootstrap should recommend a reviewer lane');
        addResult('mcp.tools.call.bootstrap_internal_agent', true, {
          sandboxReady: payload.sandbox.ready,
          executionMode: payload.intentPlan.executionMode,
        });
      } finally {
        removeWorktree(repoPath, sandboxPath);
        fs.rmSync(repoPath, { recursive: true, force: true });
        fs.rmSync(sandboxRoot, { recursive: true, force: true });
      }
    }

    {
      currentCheck = 'mcp.tools.call.capture_feedback.rubric_gate';
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
      const payload = parseLeadingJson(call.content[0].text);
      check(payload.accepted === false, 'mcp capture_feedback should apply rubric gating');
      addResult('mcp.tools.call.capture_feedback.rubric_gate', true, { accepted: payload.accepted });
    }

    {
      currentCheck = 'mcp.tools.call.capture_feedback.clarification';
      const call = await handleRequest({
        jsonrpc: '2.0',
        id: 33,
        method: 'tools/call',
        params: {
          name: 'capture_feedback',
          arguments: {
            signal: 'up',
            context: 'thumbs up',
            tags: ['verification'],
          },
        },
      });
      const payload = parseLeadingJson(call.content[0].text);
      check(payload.status === 'clarification_required', 'mcp capture_feedback should require clarification for vague praise');
      check(payload.needsClarification === true, 'mcp capture_feedback should mark vague praise as clarification_required');
      addResult('mcp.tools.call.capture_feedback.clarification', true, { status: payload.status, prompt: payload.prompt });
    }

    {
      currentCheck = 'mcp.policy.locked_profile_denies_write_tool';
      process.env.THUMBGATE_MCP_PROFILE = 'locked';
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
      process.env.THUMBGATE_MCP_PROFILE = 'default';
      check(denied, 'locked profile should deny capture_feedback');
      addResult('mcp.policy.locked_profile_denies_write_tool', true, { denied });
    }

    // Spec and adapter files checks
    {
      currentCheck = 'adapter.chatgpt.openapi.parity';
      const canonical = fs.readFileSync(path.join(ROOT, 'openapi/openapi.yaml'), 'utf-8');
      const chatgpt = fs.readFileSync(path.join(ROOT, 'adapters/chatgpt/openapi.yaml'), 'utf-8');
      check(canonical === chatgpt, 'chatgpt openapi not in sync with canonical openapi');

      ['/v1/feedback/capture', '/v1/dpo/export', '/v1/context/construct', '/v1/intents/plan', '/v1/internal-agent/bootstrap'].forEach((route) => {
        check(new RegExp(escapeRegExp(route)).test(canonical), `route missing from openapi: ${route}`);
      });
      addResult('adapter.chatgpt.openapi.parity', true, { byteEqual: true });
    }

    {
      currentCheck = 'adapter.gemini.declarations';
      const gemini = JSON.parse(fs.readFileSync(path.join(ROOT, 'adapters/gemini/function-declarations.json'), 'utf-8'));
      check(Array.isArray(gemini.tools), 'gemini tools missing');
      check(gemini.tools.length >= 3, 'gemini tools should have at least 3 entries');
      addResult('adapter.gemini.declarations', true, { tools: gemini.tools.length });
    }

    {
      currentCheck = 'adapter.files.present';
      const mustExist = [
        'adapters/claude/.mcp.json',
        'plugins/claude-codex-bridge/.claude-plugin/plugin.json',
        'plugins/claude-codex-bridge/.mcp.json',
        'plugins/cursor-marketplace/mcp.json',
        'adapters/codex/config.toml',
        'plugins/codex-profile/.codex-plugin/plugin.json',
        'plugins/codex-profile/.mcp.json',
        '.agents/plugins/marketplace.json',
        'adapters/amp/skills/rlhf-feedback/SKILL.md',
      ];
      mustExist.forEach((file) => {
        check(fs.existsSync(path.join(ROOT, file)), `missing adapter file: ${file}`);
      });
      addResult('adapter.files.present', true, { files: mustExist.length });
    }

    // Profiles and policy checks
    {
      currentCheck = 'subagent.profiles.valid';
      const validation = validateSubagentProfiles();
      check(validation.valid, `subagent profiles invalid: ${validation.issues.join('; ')}`);
      const names = listSubagentProfiles();
      check(names.length >= 2, 'expected at least 2 subagent profiles');
      addResult('subagent.profiles.valid', true, { profiles: names });
    }

    {
      currentCheck = 'mcp.policy.profile_differentiation';
      const defaultTools = getAllowedTools('default');
      const lockedTools = getAllowedTools('locked');
      check(defaultTools.length > lockedTools.length, 'default profile should expose more tools than locked');
      addResult('mcp.policy.profile_differentiation', true, {
        defaultTools: defaultTools.length,
        lockedTools: lockedTools.length,
      });
    }
  } catch (err) {
    addResult('fatal', false, {
      check: currentCheck,
      error: err.message,
      cause: err.cause && err.cause.message ? err.cause.message : null,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await waitForBackgroundSideEffects();
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
    if (previousApiKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = previousApiKey;
    if (previousMcpProfile === undefined) delete process.env.THUMBGATE_MCP_PROFILE;
    else process.env.THUMBGATE_MCP_PROFILE = previousMcpProfile;
    if (previousCodegraphStub === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previousCodegraphStub;
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
