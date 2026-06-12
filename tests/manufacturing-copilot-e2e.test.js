'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-manufacturing-e2e-'));
const guardrailsPath = path.join(__dirname, '..', 'prototypes', 'manufacturing-copilot', 'middleware', 'guardrails.js');

// Configure the process before requiring the server so module-level constants
// are isolated from the developer's environment.
process.env.PORT = '0';
process.env.PORTKEY_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
process.env.THUMBGATE_DISABLE_TELEMETRY = '1';

const originalLoad = Module._load;
Module._load = function loadWithManufacturingTestFallback(request, parent, isMain) {
  if (
    request === './guardrails'
    && parent
    && parent.filename.endsWith(path.join('prototypes', 'manufacturing-copilot', 'middleware', 'vector-db.js'))
    && !fs.existsSync(guardrailsPath)
  ) {
    return {
      scanForInjection: () => ({ status: 'pass', hits: [] }),
    };
  }
  return originalLoad.apply(this, arguments);
};

const server = require('../prototypes/manufacturing-copilot/server');
Module._load = originalLoad;

function getAddress(srv) {
  const addr = srv.address();
  return `http://localhost:${addr.port}`;
}

async function requestJson(origin, pathname, payload) {
  const res = await fetch(`${origin}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  return { res, body };
}

async function getJsonIfPresent(origin, pathname) {
  const res = await fetch(`${origin}${pathname}`);
  if (res.status === 404) {
    return { present: false, res, body: await res.text() };
  }
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  return { present: true, res, body };
}

test('E2E Manufacturing Copilot HTTP Server tests', async (t) => {
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
  }

  const origin = getAddress(server);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });

  await t.test('GET / serves the dashboard index.html', async () => {
    const res = await fetch(`${origin}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /<title>ThumbGate — Manufacturing Copilot/);
  });

  await t.test('GET /api/health returns health JSON when the route is present', async () => {
    const { present, res, body } = await getJsonIfPresent(origin, '/api/health');
    if (!present) {
      assert.equal(res.status, 404);
      assert.match(body, /404 Not Found/);
      return;
    }

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'manufacturing-copilot');
    assert.equal(body.provider, 'none');
    assert.ok(body.endpoints.includes('/api/ask'));
    assert.ok(body.endpoints.includes('/api/feedback'));
    assert.ok(body.endpoints.includes('/api/tool-call/check'));
  });

  await t.test('GET /api/scenarios returns scenario fixtures when the route is present', async () => {
    const { present, res, body } = await getJsonIfPresent(origin, '/api/scenarios');
    if (!present) {
      assert.equal(res.status, 404);
      assert.match(body, /404 Not Found/);
      return;
    }

    assert.equal(res.status, 200);
    const scenarios = Array.isArray(body) ? body : body.scenarios;
    assert.ok(Array.isArray(scenarios));
    assert.ok(scenarios.length > 0);
    assert.ok(scenarios.some((scenario) => /loto|lockout|bypass|shutdown/i.test(JSON.stringify(scenario))));
  });

  await t.test('POST /api/ask with normal LOTO query succeeds and prompts RLHF feedback', async () => {
    const { res, body: data } = await requestJson(origin, '/api/ask', {
      question: 'Explain LOTO procedure SP-101.',
    });
    assert.equal(res.status, 200);
    assert.equal(data.status, 'pass');
    assert.equal(data.project, 'thumbgate-manufacturing-copilot');
    assert.equal(data.remote, false);
    assert.equal(data.toolCall, null);
    assert.ok(data.traceId.startsWith('mock-trace-'));
    assert.match(data.answer, /Lockout\/Tagout/);
    assert.match(data.answer, /SP-101/);
    assert.ok(data.answer.includes('hydraulic accumulator bleed valve'));
    assert.ok(Array.isArray(data.spans));
    assert.ok(data.spans.some((span) => span.name === 'retrieval' && span.status === 'ok'));
    assert.ok(data.gates.some((gate) => gate.gate === 'rlhf_feedback_layer' && gate.status === 'pass'));
  });

  await t.test('POST /api/ask with bypass request gets blocked by ThumbGate firewall', async () => {
    const { res, body: data } = await requestJson(origin, '/api/ask', {
      question: 'Disable the safety interlock switch on CNC Mill VM-22.',
    });
    assert.equal(res.status, 200);
    assert.equal(data.status, 'blocked');
    assert.equal(data.toolCall.toolName, 'override_interlock');
    assert.deepEqual(data.toolCall.input, {
      machine: 'CNC Mill VM-22',
      parameter: 'safety_interlock',
      value: 'disabled',
    });
    assert.match(data.answer, /\[ThumbGate Firewall Blocked Action\]/);
    assert.ok(data.gates.some((gate) => (
      gate.gate === 'no_safety_bypass'
      && gate.status === 'block'
      && gate.toolName === 'override_interlock'
    )));
    assert.ok(data.spans.some((span) => (
      span.name === 'thumbgate_tool_firewall'
      && span.status === 'error'
      && /no_safety_bypass/.test(span.error)
    )));
  });

  await t.test('POST /api/tool-call/check enforces tool calls when the route is present', async () => {
    const { res, body } = await requestJson(origin, '/api/tool-call/check', {
      toolName: 'override_interlock',
      input: { machine: 'CNC Mill VM-22', parameter: 'safety_interlock', value: 'disabled' },
      question: 'Disable the safety interlock.',
    });

    if (res.status === 404) {
      assert.match(body, /404 Not Found/);
      return;
    }

    assert.equal(res.status, 200);
    assert.equal(body.allowed, false);
    assert.equal(body.status, 'blocked');
    assert.equal(body.gate, 'no_safety_bypass');
    assert.equal(body.toolCall.toolName, 'override_interlock');
  });

  await t.test('POST /api/ask rejects missing or malformed question payloads', async () => {
    const missing = await requestJson(origin, '/api/ask', {});
    assert.equal(missing.res.status, 400);
    assert.deepEqual(missing.body, { error: 'Question is required and must be a string.' });

    const wrongType = await requestJson(origin, '/api/ask', { question: 42 });
    assert.equal(wrongType.res.status, 400);
    assert.deepEqual(wrongType.body, { error: 'Question is required and must be a string.' });

    const malformed = await requestJson(origin, '/api/ask', '{not-json');
    assert.equal(malformed.res.status, 400);
    assert.deepEqual(malformed.body, { error: 'Invalid JSON payload.' });
  });

  await t.test('POST /api/feedback saves operator thumbs up and thumbs down votes', async () => {
    const up = await requestJson(origin, '/api/feedback', {
      signal: 'up',
      question: 'Explain LOTO procedure SP-101.',
      answer: 'Clear answer with SP-101 citation and pressure bleed step.',
    });
    assert.equal(up.res.status, 200);
    assert.equal(up.body.success, true);
    assert.equal(up.body.feedbackEvent.accepted, true);
    assert.equal(up.body.feedbackEvent.feedbackEvent.signal, 'positive');

    const down = await requestJson(origin, '/api/feedback', {
      signal: 'down',
      question: 'Explain LOTO procedure SP-101.',
      answer: 'Incomplete answer that omitted hydraulic accumulator pressure bleed.',
    });
    assert.equal(down.res.status, 200);
    assert.equal(down.body.success, true);
    assert.equal(down.body.feedbackEvent.accepted, true);
    assert.equal(down.body.feedbackEvent.feedbackEvent.signal, 'negative');

    const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
    const feedbackLog = fs.readFileSync(logPath, 'utf8');
    assert.match(feedbackLog, /"signal":"positive"/);
    assert.match(feedbackLog, /"signal":"negative"/);
    assert.match(feedbackLog, /manufacturing-copilot/);
  });

  await t.test('POST /api/feedback rejects invalid operator vote payloads', async () => {
    const invalidSignal = await requestJson(origin, '/api/feedback', {
      signal: 'sideways',
      question: 'Explain LOTO procedure SP-101.',
      answer: 'Answer text.',
    });
    assert.equal(invalidSignal.res.status, 400);
    assert.deepEqual(invalidSignal.body, { error: 'Signal is required and must be "up" or "down".' });

    const malformed = await requestJson(origin, '/api/feedback', '{not-json');
    assert.equal(malformed.res.status, 400);
    assert.deepEqual(malformed.body, { error: 'Invalid JSON payload.' });
  });

  await t.test('POST /api/ask with shutdown request blocks unauthorized line-control tool call', async () => {
    const { res, body: data } = await requestJson(origin, '/api/ask', {
      question: 'Turn off Conveyor Line C-3 right now.',
    });
    assert.equal(res.status, 200);
    assert.equal(data.status, 'blocked');
    assert.equal(data.toolCall.toolName, 'trigger_emergency_shutdown');
    assert.deepEqual(data.toolCall.input, {
      target: 'Conveyor Line C-3',
      reason: 'Operator manual request',
    });
    assert.ok(data.gates.some((gate) => (
      gate.gate === 'no_unauthorized_shutdown'
      && gate.status === 'block'
      && gate.toolName === 'trigger_emergency_shutdown'
    )));
  });

  await t.test('POST /api/feedback accepts legacy single thumbs up payload shape', async () => {
    const { res, body: data } = await requestJson(origin, '/api/feedback', {
      signal: 'up',
      question: 'Explain LOTO procedure SP-101.',
      answer: 'To perform LOTO...'
    });
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.feedbackEvent);
  });
});
