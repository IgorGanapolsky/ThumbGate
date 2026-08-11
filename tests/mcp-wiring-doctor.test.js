'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  wiringReport,
  applyFix,
  formatReport,
  hasThumbgateServer,
  remoteCaptureConfigured,
  resolveLessonsStore,
} = require('../scripts/mcp-wiring-doctor');
const {
  captureFeedbackRemote,
  isRemoteCaptureConfigured,
  resolveApiKey,
  resolveBaseUrl,
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

test('remote capture configuration normalizes URL and key aliases', () => {
  const env = {
    THUMBGATE_API_URL: 'https://example.test/',
    THUMBGATE_API_KEY: '  tg_key  ',
  };
  assert.equal(resolveBaseUrl(env), 'https://example.test');
  assert.equal(resolveApiKey(env), 'tg_key');
  assert.deepEqual(remoteCaptureConfigured(env), {
    configured: true,
    baseUrl: 'https://example.test',
    hasKey: true,
  });
});

test('captureFeedbackRemote reports missing configuration without calling fetch', async () => {
  let called = false;
  const result = await captureFeedbackRemote({
    env: {},
    fetchImpl: async () => { called = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'remote_capture_not_configured');
  assert.equal(called, false);
});

test('captureFeedbackRemote accepts comma tags and preserves non-JSON error bodies', async () => {
  const calls = [];
  const result = await captureFeedbackRemote({
    feedback: 'positive',
    context: 'remote context',
    whatWorked: 'hosted capture is reachable',
    tags: 'cloud, unattended, ,rag',
    source: 'acceptance-test',
    env: {
      THUMBGATE_API_BASE_URL: 'https://example.test/',
      THUMBGATE_API_KEY: 'tg_key',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: false,
        status: 503,
        text: async () => 'temporarily unavailable',
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'remote_capture_http_error');
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { raw: 'temporarily unavailable' });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.signal, 'positive');
  assert.equal(body.whatWorked, 'hosted capture is reachable');
  assert.deepEqual(body.tags, ['cloud', 'unattended', 'rag']);
  assert.equal(body.source, 'acceptance-test');
});

test('captureFeedbackRemote handles empty success and network failures', async () => {
  const env = {
    THUMBGATE_API_BASE_URL: 'https://example.test',
    THUMBGATE_API_KEY: 'tg_key',
  };
  const empty = await captureFeedbackRemote({
    env,
    fetchImpl: async () => ({ ok: true, status: 204, text: async () => '' }),
  });
  assert.deepEqual(empty, { ok: true, status: 204, body: null });

  const failed = await captureFeedbackRemote({
    env,
    fetchImpl: async () => { throw new Error('network down'); },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'remote_capture_network_error');
  assert.equal(failed.message, 'network down');
});

test('wiringReport surfaces invalid JSON and formats actionable findings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-wiring-invalid-'));
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), '{not-json');
    const report = wiringReport(dir, { HOME: dir, container: '1' });
    assert.equal(report.overall, 'error');
    assert.equal(report.mcp.projectMcpPresent, true);
    assert.equal(report.mcp.thumbgateInProjectMcp, false);
    assert.ok(report.findings.some((finding) => /not valid JSON/.test(finding)));
    const text = formatReport(report);
    assert.match(text, /MCP wiring doctor: ERROR/);
    assert.match(text, /Findings:/);
    assert.match(text, /Unattended capture ready: yes/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('alternate non-legacy server keys can explicitly invoke ThumbGate', () => {
  assert.equal(hasThumbgateServer({
    servers: {
      governance: { command: 'npx', args: ['thumbgate', 'serve'] },
    },
  }), true);
  assert.equal(hasThumbgateServer({ __parseError: true }), false);
  assert.equal(hasThumbgateServer(null), false);
});

test('resolveLessonsStore honors an explicit existing feedback directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-explicit-store-'));
  try {
    assert.deepEqual(resolveLessonsStore('/unused', { THUMBGATE_FEEDBACK_DIR: dir }), {
      path: dir,
      present: true,
      writable: true,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repo root .mcp.json wires thumbgate (dogfood)', () => {
  const mcpPath = path.join(__dirname, '..', '.mcp.json');
  assert.ok(fs.existsSync(mcpPath), 'project .mcp.json must exist');
  const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  assert.ok(config.mcpServers && config.mcpServers.thumbgate, 'thumbgate server required');
});
