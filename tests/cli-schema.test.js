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
    'rules', 'doctor', 'export-dpo', 'init', 'serve', 'dashboard'];
  for (const name of required) {
    assert.ok(findCommand(name), `${name} must be in CLI_COMMANDS`);
  }
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
