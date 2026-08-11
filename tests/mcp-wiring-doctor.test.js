'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  wiringReport,
  applyFix,
  hasThumbgateServer,
} = require('../scripts/mcp-wiring-doctor');
const {
  captureFeedbackRemote,
  isRemoteCaptureConfigured,
} = require('../scripts/remote-feedback-capture');

test('hasThumbgateServer detects thumbgate and rejects legacy-only configs', () => {
  assert.equal(hasThumbgateServer({ mcpServers: { thumbgate: { command: 'node' } } }), true);
  assert.equal(hasThumbgateServer({ mcpServers: { github: {}, context7: {} } }), false);
  assert.equal(hasThumbgateServer({ mcpServers: { 'mcp-memory-gateway': { command: 'x' } } }), false);
});

test('mcp-wiring-doctor detects legacy mcp-memory-gateway + rlhf in .mcp.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-wiring-legacy-'));
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'mcp-memory-gateway': { command: 'node', args: ['server.js'] },
        rlhf: { command: 'node', args: ['rlhf.js'] },
        thumbgate: { command: 'node', args: ['thumbgate.js'] },
      },
    }));
    fs.mkdirSync(path.join(dir, '.thumbgate'));
    const report = wiringReport(dir, { HOME: dir });
    assert.ok(report.findings.some((f) => /legacy MCP key/i.test(f) || /mcp-memory-gateway/.test(f)));
    assert.ok(report.overall === 'warning' || report.overall === 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wiringReport errors when project .mcp.json omits thumbgate (unattended gap)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-wiring-'));
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { github: {}, context7: {}, grepai: {} },
    }));
    const report = wiringReport(dir, {
      container: '1',
      HOME: dir,
    });
    assert.equal(report.overall, 'error');
    assert.equal(report.mcp.thumbgateInProjectMcp, false);
    assert.equal(report.unattendedCaptureReady, true);
    assert.ok(report.findings.some((f) => /no thumbgate server/i.test(f)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wiringReport is ok when .mcp.json has thumbgate and writable store exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-wiring-ok-'));
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        thumbgate: { command: 'node', args: ['adapters/mcp/server-stdio.js'] },
      },
    }));
    const store = path.join(dir, '.thumbgate');
    fs.mkdirSync(store);
    const report = wiringReport(dir, { HOME: dir });
    assert.equal(report.mcp.thumbgateInProjectMcp, true);
    assert.equal(report.lessonsStore.present, true);
    assert.equal(report.unattendedCaptureReady, true);
    assert.equal(report.overall, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wiringReport treats a creatable lessons store as writable in a fresh container', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-wiring-fresh-'));
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { thumbgate: { command: 'npx', args: ['-y', 'thumbgate', 'serve'] } },
    }));
    const report = wiringReport(dir, { HOME: dir, container: '1' });
    assert.equal(report.lessonsStore.present, false);
    assert.equal(report.lessonsStore.writable, true);
    assert.equal(report.lessonsStore.creatable, true);
    assert.equal(report.unattendedCaptureReady, true);
    assert.equal(report.overall, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyFix writes thumbgate into .mcp.json without dropping other servers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-wiring-fix-'));
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { github: { command: 'gh' }, 'mcp-memory-gateway': { command: 'legacy' } },
    }));
    applyFix(dir);
    const written = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
    assert.ok(written.mcpServers.thumbgate);
    assert.ok(written.mcpServers.github);
    assert.equal(written.mcpServers['mcp-memory-gateway'], undefined);
    assert.ok(['npx', 'sh'].includes(written.mcpServers.thumbgate.command));
    assert.ok(written.mcpServers.thumbgate.args.some((arg) => arg.includes('thumbgate')));
    assert.ok(!written.mcpServers.thumbgate.args.some((arg) => arg.includes('adapters/mcp/server-stdio.js')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isRemoteCaptureConfigured requires base URL and API key', () => {
  assert.equal(isRemoteCaptureConfigured({}), false);
  assert.equal(isRemoteCaptureConfigured({
    THUMBGATE_API_BASE_URL: 'https://thumbgate-production.up.railway.app',
    THUMBGATE_API_KEY: 'tg_test',
  }), true);
});

test('captureFeedbackRemote posts JSON with bearer auth', async () => {
  const calls = [];
  const result = await captureFeedbackRemote({
    signal: 'down',
    context: 'test remote capture',
    whatWentWrong: 'unit test',
    tags: ['test'],
    env: {
      THUMBGATE_API_BASE_URL: 'https://example.test',
      THUMBGATE_API_KEY: 'tg_key',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'fb_test' }),
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/v1/feedback/capture');
  assert.match(calls[0].init.headers.authorization, /Bearer tg_key/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.context, 'test remote capture');
  assert.equal(body.signal, 'down');
});

test('repo root .mcp.json wires thumbgate (dogfood)', () => {
  const mcpPath = path.join(__dirname, '..', '.mcp.json');
  assert.ok(fs.existsSync(mcpPath), 'project .mcp.json must exist');
  const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  assert.ok(config.mcpServers && config.mcpServers.thumbgate, 'thumbgate server required');
});
