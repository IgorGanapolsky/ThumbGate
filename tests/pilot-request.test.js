'use strict';

// AGENT-3667, 24 Nov 2026: "Request a 30-day team pilot" form. Unit checks on the module, then the real server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pilot = require('../scripts/pilot-request');

test('validatePilotRequest accepts a full request and normalises the email', () => {
  const out = pilot.validatePilotRequest({ name: ' Ada ', email: 'Ada@Example.com', teamSize: '6-20', agent: 'Cursor' });
  assert.equal(out.ok, true);
  assert.equal(out.request.email, 'ada@example.com');
  assert.equal(out.request.name, 'Ada');
  assert.match(out.request.id, /^pilot_/);
});

test('validatePilotRequest names every bad field', () => {
  const out = pilot.validatePilotRequest({ name: '', email: 'not-an-email', teamSize: '7', agent: 'Vim' });
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors, ['name', 'email', 'teamSize', 'agent']);
});

test('notifyOwner sends to the first owner address and reports a missing one', async () => {
  const sent = [];
  const request = pilot.validatePilotRequest({ name: 'Ada', email: 'ada@example.com', teamSize: '1-5', agent: 'Codex' }).request;
  const ok = await pilot.notifyOwner(request, { ownerEmails: ['owner@example.test'], sendEmail: async (m) => { sent.push(m); return { sent: true }; } });
  assert.equal(ok.sent, true);
  assert.equal(sent[0].to, 'owner@example.test');
  assert.match(sent[0].text, /Team size: 1-5/);
  assert.match(sent[0].text, /Agent: Codex/);
  const none = await pilot.notifyOwner(request, { ownerEmails: [], sendEmail: async () => ({ sent: true }) });
  assert.deepEqual(none, { sent: false, reason: 'no_owner_address' });
});

test('store and read round-trip one line per request', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-pilot-'));
  try {
    const a = pilot.validatePilotRequest({ name: 'A', email: 'a@example.com', teamSize: '1-5', agent: 'Gemini' }).request;
    const b = pilot.validatePilotRequest({ name: 'B', email: 'b@example.com', teamSize: '100+', agent: 'Other' }).request;
    pilot.storePilotRequest(dir, a);
    pilot.storePilotRequest(dir, b);
    assert.deepEqual(pilot.readPilotRequests(dir).map((r) => r.name), ['A', 'B']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the home page and the pricing page link to /pilot, and the form posts to the intake route', () => {
  const root = path.resolve(__dirname, '..', 'public');
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /href="\/pilot"[^>]*>Request a 30-day team pilot</);
  assert.match(fs.readFileSync(path.join(root, 'pricing.html'), 'utf8'), /href="\/pilot"[^>]*>Request a 30-day team pilot</);
  const page = fs.readFileSync(path.join(root, 'pilot.html'), 'utf8');
  assert.match(page, /action="\/v1\/intake\/pilot-request"/);
  for (const field of ['name="name"', 'name="email"', 'name="teamSize"', 'name="agent"']) assert.ok(page.includes(field), field);
});

test('real server: page loads, bad request is 400, good request is stored', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-pilot-srv-'));
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  process.env.THUMBGATE_NO_RATE_LIMIT = '1';
  process.env.THUMBGATE_API_KEY = 'test-key-pilot';
  delete process.env.THUMBGATE_OWNER_EMAILS;
  const { server, port } = await require('../src/api/server').startServer({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${port}`;
  try {
    const page = await fetch(`${origin}/pilot`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Request a 30-day team pilot/);

    const bad = await fetch(`${origin}/v1/intake/pilot-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
    assert.equal(bad.status, 400);
    assert.deepEqual((await bad.json()).fields, ['email', 'teamSize', 'agent']);

    const good = await fetch(`${origin}/v1/intake/pilot-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test Person', email: 'test@example.com', teamSize: '6-20', agent: 'Claude Code' }) });
    assert.equal(good.status, 200);
    const json = await good.json();
    assert.equal(json.ok, true);
    assert.equal(json.stored, true);
    assert.equal(json.ownerNotified, false); // no owner address configured in this test
    const rows = pilot.readPilotRequests(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, json.id);
    assert.equal(rows[0].agent, 'Claude Code');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
