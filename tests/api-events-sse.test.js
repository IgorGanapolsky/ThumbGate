/**
 * Server-Sent Events contract for the dashboard live feed.
 *
 * The dashboard subscribes to `/v1/events` over SSE so feedback captures and
 * rule regenerations land in the UI the moment they happen — no polling.
 * This file pins that contract:
 *
 *   1. Unauthenticated connections are rejected (no leaking event stream).
 *   2. Authenticated connections receive an initial `connected` handshake
 *      carrying the server version.
 *   3. Posting a feedback capture fans out a `feedback` event to every
 *      connected subscriber before the HTTP response returns to the poster.
 *   4. Regenerating prevention rules fans out a `rules-updated` event.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sse-test-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sse-proof-'));
delete process.env.THUMBGATE_PROJECT_DIR;
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.INIT_CWD;
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
process.env.THUMBGATE_API_KEY = 'sse-test-key';
process.env._TEST_API_KEYS_PATH = path.join(tmpFeedbackDir, 'api-keys.json');
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';
process.env.THUMBGATE_PUBLIC_APP_ORIGIN = 'https://app.example.com';

const { startServer } = require('../src/api/server');
const pkg = require('../package.json');

let handle;
let apiOrigin = '';
const authHeader = { authorization: 'Bearer sse-test-key' };

test.before(async () => {
  handle = await startServer({ port: 0 });
  apiOrigin = `http://localhost:${handle.port}`;
});

test.after(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  fs.rmSync(tmpProofDir, { recursive: true, force: true });
});

// Open an SSE stream and yield parsed {event, data} frames as they arrive.
// Returns { next, close } where `next()` resolves to the next non-heartbeat
// frame or rejects on timeout.
async function openEventStream() {
  const ac = new AbortController();
  const res = await fetch(`${apiOrigin}/v1/events`, {
    headers: authHeader,
    signal: ac.signal,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.equal(res.headers.get('x-accel-buffering'), 'no');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const queue = [];
  const waiters = [];

  function parseFrame(frame) {
    if (!frame || frame.startsWith(':')) return null;
    let eventName = 'message';
    const dataLines = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return null;
    try { return { event: eventName, data: JSON.parse(dataLines.join('\n')) }; }
    catch (_) { return null; }
  }

  (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const raw of frames) {
          const parsed = parseFrame(raw);
          if (!parsed) continue;
          if (waiters.length) waiters.shift()(parsed);
          else queue.push(parsed);
        }
      }
    } catch (_) { /* aborted */ }
  })();

  function next(timeoutMs = 2000) {
    if (queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(bound);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`SSE frame timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      function bound(frame) { clearTimeout(timer); resolve(frame); }
      waiters.push(bound);
    });
  }

  function close() {
    try { ac.abort(); } catch (_) { /* already */ }
  }

  return { next, close };
}

test('SSE /v1/events rejects unauthenticated connections', async () => {
  const res = await fetch(`${apiOrigin}/v1/events`);
  assert.ok(res.status === 401 || res.status === 403, `expected auth failure, got ${res.status}`);
  // Drain/close to avoid leaking the connection.
  try { await res.text(); } catch (_) { /* ignore */ }
});

test('SSE /v1/events sends a connected handshake with the server version', async () => {
  const stream = await openEventStream();
  try {
    const frame = await stream.next();
    assert.equal(frame.event, 'connected');
    assert.equal(frame.data.version, pkg.version);
    assert.equal(typeof frame.data.ts, 'number');
  } finally {
    stream.close();
  }
});

test('POST /v1/feedback/capture fans out a feedback event to subscribers', async () => {
  const stream = await openEventStream();
  try {
    const handshake = await stream.next();
    assert.equal(handshake.event, 'connected');

    const post = await fetch(`${apiOrigin}/v1/feedback/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader },
      body: JSON.stringify({
        signal: 'up',
        context: 'SSE broadcast smoke test',
        whatWorked: 'live events',
        tags: ['sse', 'dashboard'],
      }),
    });
    assert.equal(post.status, 200);
    const body = await post.json();
    assert.equal(body.accepted, true);

    const frame = await stream.next();
    assert.equal(frame.event, 'feedback');
    assert.equal(frame.data.type, 'feedback');
    assert.equal(frame.data.signal, 'up');
    assert.deepEqual(frame.data.tags, ['sse', 'dashboard']);
    assert.equal(typeof frame.data.ts, 'number');
    assert.equal(frame.data.feedbackId, body.feedbackId);
  } finally {
    stream.close();
  }
});

test('POST /v1/feedback/rules fans out a rules-updated event to subscribers', async () => {
  const stream = await openEventStream();
  try {
    const handshake = await stream.next();
    assert.equal(handshake.event, 'connected');

    const outputPath = path.join(tmpFeedbackDir, 'prevention-rules.md');
    const post = await fetch(`${apiOrigin}/v1/feedback/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader },
      body: JSON.stringify({ minOccurrences: 1, outputPath }),
    });
    assert.equal(post.status, 200);

    const frame = await stream.next();
    assert.equal(frame.event, 'rules-updated');
    assert.equal(frame.data.type, 'rules-updated');
    assert.equal(typeof frame.data.ts, 'number');
    assert.equal(typeof frame.data.path, 'string');
  } finally {
    stream.close();
  }
});
