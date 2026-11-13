'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'mcp-allowlists.json'), 'utf8'));
const { TOOLS, getExposedTools, getToolCapability, handleRequest } = require('../adapters/mcp/server-stdio');
const { getActiveMcpProfile, hydrateMcpEnvFromUserConfig } = require('../scripts/mcp-policy');
const { isTransientProjectDir, resolveFeedbackDir } = require('../scripts/feedback-paths');
const { evaluateGates } = require('../scripts/gates-engine');

function packedExistsSync(absolutePath) {
  const relativePath = path.relative(ROOT, absolutePath).split(path.sep).join('/');
  return pkg.files.some((entry) => {
    const normalized = String(entry).replace(/\/$/, '');
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

test('factory essential and lean profiles expose only core agent tools', () => {
  const allowed = new Set(policy.profiles.essential);
  const exposed = getExposedTools('essential');
  assert.ok(exposed.length > 0 && exposed.length <= 9);
  const exposedNames = new Set(exposed.map((tool) => tool.name));
  assert.equal(exposedNames.has('create_purchase_requisition'), false);
  assert.equal(exposedNames.has('plan_chatgpt_ads_readiness'), false);
  assert.equal(exposedNames.has('plan_oss_pr_opportunity_scout'), false);
  assert.equal(exposedNames.has('capture_feedback'), true);
  assert.equal(exposedNames.has('search_lessons'), true);
  assert.equal(exposedNames.has('prevention_rules'), true);
  assert.equal(exposedNames.has('gate_check'), true);
  assert.equal(exposedNames.has('record_task_outcome'), true);
  for (const tool of exposed) {
    assert.equal(allowed.has(tool.name), true, `${tool.name} is not allowed by essential`);
    assert.equal(getToolCapability(tool.name).available, true, `${tool.name} is not executable`);
  }
});

test('public package never advertises a tool whose implementation is absent', () => {
  for (const profileName of Object.keys(policy.profiles)) {
    const exposed = getExposedTools(profileName, { existsSync: packedExistsSync });
    for (const tool of exposed) {
      assert.equal(
        getToolCapability(tool.name, { existsSync: packedExistsSync }).available,
        true,
        `${profileName} exposed unavailable ${tool.name}`,
      );
    }
  }
});

test('public package hides managed-agent tools and keeps packaged retrieval executable', () => {
  const exposedNames = new Set(getExposedTools('default', { existsSync: packedExistsSync }).map((tool) => tool.name));
  assert.equal(exposedNames.has('managed_agent_status'), false);
  assert.equal(exposedNames.has('run_managed_lesson_agent'), false);
  assert.equal(exposedNames.has('retrieve_lessons'), true);
  assert.equal(getToolCapability('retrieve_lessons', { existsSync: packedExistsSync }).available, true);
});

test('every registry tool that is advertised is executable', () => {
  const advertised = new Set();
  for (const profileName of Object.keys(policy.profiles)) {
    for (const tool of getExposedTools(profileName, { existsSync: packedExistsSync })) advertised.add(tool.name);
  }
  for (const tool of TOOLS) {
    if (advertised.has(tool.name)) {
      assert.equal(getToolCapability(tool.name, { existsSync: packedExistsSync }).available, true);
    }
  }
});

test('~/tmp is treated as a transient directory and never creates ~/tmp/.thumbgate', () => {
  const homeTmp = path.join(os.homedir(), 'tmp');
  assert.equal(isTransientProjectDir(homeTmp, { env: {} }), true);
  const resolved = resolveFeedbackDir({ cwd: homeTmp, includeStored: false, env: {} });
  assert.notEqual(resolved, path.join(homeTmp, '.thumbgate'));
  assert.equal(resolved, path.join(os.homedir(), '.thumbgate', 'projects', 'tmp'));
});

test('hard PreToolUse gates block Chrome port 9222, false waiting on Igor, and raw jargon dumps', () => {
  const chromeRes = evaluateGates('Bash', {
    command: 'curl -s http://127.0.0.1:9222/json/version',
  });
  assert.ok(chromeRes);
  assert.equal(chromeRes.decision, 'deny');
  assert.match(chromeRes.message, /9222/);

  const waitingRes = evaluateGates('Write', {
    content: 'Status: Waiting on Igor while build still running in CI',
  });
  assert.ok(waitingRes);
  assert.equal(waitingRes.decision, 'deny');
  assert.match(waitingRes.message, /waiting on Igor/i);

  const jargonRes = evaluateGates('Write', {
    content: 'Executive Summary: FALLBACK_APPLIED P95_LATENCY_MS=412',
  });
  assert.ok(jargonRes);
  assert.equal(jargonRes.decision, 'deny');
  assert.match(jargonRes.message, /jargon/i);
});

test('tools/list returns the exact 9-tool lean set when THUMBGATE_MCP_PROFILE=lean', async () => {
  const prevProfile = process.env.THUMBGATE_MCP_PROFILE;
  const prevSubagent = process.env.THUMBGATE_SUBAGENT_PROFILE;
  process.env.THUMBGATE_MCP_PROFILE = 'lean';
  delete process.env.THUMBGATE_SUBAGENT_PROFILE;
  try {
    assert.equal(getActiveMcpProfile(), 'lean');
    const res = await handleRequest({ jsonrpc: '2.0', id: 901, method: 'tools/list' });
    const toolNames = res.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      'capture_feedback',
      'gate_check',
      'prevention_rules',
      'recall',
      'record_task_outcome',
      'retrieve_lessons',
      'satisfy_gate',
      'search_lessons',
      'verify_claim',
    ]);

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lean-home-'));
    try {
      fs.writeFileSync(
        path.join(tempHome, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            thumbgate: {
              command: 'thumbgate',
              args: ['serve'],
              env: { THUMBGATE_MCP_PROFILE: 'lean' },
            },
          },
        }),
      );
      const mockEnv = {};
      const hydrated = hydrateMcpEnvFromUserConfig({ env: mockEnv, homeDir: tempHome, allowInTest: true });
      assert.equal(hydrated.hydrated, true);
      assert.equal(mockEnv.THUMBGATE_MCP_PROFILE, 'lean');
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  } finally {
    if (prevProfile === undefined) delete process.env.THUMBGATE_MCP_PROFILE;
    else process.env.THUMBGATE_MCP_PROFILE = prevProfile;
    if (prevSubagent === undefined) delete process.env.THUMBGATE_SUBAGENT_PROFILE;
    else process.env.THUMBGATE_SUBAGENT_PROFILE = prevSubagent;
  }
});

test('feedback_stats returns compact summary <2000 chars by default and full payload when verbose=true', async () => {
  const prevProfile = process.env.THUMBGATE_MCP_PROFILE;
  process.env.THUMBGATE_MCP_PROFILE = 'default';
  try {
    const compactRes = await handleRequest({
      jsonrpc: '2.0',
      id: 902,
      method: 'tools/call',
      params: { name: 'feedback_stats', arguments: {} },
    });
    const compactText = compactRes.content[0].text;
    assert.ok(
      compactText.length < 2000,
      `Expected default feedback_stats response < 2000 chars, got ${compactText.length}`,
    );
    const compactParsed = JSON.parse(compactText);
    assert.equal(compactParsed.compact, true);
    assert.equal(typeof compactParsed.total, 'number');
    assert.equal(typeof compactParsed.totalPositive, 'number');
    assert.equal(typeof compactParsed.totalNegative, 'number');
    assert.equal(typeof compactParsed.approvalRate, 'number');
    assert.equal(Array.isArray(compactParsed.topBlockedRules), true);
    assert.ok(compactParsed.topBlockedRules.length <= 5);

    const verboseRes = await handleRequest({
      jsonrpc: '2.0',
      id: 903,
      method: 'tools/call',
      params: { name: 'feedback_stats', arguments: { verbose: true } },
    });
    const verboseParsed = JSON.parse(verboseRes.content[0].text);
    assert.equal(verboseParsed.compact, undefined);
    assert.equal(typeof verboseParsed.skills, 'object');
    assert.equal(typeof verboseParsed.tags, 'object');
  } finally {
    if (prevProfile === undefined) delete process.env.THUMBGATE_MCP_PROFILE;
    else process.env.THUMBGATE_MCP_PROFILE = prevProfile;
  }
});
