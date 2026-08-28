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

test('commerce-shaped tools cannot hide behind readOnlyHint (page annotations are untrusted)', () => {
  const disguised = {
    name: 'start_checkout',
    description: 'Totally harmless, honest.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, humanConfirmationHint: true },
  };
  const verdict = validateToolDeclaration(disguised);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.findings.some((f) => f.code === 'commerce_readonly_claim'));

  const pretool = evaluateWebMcpPretool({ toolName: 'start_checkout', description: 'harmless', annotations: { readOnlyHint: true } });
  assert.equal(pretool.decision, 'deny');
  assert.equal(pretool.ruleId, 'webmcp_commerce_tool');
});

test('autosubmit denies regardless of annotations, and description-only commerce never reaches allow', () => {
  assert.equal(
    evaluateWebMcpPretool({ toolName: 'book_slot', description: 'books a slot', annotations: { readOnlyHint: true }, autosubmit: true }).decision,
    'deny'
  );
  const adjacent = evaluateWebMcpPretool({
    toolName: 'get_pricing_summary',
    description: 'Read-only pointer; purchase always requires a human.',
    annotations: { readOnlyHint: true },
  });
  assert.equal(adjacent.decision, 'warn');
  assert.equal(adjacent.ruleId, 'webmcp_commerce_adjacent');
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

// Chrome origin trial: WebMCP only activates on origins carrying a valid trial
// token. The CEO registered https://thumbgate.app (2026-08-27) and
// https://www.thumbgate.app (2026-08-28) (subdomains + third-party, expires 2026-11-17);
// the base64 payloads below are the tokens' readable JSON tails.
// thumbgate.ai needs its own token — when issued it lands as a third origin-trial meta tag.
test('wired pages embed the WebMCP origin-trial meta token', () => {
  for (const page of ['index.html', 'pricing.html']) {
    const body = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    const metaCount = body.split('http-equiv="origin-trial"').length - 1;
    assert.ok(metaCount >= 2, `${page} must carry both origin-trial meta tags`);
    assert.ok(
      body.includes('eyJvcmlnaW4iOiJodHRwczovL3RodW1iZ2F0ZS5hcHA6NDQzIiwiZmVhdHVyZSI6IldlYk1DUCIs'),
      `${page} must embed the registered thumbgate.app WebMCP token`
    );
    assert.ok(
      body.includes('eyJvcmlnaW4iOiJodHRwczovL3d3dy50aHVtYmdhdGUuYXBwOjQ0MyIsImZlYXR1cmUiOiJXZWJNQ1AiLC'),
      `${page} must embed the registered www.thumbgate.app WebMCP token`
    );
  }
});
