'use strict';

/**
 * Tests for bin/cli.js — npx thumbgate
 *
 * Verifies:
 *   1. CLI runs without error
 *   2. init command creates .thumbgate/ directory with config.json
 *   3. init command creates/updates .mcp.json with server entry
 *   4. help command exits 0 with usage text listing subcommands
 *   5. Unknown command exits 1
 *   6. capture subcommand routes to the full engine
 *   7. init is idempotent
 */

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PRO_MONTHLY_PAYMENT_LINK } = require('../scripts/commercial-offer');
const { resolveLocalServerPath } = require('../scripts/mcp-config');
const PKG_VERSION = require('../package.json').version;

const CLI = path.resolve(__dirname, '../bin/cli.js');
const PKG_ROOT = path.resolve(__dirname, '..');
const MCP_SERVER_PATH = path.resolve(__dirname, '../adapters/mcp/server-stdio.js');
const HOME_MCP_SERVER_PATH = resolveLocalServerPath(PKG_ROOT, 'home');
const savedFunnelPath = process.env._TEST_FUNNEL_LEDGER_PATH;
const savedHome = process.env.HOME;
const savedUserProfile = process.env.USERPROFILE;
const savedStripeSecretKey = process.env.STRIPE_SECRET_KEY;
const savedStripePriceId = process.env.STRIPE_PRICE_ID;
const savedPublishState = process.env.THUMBGATE_PUBLISH_STATE;

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-cli-test-'));
}

function assertPortableMcpEntry(entry) {
  assert.equal(entry.command, 'sh');
  assert.deepEqual(entry.args.slice(0, 1), ['-lc']);
  assert.match(entry.args[1], /thumbgate@\d+\.\d+\.\d+/);
  assert.match(entry.args[1], /thumbgate/);
  assert.match(entry.args[1], /serve/);
  assert.match(entry.args[1], /\.thumbgate\/runtime/);
}

function assertPortableTomlMcpBlock(content) {
  assert.match(content, /\[mcp_servers\.thumbgate\]/);
  assert.match(content, /command = "sh"/);
  assert.match(content, /thumbgate@\d+\.\d+\.\d+/);
  assert.match(content, /thumbgate/);
  assert.match(content, /serve/);
  assert.match(content, /\.thumbgate\/runtime/);
}

function assertLocalMcpEntry(entry, expectedPath = MCP_SERVER_PATH) {
  assert.equal(entry.command, 'node');
  assert.deepEqual(entry.args, [expectedPath]);
}

function assertLocalTomlMcpBlock(content, expectedPath = MCP_SERVER_PATH) {
  assert.match(content, /\[mcp_servers\.thumbgate\]/);
  assert.match(content, /command = "node"/);
  assert.match(content, new RegExp(escapeRegExp(expectedPath)));
}

function assertLocalCodexPreToolHook(content) {
  assert.match(content, /\[hooks\.pre_tool_use\]/);
  assert.match(content, /command = "node"/);
  assert.match(content, new RegExp(escapeRegExp(path.join(PKG_ROOT, 'bin', 'cli.js'))));
  assert.match(content, /"gate-check"/);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeSequenceLog(feedbackDir, rows) {
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(
    path.join(feedbackDir, 'feedback-sequences.jsonl'),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
  );
}

function buildSequenceRows() {
  return [
    {
      timestamp: '2026-03-09T10:00:00.000Z',
      context: 'skipped verification and broke tests',
      targetTags: ['testing', 'verification'],
      skill: 'tdd',
      domain: 'testing',
      accepted: false,
      targetRisk: 1,
      targetReward: -1,
      filePathCount: 3,
      errorType: 'test-failure',
      rubric: {
        weightedScore: 0.2,
        failingCriteria: ['evidence'],
        failingGuardrails: ['verification'],
        judgeDisagreements: [],
      },
      features: {
        rewardSequence: [-1, -1, 1],
        recentTrend: -0.33,
        timeGaps: [5, 8, 13],
        actionPatterns: {
          patch: { positive: 1, negative: 3 },
        },
      },
    },
    {
      timestamp: '2026-03-09T10:05:00.000Z',
      context: 'unsafe patch with missing evidence',
      targetTags: ['security', 'verification'],
      skill: 'security-review',
      domain: 'security',
      accepted: false,
      targetRisk: 1,
      targetReward: -1,
      filePathCount: 4,
      errorType: 'unsafe-change',
      rubric: {
        weightedScore: 0.15,
        failingCriteria: ['safety'],
        failingGuardrails: ['verification'],
        judgeDisagreements: ['judge-1'],
      },
      features: {
        rewardSequence: [-1, -1, -1],
        recentTrend: -1,
        timeGaps: [4, 6, 9],
        actionPatterns: {
          patch: { positive: 0, negative: 4 },
        },
      },
    },
    {
      timestamp: '2026-03-09T10:10:00.000Z',
      context: 'regression shipped without proof',
      targetTags: ['debugging', 'verification'],
      skill: 'build-fix',
      domain: 'debugging',
      accepted: false,
      targetRisk: 1,
      targetReward: -1,
      filePathCount: 2,
      errorType: 'regression',
      rubric: {
        weightedScore: 0.25,
        failingCriteria: ['quality'],
        failingGuardrails: ['tests'],
        judgeDisagreements: [],
      },
      features: {
        rewardSequence: [1, -1, -1],
        recentTrend: -0.33,
        timeGaps: [7, 10, 14],
        actionPatterns: {
          patch: { positive: 1, negative: 2 },
        },
      },
    },
    {
      timestamp: '2026-03-09T10:20:00.000Z',
      context: 'verified fix with passing tests and evidence',
      targetTags: ['testing', 'evidence'],
      skill: 'tdd',
      domain: 'testing',
      accepted: true,
      targetRisk: 0,
      targetReward: 1,
      filePathCount: 1,
      errorType: null,
      rubric: {
        weightedScore: 0.92,
        failingCriteria: [],
        failingGuardrails: [],
        judgeDisagreements: [],
      },
      features: {
        rewardSequence: [1, 1, 1],
        recentTrend: 1,
        timeGaps: [12, 16, 18],
        actionPatterns: {
          patch: { positive: 4, negative: 0 },
        },
      },
    },
    {
      timestamp: '2026-03-09T10:30:00.000Z',
      context: 'successfully verified API change with proof',
      targetTags: ['api', 'verification'],
      skill: 'postman',
      domain: 'api-integration',
      accepted: true,
      targetRisk: 0,
      targetReward: 1,
      filePathCount: 2,
      errorType: null,
      rubric: {
        weightedScore: 0.88,
        failingCriteria: [],
        failingGuardrails: [],
        judgeDisagreements: [],
      },
      features: {
        rewardSequence: [1, 1, -1],
        recentTrend: 0.33,
        timeGaps: [11, 15, 21],
        actionPatterns: {
          patch: { positive: 3, negative: 1 },
        },
      },
    },
    {
      timestamp: '2026-03-09T10:40:00.000Z',
      context: 'fixed documentation issue and verified output',
      targetTags: ['documentation', 'evidence'],
      skill: 'writer-memory',
      domain: 'documentation',
      accepted: true,
      targetRisk: 0,
      targetReward: 1,
      filePathCount: 1,
      errorType: null,
      rubric: {
        weightedScore: 0.9,
        failingCriteria: [],
        failingGuardrails: [],
        judgeDisagreements: [],
      },
      features: {
        rewardSequence: [1, 1, 1],
        recentTrend: 1,
        timeGaps: [9, 14, 19],
        actionPatterns: {
          patch: { positive: 5, negative: 0 },
        },
      },
    },
  ];
}

function extractHttpUrls(text) {
  return Array.from(String(text || '').matchAll(/https:\/\/[^\s)]+/g), (match) => match[0]);
}

function frameMcpMessage(payload) {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function parseMcpMessage(buffer) {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd !== -1) {
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) return null;
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return null;
    return buffer.slice(bodyStart, bodyEnd).toString('utf8');
  }

  const newlineIndex = buffer.indexOf('\n');
  if (newlineIndex === -1) return null;
  const line = buffer.slice(0, newlineIndex).toString('utf8').trim();
  if (!line) return null;
  return line;
}

function runCliSync(args, options = {}) {
  const { env: optEnv, timeoutMs, ...restOptions } = options;
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs ?? 20000,
    killSignal: 'SIGKILL',
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    ...restOptions,
    // Default to a local stub so trackEvent DNS lookup never blocks test exit.
    // Tests that need a real or custom URL override it via options.env.
    env: { THUMBGATE_API_URL: 'http://127.0.0.1:1', ...process.env, ...optEnv },
  });
}

function unlicensedProEnv(homeDir, overrides = {}) {
  return {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    THUMBGATE_API_KEY: '',
    THUMBGATE_PRO_MODE: '',
    THUMBGATE_DEV_SECRET: '',
    THUMBGATE_DEV_BYPASS: '',
    THUMBGATE_DEV_KEY: '',
    // Use local stub so trackEvent doesn't block on DNS in sandboxed test environments
    THUMBGATE_API_URL: 'http://127.0.0.1:1',
    ...overrides,
  };
}

function runServeHandshake(sendRequest, options = {}) {
  const child = spawn(process.execPath, [CLI, 'serve'], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuffer = Buffer.alloc(0);
  let stderrBuffer = '';
  let settled = false;

  return new Promise((resolve, reject) => {
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

    // Full-suite coverage adds noticeable subprocess startup overhead here.
    const timer = setTimeout(() => {
      done(new Error(`MCP initialize timeout; stderr=${stderrBuffer}`));
    }, options.timeoutMs ?? 20000);

    child.on('error', (err) => {
      clearTimeout(timer);
      done(err);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      done(new Error(`serve exited early (code=${code}, signal=${signal}); stderr=${stderrBuffer}`));
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += String(chunk || '');
    });

    child.stdout.on('data', (chunk) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
      const body = parseMcpMessage(stdoutBuffer);
      if (!body) return;
      clearTimeout(timer);
      try {
          done(null, {
            response: JSON.parse(body),
            raw: stdoutBuffer.toString('utf8'),
          });
      } catch (err) {
        done(err);
      }
    });

    const init = {
      jsonrpc: '2.0',
      id: 99,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'cli-test', version: '1.0.0' },
      },
    };

    sendRequest(child.stdin, init);
  });
}

function runCliCommand(args, options = {}) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  return new Promise((resolve, reject) => {
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {
        // no-op
      }
      done(new Error(`CLI command timed out: ${args.join(' ')}`));
    }, options.timeoutMs ?? 10000);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      done(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      done(null, {
        status: code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

function waitForCliOutput(args, pattern, options = {}) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let settled = false;
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(String(pattern));

  return new Promise((resolve, reject) => {
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
      done(new Error(`CLI output timed out: ${args.join(' ')}\nstdout=${stdout}\nstderr=${stderr}`));
    }, options.timeoutMs ?? 15000);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
      if (matcher.test(stdout)) {
        clearTimeout(timer);
        done(null, { stdout, stderr });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      done(err);
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      clearTimeout(timer);
      done(new Error(`CLI exited early (code=${code}, signal=${signal})\nstdout=${stdout}\nstderr=${stderr}`));
    });
  });
}

describe('bin/cli.js', () => {
  let tmpDir;
  let defaultLedgerPath;
  let testHomeDir;

  before(() => {
    tmpDir = makeTmpDir();
    defaultLedgerPath = path.join(tmpDir, 'default-funnel-events.jsonl');
    testHomeDir = makeTmpDir();
    process.env._TEST_FUNNEL_LEDGER_PATH = defaultLedgerPath;
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
    process.env.STRIPE_SECRET_KEY = '';
    process.env.STRIPE_PRICE_ID = '';
    process.env.THUMBGATE_PUBLISH_STATE = 'published';
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(testHomeDir, { recursive: true, force: true });
    if (savedFunnelPath === undefined) {
      delete process.env._TEST_FUNNEL_LEDGER_PATH;
    } else {
      process.env._TEST_FUNNEL_LEDGER_PATH = savedFunnelPath;
    }
    if (savedHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = savedHome;
    }
    if (savedUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = savedUserProfile;
    }
    if (savedStripeSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = savedStripeSecretKey;
    }
    if (savedStripePriceId === undefined) {
      delete process.env.STRIPE_PRICE_ID;
    } else {
      process.env.STRIPE_PRICE_ID = savedStripePriceId;
    }
    if (savedPublishState === undefined) {
      delete process.env.THUMBGATE_PUBLISH_STATE;
    } else {
      process.env.THUMBGATE_PUBLISH_STATE = savedPublishState;
    }
  });

  test('CLI file exists and is executable', () => {
    assert.ok(fs.existsSync(CLI), `CLI not found at ${CLI}`);
    const stat = fs.statSync(CLI);
    assert.ok(stat.mode & 0o100, 'CLI should have executable bit set');
  });

  test('help command exits 0 and shows curated short surface', () => {
    const result = runCliSync(['help']);
    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.ok(result.stdout.includes('thumbgate'), 'Help should include CLI name');
    // Core commands a first-time user should see immediately.
    for (const cmd of ['init', 'capture', 'stats', 'lessons', 'explore', 'dashboard', 'doctor', 'pro']) {
      assert.ok(result.stdout.includes(cmd), `Default help should mention ${cmd}`);
    }
    // Hint to discover the rest, instead of dumping ~70 commands.
    assert.ok(result.stdout.includes('help all'), 'Default help should point at `thumbgate help all`');
    // Short surface should NOT include the deep-niche commands that previously
    // dominated the wall of text — those live behind `help all` now.
    assert.ok(!result.stdout.includes('proactive-agent-eval-guardrails'),
      'Default help should not include deep-niche subcommands');
    assert.ok(!result.stdout.includes('repair-github-marketplace'),
      'Default help should not include legacy/specialist subcommands');
  });

  test('help all exits 0 and lists the full subcommand surface', () => {
    const result = runCliSync(['help', 'all']);
    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.ok(result.stdout.includes('thumbgate'), 'Help should include CLI name');
    // Every previously-asserted subcommand must still be discoverable via `help all`.
    const expected = [
      'init', 'capture', 'cfo', 'repair-github-marketplace', 'model-fit',
      'gemini-embedding-plan', 'agent-design-governance',
      'proactive-agent-eval-guardrails', 'reward-hacking-guardrails',
      'oss-pr-opportunity-scout', 'chatgpt-ads-readiness-pack',
      'model-candidates', 'upstream-contributions',
      'deepseek-v4-runtime-guardrails', 'risk', 'export-dpo',
      'export-databricks', 'lessons', 'stats', 'north-star', 'eval',
      'rules', 'self-heal', 'prove', 'doctor', 'dispatch',
      'background-governance', 'analytics', 'gate-check', 'statusline-render',
    ];
    for (const cmd of expected) {
      assert.ok(result.stdout.includes(cmd), `\`help all\` should mention ${cmd}`);
    }
  });

  test('eval command turns local feedback into reusable proof JSON', () => {
    const feedbackDir = makeTmpDir();
    fs.writeFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), `${JSON.stringify({
      id: 'fb_cli_eval_1',
      signal: 'down',
      context: 'Skipped checkout verification and claimed the fix was live',
      whatWentWrong: 'Reported completion before running focused tests',
      whatToChange: 'Run focused verification before claiming completion',
      tags: ['verification'],
    })}\n`);

    const result = runCliSync(['eval', '--from-feedback', '--json', '--min-score=0'], {
      env: {
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_NO_NUDGE: '1',
      },
    });

    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.feedbackDerived, true);
    assert.equal(payload.suiteDefinition.source.selectedCases, 1);
    assert.equal(payload.total, 1);

    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });

  test('gate-check allows ordinary edits when no task scope is declared', () => {
    const feedbackDir = makeTmpDir();
    const result = runCliSync(['gate-check'], {
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
      },
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: '/project/src/app.js' },
      }),
    });
    assert.equal(result.status, 0, `gate-check failed:\n${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), {});
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });

  test('gate-check blocks high-risk git writes without task scope', () => {
    const feedbackDir = makeTmpDir();
    const result = runCliSync(['gate-check'], {
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
      },
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: {
          command: 'git push origin feature/x',
          changed_files: ['src/app.js'],
        },
      }),
    });
    assert.equal(result.status, 0, `gate-check failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(payload.hookSpecificOutput.permissionDecisionReason, /task-scope-required/);
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });

  test('hook-auto-capture records the user prompt and refreshes statusline counts', () => {
    const feedbackDir = makeTmpDir();
    const result = runCliSync(['hook-auto-capture'], {
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        CLAUDE_USER_PROMPT: 'thumbs up Thorough PR review',
        THUMBGATE_NO_NUDGE: '1',
      },
    });

    assert.equal(result.status, 0, `hook-auto-capture failed:\n${result.stderr}`);
    const conversationPath = path.join(feedbackDir, 'conversation-window.jsonl');
    const cachePath = path.join(feedbackDir, 'statusline_cache.json');
    assert.ok(fs.existsSync(conversationPath), 'conversation history should be recorded');
    assert.ok(fs.existsSync(cachePath), 'statusline cache should be refreshed');

    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.equal(cache.thumbs_up, '1');
    assert.equal(cache.total_feedback, '1');

    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });

  test('hook-auto-capture renders thumbs down for down feedback', () => {
    const feedbackDir = makeTmpDir();
    const result = runCliSync(['hook-auto-capture'], {
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        CLAUDE_USER_PROMPT: 'thumbs down This response skipped the required verification',
        THUMBGATE_NO_NUDGE: '1',
      },
    });

    assert.equal(result.status, 0, `hook-auto-capture failed:\n${result.stderr}`);
    assert.match(result.stdout, /Thumbs down recorded/);
    assert.doesNotMatch(result.stdout, /Thumbs up recorded/);

    const cache = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'statusline_cache.json'), 'utf8'));
    assert.equal(cache.thumbs_down, '1');
    assert.equal(cache.total_feedback, '1');
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });

  test('statusline-render syncs missed Claude feedback even when the cache is still fresh', () => {
    const projectDir = makeTmpDir();
    const feedbackDir = path.join(projectDir, '.thumbgate');
    const homeDir = makeTmpDir();
    const historyPath = path.join(homeDir, '.claude', 'history.jsonl');

    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(
      historyPath,
      `${JSON.stringify({
        display: 'thumbs down',
        timestamp: 1775750156301,
        project: projectDir,
        sessionId: 'session-1',
      })}\n`
    );
    fs.writeFileSync(
      path.join(feedbackDir, 'feedback-log.jsonl'),
      `${JSON.stringify({
        id: 'fb_seed_positive',
        signal: 'positive',
        context: 'thumbs up Thorough PR review',
        submittedContext: 'thumbs up Thorough PR review',
        whatWorked: 'thumbs up Thorough PR review',
        actionType: 'store-learning',
        timestamp: '2026-04-09T15:07:34.046Z',
      })}\n`
    );
    fs.writeFileSync(
      path.join(feedbackDir, 'statusline_cache.json'),
      JSON.stringify({
        thumbs_up: '1',
        thumbs_down: '0',
        lessons: '0',
        trend: 'stable',
        updated_at: String(Math.floor(Date.now() / 1000)),
      })
    );

    const result = runCliSync(['statusline-render'], {
      input: JSON.stringify({ context_window: { used_percentage: 10 } }),
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_PROJECT_DIR: projectDir,
        THUMBGATE_CLAUDE_HISTORY_PATH: historyPath,
        THUMBGATE_NO_NUDGE: '1',
      },
    });

    assert.equal(result.status, 0, `statusline-render failed:\n${result.stderr}`);
    const cache = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'statusline_cache.json'), 'utf8'));
    assert.equal(cache.thumbs_up, '1');
    assert.equal(cache.thumbs_down, '1');

    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  test('session-start refreshes the statusline cache from missed Claude feedback', () => {
    const projectDir = makeTmpDir();
    const feedbackDir = path.join(projectDir, '.thumbgate');
    const homeDir = makeTmpDir();
    const historyPath = path.join(homeDir, '.claude', 'history.jsonl');

    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(
      historyPath,
      `${JSON.stringify({
        display: 'thumbs up Thorough PR review',
        timestamp: 1775750158301,
        project: projectDir,
        sessionId: 'session-2',
      })}\n`
    );

    const result = runCliSync(['session-start'], {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_PROJECT_DIR: projectDir,
        THUMBGATE_CLAUDE_HISTORY_PATH: historyPath,
        THUMBGATE_NO_NUDGE: '1',
      },
    });

    assert.equal(result.status, 0, `session-start failed:\n${result.stderr}`);
    const cache = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'statusline_cache.json'), 'utf8'));
    assert.equal(cache.thumbs_up, '1');
    assert.equal(cache.total_feedback, '1');

    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  test('pro command prints truthful local-first Pro offer info when unlicensed', () => {
    const result = runCliSync(['pro'], {
      env: unlicensedProEnv(testHomeDir),
    });
    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.match(result.stdout, /Pro \(\$19\/mo or \$149\/yr\)/);
    assert.match(result.stdout, /personal local dashboard/i);
    assert.match(result.stdout, /Launch dashboard\s*:\s*npx thumbgate pro/);
    assert.match(result.stdout, /Activate \+ run\s*:\s*npx thumbgate pro --activate --key=YOUR_KEY/);
    assert.match(result.stdout, /COMMERCIAL_TRUTH\.md/);
    assert.doesNotMatch(result.stdout, /\$10\/mo|38 spots remaining|first 50 users|Founding Member/i);
  });

  test('pro --upgrade installs the shipped public Pro config bundle', () => {
    const homeDir = makeTmpDir();
    const projectDir = makeTmpDir();

    const result = runCliSync(['pro', '--upgrade'], {
      cwd: projectDir,
      env: unlicensedProEnv(homeDir, {
        THUMBGATE_NO_NUDGE: '1',
      }),
    });

    assert.equal(result.status, 0, `pro --upgrade failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /Pro configs installed to \.thumbgate/);
    assert.doesNotMatch(result.stderr, /ENOENT|constraints-pro\.json/);

    const thumbgateDir = path.join(projectDir, '.thumbgate');
    for (const fileName of [
      'constraints-pro.json',
      'prevention-rules-pro.md',
      'thompson-presets.json',
      'reminders-pro.json',
    ]) {
      assert.ok(
        fs.existsSync(path.join(thumbgateDir, fileName)),
        `${fileName} should be installed into the project .thumbgate directory`,
      );
    }

    const constraints = JSON.parse(fs.readFileSync(path.join(thumbgateDir, 'constraints-pro.json'), 'utf8'));
    assert.ok(
      constraints.constraints.length >= 10,
      'Pro constraints bundle should include the advertised 10 local constraints',
    );

    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  test('pro command launches local dashboard when a license is already saved', async () => {
    const homeDir = makeTmpDir();
    const licenseDir = path.join(homeDir, '.thumbgate');
    fs.mkdirSync(licenseDir, { recursive: true });
    fs.writeFileSync(
      path.join(licenseDir, 'license.json'),
      JSON.stringify({ key: 'tg_local_dashboard_launch' }, null, 2)
    );

    const result = await waitForCliOutput(['pro'], /ThumbGate Pro dashboard: http:\/\/localhost:\d+\/dashboard/, {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_API_KEY: '',
        THUMBGATE_PRO_MODE: '',
        PORT: '0',
      },
    });

    assert.match(result.stdout, /ThumbGate Pro dashboard: http:\/\/localhost:\d+\/dashboard/);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  test('pro --info prints local-first offer info even when a license is already saved', () => {
    const homeDir = makeTmpDir();
    const licenseDir = path.join(homeDir, '.thumbgate');
    fs.mkdirSync(licenseDir, { recursive: true });
    fs.writeFileSync(
      path.join(licenseDir, 'license.json'),
      JSON.stringify({ key: 'tg_info_only' }, null, 2)
    );

    const result = runCliSync(['pro', '--info'], {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        THUMBGATE_NO_NUDGE: '1',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ThumbGate Pro — Local Dashboard/);
    assert.doesNotMatch(result.stdout, /ThumbGate Pro dashboard: http:\/\/localhost:/);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  test('sync --push sends local lessons to the configured Pro API with bearer auth', async () => {
    const homeDir = makeTmpDir();
    const feedbackDir = makeTmpDir();
    fs.mkdirSync(path.join(homeDir, '.thumbgate'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.thumbgate', 'license.json'),
      JSON.stringify({ key: 'tg_sync_cli_key' }, null, 2)
    );
    fs.writeFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), `${JSON.stringify({
      id: 'fb_cli_sync',
      signal: 'down',
      title: 'Sync proof before marketing claims',
      context: 'Claim needed implementation proof',
      whatToChange: 'Run the sync command against the Pro API',
      timestamp: '2026-05-26T12:30:00.000Z',
    })}\n`);

    let captured = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        captured = {
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: JSON.parse(body || '{}'),
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, imported: 1, skippedDuplicate: 0, status: { lessonCount: 1 } }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, 'sync', '--push'], {
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            THUMBGATE_FEEDBACK_DIR: feedbackDir,
            THUMBGATE_API_KEY: '',
            THUMBGATE_API_BASE_URL: `http://127.0.0.1:${port}`,
            THUMBGATE_NO_NUDGE: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`sync command timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }, 5000);
        child.stdout.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('exit', (status) => {
          clearTimeout(timer);
          resolve({ status, stdout, stderr });
        });
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Pushed 1 local lesson/);
      assert.equal(captured.method, 'POST');
      assert.equal(captured.url, '/v1/sync/push');
      assert.equal(captured.authorization, 'Bearer tg_sync_cli_key');
      assert.equal(captured.body.bundle.lessonCount, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(feedbackDir, { recursive: true, force: true });
    }
  });

  test('lessons command prints linked corrective actions', () => {
    const feedbackDir = makeTmpDir();
    fs.writeFileSync(
      path.join(feedbackDir, 'feedback-log.jsonl'),
      `${JSON.stringify({
        id: 'fb_cli_lesson',
        signal: 'negative',
        context: 'Skipped proof before release',
        tags: ['release', 'verification'],
        timestamp: '2026-03-23T17:00:00.000Z',
      })}\n`
    );
    fs.writeFileSync(
      path.join(feedbackDir, 'memory-log.jsonl'),
      `${JSON.stringify({
        id: 'mem_cli_lesson',
        title: 'MISTAKE: Skipped proof before release',
        content: 'What went wrong: Skipped proof before release\nHow to avoid: Attach proof before shipping',
        category: 'error',
        importance: 'high',
        tags: ['feedback', 'negative', 'release', 'verification'],
        sourceFeedbackId: 'fb_cli_lesson',
        timestamp: '2026-03-23T17:00:01.000Z',
      })}\n`
    );
    fs.writeFileSync(path.join(feedbackDir, 'prevention-rules.md'), '# Shipping proof\nAttach proof before shipping.\n');
    fs.writeFileSync(path.join(feedbackDir, 'auto-promoted-gates.json'), JSON.stringify({
      version: 1,
      gates: [{
        id: 'auto-cli-proof',
        action: 'warn',
        pattern: 'release+verification',
        message: 'Warn when proof is missing before shipping',
        occurrences: 3,
        promotedAt: '2026-03-23T17:10:00.000Z',
      }],
      promotionLog: [],
    }, null, 2));

    const result = runCliSync(['lessons', '--query=shipping'], {
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_API_KEY: 'tg_pro_test_lesson_search',
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_API_URL: 'http://127.0.0.1:1',
      },
    });

    assert.strictEqual(result.status, 0, `lessons command failed:\n${result.stderr}`);
    assert.match(result.stdout, /Lesson Search/);
    assert.match(result.stdout, /Corrective actions/);
    assert.match(result.stdout, /Harness recommendations/);
    assert.match(result.stdout, /Attach proof before shipping/);
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });

  test('lessons command blocks free users with a Pro upgrade prompt', () => {
    const feedbackDir = makeTmpDir();
    const freeHome = makeTmpDir();
    const result = runCliSync(['lessons', '--query=shipping'], {
      env: unlicensedProEnv(freeHome, {
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_NO_NUDGE: '',
        THUMBGATE_NO_TRIAL: '1',
      }),
    });

    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Lesson search is a Pro feature/);
    assert.match(result.stderr, /thumbgate\.ai\/go\/pro/);
    assert.match(result.stderr, /utm_source=cli_limit/);
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    fs.rmSync(freeHome, { recursive: true, force: true });
  });

  test('help command shows Pro nudge on stderr', () => {
    // proNudge gates on isProTier(); CI sets THUMBGATE_API_KEY at the workflow
    // level, so we must build an explicitly-unlicensed env to exercise the
    // unlicensed code path. Otherwise this test silently asserts on the wrong
    // branch (it was the inverse bug to ProNudge skipping isProTier — fixed
    // together with that nudge gate).
    const result = runCliSync(['help'], {
      env: unlicensedProEnv(testHomeDir, { THUMBGATE_NO_NUDGE: '' }),
    });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stderr.includes('Pro'), 'Pro nudge should appear on stderr');
  });

  test('THUMBGATE_NO_NUDGE=1 suppresses Pro nudge', () => {
    const result = runCliSync(['help'], {
      env: unlicensedProEnv(testHomeDir, { THUMBGATE_NO_NUDGE: '1' }),
    });
    assert.strictEqual(result.status, 0);
    assert.ok(!result.stderr.includes('Pro'), 'Pro nudge should be suppressed when THUMBGATE_NO_NUDGE=1');
  });

  test('Pro nudge is suppressed when env signals a Pro tier', () => {
    // Regression: pre-2026-05-18 proNudge ignored isProTier() entirely, so it
    // nagged paying customers on every stats/lessons/summary/help call. After
    // the fix, an explicit Pro signal (any of THUMBGATE_API_KEY, _PRO_MODE,
    // _NO_RATE_LIMIT, or a creator-dev install) must suppress the nudge.
    const result = runCliSync(['help'], {
      env: unlicensedProEnv(testHomeDir, {
        THUMBGATE_API_KEY: 'tg_pro_test_paid_customer',
        THUMBGATE_NO_NUDGE: '',
      }),
    });
    assert.strictEqual(result.status, 0);
    assert.ok(
      !result.stderr.includes('💡 ThumbGate Pro') && !result.stderr.includes('💡 Unlock Pro') && !result.stderr.includes('💡 Pro tip'),
      `Pro nudge must be suppressed for Pro-tier env; got stderr:\n${result.stderr}`,
    );
  });

  test('pro command includes hosted link', () => {
    const result = runCliSync(['pro'], {
      env: unlicensedProEnv(testHomeDir),
    });
    assert.strictEqual(result.status, 0);
    const expectedHost = new URL(PRO_MONTHLY_PAYMENT_LINK).host;
    const checkoutUrl = extractHttpUrls(result.stdout).find((candidate) => {
      try { return new URL(candidate).host === expectedHost; } catch { return false; }
    });
    assert.equal(checkoutUrl, PRO_MONTHLY_PAYMENT_LINK, 'Pro command should include the attributed Pro checkout URL');
    assert.ok(result.stdout.includes('$19/mo or $149/yr'), 'Pro command should include current pricing');
    assert.ok(result.stdout.includes('Launch dashboard: npx thumbgate pro'), 'Pro command should include the local dashboard launcher');
    assert.ok(result.stdout.includes('Private core    : ThumbGate-Core (private repo)'), 'Pro command should describe the current private-core split');
  });

  test('THUMBGATE_NO_TELEMETRY=1 prevents telemetry ping on init', () => {
    const initDir = makeTmpDir();
    const result = runCliSync(['init'], {
      cwd: initDir,
      env: {
        ...process.env,
        THUMBGATE_NO_TELEMETRY: '1',
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_API_URL: 'http://127.0.0.1:1',
        HOME: testHomeDir,
        USERPROFILE: testHomeDir,
      },
    });
    assert.strictEqual(result.status, 0, `init should succeed even with telemetry disabled: ${result.stderr}`);
    fs.rmSync(initDir, { recursive: true, force: true });
  });

  test('init --help prints usage without creating project files', () => {
    const initDir = makeTmpDir();
    const result = runCliSync(['init', '--help'], {
      cwd: initDir,
      env: {
        ...process.env,
        THUMBGATE_NO_TELEMETRY: '1',
        THUMBGATE_NO_NUDGE: '1',
        HOME: testHomeDir,
        USERPROFILE: testHomeDir,
      },
    });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /Usage: npx thumbgate init/);
    assert.equal(fs.existsSync(path.join(initDir, '.thumbgate')), false, 'init --help must not scaffold .thumbgate');
    assert.equal(fs.existsSync(path.join(initDir, '.mcp.json')), false, 'init --help must not write MCP config');
    fs.rmSync(initDir, { recursive: true, force: true });
  });

  test('init prints onboarding, trial deadline, and checkout path', () => {
    const initDir = makeTmpDir();
    const homeDir = makeTmpDir();
    const result = runCliSync(['init'], {
      cwd: initDir,
      env: unlicensedProEnv(homeDir, {
        THUMBGATE_NO_TELEMETRY: '1',
        THUMBGATE_NO_NUDGE: '',
      }),
    });
    assert.strictEqual(result.status, 0, `init should succeed: ${result.stderr}`);
    assert.match(result.stdout, /npx thumbgate init --email you@company\.com/);
    assert.match(result.stdout, /14-day Pro trial active through \d{4}-\d{2}-\d{2}/);
    assert.match(result.stdout, /utm_source=cli_init/);
    fs.rmSync(initDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  test('init --email posts installer email to onboarding endpoint', async () => {
    const initDir = makeTmpDir();
    const homeDir = makeTmpDir();
    let captured = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += String(chunk || ''); });
      req.on('end', () => {
        captured = {
          method: req.method,
          url: req.url,
          body: JSON.parse(body || '{}'),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const result = await runCliCommand(['init', '--email', 'buyer@example.com'], {
        cwd: initDir,
        env: unlicensedProEnv(homeDir, {
          THUMBGATE_NO_TELEMETRY: '1',
          THUMBGATE_NO_NUDGE: '1',
          THUMBGATE_INSTALL_EMAIL_ENDPOINT: `http://127.0.0.1:${port}/v1/marketing/install-email`,
        }),
        timeoutMs: 15000,
      });
      assert.strictEqual(result.status, 0, `init --email should succeed:\nstdout=${result.stdout}\nstderr=${result.stderr}`);
      assert.equal(captured.method, 'POST');
      assert.equal(captured.url, '/v1/marketing/install-email');
      assert.equal(captured.body.email, 'buyer@example.com');
      assert.equal(captured.body.source, 'cli_subscribe');
      assert.equal(captured.body.cliVersion, PKG_VERSION);
      assert.ok(captured.body.installId, 'installId should connect the email to the init event');
      assert.match(result.stdout, /Subscribed buyer@example\.com/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(initDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test('init records local CLI telemetry when telemetry is enabled', () => {
    const initDir = makeTmpDir();
    const feedbackDir = path.join(initDir, '.thumbgate');
    const telemetryPath = path.join(feedbackDir, 'telemetry-pings.jsonl');
    const result = runCliSync(['init'], {
      cwd: initDir,
      env: {
        ...process.env,
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_API_URL: 'http://127.0.0.1:1',
        HOME: testHomeDir,
        USERPROFILE: testHomeDir,
      },
    });
    assert.strictEqual(result.status, 0, `init should succeed with local telemetry enabled: ${result.stderr}`);
    assert.ok(fs.existsSync(telemetryPath), 'telemetry-pings.jsonl should be created');
    const entries = fs.readFileSync(telemetryPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const initEntry = entries.find((entry) => entry.eventType === 'cli_init');
    assert.ok(initEntry, 'expected cli_init telemetry entry');
    assert.equal(initEntry.clientType, 'cli');
    fs.rmSync(initDir, { recursive: true, force: true });
  });

  test('--help flag exits 0', () => {
    const result = runCliSync(['--help']);
    assert.strictEqual(result.status, 0);
  });

  test('no-arg invocation exits 0 with help', () => {
    const result = runCliSync([]);
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('init'), 'No-arg output should mention init');
  });

  test('unknown command exits 1', () => {
    const result = runCliSync(['unknown-xyz']);
    assert.strictEqual(result.status, 1, `Expected exit 1, got ${result.status}`);
  });

  test('doctor --json reports readiness for a bootstrapped project', () => {
    const doctorDir = makeTmpDir();
    fs.writeFileSync(path.join(doctorDir, 'AGENTS.md'), '# Agents\n');
    fs.writeFileSync(path.join(doctorDir, 'CLAUDE.md'), '# Claude\n');
    fs.writeFileSync(path.join(doctorDir, 'GEMINI.md'), '# Gemini\n');
    fs.writeFileSync(path.join(doctorDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
    fs.mkdirSync(path.join(doctorDir, '.thumbgate'), { recursive: true });
    fs.writeFileSync(
      path.join(doctorDir, '.thumbgate', 'config.json'),
      JSON.stringify({ version: 1 }, null, 2)
    );

    const result = runCliSync(['doctor', '--json'], {
      cwd: doctorDir,
      env: {
        ...process.env,
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_MCP_PROFILE: 'default',
        container: '1',
      },
    });

    assert.strictEqual(result.status, 0, `doctor failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.overallStatus, 'ready');
    assert.equal(payload.runtime.mode, 'container');
    assert.equal(payload.permissions.profile, 'default');
    assert.equal(payload.permissions.tier, 'builder');
    assert.equal(payload.permissions.writeCapable, true);
    assert.equal(payload.bootstrap.ready, true);
    assert.equal(payload.articleAlignment.runtimeIsolation, true);
    assert.equal(payload.articleAlignment.contextConditioning, true);
    assert.equal(payload.articleAlignment.permissionEnvelope, true);

    fs.rmSync(doctorDir, { recursive: true, force: true });
  });

  test('native-messaging-audit --json reports dormant AI browser bridges', () => {
    const homeDir = makeTmpDir();
    const manifestDir = path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
    const hostDir = path.join(homeDir, 'Library', 'Application Support', 'Claude');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.mkdirSync(hostDir, { recursive: true });
    const hostPath = path.join(hostDir, 'claude-native-host');
    fs.writeFileSync(hostPath, '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(path.join(manifestDir, 'com.anthropic.claude_browser_extension.json'), JSON.stringify({
      name: 'com.anthropic.claude_browser_extension',
      path: hostPath,
      type: 'stdio',
      allowed_origins: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/'],
    }, null, 2));

    const result = runCliSync(['native-messaging-audit', '--json', '--platform=darwin', `--home-dir=${homeDir}`], {
      env: {
        ...process.env,
        THUMBGATE_NO_NUDGE: '1',
      },
    });

    assert.strictEqual(result.status, 0, `native-messaging-audit failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.name, 'thumbgate-native-messaging-audit');
    assert.equal(payload.summary.manifestCount, 1);
    assert.ok(payload.findings.some((finding) => finding.code === 'dormant_ai_browser_bridge'));

    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  test('background-governance --json reports background-agent run metrics', () => {
    const feedbackDir = makeTmpDir();
    fs.writeFileSync(path.join(feedbackDir, 'agent-runs.jsonl'), [
      JSON.stringify({
        id: 'run_cli_1',
        timestamp: new Date().toISOString(),
        agentId: 'builder',
        runType: 'pr',
        source: 'background',
        status: 'completed',
        gatesChecked: 3,
        gatesBlocked: 1,
        filesChanged: 4,
        ciPassed: true,
      }),
    ].join('\n') + '\n');

    const result = runCliSync(['background-governance', '--json', `--feedback-dir=${feedbackDir}`], {
      env: { THUMBGATE_NO_NUDGE: '1' },
    });

    assert.strictEqual(result.status, 0, `background-governance failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, 'background_agent_governance_report');
    assert.equal(payload.total, 1);
    assert.equal(payload.gatesBlocked, 1);
    assert.ok(payload.agents.some((agent) => agent.agentId === 'builder'));

    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });

  test('background-governance --check --json emits dispatch risk verdict', () => {
    const feedbackDir = makeTmpDir();
    const result = runCliSync([
      'background-governance',
      '--check',
      '--json',
      '--agent-id=builder',
      '--branch=main',
      '--files-changed=25',
      `--feedback-dir=${feedbackDir}`,
    ], {
      env: { THUMBGATE_NO_NUDGE: '1' },
    });

    assert.strictEqual(result.status, 0, `background-governance check failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, 'background_agent_governance_check');
    assert.equal(payload.allowed, true);
    assert.ok(payload.warnings.some((warning) => warning.rule === 'protected_branch'));
    assert.ok(payload.warnings.some((warning) => warning.rule === 'large_blast_radius'));

    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });

  test('code-graph-guardrails --json recommends graph-informed gates', () => {
    const result = runCliSync([
      'code-graph-guardrails',
      '--json',
      '--central-files=src/api/server.js',
      '--layers=api,data',
      '--generated-artifacts=.codegraph/index.json',
      '--changed-files=24',
    ], {
      env: { THUMBGATE_NO_NUDGE: '1' },
    });

    assert.strictEqual(result.status, 0, `code-graph-guardrails failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.name, 'thumbgate-code-graph-guardrails');
    assert.equal(payload.summary.recommendedTemplateCount, 3);
    assert.ok(payload.signals.some((signal) => signal.id === 'large_blast_radius'));
  });

  test('dispatch --json emits a phone-safe remote ops brief', () => {
    const isolatedDir = makeTmpDir();
    const feedbackDir = path.join(isolatedDir, 'feedback');
    const apiKeysPath = path.join(isolatedDir, 'api-keys.json');
    const ledgerPath = path.join(isolatedDir, 'funnel-events.jsonl');
    const revenuePath = path.join(isolatedDir, 'revenue-events.jsonl');
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(apiKeysPath, JSON.stringify({ keys: {} }, null, 2));
    fs.writeFileSync(ledgerPath, `${JSON.stringify({
      timestamp: '2026-03-20T12:00:00.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      visitorId: 'visitor_dispatch_1',
      metadata: {},
    })}\n`);
    fs.writeFileSync(revenuePath, `${JSON.stringify({
      timestamp: '2026-03-20T12:15:00.000Z',
      provider: 'stripe',
      event: 'stripe_checkout_completed',
      status: 'paid',
      orderId: 'cs_dispatch_1',
      amountCents: 4900,
      currency: 'USD',
      amountKnown: true,
      attribution: {},
      metadata: {},
    })}\n`);

    const result = runCliSync(['dispatch', '--json'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_METRICS_SOURCE: 'local',
        THUMBGATE_MCP_PROFILE: 'dispatch',
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        _TEST_API_KEYS_PATH: apiKeysPath,
        _TEST_FUNNEL_LEDGER_PATH: ledgerPath,
        _TEST_REVENUE_LEDGER_PATH: revenuePath,
      },
    });

    assert.equal(result.status, 0, `dispatch failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.profile, 'dispatch');
    assert.equal(payload.tier, 'dispatch');
    assert.equal(payload.writeCapable, false);
    assert.equal(payload.metrics.bookedRevenueUsd, 49);
    assert.ok(payload.allowedTasks.some((task) => task.tool === 'dashboard'));
    assert.ok(payload.blockedTasks.some((task) => /handoffs/i.test(task)));

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('cfo emits local operational billing summary JSON when hosted summary is not configured', () => {
    const isolatedDir = makeTmpDir();
    const apiKeysPath = path.join(isolatedDir, 'api-keys.json');
    const ledgerPath = path.join(isolatedDir, 'funnel-events.jsonl');
    const revenuePath = path.join(isolatedDir, 'revenue-events.jsonl');
    const feedbackDir = path.join(isolatedDir, 'feedback');
    const leadsPath = path.join(feedbackDir, 'workflow-sprint-leads.jsonl');
    fs.writeFileSync(apiKeysPath, JSON.stringify({
      keys: {
        thumbgate_active_cli: {
          customerId: 'cus_cli_summary',
          active: true,
          usageCount: 3,
          createdAt: '2026-03-12T00:00:00.000Z',
          installId: 'inst_cli_summary',
          source: 'stripe_webhook_checkout_completed',
        },
        thumbgate_disabled_cli: {
          customerId: 'cus_cli_disabled',
          active: false,
          usageCount: 0,
          createdAt: '2026-03-12T00:05:00.000Z',
          disabledAt: '2026-03-12T00:10:00.000Z',
          source: 'github_marketplace_purchased',
        },
      },
    }, null, 2));
    fs.writeFileSync(ledgerPath, [
      JSON.stringify({
        timestamp: '2026-03-12T00:00:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_cli_summary',
        installId: 'inst_cli_summary',
        traceId: 'trace_cli_summary',
        metadata: { customerId: 'cus_cli_summary' },
      }),
      JSON.stringify({
        timestamp: '2026-03-12T00:15:00.000Z',
        stage: 'paid',
        event: 'stripe_checkout_completed',
        evidence: 'cs_cli_summary',
        installId: 'inst_cli_summary',
        traceId: 'trace_cli_summary',
        metadata: { customerId: 'cus_cli_summary' },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(revenuePath, [
      JSON.stringify({
        timestamp: '2026-03-12T00:15:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_cli_summary',
        evidence: 'cs_cli_summary',
        customerId: 'cus_cli_summary',
        installId: 'inst_cli_summary',
        traceId: 'trace_cli_summary',
        amountCents: 4900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: {
          source: 'website',
          campaign: 'pro_pack',
        },
        metadata: {},
      }),
      '',
    ].join('\n'));
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(leadsPath, [
      JSON.stringify({
        leadId: 'lead_cli_summary',
        submittedAt: '2026-03-12T01:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'founder@example.com',
          company: 'Example Co',
        },
        qualification: {
          workflow: 'Claude code review approvals',
          owner: 'CEO',
          blocker: 'Team cannot prove rollout safety',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'x',
          utmSource: 'x',
          utmCampaign: 'workflow_hardening',
          community: 'founders',
        },
      }),
      '',
    ].join('\n'));

    const result = runCliSync(['cfo'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_METRICS_SOURCE: 'local',
        _TEST_API_KEYS_PATH: apiKeysPath,
        _TEST_FUNNEL_LEDGER_PATH: ledgerPath,
        _TEST_REVENUE_LEDGER_PATH: revenuePath,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
      },
    });
    assert.equal(result.status, 0, `cfo failed:\n${result.stderr}`);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.source, 'local');
    assert.ok(payload.fallbackReason);
    assert.equal(payload.summary.coverage.source, 'funnel_ledger+revenue_ledger+key_store+workflow_sprint_leads');
    assert.equal(payload.summary.keys.active, 1);
    assert.equal(payload.summary.keys.bySource.stripe_webhook_checkout_completed, 1);
    assert.equal(payload.summary.keys.bySource.github_marketplace_purchased, 1);
    assert.equal(payload.summary.funnel.stageCounts.paid, 1);
    assert.equal(payload.summary.revenue.bookedRevenueCents, 4900);
    assert.equal(payload.summary.revenue.paidOrders, 1);
    assert.equal(payload.summary.revenue.paidProviderEvents, 1);
    assert.equal(payload.summary.pipeline.workflowSprintLeads.total, 1);
    assert.equal(payload.summary.pipeline.workflowSprintLeads.bySource.x, 1);
    assert.equal(payload.summary.pipeline.qualifiedWorkflowSprintLeads.total, 1);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('cfo supports today window and timezone arguments', () => {
    const isolatedDir = makeTmpDir();
    const apiKeysPath = path.join(isolatedDir, 'api-keys.json');
    const ledgerPath = path.join(isolatedDir, 'funnel-events.jsonl');
    const revenuePath = path.join(isolatedDir, 'revenue-events.jsonl');
    const feedbackDir = path.join(isolatedDir, 'feedback');
    const leadsPath = path.join(feedbackDir, 'workflow-sprint-leads.jsonl');
    fs.writeFileSync(apiKeysPath, JSON.stringify({ keys: {} }, null, 2));
    fs.writeFileSync(ledgerPath, [
      JSON.stringify({
        timestamp: '2026-03-18T23:30:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_cli_old',
        traceId: 'trace_cli_old',
      }),
      JSON.stringify({
        timestamp: '2026-03-19T12:00:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_cli_today',
        traceId: 'trace_cli_today',
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(revenuePath, [
      JSON.stringify({
        timestamp: '2026-03-18T23:45:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_cli_old',
        evidence: 'cs_cli_old',
        customerId: 'cus_cli_old',
        amountCents: 9900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: { source: 'reddit' },
        metadata: {},
      }),
      JSON.stringify({
        timestamp: '2026-03-19T12:05:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_cli_today',
        evidence: 'cs_cli_today',
        customerId: 'cus_cli_today',
        amountCents: 4900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: { source: 'website' },
        metadata: {},
      }),
      '',
    ].join('\n'));
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(leadsPath, [
      JSON.stringify({
        leadId: 'lead_cli_old',
        submittedAt: '2026-03-18T09:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'old-cli@example.com',
          company: 'Old CLI Co',
        },
        qualification: {
          workflow: 'Old CLI workflow',
          owner: 'Old CLI owner',
          blocker: 'Old blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'reddit',
        },
      }),
      JSON.stringify({
        leadId: 'lead_cli_today',
        submittedAt: '2026-03-19T13:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'today-cli@example.com',
          company: 'Today CLI Co',
        },
        qualification: {
          workflow: 'Today CLI workflow',
          owner: 'Today CLI owner',
          blocker: 'Today blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'linkedin',
        },
      }),
      '',
    ].join('\n'));

    const result = runCliSync([
      'cfo',
      '--window=today',
      '--timezone=UTC',
      '--now=2026-03-19T18:00:00.000Z',
    ], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_METRICS_SOURCE: 'local',
        _TEST_API_KEYS_PATH: apiKeysPath,
        _TEST_FUNNEL_LEDGER_PATH: ledgerPath,
        _TEST_REVENUE_LEDGER_PATH: revenuePath,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
      },
    });
    assert.equal(result.status, 0, `cfo failed:\n${result.stderr}`);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.summary.window.window, 'today');
    assert.equal(payload.summary.window.timeZone, 'UTC');
    assert.equal(payload.summary.revenue.bookedRevenueCents, 4900);
    assert.equal(payload.summary.revenue.paidOrders, 1);
    assert.equal(payload.summary.pipeline.workflowSprintLeads.total, 1);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('cfo surfaces Stripe-reconciled historical revenue and keeps today at zero when only past charges exist', () => {
    const isolatedDir = makeTmpDir();
    const feedbackDir = path.join(isolatedDir, 'feedback');

    const result = runCliSync(['cfo'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_METRICS_SOURCE: 'local',
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        _TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON: JSON.stringify([
          {
            timestamp: '2025-11-18T10:36:00.000Z',
            provider: 'stripe',
            event: 'stripe_charge_reconciled',
            status: 'paid',
            orderId: 'ch_cli_hist_001',
            evidence: 'ch_cli_hist_001',
            customerId: 'cus_cli_hist_001',
            amountCents: 1000,
            currency: 'USD',
            amountKnown: true,
            recurringInterval: 'month',
            attribution: {
              source: 'stripe_reconciled',
            },
            metadata: {
              stripeReconciled: true,
              priceId: 'price_hist_001',
              productId: 'prod_hist_001',
            },
          },
        ]),
      },
    });
    assert.equal(result.status, 0, `cfo failed:\n${result.stderr}`);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.summary.revenue.bookedRevenueCents, 1000);
    assert.equal(payload.summary.revenue.bookedRevenueTodayCents, 0);
    assert.equal(payload.summary.revenue.processorReconciledOrders, 1);
    assert.equal(payload.summary.coverage.providerCoverage.stripe, 'booked_revenue+processor_reconciled');

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('repair-github-marketplace previews and writes legacy marketplace amount repairs', () => {
    const isolatedDir = makeTmpDir();
    const revenuePath = path.join(isolatedDir, 'revenue-events.jsonl');
    fs.writeFileSync(revenuePath, `${JSON.stringify({
      timestamp: '2026-03-19T12:00:00.000Z',
      provider: 'github_marketplace',
      event: 'github_marketplace_purchased',
      status: 'paid',
      orderId: 'marketplace_cli_repair',
      evidence: 'marketplace_cli_repair',
      customerId: 'github_org_cli_repair',
      amountCents: null,
      currency: null,
      amountKnown: false,
      recurringInterval: null,
      attribution: { source: 'github_marketplace' },
      metadata: {
        planId: 80,
        planName: 'CLI Pro',
        marketplaceOrderId: 'marketplace_cli_repair',
      },
    })}\n`, 'utf8');

    const env = {
      ...process.env,
      _TEST_REVENUE_LEDGER_PATH: revenuePath,
      THUMBGATE_GITHUB_MARKETPLACE_PLAN_PRICES_JSON: JSON.stringify({
        80: { amountCents: 4900, currency: 'USD', recurringInterval: 'month' },
      }),
    };

    const preview = runCliSync(['repair-github-marketplace'], {
      cwd: isolatedDir,
      env,
    });
    assert.equal(preview.status, 0, `repair-github-marketplace preview failed:\n${preview.stderr}`);
    const previewPayload = JSON.parse(preview.stdout);
    assert.equal(previewPayload.write, false);
    assert.equal(previewPayload.wrote, false);
    assert.equal(previewPayload.repaired, 1);
    assert.equal(previewPayload.repairs[0].amountCents, 4900);

    const beforeWrite = JSON.parse(fs.readFileSync(revenuePath, 'utf8').trim());
    assert.equal(beforeWrite.amountKnown, false);

    const write = runCliSync(['repair-github-marketplace', '--write'], {
      cwd: isolatedDir,
      env,
    });
    assert.equal(write.status, 0, `repair-github-marketplace --write failed:\n${write.stderr}`);
    const writePayload = JSON.parse(write.stdout);
    assert.equal(writePayload.write, true);
    assert.equal(writePayload.wrote, true);
    assert.equal(writePayload.repaired, 1);

    const afterWrite = JSON.parse(fs.readFileSync(revenuePath, 'utf8').trim());
    assert.equal(afterWrite.amountKnown, true);
    assert.equal(afterWrite.amountCents, 4900);
    assert.equal(afterWrite.metadata.githubMarketplaceAmountSource, 'configured_plan_price');
    assert.ok(afterWrite.metadata.githubMarketplaceAmountResolvedAt);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('cfo prefers hosted billing summary when a live billing API base and admin key are configured', async () => {
    const { startServer } = require('../src/api/server');
    const remoteDir = makeTmpDir();
    const remoteFeedbackDir = path.join(remoteDir, 'feedback');
    const remoteApiKeysPath = path.join(remoteDir, 'api-keys.json');
    const remoteFunnelPath = path.join(remoteDir, 'funnel-events.jsonl');
    const remoteRevenuePath = path.join(remoteDir, 'revenue-events.jsonl');
    fs.mkdirSync(remoteFeedbackDir, { recursive: true });
    fs.writeFileSync(remoteApiKeysPath, JSON.stringify({ keys: {} }, null, 2));
    fs.writeFileSync(remoteFunnelPath, `${JSON.stringify({
      timestamp: '2026-03-18T12:00:00.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      evidence: 'sess_remote_summary',
      traceId: 'trace_remote_summary',
    })}\n`);
    fs.writeFileSync(remoteRevenuePath, `${JSON.stringify({
      timestamp: '2026-03-18T12:05:00.000Z',
      provider: 'stripe',
      event: 'stripe_checkout_completed',
      status: 'paid',
      orderId: 'cs_remote_summary',
      evidence: 'cs_remote_summary',
      customerId: 'cus_remote_summary',
      traceId: 'trace_remote_summary',
      amountCents: 4900,
      currency: 'USD',
      amountKnown: true,
      recurringInterval: null,
      attribution: { source: 'website' },
      metadata: {},
    })}\n`);

    const savedEnv = {
      THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
      THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
      _TEST_API_KEYS_PATH: process.env._TEST_API_KEYS_PATH,
      _TEST_FUNNEL_LEDGER_PATH: process.env._TEST_FUNNEL_LEDGER_PATH,
      _TEST_REVENUE_LEDGER_PATH: process.env._TEST_REVENUE_LEDGER_PATH,
    };

    process.env.THUMBGATE_FEEDBACK_DIR = remoteFeedbackDir;
    process.env.THUMBGATE_API_KEY = 'remote-admin-key';
    process.env._TEST_API_KEYS_PATH = remoteApiKeysPath;
    process.env._TEST_FUNNEL_LEDGER_PATH = remoteFunnelPath;
    process.env._TEST_REVENUE_LEDGER_PATH = remoteRevenuePath;

    const handle = await startServer({ port: 0 });
    try {
      const remoteBaseUrl = `http://127.0.0.1:${handle.port}`;

      const result = await runCliCommand(['cfo'], {
        cwd: makeTmpDir(),
        env: {
          ...process.env,
          THUMBGATE_BILLING_API_BASE_URL: remoteBaseUrl,
          THUMBGATE_API_KEY: 'remote-admin-key',
          THUMBGATE_METRICS_SOURCE: 'hosted',
        },
      });

      assert.equal(result.status, 0, `cfo failed:\n${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.source, 'hosted');
      assert.equal(payload.fallbackReason, null);
      assert.equal(payload.summary.revenue.bookedRevenueCents, 4900);
      assert.equal(payload.summary.revenue.paidOrders, 1);
    } finally {
      await new Promise((resolve) => handle.server.close(resolve));
      process.env.THUMBGATE_FEEDBACK_DIR = savedEnv.THUMBGATE_FEEDBACK_DIR;
      process.env.THUMBGATE_API_KEY = savedEnv.THUMBGATE_API_KEY;
      process.env._TEST_API_KEYS_PATH = savedEnv._TEST_API_KEYS_PATH;
      process.env._TEST_FUNNEL_LEDGER_PATH = savedEnv._TEST_FUNNEL_LEDGER_PATH;
      process.env._TEST_REVENUE_LEDGER_PATH = savedEnv._TEST_REVENUE_LEDGER_PATH;
      fs.rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  test('model-fit writes a machine-readable report using hardware overrides', () => {
    const isolatedDir = makeTmpDir();
    const feedbackDir = path.join(isolatedDir, 'feedback');
    const result = runCliSync(['model-fit'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_RAM_BYTES_OVERRIDE: String(4 * 1024 * 1024 * 1024),
        THUMBGATE_CPU_COUNT_OVERRIDE: '2',
      },
    });
    assert.equal(result.status, 0, `model-fit failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.report.selectedProfile.id, 'compact');
    assert.ok(fs.existsSync(payload.reportPath), 'model-fit should write the report file');

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('gemini-embedding-plan reports task prefixes and dimension plan', () => {
    const result = runCliSync(['gemini-embedding-plan', '--task=search result', '--corpus-items=1200', '--dim=700', '--json']);
    assert.equal(result.status, 0, `gemini-embedding-plan failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.model, 'gemini-embedding-2');
    assert.equal(payload.outputDimensionality, 768);
    assert.match(payload.taskPrefixes.query, /task: search result/);
  });

  test('agent-design-governance reports architecture and safeguards', () => {
    const result = runCliSync([
      'agent-design-governance',
      '--workflow=billing recovery agent',
      '--tools=stripe_refund,send_email',
      '--write-tools=stripe_refund,send_email',
      '--baseline-evals',
      '--json',
    ]);
    assert.equal(result.status, 0, `agent-design-governance failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.name, 'thumbgate-agent-design-governance');
    assert.equal(payload.toolRisk.risk, 'high');
    assert.ok(payload.blockers.some((blocker) => blocker.id === 'tool_approval_required'));
  });

  test('proactive-agent-eval-guardrails reports PARE-style write risk', () => {
    const result = runCliSync([
      'proactive-agent-eval-guardrails',
      '--workflow=calendar assistant',
      '--apps=calendar,email',
      '--flat-tool-api-only',
      '--proactive-writes',
      '--json',
    ]);
    assert.equal(result.status, 0, `proactive-agent-eval-guardrails failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.name, 'thumbgate-proactive-agent-eval-guardrails');
    assert.equal(payload.status, 'blocked');
  });

  test('reward-hacking-guardrails blocks unsupported completion claims', () => {
    const result = runCliSync([
      'reward-hacking-guardrails',
      '--workflow=PR closeout',
      '--text=LGTM. All tests pass and this is ready to merge.',
      '--metrics=reward score',
      '--json',
    ]);
    assert.equal(result.status, 0, `reward-hacking-guardrails failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.name, 'thumbgate-reward-hacking-guardrails');
    assert.equal(payload.status, 'blocked');
    assert.ok(payload.signals.some((signal) => signal.id === 'hallucinated_verification'));
  });

  test('oss-pr-opportunity-scout maps dependencies to upstream repos', () => {
    const result = runCliSync([
      'oss-pr-opportunity-scout',
      '--dependencies=@google/genai,stripe',
      '--max-repos=2',
      '--json',
    ]);
    assert.equal(result.status, 0, `oss-pr-opportunity-scout failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.name, 'thumbgate-oss-pr-opportunity-scout');
    assert.ok(payload.opportunities.some((item) => item.repo === 'googleapis/js-genai'));
  });

  test('chatgpt-ads-readiness-pack prepares paid AI campaign proof gates', () => {
    const result = runCliSync([
      'chatgpt-ads-readiness-pack',
      '--offer=Workflow Hardening Sprint',
      '--budget=750',
      '--json',
    ]);
    assert.equal(result.status, 0, `chatgpt-ads-readiness-pack failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.name, 'thumbgate-chatgpt-ads-readiness-pack');
    assert.equal(payload.measurement.budget, 750);
  });

  test('model-candidates ranks managed candidates and writes a report', () => {
    const isolatedDir = makeTmpDir();
    const feedbackDir = path.join(isolatedDir, 'feedback');
    const result = runCliSync(['model-candidates', '--workload=pretool-gating', '--provider=openai-compatible', '--gateway=tinker', '--json'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_NO_NUDGE: '1',
      },
    });
    assert.equal(result.status, 0, `model-candidates failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.report.recommended[0].id, 'tinker/qwen3.6-35b-a3b');
    assert.ok(fs.existsSync(payload.reportPath), 'model-candidates should write the report file');

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('risk trains and persists the boosted local risk scorer', () => {
    const isolatedDir = makeTmpDir();
    const feedbackDir = path.join(isolatedDir, 'feedback');
    writeSequenceLog(feedbackDir, buildSequenceRows());

    const result = runCliSync(['risk'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
      },
    });
    assert.equal(result.status, 0, `risk failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.metrics.mode, 'boosted');
    assert.equal(payload.summary.exampleCount, 6);
    assert.ok(fs.existsSync(payload.modelPath), 'risk should write risk-model.json');

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('risk scores a candidate from CLI flags', () => {
    const isolatedDir = makeTmpDir();
    const feedbackDir = path.join(isolatedDir, 'feedback');
    writeSequenceLog(feedbackDir, buildSequenceRows());

    const result = runCliSync([
      'risk',
      '--context=verify the fix and add evidence',
      '--tags=testing,verification',
      '--skill=tdd',
      '--file-count=2',
    ], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
      },
    });
    assert.equal(result.status, 0, `risk scoring failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.prediction, 'risk scoring should return a prediction');
    assert.equal(payload.candidate.domain, 'testing');
    assert.deepEqual(payload.candidate.targetTags, ['testing', 'verification']);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('init creates .thumbgate/ directory', () => {
    const result = runCliSync(['init'], { cwd: tmpDir });
    assert.strictEqual(result.status, 0, `init failed:\n${result.stderr}`);
    const thumbgateDir = path.join(tmpDir, '.thumbgate');
    assert.ok(fs.existsSync(thumbgateDir), '.thumbgate/ directory should be created');
  });

  test('init --wire-hooks accepts split --agent value and writes Claude hooks', () => {
    const isolatedDir = makeTmpDir();
    const isolatedHome = makeTmpDir();

    const result = runCliSync(['init', '--wire-hooks', '--agent', 'claude-code'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        THUMBGATE_PUBLISH_STATE: 'unpublished',
      },
    });

    assert.equal(result.status, 0, `hook wiring failed:\n${result.stderr}`);
    const settingsPath = path.join(isolatedHome, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.match(result.stdout, /Added hooks for claude-code:/);
    assert.equal(
      settings.hooks.PreToolUse[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} gate-check`
    );
    assert.equal(
      settings.statusLine.command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} statusline-render`
    );

    fs.rmSync(isolatedDir, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  test('init detects Claude Code and wires the canonical PreToolUse hook bundle', () => {
    const isolatedDir = makeTmpDir();
    const isolatedHome = makeTmpDir();
    fs.mkdirSync(path.join(isolatedHome, '.claude'), { recursive: true });

    const result = runCliSync(['init'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        PATH: '/usr/bin:/bin',
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_PUBLISH_STATE: 'unpublished',
      },
    });

    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    assert.match(result.stdout, /Claude Code/);

    const settingsPath = path.join(isolatedHome, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash|Edit|Write|MultiEdit');
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /gate-check/);
    assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, /hook-auto-capture/);
    assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /cache-update/);
    assert.match(settings.hooks.SessionStart[0].hooks[0].command, /session-start/);
    assert.match(settings.statusLine.command, /statusline-render/);

    const sharedSettings = JSON.parse(fs.readFileSync(path.join(isolatedHome, '.claude', 'settings.json'), 'utf8'));
    assert.match(sharedSettings.statusLine.command, /statusline-render/);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  test('init --wire-hooks accepts split --agent value and writes Codex hooks plus status line', () => {
    const isolatedDir = makeTmpDir();
    const isolatedHome = makeTmpDir();

    const result = runCliSync(['init', '--wire-hooks', '--agent', 'codex'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        THUMBGATE_PUBLISH_STATE: 'unpublished',
      },
    });

    assert.equal(result.status, 0, `hook wiring failed:\n${result.stderr}`);
    const settingsPath = path.join(isolatedHome, '.codex', 'config.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.match(result.stdout, /Added hooks for codex:/);
    assert.equal(
      settings.hooks.PreToolUse[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} gate-check`
    );
    assert.equal(
      settings.hooks.UserPromptSubmit[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} hook-auto-capture`
    );
    assert.equal(
      settings.hooks.PostToolUse[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} cache-update`
    );
    assert.equal(
      settings.hooks.SessionStart[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} session-start`
    );
    assert.equal(
      settings.statusLine.command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} statusline-render`
    );

    fs.rmSync(isolatedDir, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  test('init repairs a stale Codex config without requiring a separate wire-hooks command', () => {
    const isolatedDir = makeTmpDir();
    const isolatedHome = makeTmpDir();
    const codexDir = path.join(isolatedHome, '.codex');
    const settingsPath = path.join(codexDir, 'config.json');

    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{
            type: 'command',
            command: `mkdir -p ${JSON.stringify(path.join(isolatedHome, '.thumbgate', 'runtime'))} && exec ${JSON.stringify(path.join(isolatedHome, '.thumbgate', 'runtime', 'node_modules', '.bin', 'thumbgate'))} gate-check`,
          }],
        }],
        UserPromptSubmit: [{
          hooks: [{
            type: 'command',
            command: `mkdir -p ${JSON.stringify(path.join(isolatedHome, '.thumbgate', 'runtime'))} && exec ${JSON.stringify(path.join(isolatedHome, '.thumbgate', 'runtime', 'node_modules', '.bin', 'thumbgate'))} hook-auto-capture`,
          }],
        }],
      },
    }, null, 2) + '\n');

    const result = runCliSync(['init'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        THUMBGATE_PUBLISH_STATE: 'unpublished',
      },
    });

    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(
      settings.hooks.PreToolUse[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} gate-check`
    );
    assert.equal(
      settings.hooks.UserPromptSubmit[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} hook-auto-capture`
    );
    assert.equal(
      settings.hooks.PostToolUse[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} cache-update`
    );
    assert.equal(
      settings.hooks.SessionStart[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} session-start`
    );
    assert.equal(
      settings.statusLine.command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} statusline-render`
    );

    fs.rmSync(isolatedDir, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  test('init creates config.json with required fields', () => {
    const configPath = path.join(tmpDir, '.thumbgate', 'config.json');
    assert.ok(fs.existsSync(configPath), 'config.json should exist');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(config.version, 'config.version should be set');
    assert.ok(config.apiUrl, 'config.apiUrl should be set');
    assert.ok(config.logPath, 'config.logPath should be set');
    assert.ok(config.installId, 'config.installId should be set');
    assert.ok(config.createdAt, 'config.createdAt should be set');
    assert.ok(!isNaN(Date.parse(config.createdAt)), 'config.createdAt should be a valid ISO timestamp');
  });

  test('init emits acquisition funnel event correlated by installId', () => {
    const isolatedDir = makeTmpDir();
    const ledgerPath = path.join(isolatedDir, 'funnel-events.jsonl');

    const result = runCliSync(['init'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        _TEST_FUNNEL_LEDGER_PATH: ledgerPath,
      },
    });
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);

    const config = JSON.parse(fs.readFileSync(path.join(isolatedDir, '.thumbgate', 'config.json'), 'utf8'));
    const events = fs.readFileSync(ledgerPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const initEvent = events.find((entry) => entry.event === 'cli_init_completed');
    assert.ok(initEvent, 'expected cli_init_completed event');
    assert.equal(initEvent.stage, 'acquisition');
    assert.equal(initEvent.installId, config.installId);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('north-star command reports workflow progress', () => {
    const isolatedDir = makeTmpDir();
    const feedbackDir = path.join(isolatedDir, '.thumbgate');
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(
      path.join(feedbackDir, 'workflow-runs.jsonl'),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        workflowId: 'repo_self_dogfood_full_verify',
        workflowName: 'Repo self dogfood verification',
        owner: 'cto',
        runtime: 'node',
        proofBacked: true,
        reviewed: true,
        customerType: 'internal_dogfood',
        teamId: 'internal_repo',
      })}\n`
    );

    const result = runCliSync(['north-star'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_METRICS_SOURCE: 'local',
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
      },
    });

    assert.equal(result.status, 0, `north-star failed:\n${result.stderr}`);
    assert.match(result.stdout, /Weekly proof-backed workflow runs\s*:\s*1/);
    assert.match(result.stdout, /North Star status\s*:\s*tracking/);
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('north-star prefers hosted operational dashboard when configured', async () => {
    const { startServer } = require('../src/api/server');
    const remoteDir = makeTmpDir();
    const remoteFeedbackDir = path.join(remoteDir, 'feedback');
    const remoteApiKeysPath = path.join(remoteDir, 'api-keys.json');
    const remoteFunnelPath = path.join(remoteDir, 'funnel-events.jsonl');
    const remoteRevenuePath = path.join(remoteDir, 'revenue-events.jsonl');
    fs.mkdirSync(remoteFeedbackDir, { recursive: true });
    fs.writeFileSync(remoteApiKeysPath, JSON.stringify({ keys: {} }, null, 2));
    fs.writeFileSync(remoteFunnelPath, `${JSON.stringify({
      timestamp: '2026-03-18T12:00:00.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      evidence: 'sess_remote_north_star',
      traceId: 'trace_remote_north_star',
    })}\n`);
    fs.writeFileSync(remoteRevenuePath, `${JSON.stringify({
      timestamp: '2026-03-18T12:05:00.000Z',
      provider: 'stripe',
      event: 'stripe_checkout_completed',
      status: 'paid',
      orderId: 'cs_remote_north_star',
      evidence: 'cs_remote_north_star',
      customerId: 'cus_remote_north_star',
      traceId: 'trace_remote_north_star',
      amountCents: 4900,
      currency: 'USD',
      amountKnown: true,
      recurringInterval: null,
      attribution: { source: 'website' },
      metadata: {},
    })}\n`);
    fs.writeFileSync(path.join(remoteFeedbackDir, 'workflow-runs.jsonl'), `${JSON.stringify({
      timestamp: new Date().toISOString(),
      workflowId: 'remote_proof_run',
      workflowName: 'Remote proof run',
      owner: 'ops',
      runtime: 'claude+mcp',
      proofBacked: true,
      reviewedBy: 'buyer@example.com',
      customerType: 'named_pilot',
      teamId: 'remote_team',
      metadata: {
        leadId: 'lead_remote_north_star',
      },
    })}\n`);

    const savedEnv = {
      THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
      THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
      _TEST_API_KEYS_PATH: process.env._TEST_API_KEYS_PATH,
      _TEST_FUNNEL_LEDGER_PATH: process.env._TEST_FUNNEL_LEDGER_PATH,
      _TEST_REVENUE_LEDGER_PATH: process.env._TEST_REVENUE_LEDGER_PATH,
    };

    process.env.THUMBGATE_FEEDBACK_DIR = remoteFeedbackDir;
    process.env.THUMBGATE_API_KEY = 'remote-admin-key';
    process.env._TEST_API_KEYS_PATH = remoteApiKeysPath;
    process.env._TEST_FUNNEL_LEDGER_PATH = remoteFunnelPath;
    process.env._TEST_REVENUE_LEDGER_PATH = remoteRevenuePath;

    const handle = await startServer({ port: 0 });
    try {
      const remoteBaseUrl = `http://127.0.0.1:${handle.port}`;

      const result = await runCliCommand(['north-star'], {
        cwd: makeTmpDir(),
        env: {
          ...process.env,
          THUMBGATE_BILLING_API_BASE_URL: remoteBaseUrl,
          THUMBGATE_API_KEY: 'remote-admin-key',
          THUMBGATE_METRICS_SOURCE: 'hosted',
        },
      });

      assert.equal(result.status, 0, `north-star failed:\n${result.stderr}`);
      assert.match(result.stdout, /Metrics source\s*:\s*hosted/);
      assert.match(result.stdout, /Weekly proof-backed workflow runs\s*:\s*1/);
      assert.match(result.stdout, /Named pilot agreements\s*:\s*1/);
      assert.match(result.stdout, /Booked revenue\s*:\s*\$49\.00/);
    } finally {
      await new Promise((resolve) => handle.server.close(resolve));
      process.env.THUMBGATE_FEEDBACK_DIR = savedEnv.THUMBGATE_FEEDBACK_DIR;
      process.env.THUMBGATE_API_KEY = savedEnv.THUMBGATE_API_KEY;
      process.env._TEST_API_KEYS_PATH = savedEnv._TEST_API_KEYS_PATH;
      process.env._TEST_FUNNEL_LEDGER_PATH = savedEnv._TEST_FUNNEL_LEDGER_PATH;
      process.env._TEST_REVENUE_LEDGER_PATH = savedEnv._TEST_REVENUE_LEDGER_PATH;
      fs.rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  test('init creates .mcp.json with server entry', () => {
    const isolatedDir = makeTmpDir();
    const result = runCliSync(['init'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_PUBLISH_STATE: 'unpublished',
      },
    });
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);

    const mcpPath = path.join(isolatedDir, '.mcp.json');
    assert.ok(fs.existsSync(mcpPath), '.mcp.json should be created');
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(mcp.mcpServers, '.mcp.json should have mcpServers');
    assert.ok(mcp.mcpServers.thumbgate, 'Should have canonical ThumbGate server entry');
    assertLocalMcpEntry(mcp.mcpServers.thumbgate);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('init keeps a local source launcher for unpublished external installs', () => {
    const isolatedDir = makeTmpDir();
    const result = runCliSync(['init'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        THUMBGATE_PUBLISH_STATE: 'unpublished',
      },
    });

    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);

    const mcpPath = path.join(isolatedDir, '.mcp.json');
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.equal(mcp.mcpServers.thumbgate.command, 'node');
    assert.deepEqual(mcp.mcpServers.thumbgate.args, [MCP_SERVER_PATH]);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('init writes a stable ChatGPT OpenAPI spec into .thumbgate', () => {
    const specPath = path.join(tmpDir, '.thumbgate', 'chatgpt-openapi.yaml');
    assert.ok(fs.existsSync(specPath), 'chatgpt-openapi.yaml should be created in .thumbgate');
    const spec = fs.readFileSync(specPath, 'utf8');
    assert.match(spec, /openapi:/);
    assert.match(spec, /\/v1\/feedback\/capture/);
  });

  test('init writes a stable local codex MCP launcher when running from source checkout', () => {
    const isolatedDir = makeTmpDir();
    const isolatedHome = makeTmpDir();
    const codexHome = path.join(isolatedHome, '.codex');
    fs.mkdirSync(codexHome, { recursive: true });

    const result = runCliSync(['init'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        THUMBGATE_PUBLISH_STATE: 'unpublished',
      },
    });

    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);

    const configPath = path.join(codexHome, 'config.toml');
    const content = fs.readFileSync(configPath, 'utf8');
    assertLocalTomlMcpBlock(content, HOME_MCP_SERVER_PATH);
    assertLocalCodexPreToolHook(content);
    assert.doesNotMatch(content, /\/tmp\/disposable-worktree\/adapters\/mcp\/server-stdio\.js/);
    const hooksPath = path.join(codexHome, 'config.json');
    const hooksConfig = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    assert.equal(
      hooksConfig.statusLine.command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} statusline-render`
    );
    assert.equal(
      hooksConfig.hooks.PostToolUse[0].hooks[0].command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} cache-update`
    );

    fs.rmSync(isolatedDir, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  test('init rewrites an existing codex MCP launcher to the stable local home path', () => {
    const isolatedDir = makeTmpDir();
    const isolatedHome = makeTmpDir();
    const codexHome = path.join(isolatedHome, '.codex');
    const configPath = path.join(codexHome, 'config.toml');

    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      '[hooks.pre_tool_use]\ncommand = "sh"\nargs = ["-lc", "npx --yes --package thumbgate@1.4.6 thumbgate gate-check"]\n\n[mcp_servers.thumbgate]\ncommand = "node"\nargs = ["/tmp/disposable-worktree/adapters/mcp/server-stdio.js"]\n'
    );

    const result = runCliSync(['init'], {
      cwd: isolatedDir,
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        THUMBGATE_PUBLISH_STATE: 'unpublished',
      },
    });

    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);

    const content = fs.readFileSync(configPath, 'utf8');
    assertLocalTomlMcpBlock(content, HOME_MCP_SERVER_PATH);
    assertLocalCodexPreToolHook(content);
    assert.doesNotMatch(content, /disposable-worktree/);
    assert.doesNotMatch(content, /thumbgate@1\.4\.6/);
    const hooksPath = path.join(codexHome, 'config.json');
    const hooksConfig = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    assert.equal(
      hooksConfig.statusLine.command,
      `node ${JSON.stringify(path.join(PKG_ROOT, 'bin', 'cli.js'))} statusline-render`
    );

    fs.rmSync(isolatedDir, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  test('init output includes initialized message and platform detection', () => {
    const result = runCliSync(['init'], { cwd: tmpDir });
    assert.ok(
      result.stdout.includes('initialized'),
      `Expected "initialized" in output:\n${result.stdout}`
    );
    assert.ok(
      result.stdout.includes('Detecting platforms'),
      `Expected platform detection in output:\n${result.stdout}`
    );
  });

  test('--version prints package version', () => {
    const result = runCliSync(['--version'], { cwd: tmpDir });
    assert.equal(result.status, 0, `--version failed:\n${result.stderr}`);
    assert.equal(result.stdout.trim(), PKG_VERSION);
  });

  test('capture --feedback=up routes to full engine', () => {
    const isolatedDir = makeTmpDir();
    const result = runCliSync(['capture', '--feedback=up', '--context=cli test verification'], {
      cwd: isolatedDir,
    });
    fs.rmSync(isolatedDir, { recursive: true, force: true });
    // Exit 0 (promoted) or 2 (signal logged only) are both valid
    assert.notEqual(result.status, 1, `capture should not exit 1:\n${result.stderr}`);
  });

  test('capture --feedback=down routes to full engine', () => {
    const isolatedDir = makeTmpDir();
    const result = runCliSync(
      ['capture', '--feedback=down', '--context=test failure', '--what-went-wrong=broke it'],
      { cwd: isolatedDir }
    );
    fs.rmSync(isolatedDir, { recursive: true, force: true });
    assert.notEqual(result.status, 1, `capture should not exit 1:\n${result.stderr}`);
  });

  test('import-doc ingests a policy file and returns proposed gates as JSON', () => {
    const cwd = makeTmpDir();
    const feedbackDir = makeTmpDir();
    const docPath = path.join(cwd, 'docs', 'release-policy.md');
    fs.mkdirSync(path.dirname(docPath), { recursive: true });
    fs.writeFileSync(docPath, [
      '# Release Policy',
      '',
      '- Never force-push to main.',
      '- Always run tests before commit.',
    ].join('\n'));

    const result = spawnSync(process.execPath, [CLI, 'import-doc', docPath, '--json'], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_NO_NUDGE: '1',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.document.sourceFormat, 'markdown');
    assert.ok(body.document.proposals.some((proposal) => proposal.templateId === 'never-force-push-main'));
    assert.equal(fs.existsSync(path.join(feedbackDir, 'documents', `${body.document.documentId}.json`)), true);
  });

  test('serve responds to initialize over Content-Length framed transport', async () => {
    const { response } = await runServeHandshake((stdin, payload) => {
      stdin.write(frameMcpMessage(payload));
    });
    assert.equal(response.id, 99);
    assert.equal(response.result.serverInfo.name, 'thumbgate-mcp');
  });

  test('serve responds to initialize over newline-delimited JSON transport', async () => {
    const { response } = await runServeHandshake((stdin, payload) => {
      stdin.write(`${JSON.stringify(payload)}\n`);
    });
    assert.equal(response.id, 99);
    assert.equal(response.result.serverInfo.name, 'thumbgate-mcp');
  });

  test('serve returns ndjson error envelope for malformed ndjson input', async () => {
    const { response, raw } = await runServeHandshake((stdin) => {
      stdin.write('{"jsonrpc":"2.0","id":1,"method":\n');
    });
    assert.equal(response.id, null);
    assert.equal(response.error.code, -32603);
    assert.ok(!raw.startsWith('Content-Length:'), `Expected ndjson response, got: ${raw}`);
  });

  test('serve responds to initialize from a clean cwd even when HOME is a file', async () => {
    const isolatedDir = makeTmpDir();
    const homeFile = path.join(isolatedDir, 'invalid-home');
    fs.writeFileSync(homeFile, 'not-a-directory\n');

    const { response } = await runServeHandshake((stdin, payload) => {
      stdin.write(`${JSON.stringify(payload)}\n`);
    }, {
      cwd: isolatedDir,
      env: {
        ...process.env,
        HOME: homeFile,
        USERPROFILE: homeFile,
      },
    });

    assert.equal(response.id, 99);
    assert.equal(response.result.serverInfo.name, 'thumbgate-mcp');

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('init is idempotent — running twice exits 0', () => {
    const result = runCliSync(['init'], { cwd: tmpDir });
    assert.strictEqual(result.status, 0, `Second init failed:\n${result.stderr}`);
    assert.ok(result.stdout.includes('initialized') || result.stdout.includes('already exists'));
  });

  test('unknown proof target lists local-intelligence in available targets', () => {
    const result = runCliSync(['prove', '--target=unknown-proof'], { cwd: tmpDir });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('local-intelligence'));
  });
});

// ---------------------------------------------------------------------------
// AI Bill Auditor — `thumbgate audit <transcript>`
// ---------------------------------------------------------------------------
describe('thumbgate audit', () => {
  const os = require('node:os');

  test('reports repeat-offender patterns and estimated waste', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-audit-'));
    const transcript = path.join(dir, 'transcript.txt');
    fs.writeFileSync(transcript, [
      'git push --force origin main',
      'reverting that',
      'git push --force origin main once more',
      'I apologize for the confusion.',
      'Let me try a different approach.',
    ].join('\n'));

    const result = runCliSync(['audit', transcript]);
    fs.rmSync(dir, { recursive: true, force: true });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('AI Bill Audit Results'));
    assert.ok(result.stdout.includes('Total estimated monthly waste'));
    assert.ok(result.stdout.includes('git push --force'));
  });

  test('clean transcript reports no repeat offenders', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-audit-'));
    const transcript = path.join(dir, 'clean.txt');
    fs.writeFileSync(transcript, 'All steps succeeded on the first try.\n');

    const result = runCliSync(['audit', transcript]);
    fs.rmSync(dir, { recursive: true, force: true });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('No repeat-offender patterns found'));
  });

  test('missing file argument prints usage and exits non-zero', () => {
    const result = runCliSync(['audit']);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('Usage: npx thumbgate audit'));
  });

  test('nonexistent transcript path exits non-zero with a clear error', () => {
    const result = runCliSync(['audit', '/no/such/transcript-xyz-9999.txt']);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('File not found'));
  });
});

// ---------------------------------------------------------------------------
// Entrypoint integrity guard.
// The AI Bill Auditor was committed twice (d4ace74b, 7806500b) with an
// unterminated string literal that broke the entire CLI — no test caught it
// because nothing asserted the entrypoint even parses. Every executable under
// bin/ must pass `node --check`, always.
// ---------------------------------------------------------------------------
describe('bin/ entrypoint syntax integrity', () => {
  const binDir = path.resolve(__dirname, '../bin');

  for (const file of fs.readdirSync(binDir)) {
    if (!file.endsWith('.js')) continue;
    test(`bin/${file} parses with node --check`, () => {
      const result = spawnSync(process.execPath, ['--check', path.join(binDir, file)], {
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 0,
        `bin/${file} has a syntax error:\n${result.stderr}`);
    });
  }
});
