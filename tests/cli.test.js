'use strict';

/**
 * Tests for bin/cli.js — npx rlhf-feedback-loop
 *
 * Verifies:
 *   1. CLI runs without error
 *   2. init command creates .rlhf/ directory with config.json
 *   3. init command creates/updates .mcp.json with server entry
 *   4. help command exits 0 with usage text listing subcommands
 *   5. Unknown command exits 1
 *   6. capture subcommand routes to the full engine
 *   7. init is idempotent
 */

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const CLI = path.resolve(__dirname, '../bin/cli.js');
const savedFunnelPath = process.env._TEST_FUNNEL_LEDGER_PATH;

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-cli-test-'));
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

function runServeHandshake(sendRequest) {
  const child = spawn(process.execPath, [CLI, 'serve'], {
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

    const timer = setTimeout(() => {
      done(new Error(`MCP initialize timeout; stderr=${stderrBuffer}`));
    }, 5000);

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

describe('bin/cli.js', () => {
  let tmpDir;
  let defaultLedgerPath;

  before(() => {
    tmpDir = makeTmpDir();
    defaultLedgerPath = path.join(tmpDir, 'default-funnel-events.jsonl');
    process.env._TEST_FUNNEL_LEDGER_PATH = defaultLedgerPath;
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (savedFunnelPath === undefined) {
      delete process.env._TEST_FUNNEL_LEDGER_PATH;
    } else {
      process.env._TEST_FUNNEL_LEDGER_PATH = savedFunnelPath;
    }
  });

  test('CLI file exists and is executable', () => {
    assert.ok(fs.existsSync(CLI), `CLI not found at ${CLI}`);
    const stat = fs.statSync(CLI);
    assert.ok(stat.mode & 0o100, 'CLI should have executable bit set');
  });

  test('help command exits 0 and lists subcommands', () => {
    const result = spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.ok(result.stdout.includes('rlhf-feedback-loop'), 'Help should include CLI name');
    assert.ok(result.stdout.includes('init'), 'Help should mention init');
    assert.ok(result.stdout.includes('capture'), 'Help should mention capture');
    assert.ok(result.stdout.includes('model-fit'), 'Help should mention model-fit');
    assert.ok(result.stdout.includes('risk'), 'Help should mention risk');
    assert.ok(result.stdout.includes('export-dpo'), 'Help should mention export-dpo');
    assert.ok(result.stdout.includes('stats'), 'Help should mention stats');
    assert.ok(result.stdout.includes('rules'), 'Help should mention rules');
    assert.ok(result.stdout.includes('self-heal'), 'Help should mention self-heal');
    assert.ok(result.stdout.includes('prove'), 'Help should mention prove');
  });

  test('--help flag exits 0', () => {
    const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0);
  });

  test('no-arg invocation exits 0 with help', () => {
    const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('init'), 'No-arg output should mention init');
  });

  test('unknown command exits 1', () => {
    const result = spawnSync(process.execPath, [CLI, 'unknown-xyz'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 1, `Expected exit 1, got ${result.status}`);
  });

  test('model-fit writes a machine-readable report using hardware overrides', () => {
    const isolatedDir = makeTmpDir();
    const feedbackDir = path.join(isolatedDir, 'feedback');
    const result = spawnSync(process.execPath, [CLI, 'model-fit'], {
      encoding: 'utf8',
      cwd: isolatedDir,
      env: {
        ...process.env,
        RLHF_FEEDBACK_DIR: feedbackDir,
        RLHF_RAM_BYTES_OVERRIDE: String(4 * 1024 * 1024 * 1024),
        RLHF_CPU_COUNT_OVERRIDE: '2',
      },
    });
    assert.equal(result.status, 0, `model-fit failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.report.selectedProfile.id, 'compact');
    assert.ok(fs.existsSync(payload.reportPath), 'model-fit should write the report file');

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('risk trains and persists the boosted local risk scorer', () => {
    const isolatedDir = makeTmpDir();
    const feedbackDir = path.join(isolatedDir, 'feedback');
    writeSequenceLog(feedbackDir, buildSequenceRows());

    const result = spawnSync(process.execPath, [CLI, 'risk'], {
      encoding: 'utf8',
      cwd: isolatedDir,
      env: {
        ...process.env,
        RLHF_FEEDBACK_DIR: feedbackDir,
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

    const result = spawnSync(process.execPath, [
      CLI,
      'risk',
      '--context=verify the fix and add evidence',
      '--tags=testing,verification',
      '--skill=tdd',
      '--file-count=2',
    ], {
      encoding: 'utf8',
      cwd: isolatedDir,
      env: {
        ...process.env,
        RLHF_FEEDBACK_DIR: feedbackDir,
      },
    });
    assert.equal(result.status, 0, `risk scoring failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.prediction, 'risk scoring should return a prediction');
    assert.equal(payload.candidate.domain, 'testing');
    assert.deepEqual(payload.candidate.targetTags, ['testing', 'verification']);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('init creates .rlhf/ directory', () => {
    const result = spawnSync(process.execPath, [CLI, 'init'], {
      encoding: 'utf8',
      cwd: tmpDir,
    });
    assert.strictEqual(result.status, 0, `init failed:\n${result.stderr}`);
    const rlhfDir = path.join(tmpDir, '.rlhf');
    assert.ok(fs.existsSync(rlhfDir), '.rlhf/ directory should be created');
  });

  test('init creates config.json with required fields', () => {
    const configPath = path.join(tmpDir, '.rlhf', 'config.json');
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

    const result = spawnSync(process.execPath, [CLI, 'init'], {
      encoding: 'utf8',
      cwd: isolatedDir,
      env: {
        ...process.env,
        _TEST_FUNNEL_LEDGER_PATH: ledgerPath,
      },
    });
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);

    const config = JSON.parse(fs.readFileSync(path.join(isolatedDir, '.rlhf', 'config.json'), 'utf8'));
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

  test('init creates .mcp.json with server entry', () => {
    const mcpPath = path.join(tmpDir, '.mcp.json');
    assert.ok(fs.existsSync(mcpPath), '.mcp.json should be created');
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(mcp.mcpServers, '.mcp.json should have mcpServers');
    assert.ok(mcp.mcpServers['rlhf-feedback-loop'], 'Should have rlhf-feedback-loop server entry');
    assert.strictEqual(mcp.mcpServers['rlhf-feedback-loop'].command, 'node');
    assert.ok(mcp.mcpServers['rlhf-feedback-loop'].args[0].includes('server-stdio.js'));
  });

  test('init output includes initialized message and platform detection', () => {
    const result = spawnSync(process.execPath, [CLI, 'init'], {
      encoding: 'utf8',
      cwd: tmpDir,
    });
    assert.ok(
      result.stdout.includes('initialized'),
      `Expected "initialized" in output:\n${result.stdout}`
    );
    assert.ok(
      result.stdout.includes('Detecting platforms'),
      `Expected platform detection in output:\n${result.stdout}`
    );
  });

  test('capture --feedback=up routes to full engine', () => {
    const isolatedDir = makeTmpDir();
    const result = spawnSync(
      process.execPath,
      [CLI, 'capture', '--feedback=up', '--context=cli test verification'],
      { encoding: 'utf8', cwd: isolatedDir }
    );
    fs.rmSync(isolatedDir, { recursive: true, force: true });
    // Exit 0 (promoted) or 2 (signal logged only) are both valid
    assert.notEqual(result.status, 1, `capture should not exit 1:\n${result.stderr}`);
  });

  test('capture --feedback=down routes to full engine', () => {
    const isolatedDir = makeTmpDir();
    const result = spawnSync(
      process.execPath,
      [CLI, 'capture', '--feedback=down', '--context=test failure', '--what-went-wrong=broke it'],
      { encoding: 'utf8', cwd: isolatedDir }
    );
    fs.rmSync(isolatedDir, { recursive: true, force: true });
    assert.notEqual(result.status, 1, `capture should not exit 1:\n${result.stderr}`);
  });

  test('serve responds to initialize over Content-Length framed transport', async () => {
    const { response } = await runServeHandshake((stdin, payload) => {
      stdin.write(frameMcpMessage(payload));
    });
    assert.equal(response.id, 99);
    assert.equal(response.result.serverInfo.name, 'rlhf-feedback-loop-mcp');
  });

  test('serve responds to initialize over newline-delimited JSON transport', async () => {
    const { response } = await runServeHandshake((stdin, payload) => {
      stdin.write(`${JSON.stringify(payload)}\n`);
    });
    assert.equal(response.id, 99);
    assert.equal(response.result.serverInfo.name, 'rlhf-feedback-loop-mcp');
  });

  test('serve returns ndjson error envelope for malformed ndjson input', async () => {
    const { response, raw } = await runServeHandshake((stdin) => {
      stdin.write('{"jsonrpc":"2.0","id":1,"method":\n');
    });
    assert.equal(response.id, null);
    assert.equal(response.error.code, -32603);
    assert.ok(!raw.startsWith('Content-Length:'), `Expected ndjson response, got: ${raw}`);
  });

  test('init is idempotent — running twice exits 0', () => {
    const result = spawnSync(process.execPath, [CLI, 'init'], {
      encoding: 'utf8',
      cwd: tmpDir,
    });
    assert.strictEqual(result.status, 0, `Second init failed:\n${result.stderr}`);
    assert.ok(result.stdout.includes('initialized') || result.stdout.includes('already exists'));
  });

  test('unknown proof target lists local-intelligence in available targets', () => {
    const result = spawnSync(process.execPath, [CLI, 'prove', '--target=unknown-proof'], {
      encoding: 'utf8',
      cwd: tmpDir,
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('local-intelligence'));
  });
});
