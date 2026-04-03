'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const https = require('node:https');

const webhookDelivery = require('../scripts/webhook-delivery');

const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;

function installRequestStub(targetModule, implementation) {
  targetModule.request = implementation;
}

function restoreRequests() {
  http.request = originalHttpRequest;
  https.request = originalHttpsRequest;
}

test.after(() => {
  restoreRequests();
});

test('sendWebhook posts JSON payloads over https and resolves response metadata', async () => {
  let captured = null;
  installRequestStub(https, (url, options, callback) => {
    const response = new EventEmitter();
    response.statusCode = 202;
    const request = new EventEmitter();
    request.write = (body) => {
      captured = { url: url.toString(), options, body };
    };
    request.end = () => {
      callback(response);
      response.emit('data', 'accepted');
      response.emit('end');
    };
    request.destroy = () => {};
    return request;
  });

  const result = await webhookDelivery.sendWebhook('https://hooks.example.com/path', { ok: true });
  restoreRequests();

  assert.equal(captured.url, 'https://hooks.example.com/path');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['Content-Type'], 'application/json');
  assert.equal(captured.options.headers['Content-Length'], Buffer.byteLength('{"ok":true}'));
  assert.equal(captured.options.timeout, 10000);
  assert.equal(captured.body, '{"ok":true}');
  assert.deepEqual(result, { status: 202, body: 'accepted' });
});

test('sendWebhook uses http for plain http URLs', async () => {
  let usedHttp = false;
  installRequestStub(http, (_url, _options, callback) => {
    usedHttp = true;
    const response = new EventEmitter();
    response.statusCode = 200;
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      callback(response);
      response.emit('end');
    };
    request.destroy = () => {};
    return request;
  });

  const result = await webhookDelivery.sendWebhook('http://localhost:9999/hook', { ping: true });
  restoreRequests();

  assert.equal(usedHttp, true);
  assert.deepEqual(result, { status: 200, body: '' });
});

test('sendWebhook rejects on request errors', async () => {
  installRequestStub(https, (_url, _options, _callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      request.emit('error', new Error('network down'));
    };
    request.destroy = () => {};
    return request;
  });

  await assert.rejects(
    webhookDelivery.sendWebhook('https://hooks.example.com/path', { ok: false }),
    /network down/,
  );
  restoreRequests();
});

test('sendWebhook rejects on timeout after destroying the request', async () => {
  let destroyed = false;
  installRequestStub(https, (_url, _options, _callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      request.emit('timeout');
    };
    request.destroy = () => {
      destroyed = true;
    };
    return request;
  });

  await assert.rejects(
    webhookDelivery.sendWebhook('https://hooks.example.com/path', { ok: false }),
    /Webhook timeout/,
  );
  restoreRequests();

  assert.equal(destroyed, true);
});

test('deliverToTeams formats a MessageCard payload', async () => {
  installRequestStub(https, (_url, _options, callback) => {
    const response = new EventEmitter();
    response.statusCode = 200;
    const request = new EventEmitter();
    let body = '';
    request.write = (chunk) => {
      body += chunk;
    };
    request.end = () => {
      callback(response);
      response.emit('data', body);
      response.emit('end');
    };
    request.destroy = () => {};
    return request;
  });

  const result = await webhookDelivery.deliverToTeams('https://hooks.example.com/teams', 'ThumbGate', 'Daily pulse');
  restoreRequests();

  const payload = JSON.parse(result.body);
  assert.equal(payload['@type'], 'MessageCard');
  assert.equal(payload.summary, 'ThumbGate');
  assert.equal(payload.text, 'Daily pulse');
});

test('deliverToSlack formats markdown text payloads', async () => {
  installRequestStub(https, (_url, _options, callback) => {
    const response = new EventEmitter();
    response.statusCode = 200;
    const request = new EventEmitter();
    let body = '';
    request.write = (chunk) => {
      body += chunk;
    };
    request.end = () => {
      callback(response);
      response.emit('data', body);
      response.emit('end');
    };
    request.destroy = () => {};
    return request;
  });

  const result = await webhookDelivery.deliverToSlack('https://hooks.example.com/slack', 'ThumbGate', 'Daily pulse');
  restoreRequests();

  assert.deepEqual(JSON.parse(result.body), {
    text: '*ThumbGate*\nDaily pulse',
  });
});

test('deliverToDiscord truncates long messages to Discord embed limits', async () => {
  installRequestStub(https, (_url, _options, callback) => {
    const response = new EventEmitter();
    response.statusCode = 200;
    const request = new EventEmitter();
    let body = '';
    request.write = (chunk) => {
      body += chunk;
    };
    request.end = () => {
      callback(response);
      response.emit('data', body);
      response.emit('end');
    };
    request.destroy = () => {};
    return request;
  });

  const result = await webhookDelivery.deliverToDiscord(
    'https://hooks.example.com/discord',
    'ThumbGate',
    'x'.repeat(5000),
  );
  restoreRequests();

  const payload = JSON.parse(result.body);
  assert.equal(payload.embeds[0].title, 'ThumbGate');
  assert.equal(payload.embeds[0].description.length, 4096);
  assert.equal(payload.embeds[0].color, 0x0076D7);
});

test('deliver falls back to a generic payload for unknown platforms', async () => {
  installRequestStub(https, (_url, _options, callback) => {
    const response = new EventEmitter();
    response.statusCode = 200;
    const request = new EventEmitter();
    let body = '';
    request.write = (chunk) => {
      body += chunk;
    };
    request.end = () => {
      callback(response);
      response.emit('data', body);
      response.emit('end');
    };
    request.destroy = () => {};
    return request;
  });

  const result = await webhookDelivery.deliver('custom', 'https://hooks.example.com/custom', 'ThumbGate', 'Daily pulse');
  restoreRequests();

  assert.deepEqual(JSON.parse(result.body), {
    title: 'ThumbGate',
    message: 'Daily pulse',
  });
});
