const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-quick-ui-'));
process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
process.env.THUMBGATE_API_KEY = 'quick-ui-test-key';
process.env.THUMBGATE_DISABLE_TELEMETRY = '1';
process.env.THUMBGATE_NO_TELEMETRY = '1';
process.env.THUMBGATE_NO_NUDGE = '1';
process.env._TEST_API_KEYS_PATH = path.join(feedbackDir, 'keys.json');
const { startServer } = require('../src/api/server');
const { recordConversationEntry } = require('../scripts/feedback-history-distiller');
const { readJsonl } = require('../scripts/fs-utils');
const { waitForBackgroundSideEffects } = require('../scripts/feedback-loop');
let handle;
let origin;
const headers = { authorization: 'Bearer quick-ui-test-key', 'content-type': 'application/json' };
const payload = (overrides = {}) => ({ signal: 'up', reasonIds: ['solved-task'], includeConversationContext: false, submissionId: 'test-submission-0001', ...overrides });
const post = (body, requestHeaders = headers) => fetch(`${origin}/v1/feedback/capture`, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
const rows = () => readJsonl(path.join(feedbackDir, 'feedback-log.jsonl'));

test.before(async () => {
  handle = await startServer({ port: 0, host: '127.0.0.1' });
  origin = `http://127.0.0.1:${handle.port}`;
});
test.after(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
  await waitForBackgroundSideEffects();
  fs.rmSync(feedbackDir, { recursive: true, force: true });
});

test('quick page offers labelled choices without GET or HEAD writes', async () => {
  const before = rows().length;
  const response = await fetch(`${origin}/feedback/quick?signal=up`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /What worked well\?/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /Details \(optional\)/);
  assert.match(html, /type="password"/);
  assert.match(html, /\/v1\/feedback\/capture/);
  assert.doesNotMatch(html, /quick-ui-test-key|localStorage/);
  assert.equal((await fetch(`${origin}/feedback/quick?signal=down`, { method: 'HEAD' })).status, 200);
  assert.equal(rows().length, before);
});

test('chip-only capture excludes seeded history and cannot promote a lesson', async () => {
  recordConversationEntry({ author: 'user', text: 'Never skip tests before claiming done.' }, { feedbackDir });
  recordConversationEntry({ author: 'assistant', text: 'I claimed done without running npm test.' }, { feedbackDir });
  const response = await post(payload());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.promoted, false);
  assert.equal(result.feedbackEvent.whatWorked, null);
  assert.equal(result.feedbackEvent.context, '');
  assert.equal(result.feedbackEvent.conversationWindow, null);
  assert.ok(result.feedbackEvent.tags.includes('feedback-reason:solved-task'));
  assert.ok(result.feedbackEvent.id);
});

test('retries keep one identity while edits create a new capture and preserve details', async () => {
  const before = rows().length;
  const body = payload({ submissionId: 'test-submission-0002', whatWorked: 'The response cited the exact failing test and verified the corrected behavior.' });
  const first = await (await post(body)).json();
  const retry = await (await post(body)).json();
  assert.equal(retry.feedbackEvent.id, first.feedbackEvent.id);
  assert.equal(rows().length, before + 1);
  assert.equal(first.feedbackEvent.whatWorked, body.whatWorked);
  const changed = await (await post({ ...body, whatWorked: 'The response preserved the optional details without adding unrelated conversation history.' })).json();
  assert.notEqual(changed.feedbackEvent.id, first.feedbackEvent.id);
  assert.equal(rows().length, before + 2);
});

test('invalid metadata and unauthorized requests fail before capture', async () => {
  const before = rows().length;
  for (const invalid of [
    { reasonIds: ['made-up'] }, { reasonIds: ['unresolved-task'] },
    { reasonIds: Array(7).fill('solved-task') }, { submissionId: '../bad' },
    { includeConversationContext: 'false' }, { whatWorked: 'x'.repeat(4001) },
    { sourceEvent: { key: 'untrusted-id' } },
  ]) {
    const response = await post(payload(invalid));
    assert.equal(response.status, 400, JSON.stringify(invalid).slice(0, 100));
  }
  assert.equal((await post(payload(), { 'content-type': 'application/json' })).status, 401);
  assert.equal(rows().length, before);
});


test('identical submissions stay private and deduplicate only within each hosted tenant', async () => {
  const billing = require('../scripts/billing');
  const keys = ['tenant-a', 'tenant-b'].map((id) => billing.provisionApiKey(`cus_quick_${id}`, { installId: `install-${id}` }).key);
  const auth = keys.map((key) => ({ ...headers, authorization: `Bearer ${key}` }));
  const body = payload({ submissionId: 'tenant-submission-0001' });
  const before = rows().length;
  const [first, second] = await Promise.all(auth.map(async (requestHeaders) => (await post(body, requestHeaders)).json()));
  const retry = await (await post(body, auth[0])).json();
  assert.ok(first.feedbackEvent?.id);
  assert.ok(second.feedbackEvent?.id);
  assert.notEqual(first.feedbackEvent.id, second.feedbackEvent.id);
  assert.equal(first.feedbackEvent.id, retry.feedbackEvent.id);
  assert.equal(rows().length, before);
  const tenantRows = fs.readdirSync(path.join(feedbackDir, 'tenants')).map((tenant) => readJsonl(path.join(feedbackDir, 'tenants', tenant, 'feedback-log.jsonl')));
  assert.deepEqual(tenantRows.map((records) => records.length), [1, 1]);
  assert.equal(new Set(tenantRows.flat().map((record) => record.id)).size, 2);
  const details = ['Tenant A received a tested correction for the checkout validation bug.', 'Tenant B received a source-backed answer for the API authentication setup.'];
  const captures = await Promise.all(auth.map(async (requestHeaders, i) => (await post({ ...body, whatWorked: details[i] }, requestHeaders)).json()));
  assert.deepEqual(captures.map((result) => result.feedbackEvent.whatWorked), details);
  await waitForBackgroundSideEffects();
  for (const tenant of fs.readdirSync(path.join(feedbackDir, 'tenants'))) {
    const records = readJsonl(path.join(feedbackDir, 'tenants', tenant, 'feedback-log.jsonl'));
    assert.equal(records.length, 2);
    assert.equal(records.filter((record) => details.includes(record.whatWorked)).length, 1);
  }
  assert.equal(rows().length, before);
});

test('internal explicit history exclusion ignores every supplied conversation shape', () => {
  const { captureFeedback } = require('../scripts/feedback-loop');
  const history = [{ role: 'user', content: 'Never skip tests before claiming done.' }, { role: 'assistant', content: 'I skipped tests and claimed done.' }];
  const result = captureFeedback({ signal: 'down', includeConversationContext: false, chatHistory: history, conversationWindow: history });
  assert.equal(result.promoted, false);
  assert.equal(result.feedbackEvent.whatWentWrong, null);
  assert.equal(result.feedbackEvent.conversationWindow, null);
});


test('request directory scopes survive asynchronous work without changing global defaults', async () => {
  const { runWithFeedbackDir, resolveFeedbackDir } = require('../scripts/feedback-paths');
  const observed = await Promise.all(['scope-a', 'scope-b'].map((name) => runWithFeedbackDir(path.join(feedbackDir, name), async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return resolveFeedbackDir();
  })));
  assert.deepEqual(observed, ['scope-a', 'scope-b'].map((name) => path.join(feedbackDir, name)));
  assert.equal(resolveFeedbackDir(), feedbackDir);
});


test('feedback event streams deliver reasons only to their authenticated tenant', async () => {
  const billing = require('../scripts/billing');
  const keys = ['stream-a', 'stream-b'].map((id) => billing.provisionApiKey(`cus_quick_${id}`, { installId: id }).key);
  const controllers = keys.map(() => new AbortController());
  const streams = await Promise.all(keys.map(async (key, index) => {
    const response = await fetch(`${origin}/v1/events`, { headers: { authorization: `Bearer ${key}` }, signal: controllers[index].signal });
    const reader = response.body.getReader();
    await reader.read();
    return reader;
  }));
  try {
    const captures = await Promise.all(keys.map(async (key, index) => (await post(payload({ submissionId: `stream-submission-000${index}`, reasonIds: [index === 0 ? 'efficient' : 'useful-autonomy'] }), { ...headers, authorization: `Bearer ${key}` })).json()));
    const messages = await Promise.all(streams.map(async (reader) => new TextDecoder().decode((await reader.read()).value)));
    messages.forEach((message, index) => {
      assert.ok(message.includes(captures[index].feedbackEvent.id));
      assert.ok(!message.includes(captures[1 - index].feedbackEvent.id));
      assert.ok(!message.includes('dataPartition'));
    });
  } finally {
    controllers.forEach((controller) => controller.abort());
  }
});


test('static configured stores are preserved while hosted writes ignore those shared overrides', async () => {
  const Database = require('better-sqlite3');
  const configuredDb = path.join(feedbackDir, 'configured.sqlite');
  const configuredContext = path.join(feedbackDir, 'configured-contextfs');
  const oldDb = process.env.LESSON_DB_PATH;
  const oldContext = process.env.THUMBGATE_CONTEXTFS_DIR;
  process.env.LESSON_DB_PATH = configuredDb;
  process.env.THUMBGATE_CONTEXTFS_DIR = configuredContext;
  try {
    const result = await (await post(payload({ submissionId: 'configured-static-0001', whatWorked: 'The response explained the request validation failure and verified the corrected API behavior.' }))).json();
    assert.equal(result.promoted, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(fs.existsSync(configuredDb));
    assert.ok(fs.existsSync(configuredContext));
    const db = new Database(configuredDb, { readonly: true });
    try {
      const before = db.prepare('SELECT COUNT(*) AS count FROM lessons').get().count;
      const key = require('../scripts/billing').provisionApiKey('cus_configured_store_tenant', { installId: 'configured-store-tenant' }).key;
      const hosted = await (await post(payload({ submissionId: 'configured-hosted-0001', whatWorked: 'The hosted response preserved tenant-specific feedback details and verified isolated persistence.' }), { ...headers, authorization: `Bearer ${key}` })).json();
      assert.equal(hosted.promoted, true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lessons').get().count, before);
      const hostedDirectories = fs.readdirSync(path.join(feedbackDir, 'tenants')).map((name) => path.join(feedbackDir, 'tenants', name));
      const hostedDirectory = hostedDirectories.find((dir) => readJsonl(path.join(dir, 'feedback-log.jsonl')).some((row) => row.id === hosted.feedbackEvent.id));
      assert.ok(fs.existsSync(path.join(hostedDirectory, 'lessons.sqlite')));
      assert.ok(fs.existsSync(path.join(hostedDirectory, 'contextfs')));
    } finally { db.close(); }
  } finally {
    if (oldDb === undefined) delete process.env.LESSON_DB_PATH;
    else process.env.LESSON_DB_PATH = oldDb;
    if (oldContext === undefined) delete process.env.THUMBGATE_CONTEXTFS_DIR;
    else process.env.THUMBGATE_CONTEXTFS_DIR = oldContext;
  }
});
