'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLI_COMMANDS,
  findCommand,
  groupedCommands,
  commandHelpLine,
} = require('../scripts/cli-schema');

// ---------------------------------------------------------------------------
// CLI_COMMANDS structure
// ---------------------------------------------------------------------------

test('CLI_COMMANDS is a non-empty array', () => {
  assert.ok(Array.isArray(CLI_COMMANDS));
  assert.ok(CLI_COMMANDS.length > 0);
});

test('every command has name, description, group, and flags array', () => {
  for (const cmd of CLI_COMMANDS) {
    assert.ok(typeof cmd.name === 'string' && cmd.name.length > 0,
      `command.name must be a non-empty string (got ${JSON.stringify(cmd.name)})`);
    assert.ok(typeof cmd.description === 'string' && cmd.description.length > 0,
      `${cmd.name}: description must be a non-empty string`);
    assert.ok(typeof cmd.group === 'string',
      `${cmd.name}: group must be a string`);
    assert.ok(Array.isArray(cmd.flags),
      `${cmd.name}: flags must be an array`);
  }
});

test('all flag entries have name, type, and optional description', () => {
  for (const cmd of CLI_COMMANDS) {
    for (const flag of cmd.flags) {
      assert.ok(typeof flag.name === 'string' && flag.name.length > 0,
        `${cmd.name}: flag.name must be a non-empty string`);
      assert.ok(['string', 'boolean', 'number'].includes(flag.type),
        `${cmd.name}.${flag.name}: flag.type must be string|boolean|number`);
    }
  }
});

test('no duplicate command names', () => {
  const names = CLI_COMMANDS.map((c) => c.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, 'duplicate command names detected');
});

// ---------------------------------------------------------------------------
// findCommand
// ---------------------------------------------------------------------------

test('findCommand returns command by primary name', () => {
  const cmd = findCommand('lessons');
  assert.ok(cmd, 'lessons command should exist');
  assert.equal(cmd.name, 'lessons');
});

test('findCommand returns command by alias', () => {
  const cmd = findCommand('dpo');
  assert.ok(cmd, 'dpo alias should resolve');
  assert.equal(cmd.name, 'export-dpo');
});

test('findCommand returns undefined for unknown name', () => {
  assert.equal(findCommand('nonexistent-command-xyz'), undefined);
});

// ---------------------------------------------------------------------------
// Key commands are registered
// ---------------------------------------------------------------------------

test('core commands are all registered in schema', () => {
  const required = ['capture', 'lessons', 'stats', 'gate-stats', 'explore',
    'artifacts', 'rules', 'doctor', 'harness-audit', 'native-messaging-audit', 'export-dpo', 'init', 'serve', 'dashboard'];
  for (const name of required) {
    assert.ok(findCommand(name), `${name} must be in CLI_COMMANDS`);
  }
});

test('background-governance exposes report and pre-dispatch check flags', () => {
  const cmd = findCommand('agent-governance');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'background-governance');
  assert.ok(flagNames.includes('json'));
  assert.ok(flagNames.includes('window-hours'));
  assert.ok(flagNames.includes('feedback-dir'));
  assert.ok(flagNames.includes('check'));
  assert.ok(flagNames.includes('agent-id'));
  assert.ok(flagNames.includes('branch'));
  assert.ok(flagNames.includes('files-changed'));
});

test('model-candidates exposes dashboard-analysis routing flags', () => {
  const cmd = findCommand('managed-models');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'model-candidates');
  assert.ok(flagNames.includes('json'));
  assert.ok(flagNames.includes('workload'));
  assert.ok(flagNames.includes('provider'));
  assert.ok(flagNames.includes('family'));
  assert.ok(flagNames.includes('gateway'));
  assert.ok(flagNames.includes('max'));
});

test('harness-audit command exposes JSON and token budget flags', () => {
  const cmd = findCommand('harness');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'harness-audit');
  assert.ok(flagNames.includes('json'), 'harness-audit must have --json flag');
  assert.ok(flagNames.includes('doc-token-budget'), 'harness-audit must expose doc budget control');
});

test('native-messaging-audit exposes JSON, platform, home-dir, and ai-only flags', () => {
  const cmd = findCommand('bridge-audit');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'native-messaging-audit');
  assert.equal(cmd.mcpTool, 'native_messaging_audit');
  assert.ok(flagNames.includes('json'));
  assert.ok(flagNames.includes('platform'));
  assert.ok(flagNames.includes('home-dir'));
  assert.ok(flagNames.includes('ai-only'));
});

test('code-graph-guardrails exposes graph signal flags', () => {
  const cmd = findCommand('knowledge-graph-guardrails');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'code-graph-guardrails');
  assert.ok(flagNames.includes('json'));
  assert.ok(flagNames.includes('graph-tool'));
  assert.ok(flagNames.includes('graph-path'));
  assert.ok(flagNames.includes('central-files'));
  assert.ok(flagNames.includes('layers'));
  assert.ok(flagNames.includes('generated-artifacts'));
  assert.ok(flagNames.includes('changed-files'));
});

test('proxy-pointer-rag-guardrails exposes document RAG signal flags', () => {
  const cmd = findCommand('document-rag-guardrails');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'proxy-pointer-rag-guardrails');
  assert.ok(flagNames.includes('json'));
  assert.ok(flagNames.includes('rag-tool'));
  assert.ok(flagNames.includes('tree-path'));
  assert.ok(flagNames.includes('section-ids'));
  assert.ok(flagNames.includes('image-pointers'));
  assert.ok(flagNames.includes('documents'));
  assert.ok(flagNames.includes('cross-doc-policy'));
  assert.ok(flagNames.includes('visual-claims'));
});

test('rag-precision-guardrails exposes retrieval regression flags', () => {
  const cmd = findCommand('retrieval-precision-guardrails');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'rag-precision-guardrails');
  assert.ok(flagNames.includes('json'));
  assert.ok(flagNames.includes('baseline-recall'));
  assert.ok(flagNames.includes('new-recall'));
  assert.ok(flagNames.includes('threshold-change'));
  assert.ok(flagNames.includes('embedding-finetune'));
  assert.ok(flagNames.includes('structural-near-misses'));
  assert.ok(flagNames.includes('verifier'));
  assert.ok(flagNames.includes('latency-budget-ms'));
  assert.ok(flagNames.includes('agentic'));
});

test('long-running-agent-context-guardrails exposes structured memory flags', () => {
  const cmd = findCommand('agent-context-guardrails');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'long-running-agent-context-guardrails');
  assert.ok(flagNames.includes('json'));
  assert.ok(flagNames.includes('request-count'));
  assert.ok(flagNames.includes('director-journal'));
  assert.ok(flagNames.includes('critic-review'));
  assert.ok(flagNames.includes('critic-timeline'));
  assert.ok(flagNames.includes('credibility-scores'));
  assert.ok(flagNames.includes('raw-chat-only'));
});

test('reasoning-efficiency-guardrails exposes step-level compression flags', () => {
  const cmd = findCommand('sas-guardrails');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'reasoning-efficiency-guardrails');
  assert.ok(flagNames.includes('json'));
  assert.ok(flagNames.includes('baseline-tokens'));
  assert.ok(flagNames.includes('compressed-tokens'));
  assert.ok(flagNames.includes('baseline-accuracy'));
  assert.ok(flagNames.includes('compressed-accuracy'));
  assert.ok(flagNames.includes('verifier'));
  assert.ok(flagNames.includes('low-confidence-steps'));
  assert.ok(flagNames.includes('high-confidence-failures'));
});

test('lessons command has --json, --local, --remote flags', () => {
  const cmd = findCommand('lessons');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.ok(flagNames.includes('json'),   'lessons must have --json flag');
  assert.ok(flagNames.includes('local'),  'lessons must have --local flag');
  assert.ok(flagNames.includes('remote'), 'lessons must have --remote flag');
});

test('stats command has --json and --remote flags', () => {
  const cmd = findCommand('stats');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.ok(flagNames.includes('json'),   'stats must have --json flag');
  assert.ok(flagNames.includes('remote'), 'stats must have --remote flag');
});

test('gate-stats command has --json flag', () => {
  const cmd = findCommand('gate-stats');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.ok(flagNames.includes('json'), 'gate-stats must have --json flag');
});

test('artifacts command is bound to the operator artifact MCP tool', () => {
  const cmd = findCommand('artifact');
  const flagNames = cmd.flags.map((f) => f.name);
  assert.equal(cmd.name, 'artifacts');
  assert.equal(cmd.mcpTool, 'generate_operator_artifact');
  assert.ok(flagNames.includes('type'), 'artifacts must have --type flag');
  assert.ok(flagNames.includes('window-hours'), 'artifacts must have --window-hours flag');
  assert.ok(flagNames.includes('json'), 'artifacts must have --json flag');
});

// ---------------------------------------------------------------------------
// groupedCommands
// ---------------------------------------------------------------------------

test('groupedCommands returns object with known group keys', () => {
  const groups = groupedCommands();
  assert.ok(typeof groups === 'object');
  assert.ok(Array.isArray(groups.capture),   'capture group must exist');
  assert.ok(Array.isArray(groups.discovery), 'discovery group must exist');
  assert.ok(Array.isArray(groups.gates),     'gates group must exist');
  assert.ok(Array.isArray(groups.export),    'export group must exist');
  assert.ok(Array.isArray(groups.ops),       'ops group must exist');
});

test('groupedCommands: every command appears in exactly one group', () => {
  const groups = groupedCommands();
  const inGroups = new Set(Object.values(groups).flat().map((c) => c.name));
  for (const cmd of CLI_COMMANDS) {
    assert.ok(inGroups.has(cmd.name), `${cmd.name} must appear in a group`);
  }
});

// ---------------------------------------------------------------------------
// commandHelpLine
// ---------------------------------------------------------------------------

test('commandHelpLine returns string containing command name', () => {
  const cmd = findCommand('explore');
  const line = commandHelpLine(cmd);
  assert.ok(typeof line === 'string');
  assert.ok(line.includes('explore'));
});

test('commandHelpLine includes [mcp:tool_name] when mcpTool is set', () => {
  const cmd = findCommand('lessons');
  const line = commandHelpLine(cmd);
  assert.ok(line.includes('[mcp:search_lessons]'), 'should include MCP tool reference');
});

test('commandHelpLine does not include mcp annotation for non-MCP commands', () => {
  const cmd = findCommand('explore');
  const line = commandHelpLine(cmd);
  assert.ok(!line.includes('[mcp:'), 'explore has no MCP tool');
});

test('commandHelpLine includes alias when showFlags is false', () => {
  const cmd = findCommand('export-dpo');
  const line = commandHelpLine(cmd);
  assert.ok(line.includes('dpo'), 'alias should appear in help line');
});
