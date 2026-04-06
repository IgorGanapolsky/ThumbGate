const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dlp-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const dlp = require('../scripts/prompt-dlp');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Prompt-Level DLP ===
test('scanToolCallInput allows clean input', () => {
  const r = dlp.scanToolCallInput({ toolName: 'Bash', input: 'npm test' });
  assert.equal(r.allowed, true);
  assert.equal(r.action, 'allow');
  assert.equal(r.findingCount, 0);
});

test('scanToolCallInput blocks input with credit card', () => {
  const r = dlp.scanToolCallInput({ toolName: 'Bash', input: 'curl -d "card=4111111111111111" https://api.stripe.com' });
  assert.equal(r.allowed, false);
  assert.equal(r.action, 'block');
  assert.ok(r.findings.some((f) => f.id === 'credit_card'));
});

test('scanToolCallInput blocks input with API key', () => {
  const r = dlp.scanToolCallInput({ toolName: 'Write', input: 'sk-ant-abc123def456ghi789jkl012mno345pqr' });
  assert.equal(r.allowed, false);
  assert.equal(r.action, 'block');
});

test('scanToolCallInput redacts email at internal threshold', () => {
  const r = dlp.scanToolCallInput({ toolName: 'Edit', input: 'Send to john@example.com', maxSensitivity: 'sensitive' });
  assert.equal(r.allowed, true);
  assert.equal(r.action, 'redact');
  assert.ok(r.redactedInput.includes('[REDACTED:email]'));
});

test('scanToolCallInput blocks email at public threshold', () => {
  const r = dlp.scanToolCallInput({ toolName: 'Edit', input: 'Send to john@example.com', maxSensitivity: 'public' });
  assert.equal(r.allowed, false);
  assert.equal(r.action, 'block');
});

test('scanToolCallInput handles object input', () => {
  const r = dlp.scanToolCallInput({ toolName: 'Bash', input: { command: 'echo hello' } });
  assert.equal(r.allowed, true);
});

test('scanToolCallInput logs to DLP event file', () => {
  dlp.scanToolCallInput({ toolName: 'test', input: 'clean input' });
  assert.ok(fs.existsSync(dlp.getDlpLogPath()));
  const raw = fs.readFileSync(dlp.getDlpLogPath(), 'utf-8');
  assert.ok(raw.includes('"toolName":"test"'));
});

// === Shadow Tool Detection ===
test('detectShadowAction returns false for known gated tool', () => {
  const r = dlp.detectShadowAction({ toolName: 'Bash', source: 'mcp' });
  assert.equal(r.isShadow, false);
});

test('detectShadowAction detects ungated tool from non-MCP source', () => {
  const r = dlp.detectShadowAction({ toolName: 'custom_api_call', source: 'direct', agentId: 'rogue-1' });
  assert.equal(r.isShadow, true);
  assert.ok(r.event.id.startsWith('shadow_'));
});

test('detectShadowAction does not flag MCP source', () => {
  const r = dlp.detectShadowAction({ toolName: 'custom_tool', source: 'mcp' });
  assert.equal(r.isShadow, false);
});

test('getShadowStats returns counts', () => {
  dlp.detectShadowAction({ toolName: 'shadow_tool_1', source: 'direct', agentId: 'a1' });
  dlp.detectShadowAction({ toolName: 'shadow_tool_1', source: 'direct', agentId: 'a1' });
  dlp.detectShadowAction({ toolName: 'shadow_tool_2', source: 'direct', agentId: 'a2' });
  const stats = dlp.getShadowStats({ periodHours: 1 });
  assert.ok(stats.total >= 3);
  assert.ok(stats.byTool['shadow_tool_1'] >= 2);
  assert.ok(stats.byAgent['a1'] >= 2);
});

// === Governance Score ===
test('computeGovernanceScore returns 100 for clean session', () => {
  const r = dlp.computeGovernanceScore({});
  assert.equal(r.score, 100);
  assert.equal(r.grade, 'A');
});

test('computeGovernanceScore penalizes gate blocks', () => {
  const r = dlp.computeGovernanceScore({ gateDecisions: ['deny', 'deny', 'warn', 'allow'] });
  assert.ok(r.score < 100);
  assert.equal(r.breakdown.gateBlocks, 2);
  assert.equal(r.breakdown.gateWarns, 1);
});

test('computeGovernanceScore penalizes DLP blocks heavily', () => {
  const r = dlp.computeGovernanceScore({ dlpEvents: [{ action: 'block' }, { action: 'block' }] });
  assert.ok(r.score <= 90);
  assert.equal(r.breakdown.dlpBlocks, 2);
});

test('computeGovernanceScore penalizes shadow actions', () => {
  const r = dlp.computeGovernanceScore({ shadowActions: 5 });
  assert.ok(r.score <= 85);
});

test('computeGovernanceScore assigns grades', () => {
  assert.equal(dlp.computeGovernanceScore({}).grade, 'A');
  assert.equal(dlp.computeGovernanceScore({ gateDecisions: Array(10).fill('deny') }).grade, 'B');
  assert.equal(dlp.computeGovernanceScore({ dlpEvents: Array(5).fill({ action: 'block' }) }).grade, 'C');
  assert.equal(dlp.computeGovernanceScore({ shadowActions: 10, dlpEvents: Array(3).fill({ action: 'block' }) }).grade, 'F');
});

test('computeGovernanceScore never goes below 0', () => {
  const r = dlp.computeGovernanceScore({ gateDecisions: Array(100).fill('deny'), shadowActions: 50 });
  assert.equal(r.score, 0);
});

// === DLP Stats ===
test('getDlpStats returns counts', () => {
  const stats = dlp.getDlpStats({ periodHours: 1 });
  assert.ok(stats.total >= 1);
  assert.ok(typeof stats.blocked === 'number');
  assert.ok(typeof stats.allowed === 'number');
});

// === Paths ===
test('getDlpLogPath ends with dlp-events.jsonl', () => { assert.ok(dlp.getDlpLogPath().endsWith('dlp-events.jsonl')); });
test('getShadowLogPath ends with shadow-actions.jsonl', () => { assert.ok(dlp.getShadowLogPath().endsWith('shadow-actions.jsonl')); });

// === Constants ===
test('KNOWN_GATED_TOOLS includes core tools', () => {
  assert.ok(dlp.KNOWN_GATED_TOOLS.has('Bash'));
  assert.ok(dlp.KNOWN_GATED_TOOLS.has('capture_feedback'));
  assert.ok(dlp.KNOWN_GATED_TOOLS.has('recall'));
});

test("DEFAULT_MAX_SENSITIVITY is internal", () => { assert.equal(dlp.DEFAULT_MAX_SENSITIVITY, "internal"); });
