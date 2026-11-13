'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-isolation-')));
const legacy = path.join(fixture, 'store');
fs.mkdirSync(legacy, { recursive: true });
const admin = crypto.randomBytes(24).toString('hex');
Object.assign(process.env, {
  NODE_ENV: 'test', HOME: path.join(fixture, 'home'), THUMBGATE_FEEDBACK_DIR: legacy,
  THUMBGATE_STATE_DIR: path.join(legacy, 'state'), THUMBGATE_API_KEY: admin,
  THUMBGATE_DISABLE_TELEMETRY: '1', THUMBGATE_AGGREGATE_ROOTS: legacy,
  THUMBGATE_PRO_MODE: '1', THUMBGATE_DASHBOARD_CACHE_TTL_MS: '0',
  _TEST_API_KEYS_PATH: path.join(legacy, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(legacy, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(legacy, 'revenue-events.jsonl'),
  STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '', RESEND_API_KEY: '', THUMBGATE_RESEND_API_KEY: '',
});
delete process.env.THUMBGATE_PROJECT_DIR;
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.INIT_CWD;
const billing = require('../scripts/billing');
let merchantProviderCalls = 0;
const originalBillingSummaryLive = billing.getBillingSummaryLive;
billing.getBillingSummaryLive = (...args) => { merchantProviderCalls += 1; return originalBillingSummaryLive(...args); };
const { startServer, __test__ } = require('../src/api/server');
const { getFeedbackPaths } = require('../scripts/feedback-paths');
const { waitForBackgroundSideEffects } = require('../scripts/feedback-loop');
let handle;
let origin;
const credentials = ['synthetic-isolation-a', 'synthetic-isolation-b'].map((id) => billing.provisionApiKey(id).key);
const dirs = credentials.map((key) => __test__.partitionFeedbackPaths(getFeedbackPaths(), __test__.buildHostedTenantIdentity(billing.validateApiKey(key))).FEEDBACK_DIR);
for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
const request = async (route, key, body) => {
  const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
};
const readRows = (dir, file) => fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
function writeRows(dir, file, rows) { fs.writeFileSync(path.join(dir, file), rows.map(JSON.stringify).join('\n') + '\n'); }
test.before(async () => {
  handle = await startServer({ port: 0, host: '127.0.0.1' });
  origin = `http://127.0.0.1:${handle.port}`;
});
test.after(async () => {
  await waitForBackgroundSideEffects();
  handle.server.closeAllConnections();
  await new Promise((resolve) => handle.server.close(resolve));
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('interleaved authenticated captures persist only to the verified customer roots', async () => {
  const before = readRows(legacy, 'feedback-log.jsonl').length;
  const results = await Promise.all(credentials.map((key, index) => request('/v1/feedback/capture', key, { signal: 'up', context: `synthetic-owner-${index}`, whatWorked: 'The fixture returned the verified tenant result.', tenantId: 'spoofed', feedbackDir: legacy })));
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  await waitForBackgroundSideEffects();
  assert.equal(readRows(legacy, 'feedback-log.jsonl').length, before);
  for (let index = 0; index < dirs.length; index += 1) {
    const rows = readRows(dirs[index], 'feedback-log.jsonl');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].context, `synthetic-owner-${index}`);
    const exported = await request('/v1/lessons/export', credentials[index], {});
    assert.equal(exported.status, 200);
    assert.equal(exported.body.bundle.lessons.some((row) => row.context === `synthetic-owner-${1 - index}`), false);
  }
});

test('tenant stats and dashboard exclude the global canary and preserve independent team scope', async () => {
  writeRows(legacy, 'feedback-log.jsonl', [{ id: 'legacy-canary', signal: 'positive', reviewOrigin: 'human' }]);
  for (let index = 0; index < dirs.length; index += 1) {
    writeRows(dirs[index], 'feedback-log.jsonl', [{ id: `tenant-${index}`, signal: 'positive', reviewOrigin: 'human' }]);
    writeRows(dirs[index], 'agent-registry.jsonl', [{ id: `scoped-agent-${index}`, source: 'fixture', lastSeenAt: new Date().toISOString(), toolCalls: 1 }]);
    const stats = await request('/v1/feedback/stats', credentials[index]);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.total, 1);
    const dashboard = await request('/v1/dashboard', credentials[index]);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.approval.total, 1);
    assert.equal(JSON.stringify(dashboard.body.team).includes(`scoped-agent-${1 - index}`), false);
    assert.equal(JSON.stringify(dashboard.body.team).includes(`scoped-agent-${index}`), true);
  }
});

test('tenant exports cannot bypass the root using external-path configuration or symlinks', async () => {
  process.env.THUMBGATE_ALLOW_EXTERNAL_PATHS = 'true';
  const outside = path.join(dirs[1], 'private.json');
  fs.writeFileSync(outside, '[]');
  const link = path.join(dirs[0], 'escape');
  fs.symlinkSync(dirs[1], link, 'dir');
  for (const inputPath of [outside, path.join(link, 'private.json')]) {
    const result = await request('/v1/dpo/export', credentials[0], { inputPath, includePairs: true });
    assert.equal(result.status, 400);
  }
  const output = await request('/v1/lessons/export', credentials[0], { outputPath: path.join(link, 'new', 'export.json') });
  assert.equal(output.status, 400);
});

test('tenant generic harness jobs fail closed and foreign job identifiers are absent', async () => {
  const harness = await request('/v1/jobs/harness', credentials[0], { harness: 'synthetic', inputs: {} });
  assert.equal(harness.status, 403);
  const foreignDir = path.join(dirs[0], 'jobs', 'known-job');
  fs.mkdirSync(foreignDir, { recursive: true });
  fs.writeFileSync(path.join(foreignDir, 'state.json'), JSON.stringify({ jobId: 'known-job', status: 'paused' }));
  const foreign = await request('/v1/jobs/known-job', credentials[1]);
  assert.equal(foreign.status, 404);
  const own = await request('/v1/jobs/known-job', credentials[0]);
  assert.equal(own.status, 200);
  const traversal = await request('/v1/jobs/..%2Fknown-job', credentials[0]);
  assert.equal([400, 404].includes(traversal.status), true);
});


test('tenant dashboard never fetches merchant-wide provider billing or global commercial ledgers', async () => {
  const before = merchantProviderCalls;
  writeRows(legacy, 'revenue-events.jsonl', [{ id: 'merchant-global-canary', status: 'paid', amountCents: 987654321, timestamp: new Date().toISOString(), source: 'merchant-global-canary' }]);
  const result = await request('/v1/dashboard', credentials[0]);
  assert.equal(result.status, 200);
  assert.equal(merchantProviderCalls, before);
  assert.equal(result.body.analytics.revenue.bookedRevenueCents, 0);
  assert.equal(result.body.predictive.availability, 'admin_only');
  assert.equal(JSON.stringify(result.body).includes('merchant-global-canary'), false);
  assert.equal(JSON.stringify(result.body).includes('987654321'), false);
});

async function subscribe(key) {
  const controller = new AbortController();
  const response = await fetch(origin + '/v1/events', { headers: { authorization: 'Bearer ' + key }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const messages = [];
  let buffer = '';
  const ready = new Promise((resolve) => {
    (async () => {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) return;
          buffer += Buffer.from(chunk.value).toString('utf8');
          const frames = buffer.split('\n\n');
          buffer = frames.pop();
          for (const frame of frames) {
            const type = frame.match(/^event: (.+)$/m)?.[1];
            const data = frame.match(/^data: (.+)$/m)?.[1];
            if (type === 'connected') resolve();
            else if (data) messages.push({ type, data: JSON.parse(data) });
          }
        }
      } catch { }
    })();
  });
  await ready;
  return { messages, close: () => controller.abort() };
}

test('SSE subscription ownership is captured independently of the event publisher context', async () => {
  const streams = await Promise.all([credentials[0], credentials[0], credentials[1], admin].map(subscribe));
  try {
    const captured = await request('/v1/feedback/capture', credentials[0], { signal: 'up', context: 'synthetic SSE owner marker', whatWorked: 'Only subscribers for this tenant receive the event.' });
    assert.equal(captured.status, 200);
    for (let attempt = 0; attempt < 30 && streams[0].messages.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(streams.map((stream) => stream.messages.length), [1, 1, 0, 0]);
    assert.equal(streams[0].messages[0].type, 'feedback');
    assert.equal(JSON.stringify(streams[0].messages[0]).includes(dirs[0]), false);
  } finally { streams.forEach((stream) => stream.close()); }
});

test('fixed async DPO exports use the tenant default input in inline and subprocess modes', async () => {
  for (const [index, dir] of [legacy, ...dirs].entries()) writeRows(dir, 'memory-log.jsonl', [
    { id: `err-${index}`, title: `MISTAKE: private-export-${index}`, content: `private-export-${index} rejected action`, category: 'error', tags: ['synthetic-export'] },
    { id: `good-${index}`, title: `SUCCESS: private-export-${index}`, content: `private-export-${index} verified action`, category: 'learning', tags: ['synthetic-export'] },
  ]);
  for (const mode of ['inline', 'background']) {
    process.env.THUMBGATE_HOSTED_JOB_LAUNCH_MODE = mode;
    const outputPath = path.join(dirs[0], `export-${mode}.jsonl`);
    const launched = await request('/v1/dpo/export', credentials[0], { async: true, outputPath });
    assert.equal(launched.status, 202);
    let own;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      own = await request('/v1/jobs/' + launched.body.jobId, credentials[0]);
      if (['completed', 'failed'].includes(own.body.job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(own.body.job.status, 'completed');
    const exported = fs.readFileSync(outputPath, 'utf8');
    assert.equal(exported.includes('private-export-1'), true);
    assert.equal(exported.includes('private-export-0'), false);
    assert.equal(exported.includes('private-export-2'), false);
    const foreign = await request('/v1/jobs/' + launched.body.jobId, credentials[1]);
    assert.equal(foreign.status, 404);
    const foreignControl = await request('/v1/jobs/' + launched.body.jobId + '/control', credentials[1], { action: 'cancel' });
    assert.equal(foreignControl.status, 404);
  }
});

test('a verified customer cannot rebind storage through a project selector and loopback Host header', async () => {
  const project = path.join(fixture, 'forged-project');
  const foreign = path.join(project, '.thumbgate');
  fs.mkdirSync(foreign, { recursive: true });
  writeRows(foreign, 'feedback-log.jsonl', [{ id: 'forged-project-canary', signal: 'positive', reviewOrigin: 'human' }]);
  const before = readRows(dirs[0], 'feedback-log.jsonl').length;
  const siblingBefore = readRows(dirs[1], 'feedback-log.jsonl').length;
  const headers = { authorization: 'Bearer ' + credentials[0], 'content-type': 'application/json', Host: 'localhost', 'x-forwarded-host': 'localhost', 'x-thumbgate-project-dir': project };
  const query = '?project=' + encodeURIComponent(project);
  const captured = await fetch(origin + '/v1/feedback/capture' + query, { method: 'POST', headers, body: JSON.stringify({ signal: 'up', context: 'verified-owner-spoof-canary', whatWorked: 'Authenticated scope won over the supplied project path.' }) });
  assert.equal(captured.status, 200);
  const stats = await fetch(origin + '/v1/feedback/stats' + query, { headers });
  assert.equal(stats.status, 200);
  assert.equal((await stats.json()).total, before + 1);
  assert.equal(readRows(dirs[0], 'feedback-log.jsonl').length, before + 1);
  assert.equal(readRows(dirs[1], 'feedback-log.jsonl').length, siblingBefore);
  assert.equal(readRows(foreign, 'feedback-log.jsonl').length, 1);
});

test('legacy and tenant dashboard cache entries cannot share an identical directory key', () => {
  const { withDataScope } = require('../scripts/feedback-scope');
  const query = new URL('http://fixture/v1/dashboard');
  const tenant = withDataScope({ kind: 'tenant', tenantId: 'synthetic', feedbackDir: dirs[0] }, () => __test__.buildLiveDashboardCacheKey(query, dirs[0]));
  const legacyKey = withDataScope({ kind: 'legacy', feedbackDir: dirs[0] }, () => __test__.buildLiveDashboardCacheKey(query, dirs[0]));
  assert.notEqual(tenant, legacyKey);
});

test('paid session cookies continue to resolve the global identity store and the tenant content root', async () => {
  const session = await fetch(origin + '/v1/auth/session', { method: 'POST', headers: { authorization: 'Bearer ' + credentials[0], 'content-type': 'application/json' }, body: '{}' });
  assert.equal(session.status, 200);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const stats = await fetch(origin + '/v1/feedback/stats', { headers: { cookie } });
  assert.equal(stats.status, 200);
  assert.equal((await stats.json()).total, readRows(dirs[0], 'feedback-log.jsonl').length);
  assert.equal(fs.existsSync(path.join(dirs[0], 'api-keys.json')), false);
});

test('capture conversation fallback reads only the authenticated tenant history', async () => {
  for (const [index, dir] of [legacy, ...dirs].entries()) writeRows(dir, 'conversation-window.jsonl', [{ role: 'assistant', content: `Verified all tests passed for conversation-canary-${index}.`, timestamp: new Date().toISOString() }]);
  const response = await request('/v1/feedback/capture', credentials[0], { signal: 'up', context: 'thanks' });
  assert.equal(response.status, 200);
  const body = JSON.stringify(response.body);
  assert.equal(body.includes('conversation-canary-1'), true);
  assert.equal(body.includes('conversation-canary-0'), false);
  assert.equal(body.includes('conversation-canary-2'), false);
});

test('merchant funnel analytics requires admin authorization even with a global ledger override', async () => {
  const previousOverride = process.env.THUMBGATE_FUNNEL_LEDGER_PATH;
  const previousTestPath = process.env._TEST_FUNNEL_LEDGER_PATH;
  const merchantPath = path.join(legacy, 'merchant-funnel.jsonl');
  writeRows(legacy, 'merchant-funnel.jsonl', [{ stage: 'acquisition', event: 'merchant-funnel-canary', source: 'merchant-funnel-canary', timestamp: new Date().toISOString() }]);
  process.env.THUMBGATE_FUNNEL_LEDGER_PATH = merchantPath;
  delete process.env._TEST_FUNNEL_LEDGER_PATH;
  try {
    const tenant = await request('/v1/analytics/funnel', credentials[0]);
    assert.equal(tenant.status, 403, JSON.stringify({ status: tenant.status, merchantCanary: JSON.stringify(tenant.body).includes('merchant-funnel-canary') }));
    const owner = await request('/v1/analytics/funnel', admin);
    assert.equal(owner.status, 200);
    assert.equal(JSON.stringify(owner.body).includes('merchant-funnel-canary'), true);
  } finally {
    if (previousOverride === undefined) delete process.env.THUMBGATE_FUNNEL_LEDGER_PATH; else process.env.THUMBGATE_FUNNEL_LEDGER_PATH = previousOverride;
    if (previousTestPath === undefined) delete process.env._TEST_FUNNEL_LEDGER_PATH; else process.env._TEST_FUNNEL_LEDGER_PATH = previousTestPath;
  }
});

test('tenant agent file audits inspect the customer root rather than the service repository', async () => {
  fs.writeFileSync(path.join(dirs[0], '.mcp.json'), JSON.stringify({ mcpServers: { 'alpha-fixture': { command: 'node' } } }));
  const dashboard = await request('/v1/dashboard', credentials[0]);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.agentSurfaceInventory.totalAgentFiles, 1);
  assert.equal(dashboard.body.agentSurfaceInventory.highRiskCount, 0);
});
