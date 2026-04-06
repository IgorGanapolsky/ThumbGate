'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-search-test-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-search-proof-'));

process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
process.env.THUMBGATE_CONTEXTFS_DIR = path.join(tmpDir, 'contextfs');
process.env.THUMBGATE_API_KEY = 'test-search-key';
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
process.env.THUMBGATE_NO_RATE_LIMIT = '1';
process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpDir, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpDir, 'revenue-events.jsonl');
process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpDir, 'local-checkout-sessions.json');
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';
process.env.THUMBGATE_PUBLIC_APP_ORIGIN = 'https://app.example.com';
process.env.THUMBGATE_BILLING_API_BASE_URL = 'https://billing.example.com';
process.env.THUMBGATE_BUILD_METADATA_PATH = path.join(tmpDir, 'build-metadata.json');

fs.writeFileSync(
  process.env.THUMBGATE_BUILD_METADATA_PATH,
  JSON.stringify({ buildSha: 'test-sha', generatedAt: '2026-01-01T00:00:00.000Z' }, null, 2)
);

const feedbackEntries = [
  {
    id: 'fb1',
    signal: 'down',
    context: 'mocking database caused production failures',
    tags: ['testing', 'database'],
    whatWentWrong: 'tests passed but real migration broke',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'fb2',
    signal: 'up',
    context: 'real database integration tests caught bugs early',
    tags: ['testing', 'integration'],
    whatWorked: 'caught migration bug before deploy',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'fb3',
    signal: 'negative',
    context: 'lint errors skipped before commit',
    tags: ['ci', 'lint'],
    whatToChange: 'run the linter before every commit',
    timestamp: new Date().toISOString(),
  },
];

fs.writeFileSync(
  path.join(tmpDir, 'feedback-log.jsonl'),
  `${feedbackEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
);

fs.writeFileSync(
  path.join(tmpDir, 'prevention-rules.md'),
  [
    '# Never mock databases in integration tests',
    'Always use real database connections.',
    '',
    '# Run linter before every commit',
    'Use pre-commit hooks.',
    '',
  ].join('\n')
);

const ctxErrorDir = path.join(tmpDir, 'contextfs', 'memory', 'error');
fs.mkdirSync(ctxErrorDir, { recursive: true });
fs.writeFileSync(
  path.join(ctxErrorDir, 'ctx1.json'),
  JSON.stringify({
    id: 'ctx1',
    title: 'Database timeout in tests',
    context: 'database timeout during unit test run',
    tags: ['database', 'timeout'],
    timestamp: new Date().toISOString(),
  })
);

function clearModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes('filesystem-search')
      || key.includes('thumbgate-search')
      || key.includes('server-stdio')
      || key.includes('tool-registry')
      || key.includes(`${path.sep}src${path.sep}api${path.sep}server.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function loadMcpServer() {
  clearModuleCache();
  return require('../adapters/mcp/server-stdio');
}

function loadApiServer() {
  clearModuleCache();
  return require('../src/api/server');
}

let apiHandle;
let apiOrigin;

test.before(async () => {
  const { startServer } = loadApiServer();
  apiHandle = await startServer({ port: 0 });
  apiOrigin = `http://localhost:${apiHandle.port}`;
});

test.after(async () => {
  if (apiHandle) {
    await new Promise((resolve) => apiHandle.server.close(resolve));
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(tmpProofDir, { recursive: true, force: true });

  delete process.env.THUMBGATE_FEEDBACK_DIR;
  delete process.env.THUMBGATE_CONTEXTFS_DIR;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_PROOF_DIR;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;
  delete process.env._TEST_API_KEYS_PATH;
  delete process.env._TEST_FUNNEL_LEDGER_PATH;
  delete process.env._TEST_REVENUE_LEDGER_PATH;
  delete process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
  delete process.env.THUMBGATE_PUBLIC_APP_ORIGIN;
  delete process.env.THUMBGATE_BILLING_API_BASE_URL;
  delete process.env.THUMBGATE_BUILD_METADATA_PATH;
});

async function apiFetch(pathname, options = {}) {
  const url = new URL(pathname, apiOrigin).toString();
  return fetch(url, options);
}

const authHeader = { authorization: 'Bearer test-search-key' };

test('MCP registers search_thumbgate as a read-only tool', () => {
  const { TOOLS } = loadMcpServer();
  const tool = TOOLS.find((entry) => entry.name === 'search_thumbgate');
  assert.ok(tool, 'search_thumbgate must be registered');
  assert.deepEqual(tool.inputSchema.required, ['query']);
  assert.equal(tool.annotations && tool.annotations.readOnlyHint, true);
});

test('MCP search_thumbgate returns merged results for source=all', async () => {
  const { handleRequest } = loadMcpServer();
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: {
      name: 'search_thumbgate',
      arguments: { query: 'database testing', limit: 5, source: 'all' },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.query, 'database testing');
  assert.equal(payload.source, 'all');
  assert.ok(Array.isArray(payload.results));
  assert.ok(payload.results.length > 0);
  assert.ok(payload.results.some((entry) => entry.source === 'feedback'));
});

test('MCP search_thumbgate filters feedback-only results', async () => {
  const { handleRequest } = loadMcpServer();
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: {
      name: 'search_thumbgate',
      arguments: { query: 'database', source: 'feedback' },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.source, 'feedback');
  payload.results.forEach((entry) => {
    assert.equal(entry.source, 'feedback');
  });
});

test('MCP search_thumbgate filters context-only results', async () => {
  const { handleRequest } = loadMcpServer();
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 12,
    method: 'tools/call',
    params: {
      name: 'search_thumbgate',
      arguments: { query: 'database timeout', source: 'context' },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.source, 'context');
  payload.results.forEach((entry) => {
    assert.equal(entry.source, 'contextfs');
  });
});

test('MCP search_thumbgate filters prevention-rule results', async () => {
  const { handleRequest } = loadMcpServer();
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 13,
    method: 'tools/call',
    params: {
      name: 'search_thumbgate',
      arguments: { query: 'mock database', source: 'rules' },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.source, 'rules');
  payload.results.forEach((entry) => {
    assert.equal(entry.source, 'prevention_rule');
  });
});

test('MCP search_thumbgate honors signal filters across signal aliases', async () => {
  const { handleRequest } = loadMcpServer();
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 14,
    method: 'tools/call',
    params: {
      name: 'search_thumbgate',
      arguments: { query: 'lint', source: 'feedback', signal: 'negative' },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.ok(payload.results.length > 0);
  payload.results.forEach((entry) => {
    assert.equal(entry.signal, 'down');
  });
});

test('MCP search_thumbgate rejects a missing query', async () => {
  const { handleRequest } = loadMcpServer();
  await assert.rejects(
    () => handleRequest({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: {
        name: 'search_thumbgate',
        arguments: {},
      },
    }),
    /query is required/
  );
});

test('API GET /v1/search returns results with valid auth', async () => {
  const response = await apiFetch('/v1/search?q=database&source=feedback', {
    headers: authHeader,
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.query, 'database');
  assert.equal(body.source, 'feedback');
  assert.ok(body.results.length > 0);
});

test('API POST /v1/search returns results for context source', async () => {
  const response = await apiFetch('/v1/search', {
    method: 'POST',
    headers: {
      ...authHeader,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: 'database timeout',
      source: 'context',
      limit: 5,
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'context');
  assert.ok(body.results.some((entry) => entry.source === 'contextfs'));
});

test('API /v1/search requires auth', async () => {
  const response = await apiFetch('/v1/search?q=database');
  assert.equal(response.status, 401);
});

test('root JSON listing includes /v1/search', async () => {
  const response = await apiFetch('/', {
    headers: {
      accept: 'application/json',
    },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.endpoints.includes('/v1/search'));
});
