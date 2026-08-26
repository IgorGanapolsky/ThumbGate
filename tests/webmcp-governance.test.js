'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  validateToolDeclaration,
  auditToolRegistry,
  evaluateWebMcpPretool,
} = require('../src/webmcp-governance');

const root = path.join(__dirname, '..');

const readTool = (over = {}) => ({
  name: 'thumbgate_get_pricing_summary',
  description: 'Read-only pointer to plans; purchasing requires a human.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  ...over,
});

test('a truthful read-only tool validates clean', () => {
  const verdict = validateToolDeclaration(readTool());
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.findings, []);
});

test('missing name or description blocks', () => {
  assert.equal(validateToolDeclaration({ description: 'long enough description' }).ok, false);
  assert.equal(validateToolDeclaration({ name: 'get_x', description: 'short' }).ok, false);
});

test('a mutation-named tool claiming readOnlyHint is an untruthful hint (block)', () => {
  const verdict = validateToolDeclaration(readTool({ name: 'submit_lead_form' }));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.findings.some((f) => f.code === 'untruthful_readonly_hint'));
});

test('a read-named tool without readOnlyHint warns but does not block', () => {
  const verdict = validateToolDeclaration(readTool({ annotations: {} }));
  assert.equal(verdict.ok, true);
  assert.ok(verdict.findings.some((f) => f.code === 'read_tool_without_readonly_hint'));
});

test('commerce-shaped tools block without human confirmation, and autosubmit is never allowed', () => {
  const buy = {
    name: 'start_pro_checkout',
    description: 'Begin the paid plan purchase flow.',
    inputSchema: { type: 'object', properties: {} },
    annotations: {},
  };
  const bare = validateToolDeclaration(buy);
  assert.equal(bare.ok, false);
  assert.ok(bare.findings.some((f) => f.code === 'commerce_without_human_confirmation'));

  const confirmed = validateToolDeclaration({ ...buy, annotations: { humanConfirmationHint: true } });
  assert.equal(confirmed.ok, true);

  const autosubmit = validateToolDeclaration({ ...buy, annotations: { humanConfirmationHint: true }, autosubmit: true });
  assert.equal(autosubmit.ok, false);
  assert.ok(autosubmit.findings.some((f) => f.code === 'commerce_autosubmit'));
});

test('registry audit flags duplicate names', () => {
  const audit = auditToolRegistry([readTool(), readTool()]);
  assert.equal(audit.ok, false);
  assert.ok(audit.results[1].findings.some((f) => f.code === 'duplicate_tool_name'));
});

test('pretool: agent-invoked commerce tools deny; mutations warn; reads allow', () => {
  assert.equal(
    evaluateWebMcpPretool({ toolName: 'start_checkout', description: 'begin purchase', annotations: {} }).decision,
    'deny'
  );
  assert.equal(
    evaluateWebMcpPretool({ toolName: 'book_consult', description: 'book a consultation', annotations: {}, autosubmit: true }).decision,
    'deny'
  );
  assert.equal(
    evaluateWebMcpPretool({ toolName: 'submit_note', description: 'saves a note', annotations: {} }).decision,
    'warn'
  );
  assert.equal(
    evaluateWebMcpPretool({ toolName: 'get_pricing', description: 'reads pricing', annotations: { readOnlyHint: true } }).decision,
    'allow'
  );
});

// ---------------------------------------------------------------------------
// Page wiring: the shipped instrumentation obeys the policy above.
// ---------------------------------------------------------------------------

test('public/js/webmcp.js parses, registers only read-only tools, and never autosubmits', () => {
  const scriptPath = path.join(root, 'public', 'js', 'webmcp.js');
  execFileSync(process.execPath, ['--check', scriptPath]);
  const source = fs.readFileSync(scriptPath, 'utf8');

  const registrations = source.split('ctx.registerTool(').length - 1;
  const readOnlyHints = source.split('annotations: { readOnlyHint: true }').length - 1;
  assert.ok(registrations >= 2, 'expected at least two registered tools');
  assert.equal(readOnlyHints, registrations, 'every registered tool must declare readOnlyHint: true');
  assert.equal(/toolautosubmit/i.test(source), false, 'page script must not use toolautosubmit');
});

test('index.html and pricing.html load the WebMCP script and carry the readiness marker', () => {
  for (const page of ['index.html', 'pricing.html']) {
    const body = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    assert.ok(body.includes('/js/webmcp.js'), `${page} must load /js/webmcp.js`);
    assert.ok(body.includes('WebMCP-ready'), `${page} must carry the WebMCP-ready marker`);
  }
});

test('the payment form carries no WebMCP tool attributes', () => {
  const body = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const formMatch = body.match(/<form[^>]*data-primary-checkout[^>]*>/);
  assert.ok(formMatch, 'primary payment form must exist');
  assert.equal(/toolname|toolautosubmit/i.test(formMatch[0]), false, 'payment form must stay human-only');
});

test('the server exposes a route for /js/webmcp.js', () => {
  const serverSource = fs.readFileSync(path.join(root, 'src', 'api', 'server.js'), 'utf8');
  assert.ok(serverSource.includes("'/js/webmcp.js'"), 'server.js must route /js/webmcp.js');
  assert.ok(serverSource.includes('WEBMCP_SCRIPT_PATH'), 'server.js must resolve the script path');
});
