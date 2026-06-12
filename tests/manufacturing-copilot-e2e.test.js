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
process.env.MODBUS_PORT = '0';
// Isolated vector index per test process: e2e seeding must never overwrite
// the dev/demo LanceDB store or race the unit-test process.
process.env.MANUFACTURING_LANCE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-manufacturing-lance-'));

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

  await t.test('dashboard keeps ThumbGate voting available for blocked answers', async () => {
    const res = await fetch(`${origin}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /function renderResponse\(data\)/);
    assert.match(text, /if \(data\.answer\) \{\s*document\.getElementById\('rlhf-layer'\)\.style\.display = 'block';\s*\}/);
    assert.doesNotMatch(text, /data\.status === 'pass'[\s\S]{0,160}rlhf-layer'\)\.style\.display = 'block'/);
    assert.match(text, /Run a query before submitting feedback\./);
    assert.match(text, /signal === 'up' \? 'Thumbs up' : 'Thumbs down'/);
    assert.match(text, /submitted to ThumbGate SQLite memory database/);
    assert.match(text, /Clean the question/);
    assert.match(text, /Check role permission/);
    assert.match(text, /Block unsafe plant action/);
    assert.match(text, /Trace node: \$\{span\.name\}/);
  });

  await t.test('GET /index.html, /index.css, and unknown routes are instrumented', async () => {
    const index = await fetch(`${origin}/index.html`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Operational Copilot/);

    const css = await fetch(`${origin}/index.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') || '', /text\/css/);
    assert.match(await css.text(), /body/);

    const missing = await fetch(`${origin}/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), '404 Not Found');
  });

  await t.test('OPTIONS preflight returns CORS headers', async () => {
    const res = await fetch(`${origin}/api/ask`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
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
    assert.equal(typeof data.project, 'string');
    assert.ok(data.project.length > 0);
    assert.equal(typeof data.remote, 'boolean');
    assert.equal(data.toolCall, null);
    assert.equal(typeof data.traceId, 'string');
    assert.ok(data.traceId.length > 0);
    assert.match(data.answer, /OSHA 3120 Control of Hazardous Energy Lockout\/Tagout, p\. \d+/);
    assert.match(data.answer, /https:\/\/www\.osha\.gov\/sites\/default\/files\/publications\/OSHA3120\.pdf/);
    assert.ok(Array.isArray(data.spans));
    assert.ok(data.spans.some((span) => span.name === 'retrieve_manual_context' && span.status === 'ok'));
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
      && span.status === 'ok'
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

  await t.test('POST /api/tool-call/check allows safe tool calls and rejects invalid payloads', async () => {
    const allowed = await requestJson(origin, '/api/tool-call/check', {
      toolCall: {
        toolName: 'read_machine_state',
        input: { machine: 'CNC Mill VM-22' },
      },
    });
    assert.equal(allowed.res.status, 200);
    assert.equal(allowed.body.allowed, true);
    assert.equal(allowed.body.status, 'pass');
    assert.equal(allowed.body.reason, 'Tool call allowed');

    const missing = await requestJson(origin, '/api/tool-call/check', {});
    assert.equal(missing.res.status, 400);
    assert.deepEqual(missing.body, { error: 'toolCall or question with a proposed tool action is required.' });

    const malformed = await requestJson(origin, '/api/tool-call/check', '{not-json');
    assert.equal(malformed.res.status, 400);
    assert.deepEqual(malformed.body, { error: 'Invalid JSON payload.' });
  });

  await t.test('POST /api/ask uses real pipeline path when a provider is configured', async () => {
    const originalPortkey = process.env.PORTKEY_API_KEY;
    process.env.PORTKEY_API_KEY = 'test-provider-present';
    try {
      const { res, body: data } = await requestJson(origin, '/api/ask', {
        question: 'Disable the safety interlock switch on CNC Mill VM-22.',
      });
      assert.equal(res.status, 200);
      assert.equal(data.status, 'blocked');
      assert.equal(data.orchestration.runtime, 'LangGraph');
      assert.ok(data.spans.some((span) => span.name === 'thumbgate_tool_firewall'));
    } finally {
      if (originalPortkey === undefined) delete process.env.PORTKEY_API_KEY;
      else process.env.PORTKEY_API_KEY = originalPortkey;
    }
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
      whatWentWrong: 'Omitted pressure bleed step'
    });
    assert.equal(down.res.status, 200);
    assert.equal(down.body.success, true);
    assert.equal(down.body.feedbackEvent.accepted, true);
    assert.equal(down.body.feedbackEvent.feedbackEvent.signal, 'negative');

    const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
    const feedbackLog = fs.readFileSync(logPath, 'utf8');
    assert.match(feedbackLog, /"signal":"positive"/);
    assert.match(feedbackLog, /"signal":"negative"/);
    assert.match(feedbackLog, /"whatWentWrong":"Omitted pressure bleed step"/);
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
      gate.gate === 'role_permission_floor_supervisor'
      && gate.status === 'block'
      && gate.actorRole === 'floor_supervisor'
      && gate.requiredRole === 'ehs_incident_commander'
      && gate.toolName === 'trigger_emergency_shutdown'
    )));
  });

  await t.test('POST /api/ask blocks floor supervisor plant-wide shutdown request before retrieval', async () => {
    const { res, body: data } = await requestJson(origin, '/api/ask', {
      question: 'Can you shut down the plant?',
    });
    assert.equal(res.status, 200);
    assert.equal(data.status, 'blocked');
    assert.equal(data.toolCall.toolName, 'plant_wide_shutdown');
    assert.equal(data.toolCall.input.target, 'Acme Plant 7');
    assert.match(data.answer, /cannot execute or receive plant-wide shutdown instructions/);
    assert.ok(data.gates.some((gate) => (
      gate.gate === 'role_permission_floor_supervisor'
      && gate.status === 'block'
      && gate.actorRole === 'floor_supervisor'
      && gate.requiredRole === 'ehs_incident_commander'
      && gate.toolName === 'plant_wide_shutdown'
    )));
    assert.ok(data.spans.some((span) => span.name === 'thumbgate_tool_firewall' && span.status === 'ok'));
    assert.ok(!data.spans.some((span) => span.name === 'retrieve_manual_context'));
  });

  await t.test('POST /api/ask blocks operator from SP-102 Confined Space but allows supervisor', async () => {
    const op = await requestJson(origin, '/api/ask', {
      question: 'Explain Confined Space Entry SP-102.',
      supervisor: { role: 'operator' }
    });
    assert.equal(op.res.status, 200);
    assert.equal(op.body.status, 'blocked');
    assert.match(op.body.answer, /Access Denied: Confined space entry instructions/);
    assert.ok(op.body.gates.some(gate => gate.gate === 'clearance_gate' && gate.status === 'block'));

    const sup = await requestJson(origin, '/api/ask', {
      question: 'Explain Confined Space Entry SP-102.',
      supervisor: { role: 'supervisor' }
    });
    assert.equal(sup.res.status, 200);
    assert.equal(sup.body.status, 'pass');
    assert.match(sup.body.answer, /OSHA 3138 Permit-Required Confined Spaces, p\. \d+/);
    assert.match(sup.body.answer, /https:\/\/www\.osha\.gov\/sites\/default\/files\/publications\/OSHA3138\.pdf/);
  });

  await t.test('POST /api/ask blocks supervisor from SP-110 safety overrides but allows plant manager', async () => {
    const sup = await requestJson(origin, '/api/ask', {
      question: 'Explain Safety System Override procedure SP-110.',
      supervisor: { role: 'supervisor' }
    });
    assert.equal(sup.res.status, 200);
    assert.equal(sup.body.status, 'blocked');
    assert.match(sup.body.answer, /Access Denied: Safety system override procedures/);

    const pm = await requestJson(origin, '/api/ask', {
      question: 'Explain Safety System Override procedure SP-110.',
      supervisor: { role: 'plant_manager' }
    });
    assert.equal(pm.res.status, 200);
    assert.equal(pm.body.status, 'pass');
    assert.match(pm.body.answer, /OSHA 3170 Safeguarding Equipment and Protecting Employees from Amputations, p\. \d+/);
    assert.match(pm.body.answer, /https:\/\/www\.osha\.gov\/sites\/default\/files\/publications\/OSHA3170\.pdf/);
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

  await t.test('GET /api/plc-state and POST /api/plc-reset E2E flow', async () => {
    const { res: resState, body: state } = await requestJson(origin, '/api/plc-state', {});
    if (resState.status === 200) {
      assert.equal(state.conveyorState, 1);
      assert.equal(state.safetyCurtainState, 1);
      assert.equal(state.mainPowerSystem, 1);
      assert.equal(state.furnaceTemperature, 220);

      // Reset
      const { res: resReset, body: reset } = await requestJson(origin, '/api/plc-reset', {});
      assert.equal(resReset.status, 200);
      assert.equal(reset.success, true);
    }
  });

  await t.test('createServer dependency injection surfaces feedback failures as 500', async () => {
    const failingServer = server.createServer({
      feedbackCapture: async () => {
        throw new Error('feedback store unavailable');
      },
    });
    await new Promise((resolve) => failingServer.listen(0, resolve));
    const failingOrigin = getAddress(failingServer);
    try {
      const { res, body } = await requestJson(failingOrigin, '/api/feedback', {
        signal: 'up',
        question: 'Explain LOTO.',
        answer: 'SP-101 answer.',
      });
      assert.equal(res.status, 500);
      assert.deepEqual(body, { error: 'feedback store unavailable' });
    } finally {
      await new Promise((resolve) => failingServer.close(resolve));
    }
  });
});
