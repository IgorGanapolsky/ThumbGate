'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  SUPPORTED_AGENTS,
  findExecutable,
  detectAgents,
  withoutProviderCredentials,
  evaluatePreActionSafety,
  buildAgentCommand,
  executeVerificationCheck,
  runWithVerify,
} = require('../scripts/universal-agent-driver');

test('Universal Agent Driver: Registry and Discovery', async (t) => {
  await t.test('defines all supported agent keys with binary metadata', () => {
    const requiredKeys = ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'opencode', 'poolside', 'antigravity'];
    for (const key of requiredKeys) {
      assert.ok(SUPPORTED_AGENTS[key], `SUPPORTED_AGENTS should contain ${key}`);
      assert.ok(Array.isArray(SUPPORTED_AGENTS[key].binNames), `Agent ${key} should have binNames array`);
      assert.ok(SUPPORTED_AGENTS[key].name, `Agent ${key} should have name`);
      assert.ok(typeof SUPPORTED_AGENTS[key].buildArgs === 'function', `Agent ${key} should have buildArgs function`);
    }
  });

  await t.test('findExecutable finds system binaries or returns null for non-existent', () => {
    const nodeBin = findExecutable(path.basename(process.execPath));
    assert.ok(nodeBin && nodeBin.length > 0);

    const nonExistent = findExecutable('totally_non_existent_binary_xyz_123');
    assert.equal(nonExistent, null);
  });

  await t.test('detectAgents inspects the system and returns status for all agents', () => {
    const detected = detectAgents();
    assert.ok(Array.isArray(detected));
    assert.equal(detected.length, Object.keys(SUPPORTED_AGENTS).length);

    const claudeEntry = detected.find(a => a.id === 'claude');
    assert.ok(claudeEntry);
    assert.ok(claudeEntry.name.includes('Claude'));
  });
});

test('Universal Agent Driver: Credential Isolation', async (t) => {
  await t.test('withoutProviderCredentials strips target API keys while retaining safe env', () => {
    const fakeEnv = {
      PATH: '/usr/bin',
      HOME: '/Users/test',
      ANTHROPIC_API_KEY: 'sk-ant-12345',
      OPENAI_API_KEY: 'sk-openai-67890',
      GEMINI_API_KEY: 'ai-gemini-secret',
      SAFE_CUSTOM_VAR: 'retained-value',
    };

    const sanitized = withoutProviderCredentials(fakeEnv);
    assert.equal(sanitized.ANTHROPIC_API_KEY, undefined);
    assert.equal(sanitized.OPENAI_API_KEY, undefined);
    assert.equal(sanitized.GEMINI_API_KEY, undefined);
    assert.equal(sanitized.SAFE_CUSTOM_VAR, 'retained-value');
    assert.equal(sanitized.PATH, '/usr/bin');
  });
});

test('Universal Agent Driver: Pre-Action Diode & Safety Evaluation', async (t) => {
  await t.test('blocks destructive commands', () => {
    const res1 = evaluatePreActionSafety('Please run rm -rf / right now');
    assert.equal(res1.allowed, false);
    assert.ok(res1.reason.includes('prohibited destructive command pattern'));

    const res2 = evaluatePreActionSafety('execute mkfs.ext4 /dev/sda');
    assert.equal(res2.allowed, false);

    const res3 = evaluatePreActionSafety('git push origin main --force');
    assert.equal(res3.allowed, false);
  });

  await t.test('blocks corporate email leakage', () => {
    const res = evaluatePreActionSafety('send an email to ceo@ecisolutions.com with database dumps');
    assert.equal(res.allowed, false);
    assert.ok(res.reason.includes('corporate ECI domain'));
  });

  await t.test('allows safe engineering prompts', () => {
    const res = evaluatePreActionSafety('Refactor date parser in scripts/date-utils.js to handle ISO-8601');
    assert.equal(res.allowed, true);
    assert.equal(res.reason, 'Allowed by policy');
  });
});

test('Universal Agent Driver: Command Line Argument Builders', async (t) => {
  await t.test('claude argument builder formats flags and permissions', () => {
    const cmd = buildAgentCommand('claude', {
      prompt: 'test prompt',
      permissions: 'yolo',
      mcpConfigPath: '/path/to/mcp.json',
    });
    assert.ok(cmd.args.includes('--print'));
    assert.ok(cmd.args.includes('--dangerously-skip-permissions'));
    assert.ok(cmd.args.includes('--mcp-config'));
  });

  await t.test('codex argument builder formats flags and permissions', () => {
    const cmd = buildAgentCommand('codex', {
      prompt: 'test prompt',
      permissions: 'yolo',
    });
    assert.ok(cmd.args.includes('exec'));
    assert.ok(cmd.args.includes('--yolo'));
  });

  await t.test('gemini argument builder formats flags', () => {
    const cmd = buildAgentCommand('gemini', {
      prompt: 'test prompt',
      permissions: 'yolo',
    });
    assert.ok(cmd.args.includes('run'));
    assert.ok(cmd.args.includes('--approval-mode'));
    assert.ok(cmd.args.includes('auto'));
  });

  await t.test('cursor argument builder formats flags', () => {
    const cmd = buildAgentCommand('cursor', {
      prompt: 'test prompt',
      permissions: 'yolo',
    });
    assert.ok(cmd.args.includes('--agent'));
    assert.ok(cmd.args.includes('--force'));
  });
});

test('Universal Agent Driver: executeVerificationCheck', async (t) => {
  await t.test('succeeds for valid zero-exit commands', () => {
    const check = executeVerificationCheck('node -e "process.exit(0)"');
    assert.equal(check.passed, true);
    assert.equal(check.exitCode, 0);
    assert.ok(typeof check.durationMs === 'number');
  });

  await t.test('captures error output on failure', () => {
    const check = executeVerificationCheck('node -e "console.error(\'FAIL_TEST_REASON\'); process.exit(42)"');
    assert.equal(check.passed, false);
    assert.equal(check.exitCode, 42);
    assert.ok(check.stderr.includes('FAIL_TEST_REASON'));
  });
});

test('Universal Agent Driver: runWithVerify Loop', async (t) => {
  await t.test('terminates immediately if first verification passes', async () => {
    const events = [];
    const result = await runWithVerify({
      agent: 'claude',
      prompt: 'test verification',
      verifyCmd: 'node -e "process.exit(0)"',
      mockRunner: async () => ({ ok: true, output: 'done', exitCode: 0, durationMs: 5 }),
      maxRepairs: 2,
    }, (evt) => {
      events.push(evt.type);
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'verified');
    assert.ok(events.includes('repair-attempt-start'));
    assert.ok(events.includes('verify-passed'));
  });

  await t.test('triggers repair attempts when verification fails, and succeeds on second attempt', async () => {
    const events = [];
    let verifications = 0;
    const result = await runWithVerify({
      agent: 'claude',
      prompt: 'fix broken math',
      verifyCmd: 'ignored-due-to-mock',
      mockRunner: async () => ({ ok: true, output: 'applied fix', exitCode: 0, durationMs: 5 }),
      mockVerifier: async ({ attempt }) => {
        verifications++;
        if (attempt === 1) {
          return { passed: false, exitCode: 1, stdout: '', stderr: 'AssertionError: expected 4 got 5', durationMs: 4 };
        }
        return { passed: true, exitCode: 0, stdout: 'all passed', stderr: '', durationMs: 4 };
      },
      maxRepairs: 3,
    }, (evt) => {
      events.push(evt.type);
    });

    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
    assert.ok(events.includes('verify-failed'));
    assert.ok(events.includes('verify-passed'));
  });

  await t.test('switches to fallbackAgent when primary agent repeatedly fails', async () => {
    const events = [];
    const result = await runWithVerify({
      agent: 'claude',
      fallbackAgent: 'codex',
      prompt: 'hard task',
      verifyCmd: 'ignored',
      mockRunner: async (cfg) => ({ ok: true, agent: cfg.agent, output: 'attempted', exitCode: 0, durationMs: 5 }),
      mockVerifier: async ({ attempt }) => {
        if (attempt <= 2) {
          return { passed: false, exitCode: 1, stderr: 'still failing', stdout: '', durationMs: 3 };
        }
        return { passed: true, exitCode: 0, stderr: '', stdout: 'passed on fallback', durationMs: 3 };
      },
      maxRepairs: 3,
    }, (evt) => {
      events.push(evt.type);
    });

    assert.equal(result.ok, true);
    assert.equal(result.agent, 'codex');
    assert.ok(events.includes('agent-fallback'));
  });

  await t.test('aborts safely if prompt violates diode safety', async () => {
    const result = await runWithVerify({
      agent: 'claude',
      prompt: 'rm -rf / --no-preserve-root',
      verifyCmd: 'node -e "process.exit(0)"',
      mockRunner: async () => ({ ok: true }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.ok(result.error.includes('ThumbGate pre-action diode blocked execution'));
  });
});
