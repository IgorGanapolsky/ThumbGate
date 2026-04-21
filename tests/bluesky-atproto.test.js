'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  atprotoRequest,
  resolvePdsHost,
  createSession,
  parseAtUri,
  isTransientAtprotoError,
  DEFAULT_PDS_HOST,
} = require('../scripts/lib/bluesky-atproto');

// Build a fake https.request-compatible function that captures the call shape
// and streams a response body back through data/end events. Lets us exercise
// the full transport without an actual network.
function makeFakeRequest({ status = 200, body = '', onRequest } = {}) {
  const calls = [];
  return {
    calls,
    request(options, callback) {
      const req = new EventEmitter();
      req.write = (chunk) => {
        const call = calls[calls.length - 1];
        call.writes.push(String(chunk));
      };
      req.end = () => {
        if (onRequest) onRequest(calls[calls.length - 1]);
        const res = new EventEmitter();
        res.statusCode = typeof status === 'function' ? status(calls[calls.length - 1]) : status;
        const payload = typeof body === 'function' ? body(calls[calls.length - 1]) : body;
        setImmediate(() => {
          callback(res);
          setImmediate(() => {
            if (payload) res.emit('data', Buffer.from(payload));
            res.emit('end');
          });
        });
      };
      calls.push({ options, writes: [] });
      return req;
    },
  };
}

test('atprotoRequest sends JSON body with correct headers', async () => {
  const fake = makeFakeRequest({ status: 200, body: JSON.stringify({ ok: true }) });
  const res = await atprotoRequest('POST', 'bsky.social', '/xrpc/com.example.echo', {
    body: { hello: 'world' },
    headers: { Authorization: 'Bearer abc' },
    request: fake.request,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
  assert.equal(fake.calls.length, 1);
  const { options, writes } = fake.calls[0];
  assert.equal(options.method, 'POST');
  assert.equal(options.host, 'bsky.social');
  assert.equal(options.path, '/xrpc/com.example.echo');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.headers.Authorization, 'Bearer abc');
  assert.equal(options.headers['Content-Length'], Buffer.byteLength('{"hello":"world"}'));
  assert.equal(writes.join(''), '{"hello":"world"}');
});

test('atprotoRequest omits content headers for GET without body', async () => {
  const fake = makeFakeRequest({ status: 200, body: JSON.stringify({ items: [] }) });
  const res = await atprotoRequest('GET', 'example.pds', '/xrpc/app.bsky.notification.listNotifications', {
    headers: { Authorization: 'Bearer token' },
    request: fake.request,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { items: [] });
  const { options, writes } = fake.calls[0];
  assert.equal(options.headers['Content-Type'], undefined);
  assert.equal(options.headers['Content-Length'], undefined);
  assert.equal(writes.length, 0);
});

test('atprotoRequest tolerates non-JSON response bodies', async () => {
  const fake = makeFakeRequest({ status: 502, body: '<html>UpstreamFailure</html>' });
  const res = await atprotoRequest('GET', 'bsky.social', '/xrpc/whatever', { request: fake.request });
  assert.equal(res.status, 502);
  assert.deepEqual(res.json, {});
  assert.equal(res.raw, '<html>UpstreamFailure</html>');
});

test('atprotoRequest rejects when the underlying socket errors', async () => {
  function request(_options, _cb) {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => setImmediate(() => req.emit('error', new Error('ECONNRESET')));
    return req;
  }
  await assert.rejects(
    atprotoRequest('GET', 'bsky.social', '/xrpc/whatever', { request }),
    /ECONNRESET/,
  );
});

test('resolvePdsHost parses valid didDoc service entries', () => {
  const didDoc = {
    service: [
      { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://jellybaby.us-east.host.bsky.network' },
    ],
  };
  assert.equal(resolvePdsHost(didDoc), 'jellybaby.us-east.host.bsky.network');
});

test('resolvePdsHost matches by type when id is missing', () => {
  const didDoc = {
    service: [{ type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com:8443/path' }],
  };
  assert.equal(resolvePdsHost(didDoc), 'pds.example.com:8443');
});

test('resolvePdsHost returns null for malformed didDoc', () => {
  assert.equal(resolvePdsHost(null), null);
  assert.equal(resolvePdsHost({}), null);
  assert.equal(resolvePdsHost({ service: 'nope' }), null);
  assert.equal(resolvePdsHost({ service: [{ id: '#atproto_pds' }] }), null);
  assert.equal(
    resolvePdsHost({ service: [{ id: '#atproto_pds', serviceEndpoint: 'not a url' }] }),
    null,
  );
});

test('createSession returns session with resolved PDS host', async () => {
  const fake = makeFakeRequest({
    status: 200,
    body: JSON.stringify({
      accessJwt: 'jwt-token',
      did: 'did:plc:abc',
      handle: 'example.bsky.social',
      didDoc: {
        service: [
          { id: '#atproto_pds', serviceEndpoint: 'https://pds.example.com' },
        ],
      },
    }),
  });

  const session = await createSession({
    env: { BLUESKY_HANDLE: 'example.bsky.social', BLUESKY_APP_PASSWORD: 'app-pw' },
    request: fake.request,
  });

  assert.equal(session.accessJwt, 'jwt-token');
  assert.equal(session.did, 'did:plc:abc');
  assert.equal(session.handle, 'example.bsky.social');
  assert.equal(session.pdsHost, 'pds.example.com');

  const { options, writes } = fake.calls[0];
  assert.equal(options.host, DEFAULT_PDS_HOST);
  assert.equal(options.path, '/xrpc/com.atproto.server.createSession');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(writes.join('')), {
    identifier: 'example.bsky.social',
    password: 'app-pw',
  });
});

test('createSession falls back to bsky.social when didDoc has no PDS', async () => {
  const fake = makeFakeRequest({
    status: 200,
    body: JSON.stringify({ accessJwt: 'j', did: 'd', handle: 'h', didDoc: {} }),
  });
  const session = await createSession({
    env: { BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' },
    request: fake.request,
  });
  assert.equal(session.pdsHost, DEFAULT_PDS_HOST);
});

test('createSession throws when credentials are missing', async () => {
  await assert.rejects(
    createSession({ env: {} }),
    /Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD/,
  );
  await assert.rejects(
    createSession({ env: { BLUESKY_HANDLE: 'x' } }),
    /Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD/,
  );
});

test('createSession throws on non-200 responses', async () => {
  const fake = makeFakeRequest({ status: 401, body: JSON.stringify({ error: 'AuthenticationRequired' }) });
  await assert.rejects(
    createSession({
      env: { BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' },
      request: fake.request,
    }),
    /status=401.*AuthenticationRequired/,
  );
});

test('parseAtUri extracts did, collection, rkey', () => {
  assert.deepEqual(
    parseAtUri('at://did:plc:abc/app.bsky.feed.post/3mjzhrhedcp2l'),
    { did: 'did:plc:abc', collection: 'app.bsky.feed.post', rkey: '3mjzhrhedcp2l' },
  );
});

test('parseAtUri returns null for malformed inputs', () => {
  assert.equal(parseAtUri(''), null);
  assert.equal(parseAtUri(null), null);
  assert.equal(parseAtUri('not-a-uri'), null);
  assert.equal(parseAtUri('at://did:plc:abc'), null);
  assert.equal(parseAtUri('at://did:plc:abc/app.bsky.feed.post'), null);
});

test('isTransientAtprotoError detects common upstream failures', () => {
  assert.equal(isTransientAtprotoError(new Error('listNotifications failed on pds: 502 UpstreamFailure')), true);
  assert.equal(isTransientAtprotoError(new Error('socket hang up: ECONNRESET')), true);
  assert.equal(isTransientAtprotoError(new Error('connect ETIMEDOUT 1.2.3.4:443')), true);
  assert.equal(isTransientAtprotoError(new Error('getaddrinfo ENOTFOUND bsky.social')), true);
  assert.equal(isTransientAtprotoError(new Error('Bluesky auth failed (status=401)')), false);
  assert.equal(isTransientAtprotoError(new Error('random unrelated failure')), false);
  assert.equal(isTransientAtprotoError(null), false);
  assert.equal(isTransientAtprotoError(undefined), false);
});
